"""BE-22: scripts/warmup.py against a fake stack (httpx.MockTransport; no network, no sleeping)."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "warmup.py"
spec = importlib.util.spec_from_file_location("warmup", SCRIPT)
warmup = importlib.util.module_from_spec(spec)
sys.modules["warmup"] = warmup
spec.loader.exec_module(warmup)
_REAL_LOAD = warmup.load_repo_env

API = "https://site.test/api"
SB = "https://ref.supabase.test"
WELL_A, WELL_B = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class Clock:
    def __init__(self):
        self.t = 0.0
        self.sleeps = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.t += seconds


# ---------------------------------------------------------------- waking the Space


def test_wake_polls_until_the_space_reports_ok():
    clock, answers = Clock(), [httpx.Response(503, json={}), httpx.Response(200, json={"ok": True, "space": {"ok": False}}),
                               httpx.Response(200, json={"ok": True, "space": {"ok": True, "version": "0.1.0", "models": {"l2": ["kick"]}}})]  # fmt: skip
    check = warmup.wake_space(client_for(lambda r: answers.pop(0)), API, sleep=clock.sleep, clock=clock.now)
    assert check.ok and "version 0.1.0" in check.detail and "kick" in check.detail
    assert clock.sleeps == [warmup.SPACE_POLL_S, warmup.SPACE_POLL_S] and not answers


def test_wake_gives_up_after_three_minutes_and_says_what_it_last_saw():
    clock = Clock()
    check = warmup.wake_space(client_for(lambda r: httpx.Response(200, json={"ok": True, "space": {"ok": False, "error": "timed out"}})), API, sleep=clock.sleep, clock=clock.now)
    assert not check.ok and "gave up after 180 s" in check.detail and "timed out" in check.detail
    assert clock.t >= 180


def test_wake_survives_connection_errors_while_the_space_boots():
    clock, calls = Clock(), {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"ok": True, "space": {"ok": True}})

    assert warmup.wake_space(client_for(handler), API, sleep=clock.sleep, clock=clock.now).ok and calls["n"] == 3


# ---------------------------------------------------------------- Supabase and sign-in


def test_supabase_check_is_green_on_200_and_hints_at_a_paused_project_otherwise():
    assert warmup.check_supabase(client_for(lambda r: httpx.Response(200, json={})), SB, "anon").ok
    down = warmup.check_supabase(client_for(lambda r: httpx.Response(503)), SB, "anon")
    assert not down.ok and "paused" in down.detail

    def refuse(request):
        raise httpx.ConnectTimeout("timed out")

    dead = warmup.check_supabase(client_for(refuse), SB, "anon")
    assert not dead.ok and "ConnectTimeout" in dead.detail and "paused" in dead.detail


def test_sign_in_posts_the_password_grant_and_returns_the_token():
    seen = {}

    def handler(request):
        seen.update(url=str(request.url), key=request.headers["apikey"], body=json.loads(request.content))
        return httpx.Response(200, json={"access_token": "jwt-123"})

    check, token = warmup.sign_in(client_for(handler), SB, "anon-key", "demo@x.in", "pw")
    assert check.ok and token == "jwt-123"
    assert seen["url"] == f"{SB}/auth/v1/token?grant_type=password" and seen["key"] == "anon-key"
    assert seen["body"] == {"email": "demo@x.in", "password": "pw"}


def test_sign_in_failure_reports_the_error_and_no_token():
    check, token = warmup.sign_in(client_for(lambda r: httpx.Response(400, json={"error": {"code": "invalid_grant", "message": "bad login"}})), SB, "k", "a@b.c", "x")
    assert not check.ok and token is None and "bad login" in check.detail


# ---------------------------------------------------------------- search, questions, risk


def test_search_warm_up_sends_the_token_and_retries_a_failure_once_the_space_recovers():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        assert request.headers["authorization"] == "Bearer tok" and json.loads(request.content)["q"] == "mud losses"
        return httpx.Response(502, json={"error": {"code": "NWIS_UPSTREAM", "message": "down"}}) if calls["n"] == 1 else httpx.Response(200, json={"results": [{}, {}]})

    sleeps = []
    check = warmup.warm_search(client_for(handler), API, "tok", "mud losses", sleep=sleeps.append)
    assert check.ok and "2 result(s)" in check.detail and calls["n"] == 2 and sleeps == [warmup.RETRY_DELAY_S]


def test_search_gives_up_after_three_attempts():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"code": "NWIS_UNAUTHORIZED", "message": "bad token"}})

    check = warmup.warm_search(client_for(handler), API, "tok", "q", sleep=lambda s: None)
    assert not check.ok and calls["n"] == 3 and "NWIS_UNAUTHORIZED" in check.detail


def test_each_scripted_question_is_asked_once_to_fill_the_cache():
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"evidence": "sufficient", "citations": [{}], "cached": False})

    check = warmup.warm_question(client_for(handler), API, "tok", "What worked for losses?")
    assert check.ok and "sufficient, 1 citation(s)" in check.detail
    assert sent == [{"question": "What worked for losses?", "filters": {}, "wellbore_id": None}]


def stack_handler(wells=None, risk_status=200):
    wells = wells if wells is not None else [
        {"name": "SYN-A", "wellbores": [{"id": WELL_A, "is_primary": True}, {"id": "x", "is_primary": False}]},
        {"name": "SYN-B", "wellbores": [{"id": WELL_B, "is_primary": True}]},
        {"name": "SYN-C", "wellbores": []},
    ]  # fmt: skip
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/rest/v1/wells":
            assert request.url.params["status"] == "eq.drilling" and request.headers["apikey"] == "anon"
            return httpx.Response(200, json=wells)
        return httpx.Response(risk_status, json={"scores": [{}] * 24} if risk_status == 200 else {"error": {"code": "NWIS_BAD_STATE", "message": "No bit depth"}})

    return handler, calls


def test_risk_is_warmed_for_each_drilling_wells_primary_wellbore():
    handler, calls = stack_handler()
    checks = warmup.warm_risk(client_for(handler), API, SB, "anon", "tok", sleep=lambda s: None)
    assert [c.name for c in checks] == ["Risk warmed: SYN-A", "Risk warmed: SYN-B"] and all(c.ok for c in checks)
    assert "24 score row(s)" in checks[0].detail
    assert [path for method, path in calls if method == "POST"] == [f"/api/wells/{WELL_A}/risk", f"/api/wells/{WELL_B}/risk"]


def test_no_drilling_well_is_a_red_check_not_a_silent_pass():
    handler, _ = stack_handler(wells=[])
    (check,) = warmup.warm_risk(client_for(handler), API, SB, "anon", "tok", sleep=lambda s: None)
    assert not check.ok and "DB-09" in check.detail


def test_a_risk_failure_names_the_well_and_the_reason():
    handler, _ = stack_handler(risk_status=409)
    checks = warmup.warm_risk(client_for(handler), API, SB, "anon", "tok", sleep=lambda s: None)
    assert not any(c.ok for c in checks) and "No bit depth" in checks[0].detail and "SYN-A" in checks[0].name


def test_an_unreadable_well_list_is_reported():
    check, = warmup.warm_risk(client_for(lambda r: httpx.Response(401, json={})), API, SB, "anon", "tok", sleep=lambda s: None)
    assert not check.ok and "could not list" in check.detail


# ---------------------------------------------------------------- reset


def test_reset_needs_the_script_and_the_database_url(monkeypatch, tmp_path):
    monkeypatch.setattr(warmup, "REPO_ROOT", tmp_path)
    assert "not found" in warmup.run_reset(env={}).detail
    name = "reset_demo.ps1" if sys.platform == "win32" else "reset_demo.sh"
    (tmp_path / "db" / "scripts").mkdir(parents=True)
    (tmp_path / "db" / "scripts" / name).write_text("echo ok", encoding="utf-8")
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    missing = warmup.run_reset(env={})
    assert not missing.ok and "SUPABASE_DB_URL" in missing.detail


def test_reset_runs_the_script_and_reports_its_last_lines(monkeypatch, tmp_path):
    monkeypatch.setattr(warmup, "REPO_ROOT", tmp_path)
    name = "reset_demo.ps1" if sys.platform == "win32" else "reset_demo.sh"
    (tmp_path / "db" / "scripts").mkdir(parents=True)
    (tmp_path / "db" / "scripts" / name).write_text("", encoding="utf-8")
    seen = {}

    def runner(command, **kwargs):
        seen.update(command=command, env=kwargs["env"], timeout=kwargs["timeout"])
        return SimpleNamespace(returncode=0, stdout="a\nb\nc\nwells: 3\n", stderr="")

    check = warmup.run_reset(env={"SUPABASE_DB_URL": "postgres://x"}, runner=runner)
    assert check.ok and check.detail == "b | c | wells: 3" and seen["env"]["SUPABASE_DB_URL"] == "postgres://x"
    assert str(tmp_path / "db" / "scripts" / name) in seen["command"] and seen["timeout"] == warmup.RESET_TIMEOUT_S

    failing = warmup.run_reset(env={"SUPABASE_DB_URL": "x"}, runner=lambda *a, **k: SimpleNamespace(returncode=3, stdout="", stderr="psql: could not connect\n"))
    assert not failing.ok and "could not connect" in failing.detail

    def hang(*a, **k):
        raise subprocess.TimeoutExpired("psql", 120)

    assert not warmup.run_reset(env={"SUPABASE_DB_URL": "x"}, runner=hang).ok


# ---------------------------------------------------------------- the checklist and main


def test_the_checklist_is_green_or_red_with_a_verdict_and_optional_colour():
    checks = [warmup.Check("Space is awake", True, "version 0.1.0", 1.2), warmup.Check("Demo reset", False, "SUPABASE_DB_URL is not set")]
    plain = warmup.render(checks, colour=False)
    assert "[ OK ] Space is awake  (1.2 s)" in plain and "[FAIL] Demo reset" in plain and "SUPABASE_DB_URL is not set" in plain
    assert plain.endswith("NOT READY: 1 of 2 checks failed") and "\033[" not in plain
    assert "\033[32m[ OK ]" in warmup.render(checks, colour=True) and "\033[31m[FAIL]" in warmup.render(checks, colour=True)
    assert warmup.render(checks[:1], colour=False).endswith("READY: all 1 checks passed")


@pytest.fixture(autouse=True)
def _no_real_dotenv(monkeypatch):
    """main() reads <repo>/.env; the tests must not depend on a developer's real file."""
    monkeypatch.setattr(warmup, "load_repo_env", lambda path=None: None)


def test_load_repo_env_reads_the_file_without_overriding_what_is_set(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    lines = ["# comment", "", "A_KEY=from-file", 'B_KEY="quoted value"', "EMPTY=", "C_KEY=file", "not a line"]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for name in ("A_KEY", "B_KEY", "EMPTY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("C_KEY", "already-set")
    # the fixture replaced the loader in the module; the real one is restored for this test
    monkeypatch.setattr(warmup, "load_repo_env", _REAL_LOAD)
    warmup.load_repo_env(env)
    import os

    assert os.environ["A_KEY"] == "from-file"
    assert os.environ["B_KEY"] == "quoted value"
    assert "EMPTY" not in os.environ
    assert os.environ["C_KEY"] == "already-set"
    warmup.load_repo_env(tmp_path / "missing.env")  # a missing file is fine


def test_main_stops_early_without_configuration(monkeypatch, capsys):
    for name in ("API_BASE", "SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "TEST_EMAIL", "TEST_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    assert warmup.main([]) == 2
    err = capsys.readouterr().err
    assert "API_BASE" in err and "SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY" in err and "TEST_PASSWORD" in err


def test_main_runs_every_step_in_order_and_exits_zero_when_all_are_green(monkeypatch, capsys):
    for name, value in {"API_BASE": API + "/", "SUPABASE_URL": SB, "VITE_SUPABASE_ANON_KEY": "anon", "TEST_EMAIL": "d@x.in", "TEST_PASSWORD": "pw"}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    order = []

    def handler(request):
        path = request.url.path
        order.append((request.method, path))
        if path == "/api/health":
            return httpx.Response(200, json={"ok": True, "space": {"ok": True, "version": "0.1.0", "models": {"l2": []}}})
        if path == "/auth/v1/health":
            return httpx.Response(200, json={})
        if path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": "jwt"})
        if path == "/api/search":
            return httpx.Response(200, json={"results": []})
        if path == "/api/ask":
            return httpx.Response(200, json={"evidence": "sufficient", "citations": [], "cached": False})
        if path == "/rest/v1/wells":
            return httpx.Response(200, json=[{"name": "SYN-A", "wellbores": [{"id": WELL_A, "is_primary": True}]}])
        if path.endswith("/risk"):
            return httpx.Response(200, json={"scores": []})
        raise AssertionError(path)

    real_client = httpx.Client
    monkeypatch.setattr(warmup.httpx, "Client", lambda *a, **k: real_client(transport=httpx.MockTransport(handler)))
    assert warmup.main(["--ask", "What worked?", "--skip-reset"]) == 0
    assert [p for _, p in order] == ["/api/health", "/auth/v1/health", "/auth/v1/token", "/api/search", "/api/ask", "/rest/v1/wells", f"/api/wells/{WELL_A}/risk"]
    out = capsys.readouterr().out
    assert "READY: all 7 checks passed" in out and "skipped (--skip-reset)" in out


def test_main_exits_one_when_sign_in_fails_and_skips_the_dependent_steps(monkeypatch, capsys):
    for name, value in {"API_BASE": API, "SUPABASE_URL": SB, "SUPABASE_ANON_KEY": "anon", "TEST_EMAIL": "d@x.in", "TEST_PASSWORD": "wrong"}.items():
        monkeypatch.setenv(name, value)

    def handler(request):
        if request.url.path == "/api/health":
            return httpx.Response(200, json={"ok": True, "space": {"ok": True}})
        if request.url.path == "/auth/v1/health":
            return httpx.Response(200, json={})
        return httpx.Response(400, json={"error": {"code": "invalid_grant", "message": "bad login"}})

    real_client = httpx.Client
    monkeypatch.setattr(warmup.httpx, "Client", lambda *a, **k: real_client(transport=httpx.MockTransport(handler)))
    assert warmup.main(["--skip-reset"]) == 1
    out = capsys.readouterr().out
    assert "[FAIL] Signed in" in out and "skipped: not signed in" in out and "NOT READY" in out

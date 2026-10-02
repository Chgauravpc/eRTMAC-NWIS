#!/usr/bin/env python
"""Warm up the NWIS stack before a demo (BE-22) and print a green/red checklist.

    python scripts/warmup.py [--ask "a scripted question"]... [--skip-reset] [--query "text"]

Environment (nothing is written to disk):
    API_BASE             https://<site>.vercel.app/api            (the Vercel /api base the browser uses)
    SUPABASE_URL         https://<ref>.supabase.co
    SUPABASE_ANON_KEY    the anon public key (VITE_SUPABASE_ANON_KEY is also read)
    TEST_EMAIL, TEST_PASSWORD   a demo account that may call risk, search and ask (any role)
    SUPABASE_DB_URL      only for the reset step (db/scripts/reset_demo.*, DB-13)

Steps, in this order (a paused Supabase project would otherwise make sign-in fail confusingly, and search needs a session):
    1. wake the Space: GET /api/health until the Space answers ok (up to 3 minutes)
    2. check Supabase responds and is not paused
    3. sign in with TEST_EMAIL / TEST_PASSWORD
    4. POST /api/search once (loads the embedding model); each --ask question is asked once too, which fills the LLM cache
    5. POST /api/wells/<wellbore>/risk for every drilling well (loads the models, writes risk_scores)
    6. run db/scripts/reset_demo (removes the runtime rows the steps above created, restores the replay start depths)
Exit status 0 only if every step is green.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_repo_env(path: Path | None = None) -> None:
    """Read <repo>/.env into os.environ without overriding variables that are already set."""
    path = path or REPO_ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("\"'")
        if key and value and key not in os.environ:
            os.environ[key] = value
SPACE_WAKE_TIMEOUT_S = 180.0
SPACE_POLL_S = 5.0
REQUEST_TIMEOUT_S = 90.0  # the first search loads the embedding model
SUPABASE_TIMEOUT_S = 15.0
RETRIES = 3
RETRY_DELAY_S = 3.0
RESET_TIMEOUT_S = 120.0
DEFAULT_QUERY = "mud losses"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    seconds: float = 0.0


def with_retries(fn: Callable[[], Check], attempts: int = RETRIES, delay: float = RETRY_DELAY_S, sleep: Callable[[float], None] = time.sleep) -> Check:
    """Run `fn` until it returns a green Check or the attempts are used; the last result is returned."""
    result = fn()
    for _ in range(attempts - 1):
        if result.ok:
            break
        sleep(delay)
        result = fn()
    return result


def _timed(name: str, fn: Callable[[], tuple[bool, str]]) -> Check:
    started = time.perf_counter()
    try:
        ok, detail = fn()
    except httpx.HTTPError as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    return Check(name, ok, detail, time.perf_counter() - started)


def _error_text(response: httpx.Response) -> str:
    try:
        error = response.json().get("error", {})
        return f"HTTP {response.status_code} {error.get('code', '')}: {error.get('message', response.text[:120])}".strip()
    except Exception:  # noqa: BLE001
        return f"HTTP {response.status_code}: {response.text[:120]}"


# ---------------------------------------------------------------- the steps


def wake_space(
    client: httpx.Client, api_base: str, timeout_s: float = SPACE_WAKE_TIMEOUT_S, poll_s: float = SPACE_POLL_S,
    sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
) -> Check:
    """Poll /api/health until the Space reports ok (a sleeping Hugging Face Space needs a request to wake)."""
    started, deadline, last = clock(), clock() + timeout_s, "no answer"
    while True:
        try:
            response = client.get(f"{api_base}/health", timeout=SUPABASE_TIMEOUT_S)
            body = response.json() if response.status_code == 200 else {}
            if body.get("space", {}).get("ok"):
                models = body["space"].get("models", {}).get("l2", [])
                return Check("Space is awake", True, f"version {body['space'].get('version', '?')}, L2 models: {', '.join(models) or 'none'}", clock() - started)
            last = f"Space not ready yet: {body.get('space') or _error_text(response)}"
        except (httpx.HTTPError, ValueError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        if clock() >= deadline:
            return Check("Space is awake", False, f"gave up after {timeout_s:.0f} s; last answer: {last}", clock() - started)
        sleep(poll_s)


def check_supabase(client: httpx.Client, supabase_url: str, anon_key: str) -> Check:
    def run() -> tuple[bool, str]:
        response = client.get(f"{supabase_url}/auth/v1/health", headers={"apikey": anon_key}, timeout=SUPABASE_TIMEOUT_S)
        if response.status_code == 200:
            return True, "auth service answers"
        return False, f"HTTP {response.status_code}: the project may be paused; restore it in the Supabase dashboard"

    check = _timed("Supabase responds", run)
    if not check.ok and "paused" not in check.detail:
        check.detail += " (a paused free-tier project does not answer: check the Supabase dashboard)"
    return check


def sign_in(client: httpx.Client, supabase_url: str, anon_key: str, email: str, password: str) -> tuple[Check, str | None]:
    token: dict[str, str | None] = {"value": None}

    def run() -> tuple[bool, str]:
        response = client.post(
            f"{supabase_url}/auth/v1/token", params={"grant_type": "password"},
            headers={"apikey": anon_key}, json={"email": email, "password": password}, timeout=SUPABASE_TIMEOUT_S,
        )  # fmt: skip
        if response.status_code != 200:
            return False, _error_text(response)
        token["value"] = response.json().get("access_token")
        return bool(token["value"]), f"signed in as {email}" if token["value"] else "no access_token in the answer"

    return _timed("Signed in", run), token["value"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def warm_search(client: httpx.Client, api_base: str, token: str, query: str, sleep: Callable[[float], None] = time.sleep) -> Check:
    def run() -> Check:
        def call() -> tuple[bool, str]:
            response = client.post(f"{api_base}/search", headers=_auth(token), json={"q": query, "filters": {}, "limit": 5}, timeout=REQUEST_TIMEOUT_S)
            if response.status_code != 200:
                return False, _error_text(response)
            return True, f"{len(response.json().get('results', []))} result(s) for \"{query}\""

        return _timed("Search warmed (embedding model loaded)", call)

    return with_retries(run, sleep=sleep)


def warm_question(client: httpx.Client, api_base: str, token: str, question: str, sleep: Callable[[float], None] = time.sleep) -> Check:
    def run() -> Check:
        def call() -> tuple[bool, str]:
            response = client.post(f"{api_base}/ask", headers=_auth(token), json={"question": question, "filters": {}, "wellbore_id": None}, timeout=REQUEST_TIMEOUT_S)
            if response.status_code != 200:
                return False, _error_text(response)
            body = response.json()
            return True, f"{body.get('evidence')}, {len(body.get('citations', []))} citation(s), cached={body.get('cached')}"

        return _timed(f"Question cached: {question}", call)

    return with_retries(run, sleep=sleep)


def drilling_wellbores(client: httpx.Client, supabase_url: str, anon_key: str, token: str) -> list[dict[str, str]]:
    """Primary wellbores of the wells that are being drilled (PostgREST, read with the demo account's RLS)."""
    response = client.get(
        f"{supabase_url}/rest/v1/wells", params={"status": "eq.drilling", "select": "name,wellbores(id,is_primary)"},
        headers={"apikey": anon_key, **_auth(token)}, timeout=SUPABASE_TIMEOUT_S,
    )  # fmt: skip
    response.raise_for_status()
    found = []
    for well in response.json():
        primary = next((w for w in well.get("wellbores", []) if w.get("is_primary")), None) or next(iter(well.get("wellbores", [])), None)
        if primary:
            found.append({"name": well["name"], "wellbore_id": primary["id"]})
    return found


def warm_risk(client: httpx.Client, api_base: str, supabase_url: str, anon_key: str, token: str, sleep: Callable[[float], None] = time.sleep) -> list[Check]:
    try:
        wells = drilling_wellbores(client, supabase_url, anon_key, token)
    except (httpx.HTTPError, ValueError) as exc:
        return [Check("Risk warmed for the drilling wells", False, f"could not list the drilling wells: {exc}")]
    if not wells:
        return [Check("Risk warmed for the drilling wells", False, "no well has status 'drilling'; the demo needs the synthetic drilling wells (DB-09)")]
    checks = []
    for well in wells:
        def run(well=well) -> Check:
            def call() -> tuple[bool, str]:
                response = client.post(f"{api_base}/wells/{well['wellbore_id']}/risk", headers=_auth(token), json={}, timeout=REQUEST_TIMEOUT_S)
                if response.status_code != 200:
                    return False, _error_text(response)
                return True, f"{len(response.json().get('scores', []))} score row(s)"

            return _timed(f"Risk warmed: {well['name']}", call)

        checks.append(with_retries(run, sleep=sleep))
    return checks


def reset_script() -> Path | None:
    name = "reset_demo.ps1" if sys.platform == "win32" else "reset_demo.sh"
    path = REPO_ROOT / "db" / "scripts" / name
    return path if path.exists() else None


def run_reset(env: dict[str, str] | None = None, runner: Callable[..., Any] = subprocess.run) -> Check:
    script = reset_script()
    if script is None:
        return Check("Demo reset", False, "db/scripts/reset_demo.* not found (DB-13 has not delivered it yet)")
    if not (env or os.environ).get("SUPABASE_DB_URL"):
        return Check("Demo reset", False, "SUPABASE_DB_URL is not set")
    command = ["powershell", "-NoProfile", "-File", str(script)] if script.suffix == ".ps1" else ["bash", str(script)]
    started = time.perf_counter()
    try:
        done = runner(command, capture_output=True, text=True, timeout=RESET_TIMEOUT_S, env={**os.environ, **(env or {})}, cwd=REPO_ROOT)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return Check("Demo reset", False, f"{type(exc).__name__}: {exc}", time.perf_counter() - started)
    tail = (done.stdout or done.stderr or "").strip().splitlines()[-3:]
    return Check("Demo reset", done.returncode == 0, " | ".join(tail) or f"exit {done.returncode}", time.perf_counter() - started)


# ---------------------------------------------------------------- the checklist


def use_colour(stream: Any = sys.stdout) -> bool:
    return stream.isatty() and "NO_COLOR" not in os.environ


def render(checks: list[Check], colour: bool) -> str:
    green, red, reset = ("\033[32m", "\033[31m", "\033[0m") if colour else ("", "", "")
    lines = []
    for check in checks:
        mark = f"{green}[ OK ]{reset}" if check.ok else f"{red}[FAIL]{reset}"
        lines.append(f"{mark} {check.name}" + (f"  ({check.seconds:.1f} s)" if check.seconds >= 0.05 else "") + (f"\n         {check.detail}" if check.detail else ""))
    failed = [c for c in checks if not c.ok]
    verdict = f"{green}READY: all {len(checks)} checks passed{reset}" if not failed else f"{red}NOT READY: {len(failed)} of {len(checks)} checks failed{reset}"
    return "\n".join(lines) + "\n\n" + verdict


def required_env(names: list[tuple[str, ...]]) -> tuple[dict[str, str], list[str]]:
    values, missing = {}, []
    for options in names:
        found = next((os.environ[n] for n in options if os.environ.get(n)), None)
        if found is None:
            missing.append(" or ".join(options))
        else:
            values[options[0]] = found
    return values, missing


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--ask", action="append", default=[], metavar="QUESTION", help="ask this scripted question once so its answer is cached (repeatable)")
    parser.add_argument("--query", default=DEFAULT_QUERY, help="the search used to load the embedding model")
    parser.add_argument("--skip-reset", action="store_true", help="do not run db/scripts/reset_demo")
    args = parser.parse_args(argv)

    env, missing = required_env([("API_BASE",), ("SUPABASE_URL",), ("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"), ("TEST_EMAIL",), ("TEST_PASSWORD",)])
    if missing:
        print("missing environment variables: " + ", ".join(missing), file=sys.stderr)
        return 2
    api_base, supabase_url = env["API_BASE"].rstrip("/"), env["SUPABASE_URL"].rstrip("/")
    anon_key = env["SUPABASE_ANON_KEY"]

    checks: list[Check] = []
    with httpx.Client() as client:
        checks.append(wake_space(client, api_base))
        checks.append(check_supabase(client, supabase_url, anon_key))
        signed_in, token = sign_in(client, supabase_url, anon_key, env["TEST_EMAIL"], env["TEST_PASSWORD"])
        checks.append(signed_in)
        if token:
            checks.append(warm_search(client, api_base, token, args.query))
            checks += [warm_question(client, api_base, token, q) for q in args.ask]
            checks += warm_risk(client, api_base, supabase_url, anon_key, token)
        else:
            checks.append(Check("Search, questions and risk warm-up", False, "skipped: not signed in"))
    checks.append(Check("Demo reset", True, "skipped (--skip-reset)") if args.skip_reset else run_reset())

    print(render(checks, use_colour()))
    return 0 if all(c.ok for c in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())

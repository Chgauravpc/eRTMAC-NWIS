"""BE-18: stream replay (DB mocked, fake clock: no real sleeping)."""

import asyncio
import sys
import types
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main
from app.errors import NwisError
from app.risk import fuse, l3
from app.stream import replay
from app.stream.replay import ReplayRegistry, sample_duration_s

WB = str(uuid4())
T0 = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
TOKEN = "test-token"


class FakeClock:
    def __init__(self):
        self.t = T0
        self.sleeps = []

    def now(self):
        return self.t

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.t += timedelta(seconds=seconds)
        await asyncio.sleep(0)

    @property
    def elapsed(self):
        return (self.t - T0).total_seconds()


def samples(n, rop=12.0, start=2000.0, step=0.5, **extra):
    return [{"md_m": start + (i + 1) * step, "t": None, "rop_m_h": rop, **extra} for i in range(n)]


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.exists = True
        self.executed = []

    async def fetch_one(self, sql, params=None):
        assert "from wellbores" in sql
        return {"id": params["id"]} if self.exists else None

    async def fetch_all(self, sql, params=None):
        assert "from depth_series" in sql and "order by md_m" in sql
        return [r for r in self.rows if r["md_m"] > params["start"]]

    async def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def updates(self):
        """stream_state updates published by the replay (not the start upsert or the stop)."""
        return [p for sql, p in self.executed if sql.startswith("update stream_state set status = 'live'")]

    def sql_like(self, fragment):
        return [p for sql, p in self.executed if fragment in sql]


@pytest.fixture
def env(monkeypatch):
    clock = FakeClock()
    registry = ReplayRegistry(clock)
    fake = FakeDb(samples(100))
    hook_calls = []

    async def hook(wellbore_id, bank):
        hook_calls.append((wellbore_id, bank.samples[-1]["md_m"] if bank.samples else None, [r.name for r in bank.latest if r.fired]))

    async def bit_depth(wellbore_id):
        return 2000.0

    monkeypatch.setattr(db, "fetch_one", fake.fetch_one)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    monkeypatch.setattr(db, "execute", fake.execute)
    monkeypatch.setattr(fuse, "bit_depth", bit_depth)
    monkeypatch.setattr(registry, "_risk_hook", hook)
    l3.reset_bank(WB)
    registry.fake, registry.clock_, registry.hook_calls = fake, clock, hook_calls
    yield registry
    l3.reset_bank(WB)


async def run_to_end(registry, **start):
    args = {"source": "synthetic", "speed": 60, "start_md_m": None}
    args.update(start)
    result = await registry.start(WB, **args)
    task = registry.tasks[WB]
    await asyncio.wait_for(task, 10)
    return result


# ---------------------------------------------------------------- pure helpers


def test_sample_duration_uses_rop_then_own_timestamps():
    assert sample_duration_s(None, 2000.0, {"md_m": 2000.5, "rop_m_h": 12.0}) == pytest.approx(150.0)
    a, b = {"md_m": 1.0, "t": T0}, {"md_m": 2.0, "t": T0 + timedelta(seconds=10), "rop_m_h": 12.0}
    assert sample_duration_s(a, 1.0, b) == 10.0  # t differences win
    same = {"md_m": 2.0, "t": T0, "rop_m_h": 12.0}
    assert sample_duration_s(a, 1.0, same) == pytest.approx(300.0)  # no time gap: back to ROP
    assert sample_duration_s(None, 0.0, {"md_m": 0.5, "rop_m_h": 0.0}) == pytest.approx(1800.0)  # ROP floor of 1 m/h
    assert sample_duration_s(None, 0.0, {"md_m": 0.5}) == pytest.approx(1800.0)
    assert sample_duration_s(None, 0.0, {"md_m": 500.0, "rop_m_h": 1.0}) == replay.MAX_SAMPLE_S


def test_latest_channels_drops_nulls_and_the_timestamp():
    assert replay.latest_channels({"md_m": 5.0, "t": T0, "rop_m_h": 12.0, "torque_knm": None}) == {"md_m": 5.0, "rop_m_h": 12.0}


# ---------------------------------------------------------------- the replay


@pytest.mark.asyncio
async def test_start_returns_live_and_upserts_stream_state(env):
    assert await run_to_end(env) == {"status": "live"}
    sql, params = next(e for e in env.fake.executed if "insert into stream_state" in e[0])
    assert "on conflict (wellbore_id)" in sql and params["id"] == WB and params["md"] == 2000.0
    assert params["source"] == "synthetic" and params["speed"] == 60


@pytest.mark.asyncio
async def test_bit_advances_sixty_times_real_rop_at_speed_60(env):
    await run_to_end(env, speed=60)
    # 100 samples x 0.5 m = 50 m in 100 x 150 s / 60 = 250 s real, i.e. 720 m/h = 60 x 12 m/h
    assert env.clock_.elapsed == pytest.approx(250.0)
    assert 50.0 / env.clock_.elapsed * 3600 == pytest.approx(60 * 12.0)
    assert env.fake.updates()[-1]["md"] == 2050.0


@pytest.mark.asyncio
async def test_at_most_four_updates_per_second(env):
    env.fake.rows = samples(400, rop=120.0)  # 15 s simulated each; at speed 600 that is 0.025 s real
    await run_to_end(env, speed=600)
    updates = env.fake.updates()
    assert env.clock_.elapsed == pytest.approx(10.0)
    assert len(updates) <= 4 * env.clock_.elapsed + 1 and len(updates) >= 30  # batched, not one per sample
    assert updates[-1]["md"] == env.fake.rows[-1]["md_m"]  # the last sample always lands


@pytest.mark.asyncio
async def test_update_carries_latest_channels_and_the_publish_time(env):
    env.fake.rows = samples(3, flow_in_lpm=2000.0, pit_vol_m3=None)
    await run_to_end(env)
    last = env.fake.updates()[-1]
    assert last["latest"].obj == {"md_m": 2001.5, "rop_m_h": 12.0, "flow_in_lpm": 2000.0}
    assert last["now"] == env.clock_.t and last["id"] == WB


@pytest.mark.asyncio
async def test_start_depth_defaults_to_the_bit_and_explicit_start_skips_earlier_rows(env):
    await run_to_end(env)
    assert env.fake.sql_like("insert into stream_state")[0]["md"] == 2000.0
    env.fake.executed.clear()
    await run_to_end(env, start_md_m=2040.0)
    assert env.fake.sql_like("insert into stream_state")[0]["md"] == 2040.0
    assert min(u["md"] for u in env.fake.updates()) > 2040.0


@pytest.mark.asyncio
async def test_reaching_td_stops_the_stream_and_clears_the_registry(env):
    await run_to_end(env)
    assert any("status = 'stopped'" in sql for sql, _ in env.fake.executed)
    assert WB not in env.tasks and WB not in env.state


@pytest.mark.asyncio
async def test_drop_stops_updates_until_the_deadline_then_resumes(env):
    await env.start(WB, "synthetic", 60, None)
    result = await env.drop(WB, 45)
    assert result == {"dropping_until": "2026-10-04T10:00:45Z"}
    deadline = T0 + timedelta(seconds=45)
    await asyncio.wait_for(env.tasks[WB], 10)

    stamps = [u["now"] for u in env.fake.updates()]
    assert stamps and all(s >= deadline for s in stamps)  # last_sample_at did not advance during the drop
    assert env.fake.updates()[-1]["md"] == 2050.0  # and it resumed
    kept = len(env.tasks) or 0
    assert kept == 0
    bank = l3.existing_bank(WB)
    assert bank is not None and len(bank.samples) < 100  # the detectors never saw the lost samples


@pytest.mark.asyncio
async def test_stop_cancels_the_task_marks_stopped_and_start_again_restarts(env):
    await env.start(WB, "synthetic", 1, None)
    first = env.tasks[WB]
    assert await env.start(WB, "synthetic", 1, None) == {"status": "live"}  # restart
    await asyncio.sleep(0)
    assert first.cancelled() or first.done()
    second = env.tasks[WB]
    assert second is not first

    assert await env.stop(WB) == {"status": "stopped"}
    assert second.cancelled() and WB not in env.tasks and WB not in env.state
    assert any("status = 'stopped'" in sql for sql, _ in env.fake.executed)
    assert await env.stop(WB) == {"status": "stopped"}  # idempotent


@pytest.mark.asyncio
async def test_restart_starts_with_a_fresh_detector_bank(env):
    await run_to_end(env)
    old = l3.existing_bank(WB)
    assert old is not None and len(old.samples) > 0
    await env.start(WB, "synthetic", 1, None)
    assert l3.existing_bank(WB) is not old
    await env.stop(WB)


@pytest.mark.asyncio
async def test_set_speed_updates_state_and_database_and_needs_a_running_replay(env):
    with pytest.raises(NwisError) as exc:
        await env.set_speed(WB, 10)
    assert exc.value.status_code == 409 and exc.value.code == "NWIS_BAD_STATE"
    await env.start(WB, "synthetic", 1, None)
    assert await env.set_speed(WB, 120) == {"speed": 120}
    assert env.state[WB].speed == 120
    assert env.fake.sql_like("set speed =")[-1] == {"speed": 120, "id": WB}
    with pytest.raises(NwisError):
        await env.drop(str(uuid4()), 5)
    await env.stop(WB)


@pytest.mark.asyncio
async def test_speed_change_mid_run_changes_the_pace(env):
    await env.start(WB, "synthetic", 60, None)
    await asyncio.sleep(0)
    await env.set_speed(WB, 600)
    await asyncio.wait_for(env.tasks[WB], 10)
    assert env.clock_.elapsed < 250.0


@pytest.mark.asyncio
async def test_start_errors_for_no_rows_and_unknown_wellbore(env):
    env.fake.rows = []
    with pytest.raises(NwisError) as exc:
        await env.start(WB, "synthetic", 1, None)
    assert exc.value.status_code == 409
    env.fake.exists = False
    with pytest.raises(NwisError) as exc:
        await env.start(WB, "synthetic", 1, 2000.0)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------- the risk / alert hook


@pytest.mark.asyncio
async def test_risk_hook_runs_at_the_start_and_every_five_metres(env):
    await run_to_end(env)
    mds = [md for _, md, _ in env.hook_calls]
    assert mds[0] == 2000.5
    assert mds == [2000.5 + 5.0 * k for k in range(len(mds))] and len(mds) == 10  # 50 m of depth


@pytest.mark.asyncio
async def test_risk_hook_also_runs_when_a_detector_changes_state(env):
    t = lambda i: T0 + timedelta(seconds=5 * i)  # noqa: E731
    rows = [
        {"md_m": 2000.0 + 0.5 * (i + 1), "t": t(i), "rop_m_h": 12.0, "flow_in_lpm": 2000.0,
         "flow_out_lpm": 2000.0 if i < 30 else 1500.0}
        for i in range(60)
    ]  # fmt: skip
    env.fake.rows = rows
    await run_to_end(env, speed=1)
    firing = [(md, fired) for _, md, fired in env.hook_calls if "losses" in fired]
    assert firing, "the hook must run when losses fire"
    first_md = firing[0][0]
    assert (first_md - 2000.5) % 5.0 != 0  # not one of the regular 5 m calls: it was triggered by the change


class FakeEngine(types.ModuleType):
    def __init__(self):
        super().__init__("app.alerts.engine")
        self.calls = []

    async def evaluate(self, wellbore_id, scores, detector_results):
        self.calls.append((wellbore_id, scores, detector_results))


@pytest.mark.asyncio
async def test_real_hook_computes_scores_then_calls_the_alert_engine(monkeypatch):
    registry = ReplayRegistry(FakeClock())
    scores = [{"risk_type": "losses", "fused": 70.0}]

    async def compute(wellbore_id):
        return scores

    engine = FakeEngine()
    monkeypatch.setattr(fuse, "compute_and_store", compute)
    monkeypatch.setitem(sys.modules, "app.alerts.engine", engine)
    bank = l3.DetectorBank(WB)
    await registry._risk_hook(WB, bank)
    assert engine.calls == [(WB, scores, [])]


@pytest.mark.asyncio
async def test_hook_failures_never_raise(monkeypatch):
    registry = ReplayRegistry(FakeClock())

    async def boom(wellbore_id):
        raise RuntimeError("db down")

    monkeypatch.setattr(fuse, "compute_and_store", boom)
    await registry._risk_hook(WB, l3.DetectorBank(WB))  # risk failure is swallowed

    async def fine(wellbore_id):
        return []

    engine = FakeEngine()

    async def bad_evaluate(*args):
        raise RuntimeError("engine bug")

    engine.evaluate = bad_evaluate
    monkeypatch.setattr(fuse, "compute_and_store", fine)
    monkeypatch.setitem(sys.modules, "app.alerts.engine", engine)
    await registry._risk_hook(WB, l3.DetectorBank(WB))  # engine failure is swallowed


@pytest.mark.asyncio
async def test_missing_alert_engine_is_tolerated(monkeypatch):
    registry = ReplayRegistry(FakeClock())

    async def fine(wellbore_id):
        return []

    monkeypatch.setattr(fuse, "compute_and_store", fine)
    monkeypatch.setitem(sys.modules, "app.alerts.engine", None)  # makes the import raise ImportError
    await registry._risk_hook(WB, l3.DetectorBank(WB))


@pytest.mark.asyncio
async def test_a_failing_replay_does_not_stay_live(env, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("write failed")

    monkeypatch.setattr(env, "_publish", boom)
    await env.start(WB, "synthetic", 60, None)
    task = env.tasks[WB]
    await asyncio.wait_for(task, 10)
    assert any("status = 'stopped'" in sql for sql, _ in env.fake.executed) and WB not in env.tasks


@pytest.mark.asyncio
async def test_startup_reset_stops_every_non_stopped_stream(env):
    await replay.reset_live_streams()
    sql, _ = env.fake.executed[-1]
    assert sql.startswith("update stream_state set status = 'stopped'") and "status <> 'stopped'" in sql


# ---------------------------------------------------------------- routes


@pytest.fixture
def client(env, monkeypatch):
    calls = []

    async def record(name, *args):
        calls.append((name, args))
        return {"ok": name}

    monkeypatch.setattr(replay.registry, "start", lambda *a: record("start", *a))
    monkeypatch.setattr(replay.registry, "stop", lambda *a: record("stop", *a))
    monkeypatch.setattr(replay.registry, "set_speed", lambda *a: record("speed", *a))
    monkeypatch.setattr(replay.registry, "drop", lambda *a: record("drop", *a))
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    test_client = TestClient(app_main.app)
    test_client.calls = calls
    return test_client


def headers(role="rtoc_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


def test_routes_forward_validated_bodies_to_the_registry(client):
    assert client.post("/v1/stream/start", json={"wellbore_id": WB, "source": "volve", "speed": 10, "start_md_m": None}, headers=headers()).json() == {"ok": "start"}
    client.post("/v1/stream/start", json={"wellbore_id": WB, "source": "synthetic"}, headers=headers("admin"))
    client.post("/v1/stream/stop", json={"wellbore_id": WB}, headers=headers())
    client.post("/v1/stream/speed", json={"wellbore_id": WB, "speed": 60}, headers=headers())
    client.post("/v1/stream/drop", json={"wellbore_id": WB, "seconds": 45}, headers=headers())
    assert client.calls == [
        ("start", (WB, "volve", 10, None)), ("start", (WB, "synthetic", 1, None)), ("stop", (WB,)),
        ("speed", (WB, 60)), ("drop", (WB, 45)),
    ]  # fmt: skip


@pytest.mark.parametrize(
    "path,body",
    [("start", {"wellbore_id": "x", "source": "volve"}), ("start", {"wellbore_id": WB, "source": "mars"}),
     ("start", {"wellbore_id": WB, "source": "volve", "speed": 0}), ("start", {"wellbore_id": WB, "source": "volve", "speed": 100000}),
     ("speed", {"wellbore_id": WB, "speed": 0}), ("drop", {"wellbore_id": WB, "seconds": 0}),
     ("drop", {"wellbore_id": WB, "seconds": 10**6}), ("stop", {})],
)  # fmt: skip
def test_routes_reject_bad_bodies_with_400(client, path, body):
    assert client.post(f"/v1/stream/{path}", json=body, headers=headers()).status_code == 400


def test_routes_are_for_rtoc_engineer_and_admin_only(client):
    body = {"wellbore_id": WB}
    for role in ("rig_engineer", "office_engineer", "reviewer", "nobody"):
        assert client.post("/v1/stream/stop", json=body, headers=headers(role)).status_code == 403
    assert client.post("/v1/stream/stop", json=body).status_code == 401
    assert client.post("/v1/stream/stop", json=body, headers=headers("admin")).status_code == 200

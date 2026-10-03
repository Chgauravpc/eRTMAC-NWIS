"""The demo loop on a slow, distant database: found when the replay first ran against the real Supabase project
(one round trip took about 0.5 s, a risk computation 24 s, and the stream went stale and then 'lost' while it waited)."""

import asyncio
import time
from datetime import timedelta

import pytest

from app import db
from app.risk import l1, l2
from tests.test_l1 import FakeDb as L1FakeDb, WELL
from tests.test_replay import WB, env, run_to_end  # noqa: F401  (env is a fixture)
from training import features


@pytest.mark.asyncio
async def test_a_slow_risk_computation_does_not_hold_up_the_stream(env):  # noqa: F811
    """The risk step runs in the background, so the bit keeps moving while it is stuck."""
    gate = asyncio.Event()
    started = []

    async def slow_hook(wellbore_id, bank):
        started.append(bank.samples[-1]["md_m"])
        await gate.wait()

    env._risk_hook = slow_hook
    await env.start(WB, "synthetic", 60, None)
    task = env.tasks[WB]
    for _ in range(500):
        await asyncio.sleep(0)
    assert env.fake.updates()[-1]["md"] == 2050.0  # every sample was published while the first computation was stuck
    assert started == [2000.5]  # no second computation was started on top of it
    assert not task.done()  # at TD the replay still waits for the last scores
    gate.set()
    await asyncio.wait_for(task, 5)
    assert env.fake.sql_like("set status = 'stopped'")


@pytest.mark.asyncio
async def test_replay_keeps_its_speed_when_every_database_write_is_slow(env, monkeypatch):  # noqa: F811
    """At 300x one write per sample (0.5 s each) made the replay run at 150x: publish time now counts as waiting."""
    real_execute = env.fake.execute

    async def slow_execute(sql, params=None):
        await real_execute(sql, params)
        if sql.lstrip().startswith("update stream_state"):
            env.clock_.t += timedelta(seconds=0.5)

    monkeypatch.setattr(db, "execute", slow_execute)
    await run_to_end(env, speed=300)
    # 100 samples x 150 s / 300 = 50 s of replay time; without the compensation this took 100 s
    assert env.clock_.elapsed == pytest.approx(50.0, abs=3.0)
    assert env.fake.updates()[-1]["md"] == 2050.0


def test_two_cells_in_one_50_m_zone_give_one_alert_describing_the_higher_score():
    """The later (deeper) cell used to win, so the alert for zone 3000-3050 said 3025-3050 (score 21) while the cell
    holding the hazard, 3000-3025 (score 35), was never named."""
    from app.alerts import engine
    from tests.test_alert_engine import BIT, WB as ENGINE_WB, row

    cells = [row(BIT + 100, fused=35.0), row(BIT + 125, fused=21.0)]  # one key: floor((BIT + 100) / 50) * 50
    (only,) = engine.build_candidates(ENGINE_WB, BIT, cells, [])
    assert only.zone_md_from_m == BIT + 100 and only.score == 35.0
    (tie,) = engine.build_candidates(ENGINE_WB, BIT, [row(BIT + 100, fused=30.0), row(BIT + 125, fused=30.0)], [])
    assert tie.zone_md_from_m == BIT + 100  # equal scores: the shallower cell, the one the bit reaches first


@pytest.mark.asyncio
async def test_stopping_cancels_a_risk_computation_in_flight(env):  # noqa: F811
    async def never(wellbore_id, bank):
        await asyncio.Event().wait()

    env._risk_hook = never
    await env.start(WB, "synthetic", 60, None)
    for _ in range(20):
        await asyncio.sleep(0)
    risk = env.risk_tasks[WB]
    await env.stop(WB)
    assert risk.cancelled() and WB not in env.risk_tasks


@pytest.mark.asyncio
async def test_l1_scores_runs_its_database_calls_concurrently(monkeypatch):
    """About 40 sequential round trips of 0.5 s each made one computation take 20 s."""
    fake = L1FakeDb(lambda md: [{"formation": "Tipam", "top_md_m": 2000.0, "relative_depth": 0.5, "source": "actual"}])
    in_flight, peak = 0, 0

    async def slow_call_fn(name, **params):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        try:
            await asyncio.sleep(0.01)
            return await fake.call_fn(name, **params)
        finally:
            in_flight -= 1

    monkeypatch.setattr(db, "call_fn", slow_call_fn)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    results = await l1.l1_scores(WELL, 2000.0)
    assert peak >= 8
    assert [r.md_from_m for r in results[::5]] == [2000.0 + 25.0 * k for k in range(12)]  # still in depth order


@pytest.mark.asyncio
async def test_offset_pool_is_loaded_once_for_concurrent_callers_and_refreshed_in_the_background(monkeypatch):
    loads = []

    async def load_wells():
        loads.append(1)
        await asyncio.sleep(0.01)
        return [f"wells-v{len(loads)}"], {"Tipam": 1}

    monkeypatch.setattr(features, "load_wells", load_wells)
    monkeypatch.setattr(l2, "_pool", None)
    monkeypatch.setattr(l2, "_pool_task", None)

    first, second = await asyncio.gather(l2._offset_pool(), l2._offset_pool())
    assert len(loads) == 1 and first == second == (["wells-v1"], {"Tipam": 1})

    # past its time to live: the old copy is served at once and a refresh runs behind it
    monkeypatch.setattr(l2, "_pool", (time.monotonic() - l2.POOL_TTL_S - 1, ["wells-v1"], {"Tipam": 1}))
    stale = await l2._offset_pool()
    assert stale[0] == ["wells-v1"]
    await l2._pool_task
    assert len(loads) == 2
    assert (await l2._offset_pool())[0] == ["wells-v2"] and len(loads) == 2

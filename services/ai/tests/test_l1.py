"""BE-14: risk config and layer L1 (offset look-ahead). Pure maths plus a mocked DB."""

import math
import time
from uuid import uuid4

import pytest

from app import db
from app.risk import config, l1
from app.risk.l1 import compute_l1

INTERVAL = {
    "md_from_m": 2087.5, "md_to_m": 2112.5, "md_mid_m": 2100.0, "formation": "Tipam",
    "relative_depth": 0.5, "top_md_m": 2000.0,
}  # fmt: skip


def offset(distance=0.0, drilled=True, top=2300.0, name="SYN-DLJ-05"):
    return {"wellbore_id": str(uuid4()), "well_name": name, "depth_distance_m": distance, "drilled": drilled, "top_md_m": top}


def event(off, risk="losses", rel=0.5, status="approved", conf=0.9, formation="Tipam", md=2400.0):
    return {
        "wellbore_id": off["wellbore_id"], "id": uuid4(), "risk_type": risk, "formation": formation,
        "relative_depth": rel, "md_from_m": md, "review_status": status, "confidence": conf,
    }  # fmt: skip


def get(results, risk="losses"):
    return next(r for r in results if r.risk_type == risk)


# ---------------------------------------------------------------- config


def test_config_has_the_contract_values():
    assert (config.W_L1, config.W_L2, config.W_L3) == (0.5, 0.3, 0.2)
    assert (config.STREAM_STALE_S, config.STREAM_LOST_S) == (10, 30)
    assert (config.ESCALATE_CRITICAL_S, config.ESCALATE_WARNING_S) == (300, 900)
    assert config.RETRIGGER_HYSTERESIS == 15 and config.ENGINE_TICK_S == 5
    assert config.LOOKAHEAD_INTERVALS == 12 and config.INTERVAL_M == 25 and config.RADIUS_M == 10000
    assert (config.LOSSES_FLOOR, config.TOTAL_LOSSES_FLOOR, config.KICK_FLOOR) == (65, 85, 85)
    assert abs(config.W_L1 + config.W_L2 + config.W_L3 - 1.0) < 1e-12


def test_all_five_risk_types_are_scored():
    assert set(l1.RISK_TYPES) == {"losses", "stuck_pipe", "kick", "torque", "cementing"}


# ---------------------------------------------------------------- compute_l1


def test_no_offsets_means_unknown_not_0_5():
    results = compute_l1(INTERVAL, [], [])
    assert len(results) == 5 and all(r.l1 is None and r.n_offsets == 0 for r in results)


def test_offsets_that_did_not_drill_the_formation_do_not_count():
    off = offset(drilled=False)
    results = compute_l1(INTERVAL, [off], [event(off)])
    assert all(r.l1 is None and r.n_offsets == 0 for r in results)


def test_offset_without_depth_distance_is_ignored():
    off = offset()
    off["depth_distance_m"] = None
    assert get(compute_l1(INTERVAL, [off], [])).l1 is None


def test_prior_only_and_a_single_hit():
    off = offset(0.0)
    assert get(compute_l1(INTERVAL, [off], [])).l1 == pytest.approx(0.5 / 2.0)
    assert get(compute_l1(INTERVAL, [off], [event(off)])).l1 == pytest.approx(1.5 / 2.0)


def test_nearer_offsets_count_more_than_farther_ones():
    near, far = offset(500), offset(6000)
    hit_near = get(compute_l1(INTERVAL, [near, far], [event(near)])).l1
    hit_far = get(compute_l1(INTERVAL, [near, far], [event(far)])).l1
    w_near, w_far = math.exp(-500 / 3000), math.exp(-6000 / 3000)
    assert hit_near == pytest.approx((w_near + 0.5) / (w_near + w_far + 1))
    assert hit_far == pytest.approx((w_far + 0.5) / (w_near + w_far + 1))
    assert hit_near > hit_far


def test_more_nearby_hits_give_a_higher_score():
    offs = [offset(800) for _ in range(4)]
    scores = [get(compute_l1(INTERVAL, offs, [event(o) for o in offs[:n]])).l1 for n in range(5)]
    assert scores == sorted(scores) and len(set(scores)) == 5


def test_unreviewed_events_count_half():
    off = offset(0.0)
    pending = get(compute_l1(INTERVAL, [off], [event(off, status="pending")])).l1
    assert pending == pytest.approx((0.5 + 0.5) / 2.0)
    for status in ("approved", "edited", "auto_approved"):
        assert get(compute_l1(INTERVAL, [off], [event(off, status=status)])).l1 == pytest.approx(0.75)
    both = [event(off, status="pending"), event(off, status="approved")]
    assert get(compute_l1(INTERVAL, [off], both)).l1 == pytest.approx(0.75)  # an offset counts once, at its best


def test_rejected_events_are_ignored():
    off = offset(0.0)
    assert get(compute_l1(INTERVAL, [off], [event(off, status="rejected")])).l1 == pytest.approx(0.25)


def test_events_of_other_formations_risk_types_and_unlisted_wells_do_not_hit():
    off, stranger = offset(0.0), offset(0.0)
    events = [event(off, formation="Barail"), event(off, risk="kick"), event(stranger, risk="losses")]
    losses = get(compute_l1(INTERVAL, [off], events), "losses")
    assert losses.l1 == pytest.approx(0.25) and losses.reasons == []
    assert get(compute_l1(INTERVAL, [off], events), "kick").l1 == pytest.approx(0.75)


@pytest.mark.parametrize("rel,hit", [(0.5, True), (0.6, True), (0.4, True), (0.65, False), (0.2, False)])
def test_hit_needs_relative_depth_within_0_10(rel, hit):
    off = offset(0.0)
    expected = 0.75 if hit else 0.25
    assert get(compute_l1(INTERVAL, [off], [event(off, rel=rel)])).l1 == pytest.approx(expected)


def test_tolerance_edge_survives_floating_point():
    off = offset(0.0)
    interval = {**INTERVAL, "relative_depth": 0.7}
    assert get(compute_l1(interval, [off], [event(off, rel=0.8)])).l1 == pytest.approx(0.75)  # 0.8 - 0.7 > 0.1 in floats


def test_unknown_relative_depth_falls_back_to_md_equivalent_within_25_m():
    off = offset(0.0, top=2300.0)  # the interval is 100 m below the top, so 2400 m MD in this offset
    interval = {**INTERVAL, "relative_depth": None}
    assert get(compute_l1(interval, [off], [event(off, rel=None, md=2420.0)])).l1 == pytest.approx(0.75)
    assert get(compute_l1(interval, [off], [event(off, rel=None, md=2430.0)])).l1 == pytest.approx(0.25)
    assert get(compute_l1(INTERVAL, [off], [event(off, rel=None, md=2410.0)])).l1 == pytest.approx(0.75)  # event side unknown
    no_top = {**interval, "top_md_m": None}
    assert get(compute_l1(no_top, [off], [event(off, rel=None, md=2400.0)])).l1 == pytest.approx(0.25)


def test_mean_event_confidence_and_reasons_are_the_hits_by_weight():
    near, far = offset(200, name="NEAR"), offset(4000, name="FAR")
    events = [event(near, conf=0.9), event(far, conf=0.5), event(near, rel=0.9)]  # third is not a hit
    result = get(compute_l1(INTERVAL, [near, far], events))
    assert result.mean_event_conf == pytest.approx(0.7) and result.n_offsets == 2
    assert [r["well_name"] for r in result.reasons] == ["NEAR", "FAR"]
    assert result.reasons[0] == {
        "kind": "offset_event", "event_id": str(events[0]["id"]), "well_name": "NEAR", "depth_distance_m": 200,
    }  # fmt: skip
    assert get(compute_l1(INTERVAL, [near], []), "losses").mean_event_conf is None


def test_reasons_keep_only_the_top_five():
    offs = [offset(100 * (i + 1)) for i in range(7)]
    result = get(compute_l1(INTERVAL, offs, [event(o) for o in offs]))
    assert len(result.reasons) == 5
    assert [r["depth_distance_m"] for r in result.reasons] == [100, 200, 300, 400, 500]


def test_interval_bounds_and_formation_are_carried_through():
    result = get(compute_l1(INTERVAL, [offset()], []))
    assert (result.md_from_m, result.md_to_m, result.formation) == (2087.5, 2112.5, "Tipam")


def test_12_intervals_by_5_risk_types_with_many_offsets_is_fast():
    offs = [offset(500 * (i + 1)) for i in range(12)]
    events = [event(o, risk=r) for o in offs for r in l1.RISK_TYPES for _ in range(3)]
    started = time.perf_counter()
    for _ in range(12):
        compute_l1(INTERVAL, offs, events)
    assert time.perf_counter() - started < 1.0


# ---------------------------------------------------------------- l1_scores with a mocked database

WELL = str(uuid4())


class FakeDb:
    def __init__(self, formation_by_md):
        self.formation_by_md = formation_by_md
        self.near, self.quiet = str(uuid4()), str(uuid4())  # `quiet` drilled the formation but has no events
        self.calls = []

    async def call_fn(self, name, **params):
        self.calls.append(name)
        if name == "formation_at_md":
            return self.formation_by_md(params["p_md"])
        if name == "offsets_within":
            assert params["p_mode"] == "depth" and params["p_radius_m"] == 10000.0
            return [
                {"wellbore_id": self.near, "well_name": "NEAR", "depth_distance_m": 0.0},
                {"wellbore_id": self.quiet, "well_name": "QUIET", "depth_distance_m": 0.0},
            ]
        if name == "events_for_offsets":
            assert params["p_formations"] == [params["p_formations"][0]] and params["p_radius_m"] == 10000.0
            return [
                {"wellbore_id": self.near, "id": uuid4(), "risk_type": "losses", "formation": params["p_formations"][0],
                 "relative_depth": 0.5, "md_from_m": 2400.0, "review_status": "approved", "confidence": 0.9}
            ]  # fmt: skip
        raise AssertionError(name)

    async def fetch_all(self, sql, params=None):
        assert "source = 'actual'" in sql
        return [{"wellbore_id": wb, "top_md_m": 2300.0} for wb in params["ids"]]


@pytest.mark.asyncio
async def test_l1_scores_covers_12_intervals_and_counts_offsets_without_events(monkeypatch):
    fake = FakeDb(lambda md: [{"formation": "Tipam", "top_md_m": 2000.0, "relative_depth": 0.5, "source": "actual"}])
    monkeypatch.setattr(db, "call_fn", fake.call_fn)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)

    results = await l1.l1_scores(WELL, 2000.0)

    assert len(results) == 12 * 5
    first = [r for r in results if r.md_from_m == 2000.0]
    assert len(first) == 5 and {r.risk_type for r in first} == set(l1.RISK_TYPES)
    last = max(results, key=lambda r: r.md_to_m)
    assert last.md_to_m == 2300.0
    losses = next(r for r in first if r.risk_type == "losses")
    assert losses.n_offsets == 2  # the quiet offset drilled the formation, so it must count
    assert losses.l1 == pytest.approx((1.0 * 1 + 0.5) / (2.0 + 1.0))
    assert next(r for r in first if r.risk_type == "kick").l1 == pytest.approx(0.5 / 3.0)
    assert fake.calls.count("events_for_offsets") == 1  # events are fetched once per formation


@pytest.mark.asyncio
async def test_l1_scores_unknown_formation_gives_unknown_scores_without_offset_queries(monkeypatch):
    fake = FakeDb(lambda md: [])
    monkeypatch.setattr(db, "call_fn", fake.call_fn)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    results = await l1.l1_scores(WELL, 500.0)
    assert len(results) == 60 and all(r.l1 is None and r.formation is None for r in results)
    assert "offsets_within" not in fake.calls


@pytest.mark.asyncio
async def test_l1_scores_changes_formation_part_way_through(monkeypatch):
    def formation(md):
        name = "Tipam" if md < 2150 else "Barail"
        return [{"formation": name, "top_md_m": 2000.0 if name == "Tipam" else 2150.0, "relative_depth": 0.5}]

    fake = FakeDb(formation)
    monkeypatch.setattr(db, "call_fn", fake.call_fn)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    results = await l1.l1_scores(WELL, 2000.0)
    assert {r.formation for r in results} == {"Tipam", "Barail"}
    assert fake.calls.count("events_for_offsets") == 2
    barail = next(r for r in results if r.formation == "Barail" and r.risk_type == "losses")
    assert barail.l1 == pytest.approx(1.5 / 3.0)  # the same fake event is returned for any formation

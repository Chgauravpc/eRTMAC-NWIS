"""BE-19: alert engine (evaluate + tick), templates and recommendation. In-memory store, fake time, no DB/LLM."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg.errors
import pytest

from app import db
from app.alerts import engine, recommend, templates
from app.llm.client import LlmMeta
from app.risk import config
from app.risk.l3 import DetectorResult

WB = str(uuid4())
OTHER_WB = str(uuid4())
NOW = datetime(2026, 10, 4, 12, 0, 0, tzinfo=timezone.utc)
BIT = 2400.0


def at(seconds):
    return NOW + timedelta(seconds=seconds)


# ---------------------------------------------------------------- in-memory store


class Store:
    CLOSED = ("resolved", "feedback")

    def __init__(self):
        self.alerts: list[dict] = []
        self.audit: list[tuple] = []
        self.streams: list[dict] = []
        self.bit = BIT
        self.zone_fused: dict = {}
        self.events: list[dict] = []
        self.stream_status_updates: list[tuple] = []

    # --- functions the engine calls
    async def bit_md(self, wellbore_id):
        return self.bit

    async def latest_alert(self, key):
        found = [a for a in self.alerts if a["dedup_key"] == key]
        return dict(found[-1]) if found else None

    async def insert_alert(self, fields):
        if any(a["dedup_key"] == fields["dedup_key"] and a["state"] not in self.CLOSED for a in self.alerts):
            raise psycopg.errors.UniqueViolation("alerts_one_open_per_key")
        alert = {**fields, "id": str(uuid4()), "state": "generated", "created_at": NOW, "sent_at": None}
        self.alerts.append(alert)
        return alert["id"]

    async def update_alert(self, alert_id, **fields):
        next(a for a in self.alerts if a["id"] == alert_id).update(fields)

    async def audit_(self, action, alert_id, details):
        self.audit.append((f"alert.system.{action}", alert_id, details))

    async def event_details(self, ids):
        return [e for e in self.events if str(e["id"]) in ids]

    async def zone_max_fused(self, wellbore_id, risk_type, md_from, md_to):
        return self.zone_fused.get((wellbore_id, risk_type))

    async def stream_rows(self):
        return self.streams

    async def set_stream_status(self, wellbore_id, status):
        self.stream_status_updates.append((wellbore_id, status))

    async def open_alerts(self, kinds, states):
        return [dict(a) for a in self.alerts if a["kind"] in kinds and a["state"] in states]

    # --- helpers
    def open(self):
        return [a for a in self.alerts if a["state"] not in self.CLOSED]

    def actions(self):
        return [a for a, _, _ in self.audit]


@pytest.fixture
def store(monkeypatch):
    s = Store()
    for name, attr in [("_bit_md", "bit_md"), ("_latest_alert", "latest_alert"), ("_insert_alert", "insert_alert"),
                       ("_update_alert", "update_alert"), ("_audit", "audit_"), ("_event_details", "event_details"),
                       ("_zone_max_fused", "zone_max_fused"), ("_stream_rows", "stream_rows"),
                       ("_set_stream_status", "set_stream_status"), ("_open_alerts", "open_alerts")]:  # fmt: skip
        monkeypatch.setattr(engine, name, getattr(s, attr))

    async def fake_recommend(formation, risk_type):
        return f"Offsets report: LCM pill for {formation}.", [
            {"id": "l1", "title": "LCM pills", "mitigation": "Pump an LCM pill", "success_rate": 0.8}
        ]

    monkeypatch.setattr(engine.recommend_module, "recommend", fake_recommend)
    return s


def row(md_from=BIT + 100, risk="losses", fused=50.0, confidence="high", formation="Tipam", reasons=None, **over):
    base = {
        "wellbore_id": WB, "md_from_m": md_from, "md_to_m": md_from + 25, "risk_type": risk, "l1": 0.5, "l2": None,
        "l3": None, "fused": fused, "band": "elevated", "confidence": confidence, "confidence_reason": "x",
        "reasons": reasons or [], "formation": formation, "model_version": None,
    }  # fmt: skip
    base.update(over)
    return base


def detector(name="losses", risk="losses", floor=65, fired=True, signal=None):
    return DetectorResult(name, risk, fired, signal or {"flow_ratio": 0.8}, 1.0 if fired else 0.1, floor)


# ---------------------------------------------------------------- candidates and keys


def test_dedup_key_uses_the_50_m_zone_start():
    assert engine.dedup_key(WB, "losses", 2549.9) == f"{WB}:losses:2500"
    assert engine.dedup_key(WB, "kick", 2550.0) == f"{WB}:kick:2550"
    assert engine.system_key(WB, "stream_lost") == f"{WB}:system:stream_lost"


def test_only_lookahead_intervals_at_band_moderate_or_above_become_candidates():
    scores = [
        row(BIT + 49.9, fused=60), row(BIT + 50, fused=60), row(BIT + 300, fused=60), row(BIT + 300.1, fused=60),
        row(BIT + 100, fused=20, risk="kick"), row(BIT + 100, fused=20.01, risk="torque"),
    ]  # fmt: skip
    got = engine.build_candidates(WB, BIT, scores, [])
    assert sorted((c.zone_md_from_m, c.risk_type) for c in got) == [(BIT + 50, "losses"), (BIT + 100, "torque"), (BIT + 300, "losses")]


def test_severity_follows_the_band_and_low_confidence_caps_at_watch():
    cands = engine.build_candidates(WB, BIT, [row(fused=85, confidence="high"), row(BIT + 200, fused=85, confidence="low")], [])
    assert {c.zone_md_from_m: c.severity for c in cands} == {BIT + 100: "critical", BIT + 200: "watch"}
    info = engine.build_candidates(WB, BIT, [row(fused=30, confidence="low")], [])[0]
    assert info.severity == "info"  # the cap never raises a severity


def test_a_fired_detector_is_never_capped_and_uses_its_floor():
    at_bit = row(md_from=BIT - 10, fused=30, confidence="low")
    cands = engine.build_candidates(WB, BIT, [at_bit], [detector(floor=65)])
    c = cands[0]
    assert c.kind == "detector" and c.fired and c.severity == "warning" and c.score == 65
    assert (c.zone_md_from_m, c.zone_md_to_m, c.expected_md_m) == (BIT - 25, BIT + 25, BIT)
    assert c.detector["name"] == "losses"
    crit = engine.build_candidates(WB, BIT, [], [detector("total_losses", "losses", 85)])[0]
    assert crit.severity == "critical" and crit.confidence is None


def test_unfired_detectors_make_no_candidate_and_the_highest_floor_wins_per_risk_type():
    assert engine.build_candidates(WB, BIT, [], [detector(fired=False)]) == []
    two = engine.build_candidates(WB, BIT, [], [detector("losses", floor=65), detector("total_losses", floor=85)])
    assert len(two) == 1 and two[0].detector["name"] == "total_losses"


def test_detector_and_lookahead_candidates_never_share_a_dedup_key():
    cands = engine.build_candidates(WB, BIT, [row(md_from=BIT + 50, fused=50)], [detector()])
    assert len({c.dedup_key for c in cands}) == 2 and {c.kind for c in cands} == {"lookahead", "detector"}


# ---------------------------------------------------------------- evaluate: create, dedup, re-notify


@pytest.mark.asyncio
async def test_new_alert_is_generated_then_sent_with_content_and_audit(store):
    actions = await engine.evaluate(WB, [row(fused=50)], [], now=NOW)
    assert [a["action"] for a in actions] == ["created"]
    (alert,) = store.alerts
    assert alert["state"] == "sent" and alert["sent_at"] == NOW and alert["kind"] == "lookahead"
    assert alert["severity"] == "watch" and alert["score"] == 50.0 and alert["dedup_key"] == f"{WB}:losses:2500"
    assert alert["title"] == "Mud loss risk ~100 m ahead (Tipam)"
    assert alert["recommendation"] == "Offsets report: LCM pill for Tipam."
    assert alert["zone_md_from_m"] == BIT + 100 and alert["zone_md_to_m"] == BIT + 125 and alert["expected_md_m"] == BIT + 112.5
    assert alert["evidence"]["lessons"][0]["id"] == "l1" and set(alert["evidence"]) >= {"offsets", "lessons", "shap", "layers", "sources"}
    assert store.actions() == ["alert.system.generated", "alert.system.sent"]


@pytest.mark.asyncio
async def test_no_bit_depth_means_no_alerts(store):
    store.bit = None
    assert await engine.evaluate(WB, [row()], [], now=NOW) == []
    assert store.alerts == []


@pytest.mark.asyncio
async def test_same_scores_twice_gives_one_open_alert_updated_quietly(store):
    await engine.evaluate(WB, [row(fused=50)], [], now=NOW)
    sent_at = store.alerts[0]["sent_at"]
    actions = await engine.evaluate(WB, [row(fused=55)], [], now=at(60))
    assert [a["action"] for a in actions] == ["updated"] and len(store.alerts) == 1
    assert store.alerts[0]["score"] == 55.0 and store.alerts[0]["sent_at"] == sent_at  # no re-notification
    assert store.actions() == ["alert.system.generated", "alert.system.sent"]
    assert store.alerts[0]["evidence"]["lessons"][0]["id"] == "l1"  # lessons kept without a new LLM call


@pytest.mark.asyncio
async def test_a_higher_severity_renotifies_even_after_acknowledgement(store):
    await engine.evaluate(WB, [row(fused=50)], [], now=NOW)
    store.alerts[0]["state"] = "acknowledged"
    actions = await engine.evaluate(WB, [row(fused=70)], [], now=at(120))
    assert [a["action"] for a in actions] == ["renotified"]
    alert = store.alerts[0]
    assert alert["severity"] == "warning" and alert["state"] == "sent" and alert["sent_at"] == at(120) and alert["score"] == 70.0
    assert store.actions()[-1] == "alert.system.renotified" and len(store.alerts) == 1


@pytest.mark.asyncio
async def test_a_lower_severity_does_not_downgrade_or_renotify(store):
    await engine.evaluate(WB, [row(fused=70)], [], now=NOW)
    actions = await engine.evaluate(WB, [row(fused=45)], [], now=at(60))
    assert actions[0]["action"] == "updated" and store.alerts[0]["severity"] == "warning"


@pytest.mark.asyncio
async def test_low_confidence_alert_is_capped_at_watch_but_keeps_its_score(store):
    await engine.evaluate(WB, [row(fused=85, confidence="low")], [], now=NOW)
    assert store.alerts[0]["severity"] == "watch" and store.alerts[0]["score"] == 85.0


@pytest.mark.asyncio
async def test_detector_alert_is_created_at_the_bit_with_detector_evidence(store):
    await engine.evaluate(WB, [], [detector("kick", "kick", 85, signal={"pit_gain_m3": 2.4})], now=NOW)
    (alert,) = store.alerts
    assert alert["kind"] == "detector" and alert["severity"] == "critical" and alert["risk_type"] == "kick"
    assert alert["zone_md_from_m"] == BIT - 25 and alert["title"] == "Kick / overpressure signature at the bit"
    assert alert["evidence"]["detector"] == {"name": "kick", "signal": {"pit_gain_m3": 2.4}}
    assert "kick detector fired" in alert["message"] and "pit gain m3 2.4" in alert["message"]


@pytest.mark.asyncio
async def test_concurrent_creation_is_suppressed_not_duplicated(store, monkeypatch):
    await engine.evaluate(WB, [row()], [], now=NOW)
    original = store.latest_alert
    calls = {"n": 0}

    async def stale_view(key):  # the second evaluator did not yet see the first one's alert
        calls["n"] += 1
        return None

    monkeypatch.setattr(engine, "_latest_alert", stale_view)
    actions = await engine.evaluate(WB, [row()], [], now=at(1))
    assert actions[0]["action"] == "suppressed" and len(store.alerts) == 1
    monkeypatch.setattr(engine, "_latest_alert", original)


# ---------------------------------------------------------------- evaluate: re-trigger after resolve


def resolve(store, score):
    alert = store.alerts[0]
    alert.update(state="resolved", resolved_how="manual", score=score)


@pytest.mark.asyncio
async def test_retrigger_needs_a_higher_band_a_detector_or_the_hysteresis(store):
    await engine.evaluate(WB, [row(fused=30)], [], now=NOW)  # moderate
    resolve(store, 30.0)

    same = await engine.evaluate(WB, [row(fused=30)], [], now=at(10))
    assert same[0]["action"] == "suppressed" and len(store.alerts) == 1
    just_below = await engine.evaluate(WB, [row(fused=34.9)], [], now=at(20))  # 20 + 15 = 35 needed
    assert just_below[0]["action"] == "suppressed"
    hysteresis = await engine.evaluate(WB, [row(fused=35)], [], now=at(30))
    assert hysteresis[0]["action"] == "created" and len(store.alerts) == 2


@pytest.mark.asyncio
async def test_retrigger_when_the_band_rises(store):
    await engine.evaluate(WB, [row(fused=30)], [], now=NOW)
    resolve(store, 30.0)
    result = await engine.evaluate(WB, [row(fused=41)], [], now=at(5))  # elevated > moderate
    assert result[0]["action"] == "created"


@pytest.mark.asyncio
async def test_retrigger_when_a_detector_fires_even_at_the_same_band(store):
    await engine.evaluate(WB, [], [detector(floor=65)], now=NOW)
    resolve(store, 65.0)
    result = await engine.evaluate(WB, [], [detector(floor=65)], now=at(5))
    assert result[0]["action"] == "created" and len(store.alerts) == 2


@pytest.mark.asyncio
async def test_a_resolved_alert_does_not_block_a_different_zone(store):
    await engine.evaluate(WB, [row(fused=30)], [], now=NOW)
    resolve(store, 30.0)
    result = await engine.evaluate(WB, [row(md_from=BIT + 200, fused=30)], [], now=at(5))
    assert result[0]["action"] == "created"


def test_should_retrigger_pure():
    resolved = {"score": 45.0}  # elevated, threshold 40
    low = engine.build_candidates(WB, BIT, [row(fused=50)], [])[0]
    assert not engine.should_retrigger(resolved, low)  # same band, 50 < 55
    assert engine.should_retrigger(resolved, engine.build_candidates(WB, BIT, [row(fused=55)], [])[0])
    assert engine.should_retrigger(resolved, engine.build_candidates(WB, BIT, [row(fused=61)], [])[0])  # band rose


# ---------------------------------------------------------------- content from evidence


EVENTS = [
    {"id": uuid4(), "wellbore_id": uuid4(), "event_type": "stuck_pipe_diff", "md_from_m": 2860.0, "npt_h": 18.0,
     "doc_id": uuid4(), "page": 37, "doc_title": "DDR SYN-DLJ-05"},
    {"id": uuid4(), "wellbore_id": uuid4(), "event_type": "tight_hole", "md_from_m": 2870.0, "npt_h": 6.0,
     "doc_id": uuid4(), "page": 4, "doc_title": "DDR SYN-DLJ-02"},
]  # fmt: skip


@pytest.mark.asyncio
async def test_message_and_evidence_are_built_from_the_offset_events(store):
    store.events = EVENTS
    reasons = [
        {"kind": "offset_event", "event_id": str(EVENTS[0]["id"]), "well_name": "SYN-DLJ-05", "depth_distance_m": 1850.0},
        {"kind": "offset_event", "event_id": str(EVENTS[1]["id"]), "well_name": "SYN-DLJ-02", "depth_distance_m": 900.0},
        {"kind": "shap", "feature": "torque_trend_30m", "value": 0.12},
    ]  # fmt: skip
    await engine.evaluate(WB, [row(risk="stuck_pipe", formation="Barail", fused=70, reasons=reasons, l1=0.62, l2=0.55)], [], now=NOW)
    alert = store.alerts[0]
    assert alert["message"] == "2 offset wells within 1.9 km had tight hole or stuck pipe diff in Barail; average NPT 12 h."
    ev = alert["evidence"]
    assert [o["well_name"] for o in ev["offsets"]] == ["SYN-DLJ-02", "SYN-DLJ-05"]  # nearest first
    assert ev["offsets"][1]["events"][0] == {
        "id": str(EVENTS[0]["id"]), "event_type": "stuck_pipe_diff", "md_from_m": 2860.0, "npt_h": 18.0,
        "doc_id": str(EVENTS[0]["doc_id"]), "page": 37,
    }  # fmt: skip
    assert ev["shap"] == [{"feature": "torque_trend_30m", "value": 0.12}]
    assert ev["layers"] == {"l1": 0.62, "l2": 0.55, "l3": None}
    assert {s["doc_title"] for s in ev["sources"]} == {"DDR SYN-DLJ-05", "DDR SYN-DLJ-02"}
    assert "detector" not in ev


def test_templates_title_message_and_thresholds():
    assert templates.title("stuck_pipe", "Barail", "lookahead", 121.0) == "Stuck pipe risk ~120 m ahead (Barail)"
    assert templates.title("losses", None, "lookahead", 3.0) == "Mud loss risk ~5 m ahead"
    assert templates.title("torque", "Tipam", "detector", 0.0) == "Torque spike signature at the bit (Tipam)"
    assert templates.message("lookahead", "losses", "Tipam", 52.4, {"offsets": []}) == "Mud loss risk scored 52 of 100 in Tipam."
    one = {"offsets": [{"depth_distance_m": 500.0, "events": [{"event_type": "kick", "npt_h": None}]}]}
    assert templates.message("lookahead", "kick", None, 60, one) == "1 offset well within 0.5 km had kick here."
    assert [templates.band_threshold(s) for s in ("info", "watch", "warning", "critical")] == [20, 40, 60, 80]
    assert templates.risk_label("weird_type") == "Weird type"


# ---------------------------------------------------------------- tick: stream health


def stream(status="live", last_sample_s=0.0, bit=BIT, wb=WB):
    return {"wellbore_id": wb, "status": status, "bit_md_m": bit, "last_sample_at": NOW - timedelta(seconds=last_sample_s)}


@pytest.mark.asyncio
async def test_stream_goes_stale_then_lost_and_a_system_alert_is_raised_once(store):
    store.streams = [stream("live", 10.0)]
    assert not await engine.engine_tick(NOW)  # exactly 10 s is still live
    assert store.stream_status_updates == []

    store.streams = [stream("live", 10.5)]
    assert (await engine.engine_tick(NOW))["stream_stale"] == 1 and store.stream_status_updates == [(WB, "stale")]

    store.streams = [stream("stale", 30.0)]
    await engine.engine_tick(NOW)
    assert store.alerts == []  # exactly 30 s is stale, not lost

    store.streams = [stream("stale", 31.0)]
    stats = await engine.engine_tick(NOW)
    assert stats["stream_lost"] == 1 and store.stream_status_updates[-1] == (WB, "lost")
    (alert,) = store.alerts
    assert alert["kind"] == "system" and alert["severity"] == "warning" and alert["title"] == "Live data lost"
    assert alert["dedup_key"] == f"{WB}:system:stream_lost" and alert["risk_type"] is None and alert["state"] == "sent"
    assert "alert.system.generated" in store.actions()

    store.streams = [stream("lost", 60.0)]
    await engine.engine_tick(NOW)
    assert len(store.alerts) == 1  # no second system alert while one is open


@pytest.mark.asyncio
async def test_recovery_sets_live_and_auto_resolves_the_system_alert(store):
    store.streams = [stream("lost", 40.0)]
    await engine.engine_tick(NOW)
    store.streams = [stream("lost", 2.0)]
    stats = await engine.engine_tick(NOW)
    assert store.stream_status_updates[-1] == (WB, "live") and stats["stream_recovered"] == 1
    alert = store.alerts[0]
    assert alert["state"] == "resolved" and alert["resolved_how"] == "auto" and alert["outcome"] == "unknown"
    assert alert["resolved_at"] == NOW and "alert.system.auto_resolved" in store.actions()


@pytest.mark.asyncio
async def test_recovery_is_noticed_even_when_the_replay_already_set_the_status_live(store):
    store.streams = [stream("lost", 40.0)]
    await engine.engine_tick(NOW)
    store.streams = [stream("live", 1.0)]  # the replay wrote 'live' itself
    await engine.engine_tick(NOW)
    assert store.alerts[0]["state"] == "resolved"


@pytest.mark.asyncio
async def test_a_new_loss_of_data_after_recovery_raises_a_new_system_alert(store):
    store.streams = [stream("lost", 40.0)]
    await engine.engine_tick(NOW)
    store.streams = [stream("live", 1.0)]
    await engine.engine_tick(NOW)
    store.streams = [stream("live", 45.0)]
    await engine.engine_tick(NOW)
    assert [a["state"] for a in store.alerts] == ["resolved", "sent"]


@pytest.mark.asyncio
async def test_stopped_streams_and_streams_without_samples_are_ignored(store):
    store.streams = [stream("stopped", 500.0), {"wellbore_id": OTHER_WB, "status": "live", "bit_md_m": 1.0, "last_sample_at": None}]
    assert not await engine.engine_tick(NOW)
    assert store.alerts == [] and store.stream_status_updates == []


# ---------------------------------------------------------------- tick: escalation


def open_alert(store, severity, state="sent", sent_s_ago=0.0, kind="lookahead", zone=(BIT + 100, BIT + 125), wb=WB, risk="losses"):
    alert = {
        "id": str(uuid4()), "wellbore_id": wb, "kind": kind, "risk_type": risk, "severity": severity, "state": state,
        "dedup_key": f"{wb}:{risk}:{int(zone[0] // 50 * 50)}", "zone_md_from_m": zone[0], "zone_md_to_m": zone[1],
        "sent_at": NOW - timedelta(seconds=sent_s_ago), "created_at": NOW - timedelta(seconds=sent_s_ago),
    }  # fmt: skip
    store.alerts.append(alert)
    return alert


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "severity,age,state,expected",
    [("warning", 900, "sent", "sent"), ("warning", 901, "sent", "escalated"), ("warning", 901, "viewed", "escalated"),
     ("critical", 300, "sent", "sent"), ("critical", 301, "sent", "escalated"), ("watch", 100000, "sent", "sent"),
     ("info", 100000, "viewed", "viewed"), ("critical", 100000, "acknowledged", "acknowledged")],
)  # fmt: skip
async def test_escalation_timing(store, severity, age, state, expected):
    alert = open_alert(store, severity, state, age)
    await engine.engine_tick(NOW)
    assert alert["state"] == expected
    if expected == "escalated":
        assert alert["escalated_at"] == NOW and "alert.system.escalated" in store.actions()


# ---------------------------------------------------------------- tick: auto-resolve


def far_past(zone_to=BIT + 125):
    return zone_to + 26.0


@pytest.mark.asyncio
async def test_info_alert_auto_resolves_when_the_bit_is_past_the_zone_and_the_score_is_low(store):
    alert = open_alert(store, "info", "sent")
    store.streams = [stream(bit=far_past())]
    store.zone_fused[(WB, "losses")] = 10.0
    stats = await engine.engine_tick(NOW)
    assert stats["auto_resolved"] == 1
    assert alert["state"] == "resolved" and alert["resolved_how"] == "auto" and alert["outcome"] == "unknown"
    assert "alert.system.auto_resolved" in store.actions() and all(who is not None for who in store.actions())


@pytest.mark.asyncio
async def test_bit_must_be_more_than_25_m_below_the_zone(store):
    alert = open_alert(store, "watch", "viewed")
    store.streams = [stream(bit=BIT + 125 + 25.0)]
    await engine.engine_tick(NOW)
    assert alert["state"] == "viewed"
    store.streams = [stream(bit=BIT + 125 + 25.1)]
    await engine.engine_tick(NOW)
    assert alert["state"] == "resolved"


@pytest.mark.asyncio
async def test_with_the_score_condition_on_a_score_still_at_the_band_threshold_blocks_auto_resolve(store, monkeypatch):
    monkeypatch.setattr(engine, "AUTO_RESOLVE_REQUIRES_LOW_SCORE", True)
    alert = open_alert(store, "watch", "sent")  # watch threshold is 40
    store.streams = [stream(bit=far_past())]
    store.zone_fused[(WB, "losses")] = 40.0
    await engine.engine_tick(NOW)
    assert alert["state"] == "sent"
    store.zone_fused[(WB, "losses")] = 39.9
    await engine.engine_tick(NOW)
    assert alert["state"] == "resolved"


@pytest.mark.asyncio
async def test_warning_and_critical_are_not_auto_resolved_before_acknowledgement(store):
    warn = open_alert(store, "warning", "sent")
    crit = open_alert(store, "critical", "escalated", zone=(BIT + 200, BIT + 225), risk="kick")
    store.streams = [stream(bit=BIT + 400)]
    await engine.engine_tick(NOW)
    assert warn["state"] == "sent" and crit["state"] == "escalated"

    warn["state"] = "acknowledged"
    crit["state"] = "acknowledged"
    await engine.engine_tick(NOW)
    assert warn["state"] == "resolved" and crit["state"] == "resolved"


@pytest.mark.asyncio
async def test_nothing_auto_resolves_while_the_stream_is_lost(store):
    alert = open_alert(store, "info", "sent")
    store.streams = [stream("lost", 100.0, bit=far_past())]
    await engine.engine_tick(NOW)
    assert alert["state"] == "sent"


@pytest.mark.asyncio
async def test_detector_alerts_resolve_like_lookahead_ones_and_other_wells_are_untouched(store):
    detector_alert = open_alert(store, "info", "sent", kind="detector", zone=(BIT - 25, BIT + 25))
    other = open_alert(store, "info", "sent", wb=OTHER_WB)
    store.streams = [stream(bit=BIT + 60), stream(bit=1000.0, wb=OTHER_WB)]
    await engine.engine_tick(NOW)
    assert detector_alert["state"] == "resolved" and other["state"] == "sent"


@pytest.mark.asyncio
async def test_by_default_passing_the_zone_is_enough_even_if_its_stored_score_is_high(store):
    assert engine.AUTO_RESOLVE_REQUIRES_LOW_SCORE is False  # decision of 2026-10-04 (contract §12)
    alert = open_alert(store, "info", "sent")
    store.streams = [stream(bit=far_past())]
    store.zone_fused[(WB, "losses")] = 90.0  # the stored score of a passed zone is never recomputed
    await engine.engine_tick(NOW)
    assert alert["state"] == "resolved" and alert["resolved_how"] == "auto"


@pytest.mark.asyncio
async def test_the_score_condition_can_be_switched_back_on(store, monkeypatch):
    monkeypatch.setattr(engine, "AUTO_RESOLVE_REQUIRES_LOW_SCORE", True)
    alert = open_alert(store, "info", "sent")
    store.streams = [stream(bit=far_past())]
    store.zone_fused[(WB, "losses")] = 90.0
    await engine.engine_tick(NOW)
    assert alert["state"] == "sent"


@pytest.mark.asyncio
async def test_with_the_score_condition_on_a_zone_with_no_stored_scores_counts_as_cleared(store, monkeypatch):
    monkeypatch.setattr(engine, "AUTO_RESOLVE_REQUIRES_LOW_SCORE", True)
    alert = open_alert(store, "info", "sent")
    store.streams = [stream(bit=far_past())]
    await engine.engine_tick(NOW)
    assert alert["state"] == "resolved"


# ---------------------------------------------------------------- engine loop


@pytest.mark.asyncio
async def test_start_engine_is_idempotent_and_stop_cancels_it(monkeypatch):
    ticks = []

    async def tick():
        ticks.append(1)
        return {}

    monkeypatch.setattr(engine, "engine_tick", tick)
    monkeypatch.setattr(config, "ENGINE_TICK_S", 0.01)
    first = engine.start_engine()
    assert engine.start_engine() is first
    await asyncio.sleep(0.05)
    await engine.stop_engine()
    assert ticks and first.cancelled()


@pytest.mark.asyncio
async def test_a_failing_tick_does_not_end_the_loop(monkeypatch):
    calls = []

    async def tick():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("db hiccup")
        return {}

    monkeypatch.setattr(engine, "engine_tick", tick)
    monkeypatch.setattr(config, "ENGINE_TICK_S", 0.01)
    engine.start_engine()
    await asyncio.sleep(0.06)
    await engine.stop_engine()
    assert len(calls) >= 2


# ---------------------------------------------------------------- repository SQL guards


@pytest.mark.asyncio
async def test_update_alert_only_touches_known_columns_and_casts_enums(monkeypatch):
    seen = {}

    async def execute(sql, params=None):
        seen["sql"], seen["params"] = " ".join(sql.split()), params

    monkeypatch.setattr(db, "execute", execute)
    with pytest.raises(ValueError):
        await engine._update_alert("a1", wellbore_id="x")
    with pytest.raises(ValueError):
        await engine._update_alert("a1", **{"state = 'x', id": 1})
    await engine._update_alert("a1", state="resolved", resolved_how="auto", outcome="unknown", score=3.0)
    assert seen["sql"] == (
        "update alerts set state = %(state)s::alert_state, resolved_how = %(resolved_how)s::resolve_how, "
        "outcome = %(outcome)s::alert_outcome, score = %(score)s where id = %(alert_id)s"
    )


# ---------------------------------------------------------------- recommendation


LESSONS = [
    {"id": uuid4(), "title": "LCM pills", "mitigation": "Pumped a 30 m3 LCM pill and reduced pump rate", "success_rate": 0.8},
    {"id": uuid4(), "title": "Cement plug", "mitigation": "Spotted a cement plug", "success_rate": 0.5},
]


class RecDb:
    def __init__(self, lessons):
        self.lessons, self.params = lessons, None

    async def fetch_all(self, sql, params=None):
        assert "from lessons" in sql and "order by success_rate desc" in sql
        self.params = params
        return self.lessons


@pytest.fixture
def rec(monkeypatch):
    state = {"reply": "Offsets cured losses with a 30 m3 LCM pill, which worked in 80% of cases.", "calls": [], "fail": False}
    fake_db = RecDb(LESSONS)

    async def complete_text(system, user, **kwargs):
        state["calls"].append((system, user))
        if state["fail"]:
            raise RuntimeError("both providers down")
        return state["reply"], LlmMeta("groq", "m", False, 1.0, len(user))

    monkeypatch.setattr(db, "fetch_all", fake_db.fetch_all)
    monkeypatch.setattr(recommend, "complete_text", complete_text)
    state["db"] = fake_db
    return state


@pytest.mark.asyncio
async def test_event_types_for_a_risk_type_come_from_the_contract_mapping():
    assert sorted(recommend.event_types_for("losses")) == ["loss_partial", "loss_total"]
    assert "stuck_pipe_diff" in recommend.event_types_for("stuck_pipe") and "kick" in recommend.event_types_for("kick")


@pytest.mark.asyncio
async def test_recommendation_uses_the_top_two_lessons_and_the_llm_text(rec):
    text, lessons = await recommend.recommend("Tipam", "losses")
    assert text == rec["reply"] and [l["title"] for l in lessons] == ["LCM pills", "Cement plug"]
    assert rec["db"].params["limit"] == 2 and sorted(rec["db"].params["types"]) == ["loss_partial", "loss_total"]
    system, user = rec["calls"][0]
    assert "at most 2 sentences" in system and "worked in 80% of cases" in user and "Pumped a 30 m3 LCM pill" in user


@pytest.mark.asyncio
async def test_no_lessons_gives_the_template_without_calling_the_llm(rec):
    rec["db"].lessons = []
    assert await recommend.recommend("Tipam", "losses") == (recommend.NO_MITIGATION, [])
    assert await recommend.recommend(None, "losses") == (recommend.NO_MITIGATION, [])
    assert rec["calls"] == []


@pytest.mark.asyncio
async def test_llm_failure_falls_back_to_the_offsets_report_template(rec):
    rec["fail"] = True
    text, lessons = await recommend.recommend("Tipam", "losses")
    assert text == "Offsets report: Pumped a 30 m3 LCM pill and reduced pump rate." and len(lessons) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply",
    ["Offsets pumped a 45 m3 LCM pill.", "One. Two. Three sentences.", "", "It worked in 95% of cases."],
)  # fmt: skip
async def test_llm_text_with_invented_numbers_or_too_long_is_replaced_by_the_template(rec, reply):
    rec["reply"] = reply
    text, _ = await recommend.recommend("Tipam", "losses")
    assert text.startswith("Offsets report:")

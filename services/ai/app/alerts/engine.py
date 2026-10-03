"""Alert engine (BE-19, contract §11.6, §11.7, §12 system transitions).

`evaluate` turns fused risk scores and fired detectors into alerts (called by the stream replay);
`engine_tick` runs every ENGINE_TICK_S: stream health (stale / lost and the "Live data lost" system
alert), escalation of unacknowledged warnings and criticals, and auto-resolve of alerts the bit has
drilled past. Every write uses the service role; every system transition writes `audit_log` with
user_id null and action `alert.system.<transition>`.

Database access is kept in small `_repo` functions so the rules above them can be tested with an
in-memory store.
"""

from __future__ import annotations

import asyncio
import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import psycopg.errors
from psycopg.types.json import Jsonb

from app import db
from app.alerts import recommend as recommend_module, templates
from app.logging import get_logger
from app.risk import config
from app.risk.fuse import band_for, severity_for

logger = get_logger(__name__)

# Decision (2026-10-04): an alert auto-resolves once the bit is more than AUTO_RESOLVE_PAST_ZONE_M below its zone.
# The earlier rule also required the zone's latest fused score to be below the band threshold, but scores of zones
# behind the bit are never recomputed, so look-ahead alerts would never have closed. Set this True to bring that
# condition back (contract §12 was amended to say which rule applies).
AUTO_RESOLVE_REQUIRES_LOW_SCORE = False

SEVERITY_RANK = {"info": 1, "watch": 2, "warning": 3, "critical": 4}
BAND_RANK = {"low": 0, "moderate": 1, "elevated": 2, "high": 3, "critical": 4}
BAND_LOWER_BOUND = {
    "low": 0.0, "moderate": config.BAND_LOW_MAX, "elevated": config.BAND_MODERATE_MAX,
    "high": config.BAND_ELEVATED_MAX, "critical": config.BAND_HIGH_MAX,
}  # fmt: skip
CLOSED_STATES = ("resolved", "feedback")
DETECTOR_ZONE_HALF_M = 25.0  # a detector alert covers the bit +/- this
AUTO_RESOLVE_PAST_ZONE_M = 25.0  # the bit must be this far below zone_md_to_m
STREAM_LOST_NAME = "stream_lost"
LOW_CONFIDENCE_CAP = "watch"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- candidates (pure)


@dataclass
class Candidate:
    kind: str  # 'lookahead' | 'detector'
    risk_type: str
    severity: str
    band: str
    score: float
    confidence: str | None
    zone_md_from_m: float
    zone_md_to_m: float
    expected_md_m: float
    formation: str | None
    dedup_key: str
    row: dict[str, Any] | None = None  # the risk_scores row it came from
    detector: dict[str, Any] | None = None  # {"name", "signal", "floor"} of the detector that fired
    model_version: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def fired(self) -> bool:
        return self.detector is not None


def dedup_key(wellbore_id: str, risk_type: str, zone_md_from_m: float) -> str:
    """§11.7: "{wellbore_id}:{risk_type}:{zone_start}", zone_start = floor(zone_md_from_m / 50) * 50."""
    return f"{wellbore_id}:{risk_type}:{int(math.floor(zone_md_from_m / config.DEDUP_ZONE_M) * config.DEDUP_ZONE_M)}"


def system_key(wellbore_id: str, name: str) -> str:
    return f"{wellbore_id}:system:{name}"


def cap_severity(severity: str, confidence: str | None, detector_fired: bool) -> str:
    """§11.5: low confidence caps the severity at `watch` unless a detector fired."""
    if confidence == "low" and not detector_fired and SEVERITY_RANK[severity] > SEVERITY_RANK[LOW_CONFIDENCE_CAP]:
        return LOW_CONFIDENCE_CAP
    return severity


def build_candidates(
    wellbore_id: str, bit_md_m: float, scores: list[dict[str, Any]], detectors: list[Any]
) -> list[Candidate]:
    """Steps 1-3 of the spec: look-ahead zones at band >= moderate, plus one per risk type with a fired detector."""
    found: dict[str, Candidate] = {}

    for row in scores:
        ahead = row["md_from_m"] - bit_md_m
        band = band_for(row["fused"])
        if not (config.LOOKAHEAD_MIN_M <= ahead <= config.LOOKAHEAD_MAX_M) or BAND_RANK[band] < BAND_RANK["moderate"]:
            continue
        severity = cap_severity(severity_for(band), row["confidence"], False)
        key = dedup_key(wellbore_id, row["risk_type"], row["md_from_m"])
        if key in found and found[key].score >= row["fused"]:
            continue  # two 25 m cells share a 50 m key: the alert describes the higher score (the shallower on a tie)
        found[key] = Candidate(
            "lookahead", row["risk_type"], severity, band, row["fused"], row["confidence"], row["md_from_m"],
            row["md_to_m"], (row["md_from_m"] + row["md_to_m"]) / 2, row.get("formation"), key, row=row,
            model_version=row.get("model_version"),
        )  # fmt: skip

    at_bit = {r["risk_type"]: r for r in scores if r["md_from_m"] <= bit_md_m < r["md_to_m"]}
    best_detector: dict[str, Any] = {}
    for result in detectors:
        if result.fired and (result.risk_type not in best_detector or result.floor > best_detector[result.risk_type].floor):
            best_detector[result.risk_type] = result
    for risk_type, result in best_detector.items():
        row = at_bit.get(risk_type)
        score = max(float(result.floor), row["fused"] if row else 0.0)
        band = band_for(score)
        zone_from = bit_md_m - DETECTOR_ZONE_HALF_M
        key = dedup_key(wellbore_id, risk_type, zone_from)
        candidate = Candidate(
            "detector", risk_type, severity_for(band), band, score, row["confidence"] if row else None, zone_from,
            bit_md_m + DETECTOR_ZONE_HALF_M, bit_md_m, row.get("formation") if row else None, key, row=row,
            detector={"name": result.name, "signal": result.signal, "floor": result.floor},
            model_version=row.get("model_version") if row else None,
        )  # fmt: skip
        found[key] = candidate  # a detector zone (bit +/- 25 m) never shares a key with a look-ahead zone (>= bit + 50 m)
    return list(found.values())


def should_retrigger(resolved: dict[str, Any], candidate: Candidate) -> bool:
    """A new alert after a resolved one: only if a detector fired, the band rose above the resolved
    alert's band, or the score reached its band threshold + RETRIGGER_HYSTERESIS."""
    if candidate.fired:
        return True
    previous_band = band_for(resolved["score"]) if resolved.get("score") is not None else "low"
    if BAND_RANK[candidate.band] > BAND_RANK[previous_band]:
        return True
    return candidate.score >= BAND_LOWER_BOUND[previous_band] + config.RETRIGGER_HYSTERESIS


# ---------------------------------------------------------------- repository (SQL)

_CASTS = {
    "state": "alert_state", "severity": "alert_severity", "confidence": "confidence_level",
    "resolved_how": "resolve_how", "outcome": "alert_outcome", "kind": "alert_kind", "risk_type": "risk_type",
}  # fmt: skip
_UPDATABLE = {
    "state", "severity", "score", "confidence", "title", "message", "recommendation", "evidence", "sent_at",
    "escalated_at", "resolved_at", "resolved_how", "outcome", "model_version",
}  # fmt: skip


async def _bit_md(wellbore_id: str) -> float | None:
    row = await db.fetch_one("select bit_md_m from stream_state where wellbore_id = %(id)s", {"id": wellbore_id})
    return row["bit_md_m"] if row else None


async def _latest_alert(key: str) -> dict[str, Any] | None:
    return await db.fetch_one(
        "select id, state::text as state, severity::text as severity, score, evidence from alerts "
        "where dedup_key = %(key)s order by created_at desc limit 1",
        {"key": key},
    )


async def _insert_alert(fields: dict[str, Any]) -> str:
    row = await db.fetch_one(
        """
        insert into alerts (wellbore_id, kind, risk_type, severity, state, dedup_key, zone_md_from_m, zone_md_to_m,
                            expected_md_m, formation, score, confidence, title, message, recommendation, evidence,
                            model_version)
        values (%(wellbore_id)s, %(kind)s::alert_kind, %(risk_type)s::risk_type, %(severity)s::alert_severity,
                'generated', %(dedup_key)s, %(zone_md_from_m)s, %(zone_md_to_m)s, %(expected_md_m)s, %(formation)s,
                %(score)s, %(confidence)s::confidence_level, %(title)s, %(message)s, %(recommendation)s,
                %(evidence)s, %(model_version)s)
        returning id
        """,
        {**fields, "evidence": Jsonb(fields["evidence"])},
    )
    return str(row["id"])


async def _update_alert(alert_id: str, **fields: Any) -> None:
    unknown = set(fields) - _UPDATABLE
    if unknown:
        raise ValueError(f"cannot update alert columns {sorted(unknown)}")
    assignments = ", ".join(
        f"{name} = %({name})s" + (f"::{_CASTS[name]}" if name in _CASTS else "") for name in fields
    )
    params = {k: (Jsonb(v) if k == "evidence" else v) for k, v in fields.items()}
    await db.execute(f"update alerts set {assignments} where id = %(alert_id)s", {**params, "alert_id": alert_id})


async def _audit(action: str, alert_id: str, details: dict[str, Any]) -> None:
    await db.execute(
        "insert into audit_log (user_id, action, entity, entity_id, details) "
        "values (null, %(action)s, 'alert', %(id)s, %(details)s)",
        {"action": f"alert.system.{action}", "id": alert_id, "details": Jsonb(details)},
    )


async def _event_details(event_ids: list[str]) -> list[dict[str, Any]]:
    if not event_ids:
        return []
    return await db.fetch_all(
        """
        select e.id, e.wellbore_id, e.event_type::text as event_type, e.md_from_m, e.npt_h, e.doc_id, e.page,
               d.title as doc_title
        from events e left join documents d on d.id = e.doc_id
        where e.id::text = any(%(ids)s::text[])
        """,
        {"ids": event_ids},
    )


async def _zone_max_fused(wellbore_id: str, risk_type: str, md_from: float, md_to: float) -> float | None:
    row = await db.fetch_one(
        "select max(fused) as fused from risk_scores where wellbore_id = %(id)s and risk_type::text = %(rt)s "
        "and md_from_m < %(md_to)s and md_to_m > %(md_from)s",
        {"id": wellbore_id, "rt": risk_type, "md_from": md_from, "md_to": md_to},
    )
    return row["fused"] if row else None


async def _stream_rows() -> list[dict[str, Any]]:
    return await db.fetch_all(
        "select wellbore_id, status::text as status, bit_md_m, last_sample_at from stream_state"
    )


async def _set_stream_status(wellbore_id: str, status: str) -> None:
    await db.execute(
        "update stream_state set status = %(status)s::stream_status, updated_at = now() where wellbore_id = %(id)s",
        {"status": status, "id": wellbore_id},
    )


async def _open_alerts(kinds: tuple[str, ...], states: tuple[str, ...]) -> list[dict[str, Any]]:
    return await db.fetch_all(
        "select id, wellbore_id, kind::text as kind, risk_type::text as risk_type, severity::text as severity, "
        "state::text as state, zone_md_to_m, zone_md_from_m, sent_at, created_at, dedup_key from alerts "
        "where kind::text = any(%(kinds)s::text[]) and state::text = any(%(states)s::text[])",
        {"kinds": list(kinds), "states": list(states)},
    )


# ---------------------------------------------------------------- content


async def build_evidence(
    candidate: Candidate, lessons: list[dict[str, Any]]
) -> dict[str, Any]:
    """§11.6 evidence JSON from the score row's reasons, the offset events, the lessons and the detector."""
    row = candidate.row or {}
    reasons = row.get("reasons") or []
    by_event = {r["event_id"]: r for r in reasons if r.get("kind") == "offset_event"}
    events = await _event_details(list(by_event))

    offsets: dict[str, dict[str, Any]] = {}
    sources: dict[tuple[str, int | None], dict[str, Any]] = {}
    for event in sorted(events, key=lambda e: (str(e["wellbore_id"]), e["md_from_m"])):
        reason = by_event[str(event["id"])]
        wellbore = str(event["wellbore_id"])
        entry = offsets.setdefault(
            wellbore,
            {"wellbore_id": wellbore, "well_name": reason.get("well_name"),
             "depth_distance_m": reason.get("depth_distance_m"), "events": []},
        )  # fmt: skip
        entry["events"].append(
            {
                "id": str(event["id"]), "event_type": event["event_type"], "md_from_m": event["md_from_m"],
                "npt_h": event["npt_h"], "doc_id": str(event["doc_id"]) if event["doc_id"] else None, "page": event["page"],
            }  # fmt: skip
        )
        if event["doc_id"]:
            sources[(str(event["doc_id"]), event["page"])] = {
                "doc_id": str(event["doc_id"]), "doc_title": event["doc_title"], "page": event["page"],
            }  # fmt: skip

    evidence: dict[str, Any] = {
        "offsets": sorted(offsets.values(), key=lambda o: o["depth_distance_m"] or 0),
        "lessons": [
            {"id": l["id"], "title": l["title"], "mitigation": l["mitigation"], "success_rate": l["success_rate"]}
            for l in lessons
        ],
        "shap": [{"feature": r["feature"], "value": r["value"]} for r in reasons if r.get("kind") == "shap"],
        "layers": {"l1": row.get("l1"), "l2": row.get("l2"), "l3": row.get("l3")},
        "sources": list(sources.values()),
    }
    if candidate.detector:
        evidence["detector"] = {"name": candidate.detector["name"], "signal": candidate.detector["signal"]}
    return evidence


async def build_content(candidate: Candidate, bit_md_m: float, lessons: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """title, message, recommendation and evidence for a new or re-notified alert."""
    recommendation = None
    if lessons is None:
        recommendation, lessons = await recommend_module.recommend(candidate.formation, candidate.risk_type)
    evidence = await build_evidence(candidate, lessons)
    return {
        "title": templates.title(candidate.risk_type, candidate.formation, candidate.kind, candidate.zone_md_from_m - bit_md_m),
        "message": templates.message(candidate.kind, candidate.risk_type, candidate.formation, candidate.score, evidence),
        "recommendation": recommendation,
        "evidence": evidence,
    }  # fmt: skip


# ---------------------------------------------------------------- evaluate


async def _create(candidate: Candidate, wellbore_id: str, bit_md_m: float, now: datetime) -> str:
    content = await build_content(candidate, bit_md_m)
    alert_id = await _insert_alert(
        {
            "wellbore_id": wellbore_id, "kind": candidate.kind, "risk_type": candidate.risk_type,
            "severity": candidate.severity, "dedup_key": candidate.dedup_key,
            "zone_md_from_m": candidate.zone_md_from_m, "zone_md_to_m": candidate.zone_md_to_m,
            "expected_md_m": candidate.expected_md_m, "formation": candidate.formation, "score": candidate.score,
            "confidence": candidate.confidence, "model_version": candidate.model_version, **content,
        }  # fmt: skip
    )
    await _audit("generated", alert_id, {"dedup_key": candidate.dedup_key, "severity": candidate.severity})
    await _update_alert(alert_id, state="sent", sent_at=now)  # Realtime pushes the insert and then this update
    await _audit("sent", alert_id, {"dedup_key": candidate.dedup_key})
    return alert_id


async def _handle(candidate: Candidate, wellbore_id: str, bit_md_m: float, now: datetime) -> dict[str, Any]:
    latest = await _latest_alert(candidate.dedup_key)
    result = {"dedup_key": candidate.dedup_key, "risk_type": candidate.risk_type, "severity": candidate.severity}

    if latest is not None and latest["state"] not in CLOSED_STATES:  # an open alert owns this key
        alert_id = str(latest["id"])
        if SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[latest["severity"]]:
            content = await build_content(candidate, bit_md_m)
            await _update_alert(
                alert_id, severity=candidate.severity, score=candidate.score, confidence=candidate.confidence,
                state="sent", sent_at=now, **content,
            )  # fmt: skip
            await _audit("renotified", alert_id, {"from": latest["severity"], "to": candidate.severity})
            return {**result, "action": "renotified", "alert_id": alert_id}
        existing_lessons = (latest.get("evidence") or {}).get("lessons", [])
        evidence = await build_evidence(candidate, existing_lessons)
        await _update_alert(alert_id, score=candidate.score, evidence=evidence)
        return {**result, "action": "updated", "alert_id": alert_id}

    if latest is not None and not should_retrigger(latest, candidate):
        return {**result, "action": "suppressed", "alert_id": str(latest["id"])}

    try:
        alert_id = await _create(candidate, wellbore_id, bit_md_m, now)
    except psycopg.errors.UniqueViolation:  # another evaluation opened this key a moment ago
        return {**result, "action": "suppressed", "alert_id": None}
    return {**result, "action": "created", "alert_id": alert_id}


async def evaluate(
    wellbore_id: str, scores: list[dict[str, Any]], detector_results: list[Any], now: datetime | None = None
) -> list[dict[str, Any]]:
    """Create, re-notify or quietly update alerts for the current scores. Returns what was done per candidate."""
    now = now or utcnow()
    bit = await _bit_md(wellbore_id)
    if bit is None:
        return []
    actions = []
    for candidate in build_candidates(wellbore_id, bit, scores, detector_results):
        actions.append(await _handle(candidate, wellbore_id, bit, now))
    return actions


# ---------------------------------------------------------------- tick


def _age_s(now: datetime, moment: datetime | None) -> float | None:
    return None if moment is None else (now - moment).total_seconds()


async def _create_system_alert(wellbore_id: str, name: str, title: str, message: str, now: datetime) -> str | None:
    key = system_key(wellbore_id, name)
    latest = await _latest_alert(key)
    if latest is not None and latest["state"] not in CLOSED_STATES:
        return None
    try:
        alert_id = await _insert_alert(
            {
                "wellbore_id": wellbore_id, "kind": "system", "risk_type": None, "severity": "warning",
                "dedup_key": key, "zone_md_from_m": None, "zone_md_to_m": None, "expected_md_m": None,
                "formation": None, "score": None, "confidence": None, "title": title, "message": message,
                "recommendation": None, "evidence": {}, "model_version": None,
            }  # fmt: skip
        )
    except psycopg.errors.UniqueViolation:
        return None
    await _audit("generated", alert_id, {"dedup_key": key})
    await _update_alert(alert_id, state="sent", sent_at=now)
    await _audit("sent", alert_id, {"dedup_key": key})
    return alert_id


async def _resolve_auto(alert_id: str, now: datetime, details: dict[str, Any]) -> None:
    await _update_alert(alert_id, state="resolved", resolved_at=now, resolved_how="auto", outcome="unknown")
    await _audit("auto_resolved", alert_id, details)


async def _stream_health(streams: list[dict[str, Any]], now: datetime, stats: Counter) -> None:
    for row in streams:
        age = _age_s(now, row.get("last_sample_at"))
        if row["status"] not in ("live", "stale", "lost") or age is None:
            continue
        wellbore_id = str(row["wellbore_id"])
        if age > config.STREAM_LOST_S:
            if row["status"] != "lost":
                await _set_stream_status(wellbore_id, "lost")
                row["status"] = "lost"
            if await _create_system_alert(wellbore_id, STREAM_LOST_NAME, templates.STREAM_LOST_TITLE, templates.stream_lost_message(age), now):
                stats["stream_lost"] += 1
        elif age > config.STREAM_STALE_S:
            if row["status"] == "live":
                await _set_stream_status(wellbore_id, "stale")
                row["status"] = "stale"
                stats["stream_stale"] += 1
        elif row["status"] in ("stale", "lost"):
            await _set_stream_status(wellbore_id, "live")
            row["status"] = "live"
            stats["stream_resumed"] += 1

    fresh = {
        str(r["wellbore_id"]) for r in streams
        if (a := _age_s(now, r.get("last_sample_at"))) is not None and a <= config.STREAM_STALE_S
    }  # fmt: skip
    for alert in await _open_alerts(("system",), ("generated", "sent", "viewed", "escalated", "acknowledged")):
        if alert["dedup_key"].endswith(f":system:{STREAM_LOST_NAME}") and str(alert["wellbore_id"]) in fresh:
            await _resolve_auto(str(alert["id"]), now, {"reason": "samples resumed"})
            stats["stream_recovered"] += 1


async def _escalate(now: datetime, stats: Counter) -> None:
    limits = {"warning": config.ESCALATE_WARNING_S, "critical": config.ESCALATE_CRITICAL_S}
    for alert in await _open_alerts(("lookahead", "detector", "system"), ("sent", "viewed")):
        limit = limits.get(alert["severity"])
        age = _age_s(now, alert.get("sent_at") or alert.get("created_at"))
        if limit is not None and age is not None and age > limit:
            await _update_alert(str(alert["id"]), state="escalated", escalated_at=now)
            await _audit("escalated", str(alert["id"]), {"severity": alert["severity"], "age_s": round(age)})
            stats["escalated"] += 1


async def _auto_resolve(streams: dict[str, dict[str, Any]], now: datetime, stats: Counter) -> None:
    for alert in await _open_alerts(("lookahead", "detector"), ("sent", "viewed", "escalated", "acknowledged")):
        stream = streams.get(str(alert["wellbore_id"]))
        if stream is None or stream["bit_md_m"] is None or stream["status"] == "lost":
            continue  # never while the stream is lost
        # warning/critical must be acknowledged first; info/watch may resolve unacknowledged
        if alert["state"] != "acknowledged" and alert["severity"] in ("warning", "critical"):
            continue
        if alert["state"] == "escalated" or alert["zone_md_to_m"] is None:
            continue
        if stream["bit_md_m"] <= alert["zone_md_to_m"] + AUTO_RESOLVE_PAST_ZONE_M:
            continue
        if AUTO_RESOLVE_REQUIRES_LOW_SCORE:
            latest = await _zone_max_fused(
                str(alert["wellbore_id"]), alert["risk_type"], alert["zone_md_from_m"], alert["zone_md_to_m"]
            )
            if latest is not None and latest >= templates.band_threshold(alert["severity"]):
                continue
        await _resolve_auto(str(alert["id"]), now, {"bit_md_m": stream["bit_md_m"], "zone_md_to_m": alert["zone_md_to_m"]})
        stats["auto_resolved"] += 1


async def engine_tick(now: datetime | None = None) -> Counter:
    """One pass of stream health, escalation and auto-resolve. Returns counts of what happened."""
    now = now or utcnow()
    stats: Counter = Counter()
    streams = await _stream_rows()
    await _stream_health(streams, now, stats)
    await _escalate(now, stats)
    await _auto_resolve({str(r["wellbore_id"]): r for r in streams}, now, stats)
    return stats


# ---------------------------------------------------------------- background loop

_task: asyncio.Task | None = None


async def _loop() -> None:
    while True:
        try:
            stats = await engine_tick()
            if stats:
                logger.info("engine_tick %s", dict(stats))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - one failed tick must not end the engine
            logger.exception("engine_tick_failed")
        await asyncio.sleep(config.ENGINE_TICK_S)


def start_engine() -> asyncio.Task:
    """Start the tick loop (idempotent). Called from app startup."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
    return _task


async def stop_engine() -> None:
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None

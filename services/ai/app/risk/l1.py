"""Risk layer L1: offset look-ahead (BE-14, contract §11.3).

For each 25 m interval ahead of the bit and each risk type, how often did offset wells that
drilled the same formation have that kind of event at the same relative depth, weighted by
how far (in depth) each offset is. `compute_l1` is pure; `l1_scores` gathers the data.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from typing import Any

from app import db
from app.models.enums import ReviewStatus, RiskType
from app.risk import config

RISK_TYPES = tuple(rt.value for rt in RiskType)
_EPS = 1e-9
EVENT_FETCH_LIMIT = 5000  # events_for_offsets p_limit: effectively "all events of the offsets"


@dataclass
class L1Result:
    md_from_m: float
    md_to_m: float
    risk_type: str
    l1: float | None  # None = unknown (no offset drilled the formation), never 0.5
    formation: str | None
    n_offsets: int
    mean_event_conf: float | None  # mean confidence of the events that counted as hits
    n_unreviewed_events: int = 0  # how many of those hits are still review_status 'pending'
    reasons: list[dict[str, Any]] = field(default_factory=list)


def _is_hit(interval: dict[str, Any], offset: dict[str, Any], event: dict[str, Any]) -> bool:
    """Same relative depth (within tolerance); if either is unknown, same MD-equivalent depth."""
    rel_interval, rel_event = interval.get("relative_depth"), event.get("relative_depth")
    if rel_interval is not None and rel_event is not None:
        return abs(rel_event - rel_interval) <= config.L1_HIT_REL_DEPTH_TOL + _EPS
    top_active, top_offset = interval.get("top_md_m"), offset.get("top_md_m")
    if top_active is None or top_offset is None:
        return False
    equivalent_md = top_offset + (interval["md_mid_m"] - top_active)
    return abs(event["md_from_m"] - equivalent_md) <= config.L1_HIT_MD_TOL_M + _EPS


def compute_l1(
    interval: dict[str, Any],
    offsets: list[dict[str, Any]],
    events: list[dict[str, Any]],
    risk_types: tuple[str, ...] = RISK_TYPES,
) -> list[L1Result]:
    """One L1Result per risk type for one interval.

    interval: md_from_m, md_to_m, md_mid_m, formation, relative_depth (or None), top_md_m (the active
        well's top of that formation, or None).
    offsets: wellbore_id, well_name, depth_distance_m, drilled (False if the offset has no actual top
        for the formation), top_md_m (that top).
    events: wellbore_id, id, risk_type, formation, relative_depth, md_from_m, review_status, confidence.
    """
    used = {
        str(o["wellbore_id"]): o
        for o in offsets
        if o.get("drilled", True) and o.get("depth_distance_m") is not None
    }
    weight = {wb: math.exp(-o["depth_distance_m"] / config.L1_DEPTH_DECAY_M) for wb, o in used.items()}
    total_weight = sum(weight.values())

    results = []
    for risk_type in risk_types:
        hits: dict[str, list[tuple[float, dict[str, Any]]]] = {}
        for event in events:
            wb = str(event["wellbore_id"])
            if (
                wb not in used
                or event["risk_type"] != risk_type
                or event["formation"] != interval["formation"]
                or event["review_status"] == ReviewStatus.REJECTED.value
                or not _is_hit(interval, used[wb], event)
            ):
                continue
            event_weight = (
                config.UNREVIEWED_EVENT_WEIGHT if event["review_status"] == ReviewStatus.PENDING.value else 1.0
            )
            hits.setdefault(wb, []).append((event_weight, event))

        if total_weight == 0:
            l1 = None
        else:
            hit_sum = sum(weight[wb] * max(w for w, _ in found) for wb, found in hits.items())
            l1 = (hit_sum + config.L1_PRIOR_HIT) / (total_weight + config.L1_PRIOR_WEIGHT)

        counted = [(weight[wb] * w, e) for wb, found in hits.items() for w, e in found]
        counted.sort(key=lambda item: item[0], reverse=True)
        confidences = [e["confidence"] for _, e in counted if e.get("confidence") is not None]
        results.append(
            L1Result(
                md_from_m=interval["md_from_m"],
                md_to_m=interval["md_to_m"],
                risk_type=risk_type,
                l1=l1,
                formation=interval["formation"],
                n_offsets=len(used),
                mean_event_conf=sum(confidences) / len(confidences) if confidences else None,
                n_unreviewed_events=sum(1 for _, e in counted if e["review_status"] == ReviewStatus.PENDING.value),
                reasons=[
                    {
                        "kind": "offset_event",
                        "event_id": str(e["id"]),
                        "well_name": used[str(e["wellbore_id"])].get("well_name"),
                        "depth_distance_m": used[str(e["wellbore_id"])]["depth_distance_m"],
                    }
                    for _, e in counted[: config.L1_MAX_REASONS]
                ],
            )
        )
    return results


# ---------------------------------------------------------------- data gathering


async def _formation_events(wellbore_id: str, formation: str) -> list[dict[str, Any]]:
    """Events of every offset in `formation` (rejected ones are excluded by the SQL function)."""
    return await db.call_fn(
        "events_for_offsets",
        p_wellbore=wellbore_id,
        p_radius_m=config.RADIUS_M,
        p_formations=[formation],
        p_limit=EVENT_FETCH_LIMIT,
    )


async def _actual_tops(formation: str, wellbore_ids: list[str]) -> dict[str, float]:
    """MD of each given wellbore's actual top of `formation` (an offset without one did not drill it)."""
    if not wellbore_ids:
        return {}
    rows = await db.fetch_all(
        "select wellbore_id, top_md_m from formation_tops "
        "where source = 'actual' and formation = %(formation)s and wellbore_id::text = any(%(ids)s::text[])",
        {"formation": formation, "ids": wellbore_ids},
    )
    return {str(r["wellbore_id"]): r["top_md_m"] for r in rows}


async def l1_scores(
    wellbore_id: str,
    bit_md_m: float,
    risk_types: tuple[str, ...] = RISK_TYPES,
    n_intervals: int = config.LOOKAHEAD_INTERVALS,
) -> list[L1Result]:
    """L1 for `n_intervals` 25 m intervals from `bit_md_m` (default: the 12 of the look-ahead), every risk type."""
    # Every database call of the intervals runs concurrently (three stages, each a gather): a round trip
    # to a distant region can take 0.5 s, and about 40 sequential calls made one computation take 20 s.

    async def locate(k: int) -> dict[str, Any]:
        md_from = bit_md_m + k * config.INTERVAL_M
        md_to = md_from + config.INTERVAL_M
        md_mid = (md_from + md_to) / 2
        position = await db.call_fn("formation_at_md", p_wellbore=wellbore_id, p_md=md_mid)
        here = position[0] if position else {}
        return {
            "md_from_m": md_from, "md_to_m": md_to, "md_mid_m": md_mid, "formation": here.get("formation"),
            "relative_depth": here.get("relative_depth"), "top_md_m": here.get("top_md_m"),
        }  # fmt: skip

    async def offsets_of(interval: dict[str, Any]) -> list[dict[str, Any]]:
        if interval["formation"] is None:
            return []
        offsets = await db.call_fn(
            "offsets_within", p_wellbore=wellbore_id, p_radius_m=config.RADIUS_M, p_md=interval["md_mid_m"], p_mode="depth"
        )
        tops = await _actual_tops(interval["formation"], [str(o["wellbore_id"]) for o in offsets])
        return [
            {**o, "drilled": str(o["wellbore_id"]) in tops, "top_md_m": tops.get(str(o["wellbore_id"]))}
            for o in offsets
        ]

    intervals = list(await asyncio.gather(*(locate(k) for k in range(n_intervals))))
    formations = sorted({iv["formation"] for iv in intervals if iv["formation"] is not None})
    event_lists = await asyncio.gather(*(_formation_events(wellbore_id, f) for f in formations))
    events_by_formation = dict(zip(formations, event_lists))
    enriched = await asyncio.gather(*(offsets_of(iv) for iv in intervals))

    results: list[L1Result] = []
    for interval, offsets in zip(intervals, enriched):
        events = events_by_formation.get(interval["formation"], [])
        results += compute_l1(interval, offsets, events, risk_types)
    return results

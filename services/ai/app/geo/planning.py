"""Planning brief for a virtual vertical well (BE-23, contract §9.4). Read-only: nothing is written.

Offsets are the primary wellbores of wells within `radius_m` of the point (surface distance). Tops use the
BE-12 inverse-distance maths with TVD = MD (vertical well, KB taken as the offsets' mean KB). The risk profile
is L1 per 25 m interval from the surface to the planned TD; the depth distance to an offset is
sqrt(surface_distance^2 + delta_tvd^2) at the same depth below the formation top.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Any

from app import db
from app.alerts.recommend import event_types_for
from app.geo import tops as tops_module
from app.geo.position import tvd_at_md
from app.risk import config
from app.risk.fuse import band_for, confidence_for, fuse
from app.risk.l1 import compute_l1

ELEVATED_BANDS = ("elevated", "high", "critical")
FUSED_DECIMALS = 1


# ---------------------------------------------------------------- pure helpers


def interval_bounds(planned_td_m: float) -> list[tuple[float, float]]:
    """25 m intervals from the surface to the planned TD (the last one may be shorter)."""
    count = math.ceil(planned_td_m / config.INTERVAL_M)
    return [(k * config.INTERVAL_M, min((k + 1) * config.INTERVAL_M, planned_td_m)) for k in range(count)]


def formation_at(
    predicted: list[tops_module.PredictedTop], md: float
) -> tuple[tops_module.PredictedTop | None, float | None]:
    """(the predicted top the depth is below, the next predicted top's MD or None). `predicted` is in strat order."""
    current, next_md = None, None
    for index, top in enumerate(predicted):
        if top.top_md_m <= md:
            current = top
            next_md = predicted[index + 1].top_md_m if index + 1 < len(predicted) else None
    return current, next_md


def depth_distance_m(surface_distance: float, virtual_tvd: float, offset_tvd: float) -> float:
    return math.hypot(surface_distance, virtual_tvd - offset_tvd)


def main_basin(offsets: list[dict[str, Any]]) -> str | None:
    basins = Counter(o["basin"] for o in offsets if o.get("basin"))
    return basins.most_common(1)[0][0] if basins else None


# ---------------------------------------------------------------- data


async def _offsets_near(lat: float, lon: float, radius_m: float) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        """
        select wb.id as wellbore_id, w.name as well_name, w.basin, w.kb_elev_m,
               ST_Distance(w.surface, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography) as surface_distance_m
        from wells w join wellbores wb on wb.well_id = w.id and wb.is_primary
        where w.status <> 'planned'
          and ST_DWithin(w.surface, ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography, %(radius)s)
        order by surface_distance_m
        limit %(limit)s
        """,
        {"lat": lat, "lon": lon, "radius": radius_m, "limit": tops_module.MAX_OFFSETS},
    )
    return [{**r, "wellbore_id": str(r["wellbore_id"])} for r in rows]


async def _offset_tops_md(ids: list[str]) -> dict[tuple[str, str], float]:
    rows = await db.fetch_all(
        "select wellbore_id, formation, top_md_m from formation_tops "
        "where source = 'actual' and wellbore_id::text = any(%(ids)s::text[])",
        {"ids": ids},
    )
    return {(str(r["wellbore_id"]), r["formation"]): r["top_md_m"] for r in rows}


async def _offset_events(ids: list[str]) -> list[dict[str, Any]]:
    rows = await db.fetch_all(
        "select id, wellbore_id, risk_type::text as risk_type, formation, md_from_m, relative_depth, "
        "review_status::text as review_status, confidence from events "
        "where wellbore_id::text = any(%(ids)s::text[]) and review_status <> 'rejected' and risk_type is not null",
        {"ids": ids},
    )
    return [{**r, "wellbore_id": str(r["wellbore_id"])} for r in rows]


async def _lessons(formations: list[str]) -> list[dict[str, Any]]:
    return await db.fetch_all(
        "select id, formation, event_type::text as event_type, title, mitigation, well_count, success_rate "
        "from lessons where formation = any(%(f)s::text[]) and mitigation is not null "
        "order by success_rate desc nulls last, well_count desc",
        {"f": formations},
    )


# ---------------------------------------------------------------- the brief


def risk_profile(
    planned_td_m: float,
    predicted: list[tops_module.PredictedTop],
    offsets: list[dict[str, Any]],
    surveys: dict[str, list[dict[str, Any]]],
    offset_tops: dict[tuple[str, str], float],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """L1-only fused score per interval and risk type (rows with an unknown l1 are left out)."""
    rows = []
    for md_from, md_to in interval_bounds(planned_td_m):
        mid = (md_from + md_to) / 2
        top, next_md = formation_at(predicted, mid)
        if top is None:
            continue
        relative = None
        if next_md is not None and next_md > top.top_md_m:
            relative = min(1.0, max(0.0, (mid - top.top_md_m) / (next_md - top.top_md_m)))
        below_top = mid - top.top_md_m
        in_formation = []
        for offset in offsets:
            offset_top = offset_tops.get((offset["wellbore_id"], top.formation))
            if offset_top is None:
                continue  # that offset did not drill the formation
            offset_tvd = tvd_at_md(surveys.get(offset["wellbore_id"], []), offset_top + below_top)
            in_formation.append(
                {
                    "wellbore_id": offset["wellbore_id"], "well_name": offset["well_name"], "drilled": True,
                    "depth_distance_m": depth_distance_m(offset["surface_distance_m"], mid, offset_tvd),
                    "top_md_m": offset_top,
                }  # fmt: skip
            )
        interval = {"md_from_m": md_from, "md_to_m": md_to, "md_mid_m": mid, "formation": top.formation,
                    "relative_depth": relative, "top_md_m": top.top_md_m}  # fmt: skip
        for result in compute_l1(interval, in_formation, [e for e in events if e["formation"] == top.formation]):
            if result.l1 is None:
                continue
            fused = fuse(result.l1, None, None)
            confidence, _ = confidence_for(result.n_offsets, result.mean_event_conf, result.n_unreviewed_events)
            rows.append(
                {"md_from_m": md_from, "md_to_m": md_to, "risk_type": result.risk_type,
                 "fused": round(fused, FUSED_DECIMALS), "band": band_for(fused), "confidence": confidence,
                 "formation": top.formation}  # fmt: skip
            )
    return rows


async def brief(lat: float, lon: float, planned_td_m: float, radius_m: float) -> dict[str, Any]:
    result: dict[str, Any] = {
        "location": {"lat": lat, "lon": lon}, "offsets": [], "predicted_tops": [], "risk_profile": [], "lessons": [],
    }
    offsets = await _offsets_near(lat, lon, radius_m)
    if not offsets:
        return result
    ids = [o["wellbore_id"] for o in offsets]
    result["offsets"] = [
        {"wellbore_id": o["wellbore_id"], "well_name": o["well_name"], "surface_distance_m": round(o["surface_distance_m"], 1)}
        for o in offsets
    ]  # fmt: skip

    basin = main_basin(offsets)
    formations = await db.fetch_all(
        "select name, strat_order from formations " + ("where basin = %(basin)s " if basin else "") + "order by strat_order",
        {"basin": basin} if basin else None,
    )
    distance = {o["wellbore_id"]: float(o["surface_distance_m"]) for o in offsets}
    points = await tops_module.gather_offset_points(distance)
    kbs = [o["kb_elev_m"] for o in offsets if o["kb_elev_m"] is not None]
    kb = sum(kbs) / len(kbs) if kbs else 0.0
    predicted = [
        p
        for f in formations
        if (p := tops_module.predict_for_formation(f["name"], f["strat_order"], points.get(f["name"], []), [], kb))
    ]
    tops_module.enforce_order(predicted)
    result["predicted_tops"] = [
        {"formation": p.formation, "top_md_m": round(p.top_md_m, 1), "uncertainty_m": round(p.uncertainty_m, 1), "n_offsets": p.n_offsets}
        for p in predicted
    ]  # fmt: skip

    surveys = await tops_module._load_survey(ids)
    profile = risk_profile(planned_td_m, predicted, offsets, surveys, await _offset_tops_md(ids), await _offset_events(ids))
    result["risk_profile"] = [{k: v for k, v in row.items() if k != "formation"} for row in profile]

    wanted = {(row["formation"], row["risk_type"]) for row in profile if row["band"] in ELEVATED_BANDS}
    if wanted:
        keep = {(f, et) for f, rt in wanted for et in event_types_for(rt)}
        result["lessons"] = [
            {"id": str(l["id"]), "formation": l["formation"], "event_type": l["event_type"], "title": l["title"],
             "mitigation": l["mitigation"], "well_count": l["well_count"]}  # fmt: skip
            for l in await _lessons(sorted({f for f, _ in wanted}))
            if (l["formation"], l["event_type"]) in keep
        ]
    return result

"""Predicted formation tops from offset wells (BE-12, contract §6 formation_tops, §7 offsets_within).

Inverse-distance weighting of the offsets' actual tops in TVDSS, an uncertainty that
combines the offsets' spread with their leave-one-out error, conversion to MD on the
active wellbore, and a stratigraphic-order fix. Predicted rows are upserted with
source='predicted'; rows with source='actual' are never touched.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from app import db
from app.errors import NwisError
from app.geo.position import md_at_tvd, tvd_at_md
from app.logging import get_logger
from app.models.enums import Provenance, TopSource

logger = get_logger(__name__)

DEFAULT_RADIUS_M = 10000.0
MAX_OFFSETS = 12  # nearest offsets by surface distance
MIN_OFFSETS = 2  # offsets with a top for a formation, else that formation is skipped
IDW_MIN_DISTANCE_M = 100.0  # distances below this are treated as this, so a close offset cannot dominate
MIN_UNCERTAINTY_M = 10.0
ORDER_FIX_GAP_M = 5.0  # a top out of order is moved to the previous top + this


@dataclass
class PredictedTop:
    formation: str
    strat_order: int
    top_tvdss_m: float
    top_md_m: float
    uncertainty_m: float
    n_offsets: int

    def as_response(self) -> dict[str, Any]:
        return {
            "formation": self.formation,
            "top_md_m": round(self.top_md_m, 1),
            "top_tvdss_m": round(self.top_tvdss_m, 1),
            "uncertainty_m": round(self.uncertainty_m, 1),
            "n_offsets": self.n_offsets,
        }


# ---------------------------------------------------------------- pure maths


def _weight(distance_m: float) -> float:
    return 1.0 / max(distance_m, IDW_MIN_DISTANCE_M) ** 2


def idw(points: list[tuple[float, float]]) -> float:
    """Weighted mean of (distance_m, tvdss_m) points, w = 1 / max(d, 100)^2."""
    weights = [_weight(d) for d, _ in points]
    return sum(w * v for w, (_, v) in zip(weights, points)) / sum(weights)


def weighted_spread(points: list[tuple[float, float]], prediction: float) -> float:
    weights = [_weight(d) for d, _ in points]
    return math.sqrt(sum(w * (v - prediction) ** 2 for w, (_, v) in zip(weights, points)) / sum(weights))


def loo_rmse(points: list[tuple[float, float]]) -> float:
    """Leave-one-out RMSE of the same IDW over the offsets (needs at least two points)."""
    errors = [v - idw(points[:i] + points[i + 1 :]) for i, (_, v) in enumerate(points)]
    return math.sqrt(sum(e * e for e in errors) / len(errors))


def uncertainty(points: list[tuple[float, float]], prediction: float) -> float:
    """sqrt(spread^2 + loo_rmse^2), at least MIN_UNCERTAINTY_M."""
    spread = weighted_spread(points, prediction)
    return max(MIN_UNCERTAINTY_M, math.sqrt(spread**2 + loo_rmse(points) ** 2))


def enforce_order(tops: list[PredictedTop]) -> None:
    """Make tops increase with strat_order (in place, in TVDSS and MD).

    A top that is not deeper than the previous one is set to previous + ORDER_FIX_GAP_M and
    its uncertainty widened by the size of the correction.
    """
    tops.sort(key=lambda t: t.strat_order)
    for previous, current in zip(tops, tops[1:]):
        for attr in ("top_tvdss_m", "top_md_m"):
            floor = getattr(previous, attr) + ORDER_FIX_GAP_M
            if getattr(current, attr) < floor:
                current.uncertainty_m += floor - getattr(current, attr)
                setattr(current, attr, floor)


def predict_for_formation(
    formation: str,
    strat_order: int,
    points: list[tuple[float, float]],
    active_stations: list[dict[str, Any]],
    active_kb_m: float,
) -> PredictedTop | None:
    """One formation: IDW in TVDSS, uncertainty, then TVD = TVDSS + KB and MD on the active survey."""
    if len(points) < MIN_OFFSETS:
        return None
    tvdss = idw(points)
    return PredictedTop(
        formation=formation,
        strat_order=strat_order,
        top_tvdss_m=tvdss,
        top_md_m=md_at_tvd(active_stations, tvdss + active_kb_m),
        uncertainty_m=uncertainty(points, tvdss),
        n_offsets=len(points),
    )


# ---------------------------------------------------------------- database


def _by_wellbore(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["wellbore_id"]), []).append(row)
    return grouped


async def _load_survey(wellbore_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    rows = await db.fetch_all(
        "select wellbore_id, md_m, inc_deg, tvd_m, north_m, east_m from survey_stations "
        "where wellbore_id::text = any(%(ids)s::text[]) order by wellbore_id, md_m",
        {"ids": wellbore_ids},
    )
    return _by_wellbore(rows)


async def _load_kb(wellbore_ids: list[str]) -> dict[str, float]:
    rows = await db.fetch_all(
        "select wb.id as wellbore_id, w.kb_elev_m from wellbores wb join wells w on w.id = wb.well_id "
        "where wb.id::text = any(%(ids)s::text[])",
        {"ids": wellbore_ids},
    )
    return {str(r["wellbore_id"]): r["kb_elev_m"] or 0.0 for r in rows}


async def gather_offset_points(distance: dict[str, float]) -> dict[str, list[tuple[float, float]]]:
    """formation -> [(distance_m, tvdss_m)] from the offsets' actual tops (distance maps wellbore id -> metres).

    A top with no TVDSS is converted from its MD through that offset's own survey and KB.
    """
    offset_ids = list(distance)
    tops = await db.fetch_all(
        "select wellbore_id, formation, top_md_m, top_tvdss_m from formation_tops "
        "where source = 'actual' and wellbore_id::text = any(%(ids)s::text[])",
        {"ids": offset_ids},
    )
    surveys = await _load_survey(offset_ids)
    kb = await _load_kb(offset_ids)

    points: dict[str, list[tuple[float, float]]] = {}
    for top in tops:
        wb = str(top["wellbore_id"])
        if wb not in distance:
            continue
        tvdss = top["top_tvdss_m"]
        if tvdss is None:  # compute it from MD through the offset's own survey and KB
            if top["top_md_m"] is None or wb not in surveys:
                continue
            tvdss = tvd_at_md(surveys[wb], top["top_md_m"]) - kb.get(wb, 0.0)
        points.setdefault(top["formation"], []).append((distance[wb], float(tvdss)))
    return points


async def predict_tops(
    wellbore_id: str, radius_m: float = DEFAULT_RADIUS_M, *, store_result: bool = True
) -> list[PredictedTop]:
    """Predict (and, unless store_result is False, store) the formation tops of `wellbore_id` from its offsets."""
    active = await db.fetch_one(
        "select w.basin, w.kb_elev_m from wellbores wb join wells w on w.id = wb.well_id where wb.id = %(id)s",
        {"id": wellbore_id},
    )
    if active is None:
        raise NwisError("NWIS_NOT_FOUND", "Wellbore not found", 404, {"wellbore_id": wellbore_id})
    active_stations = (await _load_survey([wellbore_id])).get(wellbore_id, [])
    if not active_stations:
        raise NwisError(
            "NWIS_BAD_STATE", "The wellbore has no survey stations, so tops cannot be converted to MD", 409,
            {"wellbore_id": wellbore_id},
        )  # fmt: skip

    offsets = await db.call_fn(
        "offsets_within", p_wellbore=wellbore_id, p_radius_m=radius_m, p_md=None, p_mode="surface"
    )
    offsets = sorted(
        (o for o in offsets if str(o["wellbore_id"]) != wellbore_id), key=lambda o: o["surface_distance_m"]
    )[:MAX_OFFSETS]
    if not offsets:
        return []
    distance = {str(o["wellbore_id"]): float(o["surface_distance_m"]) for o in offsets}

    if active["basin"]:
        formations = await db.fetch_all(
            "select name, strat_order from formations where basin = %(basin)s order by strat_order",
            {"basin": active["basin"]},
        )
    else:
        formations = await db.fetch_all("select name, strat_order from formations order by strat_order")

    points = await gather_offset_points(distance)

    active_kb = active["kb_elev_m"] or 0.0
    predicted = [
        p
        for f in formations
        if (p := predict_for_formation(f["name"], f["strat_order"], points.get(f["name"], []), active_stations, active_kb))
    ]
    enforce_order(predicted)
    if store_result:
        await store(wellbore_id, predicted)
    logger.info("predicted_tops wellbore_id=%s offsets=%d tops=%d", wellbore_id, len(offsets), len(predicted))
    return predicted


async def store(wellbore_id: str, tops: list[PredictedTop]) -> None:
    """Upsert source='predicted' rows; the unique key includes source, so actual tops are untouched."""
    if not tops:
        return
    await db.execute_many(
        f"""
        insert into formation_tops (wellbore_id, formation, top_md_m, top_tvdss_m, source, uncertainty_m,
                                    n_offsets, provenance)
        values (%(wellbore_id)s, %(formation)s, %(top_md_m)s, %(top_tvdss_m)s, '{TopSource.PREDICTED.value}',
                %(uncertainty_m)s, %(n_offsets)s, '{Provenance.ANALOG.value}')
        on conflict (wellbore_id, formation, source) do update
        set top_md_m = excluded.top_md_m, top_tvdss_m = excluded.top_tvdss_m,
            uncertainty_m = excluded.uncertainty_m, n_offsets = excluded.n_offsets,
            provenance = excluded.provenance
        """,
        [
            {
                "wellbore_id": wellbore_id,
                "formation": t.formation,
                "top_md_m": t.top_md_m,
                "top_tvdss_m": t.top_tvdss_m,
                "uncertainty_m": t.uncertainty_m,
                "n_offsets": t.n_offsets,
            }
            for t in tops
        ],
    )

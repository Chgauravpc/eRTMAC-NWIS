"""Features and labels for the L2 model (BE-16, contract §6, §11.2-§11.3).

One row per (completed wellbore, 25 m interval). A row describes the state with the bit at the interval
start `md0`; the label for risk type R is "an event of R starts 50-300 m below md0" (the look-ahead window
the model is used for). Every feature reads only depth_series / mud data at or above `md0`, plus data of
*other* wells; nothing of the same well below `md0` (see tests/test_features.py).

`build_dataset(wells, rows_for=None, pool_exclude=None)` lets cross-validation recompute the offset-based
features (`l1`, nearest offset event) without a held-out well's events: rows are made for `rows_for`,
and the offset pool never includes `pool_exclude` (nor the well itself).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Iterable

import numpy as np
import pandas as pd

from app import db
from app.errors import NwisError
from app.geo.position import tvd_at_md
from app.models.enums import RiskType
from app.risk import config, l1 as l1_module

RISK_TYPES = tuple(r.value for r in RiskType)
INTERVAL_M = config.INTERVAL_M
LABEL_FROM_M = config.LOOKAHEAD_MIN_M  # an event 50 m ...
LABEL_TO_M = config.LOOKAHEAD_MAX_M  # ... to 300 m below the interval start
WINDOW_M = 30.0  # trailing window for the channel statistics
MIN_WINDOW_POINTS = 3

STAT_CHANNELS = ("rop_m_h", "torque_knm", "spp_bar", "hookload_kn", "dxc", "gas_total_pct", "flow_ratio")
SERIES_COLUMNS = (
    "rop_m_h", "torque_knm", "spp_bar", "hookload_kn", "flow_in_lpm", "flow_out_lpm", "dxc", "gas_total_pct",
    "mw_sg", "ecd_sg",
)  # fmt: skip
BASE_FEATURES = (
    "strat_order", "relative_depth", "tvd_m", "hole_size_in", "mw_sg", "ecd_sg",
    *[f"{c}_{s}_30m" for c in STAT_CHANNELS for s in ("mean", "slope")],
)  # fmt: skip
MODEL_FEATURES = (*BASE_FEATURES, "l1", "nearest_event_dist_m")  # the per-risk-type model inputs
META_COLUMNS = ("wellbore_id", "well_id", "provenance", "md_from_m")


@dataclass
class WellData:
    wellbore_id: str
    well_id: str
    name: str
    provenance: str
    lon: float
    lat: float
    stations: list[dict[str, Any]]
    series: dict[str, np.ndarray]  # "md_m" plus SERIES_COLUMNS, sorted by md_m (NaN where missing)
    tops: dict[str, float]  # actual formation tops: formation -> md_m
    events: list[dict[str, Any]]  # non-rejected: id, risk_type, formation, md_from_m, relative_depth, review_status, confidence
    sections: list[dict[str, Any]] = field(default_factory=list)  # non-planned hole sections
    kb_elev_m: float = 0.0


# ---------------------------------------------------------------- pure helpers


def surface_distance_m(a: WellData, b: WellData) -> float:
    """Great-circle distance between two surface locations (haversine, mean Earth radius)."""
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dphi, dlmb = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def formation_at(well: WellData, md0: float) -> tuple[str | None, float | None]:
    """(formation, top MD) of the deepest actual top at or above md0: what the bit is in."""
    best = None
    for formation, top in well.tops.items():
        if top <= md0 and (best is None or top > best[1]):
            best = (formation, top)
    return best if best else (None, None)


def thickness_by_formation(wells: Iterable[WellData], strat_order: dict[str, int]) -> dict[str, float]:
    """Median thickness of each formation over the given wells (top to the next-deeper formation's top)."""
    found: dict[str, list[float]] = {}
    for well in wells:
        ordered = sorted((f for f in well.tops if f in strat_order), key=lambda f: strat_order[f])
        for upper, lower in zip(ordered, ordered[1:]):
            gap = well.tops[lower] - well.tops[upper]
            if gap > 0:
                found.setdefault(upper, []).append(gap)
    return {f: float(median(v)) for f, v in found.items()}


def _last_value(values: np.ndarray, md: np.ndarray, md0: float) -> float:
    ok = (md <= md0) & ~np.isnan(values)
    return float(values[ok][-1]) if ok.any() else math.nan


def window_stats(series: dict[str, np.ndarray], md0: float) -> dict[str, float]:
    """mean and slope (change over the window) of each channel over (md0 - 30 m, md0]. Reads only md <= md0."""
    md = series["md_m"]
    in_window = (md > md0 - WINDOW_M) & (md <= md0)
    flow_in, flow_out = series["flow_in_lpm"], series["flow_out_lpm"]
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(flow_in > 0, flow_out / flow_in, np.nan)
    out: dict[str, float] = {}
    for channel in STAT_CHANNELS:
        values = ratio if channel == "flow_ratio" else series[channel]
        ok = in_window & ~np.isnan(values)
        if ok.sum() < MIN_WINDOW_POINTS:
            out[f"{channel}_mean_30m"] = out[f"{channel}_slope_30m"] = math.nan
            continue
        x, y = md[ok], values[ok]
        out[f"{channel}_mean_30m"] = float(y.mean())
        out[f"{channel}_slope_30m"] = float(np.polyfit(x, y, 1)[0] * WINDOW_M) if np.ptp(x) > 0 else 0.0
    return out


def base_features(
    well: WellData, md0: float, strat_order: dict[str, int], thickness: dict[str, float]
) -> tuple[dict[str, float], str | None, float | None]:
    """BASE_FEATURES at md0, plus the formation and its top. Reads only well data at or above md0."""
    formation, top = formation_at(well, md0)
    rel = math.nan
    if formation is not None and formation in thickness and thickness[formation] > 0:
        rel = min(1.0, max(0.0, (md0 - top) / thickness[formation]))  # estimated: the well's own next top is below md0
    section = next((s for s in well.sections if s["md_from_m"] is not None and s["md_to_m"] is not None
                    and s["md_from_m"] <= md0 < s["md_to_m"]), None)  # fmt: skip
    causal_stations = [s for s in well.stations if s["md_m"] <= md0]
    md = well.series["md_m"]
    features = {
        "strat_order": float(strat_order[formation]) if formation in strat_order else math.nan,
        "relative_depth": rel,
        "tvd_m": tvd_at_md(causal_stations, md0) if causal_stations else math.nan,
        "hole_size_in": float(section["hole_size_in"]) if section and section.get("hole_size_in") is not None else math.nan,
        "mw_sg": _last_value(well.series["mw_sg"], md, md0),
        "ecd_sg": _last_value(well.series["ecd_sg"], md, md0),
        **window_stats(well.series, md0),
    }
    return features, formation, top


def labels(well: WellData, md0: float) -> dict[str, int]:
    """y_<risk> = 1 if an event of that risk type starts in [md0 + 50, md0 + 300]."""
    return {
        f"y_{risk}": int(
            any(e["risk_type"] == risk and md0 + LABEL_FROM_M <= e["md_from_m"] <= md0 + LABEL_TO_M for e in well.events)
        )
        for risk in RISK_TYPES
    }


def offset_features(
    well: WellData, md0: float, formation: str | None, top: float | None, rel: float, pool: list[WellData]
) -> dict[str, float]:
    """l1_<risk> and nearest_<risk> from the offset pool (other wells only)."""
    nan = {f"{p}_{r}": math.nan for p in ("l1", "nearest") for r in RISK_TYPES}
    if formation is None or top is None:
        return nan
    tvd_here = tvd_at_md([s for s in well.stations if s["md_m"] <= md0], md0)
    offsets, events = [], []
    depth_below_top = md0 - top
    for other in pool:
        other_top = other.tops.get(formation)
        if other_top is None:
            continue  # did not drill the formation
        equivalent = other_top + depth_below_top
        distance = math.hypot(surface_distance_m(well, other), tvd_here - tvd_at_md(other.stations, equivalent))
        if distance > config.RADIUS_M:
            continue
        offsets.append({"wellbore_id": other.wellbore_id, "well_name": other.name, "depth_distance_m": distance,
                        "drilled": True, "top_md_m": other_top})  # fmt: skip
        events += [{**e, "wellbore_id": other.wellbore_id} for e in other.events if e["formation"] == formation]

    interval = {"md_from_m": md0, "md_to_m": md0 + INTERVAL_M, "md_mid_m": md0 + INTERVAL_M / 2, "formation": formation,
                "relative_depth": None if math.isnan(rel) else rel, "top_md_m": top}  # fmt: skip
    result = {r.risk_type: r.l1 for r in l1_module.compute_l1(interval, offsets, events, RISK_TYPES)}
    out = {}
    for risk in RISK_TYPES:
        out[f"l1_{risk}"] = math.nan if result[risk] is None else result[risk]
        gaps = [
            abs((e["md_from_m"] - next(o["top_md_m"] for o in offsets if o["wellbore_id"] == e["wellbore_id"])) - depth_below_top)
            for e in events if e["risk_type"] == risk
        ]  # fmt: skip
        out[f"nearest_{risk}"] = float(min(gaps)) if gaps else math.nan
    return out


def interval_starts(well: WellData) -> np.ndarray:
    md = well.series["md_m"]
    if md.size == 0:
        return np.array([])
    return np.arange(math.ceil(md.min() / INTERVAL_M) * INTERVAL_M, md.max(), INTERVAL_M)


def build_dataset(
    wells: list[WellData],
    strat_order: dict[str, int],
    rows_for: set[str] | None = None,
    pool_exclude: set[str] | None = None,
) -> pd.DataFrame:
    """Rows for the wellbores in `rows_for` (default all); offsets never include `pool_exclude` or the well itself."""
    pool_exclude = pool_exclude or set()
    pool_all = [w for w in wells if w.wellbore_id not in pool_exclude]
    rows = []
    for well in wells:
        if rows_for is not None and well.wellbore_id not in rows_for:
            continue
        pool = [w for w in pool_all if w.wellbore_id != well.wellbore_id]
        thickness = thickness_by_formation(pool, strat_order)  # other wells only: the well's own deeper tops must not leak
        for md0 in interval_starts(well):
            features, formation, top = base_features(well, float(md0), strat_order, thickness)
            rows.append(
                {
                    "wellbore_id": well.wellbore_id, "well_id": well.well_id, "provenance": well.provenance,
                    "md_from_m": float(md0), **features,
                    **offset_features(well, float(md0), formation, top, features["relative_depth"], pool),
                    **labels(well, float(md0)),
                }  # fmt: skip
            )
    return pd.DataFrame(rows)


def matrix_for(frame: pd.DataFrame, risk_type: str) -> pd.DataFrame:
    """The model inputs for one risk type: shared features plus that type's l1 and nearest-event distance."""
    x = frame[list(BASE_FEATURES)].copy()
    x["l1"] = frame[f"l1_{risk_type}"]
    x["nearest_event_dist_m"] = frame[f"nearest_{risk_type}"]
    return x[list(MODEL_FEATURES)]


# ---------------------------------------------------------------- loading from the database


def _series_arrays(rows: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    rows = sorted(rows, key=lambda r: r["md_m"])
    arrays = {"md_m": np.array([r["md_m"] for r in rows], dtype=float)}
    for column in SERIES_COLUMNS:
        arrays[column] = np.array([math.nan if r.get(column) is None else r[column] for r in rows], dtype=float)
    return arrays


async def load_wells() -> tuple[list[WellData], dict[str, int]]:
    """Every completed primary wellbore with its survey, series, actual tops, events and sections."""
    heads = await db.fetch_all(
        """
        select wb.id as wellbore_id, w.id as well_id, w.name, w.provenance::text as provenance,
               w.kb_elev_m, ST_X(w.surface::geometry) as lon, ST_Y(w.surface::geometry) as lat
        from wellbores wb join wells w on w.id = wb.well_id
        where w.status = 'completed' and wb.is_primary order by w.name
        """
    )
    strat_order = {r["name"]: r["strat_order"] for r in await db.fetch_all("select name, strat_order from formations")}
    wells = []
    for head in heads:
        wb = str(head["wellbore_id"])
        params = {"id": wb}
        series = await db.fetch_all(
            f"select md_m, {', '.join(SERIES_COLUMNS)} from depth_series where wellbore_id = %(id)s order by md_m", params
        )
        if not series:
            continue
        stations = await db.fetch_all(
            "select md_m, inc_deg, tvd_m, north_m, east_m from survey_stations where wellbore_id = %(id)s order by md_m", params
        )
        tops = await db.fetch_all(
            "select formation, top_md_m from formation_tops where wellbore_id = %(id)s and source = 'actual'", params
        )
        events = await db.fetch_all(
            "select id, event_type::text, risk_type::text as risk_type, formation, md_from_m, relative_depth, "
            "review_status::text as review_status, confidence from events "
            "where wellbore_id = %(id)s and review_status <> 'rejected' and risk_type is not null", params
        )
        sections = await db.fetch_all(
            "select hole_size_in, md_from_m, md_to_m from hole_sections where wellbore_id = %(id)s and planned = false", params
        )
        wells.append(
            WellData(
                wellbore_id=wb, well_id=str(head["well_id"]), name=head["name"], provenance=head["provenance"],
                lon=head["lon"], lat=head["lat"], kb_elev_m=head["kb_elev_m"] or 0.0, stations=stations,
                series=_series_arrays(series), tops={t["formation"]: t["top_md_m"] for t in tops},
                events=events, sections=sections,
            )  # fmt: skip
        )
    return wells, strat_order


async def load_well_at(wellbore_id: str, bit_md_m: float, lookback_m: float) -> WellData:
    """One wellbore (any status) as it is with the bit at `bit_md_m`: only rows at or above the bit, and only
    the last `lookback_m` of depth_series (enough for the trailing statistics and the latest mud values)."""
    params = {"id": wellbore_id, "hi": bit_md_m, "lo": bit_md_m - lookback_m}
    head = await db.fetch_one(
        """
        select wb.id as wellbore_id, w.id as well_id, w.name, w.provenance::text as provenance, w.kb_elev_m,
               ST_X(w.surface::geometry) as lon, ST_Y(w.surface::geometry) as lat
        from wellbores wb join wells w on w.id = wb.well_id where wb.id = %(id)s
        """,
        params,
    )
    if head is None:
        raise NwisError("NWIS_NOT_FOUND", "Wellbore not found", 404, {"wellbore_id": wellbore_id})
    series = await db.fetch_all(
        f"select md_m, {', '.join(SERIES_COLUMNS)} from depth_series "
        "where wellbore_id = %(id)s and md_m > %(lo)s and md_m <= %(hi)s order by md_m",
        params,
    )
    stations = await db.fetch_all(
        "select md_m, inc_deg, tvd_m, north_m, east_m from survey_stations "
        "where wellbore_id = %(id)s and md_m <= %(hi)s order by md_m",
        params,
    )
    tops = await db.fetch_all(
        "select formation, top_md_m from formation_tops "
        "where wellbore_id = %(id)s and source = 'actual' and top_md_m <= %(hi)s",
        params,
    )
    sections = await db.fetch_all(
        "select hole_size_in, md_from_m, md_to_m from hole_sections where wellbore_id = %(id)s and planned = false",
        params,
    )
    return WellData(
        wellbore_id=str(head["wellbore_id"]), well_id=str(head["well_id"]), name=head["name"],
        provenance=head["provenance"], lon=head["lon"], lat=head["lat"], kb_elev_m=head["kb_elev_m"] or 0.0,
        stations=stations, series=_series_arrays(series), tops={t["formation"]: t["top_md_m"] for t in tops},
        events=[], sections=sections,
    )  # fmt: skip

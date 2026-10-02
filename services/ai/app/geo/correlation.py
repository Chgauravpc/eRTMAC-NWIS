"""Well-to-well correlation data (BE-13, contract §9.3).

For the active wellbore and up to six offsets: formation tops (actual > predicted >
prognosis), the shift that lines the flatten formation up with the active well,
casing shoes, events and down-sampled log tracks. Rows below the bit of a well that is
being drilled are never returned (contract §6 depth_series NOTE, §8).
"""

from __future__ import annotations

import math
from typing import Any
from uuid import UUID

from app import db
from app.errors import NwisError
from app.geo.tops import DEFAULT_RADIUS_M
from app.ingest.normalize import get_resolver

# contract §6 depth_series numeric columns; also the SQL-injection whitelist for `channels`
ALLOWED_CHANNELS = (
    "rop_m_h", "wob_kn", "rpm", "torque_knm", "spp_bar", "flow_in_lpm", "flow_out_lpm",
    "pit_vol_m3", "hookload_kn", "mw_sg", "ecd_sg", "gas_total_pct", "dxc", "gr_api",
)  # fmt: skip
DEFAULT_CHANNELS = ("gr_api", "rop_m_h", "mw_sg", "ecd_sg")  # the channels in the §9.3 example
SPIKE_CHANNEL = "torque_knm"  # kept at its maximum when a bucket is thinned

DEFAULT_OFFSETS = 4
MAX_OFFSETS = 6
MAX_POINTS = 2000

_SOURCE_PRIORITY = {"actual": 0, "predicted": 1, "prognosis": 2}


def _bad_request(message: str, details: dict | None = None) -> NwisError:
    return NwisError("NWIS_BAD_REQUEST", message, 400, details)


# ---------------------------------------------------------------- parsing and pure helpers


def _csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def parse_channels(value: str | None) -> list[str]:
    channels = list(dict.fromkeys(_csv(value))) or list(DEFAULT_CHANNELS)
    unknown = [c for c in channels if c not in ALLOWED_CHANNELS]
    if unknown:
        raise _bad_request("Unknown channel", {"channels": unknown, "allowed": list(ALLOWED_CHANNELS)})
    return channels


def parse_offsets(value: str | None, active: str) -> list[str]:
    ids = []
    for raw in _csv(value):
        try:
            ids.append(str(UUID(raw)))
        except ValueError as exc:
            raise _bad_request("offsets must be comma-separated uuids", {"offset": raw}) from exc
    ids = [i for i in dict.fromkeys(ids) if i != active]
    if len(ids) > MAX_OFFSETS:
        raise _bad_request(f"At most {MAX_OFFSETS} offsets", {"given": len(ids)})
    return ids


def best_tops(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One top per formation (actual > predicted > prognosis), shallowest first."""
    best: dict[str, dict[str, Any]] = {}
    for row in rows:
        current = best.get(row["formation"])
        if current is None or _SOURCE_PRIORITY[row["source"]] < _SOURCE_PRIORITY[current["source"]]:
            best[row["formation"]] = row
    return [
        {
            "formation": r["formation"],
            "top_md_m": r["top_md_m"],
            "source": r["source"],
            "uncertainty_m": r.get("uncertainty_m"),
        }
        for r in sorted(best.values(), key=lambda r: r["top_md_m"])
    ]


def top_md(tops: list[dict[str, Any]], formation: str | None) -> float | None:
    return next((t["top_md_m"] for t in tops if t["formation"] == formation), None)


def shift_for(active_top: float | None, offset_top: float | None) -> float | None:
    """Amount added to an offset's MDs so its flatten top meets the active well's; None if either is missing."""
    return None if active_top is None or offset_top is None else active_top - offset_top


def downsample(rows: list[dict[str, Any]], channels: list[str], max_points: int = MAX_POINTS) -> dict[str, list]:
    """Tracks with at most `max_points` rows: every n-th bucket keeps one row.

    When torque is a channel the kept row is the one with the highest torque in its bucket, so a
    spike survives at its true depth; otherwise the first row of the bucket.
    """
    step = max(1, math.ceil(len(rows) / max_points))
    kept = []
    for start in range(0, len(rows), step):
        bucket = rows[start : start + step]
        if SPIKE_CHANNEL in channels:
            kept.append(max(bucket, key=lambda r: r[SPIKE_CHANNEL] if r[SPIKE_CHANNEL] is not None else -math.inf))
        else:
            kept.append(bucket[0])
    return {"md_m": [r["md_m"] for r in kept], **{c: [r[c] for r in kept] for c in channels}}


# ---------------------------------------------------------------- database


async def _nearest_offsets(wellbore_id: str, count: int) -> list[str]:
    rows = await db.call_fn(
        "offsets_within", p_wellbore=wellbore_id, p_radius_m=DEFAULT_RADIUS_M, p_md=None, p_mode="surface"
    )
    rows = sorted((r for r in rows if str(r["wellbore_id"]) != wellbore_id), key=lambda r: r["surface_distance_m"])
    return [str(r["wellbore_id"]) for r in rows[:count]]


async def _tracks(wellbore_id: str, channels: list[str], limit: float | None) -> dict[str, list]:
    columns = ", ".join(channels)  # safe: every name is from ALLOWED_CHANNELS
    sql = f"select md_m, {columns} from depth_series where wellbore_id = %(id)s"
    params: dict[str, Any] = {"id": wellbore_id}
    if limit is not None:
        sql += " and md_m <= %(limit)s"
        params["limit"] = limit
    rows = await db.fetch_all(sql + " order by md_m", params)
    return downsample(rows, channels)


def _group(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["wellbore_id"]), []).append(row)
    return grouped


async def build_correlation(
    wellbore_id: str, offsets: str | None, flatten: str | None, channels: str | None
) -> dict[str, Any]:
    channel_list = parse_channels(channels)
    offset_ids = parse_offsets(offsets, wellbore_id)

    flatten_formation = None
    if flatten and flatten.strip():
        flatten_formation = (await get_resolver()).resolve(flatten)
        if flatten_formation is None:
            raise _bad_request("Unknown flatten formation", {"flatten": flatten})

    if not offset_ids:
        offset_ids = await _nearest_offsets(wellbore_id, DEFAULT_OFFSETS)
    ids = [wellbore_id, *offset_ids]

    names = {
        str(r["id"]): r["name"]
        for r in await db.fetch_all(
            "select wb.id, w.name from wellbores wb join wells w on w.id = wb.well_id "
            "where wb.id::text = any(%(ids)s::text[])",
            {"ids": ids},
        )
    }
    missing = [i for i in ids if i not in names]
    if missing:
        raise NwisError("NWIS_NOT_FOUND", "Wellbore not found", 404, {"wellbore_ids": missing})

    tops = _group(
        await db.fetch_all(
            "select wellbore_id, formation, top_md_m, source::text as source, uncertainty_m from formation_tops "
            "where wellbore_id::text = any(%(ids)s::text[])",
            {"ids": ids},
        )
    )
    events = _group(
        await db.fetch_all(
            "select wellbore_id, id, event_type::text as event_type, md_from_m, severity, description from events "
            "where review_status <> 'rejected' and wellbore_id::text = any(%(ids)s::text[]) order by md_from_m",
            {"ids": ids},
        )
    )
    casing = _group(
        await db.fetch_all(
            "select wellbore_id, casing_od_in, shoe_md_m from hole_sections "
            "where planned = false and shoe_md_m is not null and wellbore_id::text = any(%(ids)s::text[]) "
            "order by shoe_md_m",
            {"ids": ids},
        )
    )

    wells = []
    active_top = None
    for wb in ids:
        well_tops = best_tops(tops.get(wb, []))
        limit = await db.visible_depth_limit(wb)  # None unless the well is being drilled
        entry: dict[str, Any] = {
            "wellbore_id": wb,
            "name": names[wb],
            "is_active": wb == wellbore_id,
            "shift_m": 0.0,
            "tops": well_tops,
            "casing": [
                {"casing_od_in": c["casing_od_in"], "shoe_md_m": c["shoe_md_m"]}
                for c in casing.get(wb, [])
                if limit is None or c["shoe_md_m"] <= limit
            ],
            "events": [
                {
                    "id": str(e["id"]),
                    "event_type": e["event_type"],
                    "md_from_m": e["md_from_m"],
                    "severity": e["severity"],
                    "description": e["description"],
                }
                for e in events.get(wb, [])
                if limit is None or e["md_from_m"] <= limit
            ],
            "tracks": await _tracks(wb, channel_list, limit),
        }
        if wb == wellbore_id:
            active_top = top_md(well_tops, flatten_formation)
            if flatten_formation and active_top is None:
                entry["flatten_missing"] = True
        wells.append(entry)

    if flatten_formation:
        for entry in wells[1:]:
            shift = shift_for(active_top, top_md(entry["tops"], flatten_formation))
            if shift is None:
                entry["flatten_missing"] = True
            else:
                entry["shift_m"] = shift
    return {"flatten_formation": flatten_formation, "wells": wells}

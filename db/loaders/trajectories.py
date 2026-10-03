"""Trajectory builder (DB-08): Minimum Curvature Method for survey stations, and the PostGIS line.

  python -m db.loaders.trajectories --all                  # rebuild every wellbore that has stations
  python -m db.loaders.trajectories --wellbore <uuid>

`mcm` turns (md, inclination, azimuth) into (tvd, north, east, dogleg). `build_trajectory` writes those into
`survey_stations` and (re)builds `trajectories.geom`, a LineStringZ (lon, lat, tvd) whose points use the same
two ST_Project calls as the SQL function `well_position_at_md`, so the two always agree.
"""

from __future__ import annotations

import argparse
from typing import Any

import numpy as np

from .common import get_conn


def _tie_in(md: np.ndarray, inc: np.ndarray, azi: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Prepend a vertical tie-in at the surface when the first station is not at md 0."""
    if md.size and md[0] > 0:
        return np.concatenate([[0.0], md]), np.concatenate([[0.0], inc]), np.concatenate([[0.0], azi])
    return md, inc, azi


def mcm(md_m, inc_deg, azi_deg) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Minimum Curvature Method.

    Returns (tvd, north, east, dls_deg_per_30m), one value per input station. If the first station is below
    the surface a vertical tie-in at md 0 is assumed (and not returned). All positions are metres from the
    surface location; the dogleg of the first station is 0.
    """
    md, inc, azi = (np.asarray(a, dtype=float) for a in (md_m, inc_deg, azi_deg))
    if not (md.shape == inc.shape == azi.shape):
        raise ValueError("md, inclination and azimuth must have the same length")
    if md.size and np.any(np.diff(md) <= 0):
        raise ValueError("measured depths must be strictly increasing")
    had_tie_in = md.size > 0 and md[0] > 0
    md, inc, azi = _tie_in(md, inc, azi)

    i = np.radians(inc)
    a = np.radians(azi)
    i1, i2 = i[:-1], i[1:]
    a1, a2 = a[:-1], a[1:]
    dmd = np.diff(md)

    # dogleg angle between consecutive stations; clamp the arccos input against rounding
    cos_beta = np.cos(i2 - i1) - np.sin(i1) * np.sin(i2) * (1 - np.cos(a2 - a1))
    beta = np.arccos(np.clip(cos_beta, -1.0, 1.0))
    # ratio factor RF = (2/beta) * tan(beta/2), 1 for a straight segment
    small = beta < 1e-6
    safe_beta = np.where(small, 1.0, beta)
    rf = np.where(small, 1.0, 2.0 / safe_beta * np.tan(safe_beta / 2.0))

    d_n = dmd / 2.0 * (np.sin(i1) * np.cos(a1) + np.sin(i2) * np.cos(a2)) * rf
    d_e = dmd / 2.0 * (np.sin(i1) * np.sin(a1) + np.sin(i2) * np.sin(a2)) * rf
    d_v = dmd / 2.0 * (np.cos(i1) + np.cos(i2)) * rf

    north = np.concatenate([[0.0], np.cumsum(d_n)])
    east = np.concatenate([[0.0], np.cumsum(d_e)])
    tvd = np.concatenate([[0.0], np.cumsum(d_v)])
    dls = np.concatenate([[0.0], np.degrees(beta) * 30.0 / dmd])

    if had_tie_in:
        return tvd[1:], north[1:], east[1:], dls[1:]
    return tvd, north, east, dls


_GEOM_SQL = """
insert into trajectories (wellbore_id, geom)
select %(wb)s::uuid, ST_SetSRID(ST_MakeLine(q.pt order by q.md_m), 4326)
from (
  select ss.md_m,
         ST_MakePoint(ST_X(p.g::geometry), ST_Y(p.g::geometry), ss.tvd_m) as pt
  from survey_stations ss
  join wellbores wb on wb.id = ss.wellbore_id
  join wells w on w.id = wb.well_id
  cross join lateral (
    select ST_Project(
             ST_Project(w.surface, abs(ss.north_m)::float8, case when ss.north_m >= 0 then 0.0 else pi() end),
             abs(ss.east_m)::float8, case when ss.east_m >= 0 then pi() / 2.0 else 3.0 * pi() / 2.0 end
           ) as g
  ) p
  where ss.wellbore_id = %(wb)s::uuid
) q
having count(*) >= 2
on conflict (wellbore_id) do update set geom = excluded.geom
"""


def build_trajectory(conn, wellbore_id: str) -> int:
    """Compute tvd / north / east / dls for the wellbore's stations and rebuild its trajectory line.

    Returns the number of stations updated (0 when the wellbore has none). Does not commit.
    """
    with conn.cursor() as cur:
        cur.execute("select md_m, inc_deg, azi_deg from survey_stations where wellbore_id = %s order by md_m", (wellbore_id,))
        rows = cur.fetchall()
        if not rows:
            return 0
        md, inc, azi = (np.array(c, dtype=float) for c in zip(*rows))
        tvd, north, east, dls = mcm(md, inc, azi)
        cur.executemany(
            "update survey_stations set tvd_m = %s, north_m = %s, east_m = %s, dls_deg_per_30m = %s where wellbore_id = %s and md_m = %s",
            [(float(t), float(n), float(e), float(d), wellbore_id, float(m)) for t, n, e, d, m in zip(tvd, north, east, dls, md)],
        )
        cur.execute(_GEOM_SQL, {"wb": wellbore_id})
    return len(rows)


def build_all(conn) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("select distinct wellbore_id::text from survey_stations order by 1")
        ids = [r[0] for r in cur.fetchall()]
    built = sum(1 for wb in ids if build_trajectory(conn, wb) > 0)
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("select count(*) from wellbores wb where not exists (select 1 from trajectories t where t.wellbore_id = wb.id)")
        without = cur.fetchone()[0]
    return {"built": built, "wellbores_without_trajectory": without}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="rebuild every wellbore that has survey stations")
    group.add_argument("--wellbore", metavar="UUID", help="rebuild one wellbore")
    args = ap.parse_args(argv)
    with get_conn() as conn:
        if args.all:
            print(build_all(conn))
        else:
            n = build_trajectory(conn, args.wellbore)
            conn.commit()
            print(f"{n} stations updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

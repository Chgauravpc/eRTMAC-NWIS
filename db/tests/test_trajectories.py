"""DB-08: Minimum Curvature Method and the trajectory builder.

Run from the repo root with the backend's virtualenv:
  services/ai/.venv/Scripts/python -m pytest db/tests/test_trajectories.py
The last test needs SUPABASE_DB_URL (repo-root .env) and rolls back everything it writes.
"""

from __future__ import annotations

import math
import sys
import uuid
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from db.loaders.common import UNIT_FACTORS, to_si  # noqa: E402
from db.loaders.trajectories import mcm  # noqa: E402


def test_vertical_well_has_tvd_equal_to_md_and_no_displacement():
    md = np.arange(0, 3001, 30.0)
    tvd, north, east, dls = mcm(md, np.zeros_like(md), np.zeros_like(md))
    assert np.allclose(tvd, md)
    assert np.allclose(north, 0) and np.allclose(east, 0)
    assert np.allclose(dls, 0)


def test_constant_90_degrees_east_moves_east_only():
    # a hold at 90 degrees inclination, azimuth 90, from md 1000 to 2000: 1000 m of easting and nothing else
    tvd, north, east, _ = mcm([1000.0, 1500.0, 2000.0], np.full(3, 90.0), np.full(3, 90.0))
    assert east[-1] - east[0] == pytest.approx(1000.0, abs=1e-6)
    assert tvd[-1] - tvd[0] == pytest.approx(0.0, abs=1e-6)
    assert north[-1] - north[0] == pytest.approx(0.0, abs=1e-6)


def test_build_section_matches_the_exact_circular_arc():
    # Stations every 30 m along a 3 deg / 30 m build from vertical to 90 deg (azimuth 0): a circular arc of radius
    # R = 30 / (3 deg in rad). MCM is exact on a circular arc, so TVD = R sin(theta) and displacement = R (1 - cos(theta)).
    step_deg = 3.0
    n = int(90 / step_deg)
    md = np.arange(0, n + 1) * 30.0
    inc = np.arange(0, n + 1) * step_deg
    azi = np.zeros_like(md)
    tvd, north, east, dls = mcm(md, inc, azi)
    radius = 30.0 / math.radians(step_deg)
    theta = np.radians(inc)
    assert np.allclose(tvd, radius * np.sin(theta), atol=0.1)
    assert np.allclose(north, radius * (1 - np.cos(theta)), atol=0.1)
    assert np.allclose(east, 0, atol=1e-9)
    assert tvd[-1] == pytest.approx(572.958, abs=0.1) and north[-1] == pytest.approx(572.958, abs=0.1)
    assert np.allclose(dls[1:], step_deg, atol=1e-6)  # 3 degrees per 30 m everywhere on the arc


def test_first_station_below_surface_assumes_a_vertical_tie_in():
    tvd, north, east, dls = mcm([100.0, 130.0], [0.0, 3.0], [0.0, 0.0])
    assert tvd[0] == pytest.approx(100.0)
    assert north[0] == 0 and east[0] == 0
    assert len(tvd) == 2  # the tie-in is not returned


def test_azimuth_wraps_around_north():
    # a turn across north (350 -> 10 degrees) is a 20 degree change in direction, not 340
    _, _, _, dls = mcm([0.0, 30.0, 60.0], [10.0, 10.0, 10.0], [350.0, 0.0, 10.0])
    assert dls[1] < 4.0 and dls[2] < 4.0


def test_rejects_unsorted_or_mismatched_input():
    with pytest.raises(ValueError):
        mcm([0.0, 50.0, 40.0], [0, 0, 0], [0, 0, 0])
    with pytest.raises(ValueError):
        mcm([0.0, 50.0], [0], [0, 0])


def test_unit_conversions_use_the_contract_factors():
    assert to_si(1000, "ft") == pytest.approx(304.8)
    assert to_si(8.345, "ppg") == pytest.approx(1.0)
    assert to_si(10, "bbl") == pytest.approx(1.58987)
    assert to_si(100, "gpm") == pytest.approx(378.541)
    assert to_si(1000, "psi") == pytest.approx(68.9476)
    assert to_si(10, "klbf") == pytest.approx(44.4822)
    assert to_si(10, "kft.lbf") == pytest.approx(13.5582)
    assert to_si(100, "ft/h") == pytest.approx(30.48)
    assert to_si(None, "ft") is None
    assert set(UNIT_FACTORS) == {"ft", "ppg", "bbl", "gpm", "psi", "klbf", "kft.lbf", "ft/h"}
    with pytest.raises(ValueError):
        to_si(1, "furlong")


def test_built_trajectory_agrees_with_the_database_function_and_rolls_back():
    pytest.importorskip("psycopg")
    try:
        from db.loaders.common import get_conn

        conn = get_conn()
    except SystemExit:
        pytest.skip("SUPABASE_DB_URL is not set")
    from db.loaders.trajectories import build_trajectory

    well, wb = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with conn.cursor() as cur:
            cur.execute(
                "insert into wells (id, name, surface, provenance) values (%s, %s, ST_GeogFromText('SRID=4326;POINT(95.31 27.36)'), 'synthetic')",
                (well, "SYN-TRAJ-TEST-" + well[:8]),
            )
            cur.execute("insert into wellbores (id, well_id, name) values (%s, %s, %s)", (wb, well, "SYN-TRAJ-TEST-WB-" + well[:8]))
            # a build to 60 degrees towards north-east, then a hold; tvd / north / east are placeholders the builder fills in
            md = np.arange(0.0, 2401.0, 30.0)
            inc = np.where(md < 900, 0.0, np.minimum((md - 900) / 30 * 2.5, 60.0))
            azi = np.full_like(md, 45.0)
            cur.executemany(
                "insert into survey_stations (wellbore_id, md_m, inc_deg, azi_deg, tvd_m, north_m, east_m) values (%s, %s, %s, %s, 0, 0, 0)",
                [(wb, float(m), float(i), float(a)) for m, i, a in zip(md, inc, azi)],
            )
            assert build_trajectory(conn, wb) == len(md)

            cur.execute("select md_m, tvd_m, north_m, east_m from survey_stations where wellbore_id = %s order by md_m", (wb,))
            rows = cur.fetchall()
            tvd, north, east, _ = mcm(md, inc, azi)
            assert [r[1] for r in rows] == pytest.approx(list(tvd), abs=0.01)
            assert rows[-1][2] > 0 and rows[-1][3] > 0  # north-east

            cur.execute("select ST_NPoints(geom), ST_ZMax(geom), ST_SRID(geom), GeometryType(geom) from trajectories where wellbore_id = %s", (wb,))
            npoints, zmax, srid, gtype = cur.fetchone()
            assert npoints == len(md) and srid == 4326 and gtype == "LINESTRING"
            assert zmax == pytest.approx(float(tvd[-1]), abs=0.01)

            # the last point of the line is where well_position_at_md puts the last station
            cur.execute("select lon, lat, tvd_m from well_position_at_md(%s::uuid, %s::real)", (wb, float(md[-1])))
            lon, lat, tvd_fn = cur.fetchone()
            cur.execute("select ST_X(ST_EndPoint(geom)), ST_Y(ST_EndPoint(geom)), ST_Z(ST_EndPoint(geom)) from trajectories where wellbore_id = %s", (wb,))
            elon, elat, ez = cur.fetchone()
            assert (elon, elat) == pytest.approx((lon, lat), abs=1e-9)
            assert ez == pytest.approx(tvd_fn, abs=0.01)
    finally:
        conn.rollback()
        conn.close()

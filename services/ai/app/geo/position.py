"""Well position helpers (BE-12): a Python mirror of contract §7 `well_position_at_md`.

Used by unit tests and by the planning brief, and for the MD <-> TVD conversions the
formation-top predictor needs. Stations are dicts with md_m, tvd_m, inc_deg, north_m,
east_m (the `survey_stations` columns), sorted by md_m.

`position_at_md` mirrors the SQL function exactly: linear interpolation of north, east
and tvd, clamped to the first and last station, and a vertical well at the surface when
there are no stations. `tvd_at_md` and `md_at_tvd` instead *extend* past the last
station along its inclination, because a top can lie deeper than the last survey.
"""

from __future__ import annotations

import math
from typing import Any, Sequence

Station = dict[str, Any]

# WGS84 ellipsoid (what PostGIS ST_Project uses on geography)
_A = 6378137.0
_F = 1 / 298.257223563
_B = _A * (1 - _F)

# Below this, cos(inclination) is treated as this value when extending past the last
# station, so a near-horizontal last station cannot turn 1 m of TVD into kilometres of MD.
MIN_COS_INC = 0.1


def _interp(x: float, x1: float, x2: float, y1: float, y2: float) -> float:
    return y1 if x2 <= x1 else y1 + (x - x1) / (x2 - x1) * (y2 - y1)


def interpolate(stations: Sequence[Station], md: float) -> tuple[float, float, float]:
    """(north_m, east_m, tvd_m) at `md`, clamped to the surveyed range like the SQL function."""
    if not stations:
        return 0.0, 0.0, md
    if md <= stations[0]["md_m"]:
        s = stations[0]
        return s["north_m"], s["east_m"], s["tvd_m"]
    if md >= stations[-1]["md_m"]:
        s = stations[-1]
        return s["north_m"], s["east_m"], s["tvd_m"]
    for s1, s2 in zip(stations, stations[1:]):
        if s1["md_m"] <= md <= s2["md_m"]:
            return tuple(  # type: ignore[return-value]
                _interp(md, s1["md_m"], s2["md_m"], s1[k], s2[k]) for k in ("north_m", "east_m", "tvd_m")
            )
    raise AssertionError("unreachable: md is inside the surveyed range")


def vincenty_direct(lon: float, lat: float, azimuth_rad: float, distance_m: float) -> tuple[float, float]:
    """Point reached from (lon, lat) travelling `distance_m` on `azimuth_rad` over the WGS84 ellipsoid."""
    if distance_m == 0:
        return lon, lat
    u1 = math.atan((1 - _F) * math.tan(math.radians(lat)))
    sin_u1, cos_u1 = math.sin(u1), math.cos(u1)
    sin_a1, cos_a1 = math.sin(azimuth_rad), math.cos(azimuth_rad)
    sigma1 = math.atan2(math.tan(u1), cos_a1)
    sin_alpha = cos_u1 * sin_a1
    cos2_alpha = 1 - sin_alpha**2
    u2 = cos2_alpha * (_A**2 - _B**2) / _B**2
    big_a = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    big_b = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    sigma = distance_m / (_B * big_a)
    for _ in range(100):
        cos_2sm = math.cos(2 * sigma1 + sigma)
        sin_s, cos_s = math.sin(sigma), math.cos(sigma)
        delta = big_b * sin_s * (
            cos_2sm
            + big_b / 4 * (cos_s * (-1 + 2 * cos_2sm**2) - big_b / 6 * cos_2sm * (-3 + 4 * sin_s**2) * (-3 + 4 * cos_2sm**2))
        )
        new_sigma = distance_m / (_B * big_a) + delta
        converged = abs(new_sigma - sigma) < 1e-12
        sigma = new_sigma
        if converged:
            break
    sin_s, cos_s = math.sin(sigma), math.cos(sigma)
    cos_2sm = math.cos(2 * sigma1 + sigma)
    x = sin_u1 * sin_s - cos_u1 * cos_s * cos_a1
    lat2 = math.atan2(
        sin_u1 * cos_s + cos_u1 * sin_s * cos_a1, (1 - _F) * math.hypot(sin_alpha, x)
    )
    lam = math.atan2(sin_s * sin_a1, cos_u1 * cos_s - sin_u1 * sin_s * cos_a1)
    c = _F / 16 * cos2_alpha * (4 + _F * (4 - 3 * cos2_alpha))
    big_l = lam - (1 - c) * _F * sin_alpha * (
        sigma + c * sin_s * (cos_2sm + c * cos_s * (-1 + 2 * cos_2sm**2))
    )
    return lon + math.degrees(big_l), math.degrees(lat2)


def position_at_md(
    surface_lon: float, surface_lat: float, stations: Sequence[Station], md: float
) -> tuple[float, float, float]:
    """(lon, lat, tvd_m) at `md`; north is projected first, then east (as the SQL function does)."""
    if not stations:
        return surface_lon, surface_lat, md
    north, east, tvd = interpolate(stations, md)
    lon, lat = vincenty_direct(surface_lon, surface_lat, 0.0 if north >= 0 else math.pi, abs(north))
    lon, lat = vincenty_direct(lon, lat, math.pi / 2 if east >= 0 else 3 * math.pi / 2, abs(east))
    return lon, lat, tvd


def _cos_inc(station: Station) -> float:
    return max(math.cos(math.radians(station["inc_deg"])), MIN_COS_INC)


def tvd_at_md(stations: Sequence[Station], md: float) -> float:
    """TVD at `md`; past the last station the well is extended along that station's inclination."""
    if not stations:
        return md
    if md > stations[-1]["md_m"]:
        last = stations[-1]
        return last["tvd_m"] + (md - last["md_m"]) * _cos_inc(last)
    return interpolate(stations, md)[2]


def md_at_tvd(stations: Sequence[Station], tvd: float) -> float:
    """MD where the well first reaches `tvd`, extended past the last station along its inclination."""
    if not stations:
        return tvd
    first, last = stations[0], stations[-1]
    if tvd < first["tvd_m"]:
        return max(0.0, first["md_m"] - (first["tvd_m"] - tvd) / _cos_inc(first))
    for s1, s2 in zip(stations, stations[1:]):
        low, high = sorted((s1["tvd_m"], s2["tvd_m"]))
        if low <= tvd <= high:
            return _interp(tvd, s1["tvd_m"], s2["tvd_m"], s1["md_m"], s2["md_m"])
    if tvd == first["tvd_m"]:
        return first["md_m"]
    return last["md_m"] + (tvd - last["tvd_m"]) / _cos_inc(last)

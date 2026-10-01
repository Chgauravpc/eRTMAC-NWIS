"""Survey and formation-top tables from CSV/Excel DataFrames (BE-06).

Column names are matched by common variants; a unit in the header
(`MD (ft)`, `Top TVDSS [m]`, `MD_ft`) is honoured and converted to the
contract §4 units. With no unit in the header, depths are taken to be metres
and angles degrees.
"""

from __future__ import annotations

import re

import pandas as pd

from app.ingest.parsers.units import UnknownUnitError, is_known_unit, to_si
from app.ingest.parsers.witsml import Station

_MD = {"md", "measured depth", "depth md", "mdepth"}
_INC = {"inc", "incl", "inclination"}
_AZI = {"azi", "azim", "azimuth"}

_FORMATION = {
    "formation", "formation name", "fm", "fm name", "strat unit", "stratigraphic unit",
    "horizon", "marker", "top name", "unit", "name",
}
_TOP_MD = _MD | {"top md", "top measured depth", "top depth md", "top depth", "depth", "top"}
_TOP_TVDSS = {"tvdss", "top tvdss", "tvd ss", "top tvd ss", "depth tvdss", "subsea depth"}


def _split_header(column: object) -> tuple[str, str | None]:
    """`"MD (ft)"` -> ("md", "ft"); `"md_ft"` -> ("md", "ft"); `"Inc"` -> ("inc", None)."""
    text = str(column).strip().lower()
    bracket = re.search(r"[\(\[]\s*([^)\]]*?)\s*[\)\]]", text)
    unit = bracket.group(1) if bracket and bracket.group(1) else None
    name = re.sub(r"[\(\[].*?[\)\]]", "", text)
    name = re.sub(r"\s+", " ", re.sub(r"[_\-.]+", " ", name)).strip()
    if unit is None:
        tokens = name.split()
        if len(tokens) > 1 and is_known_unit(tokens[-1]):
            unit, name = tokens[-1], " ".join(tokens[:-1])
    return name, unit


def _find(frame: pd.DataFrame, names: set[str]) -> tuple[object, str | None] | None:
    for column in frame.columns:
        name, unit = _split_header(column)
        if name in names:
            return column, unit
    return None


def _numbers(series: pd.Series, unit: str | None, default_unit: str, column: object) -> pd.Series:
    cleaned = pd.to_numeric(series.astype(str).str.replace(",", "", regex=False), errors="coerce")
    try:
        factor = to_si(1.0, unit or default_unit)[0]
    except UnknownUnitError as exc:
        raise ValueError(f"column {column!r}: {exc}") from exc
    return cleaned * factor


def parse_survey_table(df: pd.DataFrame) -> list[Station]:
    """Stations (sorted by MD) from a table with MD, inclination and azimuth columns.

    Rows with a missing or non-numeric value are dropped. Raises ValueError when
    one of the three columns cannot be found.
    """
    found = {key: _find(df, names) for key, names in (("md", _MD), ("inc", _INC), ("azi", _AZI))}
    missing = [key for key, hit in found.items() if hit is None]
    if missing:
        raise ValueError(f"survey table is missing column(s): {', '.join(missing)} (have {list(df.columns)})")

    md = _numbers(df[found["md"][0]], found["md"][1], "m", found["md"][0])
    inc = _numbers(df[found["inc"][0]], found["inc"][1], "deg", found["inc"][0])
    azi = _numbers(df[found["azi"][0]], found["azi"][1], "deg", found["azi"][0])
    table = pd.DataFrame({"md": md, "inc": inc, "azi": azi}).dropna().sort_values("md", kind="stable")
    return [Station(md_m=float(r.md), inc_deg=float(r.inc), azi_deg=float(r.azi)) for r in table.itertuples()]


def parse_tops_table(df: pd.DataFrame) -> list[dict]:
    """`[{"formation", "top_md_m", "top_tvdss_m"}]` from a formation-tops table.

    Formation names are returned as written (synonym resolution happens later).
    Rows with no formation name, or with neither an MD nor a TVDSS value, are
    dropped. Raises ValueError if there is no formation column or no depth column.
    """
    formation = _find(df, _FORMATION)
    top_md = _find(df, _TOP_MD)
    top_tvdss = _find(df, _TOP_TVDSS)
    if formation is None:
        raise ValueError(f"tops table has no formation column (have {list(df.columns)})")
    if top_md is None and top_tvdss is None:
        raise ValueError(f"tops table has no MD or TVDSS column (have {list(df.columns)})")

    nan = pd.Series(float("nan"), index=df.index)
    md = _numbers(df[top_md[0]], top_md[1], "m", top_md[0]) if top_md else nan
    tvdss = _numbers(df[top_tvdss[0]], top_tvdss[1], "m", top_tvdss[0]) if top_tvdss else nan

    tops = []
    for name, md_m, tvdss_m in zip(df[formation[0]], md, tvdss):
        name = "" if pd.isna(name) else str(name).strip()
        if not name or (pd.isna(md_m) and pd.isna(tvdss_m)):
            continue
        tops.append({
            "formation": name,
            "top_md_m": None if pd.isna(md_m) else float(md_m),
            "top_tvdss_m": None if pd.isna(tvdss_m) else float(tvdss_m),
        })
    return tops

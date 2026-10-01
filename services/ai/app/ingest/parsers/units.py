"""Unit conversion to the internal SI set (contract §4) and free-text quantities.

`to_si(value, unit)` understands the contract §4 units plus WITSML `uom`
strings (m, ft, g/cm3, ppg, lbm/galUS, bbl, m3, gal/min, L/min, psi, bar, kPa,
klbf, kN, kft.lbf, kN.m, ft/h, m/h, dega). Industry-convention units the
contract keeps as they are (inch, cP, lbf/100ft2, ...) pass through unchanged.

This module has no dependencies, so the Database loaders can import it.
"""

from __future__ import annotations

import re

# 1 lbf/100 ft2 = 0.4788026 Pa (yield point / gel strength are stored in lbf/100ft2)
PA_PER_LBF_100FT2 = 0.4788026


class UnknownUnitError(ValueError):
    """Raised for a unit string we have no conversion for."""


# normalised unit -> (factor to the SI unit, SI unit); built from the families below
_CONVERSIONS: dict[str, tuple[float, str]] = {}


def _family(si_unit: str, aliases: dict[str, float]) -> None:
    for alias, factor in aliases.items():
        _CONVERSIONS[alias] = (factor, si_unit)


_family("m", {
    "m": 1.0, "meter": 1.0, "metre": 1.0, "meters": 1.0, "metres": 1.0,
    "ft": 0.3048, "feet": 0.3048, "foot": 0.3048,
    "km": 1000.0, "cm": 0.01, "mm": 0.001,
})
_family("sg", {
    "sg": 1.0, "s.g.": 1.0, "g/cm3": 1.0, "g/cc": 1.0, "kg/l": 1.0, "kg/m3": 0.001,
    "ppg": 1 / 8.345, "lbm/gal": 1 / 8.345, "lb/gal": 1 / 8.345,
    "lbm/ft3": 1 / 62.428, "lb/ft3": 1 / 62.428, "pcf": 1 / 62.428,
})
_family("m3", {
    "m3": 1.0, "bbl": 0.158987, "bbls": 0.158987, "gal": 0.00378541,
    "l": 0.001, "liter": 0.001, "litre": 0.001, "ft3": 0.0283168,
})
_family("l/min", {
    "l/min": 1.0, "lpm": 1.0, "gpm": 3.78541, "gal/min": 3.78541, "bbl/min": 158.987,
    "m3/min": 1000.0, "l/s": 60.0, "m3/s": 60000.0,
})
_family("m3/h", {"m3/h": 1.0, "bbl/h": 0.158987, "gal/h": 0.00378541, "l/h": 0.001})
_family("bar", {
    "bar": 1.0, "psi": 0.0689476, "psia": 0.0689476, "psig": 0.0689476, "kpa": 0.01,
    "mpa": 10.0, "pa": 1e-5, "atm": 1.01325, "kgf/cm2": 0.980665,
})
_family("kn", {
    "kn": 1.0, "klbf": 4.44822, "klbs": 4.44822, "klb": 4.44822, "lbf": 0.00444822,
    "n": 0.001, "dan": 0.01, "mn": 1000.0,
})
_family("kn.m", {
    "kn.m": 1.0, "knm": 1.0, "kft.lbf": 1.35582, "kft-lbf": 1.35582, "kftlbf": 1.35582,
    "ft.lbf": 0.00135582, "ft-lbf": 0.00135582, "lbf.ft": 0.00135582, "n.m": 0.001, "nm": 0.001,
})
_family("m/h", {"m/h": 1.0, "ft/h": 0.3048, "m/min": 60.0, "ft/min": 18.288, "m/s": 3600.0})
_family("deg", {"deg": 1.0, "dega": 1.0, "degree": 1.0, "degrees": 1.0, "rad": 57.29577951308232})
_family("h", {
    "h": 1.0, "hr": 1.0, "hour": 1.0, "hours": 1.0, "min": 1 / 60, "s": 1 / 3600,
    "d": 24.0, "day": 24.0, "days": 24.0,
})
# kept in industry units by the contract (§4): only aliases are folded together
_family("cp", {"cp": 1.0, "mpa.s": 1.0, "pa.s": 1000.0})
_family("ml", {"ml": 1.0, "cm3": 1.0, "cc": 1.0})
_family("in", {"in": 1.0, "inch": 1.0, "inches": 1.0})
_family("%", {"%": 1.0, "pct": 1.0})
_family("lbf/100ft2", {"lbf/100ft2": 1.0, "lbf/100sqft": 1.0})
_family("mg/l", {"mg/l": 1.0, "ppm": 1.0})
_family("ppf", {"ppf": 1.0, "lbm/ft": 1.0, "lb/ft": 1.0})


def normalise_unit(unit: str) -> str:
    """Lower-case, drop spaces and fold the spellings WITSML and reports use."""
    u = unit.strip().lower()
    for old, new in (("°", "deg"), ("³", "3"), ("²", "2"), ("·", "."), ("[us]", ""), ("galus", "gal")):
        u = u.replace(old, new)
    u = re.sub(r"\s+", "", u)
    u = re.sub(r"/(hr|hour|hours)$", "/h", u)
    return u


def is_known_unit(unit: str) -> bool:
    return normalise_unit(unit) in _CONVERSIONS


def to_si(value: float, unit: str) -> tuple[float, str]:
    """Convert `value` from `unit` to the contract §4 internal unit.

    Returns (value_si, unit_si); raises UnknownUnitError for an unknown unit.
    """
    try:
        factor, unit_si = _CONVERSIONS[normalise_unit(unit)]
    except KeyError:
        raise UnknownUnitError(f"no conversion for unit {unit!r}") from None
    return float(value) * factor, unit_si


def to_lbf100ft2(value: float, unit: str) -> float:
    """Yield point / gel strength in lbf/100ft2 from Pa (WITSML default) or lbf/100ft2."""
    u = normalise_unit(unit)
    if u in ("lbf/100ft2", "lbf/100sqft"):
        return float(value)
    if u == "pa":
        return float(value) / PA_PER_LBF_100FT2
    if u == "kpa":
        return float(value) * 1000 / PA_PER_LBF_100FT2
    raise UnknownUnitError(f"no conversion to lbf/100ft2 for unit {unit!r}")


# ---------------------------------------------------------------- free text

_NUMBER = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_UNIT = r"[A-Za-z°%][A-Za-z0-9°³²/.·%\-]*"
_QUANTITY_RE = re.compile(rf"(?<![\w.])([-+]?(?:{_NUMBER}))\s*({_UNIT})?")
_RANGE_RE = re.compile(
    rf"(?<![\w.])([-+]?(?:{_NUMBER}))\s*(?:-|–|—|\bto\b)\s*((?:{_NUMBER}))\s*({_UNIT})",
    re.IGNORECASE,
)


def _number(text: str) -> float:
    return float(text.replace(",", ""))


def _clean_unit(token: str | None) -> str | None:
    if not token:
        return None
    token = token.rstrip(".-/")
    return token if token and is_known_unit(token) else None


def parse_range(text: str) -> tuple[float, float, str] | None:
    """`"2395-2410 m"` -> (2395.0, 2410.0, "m"); None if there is no range with a known unit."""
    for match in _RANGE_RE.finditer(text):
        unit = _clean_unit(match.group(3))
        if unit:
            return _number(match.group(1)), _number(match.group(2)), unit
    return None


def parse_quantity(text: str) -> tuple[float, str] | None:
    """First number followed by a known unit, as written: `"15 bbl/hr"` -> (15.0, "bbl/hr").

    Handles thousands separators (`"8,200 ft"`) and a missing space (`"2395m"`).
    A range (`"2395-2410 m"`) returns its first value; use `parse_range` for both ends.
    Numbers followed by anything that is not a known unit (`"3 stands"`) are skipped.
    """
    ranged = parse_range(text)
    if ranged:
        return ranged[0], ranged[2]
    for match in _QUANTITY_RE.finditer(text):
        unit = _clean_unit(match.group(2))
        if unit:
            return _number(match.group(1)), unit
    return None

"""WITSML parsers (BE-06): drillReport, trajectory and log objects.

The Database loaders (DB-10) import these exact names, so they are a contract:
Activity, Fluid, DrillReport, Station, parse_drill_report, parse_trajectory,
parse_log.

* Namespace-agnostic: namespaces are stripped after parsing and tag names are
  matched case-insensitively, so 1.3/1.4 (`drillReports/drillReport`) and the
  2.0 spellings (`DrillReport`, `Activity`) resolve the same way where the
  element names agree. WITSML 2.0 documents whose structure differs will yield
  fewer fields rather than fail.
* Quantities carry a `uom` attribute; they are converted to the contract §4
  units with `units.to_si` (a quantity with no `uom` is taken to be in the
  field's default WITSML unit). A quantity whose unit we cannot convert becomes
  None and is logged, never a guess.
* Timestamps are returned as timezone-aware UTC datetimes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
from lxml import etree

from app.ingest.parsers.units import UnknownUnitError, to_lbf100ft2, to_si

logger = logging.getLogger(__name__)


@dataclass
class Activity:
    t_start: datetime | None
    t_end: datetime | None
    md_m: float | None
    phase: str | None
    proprietary_code: str | None
    state: str | None
    state_detail: str | None
    comments: str | None


@dataclass
class Fluid:
    md_m: float | None
    mud_type: str | None
    mw_sg: float | None
    pv_cp: float | None
    yp_lbf100ft2: float | None
    filtrate_ml: float | None
    ecd_sg: float | None


@dataclass
class DrillReport:
    well_name: str | None
    wellbore_name: str | None
    report_date: date | None
    md_m: float | None
    tvd_m: float | None
    summary_24h: str | None
    forecast_24h: str | None
    activities: list[Activity] = field(default_factory=list)
    fluids: list[Fluid] = field(default_factory=list)
    # Generic dicts: keys are the WITSML child element names; values are SI floats
    # (elements with a convertible `uom`), UTC datetimes (dTim*), nested dicts or text.
    equip_failures: list[dict] = field(default_factory=list)
    control_incidents: list[dict] = field(default_factory=list)
    # Keys: t, md_m, tvd_m, inc_deg, azi_deg
    survey_stations: list[dict] = field(default_factory=list)
    lith_shows: list[dict] = field(default_factory=list)
    strat_info: list[dict] = field(default_factory=list)


@dataclass
class Station:
    md_m: float
    inc_deg: float
    azi_deg: float


# ---------------------------------------------------------------- XML helpers


def _parse_xml(xml_bytes: bytes) -> etree._Element:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, remove_comments=True, remove_pis=True)
    try:
        root = etree.fromstring(xml_bytes, parser)
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"invalid WITSML XML: {exc}") from exc
    for element in root.iter():
        if isinstance(element.tag, str):
            element.tag = etree.QName(element).localname
    return root


def _is(element: etree._Element, name: str) -> bool:
    return isinstance(element.tag, str) and element.tag.lower() == name.lower()


def _children(element: etree._Element, name: str) -> list[etree._Element]:
    return [child for child in element if _is(child, name)]


def _descendants(element: etree._Element, name: str) -> list[etree._Element]:
    return [d for d in element.iter() if d is not element and _is(d, name)]


def _first(element: etree._Element | None, *names: str) -> etree._Element | None:
    if element is None:
        return None
    for name in names:
        found = _children(element, name)
        if found:
            return found[0]
    return None


def _text(element: etree._Element | None, *names: str) -> str | None:
    child = _first(element, *names)
    text = (child.text or "").strip() if child is not None else ""
    return text or None


def _deep_text(element: etree._Element, *names: str) -> str | None:
    for name in names:
        for found in _descendants(element, name):
            text = (found.text or "").strip()
            if text:
                return text
    return None


def _dt(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        logger.warning("unparseable WITSML timestamp %r", text)
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _float(text: str | None) -> float | None:
    if text is None:
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def _qty(element: etree._Element | None, names: tuple[str, ...], default_unit: str) -> float | None:
    """Numeric child converted to SI using its `uom` (or `default_unit`)."""
    child = _first(element, *names)
    if child is None:
        return None
    value = _float((child.text or "").strip())
    if value is None:
        return None
    unit = child.get("uom") or default_unit
    try:
        return to_si(value, unit)[0]
    except UnknownUnitError:
        logger.warning("unconvertible unit %r on <%s>; value dropped", unit, child.tag)
        return None


def _stress_lbf100ft2(element: etree._Element | None, names: tuple[str, ...]) -> float | None:
    """Yield point / gel strength: WITSML reports these in Pa, the contract keeps lbf/100ft2."""
    child = _first(element, *names)
    if child is None:
        return None
    value = _float((child.text or "").strip())
    if value is None:
        return None
    unit = child.get("uom") or "Pa"
    try:
        return to_lbf100ft2(value, unit)
    except UnknownUnitError:
        logger.warning("unconvertible stress unit %r on <%s>; value dropped", unit, child.tag)
        return None


def _element_dict(element: etree._Element) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for child in element:
        if not isinstance(child.tag, str):
            continue
        if len(child):
            result[child.tag] = _element_dict(child)
            continue
        text = (child.text or "").strip()
        if not text:
            continue
        uom = child.get("uom")
        number = _float(text) if uom else None
        if uom and number is not None:
            try:
                result[child.tag] = to_si(number, uom)[0]
            except UnknownUnitError:
                result[child.tag] = number
                result[f"{child.tag}_uom"] = uom
        elif child.tag.lower().startswith("dtim"):
            result[child.tag] = _dt(text)
        else:
            result[child.tag] = text
    return result


# ---------------------------------------------------------------- drillReport


def parse_drill_report(xml_bytes: bytes) -> list[DrillReport]:
    """All `drillReport` objects in the file (it may hold several)."""
    root = _parse_xml(xml_bytes)
    elements = [root] if _is(root, "drillReport") else _descendants(root, "drillReport")
    return [_drill_report(element) for element in elements]


def _drill_report(report: etree._Element) -> DrillReport:
    status = _first(report, "statusInfo")
    stamp = (
        _dt(_text(status, "dTim"))
        or _dt(_text(report, "dTimEnd"))
        or _dt(_text(report, "dTimStart"))
        or _dt(_text(report, "dTim"))
    )
    return DrillReport(
        well_name=_text(report, "nameWell"),
        wellbore_name=_text(report, "nameWellbore"),
        report_date=stamp.date() if stamp else None,
        md_m=_qty(status, ("md",), "m"),
        tvd_m=_qty(status, ("tvd",), "m"),
        summary_24h=_deep_text(report, "sum24Hr", "summary24Hr", "summary24h"),
        forecast_24h=_deep_text(report, "forecast24Hr", "forecast24h"),
        activities=[_activity(a) for a in _children(report, "activity")],
        fluids=[_fluid(f) for f in _children(report, "fluid")],
        equip_failures=[_element_dict(e) for e in _children(report, "equipFailureInfo")],
        control_incidents=[_element_dict(e) for e in _children(report, "controlIncidentInfo")],
        survey_stations=[s for s in (_survey_station(e) for e in _children(report, "surveyStation")) if s],
        lith_shows=[_element_dict(e) for e in _children(report, "lithShowInfo")],
        strat_info=[_element_dict(e) for e in _children(report, "stratInfo")],
    )


def _activity(element: etree._Element) -> Activity:
    return Activity(
        t_start=_dt(_text(element, "dTimStart")),
        t_end=_dt(_text(element, "dTimEnd")),
        md_m=_qty(element, ("md",), "m"),
        phase=_text(element, "phase"),
        proprietary_code=_text(element, "proprietaryCode"),
        state=_text(element, "state"),
        state_detail=_text(element, "stateDetailActivity"),
        comments=_text(element, "comments"),
    )


def _fluid(element: etree._Element) -> Fluid:
    return Fluid(
        md_m=_qty(element, ("md",), "m"),
        mud_type=_text(element, "type"),
        mw_sg=_qty(element, ("density",), "g/cm3"),
        pv_cp=_qty(element, ("pv",), "cP"),
        yp_lbf100ft2=_stress_lbf100ft2(element, ("yp",)),
        filtrate_ml=_qty(element, ("filtrateLtlp", "filtrateApi", "filtrate"), "mL"),
        ecd_sg=_qty(element, ("ecd", "equivalentCirculatingDensity"), "g/cm3"),
    )


def _survey_station(element: etree._Element) -> dict | None:
    station = {
        "t": _dt(_text(element, "dTim")),
        "md_m": _qty(element, ("md",), "m"),
        "tvd_m": _qty(element, ("tvd",), "m"),
        "inc_deg": _qty(element, ("incl", "inc"), "dega"),
        "azi_deg": _qty(element, ("azi",), "dega"),
    }
    return station if station["md_m"] is not None else None


# ---------------------------------------------------------------- trajectory


def parse_trajectory(xml_bytes: bytes) -> tuple[str | None, list[Station]]:
    """(wellbore_name, stations) of the first `trajectory` object, stations sorted by MD.

    Stations missing MD, inclination or azimuth are dropped.
    """
    root = _parse_xml(xml_bytes)
    trajectories = [root] if _is(root, "trajectory") else _descendants(root, "trajectory")
    if not trajectories:
        return None, []
    if len(trajectories) > 1:
        logger.warning("file holds %d trajectories; using the first", len(trajectories))
    trajectory = trajectories[0]

    stations = []
    for element in _children(trajectory, "trajectoryStation"):
        md = _qty(element, ("md",), "m")
        inc = _qty(element, ("incl", "inc", "inclination"), "dega")
        azi = _qty(element, ("azi", "azimuth"), "dega")
        if md is None or inc is None or azi is None:
            continue
        stations.append(Station(md_m=md, inc_deg=inc, azi_deg=azi))
    stations.sort(key=lambda s: s.md_m)
    return _text(trajectory, "nameWellbore"), stations


# ---------------------------------------------------------------- log


def parse_log(xml_bytes: bytes) -> tuple[str | None, "pd.DataFrame"]:
    """(wellbore_name, DataFrame) of the first `log` object.

    Columns are the log mnemonics (the index curve included), in file order.
    Values are NOT converted: the original units are in `df.attrs["units"]`
    ({mnemonic: unit}) so the loader can apply `to_si` per channel. The
    `nullValue` and blank cells become NaN. A time-indexed log has its index
    column parsed to UTC datetimes. Also set: `df.attrs["index_mnemonic"]`,
    `df.attrs["index_type"]`.
    """
    root = _parse_xml(xml_bytes)
    logs = [root] if _is(root, "log") else _descendants(root, "log")
    if not logs:
        return None, pd.DataFrame()
    log = logs[0]

    curves = _children(log, "logCurveInfo")
    curve_mnemonics = [_text(c, "mnemonic") or "" for c in curves]
    curve_units = [_text(c, "unit") or "" for c in curves]

    mnemonics: list[str] | None = None
    units: list[str] | None = None
    rows: list[list[str]] = []
    skipped = 0
    for block in _children(log, "logData"):
        listed = _text(block, "mnemonicList")
        if mnemonics is None:
            mnemonics = [m.strip() for m in listed.split(",")] if listed else curve_mnemonics
            listed_units = _text(block, "unitList")
            units = [u.strip() for u in listed_units.split(",")] if listed_units else curve_units
        for data in _children(block, "data"):
            cells = [c.strip() for c in (data.text or "").split(",")]
            if len(cells) == len(mnemonics):
                rows.append(cells)
            else:
                skipped += 1
    if mnemonics is None:
        mnemonics, units = curve_mnemonics, curve_units
    if skipped:
        logger.warning("skipped %d log rows whose cell count did not match the mnemonic list", skipped)

    frame = pd.DataFrame(rows, columns=mnemonics)
    index_type = (_text(log, "indexType") or "").lower()
    index_mnemonic = _text(log, "indexCurve")
    if index_mnemonic not in mnemonics:
        index_mnemonic = mnemonics[0] if mnemonics else None

    null_value = _float(_text(log, "nullValue"))
    for column in frame.columns:
        if column == index_mnemonic and "time" in index_type:
            frame[column] = pd.to_datetime(frame[column], utc=True, errors="coerce", format="ISO8601")
            continue
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
        if null_value is not None:
            frame[column] = frame[column].mask(frame[column] == null_value)

    frame.attrs["units"] = dict(zip(mnemonics, units or [""] * len(mnemonics)))
    frame.attrs["index_mnemonic"] = index_mnemonic
    frame.attrs["index_type"] = index_type or None
    return _text(log, "nameWellbore"), frame

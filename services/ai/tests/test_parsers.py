"""BE-06: WITSML, LAS, tabular parsers and unit helpers."""

from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from app.ingest.parsers import tabular, units
from app.ingest.parsers.las import parse_las
from app.ingest.parsers.witsml import (
    Activity,
    DrillReport,
    Fluid,
    Station,
    parse_drill_report,
    parse_log,
    parse_trajectory,
)

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# ---------------------------------------------------------------- units


@pytest.mark.parametrize(
    "value, unit, expected, unit_si",
    [
        (1000, "ft", 304.8, "m"),
        (5, "m", 5, "m"),
        (10.0, "ppg", 10.0 / 8.345, "sg"),
        (1.18, "g/cm3", 1.18, "sg"),
        (10.0, "lbm/galUS", 10.0 / 8.345, "sg"),
        (10.0, "lbm/gal", 10.0 / 8.345, "sg"),
        (100, "bbl", 15.8987, "m3"),
        (2, "m3", 2, "m3"),
        (100, "gpm", 378.541, "l/min"),
        (100, "gal/min", 378.541, "l/min"),
        (100, "L/min", 100, "l/min"),
        (15, "bbl/hr", 2.384805, "m3/h"),
        (15, "bbl/h", 2.384805, "m3/h"),
        (1000, "psi", 68.9476, "bar"),
        (200, "kPa", 2.0, "bar"),
        (2, "bar", 2, "bar"),
        (20, "klbf", 88.9644, "kn"),
        (20, "klbs", 88.9644, "kn"),
        (5, "kN", 5, "kn"),
        (10, "kft.lbf", 13.5582, "kn.m"),
        (10, "kft·lbf", 13.5582, "kn.m"),
        (7, "kN.m", 7, "kn.m"),
        (100, "ft/h", 30.48, "m/h"),
        (100, "m/h", 100, "m/h"),
        (45, "dega", 45, "deg"),
        (90, "°", 90, "deg"),
        (30, "min", 0.5, "h"),
        (12.25, "in", 12.25, "in"),
        (18, "cP", 18, "cp"),
    ],
)
def test_to_si_conversions(value, unit, expected, unit_si):
    result, result_unit = units.to_si(value, unit)
    assert result == pytest.approx(expected, rel=1e-5)
    assert result_unit == unit_si


def test_to_si_unknown_unit_raises():
    with pytest.raises(units.UnknownUnitError):
        units.to_si(1, "furlongs")


def test_to_lbf100ft2():
    assert units.to_lbf100ft2(10.5, "Pa") == pytest.approx(21.9304, rel=1e-4)
    assert units.to_lbf100ft2(22, "lbf/100ft2") == 22


@pytest.mark.parametrize(
    "text, expected",
    [
        ("15 bbl/hr", (15.0, "bbl/hr")),
        ("8,200 ft", (8200.0, "ft")),
        ("10.2 ppg", (10.2, "ppg")),
        ("2395m", (2395.0, "m")),
        ("TD reached at 2395 m.", (2395.0, "m")),
        ("pumped 30 m3 LCM pill", (30.0, "m3")),
        ("overpull 20 klbs", (20.0, "klbs")),
        ("-5 psi", (-5.0, "psi")),
        ("1,234.5 m", (1234.5, "m")),
        ("Obs. partial losses @ 2395 m 15 m3/hr, pumped LCM", (2395.0, "m")),
        ("3 stands then 120 ft", (120.0, "ft")),  # '3 stands' is not a quantity
        ("12 minutes", None),  # 'minutes' is a word, not 'min'
    ],
)
def test_parse_quantity(text, expected):
    assert units.parse_quantity(text) == expected


def test_parse_quantity_none_when_no_unit():
    assert units.parse_quantity("nothing here") is None
    assert units.parse_quantity("tag 12345") is None


@pytest.mark.parametrize(
    "text",
    ["2395-2410 m", "2395 - 2410 m", "2395–2410m", "2395 to 2410 m", "interval 2,395-2,410 m."],
)
def test_parse_range_and_quantity_returns_first_value(text):
    assert units.parse_range(text) == (2395.0, 2410.0, "m")
    assert units.parse_quantity(text) == (2395.0, "m")


def test_parse_range_none_without_a_range_or_unit():
    assert units.parse_range("2395 m") is None
    assert units.parse_range("2395-2410") is None


# ---------------------------------------------------------------- WITSML drillReport


def test_parse_drill_report_header():
    (report,) = parse_drill_report(fixture_bytes("drill_report_141.xml"))

    assert isinstance(report, DrillReport)
    assert report.well_name == "SYN-TEST-01"
    assert report.wellbore_name == "SYN-TEST-01 main"
    assert report.report_date == date(2019, 3, 12)
    assert report.md_m == 2400.0 and report.tvd_m == 2380.0
    assert report.summary_24h.startswith("Drilled 12-1/4in hole")
    assert report.forecast_24h == "Continue drilling ahead."


def test_parse_drill_report_activities():
    (report,) = parse_drill_report(fixture_bytes("drill_report_141.xml"))

    assert len(report.activities) == 2
    first, second = report.activities
    assert isinstance(first, Activity)
    assert first == Activity(
        t_start=utc(2019, 3, 12, 6, 0),
        t_end=utc(2019, 3, 12, 9, 30),
        md_m=2395.0,
        phase="12-1/4in",
        proprietary_code="drilling -- drill",
        state="ok",
        state_detail="drilling",
        comments="Drilled to 2395 m",
    )
    assert second.md_m == pytest.approx(2398.776)  # 7870 ft converted by its uom
    assert second.state == "fail" and second.state_detail == "lost circulation"
    assert "15 bbl/hr" in second.comments


def test_parse_drill_report_fluid_converted_to_contract_units():
    (report,) = parse_drill_report(fixture_bytes("drill_report_141.xml"))

    (fluid,) = report.fluids
    assert isinstance(fluid, Fluid)
    assert fluid.md_m == 2400.0
    assert fluid.mud_type == "WBM"
    assert fluid.mw_sg == pytest.approx(1.18)
    assert fluid.pv_cp == 18
    assert fluid.yp_lbf100ft2 == pytest.approx(21.9304, rel=1e-4)  # 10.5 Pa
    assert fluid.filtrate_ml == pytest.approx(5.2)
    assert fluid.ecd_sg == pytest.approx(1.25)


def test_parse_drill_report_other_blocks():
    (report,) = parse_drill_report(fixture_bytes("drill_report_141.xml"))

    assert report.survey_stations == [
        {"t": utc(2019, 3, 12, 4, 0), "md_m": 2300.0, "tvd_m": 2290.0, "inc_deg": 18.5, "azi_deg": 112.0}
    ]
    (failure,) = report.equip_failures
    assert failure["md"] == 1800.0 and failure["equipClass"] == "mud pump"
    assert failure["dTim"] == utc(2019, 3, 12, 11, 0)
    (incident,) = report.control_incidents
    assert incident["type"] == "kick" and incident["md"] == 2398.0
    assert report.lith_shows[0]["lithology"] == "sandstone" and report.lith_shows[0]["mdTop"] == 2310.0
    assert report.strat_info[0]["description"] == "Tipam"


def test_parse_drill_report_several_reports_in_one_file():
    xml = fixture_bytes("drill_report_141.xml").decode()
    body = xml.split("<drillReports", 1)[1].split(">", 1)[1].rsplit("</drillReports>", 1)[0]
    second = body.replace("SYN-TEST-01", "SYN-TEST-02").replace("2019-03-12", "2019-03-13")
    combined = xml.replace("</drillReports>", second + "</drillReports>").encode()

    reports = parse_drill_report(combined)

    assert [r.well_name for r in reports] == ["SYN-TEST-01", "SYN-TEST-02"]
    assert reports[1].report_date == date(2019, 3, 13)


def test_parse_drill_report_without_namespace_and_2_0_spelling():
    xml = b"""<DrillReport><nameWell>W</nameWell>
        <Activity><dTimStart>2020-01-01T00:00:00+02:00</dTimStart><md uom="m">10</md><comments>c</comments></Activity>
    </DrillReport>"""
    (report,) = parse_drill_report(xml)

    assert report.well_name == "W"
    assert report.activities[0].t_start == utc(2019, 12, 31, 22, 0)  # offset converted to UTC
    assert report.activities[0].md_m == 10.0


def test_parse_drill_report_naive_timestamp_is_taken_as_utc():
    xml = b"<drillReport><activity><dTimStart>2020-01-01T06:00:00</dTimStart></activity></drillReport>"
    assert parse_drill_report(xml)[0].activities[0].t_start == utc(2020, 1, 1, 6, 0)


def test_parse_drill_report_unconvertible_unit_becomes_none():
    xml = b'<drillReport><activity><md uom="furlongs">3</md></activity></drillReport>'
    assert parse_drill_report(xml)[0].activities[0].md_m is None


def test_parse_drill_report_no_reports_and_bad_xml():
    assert parse_drill_report(b"<other/>") == []
    with pytest.raises(ValueError, match="invalid WITSML XML"):
        parse_drill_report(b"<drillReports>")


def test_xml_entities_are_not_resolved():
    xml = b"""<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>
        <drillReport><nameWell>&x;</nameWell></drillReport>"""
    (report,) = parse_drill_report(xml)
    assert report.well_name in (None, "")


# ---------------------------------------------------------------- WITSML trajectory


def test_parse_trajectory_converts_ft_sorts_and_drops_incomplete_stations():
    name, stations = parse_trajectory(fixture_bytes("trajectory_ft.xml"))

    assert name == "SYN-TEST-01 main"
    assert stations == [
        Station(md_m=0.0, inc_deg=0.0, azi_deg=0.0),
        Station(md_m=pytest.approx(304.8), inc_deg=10.0, azi_deg=90.0),
        Station(md_m=pytest.approx(609.6), inc_deg=20.0, azi_deg=95.0),
    ]


def test_parse_trajectory_none_found():
    assert parse_trajectory(b"<other/>") == (None, [])


# ---------------------------------------------------------------- WITSML log


def test_parse_log_depth_indexed():
    name, frame = parse_log(fixture_bytes("log_depth.xml"))

    assert name == "SYN-TEST-01 main"
    assert list(frame.columns) == ["DEPT", "ROP", "WOB"]
    assert len(frame) == 3  # the 'broken row' was skipped
    assert frame["DEPT"].tolist() == [1000.0, 1000.5, 1001.0]
    assert frame["ROP"].iloc[0] == 12.5
    assert pd.isna(frame["ROP"].iloc[1])  # nullValue -> NaN
    assert pd.isna(frame["WOB"].iloc[2])  # blank cell -> NaN
    assert frame.attrs["units"] == {"DEPT": "m", "ROP": "m/h", "WOB": "klbf"}  # raw units kept
    assert frame.attrs["index_mnemonic"] == "DEPT"


def test_parse_log_time_indexed():
    xml = b"""<logs><log><indexType>date time</indexType>
        <logCurveInfo><mnemonic>TIME</mnemonic><unit>s</unit></logCurveInfo>
        <logCurveInfo><mnemonic>SPP</mnemonic><unit>psi</unit></logCurveInfo>
        <logData><data>2019-03-12T06:00:00Z,2500</data><data>2019-03-12T06:00:05Z,2510</data></logData>
        </log></logs>"""
    _, frame = parse_log(xml)

    assert frame["TIME"].iloc[0] == pd.Timestamp("2019-03-12T06:00:00Z")
    assert frame["SPP"].tolist() == [2500.0, 2510.0]  # columns come from logCurveInfo here


def test_parse_log_without_a_log():
    name, frame = parse_log(b"<other/>")
    assert name is None and frame.empty


# ---------------------------------------------------------------- LAS


def test_parse_las_well_info_and_curves():
    well, curves = parse_las(fixture_bytes("sample.las"))

    assert well["WELL"] == "SYN-TEST-01"
    assert well["FLD"] == "SYN-Duliajan"
    assert well["STRT"] == 1000.0 and well["STOP"] == 1002.0 and well["STEP"] == 0.5
    assert well["_units"]["STRT"] == "M"
    assert list(curves.columns) == ["ROP", "GR"]
    assert curves.index.tolist() == [1000.0, 1000.5, 1001.0, 1001.5, 1002.0]
    assert curves.index.name == "DEPT"
    assert pd.isna(curves["ROP"].loc[1000.5]) and pd.isna(curves["GR"].loc[1002.0])  # null -> NaN
    assert curves["GR"].loc[1000.0] == 85.2
    assert curves.attrs["units"] == {"DEPT": "m", "ROP": "M/H", "GR": "GAPI"}


def test_parse_las_feet_index_is_converted_to_metres():
    text = fixture_bytes("sample.las").decode().replace("DEPT.M", "DEPT.FT")
    _, curves = parse_las(text.encode())

    assert curves.index.tolist() == pytest.approx([d * 0.3048 for d in (1000.0, 1000.5, 1001.0, 1001.5, 1002.0)])
    assert curves.attrs["units"]["DEPT"] == "m"


def test_parse_las_rejects_non_las():
    with pytest.raises(ValueError):
        parse_las(b"this is not a las file at all")


# ---------------------------------------------------------------- tables


def test_parse_survey_table_converts_units_and_sorts():
    stations = tabular.parse_survey_table(pd.read_csv(FIXTURES / "survey.csv"))

    assert stations == [
        Station(0.0, 0.0, 0.0),
        Station(pytest.approx(304.8), 10.0, 90.0),
        Station(pytest.approx(609.6), 20.0, 95.0),
    ]  # 1500 ft row had blanks and was dropped


@pytest.mark.parametrize(
    "columns",
    [["md", "inc", "azi"], ["Measured Depth", "Inclination", "Azimuth"], ["MD_m", "INCL", "AZIM"], ["MD [m]", "Inc", "Azi"]],
)
def test_parse_survey_table_column_name_variants(columns):
    frame = pd.DataFrame([[10, 1, 2], [20, 3, 4]], columns=columns)
    assert [s.md_m for s in tabular.parse_survey_table(frame)] == [10.0, 20.0]


def test_parse_survey_table_header_unit_in_name_and_default_metres():
    frame = pd.DataFrame({"MD_ft": [100], "inc": [5], "azi": [10]})
    assert tabular.parse_survey_table(frame)[0].md_m == pytest.approx(30.48)


def test_parse_survey_table_missing_column():
    with pytest.raises(ValueError, match="azi"):
        tabular.parse_survey_table(pd.DataFrame({"md": [1], "inc": [1]}))


def test_parse_tops_table():
    tops = tabular.parse_tops_table(pd.read_csv(FIXTURES / "tops.csv"))

    assert tops == [
        {"formation": "Tipam Sst", "top_md_m": 2310.5, "top_tvdss_m": 2261.0},
        {"formation": "Barail", "top_md_m": 2850.0, "top_tvdss_m": 2790.0},
    ]  # nameless row and depth-less row dropped; thousands separator handled


def test_parse_tops_table_md_only_and_ft_header():
    frame = pd.DataFrame({"Fm": ["Tipam"], "Top (ft)": [1000]})
    (top,) = tabular.parse_tops_table(frame)
    assert top["top_md_m"] == pytest.approx(304.8) and top["top_tvdss_m"] is None


def test_parse_tops_table_requires_formation_and_a_depth():
    with pytest.raises(ValueError, match="formation"):
        tabular.parse_tops_table(pd.DataFrame({"md": [1]}))
    with pytest.raises(ValueError, match="MD or TVDSS"):
        tabular.parse_tops_table(pd.DataFrame({"formation": ["x"]}))

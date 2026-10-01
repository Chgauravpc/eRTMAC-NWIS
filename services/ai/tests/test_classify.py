import pytest

from app.ingest import classify as classify_mod
from app.ingest.classify import classify, classify_by_rules, guess_well_name, peek_text
from app.llm.client import LlmMeta
from app.models.enums import DocType

WITSML = (
    '<?xml version="1.0"?><drillReports xmlns="http://www.witsml.org/schemas/1series" version="1.4.1.1">'
    "<drillReport><nameWell>Well A</nameWell></drillReport></drillReports>"
)


def test_rule_witsml_root_element():
    assert classify_by_rules("r.xml", '<?xml version="1.0"?><drillReport><x/></drillReport>', "application/xml") == DocType.WITSML


def test_rule_witsml_namespace_prefix_and_namespace_uri():
    assert classify_by_rules("r.xml", WITSML, None) == DocType.WITSML
    prefixed = '<?xml version="1.0"?><w:drillReports xmlns:w="urn:x"/>'
    assert classify_by_rules("r.xml", prefixed, None) == DocType.WITSML


def test_rule_other_xml_is_not_witsml():
    assert classify_by_rules("page.xml", "<html><body>hello</body></html>", None) is None


def test_rule_las_version_section():
    assert classify_by_rules("a.las", "~VERSION INFORMATION\n VERS. 2.0", None) == DocType.LAS


def test_rule_las_data_section():
    assert classify_by_rules("a.txt", "# header\n~Curve\n~A  DEPT ROP\n100 12", None) == DocType.LAS


def test_rule_survey_csv_columns_with_units():
    text = "Measured Depth (m),Inclination (deg),Azimuth (deg)\n0,0,0\n"
    assert classify_by_rules("svy.csv", text, "text/csv") == DocType.SURVEY


def test_rule_survey_needs_all_three_columns():
    assert classify_by_rules("data.csv", "md,rop,wob\n1,2,3\n", "text/csv") is None


def test_rule_survey_ignored_for_non_tabular_files():
    assert classify_by_rules("notes.txt", "md,inc,azi\n1,2,3\n", "text/plain") is None


@pytest.mark.parametrize(
    "text, expected",
    [
        ("DAILY DRILLING REPORT No. 12", DocType.DDR),
        ("IADC Daily form", DocType.DDR),
        ("Morning Report 03-Mar", DocType.DDR),
        ("Well Completion Report", DocType.WCR),
        ("final completion report for the well", DocType.WCR),
        ("Master Log of well", DocType.MUD_LOG),
        ("Mud log interval 2300-2400", DocType.MUD_LOG),
        ("Cement job summary", DocType.CEMENT_REPORT),
        ("Cementing Report - 9 5/8 casing", DocType.CEMENT_REPORT),
        ("Drilling Program rev 2", DocType.PROGRAM),
        ("Casing program", DocType.PROGRAM),
        ("Mud programme", DocType.PROGRAM),
        ("Incident investigation", DocType.INCIDENT),
        ("NPT Report for March", DocType.INCIDENT),
        ("Fishing operation summary", DocType.INCIDENT),
    ],
)
def test_keyword_rules(text, expected):
    assert classify_by_rules("scan.pdf", text, "application/pdf") == expected


def test_keyword_priority_follows_rule_order():
    # a WCR that also mentions fishing is still a WCR, and a DDR beats a WCR mention
    assert classify_by_rules("x.pdf", "Well completion report ... fishing job", None) == DocType.WCR
    assert classify_by_rules("x.pdf", "Daily drilling report (see completion report)", None) == DocType.DDR


def test_no_rule_matches():
    assert classify_by_rules("x.pdf", "Lorem ipsum dolor sit amet", None) is None


@pytest.mark.asyncio
async def test_requested_type_wins_and_skips_everything(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("LLM must not be called")

    monkeypatch.setattr(classify_mod, "complete_json", boom)
    assert await classify("x.pdf", "Daily drilling report", None, requested=DocType.MUD_LOG) == DocType.MUD_LOG


@pytest.mark.asyncio
async def test_llm_fallback_used_when_no_rule_matches(monkeypatch):
    calls = []

    async def fake(system, user, schema, **kwargs):
        calls.append(user)
        out = schema(doc_type=DocType.PROGRAM, well_name="SYN-X-01", confidence=0.7)
        return out, LlmMeta("groq", "m", False, 1.0, len(user))

    monkeypatch.setattr(classify_mod, "complete_json", fake)
    result = await classify_mod.classify_with_details("plan.pdf", "A long enough page of unusual text", None)

    assert result.doc_type == DocType.PROGRAM
    assert result.well_name == "SYN-X-01"
    assert result.method == "llm"
    assert len(calls) == 1 and "plan.pdf" in calls[0]


@pytest.mark.asyncio
async def test_llm_failure_falls_back_to_other(monkeypatch):
    async def fail(*a, **k):
        raise RuntimeError("both providers down")

    monkeypatch.setattr(classify_mod, "complete_json", fail)
    assert await classify("x.pdf", "A long enough page of unusual text", None) == DocType.OTHER


@pytest.mark.asyncio
async def test_no_text_means_other_without_calling_llm(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("LLM must not be called without text")

    monkeypatch.setattr(classify_mod, "complete_json", boom)
    assert await classify("scan.pdf", "  \n ", "application/pdf") == DocType.OTHER


def test_guess_well_name():
    assert guess_well_name(WITSML) == "Well A"
    assert guess_well_name("DAILY REPORT\nWell Name: SYN-DLJ-03\nDate: 2019-03-12") == "SYN-DLJ-03"
    assert guess_well_name("Well: SYN-NHK-01") == "SYN-NHK-01"
    assert guess_well_name("nothing here") is None


def test_peek_text_decodes_text_and_skips_binary():
    assert peek_text(b"hello ~V world", "a.las", None).startswith("hello")
    assert peek_text(b"\x00\x01\x02binary", "a.bin", None) == ""
    assert peek_text(b"not really an image", "scan.png", "image/png") == ""

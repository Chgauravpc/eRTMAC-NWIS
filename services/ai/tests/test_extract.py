"""BE-08: LLM extraction and storage (LLM and database mocked)."""

from datetime import date
from uuid import uuid4

import pytest

from app import db
from app.errors import NwisError
from app.ingest import extract as ex
from app.ingest import normalize
from app.llm.client import LlmMeta
from app.models.extraction import ExtractionResult

DOC_ID = str(uuid4())
WELL_ID, WELLBORE_ID = str(uuid4()), str(uuid4())
META = LlmMeta("groq", "m", False, 1.0, 1)

PAGE_ONE = "Obs. partial losses @ 7870 ft 15 bbl/hr, pumped LCM pill in Tipam Sst. Losses cured after 2 h."
SNIPPET = "partial losses @ 7870 ft 15 bbl/hr, pumped LCM pill"


def page(number: int, text: str, ocr=None, boxes=None, tables=None) -> dict:
    return {"page_no": number, "text": text, "markdown": text, "tables": tables or [],
            "ocr_confidence": ocr, "engine": "text_layer", "boxes": boxes}


def make_doc(doc_type="ddr", **overrides) -> dict:
    doc = {"id": DOC_ID, "job_id": str(uuid4()), "title": "d.pdf", "file_path": "x/d.pdf", "doc_type": doc_type,
           "well_id": WELL_ID, "wellbore_id": None, "provenance": "synthetic"}
    doc.update(overrides)
    return doc


def event(**overrides) -> dict:
    item = {"event_type": "loss_partial", "description": "Partial losses 15 bbl/hr", "md_from_m": 2398.8,
            "formation": "Tipam Sst", "event_date": "2019-03-12", "page": 1, "snippet": SNIPPET, "confidence": 0.92}
    item.update(overrides)
    return item


def llm_returning(*payloads):
    """A stand-in for complete_json that returns the given dicts in order and records its calls."""
    calls = []
    queue = list(payloads)

    async def fake(system, user, schema, **kwargs):
        calls.append({"system": system, "user": user, "kwargs": kwargs})
        payload = queue.pop(0) if len(queue) > 1 else queue[0]
        return schema.model_validate(payload), META

    fake.calls = calls
    return fake


# ---------------------------------------------------------------- fake database


class FakeDb:
    def __init__(self):
        self.executed: list[tuple[str, object]] = []
        self.wellbore_id: str | None = WELLBORE_ID
        self.well_td: float | None = 3600.0
        self.duplicate_event = False
        self.formation_info = {"formation": "Tipam", "relative_depth": 0.4}
        self.synonyms = [{"alias": "tipam ss", "formation": "Tipam"}, {"alias": "barail group", "formation": "Barail"}]
        self.formations = [{"name": "Tipam", "strat_order": 5}, {"name": "Barail", "strat_order": 6},
                           {"name": "Kopili", "strat_order": 7}]

    async def fetch_all(self, sql, params=None):
        if "formation_synonyms" in sql:
            return self.synonyms
        if "from formations" in sql:
            return self.formations
        raise AssertionError(sql)

    async def fetch_one(self, sql, params=None):
        if "from wellbores" in sql:
            return {"id": self.wellbore_id} if self.wellbore_id else None
        if "from wells" in sql:
            return {"td_md_m": self.well_td}
        if "from events" in sql:
            return {"id": "dup"} if self.duplicate_event else None
        if "from formation_tops" in sql:
            return {"id": "top-existing"}
        raise AssertionError(sql)

    async def execute(self, sql, params=None):
        self.executed.append((sql, params))

    async def execute_many(self, sql, params_seq):
        self.executed.append((sql, params_seq))

    async def call_fn(self, name, **params):
        assert name == "formation_at_md"
        return [self.formation_info] if self.formation_info else []

    def inserts(self, table):
        return [p for sql, p in self.executed if sql.strip().startswith(f"insert into {table} ")]

    def fields(self):
        rows = []
        for sql, params in self.executed:
            if "insert into extracted_fields" in sql:
                rows.extend(params)
        return rows

    def field(self, name, entity=None):
        (row,) = [r for r in self.fields() if r["field"] == name and (entity is None or r["entity"] == entity)]
        return row


@pytest.fixture
def fake(monkeypatch):
    fake_db = FakeDb()
    for name in ("fetch_all", "fetch_one", "execute", "execute_many", "call_fn"):
        monkeypatch.setattr(db, name, getattr(fake_db, name))
    normalize.clear_resolver_cache()
    yield fake_db
    normalize.clear_resolver_cache()


def extraction_for(result: dict, pages=None, witsml=False) -> ex.Extraction:
    pages = pages or [page(1, PAGE_ONE)]
    return ex.Extraction(
        result=ExtractionResult.model_validate(result),
        page_text={p["page_no"]: p["text"] for p in pages},
        page_ocr={p["page_no"]: p["ocr_confidence"] for p in pages},
        page_boxes={p["page_no"]: p["boxes"] or [] for p in pages},
        witsml=witsml,
    )


# ---------------------------------------------------------------- windows


def test_windows_never_split_a_page_and_respect_the_limit():
    pages = [(n, "x" * 400) for n in range(1, 8)]
    windows = ex.build_windows(pages, limit=1000)

    assert len(windows) > 1
    assert all(len(w) <= 1000 for w in windows)
    assert sum(w.count("=== PAGE") for w in windows) == 7
    for number in range(1, 8):
        owners = [w for w in windows if f"=== PAGE {number} ===" in w]
        assert len(owners) == 1 and owners[0].count("x" * 400) >= 1


def test_page_markers_and_order():
    (window,) = ex.build_windows([(3, "alpha"), (4, "beta")])
    assert window == "=== PAGE 3 ===\nalpha\n\n=== PAGE 4 ===\nbeta"


def test_oversized_page_gets_its_own_window_and_blank_pages_are_skipped():
    windows = ex.build_windows([(1, "a" * 50), (2, "b" * 500), (3, "   "), (4, "c" * 50)], limit=300)
    assert [w.count("=== PAGE") for w in windows] == [1, 1, 1]
    assert "=== PAGE 3 ===" not in "".join(windows)
    assert ex.build_windows([]) == []


def test_tables_are_appended_as_markdown():
    text = ex.page_text_for_llm(page(1, "Formation tops", tables=[[["Formation", "Top"], ["Tipam", "2310.5"]]]))
    assert text.startswith("Formation tops\n\n[Tables]\n| Formation | Top |\n| --- | --- |\n| Tipam | 2310.5 |")
    assert ex.page_text_for_llm(page(1, "plain")) == "plain"


def test_merge_results_concatenates_lists_and_keeps_first_scalars():
    a = ExtractionResult.model_validate({"well_name": "W1", "events": [event()],
                                         "well_header": {"field": "Duliajan"}})
    b = ExtractionResult.model_validate({"well_name": "W2", "events": [event(md_from_m=3000)],
                                         "well_header": {"field": "X", "td_md_m": 3600}})
    merged = ex.merge_results([a, b])

    assert merged.well_name == "W1" and len(merged.events) == 2
    assert merged.well_header.field == "Duliajan" and merged.well_header.td_md_m == 3600


# ---------------------------------------------------------------- model leniency


def test_model_is_lenient_about_sloppy_llm_values():
    result = ExtractionResult.model_validate({
        "doc_type": "nonsense",
        "events": [{"event_type": "Mud Loss!", "description": "d", "page": 1, "confidence": 85,
                    "event_date": "12/03/2019", "snippet": "s" * 400}],
        "formation_tops": None,
    })
    item = result.events[0]
    assert result.doc_type is None and result.formation_tops == []
    assert item.event_type.value == "other" and item.confidence == 0.85
    assert item.event_date is None and len(item.snippet) == 300


# ---------------------------------------------------------------- extract (LLM mocked)


@pytest.mark.asyncio
async def test_extract_sends_system_prompt_page_markers_and_type_guidance(monkeypatch):
    llm = llm_returning({"events": [event()]})
    monkeypatch.setattr(ex, "complete_json", llm)

    extraction = await ex.extract(make_doc("ddr"), [page(1, "first"), page(2, "second", ocr=0.7)])

    (call,) = llm.calls
    assert call["system"] == ex.load_prompt("extract_system")
    assert "Abbreviations: POOH = pull out of hole" in call["system"]  # the system prompt, as written
    assert "daily drilling report (DDR)" in call["user"]
    assert "=== PAGE 1 ===\nfirst\n\n=== PAGE 2 ===\nsecond" in call["user"]
    assert call["kwargs"]["max_tokens"] == ex.LLM_MAX_TOKENS
    assert extraction.page_ocr == {1: None, 2: 0.7}
    assert len(extraction.result.events) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type, phrase", [
    ("wcr", "well completion report (WCR)"), ("mud_log", "unknown or mixed type"), ("other", "unknown or mixed type")])
async def test_extract_picks_the_guidance_by_doc_type(monkeypatch, doc_type, phrase):
    llm = llm_returning({})
    monkeypatch.setattr(ex, "complete_json", llm)
    await ex.extract(make_doc(doc_type), [page(1, "text")])
    assert phrase in llm.calls[0]["user"]


@pytest.mark.asyncio
async def test_extract_makes_one_call_per_window_and_merges(monkeypatch):
    llm = llm_returning({"events": [event()]}, {"events": [event(md_from_m=3000.0)]})
    monkeypatch.setattr(ex, "complete_json", llm)
    monkeypatch.setattr(ex, "WINDOW_CHARS", 300)

    extraction = await ex.extract(make_doc("wcr"), [page(1, "a" * 200), page(2, "b" * 200)])

    assert len(llm.calls) == 2 and len(extraction.result.events) == 2


@pytest.mark.asyncio
async def test_extract_with_no_text_makes_no_llm_call(monkeypatch):
    llm = llm_returning({})
    monkeypatch.setattr(ex, "complete_json", llm)
    extraction = await ex.extract(make_doc(), [page(1, "   ")])
    assert llm.calls == [] and extraction.result.events == []


@pytest.mark.asyncio
async def test_llm_failure_propagates_so_the_job_is_marked_failed(monkeypatch):
    async def down(*args, **kwargs):
        raise NwisError("NWIS_UPSTREAM", "Both LLM providers failed", 502)

    monkeypatch.setattr(ex, "complete_json", down)
    with pytest.raises(NwisError):
        await ex.extract(make_doc(), [page(1, "text")])


WITSML_PAGE = (
    "Daily drilling report: well SYN-TEST-01, wellbore SYN-TEST-01 main, date 2019-03-12\n"
    "Depth at report time: 2400 m MD, 2380 m TVD\n"
    "Time log (start–end | MD | code | state | comment):\n"
    "06:00–09:30 | 2395 m | drilling -- drill | ok | Drilled to 2395 m\n"
    "09:30–13:00 | 2399 m | circulating | fail | Partial losses 15 bbl/hr, pumped LCM pill\n"
    "Mud: WBM at 2400 m, MW 1.18 SG"
)


@pytest.mark.asyncio
async def test_witsml_sends_only_time_log_lines_and_keeps_only_events(monkeypatch):
    llm = llm_returning({"events": [event()], "mud_records": [
        {"page": 1, "confidence": 0.9, "mw_sg": 1.18}], "time_log": [{"page": 1, "confidence": 0.9}]})
    monkeypatch.setattr(ex, "complete_json", llm)

    extraction = await ex.extract(make_doc("witsml"), [page(1, WITSML_PAGE)])

    (call,) = llm.calls
    assert "well SYN-TEST-01" in call["user"] and "=== REPORT DATE 2019-03-12 ===" in call["user"]
    assert "[1] 06:00–09:30 | 2395 m | drilling -- drill | ok | Drilled to 2395 m" in call["user"]
    assert "Mud: WBM" not in call["user"] and "Depth at report time" not in call["user"]
    assert len(extraction.result.events) == 1
    assert extraction.result.mud_records == [] and extraction.result.time_log == []  # the parser owns these


@pytest.mark.asyncio
async def test_witsml_without_a_time_log_makes_no_call(monkeypatch):
    llm = llm_returning({})
    monkeypatch.setattr(ex, "complete_json", llm)
    await ex.extract(make_doc("witsml"), [page(1, "Trajectory survey, wellbore X\nMD 304.8 m | INC 10.00 deg")])
    assert llm.calls == []


# ---------------------------------------------------------------- validate: events


BOXES = [
    {"text": "partial losses @ 7870 ft", "conf": 0.9, "bbox": {"x": 0.10, "y": 0.20, "w": 0.30, "h": 0.02}},
    {"text": "15 bbl/hr, pumped LCM pill", "conf": 0.9, "bbox": {"x": 0.45, "y": 0.20, "w": 0.30, "h": 0.02}},
    {"text": "unrelated heading", "conf": 0.9, "bbox": {"x": 0.10, "y": 0.50, "w": 0.30, "h": 0.02}},
]


@pytest.mark.asyncio
async def test_event_in_feet_is_stored_in_metres_with_the_raw_text_kept(fake):
    extraction = extraction_for({"events": [event(md_from_m=7870.0, volume_m3=15.0, npt_h=2.0,
                                                  snippet=SNIPPET + " 15 bbl/hr")]},
                                [page(1, PAGE_ONE, boxes=BOXES)])
    doc = make_doc()
    await ex.validate(doc, [], extraction)

    (row,) = fake.inserts("events")
    assert row["md_from_m"] == pytest.approx(2398.776)  # 7870 ft x 0.3048
    assert row["wellbore_id"] == WELLBORE_ID and row["event_type"] == "loss_partial"
    assert row["risk_type"] == "losses"
    assert row["formation"] == "Tipam" and row["relative_depth"] == 0.4  # "Tipam Sst" via the synonym lookup
    assert row["provenance"] == "synthetic" and row["doc_id"] == DOC_ID and row["event_date"] == date(2019, 3, 12)
    assert row["review_status"] == "auto_approved" and row["confidence"] == 0.92

    md = fake.field("md_from_m")
    assert md["value"].obj == {"raw": "7870 ft", "value": pytest.approx(2398.776), "unit": "m"}
    volume = fake.field("volume_m3")
    assert volume["value"].obj["value"] == 15.0 and volume["value"].obj["unit"] == "m3"  # no matching quantity: kept
    assert md["entity"] == "event" and md["entity_id"] == row["id"] and md["page"] == 1
    assert md["job_id"] == doc["job_id"] and md["doc_id"] == DOC_ID  # rows point back at the job and document
    assert md["bbox"].obj == {"x": 0.1, "y": 0.2, "w": 0.65, "h": 0.02}  # union of the two matching boxes


@pytest.mark.asyncio
async def test_already_converted_depth_keeps_its_value_and_records_the_raw_text(fake):
    extraction = extraction_for({"events": [event(md_from_m=2398.8)]})
    await ex.validate(make_doc(), [], extraction)

    (row,) = fake.inserts("events")
    assert row["md_from_m"] == 2398.8
    assert fake.field("md_from_m")["value"].obj["raw"] == "7870 ft"


@pytest.mark.asyncio
async def test_unknown_formation_is_null_with_a_reason_and_goes_to_review(fake):
    extraction = extraction_for({"events": [event(formation="Zzyzx Fm")]})
    await ex.validate(make_doc(), [], extraction)

    (row,) = fake.inserts("events")
    assert row["formation"] is None and row["relative_depth"] is None
    assert row["review_status"] == "pending"
    field = fake.field("formation")
    assert field["reason"] == "unknown_formation" and field["review_status"] == "pending"
    assert field["value"].obj == {"raw": "Zzyzx Fm", "value": None, "unit": None}


@pytest.mark.asyncio
async def test_missing_formation_is_filled_from_the_wells_own_tops(fake):
    extraction = extraction_for({"events": [event(formation=None)]})
    await ex.validate(make_doc(), [], extraction)
    (row,) = fake.inserts("events")
    assert row["formation"] == "Tipam" and row["relative_depth"] == 0.4


@pytest.mark.asyncio
async def test_failed_rule_makes_the_event_pending_with_the_rule_as_reason(fake):
    fake.well_td = 2000.0  # the event at 2398 m is deeper than TD + 50
    extraction = extraction_for({"events": [event()]})
    await ex.validate(make_doc(), [], extraction)

    (row,) = fake.inserts("events")
    assert row["review_status"] == "pending" and row["confidence"] <= 0.5
    assert fake.field("description")["reason"] == "failed_rule:depth_gt_td"


@pytest.mark.asyncio
async def test_page_ocr_confidence_lowers_the_item_confidence(fake):
    extraction = extraction_for({"events": [event(confidence=0.95)]}, [page(1, PAGE_ONE, ocr=0.7)])
    await ex.validate(make_doc(), [], extraction)
    (row,) = fake.inserts("events")
    assert row["confidence"] == 0.7 and row["review_status"] == "pending"


@pytest.mark.asyncio
async def test_duplicate_event_is_skipped_entirely(fake):
    fake.duplicate_event = True
    await ex.validate(make_doc(), [], extraction_for({"events": [event()]}))
    assert fake.inserts("events") == [] and fake.fields() == []


@pytest.mark.asyncio
async def test_wellbore_is_taken_from_the_document_when_set(fake):
    fake.wellbore_id = None  # would find nothing by well
    other = str(uuid4())
    await ex.validate(make_doc(wellbore_id=other), [], extraction_for({"events": [event()]}))
    assert fake.inserts("events")[0]["wellbore_id"] == other


@pytest.mark.asyncio
async def test_no_wellbore_means_review_fields_only(fake):
    fake.wellbore_id = None
    await ex.validate(make_doc(well_id=None), [], extraction_for({"events": [event()]}))

    assert fake.inserts("events") == []
    row = fake.field("description")
    assert row["entity_id"] is None and row["review_status"] in ("pending", "auto_approved")


@pytest.mark.asyncio
async def test_a_rerun_clears_unresolved_rows_but_keeps_the_well_assignment_row(fake):
    await ex.validate(make_doc(), [], extraction_for({}))
    sql, params = fake.executed[0]
    assert sql.strip().startswith("delete from extracted_fields")
    assert "not (entity = 'well_header' and field = 'well_id')" in sql
    assert params == {"doc_id": DOC_ID}


# ---------------------------------------------------------------- validate: other entities


@pytest.mark.asyncio
async def test_formation_tops_are_resolved_inserted_and_order_checked(fake):
    tops = [
        {"formation": "Tipam Sst", "top_md_m": 2310.5, "page": 1, "snippet": "Tipam", "confidence": 0.95},
        {"formation": "Kopili", "top_md_m": 2850.0, "page": 1, "snippet": "Kopili", "confidence": 0.95},
        {"formation": "Barail Group", "top_md_m": 2900.0, "page": 1, "snippet": "Barail", "confidence": 0.95},
        {"formation": "Nowhere", "top_md_m": 3000.0, "page": 1, "snippet": "Nowhere", "confidence": 0.95},
    ]
    page_text = "Tipam 2310.5 Kopili 2850.0 Barail 2900.0 Nowhere 3000"
    await ex.validate(make_doc(), [], extraction_for({"formation_tops": tops}, [page(1, page_text)]))

    inserted = fake.inserts("formation_tops")
    assert [r["formation"] for r in inserted] == ["Tipam", "Kopili", "Barail"]  # unknown formation: no row
    assert all(r["source"] == "actual" and r["provenance"] == "synthetic" for r in inserted)
    formation_rows = [r for r in fake.fields() if r["field"] == "formation"]
    assert [r["reason"] for r in formation_rows] == [
        None, None, "failed_rule:formation_order", "unknown_formation"]  # Barail (6) sits below Kopili (7)
    assert [r["entity_id"] for r in formation_rows] == ["top-existing"] * 3 + [None]  # unknown: no target row


@pytest.mark.asyncio
async def test_hole_section_and_cement_job_rows(fake):
    result = {
        "hole_sections": [{"hole_size_in": 12.25, "md_from_m": 900, "md_to_m": 2290, "casing_od_in": 9.625,
                           "casing_grade": "N80", "shoe_md_m": 2285, "page": 1, "snippet": "12.25", "confidence": 0.9}],
        "cement_jobs": [
            {"job_type": "Primary", "slurry_density_sg": 1.9, "volume_m3": 45, "issue": "losses", "page": 1,
             "snippet": "12.25", "confidence": 0.9},
            {"job_type": "grouting", "page": 1, "snippet": "12.25", "confidence": 0.9},
        ],
    }
    await ex.validate(make_doc(), [], extraction_for(result, [page(1, "12.25 hole section 9.625 casing")]))

    (hole,) = fake.inserts("hole_sections")
    assert hole["hole_size_in"] == 12.25 and hole["shoe_md_m"] == 2285 and hole["planned"] is False
    (cement,) = fake.inserts("cement_jobs")  # 'grouting' is not primary/squeeze/plug: no row
    assert cement["job_type"] == "primary" and cement["slurry_density_sg"] == 1.9


@pytest.mark.asyncio
async def test_mud_record_out_of_range_mw_is_pending_and_report_date_falls_back(fake):
    result = {"report_date": "2019-03-12", "mud_records": [
        {"md_m": 2400, "mw_sg": 3.1, "mud_type": "WBM", "page": 1, "snippet": "MW 3.1", "confidence": 0.95}]}
    await ex.validate(make_doc(), [], extraction_for(result, [page(1, "MW 3.1 SG at 2400 m")]))

    (row,) = fake.inserts("mud_records")
    assert row["mw_sg"] == 3.1 and row["report_date"] == date(2019, 3, 12)
    field = fake.field("mw_sg")
    assert field["reason"] == "failed_rule:mw_out_of_range" and field["review_status"] == "pending"


@pytest.mark.asyncio
async def test_ppg_mud_weight_is_converted_to_sg(fake):
    result = {"mud_records": [{"md_m": 2400, "mw_sg": 10.0, "page": 1, "snippet": "MW 10.0 ppg", "confidence": 0.95}]}
    await ex.validate(make_doc(), [], extraction_for(result, [page(1, "MW 10.0 ppg at 2400 m")]))
    (row,) = fake.inserts("mud_records")
    assert row["mw_sg"] == pytest.approx(10.0 / 8.345)
    assert fake.field("mw_sg")["value"].obj["raw"] == "10 ppg"


@pytest.mark.asyncio
async def test_time_log_infers_the_iadc_code_when_missing(fake):
    result = {"time_log": [
        {"md_m": 2395, "comment": "Fishing for lost cone", "page": 1, "snippet": "Fishing", "confidence": 0.9},
        {"md_m": 2400, "comment": "Rig service", "iadc_code": 7, "page": 1, "snippet": "Rig", "confidence": 0.9},
        {"md_m": 2401, "comment": "x", "iadc_code": 99, "page": 1, "snippet": "x", "confidence": 0.9},
    ]}
    await ex.validate(make_doc(), [], extraction_for(result, [page(1, "Fishing Rig service x")]))
    assert [r["iadc_code"] for r in fake.inserts("time_log")] == [19, 7, None]  # 99 is not an IADC code


@pytest.mark.asyncio
async def test_well_header_goes_to_review_as_fields_without_a_target_row(fake):
    result = {"well_header": {"field": "Duliajan", "kb_elev_m": 105.2, "spud_date": "2019-02-01", "td_md_m": 3620.0}}
    await ex.validate(make_doc(), [], extraction_for(result))

    rows = {r["field"]: r for r in fake.fields()}
    assert set(rows) == {"field", "kb_elev_m", "spud_date", "td_md_m"}
    assert all(r["entity"] == "well_header" and r["entity_id"] is None and r["review_status"] == "pending"
               and r["confidence"] == ex.HEADER_CONFIDENCE for r in rows.values())
    assert rows["spud_date"]["value"].obj["value"] == "2019-02-01"


@pytest.mark.asyncio
async def test_survey_stations_are_not_stored(fake):
    result = {"survey_stations": [{"md_m": 2400, "inc_deg": 18.5, "azi_deg": 112, "page": 1, "confidence": 0.9}]}
    await ex.validate(make_doc(), [], extraction_for(result))
    assert fake.fields() == [] and fake.inserts("survey_stations") == []

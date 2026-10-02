"""BE-21: the scoring and orchestration logic of the evaluation scripts (no OCR engine, LLM or database is run)."""

import json
import subprocess
import sys
import types
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from app import db
from app.models.enums import EventType
from app.risk import fuse
from training import evaluate_alerts as alerts_eval
from training import evaluate_extraction as extraction_eval
from training import ocr_bakeoff, report

NOW = datetime(2026, 10, 4, 9, 30, tzinfo=timezone.utc)


# ---------------------------------------------------------------- report helpers


def test_commit_hash_marks_a_dirty_tree_and_survives_a_missing_git(monkeypatch):
    def fake_run(cmd, **kwargs):
        out = "abc1234\n" if "rev-parse" in cmd else " M file.py\n"
        return types.SimpleNamespace(stdout=out)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert report.commit_hash() == "abc1234+dirty"
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: types.SimpleNamespace(stdout="abc1234\n" if "rev-parse" in cmd else ""))
    assert report.commit_hash() == "abc1234"

    def boom(*args, **kwargs):
        raise FileNotFoundError("git")

    monkeypatch.setattr(subprocess, "run", boom)
    assert report.commit_hash() == "unknown"


def test_append_section_creates_the_file_with_a_header_and_keeps_earlier_sections(tmp_path, monkeypatch):
    monkeypatch.setattr(report, "commit_hash", lambda: "abc1234")
    path = tmp_path / "docs" / "eval_results.md"
    report.append_section("OCR bake-off", "table one", path, NOW)
    report.append_section("Alerts", "table two", path, NOW)
    text = path.read_text(encoding="utf-8")
    assert text.startswith("# Evaluation results")
    assert "## OCR bake-off (2026-10-04 09:30 UTC, commit abc1234)\n\ntable one" in text
    assert text.index("OCR bake-off") < text.index("## Alerts (2026-10-04 09:30 UTC, commit abc1234)") and "table two" in text


def test_ground_truth_is_one_json_object_per_line_and_errors_name_the_line(tmp_path):
    good = tmp_path / "g.jsonl"
    good.write_text('{"page_id": "a"}\n\n{"page_id": "b"}\n', encoding="utf-8")
    assert [r["page_id"] for r in report.load_ground_truth(good)] == ["a", "b"]
    bad = tmp_path / "b.jsonl"
    bad.write_text('{"page_id": "a"}\n{oops\n', encoding="utf-8")
    with pytest.raises(ValueError, match="line 2"):
        report.load_ground_truth(bad)


def test_markdown_table_and_number_formatting():
    assert report.markdown_table(["A", "B"], [[1, "x"]]) == "| A | B |\n| --- | --- |\n| 1 | x |"
    assert report.fmt(None) == "n/a" and report.fmt(0.12345) == "0.123" and report.fmt(2.0, 1, " s") == "2.0 s"


# ---------------------------------------------------------------- OCR bake-off


def test_cer_is_edit_distance_over_the_transcription_ignoring_whitespace():
    assert ocr_cer("Losses at 2395 m", "Losses at 2395 m") == 0.0
    assert ocr_cer("Losses  at\n2395 m", "Losses at 2395 m") == 0.0
    assert ocr_cer("abcdefghij", "abcdefghiX") == pytest.approx(0.1)
    assert ocr_cer("", "abcd") == 1.0
    assert ocr_cer("abcdXXXX", "abcd") == 1.0  # insertions count against it
    with pytest.raises(ValueError):
        ocr_cer("anything", "   ")


def ocr_cer(a, b):
    return ocr_bakeoff.cer(a, b)


def test_cell_accuracy_needs_the_cell_in_the_same_row():
    truth = [[["Tipam", "2310.5"], ["Barail", "2680"]]]
    assert ocr_bakeoff.cell_accuracy(truth, [[["Tipam", "2310.5"], ["Barail", "2680"]]]) == (4, 4)
    assert ocr_bakeoff.cell_accuracy(truth, [[["Tipam", "2310.5"], ["Barail", "2860"]]]) == (3, 4)
    swapped = [[["Tipam", "2680"], ["Barail", "2310.5"]]]  # right numbers, wrong rows
    assert ocr_bakeoff.cell_accuracy(truth, swapped) == (2, 4)
    assert ocr_bakeoff.cell_accuracy(truth, [[["Girujan", "9999"]]]) == (0, 4)  # row not found: every cell misses
    assert ocr_bakeoff.cell_accuracy(truth, []) == (0, 4)


def test_cell_matching_is_fuzzy_at_90_percent():
    truth = [[["Tipam", "12.5"]]]
    assert ocr_bakeoff.cell_accuracy(truth, [[["Tipam.", "12.5"]]]) == (2, 2)  # ratio 90.9
    assert ocr_bakeoff.cell_accuracy(truth, [[["Tipam", "12.9"]]]) == (1, 2)  # ratio 66
    assert ocr_bakeoff.cell_accuracy([[["", "  "]]], [[["x"]]]) == (0, 0)  # empty cells are not counted


@pytest.fixture
def eval_pages(tmp_path):
    for page_id in ("p1", "p2"):
        (tmp_path / f"{page_id}.png").write_bytes(page_id.encode())
    records = [
        {"page_id": "p1", "text": "Partial losses at 2395 m", "tables": [[["Tipam", "2310.5"]]]},
        {"page_id": "p2", "text": "Pumped LCM pill"},
        {"page_id": "missing", "text": "no file for this page"},
    ]
    return tmp_path, records


def perfect(png):
    return {b"p1": ("Partial losses at 2395 m", [[["Tipam", "2310.5"]]]), b"p2": ("Pumped LCM pill", [])}[png]


def noisy(png):
    return {b"p1": ("Partial l0sses at 2395 m", [[["Tipam", "2310.9"]]]), b"p2": ("Pumped LCM p1ll", [])}[png]


def unavailable(png):
    raise RuntimeError("tesseract binary not found")


def test_find_page_file_tries_the_known_extensions(tmp_path):
    (tmp_path / "a.tif").write_bytes(b"x")
    (tmp_path / "b.pdf").write_bytes(b"x")
    assert ocr_bakeoff.find_page_file(tmp_path, "a").name == "a.tif"
    assert ocr_bakeoff.find_page_file(tmp_path, "b").name == "b.pdf"
    assert ocr_bakeoff.find_page_file(tmp_path, "c") is None


def test_bakeoff_scores_every_engine_on_every_page_with_a_file(eval_pages):
    pages_dir, records = eval_pages
    summaries = ocr_bakeoff.run_bakeoff(
        records, pages_dir, {"perfect": perfect, "noisy": noisy, "broken": unavailable}, load_png=lambda p: p.read_bytes()
    )
    by_name = {s.engine: s for s in summaries}
    assert by_name["perfect"].pages == 2 and by_name["perfect"].mean_cer == 0.0
    assert by_name["perfect"].cell_accuracy == 1.0 and by_name["perfect"].cells == 2  # only p1 has a table
    assert 0 < by_name["noisy"].mean_cer < 0.2 and by_name["noisy"].cell_accuracy == 0.5
    assert by_name["noisy"].mean_seconds >= 0 and by_name["noisy"].max_seconds >= by_name["noisy"].mean_seconds
    assert by_name["broken"].pages == 0 and by_name["broken"].failed == 2 and "tesseract binary" in by_name["broken"].unavailable
    assert by_name["broken"].mean_cer is None


def test_recommendation_is_the_lowest_cer_within_the_page_budget():
    fast = ocr_bakeoff.EngineSummary("fast", pages=3, mean_cer=0.08, mean_seconds=2.0, max_seconds=5.0, cell_accuracy=0.6, cells=10)
    best = ocr_bakeoff.EngineSummary("best", pages=3, mean_cer=0.03, mean_seconds=30.0, max_seconds=55.0, cell_accuracy=0.9, cells=10)
    slow = ocr_bakeoff.EngineSummary("slow", pages=3, mean_cer=0.01, mean_seconds=70.0, max_seconds=90.0)
    text = ocr_bakeoff.recommend([fast, best, slow])
    assert "**best**" in text and "0.030" in text and "Best table cell accuracy: best at 90.0%" in text
    over_budget = ocr_bakeoff.recommend([slow])
    assert "**slow**" in over_budget and "within 60 s" in over_budget
    assert "no recommendation" in ocr_bakeoff.recommend([ocr_bakeoff.EngineSummary("x", unavailable="gone")])


def test_markdown_lists_engines_and_what_did_not_run():
    summaries = [
        ocr_bakeoff.EngineSummary("a", pages=2, mean_cer=0.05, median_cer=0.04, mean_seconds=3.0, max_seconds=4.0),
        ocr_bakeoff.EngineSummary("b", pages=0, failed=2, unavailable="RuntimeError: nope"),
    ]
    text = ocr_bakeoff.render_markdown(summaries, "Lock **a**.", 2)
    assert "| a | 2 | 0 | 0.050 | 0.040 | n/a | 3.0 | 4.0 |" in text
    assert "Not run or failed:" in text and "- b: RuntimeError: nope" in text and "Lock **a**." in text


def test_bakeoff_cli_needs_the_labelled_set_and_skips_docling_unless_asked(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(report, "GROUND_TRUTH", tmp_path / "missing.jsonl")
    assert ocr_bakeoff.main([]) == 1

    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "p1.png").write_bytes(b"p1")
    truth = tmp_path / "gt.jsonl"
    truth.write_text(json.dumps({"page_id": "p1", "text": "Partial losses at 2395 m"}) + "\n", encoding="utf-8")
    called = []

    def heavy(png):
        called.append("docling")
        return "x", []

    monkeypatch.setattr(report, "GROUND_TRUTH", truth)
    monkeypatch.setattr(report, "PAGES_DIR", pages)
    monkeypatch.setattr(ocr_bakeoff, "page_png", lambda f: f.read_bytes())
    monkeypatch.setattr(ocr_bakeoff, "ENGINE_FUNCTIONS", {ocr_bakeoff.ENGINE_DOCLING: heavy, "tesseract_raw": lambda png: ("Partial losses at 2395 m", [])})
    monkeypatch.delenv("NWIS_RUN_DOCLING", raising=False)
    assert ocr_bakeoff.main(["--no-write"]) == 0
    out = capsys.readouterr().out
    assert called == [] and "skipping docling_rapidocr" in out and "tesseract_raw" in out and "Lock **tesseract_raw**" in out
    assert ocr_bakeoff.main(["--no-write", "--docling"]) == 0
    assert called == ["docling"]


# ---------------------------------------------------------------- extraction matching


def ev(event_type, md):
    return {"event_type": event_type, "md_from_m": md}


def test_event_match_scores_one_for_equal_type_and_half_for_the_same_risk_type():
    assert extraction_eval.match_events([ev("loss_partial", 2395)], [ev("loss_partial", 2400)]).score == 1.0
    half = extraction_eval.match_events([ev("tight_hole", 2395)], [ev("stuck_pipe_diff", 2400)])
    assert half.score == 0.5 and half.precision == 0.5 and half.recall == 0.5
    assert extraction_eval.match_events([ev("kick", 2395)], [ev("loss_partial", 2400)]).score == 0.0
    assert extraction_eval.match_events([ev("fishing", 2395)], [ev("equipment_failure", 2400)]).score == 0.0  # no risk type: only exact counts


def test_event_depth_tolerance_is_plus_minus_10_m_inclusive():
    assert extraction_eval.match_events([ev("kick", 2410)], [ev("kick", 2400)]).score == 1.0
    assert extraction_eval.match_events([ev("kick", 2410.1)], [ev("kick", 2400)]).score == 0.0
    assert extraction_eval.match_events([ev("kick", 2389.9)], [ev("kick", 2400)]).score == 0.0


def test_matching_is_one_to_one_and_prefers_the_better_pair():
    twice = extraction_eval.match_events([ev("kick", 2400), ev("kick", 2402)], [ev("kick", 2401)])
    assert twice.score == 1.0 and twice.precision == 0.5 and twice.recall == 1.0
    mixed = extraction_eval.match_events([ev("tight_hole", 2400), ev("stuck_pipe_diff", 2405)], [ev("stuck_pipe_diff", 2402)])
    assert mixed.score == 1.0  # the exact-type prediction wins the single truth event


def test_counts_are_none_not_zero_when_empty_and_f1_is_the_harmonic_mean():
    empty = extraction_eval.Counts()
    assert empty.precision is None and empty.recall is None and empty.f1 is None
    c = extraction_eval.Counts(score=3.0, predicted=4, truth=6)
    assert c.precision == 0.75 and c.recall == 0.5 and c.f1 == pytest.approx(0.6)


def test_formation_tops_match_within_5_m_case_insensitively_and_once_each():
    truth = [{"formation": "Tipam", "top_md_m": 2310.5}, {"formation": "Barail", "top_md_m": 2680.0}]
    pred = [{"formation": "tipam", "top_md_m": 2315.5}, {"formation": "Barail", "top_md_m": 2686.0}]
    assert extraction_eval.match_tops(pred, truth) == (1, 2)
    assert extraction_eval.match_tops([pred[0]], [truth[0], truth[0]]) == (1, 2)  # one prediction cannot match two truths


def test_evaluate_aggregates_micro_overall_and_per_doc_type():
    records = [
        {"page_id": "a", "doc_type": "ddr", "entities": {"events": [ev("kick", 100)], "formation_tops": [{"formation": "Tipam", "top_md_m": 50}]}},
        {"page_id": "b", "doc_type": "wcr", "entities": {"events": [ev("loss_partial", 200), ev("kick", 300)], "formation_tops": []}},
        {"page_id": "c", "doc_type": "wcr", "entities": {"events": []}},  # no prediction for this page: left out
    ]
    predictions = {
        "a": {"events": [ev("kick", 101), ev("kick", 500)], "formation_tops": [{"formation": "Tipam", "top_md_m": 52}]},
        "b": {"events": [ev("loss_partial", 200)], "formation_tops": []},
    }
    result = extraction_eval.evaluate(records, predictions)
    assert result["pages"] == 2 and result["tops_accuracy"] == 1.0 and result["tops_total"] == 1
    overall = result["overall"]
    assert (overall.score, overall.predicted, overall.truth) == (2.0, 3, 3)
    assert overall.precision == pytest.approx(2 / 3) and overall.recall == pytest.approx(2 / 3)
    assert list(result["per_doc_type"]) == ["ddr", "wcr"]
    assert result["per_doc_type"]["ddr"].precision == 0.5 and result["per_doc_type"]["wcr"].recall == 0.5


def test_report_states_each_target_as_met_or_below():
    assert extraction_eval.verdict(0.80, 0.80) == "meets" and extraction_eval.verdict(0.79, 0.80) == "BELOW" and extraction_eval.verdict(None, 0.8) == "n/a"
    records = [{"page_id": "a", "doc_type": "ddr", "entities": {"events": [ev("kick", 100)] * 1, "formation_tops": []}}]
    result = extraction_eval.evaluate(records, {"a": {"events": [ev("kick", 100)], "formation_tops": []}})
    text = extraction_eval.render_markdown(result, "ground-truth transcription")
    assert "| Event precision | 1.000 | >= 0.8 | meets |" in text and "| Event recall | 1.000 | >= 0.7 | meets |" in text
    assert "| ddr |" in text and "n/a" in text  # no truth tops: not scored


def test_prediction_is_built_from_the_extraction_result():
    result = types.SimpleNamespace(
        events=[types.SimpleNamespace(event_type=EventType.KICK, md_from_m=2395.0), types.SimpleNamespace(event_type="kick", md_from_m=None)],
        formation_tops=[types.SimpleNamespace(formation="Tipam", top_md_m=2310.0), types.SimpleNamespace(formation=None, top_md_m=5.0)],
    )
    assert extraction_eval.to_prediction(result) == {
        "events": [{"event_type": "kick", "md_from_m": 2395.0}],
        "formation_tops": [{"formation": "Tipam", "top_md_m": 2310.0}],
    }


@pytest.mark.asyncio
async def test_run_uses_the_transcription_and_counts_a_failed_page_as_empty(capsys):
    records = [
        {"page_id": "a", "doc_type": "ddr", "text": "text a", "entities": {"events": [ev("kick", 100)]}},
        {"page_id": "b", "doc_type": "ddr", "text": "text b", "entities": {"events": [ev("kick", 200)]}},
    ]
    seen = []

    async def predict(record, text):
        seen.append((record["page_id"], text))
        if record["page_id"] == "b":
            raise RuntimeError("both LLM providers failed")
        return {"events": [ev("kick", 100)], "formation_tops": []}

    result = await extraction_eval.run(records, "transcription", predict=predict)
    assert seen == [("a", "text a"), ("b", "text b")]
    assert result["pages"] == 2 and result["overall"].recall == 0.5 and "extraction failed for b" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_predict_page_hands_the_text_to_the_extraction_stage(monkeypatch):
    from app.ingest import extract

    captured = {}

    async def fake_extract(doc, pages):
        captured.update(doc=doc, pages=pages)
        return types.SimpleNamespace(result=types.SimpleNamespace(events=[], formation_tops=[]))

    monkeypatch.setattr(extract, "extract", fake_extract)
    out = await extraction_eval.predict_page({"page_id": "p1", "doc_type": "wcr"}, "page text")
    assert out == {"events": [], "formation_tops": []}
    assert captured["doc"] == {"id": "p1", "doc_type": "wcr"} and captured["pages"][0]["text"] == "page text" and captured["pages"][0]["page_no"] == 1


# ---------------------------------------------------------------- alerts


def truth_file(tmp_path, items, name="WELL.json"):
    path = tmp_path / name
    path.write_text(json.dumps(items), encoding="utf-8")
    return path


def alert(risk="losses", zone=(2490.0, 2515.0), bit=2300.0, key="k"):
    return {"dedup_key": key, "risk_type": risk, "zone_md_from_m": zone[0], "zone_md_to_m": zone[1], "bit_md_m": bit}


def test_truth_events_keep_only_those_with_a_risk_type(tmp_path):
    path = truth_file(tmp_path, [
        {"event_type": "loss_partial", "md_from_m": 2500, "md_to_m": 2510, "formation": "Tipam"},
        {"event_type": "fishing", "md_from_m": 2600}, {"event_type": "nonsense", "md_from_m": 1},
        {"event_type": "kick", "md_from_m": 2700},
    ])  # fmt: skip
    events = alerts_eval.load_truth(path)
    assert [(e.risk_type, e.md_from_m, e.md_to_m) for e in events] == [("losses", 2500.0, 2510.0), ("kick", 2700.0, 2700.0)]


def test_a_hit_is_an_alert_of_the_same_risk_covering_the_event_raised_while_the_bit_was_above_it():
    event = alerts_eval.TruthEvent("losses", "loss_partial", 2500.0, 2510.0)
    score = alerts_eval.score_well([event], [alert(bit=2300.0)], 2000.0, 3000.0)
    assert score.hits == 1 and score.leads_m == [200.0] and score.false_alerts == 0
    assert alerts_eval.score_well([event], [alert(bit=2300.0), alert(bit=2200.0, key="k2")], 2000.0, 3000.0).leads_m == [300.0]  # the earliest one counts


@pytest.mark.parametrize(
    "bad",
    [alert(bit=2500.0), alert(bit=2600.0), alert(risk="kick"), alert(zone=(2600.0, 2625.0)), alert(zone=(2400.0, 2425.0))],
)  # fmt: skip
def test_late_wrong_risk_or_non_covering_alerts_are_not_hits_but_also_flagged_correctly(bad):
    event = alerts_eval.TruthEvent("losses", "loss_partial", 2500.0, 2510.0)
    score = alerts_eval.score_well([event], [bad], 2000.0, 3000.0)
    assert score.hits == 0 and score.leads_m == []


def test_false_alerts_are_those_covering_no_event_of_their_type():
    event = alerts_eval.TruthEvent("losses", "loss_partial", 2500.0, 2510.0)
    alerts = [alert(key="a"), alert(risk="kick", key="b"), alert(zone=(2800.0, 2825.0), key="c"), alert(bit=2600.0, key="late")]
    score = alerts_eval.score_well([event], alerts, 2000.0, 3000.0)
    assert score.alerts == 4 and score.false_alerts == 2  # the kick alert and the one far from the event; a late alert is late, not false


def test_events_above_the_replay_start_are_not_hidden_future_events():
    early = alerts_eval.TruthEvent("losses", "loss_partial", 1500.0, 1500.0)
    assert alerts_eval.score_well([early], [], 2000.0, 3000.0).events == 0


def test_combined_figures_are_hit_rate_median_lead_and_false_alerts_per_km():
    a = alerts_eval.WellScore(events=4, hits=3, leads_m=[100.0, 200.0, 300.0], alerts=5, false_alerts=2, drilled_m=1000.0)
    b = alerts_eval.WellScore(events=2, hits=1, leads_m=[50.0], alerts=1, false_alerts=0, drilled_m=500.0)
    total = alerts_eval.combine([a, b])
    assert total["hit_rate"] == pytest.approx(4 / 6) and total["median_lead_m"] == 150.0
    assert total["false_per_1000m"] == pytest.approx(2 / 1.5) and total["wells"] == 2
    none = alerts_eval.combine([alerts_eval.WellScore()])
    assert none["hit_rate"] is None and none["median_lead_m"] is None and none["false_per_1000m"] is None


def test_alert_report_lists_the_three_measures_and_each_well():
    a = alerts_eval.WellScore(events=4, hits=3, leads_m=[100.0, 200.0, 300.0], alerts=5, false_alerts=2, drilled_m=1000.0)
    text = alerts_eval.render_markdown({"SYN-A": a}, alerts_eval.combine([a]))
    assert "3 of 4 (0.75)" in text and "| Median lead distance (m) | 200 |" in text and "| False alerts per 1,000 m | 2.00 |" in text
    assert "| SYN-A | 4 | 3 | 0.75 | 200 | 5 | 2 | 1000 |" in text


# ---------------------------------------------------------------- the recording replay


class ReplayDb:
    def __init__(self, n=60):
        self.rows = [{"md_m": 2000.0 + (i + 1) * 0.5, "t": None, "rop_m_h": 12.0} for i in range(n)]

    async def fetch_one(self, sql, params=None):
        return {"id": params["id"]}

    async def fetch_all(self, sql, params=None):
        return [r for r in self.rows if r["md_m"] > params["start"]]

    async def execute(self, sql, params=None):
        return None


@pytest.mark.asyncio
async def test_the_recording_replay_notes_the_bit_at_which_each_alert_first_appears(monkeypatch):
    fake = ReplayDb()
    monkeypatch.setattr(db, "fetch_one", fake.fetch_one)
    monkeypatch.setattr(db, "fetch_all", fake.fetch_all)
    monkeypatch.setattr(db, "execute", fake.execute)

    async def compute(wellbore_id, *args):
        return []

    class Engine:
        @staticmethod
        async def evaluate(*args):
            return []

    monkeypatch.setattr(fuse, "compute_and_store", compute)
    monkeypatch.setitem(sys.modules, "app.alerts.engine", Engine)
    hooks = {"n": 0}

    async def reader(wellbore_id):
        hooks["n"] += 1
        found = [{"dedup_key": "first", "kind": "lookahead", "risk_type": "losses", "zone_md_from_m": 2500.0, "zone_md_to_m": 2525.0}] if hooks["n"] >= 3 else []
        if hooks["n"] >= 5:
            found.append({"dedup_key": "second", "kind": "detector", "risk_type": "kick", "zone_md_from_m": 2000.0, "zone_md_to_m": 2050.0})
        return found

    wb = str(uuid4())
    seen = await alerts_eval.replay_well(wb, 2000.0, reader)
    by_key = {a["dedup_key"]: a for a in seen}
    assert set(by_key) == {"first", "second"}
    # the risk hook runs at 2000.5 m and then every 5 m; "first" shows up at the 3rd hook, "second" at the 5th
    assert by_key["first"]["bit_md_m"] == 2010.5 and by_key["second"]["bit_md_m"] == 2020.5  # a later hook never overwrites the first sighting


@pytest.mark.asyncio
async def test_the_fast_clock_jumps_instead_of_waiting():
    clock = alerts_eval.FastClock()
    start = clock.now()
    await clock.sleep(3600.0)
    assert (clock.now() - start).total_seconds() == 3600.0


class RunDb:
    def __init__(self, wells, existing_alerts=()):
        self.wells, self.existing, self.deleted = wells, list(existing_alerts), []

    async def fetch_all(self, sql, params=None):
        if "from wells w join wellbores wb" in sql:
            return self.wells
        if "from alerts" in sql:
            return self.existing
        raise AssertionError(sql)

    async def execute(self, sql, params=None):
        self.deleted.append(sql.split()[2])  # "delete from <table>"


@pytest.fixture
def run_env(tmp_path, monkeypatch):
    wells = [
        {"wellbore_id": uuid4(), "name": "SYN-A", "td_md_m": 3000.0},
        {"wellbore_id": uuid4(), "name": "SYN-NOTRUTH", "td_md_m": 3000.0},
    ]
    state = RunDb(wells)
    monkeypatch.setattr(db, "fetch_all", state.fetch_all)
    monkeypatch.setattr(db, "execute", state.execute)

    async def bit_depth(wellbore_id):
        return 2000.0

    replayed = []

    async def fake_replay(wellbore_id, start, reader=None):
        replayed.append((wellbore_id, start))
        return [alert(bit=2300.0)]

    monkeypatch.setattr(fuse, "bit_depth", bit_depth)
    monkeypatch.setattr(alerts_eval, "replay_well", fake_replay)
    truth_file(tmp_path, [{"event_type": "loss_partial", "md_from_m": 2500, "md_to_m": 2510}], "SYN-A.json")
    state.replayed, state.truth_dir = replayed, tmp_path
    return state


@pytest.mark.asyncio
async def test_run_replays_wells_that_have_truth_and_scores_them(run_env, capsys):
    scores = await alerts_eval.run(reset=False, limit=None, start_md_m=None, truth_dir=run_env.truth_dir)
    assert list(scores) == ["SYN-A"] and scores["SYN-A"].hits == 1 and scores["SYN-A"].leads_m == [200.0]
    assert run_env.replayed[0][1] == 2000.0 and "skip SYN-NOTRUTH: no truth file" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_run_refuses_to_touch_a_well_with_alerts_unless_reset(run_env, capsys):
    run_env.existing = [{"dedup_key": "old"}]
    assert await alerts_eval.run(False, None, None, run_env.truth_dir) == {}
    assert run_env.replayed == [] and run_env.deleted == [] and "already has alerts" in capsys.readouterr().out

    scores = await alerts_eval.run(True, None, 2200.0, run_env.truth_dir)
    assert list(scores) == ["SYN-A"] and run_env.deleted == ["alerts", "risk_scores"]
    assert run_env.replayed[0][1] == 2200.0  # an explicit start depth wins

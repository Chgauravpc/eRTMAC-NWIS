"""Extraction precision / recall against the labelled set (BE-21).

    python -m training.evaluate_extraction                  # text = the ground-truth transcription (isolates the LLM)
    python -m training.evaluate_extraction --source ocr     # text = OCR of the page files (needs an OCR engine; heavy)

Runs the LLM extraction stage (`app.ingest.extract.extract`: prompts, JSON repair, merge) on each labelled page and
compares the result with the ground-truth entities (contract §10 shape). Normalisation and review rows, which
need the database, are not part of this measurement.

Matching (BE-21): an event matches a ground-truth event if `md_from_m` is within +/-10 m and the type is equal
(score 1) or maps to the same risk type (score 0.5), one-to-one. Precision = score / predicted events, recall =
score / ground-truth events, micro-averaged, overall and per doc_type. Formation tops count if the same formation
is within +/-5 m. Targets from NWIS_PRD §1: precision >= 0.80, recall >= 0.70, tops >= 85 %.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from app.models.enums import EVENT_TO_RISK, EventType
from training import report

EVENT_MD_TOLERANCE_M = 10.0
TOP_MD_TOLERANCE_M = 5.0
SAME_RISK_SCORE = 0.5  # same risk type but a different event type counts as half
TARGET_PRECISION = 0.80
TARGET_RECALL = 0.70
TARGET_TOPS = 0.85


def risk_of(event_type: str) -> str | None:
    try:
        risk = EVENT_TO_RISK.get(EventType(event_type))
    except ValueError:
        return None
    return risk.value if risk else None


# ---------------------------------------------------------------- matching (pure)


@dataclass
class Counts:
    score: float = 0.0
    predicted: int = 0
    truth: int = 0

    def add(self, other: "Counts") -> None:
        self.score += other.score
        self.predicted += other.predicted
        self.truth += other.truth

    @property
    def precision(self) -> float | None:
        return self.score / self.predicted if self.predicted else None

    @property
    def recall(self) -> float | None:
        return self.score / self.truth if self.truth else None

    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        return None if p is None or r is None or p + r == 0 else 2 * p * r / (p + r)


def match_events(predicted: list[dict[str, Any]], truth: list[dict[str, Any]], tolerance_m: float = EVENT_MD_TOLERANCE_M) -> Counts:
    """One-to-one matching of one page's events; best score first, then the smallest depth difference."""
    candidates = []
    for i, p in enumerate(predicted):
        for j, t in enumerate(truth):
            gap = abs(p["md_from_m"] - t["md_from_m"])
            if gap > tolerance_m:
                continue
            if p["event_type"] == t["event_type"]:
                score = 1.0
            elif risk_of(p["event_type"]) is not None and risk_of(p["event_type"]) == risk_of(t["event_type"]):
                score = SAME_RISK_SCORE
            else:
                continue
            candidates.append((-score, gap, i, j))
    used_p, used_t, total = set(), set(), 0.0
    for negative_score, _gap, i, j in sorted(candidates):
        if i in used_p or j in used_t:
            continue
        used_p.add(i)
        used_t.add(j)
        total += -negative_score
    return Counts(total, len(predicted), len(truth))


def match_tops(predicted: list[dict[str, Any]], truth: list[dict[str, Any]], tolerance_m: float = TOP_MD_TOLERANCE_M) -> tuple[int, int]:
    """(ground-truth tops found within the tolerance, ground-truth tops) for one page; each prediction is used once."""
    available = list(predicted)
    hits = 0
    for t in truth:
        for p in available:
            if p["formation"].strip().lower() == t["formation"].strip().lower() and abs(p["top_md_m"] - t["top_md_m"]) <= tolerance_m:
                available.remove(p)
                hits += 1
                break
    return hits, len(truth)


def evaluate(records: list[dict[str, Any]], predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Aggregate over the labelled pages. `predictions[page_id]` has "events" and "formation_tops" lists."""
    overall = Counts()
    per_doc: dict[str, Counts] = defaultdict(Counts)
    tops_hit = tops_total = 0
    pages = 0
    for record in records:
        page_id = record["page_id"]
        if page_id not in predictions:
            continue
        pages += 1
        entities = record.get("entities") or {}
        found = match_events(predictions[page_id].get("events", []), entities.get("events", []))
        overall.add(found)
        per_doc[record.get("doc_type", "other")].add(found)
        hit, total = match_tops(predictions[page_id].get("formation_tops", []), entities.get("formation_tops", []))
        tops_hit, tops_total = tops_hit + hit, tops_total + total
    return {
        "pages": pages,
        "overall": overall,
        "per_doc_type": dict(sorted(per_doc.items())),
        "tops_accuracy": tops_hit / tops_total if tops_total else None,
        "tops_total": tops_total,
    }


def verdict(value: float | None, target: float) -> str:
    return "n/a" if value is None else ("meets" if value >= target else "BELOW")


def render_markdown(result: dict[str, Any], source: str) -> str:
    overall: Counts = result["overall"]
    rows = [["all pages", result["pages"], overall.truth, overall.predicted, report.fmt(overall.precision), report.fmt(overall.recall), report.fmt(overall.f1)]]
    for doc_type, counts in result["per_doc_type"].items():
        rows.append([doc_type, "", counts.truth, counts.predicted, report.fmt(counts.precision), report.fmt(counts.recall), report.fmt(counts.f1)])
    table = report.markdown_table(["Doc type", "Pages", "Truth events", "Predicted events", "Precision", "Recall", "F1"], rows)
    targets = report.markdown_table(
        ["Measure", "Measured", "Target", "Status"],
        [
            ["Event precision", report.fmt(overall.precision), f">= {TARGET_PRECISION}", verdict(overall.precision, TARGET_PRECISION)],
            ["Event recall", report.fmt(overall.recall), f">= {TARGET_RECALL}", verdict(overall.recall, TARGET_RECALL)],
            [f"Formation tops within {TOP_MD_TOLERANCE_M:g} m ({result['tops_total']} tops)", report.fmt(result["tops_accuracy"]), f">= {TARGET_TOPS}", verdict(result["tops_accuracy"], TARGET_TOPS)],
        ],
    )  # fmt: skip
    return (
        f"Text source: {source}. Event match: type equal (1) or same risk type (0.5), within +/-{EVENT_MD_TOLERANCE_M:g} m, "
        f"one-to-one.\n\n{table}\n\n{targets}"
    )


# ---------------------------------------------------------------- running the extraction


def to_prediction(result: Any) -> dict[str, Any]:
    """ExtractionResult -> {"events": [...], "formation_tops": [...]} with plain values."""
    return {
        "events": [
            {"event_type": str(getattr(e.event_type, "value", e.event_type)), "md_from_m": e.md_from_m}
            for e in result.events if e.md_from_m is not None
        ],
        "formation_tops": [
            {"formation": t.formation, "top_md_m": t.top_md_m} for t in result.formation_tops if t.formation and t.top_md_m is not None
        ],
    }  # fmt: skip


async def predict_page(record: dict[str, Any], text: str) -> dict[str, Any]:
    from app.ingest import extract

    doc = {"id": record["page_id"], "doc_type": record.get("doc_type", "other")}
    pages = [{"page_no": 1, "text": text, "ocr_confidence": None, "boxes": [], "tables": []}]
    extraction = await extract.extract(doc, pages)
    return to_prediction(extraction.result)


def ocr_text(page_file: Any) -> str:
    from app.ingest import ocr

    from training.ocr_bakeoff import page_png

    return ocr._ocr_page(page_png(page_file), ocr.ENGINE_RAPIDOCR).text


async def run(records: list[dict[str, Any]], source: str, predict=predict_page, read_text=None) -> dict[str, Any]:
    predictions: dict[str, dict[str, Any]] = {}
    for record in records:
        if source == "ocr":
            from training.ocr_bakeoff import find_page_file

            file = find_page_file(report.PAGES_DIR, record["page_id"])
            if file is None:
                print(f"skip {record['page_id']}: no page file")
                continue
            text = (read_text or ocr_text)(file)
        else:
            text = record["text"]
        try:
            predictions[record["page_id"]] = await predict(record, text)
        except Exception as exc:  # noqa: BLE001 - count the page as predicting nothing rather than dropping it
            print(f"extraction failed for {record['page_id']}: {exc}", file=sys.stderr)
            predictions[record["page_id"]] = {"events": [], "formation_tops": []}
    return evaluate(records, predictions)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m training.evaluate_extraction", description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", choices=["transcription", "ocr"], default="transcription")
    parser.add_argument("--limit", type=int, help="only the first N labelled pages")
    parser.add_argument("--no-write", action="store_true", help="print the section instead of appending it to docs/eval_results.md")
    args = parser.parse_args(argv)
    if not report.GROUND_TRUTH.exists():
        print(f"{report.GROUND_TRUTH} not found: the labelled evaluation set (DB-14) does not exist yet", file=sys.stderr)
        return 1
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    records = report.load_ground_truth()[: args.limit]
    result = asyncio.run(run(records, args.source))
    body = render_markdown(result, "ground-truth transcription" if args.source == "transcription" else "OCR of the page files")
    if args.no_write:
        print(body)
    else:
        report.append_section("Extraction precision and recall", body)
        print(f"appended to {report.EVAL_RESULTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

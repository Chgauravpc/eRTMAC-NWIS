"""OCR bake-off (BE-21): which engine reads our pages best? The team locks the OCR engine from this result.

    python -m training.ocr_bakeoff                 # the two Tesseract variants (light)
    python -m training.ocr_bakeoff --docling       # also Docling + RapidOCR (heavy: it crashed a dev PC once; run it alone)

For every page in db/eval/ (DB-14) it runs
  (a) Docling + RapidOCR     (b) Tesseract with preprocessing     (c) Tesseract on the raw image
and measures the character error rate (Levenshtein distance / length of the transcription, whitespace
normalised), cell accuracy on pages that have a ground-truth table, and time per page.

Table ground truth is optional: a ground_truth.jsonl line may carry `"tables": [[["cell", ...], ...], ...]`
(rows of cells); pages without it only contribute to CER.
"""

from __future__ import annotations

import argparse
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

from training import report

CELL_MATCH_MIN_RATIO = 90  # fuzzy ratio for a cell (and for finding its row)
PAGE_BUDGET_S = 60.0  # the pipeline's per-page OCR timeout (app.ingest.ocr.PAGE_TIMEOUT_S)
PAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".pdf")
ENGINE_DOCLING = "docling_rapidocr"
ENGINE_TESS_PREPROCESSED = "tesseract_preprocessed"
ENGINE_TESS_RAW = "tesseract_raw"
ALL_ENGINES = (ENGINE_DOCLING, ENGINE_TESS_PREPROCESSED, ENGINE_TESS_RAW)

EngineFn = Callable[[bytes], tuple[str, list[list[list[str]]]]]  # PNG bytes -> (text, tables)


# ---------------------------------------------------------------- metrics (pure)


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def cer(predicted: str, truth: str) -> float:
    """Character error rate against the transcription: edit distance / len(truth) on whitespace-normalised text."""
    reference = normalise(truth)
    if not reference:
        raise ValueError("the ground-truth transcription is empty")
    return Levenshtein.distance(normalise(predicted), reference) / len(reference)


def _similar(a: str, b: str) -> bool:
    return fuzz.ratio(normalise(a).lower(), normalise(b).lower()) >= CELL_MATCH_MIN_RATIO


def cell_accuracy(truth_tables: list[list[list[str]]], predicted_tables: list[list[list[str]]]) -> tuple[int, int]:
    """(cells found, ground-truth cells): a cell counts if its text (fuzzy >= 90) is in the same row of a predicted table.

    A truth row is paired with the predicted rows that contain its first non-empty cell; with no such row all its cells miss.
    """
    predicted_rows = [row for table in predicted_tables for row in table]
    hits = total = 0
    for table in truth_tables:
        for row in table:
            cells = [c for c in row if normalise(c)]
            if not cells:
                continue
            total += len(cells)
            anchor = cells[0]
            candidates = [r for r in predicted_rows if any(_similar(anchor, c) for c in r)]
            hits += sum(1 for cell in cells if any(_similar(cell, c) for r in candidates for c in r))
    return hits, total


# ---------------------------------------------------------------- engines


def _decode(png: bytes) -> Any:
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("page image could not be decoded")
    return image


def engine_docling_rapidocr(png: bytes) -> tuple[str, list[list[list[str]]]]:
    from app.ingest import ocr

    output = ocr._rapidocr_page(png, _decode(png))  # RapidOCR text; Docling tables and markdown
    return output.text, output.tables


def engine_tesseract_preprocessed(png: bytes) -> tuple[str, list[list[list[str]]]]:
    from app.ingest import ocr

    output = ocr._tesseract_page(_decode(png))  # grayscale, deskew, upscale, threshold, then Tesseract
    return output.text, output.tables


def engine_tesseract_raw(png: bytes) -> tuple[str, list[list[list[str]]]]:
    import pytesseract

    from app.ingest import ocr

    image = _decode(png)
    try:
        data = pytesseract.image_to_data(image, lang="eng", config="--psm 6", output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractNotFoundError as exc:
        raise ocr.TesseractUnavailable("tesseract binary not found") from exc
    height, width = image.shape[:2]
    output = ocr._tesseract_output(data, width, height)
    return output.text, output.tables


ENGINE_FUNCTIONS: dict[str, EngineFn] = {
    ENGINE_DOCLING: engine_docling_rapidocr,
    ENGINE_TESS_PREPROCESSED: engine_tesseract_preprocessed,
    ENGINE_TESS_RAW: engine_tesseract_raw,
}


# ---------------------------------------------------------------- pages


def page_png(page_file: Path) -> bytes:
    """PNG bytes of an eval page: an image file is read as is (re-encoded to PNG), a PDF is rendered at 200 DPI."""
    from app.ingest import ocr

    data = page_file.read_bytes()
    pages, _total = ocr._render_pages(data, page_file.suffix.lower())
    if not pages:
        raise ValueError(f"{page_file.name} has no pages")
    return pages[0].png


def find_page_file(pages_dir: Path, page_id: str) -> Path | None:
    for extension in PAGE_EXTENSIONS:
        candidate = pages_dir / f"{page_id}{extension}"
        if candidate.exists():
            return candidate
    return None


# ---------------------------------------------------------------- the bake-off


@dataclass
class PageScore:
    page_id: str
    engine: str
    seconds: float
    cer: float | None = None
    cells_hit: int = 0
    cells_total: int = 0
    error: str | None = None


@dataclass
class EngineSummary:
    engine: str
    pages: int = 0
    failed: int = 0
    mean_cer: float | None = None
    median_cer: float | None = None
    cell_accuracy: float | None = None
    cells: int = 0
    mean_seconds: float | None = None
    max_seconds: float | None = None
    unavailable: str | None = None
    scores: list[PageScore] = field(default_factory=list)


def score_page(engine: str, fn: EngineFn, page_id: str, png: bytes, record: dict[str, Any]) -> PageScore:
    started = time.perf_counter()
    try:
        text, tables = fn(png)
    except Exception as exc:  # noqa: BLE001 - one bad page must not stop the bake-off
        return PageScore(page_id, engine, time.perf_counter() - started, error=f"{type(exc).__name__}: {exc}")
    seconds = time.perf_counter() - started
    score = PageScore(page_id, engine, seconds, cer=cer(text, record["text"]))
    if record.get("tables"):
        score.cells_hit, score.cells_total = cell_accuracy(record["tables"], tables)
    return score


def summarise(engine: str, scores: list[PageScore]) -> EngineSummary:
    done = [s for s in scores if s.error is None]
    summary = EngineSummary(engine, pages=len(done), failed=len(scores) - len(done), scores=scores)
    if not done:
        errors = {s.error for s in scores if s.error}
        summary.unavailable = "; ".join(sorted(errors))[:300] if errors else "no pages"
        return summary
    cers = [s.cer for s in done]
    summary.mean_cer, summary.median_cer = statistics.mean(cers), statistics.median(cers)
    summary.mean_seconds, summary.max_seconds = statistics.mean(s.seconds for s in done), max(s.seconds for s in done)
    summary.cells = sum(s.cells_total for s in done)
    if summary.cells:
        summary.cell_accuracy = sum(s.cells_hit for s in done) / summary.cells
    return summary


def run_bakeoff(
    records: list[dict[str, Any]], pages_dir: Path, engines: dict[str, EngineFn], load_png: Callable[[Path], bytes] | None = None
) -> list[EngineSummary]:
    load_png = load_png or page_png
    pngs: dict[str, bytes] = {}
    for record in records:
        file = find_page_file(pages_dir, record["page_id"])
        if file is not None:
            pngs[record["page_id"]] = load_png(file)
    scores: dict[str, list[PageScore]] = {name: [] for name in engines}
    for record in records:
        if record["page_id"] not in pngs:
            continue
        for name, fn in engines.items():
            scores[name].append(score_page(name, fn, record["page_id"], pngs[record["page_id"]], record))
    return [summarise(name, scores[name]) for name in engines]


def recommend(summaries: list[EngineSummary]) -> str:
    """The engine with the lowest mean CER whose slowest page fits the per-page budget; says why."""
    usable = [s for s in summaries if s.mean_cer is not None]
    if not usable:
        return "No engine produced a result, so there is no recommendation."
    in_budget = [s for s in usable if (s.max_seconds or 0) <= PAGE_BUDGET_S]
    pool = in_budget or usable
    best = min(pool, key=lambda s: s.mean_cer)
    note = "" if in_budget else f" (no engine kept every page within {PAGE_BUDGET_S:.0f} s; this is the lowest CER anyway)"
    text = f"Lock **{best.engine}**: mean CER {best.mean_cer:.3f}, {best.mean_seconds:.1f} s per page on average{note}."
    with_tables = [s for s in usable if s.cell_accuracy is not None]
    if with_tables:
        top_tables = max(with_tables, key=lambda s: s.cell_accuracy)
        text += f" Best table cell accuracy: {top_tables.engine} at {top_tables.cell_accuracy:.1%} ({top_tables.cells} cells)."
    return text


def render_markdown(summaries: list[EngineSummary], recommendation: str, n_pages: int) -> str:
    rows = [
        [
            s.engine, s.pages, s.failed, report.fmt(s.mean_cer), report.fmt(s.median_cer),
            "n/a" if s.cell_accuracy is None else f"{s.cell_accuracy:.1%} ({s.cells})",
            report.fmt(s.mean_seconds, 1), report.fmt(s.max_seconds, 1),
        ]
        for s in summaries
    ]  # fmt: skip
    table = report.markdown_table(
        ["Engine", "Pages", "Failed", "Mean CER", "Median CER", "Table cell accuracy (cells)", "Mean s/page", "Max s/page"], rows
    )
    unavailable = [f"- {s.engine}: {s.unavailable}" for s in summaries if s.unavailable]
    parts = [f"{n_pages} labelled pages. CER = edit distance / transcription length (lower is better).", "", table, "", recommendation]
    if unavailable:
        parts += ["", "Not run or failed:", *unavailable]
    return "\n".join(parts)


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m training.ocr_bakeoff", description=__doc__.split("\n\n")[0])
    parser.add_argument("--docling", action="store_true", help="also run Docling + RapidOCR (heavy; or set NWIS_RUN_DOCLING=1)")
    parser.add_argument("--limit", type=int, help="only the first N labelled pages")
    parser.add_argument("--no-write", action="store_true", help="print the section instead of appending it to docs/eval_results.md")
    args = parser.parse_args(argv)

    if not report.GROUND_TRUTH.exists():
        print(f"{report.GROUND_TRUTH} not found: the labelled evaluation set (DB-14) does not exist yet", file=sys.stderr)
        return 1
    records = report.load_ground_truth()[: args.limit]
    run_docling = args.docling or os.environ.get("NWIS_RUN_DOCLING") == "1"
    engines = {n: f for n, f in ENGINE_FUNCTIONS.items() if n != ENGINE_DOCLING or run_docling}
    if not run_docling:
        print("skipping docling_rapidocr (heavy): pass --docling or set NWIS_RUN_DOCLING=1")

    summaries = run_bakeoff(records, report.PAGES_DIR, engines)
    n_pages = max((s.pages + s.failed for s in summaries), default=0)
    if n_pages == 0:
        print("no page of the ground truth was found in db/eval/pages", file=sys.stderr)
        return 1
    body = render_markdown(summaries, recommend(summaries), n_pages)
    if args.no_write:
        print(body)
    else:
        report.append_section("OCR bake-off", body)
        print(f"appended to {report.EVAL_RESULTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""OCR / parse stage of the ingest pipeline (BE-07).

Contract §6 (documents, document_pages), §8 (page-images bucket).

`ocr_or_parse(doc)` turns a stored file into `PageResult` dicts and writes the
`document_pages` rows (plus `documents.pages / has_text_layer / ocr_engine` and
the page PNGs in the `page-images` bucket):

* Structured files (WITSML XML, LAS, survey CSV/XLSX) go through the BE-06
  parsers and become one readable pseudo-page; other non-visual files (plain
  text such as NPD wellbore histories) become one text page.
* PDFs and images are rendered with PyMuPDF at 200 DPI. A page with a text
  layer (>= 200 characters) uses it (engine `text_layer`). Other pages are
  OCRed: Docling (layout + table structure) with RapidOCR, box confidences from
  Docling if it exposes them, else from RapidOCR run directly. A page whose
  confidence is below OCR_RETRY_BELOW is cleaned up (preprocess.py) and retried
  with Tesseract; the result with the higher mean confidence wins.

Heavy libraries (fitz, docling, rapidocr, cv2, pytesseract) are imported lazily
so the service starts, and the tests import this module, without them.
"""

from __future__ import annotations

import asyncio
import io
import threading
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any, TypedDict

from app import db, storage
from app.config import get_settings
from app.logging import get_logger
from app.models.enums import DocType

logger = get_logger(__name__)

RENDER_DPI = 200
TEXT_LAYER_MIN_CHARS = 200
OCR_RETRY_BELOW = 0.60
MAX_PAGES = 60
PAGE_TIMEOUT_S = 60.0

PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
TABULAR_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".xls"}

ENGINE_TEXT_LAYER = "text_layer"
ENGINE_RAPIDOCR = "rapidocr"
ENGINE_TESSERACT = "tesseract"


class PageResult(TypedDict):
    """One page. `boxes` are text lines: {"text", "conf", "bbox"} with `bbox` =
    {"x", "y", "w", "h"} as fractions of the page (0..1), the shape
    extracted_fields.bbox uses. `conf` is 0..1 (None for text-layer lines)."""

    page_no: int
    text: str
    markdown: str
    tables: list[list[list[str]]]
    ocr_confidence: float | None
    engine: str
    boxes: list[dict[str, Any]] | None


class TesseractUnavailable(RuntimeError):
    """The tesseract binary is not installed."""


@dataclass
class OcrOutput:
    text: str
    markdown: str
    tables: list[list[list[str]]]
    confidence: float
    engine: str
    boxes: list[dict[str, Any]]


@dataclass
class RenderedPage:
    page_no: int
    png: bytes
    layer_text: str = ""
    layer_boxes: list[dict[str, Any]] = field(default_factory=list)
    layer_tables: list[list[list[str]]] = field(default_factory=list)


# ======================================================================
# Entry point
# ======================================================================


async def ocr_or_parse(doc: dict[str, Any]) -> list[PageResult]:
    """Read the document's stored file into pages and persist them."""
    doc_id = str(doc["id"])
    ext = PurePosixPath(str(doc["file_path"]).lower()).suffix
    data = await asyncio.to_thread(storage.download, "documents", doc["file_path"])

    if ext in PDF_EXTENSIONS or ext in IMAGE_EXTENSIONS:
        results = await _read_visual(data, ext)
    else:
        text, tables = await asyncio.to_thread(_read_non_visual, data, ext, str(doc["doc_type"]))
        results = [(_text_page(1, text, tables), None)]

    await _store(doc_id, results)
    return [page for page, _ in results]


def _text_page(page_no: int, text: str, tables: list | None = None) -> PageResult:
    return PageResult(
        page_no=page_no, text=text, markdown=text, tables=tables or [],
        ocr_confidence=None, engine=ENGINE_TEXT_LAYER, boxes=None,
    )


# ======================================================================
# Structured / text files (BE-06 parsers)
# ======================================================================


def _read_non_visual(data: bytes, ext: str, doc_type: str) -> tuple[str, list]:
    """(text, tables) for XML / LAS / survey tables / plain text."""
    from app.ingest.parsers import las as las_parser
    from app.ingest.parsers import tabular, witsml

    if doc_type == DocType.WITSML.value or ext == ".xml":
        return _render_witsml(data, witsml), []
    if doc_type == DocType.LAS.value or ext == ".las":
        return _render_las(data, las_parser), []
    if ext in TABULAR_EXTENSIONS:
        return _render_table(data, ext, tabular), []
    return data.decode("utf-8", errors="replace"), []


def _fmt_time(value: datetime | None) -> str:
    return value.strftime("%H:%M") if value else "--:--"


def _fmt_m(value: float | None) -> str:
    return f"{value:.0f} m" if value is not None else "? m"


def _render_witsml(data: bytes, witsml: Any) -> str:
    reports = witsml.parse_drill_report(data)
    if reports:
        return "\n\n".join(_render_drill_report(r) for r in reports)
    name, stations = witsml.parse_trajectory(data)
    if stations:
        lines = [f"Trajectory survey, wellbore {name or '?'}"]
        lines += [f"MD {s.md_m:.1f} m | INC {s.inc_deg:.2f} deg | AZI {s.azi_deg:.2f} deg" for s in stations]
        return "\n".join(lines)
    name, frame = witsml.parse_log(data)
    if not frame.empty:
        units = frame.attrs.get("units", {})
        index = frame.attrs.get("index_mnemonic")
        lines = [f"Log, wellbore {name or '?'}: {len(frame)} rows"]
        lines += [f"{mnemonic} [{units.get(mnemonic, '')}]" for mnemonic in frame.columns]
        if index is not None:
            lines.append(f"{index} from {frame[index].min()} to {frame[index].max()}")
        return "\n".join(lines)
    raise ValueError("WITSML file holds no drillReport, trajectory or log")


def _render_drill_report(report: Any) -> str:
    lines = [
        f"Daily drilling report: well {report.well_name or '?'}, wellbore {report.wellbore_name or '?'}, "
        f"date {report.report_date or '?'}",
        f"Depth at report time: {_fmt_m(report.md_m)} MD, {_fmt_m(report.tvd_m)} TVD",
    ]
    if report.summary_24h:
        lines.append(f"24 h summary: {report.summary_24h}")
    if report.forecast_24h:
        lines.append(f"24 h forecast: {report.forecast_24h}")
    if report.activities:
        lines.append("Time log (start–end | MD | code | state | comment):")
        for a in report.activities:
            lines.append(
                f"{_fmt_time(a.t_start)}–{_fmt_time(a.t_end)} | {_fmt_m(a.md_m)} | "
                f"{a.proprietary_code or ''} | {a.state or ''} | {a.comments or ''}"
            )
    for fluid in report.fluids:
        lines.append(
            f"Mud: {fluid.mud_type or '?'} at {_fmt_m(fluid.md_m)}, MW {fluid.mw_sg} SG, PV {fluid.pv_cp} cP, "
            f"YP {fluid.yp_lbf100ft2} lbf/100ft2, ECD {fluid.ecd_sg} SG"
        )
    for title, rows in (("Equipment failure", report.equip_failures), ("Well control incident", report.control_incidents)):
        for row in rows:
            lines.append(f"{title}: " + ", ".join(f"{k}={v}" for k, v in row.items()))
    return "\n".join(lines)


def _render_las(data: bytes, las_parser: Any) -> str:
    well, curves = las_parser.parse_las(data)
    units = curves.attrs.get("units", {})
    lines = ["LAS log"]
    lines += [f"{key}: {value}" for key, value in well.items() if key != "_units" and value not in ("", None)]
    lines.append("Curves: " + ", ".join(f"{name} [{units.get(name, '')}]" for name in curves.columns))
    if len(curves):
        lines.append(f"Depth {curves.index.min():.1f} to {curves.index.max():.1f} m, {len(curves)} samples")
    return "\n".join(lines)


def _render_table(data: bytes, ext: str, tabular: Any) -> str:
    import pandas as pd

    if ext in {".xlsx", ".xls"}:
        frame = pd.read_excel(io.BytesIO(data))
    else:
        frame = pd.read_csv(io.BytesIO(data), sep=None, engine="python")
    try:
        stations = tabular.parse_survey_table(frame)
    except ValueError:
        return frame.to_string(index=False)
    lines = ["Deviation survey"]
    lines += [f"MD {s.md_m:.1f} m | INC {s.inc_deg:.2f} deg | AZI {s.azi_deg:.2f} deg" for s in stations]
    return "\n".join(lines)


# ======================================================================
# Persistence
# ======================================================================


async def _store(doc_id: str, results: list[tuple[PageResult, bytes | None]]) -> None:
    """Upload page images, replace the document_pages rows, update the documents row."""
    rows = []
    for page, png in results:
        image_path = None
        if png is not None:
            image_path = f"{doc_id}/{page['page_no']}.png"
            await asyncio.to_thread(storage.upload, "page-images", image_path, png, "image/png")
        rows.append({
            "doc_id": doc_id,
            "page_no": page["page_no"],
            "image_path": image_path,
            "text": page["text"],
            "ocr_confidence": page["ocr_confidence"],
            "engine": page["engine"],
        })

    await db.execute("delete from document_pages where doc_id = %(doc_id)s", {"doc_id": doc_id})
    if rows:
        await db.execute_many(
            """
            insert into document_pages (doc_id, page_no, image_path, text, ocr_confidence, engine)
            values (%(doc_id)s, %(page_no)s, %(image_path)s, %(text)s, %(ocr_confidence)s, %(engine)s)
            """,
            rows,
        )

    engines = [page["engine"] for page, _ in results]
    ocr_engines = [e for e in engines if e != ENGINE_TEXT_LAYER]
    await db.execute(
        "update documents set pages = %(pages)s, has_text_layer = %(has_text_layer)s, "
        "ocr_engine = %(ocr_engine)s where id = %(doc_id)s",
        {
            "doc_id": doc_id,
            "pages": len(results),
            "has_text_layer": all(e == ENGINE_TEXT_LAYER for e in engines),
            "ocr_engine": max(set(ocr_engines), key=ocr_engines.count) if ocr_engines else None,
        },
    )


# ======================================================================
# PDFs and images
# ======================================================================


async def _read_visual(data: bytes, ext: str) -> list[tuple[PageResult, bytes | None]]:
    rendered, total = await asyncio.to_thread(_render_pages, data, ext)
    if total > MAX_PAGES:
        logger.warning("document has %d pages; only the first %d are read", total, MAX_PAGES)

    preferred = get_settings().OCR_ENGINE.strip().lower()
    results: list[tuple[PageResult, bytes | None]] = []
    for page in rendered:
        if len(page.layer_text.strip()) >= TEXT_LAYER_MIN_CHARS:
            results.append((_text_layer_page(page), page.png))
            continue
        try:
            output = await asyncio.wait_for(asyncio.to_thread(_ocr_page, page.png, preferred), PAGE_TIMEOUT_S)
            results.append((_ocr_page_result(page.page_no, output), page.png))
        except Exception as exc:  # noqa: BLE001 - one bad page must not fail the document
            reason = "timed out" if isinstance(exc, asyncio.TimeoutError) else repr(exc)
            logger.warning("ocr_page_failed page=%d reason=%s", page.page_no, reason)
            engine = ENGINE_TESSERACT if preferred == ENGINE_TESSERACT else ENGINE_RAPIDOCR
            results.append((PageResult(
                page_no=page.page_no, text="", markdown="", tables=[], ocr_confidence=0.0,
                engine=engine, boxes=[],
            ), page.png))
    return results


def _text_layer_page(page: RenderedPage) -> PageResult:
    return PageResult(
        page_no=page.page_no, text=page.layer_text, markdown=page.layer_text, tables=page.layer_tables,
        ocr_confidence=None, engine=ENGINE_TEXT_LAYER, boxes=page.layer_boxes,
    )


def _ocr_page_result(page_no: int, output: OcrOutput) -> PageResult:
    return PageResult(
        page_no=page_no, text=output.text, markdown=output.markdown, tables=output.tables,
        ocr_confidence=output.confidence, engine=output.engine, boxes=output.boxes,
    )


def _norm_bbox(x0: float, y0: float, x1: float, y1: float, width: float, height: float) -> dict[str, float]:
    """Pixel/point rectangle -> fractions of the page, clamped to 0..1."""

    def clamp(value: float) -> float:
        return min(1.0, max(0.0, value))

    left, top = clamp(x0 / width), clamp(y0 / height)
    return {
        "x": round(left, 5), "y": round(top, 5),
        "w": round(clamp(x1 / width) - left, 5), "h": round(clamp(y1 / height) - top, 5),
    }


def _render_pages(data: bytes, ext: str) -> tuple[list[RenderedPage], int]:
    """PNG (200 DPI for PDFs) of each page, plus the text layer where there is one."""
    if ext in PDF_EXTENSIONS:
        return _render_pdf(data)
    return _render_image(data)


def _render_pdf(data: bytes) -> tuple[list[RenderedPage], int]:
    import pymupdf  # PyMuPDF; `fitz` is its deprecated alias

    pages: list[RenderedPage] = []
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        total = len(pdf)
        for index in range(min(total, MAX_PAGES)):
            page = pdf[index]
            rendered = RenderedPage(
                page_no=index + 1,
                png=page.get_pixmap(dpi=RENDER_DPI).tobytes("png"),
                layer_text=page.get_text(),
            )
            if len(rendered.layer_text.strip()) >= TEXT_LAYER_MIN_CHARS:
                rendered.layer_boxes = _layer_boxes(page)
                rendered.layer_tables = _layer_tables(page)
            pages.append(rendered)
    return pages, total


def _layer_boxes(page: Any) -> list[dict[str, Any]]:
    """Text lines of a text-layer page with fractional bboxes (conf is None: not OCR)."""
    rect = page.rect
    lines: dict[tuple[int, int], dict[str, Any]] = {}
    for x0, y0, x1, y1, word, block, line, _word_no in page.get_text("words"):
        entry = lines.setdefault((block, line), {"words": [], "box": [x0, y0, x1, y1]})
        entry["words"].append(word)
        box = entry["box"]
        entry["box"] = [min(box[0], x0), min(box[1], y0), max(box[2], x1), max(box[3], y1)]
    return [
        {
            "text": " ".join(entry["words"]),
            "conf": None,
            "bbox": _norm_bbox(
                entry["box"][0] - rect.x0, entry["box"][1] - rect.y0,
                entry["box"][2] - rect.x0, entry["box"][3] - rect.y0, rect.width, rect.height,
            ),
        }
        for entry in lines.values()
    ]


def _layer_tables(page: Any) -> list[list[list[str]]]:
    try:
        found = page.find_tables()
        return [
            [["" if cell is None else str(cell).strip() for cell in row] for row in table.extract()]
            for table in found.tables
        ]
    except Exception:  # noqa: BLE001 - table detection is best effort
        logger.info("find_tables_failed page=%s", getattr(page, "number", "?"))
        return []


def _render_image(data: bytes) -> tuple[list[RenderedPage], int]:
    from PIL import Image, ImageSequence

    pages: list[RenderedPage] = []
    with Image.open(io.BytesIO(data)) as image:
        total = getattr(image, "n_frames", 1)
        for index, frame in enumerate(ImageSequence.Iterator(image)):
            if index >= MAX_PAGES:
                break
            buffer = io.BytesIO()
            frame.convert("RGB").save(buffer, "PNG")
            pages.append(RenderedPage(page_no=index + 1, png=buffer.getvalue()))
    return pages, total


# ----------------------------------------------------------------------
# OCR of one page
# ----------------------------------------------------------------------


def _ocr_page(png: bytes, preferred_engine: str) -> OcrOutput:
    """Docling + RapidOCR first; Tesseract when the confidence is too low (or preferred)."""
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("page image could not be decoded")

    if preferred_engine == ENGINE_TESSERACT:
        return _tesseract_page(image)

    primary = _rapidocr_page(png, image)
    if primary.confidence >= OCR_RETRY_BELOW:
        return primary
    try:
        fallback = _tesseract_page(image)
    except TesseractUnavailable as exc:
        logger.warning("low_confidence_no_tesseract confidence=%.2f reason=%s", primary.confidence, exc)
        return primary
    kept = fallback if fallback.confidence > primary.confidence else primary
    logger.info(
        "ocr_retry rapidocr=%.2f tesseract=%.2f kept=%s", primary.confidence, fallback.confidence, kept.engine
    )
    return kept


_rapidocr_lock = threading.Lock()
_docling_lock = threading.Lock()


@lru_cache(maxsize=1)
def _rapidocr_engine() -> Any:
    from rapidocr import RapidOCR

    return RapidOCR()


def _rapidocr_boxes(image: Any) -> list[dict[str, Any]]:
    """Text-line boxes with confidences from RapidOCR, bbox as page fractions."""
    height, width = image.shape[:2]
    with _rapidocr_lock:
        # use_cls=False: the bundled 180-degree angle classifier wrongly flips upright English
        # lines (measured: two of five lines read as garbage at ~0.6 confidence, all five
        # perfect at >=0.98 without it). Rendered pages are already upright.
        result = _rapidocr_engine()(image, use_cls=False)
    if result is None or result.boxes is None:
        return []
    boxes = []
    for quad, text, score in zip(result.boxes, result.txts, result.scores):
        xs, ys = quad[:, 0], quad[:, 1]
        boxes.append({
            "text": text,
            "conf": float(score),
            "bbox": _norm_bbox(float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()), width, height),
        })
    return boxes


def _boxes_to_text(boxes: list[dict[str, Any]]) -> str:
    """Reading-order text: boxes on the same visual line are joined left to right."""
    lines: list[dict[str, Any]] = []
    for box in sorted(boxes, key=lambda b: b["bbox"]["y"] + b["bbox"]["h"] / 2):
        centre = box["bbox"]["y"] + box["bbox"]["h"] / 2
        height = box["bbox"]["h"]
        if lines and abs(centre - lines[-1]["centre"]) < 0.5 * max(height, lines[-1]["height"]):
            lines[-1]["items"].append(box)
        else:
            lines.append({"centre": centre, "height": height, "items": [box]})
    return "\n".join(
        " ".join(item["text"] for item in sorted(line["items"], key=lambda b: b["bbox"]["x"])) for line in lines
    )


def _mean_confidence(boxes: list[dict[str, Any]]) -> float:
    scores = [b["conf"] for b in boxes if b["conf"] is not None]
    return sum(scores) / len(scores) if scores else 0.0


@lru_cache(maxsize=1)
def _docling_converter() -> Any:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        RapidOcrOptions,  # class name verified in docling 2.132
        TableFormerMode,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, ImageFormatOption

    options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        ocr_options=RapidOcrOptions(),
        table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE),
    )
    # pages reach Docling as PNG images, so the IMAGE format option carries the pipeline options
    return DocumentConverter(format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)})


def _docling_page(png: bytes) -> tuple[str, list[list[list[str]]]]:
    """(markdown, tables) from Docling's layout + TableFormer on one page image.

    Docling exposes only a page-level OCR score (no per-line boxes), so boxes
    and the page confidence come from RapidOCR run directly (see _rapidocr_page).
    """
    from docling.datamodel.base_models import DocumentStream

    with _docling_lock:
        result = _docling_converter().convert(DocumentStream(name="page.png", stream=io.BytesIO(png)))
    document = result.document
    tables = []
    for table in document.tables:
        frame = table.export_to_dataframe(document)
        tables.append([[str(c) for c in frame.columns]] + [[str(c) for c in row] for row in frame.values.tolist()])
    return document.export_to_markdown(), tables


def _rapidocr_page(png: bytes, image: Any) -> OcrOutput:
    """`text` = line-preserving RapidOCR text (what search and snippet checks use);
    `markdown` and `tables` come from Docling when it succeeds."""
    boxes = _rapidocr_boxes(image)
    text = _boxes_to_text(boxes)
    markdown, tables, method = text, [], "rapidocr_only"
    try:
        docling_markdown, tables = _docling_page(png)
        if docling_markdown.strip():
            markdown, method = docling_markdown, "docling+rapidocr_boxes"
    except Exception:  # noqa: BLE001 - Docling is optional layout help; the OCR text stands without it
        logger.warning("docling_failed; using RapidOCR text and no tables", exc_info=True)
    confidence = _mean_confidence(boxes)
    logger.info("ocr_page method=%s lines=%d confidence=%.3f", method, len(boxes), confidence)
    return OcrOutput(
        text=text, markdown=markdown, tables=tables, confidence=confidence, engine=ENGINE_RAPIDOCR, boxes=boxes
    )


# ----------------------------------------------------------------------
# Tesseract fallback
# ----------------------------------------------------------------------


def _tesseract_page(image: Any) -> OcrOutput:
    try:
        import pytesseract
    except ImportError as exc:
        raise TesseractUnavailable("pytesseract is not installed") from exc
    from app.ingest.preprocess import preprocess_for_tesseract

    prepared = preprocess_for_tesseract(image)
    try:
        data = pytesseract.image_to_data(
            prepared, lang="eng", config="--psm 6", output_type=pytesseract.Output.DICT
        )
    except pytesseract.TesseractNotFoundError as exc:
        raise TesseractUnavailable("tesseract binary not found") from exc
    height, width = prepared.shape[:2]  # boxes are fractions, so the upscaling does not matter
    return _tesseract_output(data, width, height)


def _tesseract_output(data: dict[str, list], width: float, height: float) -> OcrOutput:
    """Lines, boxes and the mean word confidence (0..1) from pytesseract's image_to_data dict."""
    lines: dict[tuple[int, int, int], dict[str, Any]] = {}
    word_scores: list[float] = []
    for i, raw in enumerate(data["text"]):
        text = (raw or "").strip()
        confidence = float(data["conf"][i])
        if not text or confidence < 0:  # conf -1 marks layout rows, not words
            continue
        word_scores.append(confidence / 100.0)
        x0, y0 = data["left"][i], data["top"][i]
        box = [x0, y0, x0 + data["width"][i], y0 + data["height"][i]]
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        line = lines.setdefault(key, {"words": [], "scores": [], "box": box})
        line["words"].append(text)
        line["scores"].append(confidence / 100.0)
        line["box"] = [min(line["box"][0], box[0]), min(line["box"][1], box[1]),
                       max(line["box"][2], box[2]), max(line["box"][3], box[3])]

    boxes = [
        {
            "text": " ".join(line["words"]),
            "conf": sum(line["scores"]) / len(line["scores"]),
            "bbox": _norm_bbox(*line["box"], width, height),
        }
        for line in lines.values()
    ]
    text = "\n".join(box["text"] for box in boxes)
    confidence = sum(word_scores) / len(word_scores) if word_scores else 0.0
    return OcrOutput(text=text, markdown=text, tables=[], confidence=confidence, engine=ENGINE_TESSERACT, boxes=boxes)

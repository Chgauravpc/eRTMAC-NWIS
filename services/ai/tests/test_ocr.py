"""BE-07: OCR / parse stage.

Light by default: PyMuPDF, OpenCV and RapidOCR run for real; Docling (large torch
models, heavy on CPU/RAM) is mocked. The real Docling check only runs with
NWIS_RUN_DOCLING=1.
"""

import asyncio
import io
import os
import shutil
from pathlib import Path

import cv2
import numpy as np
import pymupdf
import pytest
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

from app import db, storage
from app.ingest import ocr, preprocess
from app.ingest.ocr import OcrOutput

FIXTURES = Path(__file__).parent / "fixtures"

REPORT_LINES = [
    "WELL COMPLETION REPORT - SYN-DLJ-03",
    "Formation tops: Tipam 2310.5 m, Barail 2850.0 m, Kopili 3500.0 m",
    "Drilling complications: partial losses at 2395 m, 15 m3/hr, pumped LCM pill.",
    "Losses cured after 2 h. Mud weight 1.18 SG. Casing 9 5/8 in set at 2285 m.",
    "Cement job: returns to surface not achieved, poor bond 1500-1650 m per CBL.",
]


# ---------------------------------------------------------------- helpers


def digital_pdf(pages: int = 1, with_table: bool = False) -> bytes:
    """A PDF with a real text layer (and optionally a ruled table)."""
    buf = io.BytesIO()
    if with_table:
        table = Table([["Formation", "Top MD (m)"], ["Tipam", "2310.5"], ["Barail", "2850.0"]])
        table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.8, colors.black)]))
        doc = SimpleDocTemplate(buf, pagesize=A4)
        from reportlab.platypus import Paragraph
        from reportlab.lib.styles import getSampleStyleSheet

        styles = getSampleStyleSheet()
        doc.build([Paragraph(line, styles["Normal"]) for line in REPORT_LINES] + [table])
        return buf.getvalue()
    c = canvas.Canvas(buf, pagesize=A4)
    for page in range(pages):
        c.setFont("Helvetica", 11)
        y = 790
        for line in REPORT_LINES:
            c.drawString(50, y, f"{line} (page {page + 1})")
            y -= 20
        c.showPage()
    c.save()
    return buf.getvalue()


def scanned_pdf(pages: int = 1) -> bytes:
    """Image-only PDF: the digital pages rasterised at 200 DPI, no text layer."""
    source = pymupdf.open(stream=digital_pdf(pages), filetype="pdf")
    out = pymupdf.open()
    for page in source:
        png = page.get_pixmap(dpi=200).tobytes("png")
        new = out.new_page(width=page.rect.width, height=page.rect.height)
        new.insert_image(new.rect, stream=png)
    data = out.tobytes()
    assert out[0].get_text().strip() == ""
    return data


def page_png(pdf: bytes, page: int = 0) -> bytes:
    return pymupdf.open(stream=pdf, filetype="pdf")[page].get_pixmap(dpi=200).tobytes("png")


def png_bytes(image: np.ndarray) -> bytes:
    return cv2.imencode(".png", image)[1].tobytes()


@pytest.fixture
def no_docling(monkeypatch):
    """Docling is mocked everywhere except the opt-in real test."""
    monkeypatch.setattr(ocr, "_docling_page", lambda png: ("## mocked docling markdown", [[["a", "b"]]]))


# ---------------------------------------------------------------- preprocess


def text_image(width: int = 1200, height: int = 800) -> np.ndarray:
    image = np.full((height, width, 3), 255, np.uint8)
    for i in range(10):
        cv2.putText(image, f"DRILLING REPORT LINE {i} 2395 M", (40, 60 + i * 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0), 2, cv2.LINE_AA)
    return image


@pytest.mark.parametrize("skew", [2.0, -2.0, 1.0])
def test_deskew_levels_a_rotated_page(skew):
    gray = preprocess.to_grayscale(text_image())
    skewed = preprocess.rotate(gray, skew)

    angle = preprocess.estimate_skew_deg(skewed)
    assert abs(abs(angle) - abs(skew)) < 0.5

    fixed = preprocess.rotate(skewed, angle)
    assert abs(preprocess.estimate_skew_deg(fixed)) < 0.5  # wrong sign would leave ~2*skew


def test_estimate_skew_is_zero_for_level_and_empty_pages():
    assert preprocess.estimate_skew_deg(preprocess.to_grayscale(text_image())) == 0.0
    assert preprocess.estimate_skew_deg(np.full((200, 200), 255, np.uint8)) == 0.0


def test_preprocess_output_is_binary_and_at_least_2000_wide():
    result = preprocess.preprocess_for_tesseract(text_image(width=900, height=700))

    assert result.ndim == 2
    assert result.shape[1] >= preprocess.MIN_WIDTH_PX
    assert set(np.unique(result)) <= {0, 255}


def test_preprocess_does_not_upscale_wide_images():
    assert preprocess.preprocess_for_tesseract(text_image(width=2400, height=600)).shape[1] == 2400


def test_to_grayscale_accepts_bgr_bgra_and_gray():
    assert preprocess.to_grayscale(np.zeros((4, 4, 3), np.uint8)).shape == (4, 4)
    assert preprocess.to_grayscale(np.zeros((4, 4, 4), np.uint8)).shape == (4, 4)
    assert preprocess.to_grayscale(np.zeros((4, 4), np.uint8)).shape == (4, 4)


# ---------------------------------------------------------------- pure helpers


def test_norm_bbox_is_fractional_and_clamped():
    assert ocr._norm_bbox(100, 50, 300, 100, 1000, 500) == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.1}
    clamped = ocr._norm_bbox(-10, -10, 2000, 700, 1000, 500)
    assert clamped == {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def test_boxes_to_text_joins_same_line_left_to_right_and_orders_lines():
    def box(text, x, y):
        return {"text": text, "conf": 0.9, "bbox": {"x": x, "y": y, "w": 0.1, "h": 0.02}}

    boxes = [box("2310.5", 0.5, 0.101), box("second", 0.1, 0.3), box("Tipam", 0.1, 0.1), box("2261.0", 0.8, 0.1)]
    assert ocr._boxes_to_text(boxes) == "Tipam 2310.5 2261.0\nsecond"
    assert ocr._boxes_to_text([]) == ""


def test_mean_confidence_ignores_missing_scores():
    assert ocr._mean_confidence([{"conf": 0.5}, {"conf": 1.0}, {"conf": None}]) == 0.75
    assert ocr._mean_confidence([]) == 0.0


def test_tesseract_output_groups_words_into_lines_and_skips_layout_rows():
    data = {
        "level": [1, 5, 5, 5, 5],
        "block_num": [1, 1, 1, 1, 1], "par_num": [0, 1, 1, 1, 1], "line_num": [0, 1, 1, 2, 2],
        "text": ["", "Partial", "losses", "Tipam", "  "],
        "conf": ["-1", "90", "80", "70", "95"],
        "left": [0, 100, 300, 100, 300], "top": [0, 50, 50, 150, 150],
        "width": [0, 150, 100, 120, 10], "height": [0, 40, 40, 40, 40],
    }
    out = ocr._tesseract_output(data, 1000, 500)

    assert out.engine == "tesseract" and out.text == "Partial losses\nTipam"
    assert out.confidence == pytest.approx((0.9 + 0.8 + 0.7) / 3)
    assert [b["text"] for b in out.boxes] == ["Partial losses", "Tipam"]
    assert out.boxes[0]["bbox"] == {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.08}
    assert out.boxes[0]["conf"] == pytest.approx(0.85)


def test_tesseract_output_with_no_words():
    out = ocr._tesseract_output({k: [] for k in ("text", "conf", "left", "top", "width", "height", "block_num", "par_num", "line_num")}, 10, 10)
    assert out.text == "" and out.confidence == 0.0 and out.boxes == []


# ---------------------------------------------------------------- fallback routing


def rapid(conf: float) -> OcrOutput:
    return OcrOutput("rapid text", "md", [], conf, "rapidocr", [])


def tess(conf: float) -> OcrOutput:
    return OcrOutput("tess text", "tess text", [], conf, "tesseract", [])


@pytest.fixture
def blank_png() -> bytes:
    return png_bytes(np.full((60, 60, 3), 255, np.uint8))


def test_confident_page_does_not_call_tesseract(monkeypatch, blank_png):
    monkeypatch.setattr(ocr, "_rapidocr_page", lambda png, image: rapid(0.9))
    monkeypatch.setattr(ocr, "_tesseract_page", lambda image: pytest.fail("tesseract must not run"))
    assert ocr._ocr_page(blank_png, "rapidocr").engine == "rapidocr"


def test_low_confidence_retries_with_tesseract_and_keeps_the_better_result(monkeypatch, blank_png):
    monkeypatch.setattr(ocr, "_rapidocr_page", lambda png, image: rapid(0.40))
    monkeypatch.setattr(ocr, "_tesseract_page", lambda image: tess(0.80))
    assert ocr._ocr_page(blank_png, "rapidocr").engine == "tesseract"

    monkeypatch.setattr(ocr, "_tesseract_page", lambda image: tess(0.30))
    assert ocr._ocr_page(blank_png, "rapidocr").engine == "rapidocr"


def test_threshold_is_exclusive_at_exactly_0_60(monkeypatch, blank_png):
    monkeypatch.setattr(ocr, "_rapidocr_page", lambda png, image: rapid(ocr.OCR_RETRY_BELOW))
    monkeypatch.setattr(ocr, "_tesseract_page", lambda image: pytest.fail("0.60 is not below 0.60"))
    assert ocr._ocr_page(blank_png, "rapidocr").engine == "rapidocr"


def test_missing_tesseract_keeps_the_low_confidence_result(monkeypatch, blank_png):
    def unavailable(image):
        raise ocr.TesseractUnavailable("no binary")

    monkeypatch.setattr(ocr, "_rapidocr_page", lambda png, image: rapid(0.2))
    monkeypatch.setattr(ocr, "_tesseract_page", unavailable)
    assert ocr._ocr_page(blank_png, "rapidocr").engine == "rapidocr"


def test_ocr_engine_setting_tesseract_skips_rapidocr(monkeypatch, blank_png):
    monkeypatch.setattr(ocr, "_rapidocr_page", lambda png, image: pytest.fail("rapidocr must not run"))
    monkeypatch.setattr(ocr, "_tesseract_page", lambda image: tess(0.9))
    assert ocr._ocr_page(blank_png, "tesseract").engine == "tesseract"


def test_docling_failure_falls_back_to_rapidocr_text(monkeypatch):
    image = text_image(width=1000, height=300)
    monkeypatch.setattr(ocr, "_rapidocr_boxes", lambda img: [
        {"text": "Tipam 2310.5", "conf": 0.95, "bbox": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.05}}])

    def boom(png):
        raise RuntimeError("docling models missing")

    monkeypatch.setattr(ocr, "_docling_page", boom)
    out = ocr._rapidocr_page(png_bytes(image), image)

    assert out.text == out.markdown == "Tipam 2310.5" and out.tables == []
    assert out.confidence == 0.95 and out.engine == "rapidocr"


# ---------------------------------------------------------------- real PyMuPDF / RapidOCR


@pytest.mark.asyncio
async def test_digital_pdf_uses_the_text_layer(no_docling):
    results = await ocr._read_visual(digital_pdf(pages=2), ".pdf")

    assert [page["page_no"] for page, _ in results] == [1, 2]
    page, png = results[0]
    assert page["engine"] == "text_layer" and page["ocr_confidence"] is None
    assert "WELL COMPLETION REPORT" in page["text"] and "(page 1)" in page["text"]
    assert png.startswith(b"\x89PNG")
    assert page["boxes"] and all(b["conf"] is None for b in page["boxes"])
    box = page["boxes"][0]["bbox"]
    assert all(0 <= box[k] <= 1 for k in "xywh") and box["w"] > 0 and box["h"] > 0


@pytest.mark.asyncio
async def test_digital_pdf_tables_are_extracted_from_the_text_layer(no_docling):
    (page, _), = await ocr._read_visual(digital_pdf(with_table=True), ".pdf")

    assert page["engine"] == "text_layer"
    assert page["tables"] and ["Tipam", "2310.5"] in page["tables"][0]


@pytest.mark.asyncio
async def test_page_cap_reads_only_the_first_pages(monkeypatch, no_docling):
    monkeypatch.setattr(ocr, "MAX_PAGES", 2)
    results = await ocr._read_visual(digital_pdf(pages=4), ".pdf")
    assert [page["page_no"] for page, _ in results] == [1, 2]


@pytest.mark.slow
@pytest.mark.asyncio
async def test_scanned_pdf_is_read_by_rapidocr(no_docling):
    (page, png), = await ocr._read_visual(scanned_pdf(), ".pdf")

    assert page["engine"] == "rapidocr"
    assert page["ocr_confidence"] is not None and page["ocr_confidence"] > ocr.OCR_RETRY_BELOW
    assert "WELL COMPLETION REPORT" in page["text"]
    assert "2395" in page["text"]
    assert page["markdown"] == "## mocked docling markdown" and page["tables"] == [[["a", "b"]]]
    assert page["boxes"] and all(0 <= b["conf"] <= 1 for b in page["boxes"])
    assert png.startswith(b"\x89PNG")


@pytest.mark.slow
@pytest.mark.asyncio
async def test_image_file_is_read_like_a_scanned_page(no_docling):
    (page, _), = await ocr._read_visual(page_png(digital_pdf()), ".png")
    assert page["engine"] == "rapidocr" and "WELL COMPLETION REPORT" in page["text"]


@pytest.mark.slow
@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract binary not installed")
def test_blurred_page_takes_the_tesseract_path(no_docling):
    image = cv2.imdecode(np.frombuffer(page_png(digital_pdf()), np.uint8), cv2.IMREAD_COLOR)
    blurred = cv2.GaussianBlur(image, (0, 0), 6)

    out = ocr._ocr_page(png_bytes(blurred), "rapidocr")

    assert out.engine in ("rapidocr", "tesseract")
    assert 0.0 <= out.confidence <= 1.0


@pytest.mark.slow
@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract binary not installed")
def test_tesseract_reads_a_clean_page():
    image = cv2.imdecode(np.frombuffer(page_png(digital_pdf()), np.uint8), cv2.IMREAD_COLOR)
    out = ocr._tesseract_page(image)
    assert out.engine == "tesseract" and "COMPLETION" in out.text.upper() and out.confidence > 0.6


@pytest.mark.skipif(not os.environ.get("NWIS_RUN_DOCLING"), reason="heavy: set NWIS_RUN_DOCLING=1 to run real Docling")
def test_real_docling_page_returns_markdown():
    markdown, tables = ocr._docling_page(page_png(digital_pdf(with_table=True)))
    assert "WELL COMPLETION REPORT" in markdown.upper()


@pytest.mark.asyncio
async def test_page_timeout_yields_an_empty_page_instead_of_failing(monkeypatch):
    monkeypatch.setattr(ocr, "PAGE_TIMEOUT_S", 0.05)

    def slow(png, engine):
        import time

        time.sleep(0.4)
        return rapid(0.9)

    monkeypatch.setattr(ocr, "_ocr_page", slow)
    (page, _), = await ocr._read_visual(scanned_pdf(), ".pdf")

    assert page["text"] == "" and page["ocr_confidence"] == 0.0 and page["boxes"] == []


@pytest.mark.asyncio
async def test_page_error_yields_an_empty_page(monkeypatch):
    def broken(png, engine):
        raise ValueError("page image could not be decoded")

    monkeypatch.setattr(ocr, "_ocr_page", broken)
    (page, _), = await ocr._read_visual(scanned_pdf(), ".pdf")
    assert page["text"] == "" and page["ocr_confidence"] == 0.0


# ---------------------------------------------------------------- ocr_or_parse (storage + db mocked)


class Recorder:
    def __init__(self):
        self.executed: list[tuple[str, object]] = []
        self.uploads: list[tuple[str, str, int, str]] = []

    async def execute(self, sql, params=None):
        self.executed.append((sql, params))

    async def execute_many(self, sql, params_seq):
        self.executed.append((sql, params_seq))

    def params(self, fragment):
        return [p for sql, p in self.executed if fragment in sql]


@pytest.fixture
def env(monkeypatch):
    rec = Recorder()
    files: dict[str, bytes] = {}
    monkeypatch.setattr(db, "execute", rec.execute)
    monkeypatch.setattr(db, "execute_many", rec.execute_many)
    monkeypatch.setattr(storage, "download", lambda bucket, path: files[path])
    monkeypatch.setattr(storage, "upload", lambda bucket, path, data, ctype: rec.uploads.append((bucket, path, len(data), ctype)))
    rec.files = files
    return rec


def make_doc(file_path: str, doc_type: str = "other") -> dict:
    return {"id": "doc-1", "file_path": file_path, "doc_type": doc_type, "title": Path(file_path).name}


@pytest.mark.asyncio
async def test_ocr_or_parse_digital_pdf_writes_pages_images_and_document_row(env, no_docling):
    env.files["doc-1/r.pdf"] = digital_pdf(pages=2)

    pages = await ocr.ocr_or_parse(make_doc("doc-1/r.pdf"))

    assert [p["page_no"] for p in pages] == [1, 2]
    assert [(b, p) for b, p, _, _ in env.uploads] == [("page-images", "doc-1/1.png"), ("page-images", "doc-1/2.png")]
    assert all(ctype == "image/png" for *_, ctype in env.uploads)
    assert env.params("delete from document_pages") == [{"doc_id": "doc-1"}]
    (rows,) = env.params("insert into document_pages")
    assert [(r["page_no"], r["image_path"], r["engine"], r["ocr_confidence"]) for r in rows] == [
        (1, "doc-1/1.png", "text_layer", None), (2, "doc-1/2.png", "text_layer", None)]
    (update,) = env.params("update documents set pages")
    assert update == {"doc_id": "doc-1", "pages": 2, "has_text_layer": True, "ocr_engine": None}


@pytest.mark.slow
@pytest.mark.asyncio
async def test_ocr_or_parse_scanned_pdf_records_engine_and_no_text_layer(env, no_docling):
    env.files["doc-1/s.pdf"] = scanned_pdf()

    await ocr.ocr_or_parse(make_doc("doc-1/s.pdf"))

    (rows,) = env.params("insert into document_pages")
    assert rows[0]["engine"] == "rapidocr" and rows[0]["ocr_confidence"] > 0.6
    (update,) = env.params("update documents set pages")
    assert update["has_text_layer"] is False and update["ocr_engine"] == "rapidocr"


@pytest.mark.asyncio
async def test_ocr_or_parse_witsml_becomes_one_readable_page_without_image(env):
    env.files["doc-1/dr.xml"] = (FIXTURES / "drill_report_141.xml").read_bytes()

    (page,) = await ocr.ocr_or_parse(make_doc("doc-1/dr.xml", "witsml"))

    assert page["page_no"] == 1 and page["engine"] == "text_layer" and page["ocr_confidence"] is None
    assert "Daily drilling report: well SYN-TEST-01" in page["text"]
    assert "06:00–09:30 | 2395 m | drilling -- drill | ok | Drilled to 2395 m" in page["text"]
    assert "Partial losses 15 bbl/hr, pumped LCM pill" in page["text"]
    assert "Mud: WBM at 2400 m, MW 1.18 SG" in page["text"]
    assert env.uploads == []
    (rows,) = env.params("insert into document_pages")
    assert rows[0]["image_path"] is None
    (update,) = env.params("update documents set pages")
    assert update["has_text_layer"] is True and update["ocr_engine"] is None


@pytest.mark.asyncio
async def test_ocr_or_parse_witsml_trajectory_and_log(env):
    env.files["a/t.xml"] = (FIXTURES / "trajectory_ft.xml").read_bytes()
    env.files["a/l.xml"] = (FIXTURES / "log_depth.xml").read_bytes()

    (traj,) = await ocr.ocr_or_parse(make_doc("a/t.xml", "witsml"))
    (log,) = await ocr.ocr_or_parse(make_doc("a/l.xml", "witsml"))

    assert "MD 304.8 m | INC 10.00 deg | AZI 90.00 deg" in traj["text"]
    assert "ROP [m/h]" in log["text"] and "3 rows" in log["text"]


@pytest.mark.asyncio
async def test_ocr_or_parse_las_and_survey_csv_and_plain_text(env):
    env.files["a/w.las"] = (FIXTURES / "sample.las").read_bytes()
    env.files["a/s.csv"] = (FIXTURES / "survey.csv").read_bytes()
    env.files["a/h.txt"] = b"Wellbore history: partial losses at 2395 m."

    (las,) = await ocr.ocr_or_parse(make_doc("a/w.las", "las"))
    (survey,) = await ocr.ocr_or_parse(make_doc("a/s.csv", "survey"))
    (text,) = await ocr.ocr_or_parse(make_doc("a/h.txt"))

    assert "WELL: SYN-TEST-01" in las["text"] and "ROP [M/H]" in las["text"] and "5 samples" in las["text"]
    assert survey["text"].startswith("Deviation survey") and "MD 304.8 m | INC 10.00 deg" in survey["text"]
    assert text["text"] == "Wellbore history: partial losses at 2395 m."


@pytest.mark.asyncio
async def test_ocr_or_parse_rejects_a_witsml_file_with_nothing_usable(env):
    env.files["a/x.xml"] = b"<other/>"
    with pytest.raises(ValueError, match="no drillReport"):
        await ocr.ocr_or_parse(make_doc("a/x.xml", "witsml"))
    assert env.executed == []  # nothing written for a failed read


@pytest.mark.asyncio
async def test_rerun_replaces_pages(env, no_docling):
    env.files["d/r.pdf"] = digital_pdf()
    await ocr.ocr_or_parse(make_doc("d/r.pdf"))
    await ocr.ocr_or_parse(make_doc("d/r.pdf"))

    assert len(env.params("delete from document_pages")) == 2  # each run starts by clearing old rows
    assert len(env.params("insert into document_pages")) == 2

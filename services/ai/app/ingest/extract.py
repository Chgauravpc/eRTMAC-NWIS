"""LLM extraction and storage of the results (BE-08).

Contract §6 (events, formation_tops, hole_sections, cement_jobs, mud_records,
time_log, extracted_fields), §10 (extraction JSON and backend rules).

Two pipeline stages live here:

* `extract(doc, pages)`   - pages -> windows -> LLM -> merged ExtractionResult
* `validate(doc, pages, extraction)` - normalise units / formations, apply the §10
  rules (app.ingest.validate), write the target rows and one `extracted_fields`
  row per important field (confidence, reason, bbox, review status).

Rows are only created for a known wellbore. A document with no matched well still
gets its `extracted_fields` rows (entity_id null) so a reviewer can see what was
read; they are cleared and rewritten when the document is processed again.
Not stored as rows: survey stations (tvd/north/east come from the DB-08
trajectory builder, not from a report) - they stay in the extraction only.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb

from app import db
from app.ingest import normalize
from app.ingest import validate as rules
from app.ingest.normalize import Reconciled, reconcile_quantity
from app.llm.client import complete_json
from app.logging import get_logger
from app.models.enums import DocType
from app.models.extraction import ExtractionResult

logger = get_logger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "llm" / "prompts"
WINDOW_CHARS = 12000
LLM_MAX_TOKENS = 4000
TABLE_MARKDOWN_MAX_CHARS = 3000
HEADER_CONFIDENCE = 0.80  # the well header has no per-item confidence: always a reviewer's call
DEDUP_WINDOW_M = 5.0
CEMENT_JOB_TYPES = {"primary", "squeeze", "plug"}
IADC_CODE_RANGE = (1, 34)
HEADER_FIELDS = ("field", "kb_elev_m", "spud_date", "td_md_m", "td_tvd_m")


@dataclass
class Extraction:
    """What `extract` found plus the page context `validate` needs (snippet checks, bboxes)."""

    result: ExtractionResult = field(default_factory=ExtractionResult)
    page_text: dict[int, str] = field(default_factory=dict)
    page_ocr: dict[int, float | None] = field(default_factory=dict)
    page_boxes: dict[int, list[dict[str, Any]]] = field(default_factory=dict)
    witsml: bool = False


# ======================================================================
# Stage 1: LLM extraction
# ======================================================================


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    return (PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")


def _table_markdown(table: list[list[str]]) -> str:
    if not table:
        return ""
    lines = ["| " + " | ".join(cell.replace("|", "/") for cell in row) + " |" for row in table]
    lines.insert(1, "| " + " | ".join("---" for _ in table[0]) + " |")
    return "\n".join(lines)[:TABLE_MARKDOWN_MAX_CHARS]


def page_text_for_llm(page: dict[str, Any]) -> str:
    """Line-preserving page text, with detected tables appended as Markdown."""
    text = page.get("text") or ""
    tables = [md for md in (_table_markdown(t) for t in page.get("tables") or []) if md]
    return text + ("\n\n[Tables]\n" + "\n\n".join(tables) if tables else "")


def build_windows(pages: list[tuple[int, str]], limit: int | None = None) -> list[str]:
    """Group pages into windows of at most `limit` characters without ever splitting a page.

    Each page is prefixed with `=== PAGE n ===`. A single page longer than `limit` gets its own window.
    """
    limit = limit or WINDOW_CHARS
    windows: list[str] = []
    current: list[str] = []
    size = 0
    for number, text in pages:
        if not text.strip():
            continue
        block = f"=== PAGE {number} ===\n{text.strip()}"
        if current and size + len(block) + 2 > limit:
            windows.append("\n\n".join(current))
            current, size = [], 0
        current.append(block)
        size += len(block) + 2
    if current:
        windows.append("\n\n".join(current))
    return windows


_TIME_LOG_LINE = re.compile(r"^(?:\d{2}:\d{2}|--:--)–(?:\d{2}:\d{2}|--:--) \|")
_REPORT_HEADER = re.compile(r"Daily drilling report: well (?P<well>.*?), wellbore .*?, date (?P<date>\S+)")


def witsml_log_windows(pages: list[tuple[int, str]], limit: int | None = None) -> tuple[list[str], str]:
    """Time-log lines of a rendered WITSML drill report, grouped under their report date.

    Returns (windows of `[page] start–end | MD | code | state | comment` lines, well name).
    """
    limit = limit or WINDOW_CHARS
    well_name = "unknown"
    lines: list[str] = []
    for number, text in pages:
        for line in text.splitlines():
            header = _REPORT_HEADER.match(line)
            if header:
                well_name = header["well"] if header["well"] != "?" else well_name
                lines.append(f"=== REPORT DATE {header['date']} ===")
            elif _TIME_LOG_LINE.match(line):
                lines.append(f"[{number}] {line}")
    windows: list[str] = []
    current: list[str] = []
    size = 0
    for line in lines:
        if current and size + len(line) + 1 > limit and not line.startswith("==="):
            windows.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if any(not line.startswith("===") for line in current):
        windows.append("\n".join(current))
    return windows, well_name


def merge_results(results: list[ExtractionResult]) -> ExtractionResult:
    merged = ExtractionResult()
    for result in results:
        merged.doc_type = merged.doc_type or result.doc_type
        merged.well_name = merged.well_name or result.well_name
        merged.report_date = merged.report_date or result.report_date
        if result.well_header:
            if merged.well_header is None:
                merged.well_header = result.well_header
            else:  # fill gaps from later windows
                for name in HEADER_FIELDS + ("surface_lat", "surface_lon", "datum"):
                    if getattr(merged.well_header, name) is None:
                        setattr(merged.well_header, name, getattr(result.well_header, name))
        for name in ("events", "formation_tops", "hole_sections", "cement_jobs", "mud_records", "time_log", "survey_stations"):
            getattr(merged, name).extend(getattr(result, name))
    return merged


def _guidance_for(doc_type: str) -> str:
    return load_prompt({"ddr": "extract_ddr", "wcr": "extract_wcr"}.get(doc_type, "extract_generic"))


async def extract(doc: dict[str, Any], pages: list[dict[str, Any]]) -> Extraction:
    """Read the pages with the LLM. Raises NwisError(NWIS_UPSTREAM) if both providers fail."""
    extraction = Extraction(
        page_text={p["page_no"]: page_text_for_llm(p) for p in pages},
        page_ocr={p["page_no"]: p.get("ocr_confidence") for p in pages},
        page_boxes={p["page_no"]: p.get("boxes") or [] for p in pages},
        witsml=doc.get("doc_type") == DocType.WITSML.value,
    )
    ordered = sorted(extraction.page_text.items())
    system = load_prompt("extract_system")

    if extraction.witsml:
        # time_log and mud_records came from the structured parser; only events need the LLM
        windows, well_name = witsml_log_windows(ordered)
        template = load_prompt("ddr_comments_events")
        prompts = [template.format(well_name=well_name, lines=window) for window in windows]
    else:
        guidance = _guidance_for(str(doc.get("doc_type")))
        prompts = [f"{guidance}\n\n{window}" for window in build_windows(ordered)]

    results = []
    for number, user in enumerate(prompts, start=1):
        result, meta = await complete_json(system, user, ExtractionResult, max_tokens=LLM_MAX_TOKENS)
        logger.info(
            "extract_window doc_id=%s window=%d/%d provider=%s cached=%s",
            doc["id"], number, len(prompts), meta.provider, meta.cached,
        )
        results.append(result)

    extraction.result = merge_results(results)
    if extraction.witsml:
        extraction.result = ExtractionResult(events=extraction.result.events)
    return extraction


# ======================================================================
# Stage 2: normalise, validate, store
# ======================================================================


def _jsonable(value: Any) -> Any:
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def _payload(value: Any, raw: str | None = None, unit: str | None = None) -> dict[str, Any]:
    """extracted_fields.value: {"raw": as written, "value": normalised, "unit": SI unit}."""
    return {"raw": raw if raw is not None else (None if value is None else str(_jsonable(value))),
            "value": _jsonable(value), "unit": unit}


def _quantity_payload(quantity: Reconciled) -> dict[str, Any]:
    return _payload(quantity.value, quantity.raw, quantity.unit)


@dataclass
class _Context:
    doc: dict[str, Any]
    extraction: Extraction
    wellbore_id: str | None
    td_md_m: float | None
    resolver: normalize.FormationResolver
    counts: Counter = field(default_factory=Counter)

    @property
    def provenance(self) -> str:
        return str(self.doc.get("provenance") or "direct")


async def validate(doc: dict[str, Any], pages: list[dict[str, Any]], extraction: Extraction) -> None:
    result = extraction.result
    wellbore_id, td_md_m = await _resolve_well(doc, result)
    ctx = _Context(doc, extraction, wellbore_id, td_md_m, await normalize.get_resolver())

    # a re-run replaces the unresolved rows of the previous run (the well-assignment row stays)
    await db.execute(
        """
        delete from extracted_fields
        where doc_id = %(doc_id)s and entity_id is null and review_status in ('pending', 'auto_approved')
          and not (entity = 'well_header' and field = 'well_id')
        """,
        {"doc_id": doc["id"]},
    )

    await _store_header(ctx)
    await _store_events(ctx)
    await _store_tops(ctx)
    await _store_hole_sections(ctx)
    await _store_cement_jobs(ctx)
    await _store_mud_records(ctx)
    await _store_time_log(ctx)
    if result.survey_stations:
        logger.info("survey stations are not stored as rows doc_id=%s n=%d", doc["id"], len(result.survey_stations))
    if wellbore_id is None and any(ctx.counts.values()):
        logger.warning("no wellbore for doc_id=%s: results kept only as review fields", doc["id"])
    logger.info("validate_done doc_id=%s counts=%s", doc["id"], dict(ctx.counts))


async def _resolve_well(doc: dict[str, Any], result: ExtractionResult) -> tuple[str | None, float | None]:
    wellbore_id = str(doc["wellbore_id"]) if doc.get("wellbore_id") else None
    well_id = doc.get("well_id")
    if wellbore_id is None and well_id:
        row = await db.fetch_one(
            "select id from wellbores where well_id = %(well_id)s order by is_primary desc, name limit 1",
            {"well_id": str(well_id)},
        )
        wellbore_id = str(row["id"]) if row else None
    td = result.well_header.td_md_m if result.well_header else None
    if td is None and well_id:
        row = await db.fetch_one("select td_md_m from wells where id = %(id)s", {"id": str(well_id)})
        td = row["td_md_m"] if row else None
    return wellbore_id, td


async def _insert(table: str, row: dict[str, Any]) -> None:
    # `table` and the column names are constants of this module, never user input
    columns = ", ".join(row)
    placeholders = ", ".join(f"%({name})s" for name in row)
    await db.execute(f"insert into {table} ({columns}) values ({placeholders})", row)


async def _write_fields(
    ctx: _Context,
    entity: str,
    entity_id: str | None,
    page: int | None,
    snippet: str | None,
    fields: list[tuple[str, dict[str, Any]]],
    verdict: rules.Verdict,
) -> None:
    # keep a field that has no normalised value but does have the text as written (an unresolved
    # formation): it is the row that carries the reason and lets the reviewer pick the right value
    fields = [(n, p) for n, p in fields if p.get("value") is not None or p.get("raw") is not None]
    if not fields:
        return
    bbox = normalize.find_bbox(snippet, ctx.extraction.page_boxes.get(page)) if page is not None else None
    rows = [
        {
            "job_id": ctx.doc.get("job_id"),
            "doc_id": ctx.doc["id"],
            "page": page,
            "entity": entity,
            "entity_id": entity_id,
            "field": name,
            "value": Jsonb(payload),
            "confidence": verdict.confidence,
            "reason": verdict.reason,
            "bbox": Jsonb(bbox) if bbox else None,
            "review_status": verdict.review_status.value,
        }
        for name, payload in fields
    ]
    await db.execute_many(
        """
        insert into extracted_fields (job_id, doc_id, page, entity, entity_id, field, value, confidence,
                                      reason, bbox, review_status)
        values (%(job_id)s, %(doc_id)s, %(page)s, %(entity)s, %(entity_id)s, %(field)s, %(value)s,
                %(confidence)s, %(reason)s, %(bbox)s, %(review_status)s)
        """,
        rows,
    )


def _verdict(ctx: _Context, item: Any, values: dict[str, Any], **flags: Any) -> rules.Verdict:
    return rules.check_item(
        values,
        llm_confidence=item.confidence,
        snippet=item.snippet,
        page_text=ctx.extraction.page_text.get(item.page),
        ocr_confidence=ctx.extraction.page_ocr.get(item.page),
        td_md_m=ctx.td_md_m,
        **flags,
    )


def _reconcile(value: float | None, item: Any, si_unit: str) -> Reconciled:
    return reconcile_quantity(value, item.snippet, si_unit)


# ---------------------------------------------------------------- well header


async def _store_header(ctx: _Context) -> None:
    header = ctx.extraction.result.well_header
    if header is None:
        return
    values = {name: getattr(header, name) for name in HEADER_FIELDS if getattr(header, name) is not None}
    if not values:
        return
    verdict = rules.check_item(
        {**values, "md_m": values.get("td_md_m")},
        llm_confidence=HEADER_CONFIDENCE, snippet=None, page_text=None, ocr_confidence=None,
        check_snippet=False,
    )
    fields = [(name, _payload(value, unit="m" if name.endswith("_m") else None)) for name, value in values.items()]
    await _write_fields(ctx, "well_header", None, None, None, fields, verdict)
    ctx.counts["well_header"] += 1


# ---------------------------------------------------------------- events


async def _formation_info(ctx: _Context, md_m: float) -> dict[str, Any] | None:
    try:
        rows = await db.call_fn("formation_at_md", p_wellbore=ctx.wellbore_id, p_md=md_m)
    except Exception:  # noqa: BLE001 - the well may have no tops yet
        return None
    return rows[0] if rows and rows[0].get("formation") else None


async def _is_duplicate_event(ctx: _Context, event_type: str, md_from_m: float, event_date: date | None) -> bool:
    row = await db.fetch_one(
        """
        select id from events
        where wellbore_id = %(wellbore_id)s and event_type = %(event_type)s
          and abs(md_from_m - %(md)s) <= %(window)s and event_date is not distinct from %(event_date)s
        limit 1
        """,
        {"wellbore_id": ctx.wellbore_id, "event_type": event_type, "md": md_from_m,
         "window": DEDUP_WINDOW_M, "event_date": event_date},
    )
    return row is not None


async def _store_events(ctx: _Context) -> None:
    for item in ctx.extraction.result.events:
        md_from = _reconcile(item.md_from_m, item, "m")
        md_to = _reconcile(item.md_to_m, item, "m")
        npt = _reconcile(item.npt_h, item, "h")
        volume = _reconcile(item.volume_m3, item, "m3")
        event_date = item.event_date or ctx.extraction.result.report_date

        raw_formation = (item.formation or "").strip() or None
        formation = ctx.resolver.resolve(raw_formation)
        unknown = raw_formation is not None and formation is None
        relative_depth = None
        if ctx.wellbore_id and md_from.value is not None:
            info = await _formation_info(ctx, md_from.value)
            if info:
                if formation is None and raw_formation is None:
                    formation = info["formation"]  # filled from the well's own tops
                if info["formation"] == formation:
                    relative_depth = info["relative_depth"]

        event_id = None
        if ctx.wellbore_id and md_from.value is not None:
            if await _is_duplicate_event(ctx, item.event_type.value, md_from.value, event_date):
                ctx.counts["events_duplicate"] += 1
                continue
            event_id = str(uuid4())

        verdict = _verdict(
            ctx, item, {"md_from_m": md_from.value, "md_to_m": md_to.value, "event_date": event_date},
            unknown_formation=unknown,
        )
        if event_id:
            risk = normalize.risk_type_for(item.event_type)
            await _insert("events", {
                "id": event_id, "wellbore_id": ctx.wellbore_id, "event_type": item.event_type.value,
                "risk_type": risk.value if risk else None,
                "md_from_m": md_from.value, "md_to_m": md_to.value, "formation": formation,
                "relative_depth": relative_depth, "npt_h": npt.value, "volume_m3": volume.value,
                "description": item.description, "cause": item.cause, "action": item.action,
                "outcome": item.outcome, "event_date": event_date, "doc_id": ctx.doc["id"], "page": item.page,
                "snippet": item.snippet, "confidence": verdict.confidence, "provenance": ctx.provenance,
                "review_status": verdict.review_status.value,
            })
        await _write_fields(ctx, "event", event_id, item.page, item.snippet, [
            ("event_type", _payload(item.event_type.value)),
            ("md_from_m", _quantity_payload(md_from)),
            ("formation", _payload(formation, raw=raw_formation)),
            ("npt_h", _quantity_payload(npt)),
            ("volume_m3", _quantity_payload(volume)),
            ("description", _payload(item.description)),
        ], verdict)
        ctx.counts["events"] += 1


# ---------------------------------------------------------------- formation tops


async def _store_tops(ctx: _Context) -> None:
    items = ctx.extraction.result.formation_tops
    if not items:
        return
    resolved = []
    for item in items:
        raw = item.formation.strip()
        canonical = ctx.resolver.resolve(raw)
        resolved.append((raw, canonical, _reconcile(item.top_md_m, item, "m"), _reconcile(item.top_tvdss_m, item, "m")))

    ordered = [
        (index, (md.value, ctx.resolver.strat_order[canonical]))
        for index, (_raw, canonical, md, _tvdss) in enumerate(resolved)
        if canonical in ctx.resolver.strat_order and md.value is not None
    ]
    flagged_positions = rules.check_formation_order([pair for _index, pair in ordered])
    out_of_order = {ordered[position][0] for position in flagged_positions}

    for index, (item, (raw, canonical, md, tvdss)) in enumerate(zip(items, resolved)):
        verdict = _verdict(
            ctx, item, {"top_md_m": md.value}, unknown_formation=canonical is None,
            formation_order_ok=index not in out_of_order,
        )
        top_id = None
        if ctx.wellbore_id and canonical and md.value is not None:
            top_id = await _upsert_top(ctx, item, canonical, md.value, tvdss.value)
        await _write_fields(ctx, "formation_top", top_id, item.page, item.snippet, [
            ("formation", _payload(canonical, raw=raw)),
            ("top_md_m", _quantity_payload(md)),
            ("top_tvdss_m", _quantity_payload(tvdss)),
        ], verdict)
        ctx.counts["formation_tops"] += 1


async def _upsert_top(ctx: _Context, item: Any, formation: str, top_md_m: float, top_tvdss_m: float | None) -> str | None:
    """Insert the top; if this wellbore already has one for (formation, source) keep it and return its id."""
    new_id = str(uuid4())
    await db.execute(
        """
        insert into formation_tops (id, wellbore_id, formation, top_md_m, top_tvdss_m, source, provenance, doc_id, page)
        values (%(id)s, %(wellbore_id)s, %(formation)s, %(top_md_m)s, %(top_tvdss_m)s, %(source)s,
                %(provenance)s, %(doc_id)s, %(page)s)
        on conflict (wellbore_id, formation, source) do nothing
        """,
        {"id": new_id, "wellbore_id": ctx.wellbore_id, "formation": formation, "top_md_m": top_md_m,
         "top_tvdss_m": top_tvdss_m, "source": item.source, "provenance": ctx.provenance,
         "doc_id": ctx.doc["id"], "page": item.page},
    )
    row = await db.fetch_one(
        "select id from formation_tops where wellbore_id = %(w)s and formation = %(f)s and source = %(s)s",
        {"w": ctx.wellbore_id, "f": formation, "s": item.source},
    )
    return str(row["id"]) if row else None


# ---------------------------------------------------------------- hole sections, cement, mud, time log


async def _store_hole_sections(ctx: _Context) -> None:
    for item in ctx.extraction.result.hole_sections:
        md_from, md_to = _reconcile(item.md_from_m, item, "m"), _reconcile(item.md_to_m, item, "m")
        shoe, toc = _reconcile(item.shoe_md_m, item, "m"), _reconcile(item.toc_md_m, item, "m")
        verdict = _verdict(ctx, item, {"md_from_m": md_from.value, "md_to_m": md_to.value,
                                       "shoe_md_m": shoe.value, "toc_md_m": toc.value})
        row_id = str(uuid4()) if ctx.wellbore_id else None
        if row_id:
            await _insert("hole_sections", {
                "id": row_id, "wellbore_id": ctx.wellbore_id, "hole_size_in": item.hole_size_in,
                "md_from_m": md_from.value, "md_to_m": md_to.value, "casing_od_in": item.casing_od_in,
                "casing_weight_ppf": item.casing_weight_ppf, "casing_grade": item.casing_grade,
                "shoe_md_m": shoe.value, "toc_md_m": toc.value, "planned": False,
                "provenance": ctx.provenance, "doc_id": ctx.doc["id"], "page": item.page,
            })
        await _write_fields(ctx, "hole_section", row_id, item.page, item.snippet, [
            ("hole_size_in", _payload(item.hole_size_in, unit="in")),
            ("casing_od_in", _payload(item.casing_od_in, unit="in")),
            ("shoe_md_m", _quantity_payload(shoe)),
        ], verdict)
        ctx.counts["hole_sections"] += 1


async def _store_cement_jobs(ctx: _Context) -> None:
    for item in ctx.extraction.result.cement_jobs:
        density = _reconcile(item.slurry_density_sg, item, "sg")
        volume = _reconcile(item.volume_m3, item, "m3")
        woc = _reconcile(item.woc_h, item, "h")
        verdict = _verdict(ctx, item, {})
        job_type = (item.job_type or "").strip().lower()
        row_id = str(uuid4()) if ctx.wellbore_id and job_type in CEMENT_JOB_TYPES else None
        if row_id:
            await _insert("cement_jobs", {
                "id": row_id, "wellbore_id": ctx.wellbore_id, "job_type": job_type, "casing_od_in": item.casing_od_in,
                "slurry_density_sg": density.value, "volume_m3": volume.value,
                "returns_to_surface": item.returns_to_surface, "plug_bumped": item.plug_bumped, "woc_h": woc.value,
                "cbl_result": item.cbl_result, "issue": item.issue, "provenance": ctx.provenance,
                "doc_id": ctx.doc["id"], "page": item.page,
            })
        await _write_fields(ctx, "cement_job", row_id, item.page, item.snippet, [
            ("job_type", _payload(job_type or None)),
            ("slurry_density_sg", _quantity_payload(density)),
            ("volume_m3", _quantity_payload(volume)),
            ("issue", _payload(item.issue)),
        ], verdict)
        ctx.counts["cement_jobs"] += 1


async def _store_mud_records(ctx: _Context) -> None:
    for item in ctx.extraction.result.mud_records:
        md = _reconcile(item.md_m, item, "m")
        mw = _reconcile(item.mw_sg, item, "sg")
        ecd = _reconcile(item.ecd_sg, item, "sg")
        report_date = item.report_date or ctx.extraction.result.report_date
        verdict = _verdict(ctx, item, {"md_m": md.value, "mw_sg": mw.value, "report_date": report_date})
        row_id = str(uuid4()) if ctx.wellbore_id else None
        if row_id:
            await _insert("mud_records", {
                "id": row_id, "wellbore_id": ctx.wellbore_id, "report_date": report_date, "md_m": md.value,
                "mud_type": item.mud_type, "mw_sg": mw.value, "pv_cp": item.pv_cp,
                "yp_lbf100ft2": item.yp_lbf100ft2, "ecd_sg": ecd.value, "provenance": ctx.provenance,
                "doc_id": ctx.doc["id"], "page": item.page,
            })
        await _write_fields(ctx, "mud_record", row_id, item.page, item.snippet, [
            ("md_m", _quantity_payload(md)),
            ("mw_sg", _quantity_payload(mw)),
            ("pv_cp", _payload(item.pv_cp, unit="cp")),
            ("yp_lbf100ft2", _payload(item.yp_lbf100ft2, unit="lbf/100ft2")),
            ("ecd_sg", _quantity_payload(ecd)),
        ], verdict)
        ctx.counts["mud_records"] += 1


async def _store_time_log(ctx: _Context) -> None:
    low, high = IADC_CODE_RANGE
    for item in ctx.extraction.result.time_log:
        md = _reconcile(item.md_m, item, "m")
        code = item.iadc_code if item.iadc_code and low <= item.iadc_code <= high else None
        code = code or normalize.infer_iadc_code(f"{item.comment or ''} {item.state or ''}")
        verdict = _verdict(ctx, item, {"md_m": md.value})
        row_id = str(uuid4()) if ctx.wellbore_id else None
        if row_id:
            await _insert("time_log", {
                "id": row_id, "wellbore_id": ctx.wellbore_id, "report_date": ctx.extraction.result.report_date,
                "t_start": item.t_start, "t_end": item.t_end, "hours": item.hours, "md_m": md.value,
                "phase": item.phase, "iadc_code": code, "state": item.state, "comment": item.comment,
                "doc_id": ctx.doc["id"], "page": item.page,
            })
        await _write_fields(ctx, "time_log", row_id, item.page, item.snippet, [
            ("md_m", _quantity_payload(md)),
            ("iadc_code", _payload(code)),
            ("hours", _payload(item.hours, unit="h")),
            ("comment", _payload(item.comment)),
        ], verdict)
        ctx.counts["time_log"] += 1

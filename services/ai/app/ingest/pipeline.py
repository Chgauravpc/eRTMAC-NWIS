"""Document ingestion pipeline (BE-05).

Contract §6 (documents, jobs, extracted_fields), §8 (storage paths).

`run_pipeline(job_id)` walks one job through classify -> ocr -> extract ->
validate -> index, writing `jobs.stage` / `jobs.progress` as it goes (the
frontend follows them over Realtime). One document at a time: the Space is a
CPU box, so a global semaphore serialises runs.

`ocr_or_parse`, `extract`, `validate` and `index` below are placeholders that
BE-07 (OCR), BE-08 (extraction, validation) and BE-09 (indexing) replace.
"""

from __future__ import annotations

import asyncio
import mimetypes
from typing import Any
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from rapidfuzz import fuzz, process

from app import db, storage
from app.errors import NwisError
from app.ingest import classify as classify_mod
from app.logging import get_logger
from app.models.enums import DocType, JobStatus, Provenance

logger = get_logger(__name__)

# progress reached when a stage has finished (PRD BE-05)
STAGE_PROGRESS = {"classify": 5, "ocr": 40, "extract": 80, "validate": 90, "index": 100}
WELL_MATCH_MIN_RATIO = 90
MAX_ERROR_CHARS = 300

# one document at a time (CPU box)
_pipeline_lock = asyncio.Semaphore(1)

# PRD BE-07: {page_no, text, markdown, tables, ocr_confidence, engine, boxes}
PageResult = dict[str, Any]


# --------------------------------------------------------------------------
# Placeholders for later tasks (keep these signatures when replacing them)
# --------------------------------------------------------------------------


async def ocr_or_parse(doc: dict[str, Any]) -> list[PageResult]:
    """BE-07: OCR / parse the stored file into pages."""
    logger.warning("ocr_or_parse is a BE-07 placeholder; no pages produced doc_id=%s", doc["id"])
    return []


async def extract(doc: dict[str, Any], pages: list[PageResult]) -> None:
    """BE-08: LLM extraction; writes events, tops, ... and extracted_fields rows."""
    logger.warning("extract is a BE-08 placeholder; nothing extracted doc_id=%s", doc["id"])


async def validate(doc: dict[str, Any], pages: list[PageResult]) -> None:
    """BE-08: validation rules and confidence adjustment."""
    logger.warning("validate is a BE-08 placeholder doc_id=%s", doc["id"])


async def index(doc_id: str) -> None:
    """BE-09: chunk, embed and insert into `chunks`."""
    logger.warning("index is a BE-09 placeholder; nothing indexed doc_id=%s", doc_id)


# --------------------------------------------------------------------------
# Registering documents and jobs (shared by the router and the batch CLI)
# --------------------------------------------------------------------------


async def create_document(
    *,
    doc_id: str,
    title: str,
    file_path: str,
    sha256: str,
    doc_type: DocType = DocType.OTHER,
    well_id: UUID | str | None = None,
    wellbore_id: UUID | str | None = None,
    provenance: Provenance = Provenance.DIRECT,
    uploaded_by: str | None = None,
) -> None:
    await db.execute(
        """
        insert into documents (id, well_id, wellbore_id, doc_type, title, file_path, sha256,
                               provenance, uploaded_by)
        values (%(id)s, %(well_id)s, %(wellbore_id)s, %(doc_type)s, %(title)s, %(file_path)s,
                %(sha256)s, %(provenance)s, %(uploaded_by)s)
        """,
        {
            "id": doc_id,
            "well_id": str(well_id) if well_id else None,
            "wellbore_id": str(wellbore_id) if wellbore_id else None,
            "doc_type": doc_type.value,
            "title": title,
            "file_path": file_path,
            "sha256": sha256,
            "provenance": provenance.value,
            "uploaded_by": uploaded_by,
        },
    )


async def delete_document(doc_id: str) -> None:
    await db.execute("delete from documents where id = %(id)s", {"id": doc_id})


async def create_job(doc_id: str, created_by: str | None) -> str:
    job_id = str(uuid4())
    await db.execute(
        """
        insert into jobs (id, doc_id, status, progress, created_by)
        values (%(id)s, %(doc_id)s, 'queued', 0, %(created_by)s)
        """,
        {"id": job_id, "doc_id": doc_id, "created_by": created_by},
    )
    return job_id


async def write_audit(user_id: str | None, action: str, entity: str, entity_id: str, details: dict) -> None:
    await db.execute(
        """
        insert into audit_log (user_id, action, entity, entity_id, details)
        values (%(user_id)s, %(action)s, %(entity)s, %(entity_id)s, %(details)s)
        """,
        {"user_id": user_id, "action": action, "entity": entity, "entity_id": entity_id, "details": Jsonb(details)},
    )


# --------------------------------------------------------------------------
# The pipeline
# --------------------------------------------------------------------------


async def run_pipeline(job_id: UUID | str) -> None:
    """Run all stages for one job. Never raises: failures are recorded on the job."""
    job_id = str(job_id)
    async with _pipeline_lock:
        try:
            await _run(job_id)
        except Exception as exc:  # noqa: BLE001 - the background task must not crash the service
            logger.exception("pipeline_failed job_id=%s", job_id)
            await _mark_failed(job_id, exc)


async def _run(job_id: str) -> None:
    doc = await _load_doc(job_id)
    await _set_job(job_id, status=JobStatus.RUNNING.value, stage="classify", progress=0, error=None)

    doc = await _classify_stage(job_id, doc)

    await _set_job(job_id, stage="ocr", progress=STAGE_PROGRESS["classify"])
    pages = await ocr_or_parse(doc)

    await _set_job(job_id, stage="extract", progress=STAGE_PROGRESS["ocr"])
    await extract(doc, pages)

    await _set_job(job_id, stage="validate", progress=STAGE_PROGRESS["extract"])
    await validate(doc, pages)

    await _set_job(job_id, stage="index", progress=STAGE_PROGRESS["validate"])
    await index(doc["id"])

    row = await db.fetch_one(
        "select count(*) as n from extracted_fields where doc_id = %(doc_id)s and review_status = 'pending'",
        {"doc_id": doc["id"]},
    )
    pending = row["n"] if row else 0
    final = JobStatus.NEEDS_REVIEW if pending else JobStatus.DONE
    await _set_job(job_id, status=final.value, stage="done", progress=STAGE_PROGRESS["index"])


async def _load_doc(job_id: str) -> dict[str, Any]:
    doc = await db.fetch_one(
        """
        select d.id, d.title, d.file_path, d.doc_type, d.well_id, d.wellbore_id, d.provenance
        from jobs j join documents d on d.id = j.doc_id
        where j.id = %(job_id)s
        """,
        {"job_id": job_id},
    )
    if doc is None:
        raise LookupError(f"job {job_id} not found")
    doc["id"] = str(doc["id"])
    return doc


_JOB_FIELDS = frozenset({"status", "stage", "progress", "error"})


async def _set_job(job_id: str, **fields: Any) -> None:
    if not fields.keys() <= _JOB_FIELDS:  # keys are interpolated into SQL, so allowlist them
        raise ValueError(f"unknown job fields: {sorted(fields.keys() - _JOB_FIELDS)}")
    assignments = ", ".join(f"{key} = %({key})s" for key in fields)
    await db.execute(f"update jobs set {assignments} where id = %(job_id)s", {**fields, "job_id": job_id})


async def _mark_failed(job_id: str, exc: Exception) -> None:
    message = exc.message if isinstance(exc, NwisError) else f"{type(exc).__name__}: {exc}"
    try:
        await _set_job(job_id, status=JobStatus.FAILED.value, error=message[:MAX_ERROR_CHARS])
    except Exception:  # noqa: BLE001
        logger.exception("could_not_mark_job_failed job_id=%s", job_id)


async def _classify_stage(job_id: str, doc: dict[str, Any]) -> dict[str, Any]:
    """Set `doc_type` (unless the uploader chose one) and match the well."""
    data = await asyncio.to_thread(storage.download, "documents", doc["file_path"])
    mime = mimetypes.guess_type(doc["title"])[0]
    text = await asyncio.to_thread(classify_mod.peek_text, data, doc["title"], mime)

    requested = None if doc["doc_type"] == DocType.OTHER.value else DocType(doc["doc_type"])
    result = await classify_mod.classify_with_details(doc["title"], text, mime, requested)

    if result.doc_type != DocType.OTHER and result.doc_type.value != doc["doc_type"]:
        await db.execute(
            "update documents set doc_type = %(doc_type)s where id = %(id)s",
            {"doc_type": result.doc_type.value, "id": doc["id"]},
        )
        doc["doc_type"] = result.doc_type.value

    if doc["well_id"] is None:
        well_name = result.well_name or classify_mod.guess_well_name(text)
        well_id = await match_well(well_name) if well_name else None
        if well_id is not None:
            await db.execute(
                "update documents set well_id = %(well_id)s where id = %(id)s",
                {"well_id": well_id, "id": doc["id"]},
            )
            doc["well_id"] = well_id
        else:
            await _flag_unmatched_well(job_id, doc["id"], well_name)
    return doc


async def match_well(well_name: str) -> str | None:
    """wells.id whose name matches `well_name` (case-insensitive, rapidfuzz ratio >= 90).

    An exact match always wins. A fuzzy match must be unambiguous: names that
    differ by one character score 90 (SYN-DLJ-03 vs SYN-DLJ-04), so if two
    wells tie for best we leave the well unassigned for a reviewer instead of
    guessing.
    """
    wells = await db.fetch_all("select id, name from wells")
    choices = {str(w["id"]): w["name"].lower() for w in wells}
    query = well_name.strip().lower()
    for well_id, name in choices.items():
        if name == query:
            return well_id
    ranked = process.extract(query, choices, scorer=fuzz.ratio, score_cutoff=WELL_MATCH_MIN_RATIO, limit=2)
    if not ranked or (len(ranked) == 2 and ranked[0][1] == ranked[1][1]):
        return None
    return ranked[0][2]


async def _flag_unmatched_well(job_id: str, doc_id: str, well_name: str | None) -> None:
    """Ask a reviewer to assign the well (confidence 0 keeps it in the review queue).

    Skipped when the document already has a pending one (a retried job re-runs
    this stage).
    """
    # contract §7: the reviewer picks the well; review_field writes documents.well_id
    value = Jsonb({"raw": well_name, "value": None, "unit": None}) if well_name else None
    await db.execute(
        """
        insert into extracted_fields (job_id, doc_id, entity, field, value, confidence, reason)
        select %(job_id)s, %(doc_id)s, 'well_header', 'well_id', %(value)s, 0, 'unmatched_well'
        where not exists (
            select 1 from extracted_fields
            where doc_id = %(doc_id)s and entity = 'well_header' and field = 'well_id'
              and review_status = 'pending'
        )
        """,
        {"job_id": job_id, "doc_id": doc_id, "value": value},
    )

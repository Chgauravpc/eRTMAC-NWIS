"""POST /v1/documents (contract §9.2).

The browser has already uploaded the file to `documents/incoming/{upload_id}/{filename}`
through a signed upload URL (§9.1, §8). This route fingerprints it, rejects
duplicates, moves it to `{doc_id}/{filename}`, creates the `documents` and
`jobs` rows and starts the pipeline in the background.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import PurePosixPath
from uuid import UUID, uuid4

import psycopg.errors
from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, ValidationError

from app import db, storage
from app.deps import current_user
from app.errors import NwisError
from app.ingest import pipeline
from app.logging import get_logger
from app.models.enums import DocType, JobStatus, Provenance

logger = get_logger(__name__)

router = APIRouter()

UPLOAD_ROLES = ("reviewer", "office_engineer", "admin")
INCOMING_PREFIX = "incoming/"
MAX_NAME_CHARS = 120


class DocumentRequest(BaseModel):
    storage_path: str
    filename: str
    well_id: UUID | None = None
    wellbore_id: UUID | None = None
    doc_type: DocType | None = None
    provenance: Provenance = Provenance.DIRECT


def _bad_request(message: str, details: dict | None = None) -> NwisError:
    return NwisError("NWIS_BAD_REQUEST", message, 400, details)


async def _parse_body(request: Request) -> DocumentRequest:
    # Parsed by hand (not as a typed parameter) so invalid bodies get the
    # contract §4 error shape (400 NWIS_BAD_REQUEST) instead of FastAPI's 422.
    try:
        return DocumentRequest.model_validate(await request.json())
    except ValidationError as exc:
        raise _bad_request("Invalid request body", {"errors": exc.errors(include_url=False, include_context=False)})
    except ValueError as exc:  # malformed JSON
        raise _bad_request("Request body must be valid JSON") from exc


def _safe_name(storage_path: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", PurePosixPath(storage_path).name)[:MAX_NAME_CHARS]
    return name or "file"


def _check_storage_path(storage_path: str) -> None:
    parts = PurePosixPath(storage_path).parts
    if not storage_path.startswith(INCOMING_PREFIX) or len(parts) < 3 or ".." in parts:
        raise _bad_request("storage_path must look like incoming/<upload_id>/<filename>")


async def _discard_incoming(storage_path: str) -> None:
    def remove() -> None:
        storage.get_storage_client().storage.from_("documents").remove([storage_path])

    try:
        await asyncio.to_thread(remove)
    except Exception:  # noqa: BLE001 - a leftover incoming object is harmless
        logger.warning("could_not_remove_incoming storage_path=%s", storage_path)


async def _duplicate_response(
    response: Response,
    background: BackgroundTasks,
    existing_id: str,
    storage_path: str,
    user_id: str | None,
) -> dict:
    """Same sha256 already stored: drop the new upload.

    Retry rule (agreed after the BE-05 review): if the stored document's latest
    job *failed*, re-uploading it starts a fresh job instead of reporting a
    dead-end duplicate. The stored copy is reused, so the new upload is still
    discarded.
    """
    await _discard_incoming(storage_path)
    latest = await db.fetch_one(
        "select status from jobs where doc_id = %(doc_id)s order by created_at desc limit 1",
        {"doc_id": existing_id},
    )
    if latest and latest["status"] == JobStatus.FAILED.value:
        job_id = await pipeline.create_job(existing_id, user_id)
        await pipeline.write_audit(user_id, "doc.retry", "document", existing_id, {"job_id": job_id})
        background.add_task(pipeline.run_pipeline, job_id)
        response.status_code = 202
        return {"document_id": existing_id, "job_id": job_id, "duplicate": False}
    response.status_code = 200
    return {"document_id": existing_id, "job_id": None, "duplicate": True}


@router.post("/documents")
async def create_document(request: Request, response: Response, background: BackgroundTasks) -> dict:
    user = current_user(request).require_role(*UPLOAD_ROLES)
    body = await _parse_body(request)
    _check_storage_path(body.storage_path)

    try:
        data = await asyncio.to_thread(storage.download, "documents", body.storage_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("incoming_download_failed storage_path=%s", body.storage_path)
        raise NwisError(
            "NWIS_NOT_FOUND", "Uploaded file not found in storage", 404, {"storage_path": body.storage_path}
        ) from exc

    sha256 = hashlib.sha256(data).hexdigest()
    uploaded_by = _as_uuid_str(user.id)
    existing = await db.fetch_one("select id from documents where sha256 = %(sha256)s", {"sha256": sha256})
    if existing:
        return await _duplicate_response(response, background, str(existing["id"]), body.storage_path, uploaded_by)

    doc_id = str(uuid4())
    file_path = f"{doc_id}/{_safe_name(body.storage_path)}"

    try:
        await pipeline.create_document(
            doc_id=doc_id,
            title=body.filename.strip()[:255] or _safe_name(body.storage_path),
            file_path=file_path,
            sha256=sha256,
            doc_type=body.doc_type or DocType.OTHER,
            well_id=body.well_id,
            wellbore_id=body.wellbore_id,
            provenance=body.provenance,
            uploaded_by=uploaded_by,
        )
    except psycopg.errors.UniqueViolation:  # same file uploaded concurrently
        existing = await db.fetch_one("select id from documents where sha256 = %(sha256)s", {"sha256": sha256})
        if existing:
            return await _duplicate_response(
                response, background, str(existing["id"]), body.storage_path, uploaded_by
            )
        raise
    except psycopg.errors.ForeignKeyViolation as exc:
        raise _bad_request("well_id, wellbore_id or the uploading user does not exist") from exc

    try:
        await asyncio.to_thread(storage.move, "documents", body.storage_path, file_path)
    except Exception as exc:  # noqa: BLE001
        logger.exception("incoming_move_failed storage_path=%s", body.storage_path)
        await pipeline.delete_document(doc_id)
        raise NwisError("NWIS_UPSTREAM", "Could not store the uploaded file", 502) from exc

    job_id = await pipeline.create_job(doc_id, uploaded_by)
    await pipeline.write_audit(
        uploaded_by, "doc.upload", "document", doc_id, {"filename": body.filename, "job_id": job_id}
    )

    background.add_task(pipeline.run_pipeline, job_id)
    response.status_code = 202
    return {"document_id": doc_id, "job_id": job_id, "duplicate": False}


def _as_uuid_str(value: str | None) -> str | None:
    try:
        return str(UUID(value)) if value else None
    except ValueError:
        return None

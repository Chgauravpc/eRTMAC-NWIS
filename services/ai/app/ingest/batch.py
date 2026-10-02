"""Batch ingestion CLI (BE-05).

    python -m app.ingest.batch --doc-type witsml --limit 50
        run the pipeline for documents already in `documents` (e.g. the Volve
        DDRs inserted by the Database loaders) that have no `jobs` row yet

    python -m app.ingest.batch --dir path/to/folder [--doc-type ddr] [--provenance synthetic]
        upload every file in a folder (synthetic PDFs, NPD history text, ...)
        as new documents, skipping files whose sha256 already exists, then
        run the pipeline for them
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import mimetypes
import re
import sys
from collections import Counter
from pathlib import Path
from uuid import UUID, uuid4

from app import db, storage
from app.config import get_settings
from app.ingest import pipeline
from app.logging import configure_logging, get_logger
from app.models.enums import DocType, Provenance

logger = get_logger(__name__)

MAX_NAME_CHARS = 120


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:MAX_NAME_CHARS] or "file"


async def jobs_for_existing_documents(doc_type: DocType | None, limit: int | None) -> list[str]:
    """Create a queued job for each document that has none yet; return the job ids."""
    rows = await db.fetch_all(
        """
        select d.id, d.uploaded_by
        from documents d
        where not exists (select 1 from jobs j where j.doc_id = d.id)
          and (%(doc_type)s::text is null or d.doc_type::text = %(doc_type)s)
        order by d.created_at
        limit %(limit)s
        """,
        {"doc_type": doc_type.value if doc_type else None, "limit": limit},
    )
    return [
        await pipeline.create_job(str(row["id"]), str(row["uploaded_by"]) if row["uploaded_by"] else None)
        for row in rows
    ]


async def jobs_for_directory(
    folder: Path,
    doc_type: DocType | None,
    provenance: Provenance,
    well_id: str | None,
) -> list[str]:
    """Upload each file in `folder` as a new document; return the new job ids."""
    job_ids: list[str] = []
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        data = path.read_bytes()
        sha256 = hashlib.sha256(data).hexdigest()
        if await db.fetch_one("select id from documents where sha256 = %(sha256)s", {"sha256": sha256}):
            logger.info("batch_skip_duplicate file=%s", path)
            continue

        doc_id = str(uuid4())
        file_path = f"{doc_id}/{_safe_name(path.name)}"
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        await asyncio.to_thread(storage.upload, "documents", file_path, data, content_type)
        await pipeline.create_document(
            doc_id=doc_id,
            title=path.name,
            file_path=file_path,
            sha256=sha256,
            doc_type=doc_type or DocType.OTHER,
            well_id=well_id,
            provenance=provenance,
        )
        job_ids.append(await pipeline.create_job(doc_id, None))
    return job_ids


async def run_batch(args: argparse.Namespace) -> Counter:
    doc_type = DocType(args.doc_type) if args.doc_type else None
    if args.dir:
        job_ids = await jobs_for_directory(Path(args.dir), doc_type, Provenance(args.provenance), args.well_id)
    else:
        job_ids = await jobs_for_existing_documents(doc_type, args.limit)

    print(f"{len(job_ids)} document(s) to process")
    for number, job_id in enumerate(job_ids, start=1):
        await pipeline.run_pipeline(job_id)  # sequential; never raises
        print(f"  [{number}/{len(job_ids)}] job {job_id} finished")

    if not job_ids:
        return Counter()
    rows = await db.fetch_all(
        "select status, count(*) as n from jobs where id = any(%(ids)s) group by status",
        {"ids": [UUID(j) for j in job_ids]},
    )
    return Counter({row["status"]: row["n"] for row in rows})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.ingest.batch", description=__doc__.split("\n\n")[0])
    parser.add_argument("--doc-type", choices=[t.value for t in DocType], help="only/force this doc_type")
    parser.add_argument("--limit", type=int, help="max documents (existing-documents mode)")
    parser.add_argument("--dir", help="ingest local files from this folder instead")
    parser.add_argument("--provenance", choices=[p.value for p in Provenance], default=Provenance.DIRECT.value)
    parser.add_argument("--well-id", help="assign all --dir files to this well")
    return parser


async def _main(args: argparse.Namespace) -> None:
    try:
        summary = await run_batch(args)
    finally:
        await db.close_pool()
    if summary:
        print("results: " + ", ".join(f"{status}={n}" for status, n in sorted(summary.items())))
        await _rebuild_lessons()


async def _rebuild_lessons() -> None:
    """New events may form new lessons (BE-11); a failure here must not fail the batch."""
    from app.search import lessons

    try:
        stats = await lessons.rebuild()
        print(f"lessons: {stats['created']} created, {stats['updated']} updated, {stats['failed']} failed")
    except Exception:  # noqa: BLE001
        logger.exception("lessons_rebuild_failed")
    finally:
        await db.close_pool()


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    configure_logging(get_settings().LOG_LEVEL)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()

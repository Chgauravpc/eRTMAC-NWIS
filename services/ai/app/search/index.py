"""Chunking and indexing of document pages for search (BE-09).

Contract §6 (document_pages, chunks, events, formation_tops).

`index_document(doc_id)` turns a document's `document_pages` into `chunks` rows:
text split into ~1200-character pieces (200 overlap) on line boundaries, each
tagged with the document's well, a formation, and an MD range, and embedded with
bge-small (384 dims). Re-indexing replaces the document's old chunks.

    python -m app.search.index --reindex-all        # every document that has pages
    python -m app.search.index --doc-id <uuid>      # one document

Tagging
* formation: the formation of an event/top extracted from that page whose text lies in the
  chunk; else the first formation name found in the chunk through the synonym table; else null.
* md_from_m / md_to_m: min/max depth of those entities; else the min/max of the lengths written
  in the chunk (feet converted; hole sizes, volumes and absurd values ignored).
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from rapidfuzz import fuzz

from app import db
from app.config import get_settings
from app.ingest import normalize
from app.ingest.normalize import squash
from app.ingest.parsers.units import UnknownUnitError, iter_quantities, to_si
from app.logging import configure_logging, get_logger

logger = get_logger(__name__)

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
TABLE_MAX_CHARS = 2400  # a table block this size or smaller stays in one chunk
MIN_TEXT_DEPTH_M = 1.0
MAX_TEXT_DEPTH_M = 12000.0
ENTITY_MIN_SNIPPET_CHARS = 20  # shorter snippets only match by exact containment
ENTITY_MATCH_RATIO = 90

# a line that looks like part of a table: pipes, tabs, or two or more wide gaps
_COLUMN_BREAK = re.compile(r" {2,}|\t|\|")


# ======================================================================
# Chunking
# ======================================================================


def _is_table_block(block: str) -> bool:
    lines = [line for line in block.splitlines() if line.strip()]
    if len(lines) < 3:
        return False
    tabular = sum(len(_COLUMN_BREAK.findall(line)) >= 2 for line in lines)
    return tabular / len(lines) >= 0.8


def _split_long(line: str, size: int) -> list[str]:
    """Break one over-long line at a sentence end or space (hard cut only inside a giant token)."""
    pieces: list[str] = []
    rest = line.strip()
    while len(rest) > size:
        low = size // 2
        cut = max(rest.rfind(". ", low, size), rest.rfind("; ", low, size))
        cut = cut + 1 if cut != -1 else rest.rfind(" ", low, size)
        if cut <= 0:
            cut = size
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def _pack(atoms: list[str], size: int, overlap: int) -> list[str]:
    """Greedily fill chunks with whole atoms; start each next chunk with the trailing atoms of the last."""
    chunks: list[str] = []
    start, count = 0, len(atoms)
    while start < count:
        end, length = start, 0
        while end < count:
            addition = len(atoms[end]) + (1 if end > start else 0)
            if end > start and length + addition > size:
                break
            length += addition
            end += 1
        chunks.append("\n".join(atoms[start:end]))
        if end >= count:
            break
        back, carried = end, 0
        while back > start + 1 and carried + len(atoms[back - 1]) + 1 <= overlap:
            back -= 1
            carried += len(atoms[back]) + 1
        start = back  # always > start, so the loop makes progress
    return chunks


def chunk_page(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split a page into chunks of about `size` characters.

    Chunks break on line boundaries (an over-long line breaks at a sentence end or space) and
    each chunk repeats up to `overlap` characters from the end of the previous one. A
    table-looking block of at most TABLE_MAX_CHARS stays whole in its own chunk, without overlap.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []

    chunks: list[str] = []
    atoms: list[str] = []

    def flush() -> None:
        chunks.extend(_pack(atoms, size, overlap))
        atoms.clear()

    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block:
            continue
        if _is_table_block(block) and len(block) <= TABLE_MAX_CHARS:
            flush()
            chunks.append(block)
            continue
        for line in block.splitlines():
            if line.strip():
                atoms.extend(_split_long(line, size))
    flush()
    return chunks


# ======================================================================
# Tagging
# ======================================================================


class SynonymMatcher:
    """Finds formation names (any alias, whole words, case-insensitive) in text."""

    def __init__(self, synonyms: dict[str, str]):
        self._canonical = {squash(alias): formation for alias, formation in synonyms.items() if alias.strip()}
        aliases = sorted(self._canonical, key=len, reverse=True)  # longest alias first
        self._regex = (
            re.compile(r"(?<!\w)(" + "|".join(re.escape(a).replace(r"\ ", r"\s+") for a in aliases) + r")(?!\w)", re.I)
            if aliases
            else None
        )

    def find_all(self, text: str) -> list[str]:
        """Canonical formations in order of first mention, each once."""
        if self._regex is None:
            return []
        found: list[str] = []
        for match in self._regex.finditer(text):
            formation = self._canonical[squash(match.group(1))]
            if formation not in found:
                found.append(formation)
        return found

    def first(self, text: str) -> str | None:
        found = self.find_all(text)
        return found[0] if found else None


@dataclass(frozen=True)
class ChunkTag:
    formation: str | None = None
    md_from_m: float | None = None
    md_to_m: float | None = None


def _text_depths(chunk: str) -> list[float]:
    depths = []
    for number, unit in iter_quantities(chunk):
        try:
            value, unit_si = to_si(number, unit)
        except UnknownUnitError:
            continue
        if unit_si == "m" and MIN_TEXT_DEPTH_M <= value <= MAX_TEXT_DEPTH_M:
            depths.append(value)
    return depths


def tag_chunk(chunk: str, page_entities: list[dict[str, Any]], synonyms: dict[str, str] | SynonymMatcher) -> ChunkTag:
    """Formation and MD range for one chunk.

    `page_entities` are the entities extracted from the chunk's page, as dicts with
    `snippet`, `formation`, `md_from_m`, `md_to_m`. An entity belongs to the chunk when its
    snippet lies in it; an entity with no snippet (a formation top) when its formation is named in it.
    """
    matcher = synonyms if isinstance(synonyms, SynonymMatcher) else SynonymMatcher(synonyms)
    squashed = squash(chunk)
    named = None  # formations named in the chunk, computed on demand

    matched = []
    for entity in page_entities:
        snippet = squash(entity.get("snippet") or "")
        if snippet:
            if snippet in squashed or (
                len(snippet) >= ENTITY_MIN_SNIPPET_CHARS
                and fuzz.partial_ratio(snippet, squashed) >= ENTITY_MATCH_RATIO
            ):
                matched.append(entity)
        elif entity.get("formation"):
            named = matcher.find_all(chunk) if named is None else named
            if entity["formation"] in named:
                matched.append(entity)

    formation = next((e["formation"] for e in matched if e.get("formation")), None) or matcher.first(chunk)
    depths = [d for e in matched for d in (e.get("md_from_m"), e.get("md_to_m")) if d is not None]
    depths = depths or _text_depths(chunk)
    return ChunkTag(formation, min(depths) if depths else None, max(depths) if depths else None)


# ======================================================================
# Indexing
# ======================================================================


def _embed(texts: list[str]) -> list[list[float]]:
    from app.search.embed import embed_passages  # imported late: pulls in sentence-transformers

    return embed_passages(texts)


def _vector_literal(values: list[float]) -> str:
    from app.search.embed import to_pgvector

    return to_pgvector(values)


async def _page_entities(doc_id: str) -> dict[int, list[dict[str, Any]]]:
    events = await db.fetch_all(
        """
        select page, snippet, formation, md_from_m, md_to_m from events
        where doc_id = %(doc_id)s and page is not null and review_status <> 'rejected'
        """,
        {"doc_id": doc_id},
    )
    tops = await db.fetch_all(
        "select page, formation, top_md_m from formation_tops where doc_id = %(doc_id)s and page is not null",
        {"doc_id": doc_id},
    )
    by_page: dict[int, list[dict[str, Any]]] = {}
    for row in events:
        by_page.setdefault(row["page"], []).append(row)
    for row in tops:
        by_page.setdefault(row["page"], []).append(
            {"snippet": None, "formation": row["formation"], "md_from_m": row["top_md_m"], "md_to_m": None}
        )
    return by_page


async def index_document(doc_id: UUID | str) -> int:
    """(Re)build the document's chunks; returns how many were written.

    Everything is computed, embedded included, before the old chunks are deleted, so a failure
    (e.g. the model cannot load) leaves the previous index untouched.
    """
    doc_id = str(doc_id)
    doc = await db.fetch_one("select id, well_id from documents where id = %(id)s", {"id": doc_id})
    if doc is None:
        raise LookupError(f"document {doc_id} not found")
    pages = await db.fetch_all(
        "select page_no, text from document_pages where doc_id = %(doc_id)s order by page_no", {"doc_id": doc_id}
    )
    entities = await _page_entities(doc_id)
    matcher = SynonymMatcher((await normalize.get_resolver()).alias_map)
    well_id = str(doc["well_id"]) if doc.get("well_id") else None

    rows = []
    for page in pages:
        for piece in chunk_page(page["text"] or ""):
            tag = tag_chunk(piece, entities.get(page["page_no"], []), matcher)
            rows.append({
                "doc_id": doc_id, "page": page["page_no"], "text": piece, "well_id": well_id,
                "formation": tag.formation, "md_from_m": tag.md_from_m, "md_to_m": tag.md_to_m,
            })
    if rows:
        vectors = await asyncio.to_thread(_embed, [row["text"] for row in rows])
        for row, vector in zip(rows, vectors):
            row["embedding"] = _vector_literal(vector)

    await db.execute("delete from chunks where doc_id = %(doc_id)s", {"doc_id": doc_id})
    if rows:
        await db.execute_many(
            """
            insert into chunks (doc_id, page, text, embedding, well_id, formation, md_from_m, md_to_m)
            values (%(doc_id)s, %(page)s, %(text)s, %(embedding)s::vector, %(well_id)s, %(formation)s,
                    %(md_from_m)s, %(md_to_m)s)
            """,
            rows,
        )
    logger.info("indexed doc_id=%s pages=%d chunks=%d", doc_id, len(pages), len(rows))
    return len(rows)


# ======================================================================
# CLI
# ======================================================================


async def reindex_all() -> tuple[int, int]:
    """Re-index every document that has pages. Returns (documents indexed, chunks written)."""
    docs = await db.fetch_all("select distinct doc_id from document_pages order by doc_id")
    total = 0
    for number, row in enumerate(docs, start=1):
        count = await index_document(row["doc_id"])
        total += count
        print(f"  [{number}/{len(docs)}] {row['doc_id']}: {count} chunks")
    return len(docs), total


async def _main(args: argparse.Namespace) -> None:
    try:
        if args.doc_id:
            print(f"{args.doc_id}: {await index_document(args.doc_id)} chunks")
        else:
            documents, chunks = await reindex_all()
            print(f"re-indexed {documents} document(s), {chunks} chunk(s)")
    finally:
        await db.close_pool()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.search.index", description="Rebuild the search index.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--reindex-all", action="store_true", help="re-index every document that has pages")
    group.add_argument("--doc-id", help="re-index one document")
    args = parser.parse_args(argv)
    configure_logging(get_settings().LOG_LEVEL)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_main(args))


if __name__ == "__main__":
    main()

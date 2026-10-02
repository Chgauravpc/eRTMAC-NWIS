"""Search and Ask (RAG with citations) - BE-10, contract §7 (hybrid_search,
events_for_offsets) and §9.2 (/search, /ask).

/ask never lets the model's numbers through unchecked: it refuses to call the LLM
on thin evidence, drops citations to sources that do not exist, and removes any
sentence whose number+unit is not present in the sources it cites.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app import db
from app.ingest.normalize import get_resolver
from app.llm.client import complete_text
from app.logging import get_logger

logger = get_logger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "llm" / "prompts" / "ask_system.md"

# hybrid_search fuses a keyword rank and a vector rank (RRF, k = 60). The vector half always returns its 50 nearest
# chunks, so even an off-topic question gets a top score of at least 1/61 = 0.01639 from the vector list alone.
# 0.0165 sits just above that: the best chunk must also be a keyword hit (the original 0.015 never refused anything).
MIN_RRF = 0.0165
ASK_TOP_K = 8
MIN_SOURCES = 2
EVENT_RADIUS_M = 10000.0
EVENT_LIMIT = 20
SNIPPET_CHARS = 300
PROMPT_CHUNK_CHARS = 1500  # per chunk in the prompt; the number check uses the same text
CLOSEST_RECORDS = 3

INSUFFICIENT_HEAD = "Not enough evidence in the knowledge base to answer this. Closest records:"
REMOVED_NOTE = "(Some details were removed because they were not found in the sources.)"


class Filters(BaseModel):
    formation: str | None = None
    event_type: str | None = None
    field: str | None = None
    md_from: float | None = None
    md_to: float | None = None


# ---------------------------------------------------------------- retrieval


def _embed_query(text: str) -> str:
    """pgvector literal of the query embedding (imported lazily: the model is heavy)."""
    from app.search import embed

    return embed.to_pgvector(embed.embed_query(text))


async def hybrid(query: str, filters: Filters, limit: int) -> list[dict[str, Any]]:
    embedding = await asyncio.to_thread(_embed_query, query)
    return await db.call_fn(
        "hybrid_search",
        p_query=query,
        p_embedding=embedding,
        p_formation=filters.formation,
        p_event_type=filters.event_type,
        p_field=filters.field,
        p_md_from=filters.md_from,
        p_md_to=filters.md_to,
        p_limit=limit,
    )


_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-/]*")


def _keywords(query: str) -> list[str]:
    return sorted({w.lower() for w in _WORD_RE.findall(query) if len(w) >= 3}, key=len, reverse=True)


def snippet_for(text: str, query: str, size: int = SNIPPET_CHARS) -> str:
    """`size` characters around the best keyword hit (longest query word found), else the start."""
    text = " ".join((text or "").split())
    if len(text) <= size:
        return text
    lowered = text.lower()
    for word in _keywords(query):
        hit = lowered.find(word)
        if hit >= 0:
            start = max(0, min(hit - (size - len(word)) // 2, len(text) - size))
            return text[start : start + size]
    return text[:size]


async def search(query: str, filters: Filters, limit: int) -> list[dict[str, Any]]:
    rows = await hybrid(query, filters, limit)
    return [
        {
            "chunk_id": str(r["chunk_id"]),
            "doc_id": str(r["doc_id"]),
            "doc_title": r["doc_title"],
            "page": r["page"],
            "snippet": snippet_for(r["text"], query),
            "well_name": r["well_name"],
            "formation": r["formation"],
            "score": r["score"],
        }
        for r in rows
    ]


# ---------------------------------------------------------------- sources


@dataclass
class Source:
    n: int
    chunk_id: str | None  # None for sources built from an events row
    doc_id: str
    doc_title: str
    page: int | None
    text: str  # exactly what the model sees; the number check reads this
    snippet: str


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def event_line(event: dict[str, Any]) -> str:
    depth = f"{_fmt(event['md_from_m'])} m"
    if event.get("md_to_m") is not None:
        depth = f"{depth} to {_fmt(event['md_to_m'])} m"
    head = f"{event.get('well_name') or 'Offset well'}: {event['event_type']} at {depth} MD"
    if event.get("formation"):
        head += f" in {event['formation']}"
    parts = [head, event["description"].strip()]
    for label, key in (("Cause", "cause"), ("Action", "action"), ("Outcome", "outcome")):
        if event.get(key):
            parts.append(f"{label}: {event[key].strip()}")
    if event.get("npt_h") is not None:
        parts.append(f"NPT {_fmt(event['npt_h'])} h")
    if event.get("volume_m3") is not None:
        parts.append(f"Volume {_fmt(event['volume_m3'])} m3")
    return ". ".join(p.rstrip(".") for p in parts) + "."


async def formations_in(question: str) -> list[str]:
    """Canonical formations named (or aliased) in the question, via formation_synonyms."""
    lowered = question.lower()
    found = {
        formation
        for alias, formation in (await get_resolver()).alias_map.items()
        if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", lowered)
    }
    return sorted(found)


async def _event_sources(wellbore_id: str, question: str) -> list[dict[str, Any]]:
    formations = await formations_in(question)
    events = await db.call_fn(
        "events_for_offsets",
        p_wellbore=wellbore_id,
        p_radius_m=EVENT_RADIUS_M,
        p_formations=formations or None,
        p_limit=EVENT_LIMIT,
    )
    return [e for e in events if e.get("doc_id")]  # an event with no document cannot be cited


async def _doc_titles(doc_ids: list[str]) -> dict[str, str]:
    if not doc_ids:
        return {}
    rows = await db.fetch_all(
        "select id, title from documents where id::text = any(%(ids)s::text[])", {"ids": doc_ids}
    )
    return {str(r["id"]): r["title"] for r in rows}


def build_sources(
    chunks: list[dict[str, Any]], events: list[dict[str, Any]], titles: dict[str, str], question: str
) -> list[Source]:
    sources: list[Source] = []
    for row in chunks:
        text = (row["text"] or "")[:PROMPT_CHUNK_CHARS]
        sources.append(
            Source(
                n=len(sources) + 1,
                chunk_id=str(row["chunk_id"]),
                doc_id=str(row["doc_id"]),
                doc_title=row["doc_title"],
                page=row["page"],
                text=text,
                snippet=snippet_for(text, question),
            )
        )
    for event in events:
        doc_id = str(event["doc_id"])
        line = event_line(event)
        sources.append(
            Source(
                n=len(sources) + 1,
                chunk_id=None,
                doc_id=doc_id,
                doc_title=titles.get(doc_id, "Document"),
                page=event.get("page"),
                text=line,
                snippet=line[:SNIPPET_CHARS],
            )
        )
    return sources


def _citation(source: Source) -> dict[str, Any]:
    return {
        "n": source.n,
        "chunk_id": source.chunk_id,
        "doc_id": source.doc_id,
        "doc_title": source.doc_title,
        "page": source.page,
        "snippet": source.snippet,
    }


def build_user_prompt(question: str, sources: list[Source]) -> str:
    blocks = [
        f"[{s.n}] ({s.doc_title}" + (f", page {s.page}" if s.page else "") + f")\n{s.text}" for s in sources
    ]
    return "Sources:\n\n" + "\n\n".join(blocks) + f"\n\nQuestion: {question}"


# ---------------------------------------------------------------- citations


_CITATION_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?!\[\d)")


def clean_citations(answer: str, valid: set[int]) -> str:
    """Keep only citations that point at a real source; "[1, 9]" becomes "[1]"."""

    def keep(match: re.Match) -> str:
        numbers = [int(n) for n in re.split(r"\s*,\s*", match.group(1))]
        return "".join(f"[{n}]" for n in numbers if n in valid)

    cleaned = _CITATION_RE.sub(keep, answer)
    return re.sub(r"[ \t]+([.,;])", r"\1", re.sub(r"[ \t]{2,}", " ", cleaned))


def cited_numbers(text: str) -> list[int]:
    return [int(n) for group in _CITATION_RE.findall(text) for n in re.split(r"\s*,\s*", group)]


# ---------------------------------------------------------------- number check

_UNIT_ALIASES = {
    "m³": "m3", "metres": "m", "metre": "m", "meters": "m", "meter": "m",
    "hrs": "h", "hr": "h", "hours": "h", "hour": "h", "day": "days", "°c": "degc",
}  # fmt: skip
_UNITS = sorted(
    ["m3/h", "l/min", "kn.m", "m3", "m³", "kn", "bar", "sg", "mm", "cm", "m", "ft", "psi", "ppg",
     "metres", "metre", "meters", "meter", "hours", "hour", "hrs", "hr", "h", "min", "days", "day",
     "%", "°c", "degc"],
    key=len,
    reverse=True,
)  # fmt: skip
_NUMBER = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?"
_QUANTITY_RE = re.compile(
    rf"(?<![\w.,])({_NUMBER})\s*({'|'.join(re.escape(u) for u in _UNITS)})(?![A-Za-z0-9])", re.IGNORECASE
)


def _parse_number(raw: str) -> float:
    if re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", raw):
        return float(raw.replace(",", ""))
    return float(raw.replace(",", "."))


def quantities(text: str) -> set[tuple[float, str]]:
    """(value, normalised unit) for every number+unit in `text`."""
    found = set()
    for number, unit in _QUANTITY_RE.findall(text):
        unit = unit.lower()
        found.add((round(_parse_number(number), 4), _UNIT_ALIASES.get(unit, unit)))
    return found


def split_sentences(answer: str) -> list[list[str]]:
    """Lines of the answer, each split into sentences (bullets stay on their own line)."""
    return [_SENTENCE_SPLIT_RE.split(line.strip()) for line in answer.splitlines() if line.strip()]


def check_numbers(answer: str, sources: dict[int, str]) -> tuple[str, bool]:
    """Remove every sentence whose number+unit is in none of the sources it cites.

    A sentence with its own valid citations is checked against those; one without
    is checked against everything the answer cites. Returns (answer, removed_any).
    """
    answer_cited = {n for n in cited_numbers(answer) if n in sources}
    removed = False
    lines = []
    for sentences in split_sentences(answer):
        kept = []
        for sentence in sentences:
            own = {n for n in cited_numbers(sentence) if n in sources} or answer_cited
            allowed: set[tuple[float, str]] = set()
            for n in own:
                allowed |= quantities(sources[n])
            if quantities(sentence) <= allowed:
                kept.append(sentence)
            else:
                removed = True
        if kept:
            lines.append(" ".join(kept))
    return "\n".join(lines), removed


# ---------------------------------------------------------------- ask


def _insufficient(sources: list[Source], meta: Any = None) -> dict[str, Any]:
    closest = sources[:CLOSEST_RECORDS]
    bullets = "\n".join(f"- {s.snippet} [{s.n}]" for s in closest)
    return {
        "answer_md": f"{INSUFFICIENT_HEAD}\n{bullets}" if bullets else INSUFFICIENT_HEAD,
        "evidence": "insufficient",
        "citations": [_citation(s) for s in closest],
        "provider": meta.provider if meta else None,
        "model": meta.model if meta else None,
        "cached": meta.cached if meta else False,
    }


async def ask(question: str, filters: Filters, wellbore_id: str | None) -> dict[str, Any]:
    started = time.monotonic()
    chunks = await hybrid(question, filters, ASK_TOP_K)
    events = await _event_sources(wellbore_id, question) if wellbore_id else []
    titles = await _doc_titles(sorted({str(e["doc_id"]) for e in events}))
    sources = build_sources(chunks, events, titles, question)

    best_rrf = max((float(c["score"]) for c in chunks), default=0.0)
    if len(sources) < MIN_SOURCES or best_rrf < MIN_RRF:
        logger.info("ask_insufficient sources=%d best_rrf=%.4f", len(sources), best_rrf)
        return _insufficient(sources)

    system = PROMPT_PATH.read_text(encoding="utf-8")
    raw, meta = await complete_text(system, build_user_prompt(question, sources))

    by_n = {s.n: s for s in sources}
    answer = clean_citations(raw, set(by_n))
    answer, removed = check_numbers(answer, {n: s.text for n, s in by_n.items()})
    if not answer.strip():  # every sentence was unsupported: nothing left to show
        return _insufficient(sources, meta)
    if removed:
        answer = f"{answer}\n\n{REMOVED_NOTE}"

    cited = sorted({n for n in cited_numbers(answer) if n in by_n})
    logger.info(
        "ask_done latency_ms=%.0f cached=%s sources=%d cited=%d removed=%s",
        (time.monotonic() - started) * 1000, meta.cached, len(sources), len(cited), removed,
    )  # fmt: skip
    return {
        "answer_md": answer,
        "evidence": "sufficient",
        "citations": [_citation(by_n[n]) for n in cited],
        "provider": meta.provider,
        "model": meta.model,
        "cached": meta.cached,
    }

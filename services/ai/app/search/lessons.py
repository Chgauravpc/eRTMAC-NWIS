"""Lessons builder (BE-11, contract §6 lessons).

Groups reviewed-or-pending (non-rejected) events by (formation, event_type); every
group with at least MIN_EVENTS events from at least MIN_WELLS wells becomes one
`lessons` row, summarised by the LLM from the events' own words.

    python -m app.search.lessons --rebuild

`lessons` has no unique key on (formation, event_type), so the "upsert" is a
look-up followed by an update or an insert. Groups that no longer qualify (events
rejected or removed) have their lesson deleted; a group whose LLM call fails keeps
its old lesson. Events with no formation are not grouped.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app import db
from app.config import get_settings
from app.errors import NwisError
from app.llm.client import complete_json
from app.logging import configure_logging, get_logger

logger = get_logger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "llm" / "prompts" / "lesson.md"

MIN_EVENTS = 2
MIN_WELLS = 2
MAX_EVENTS = 40
FIELD_CHARS = 300  # per description/cause/action/outcome in the prompt
PROMPT_BUDGET_CHARS = 20000  # stays under the LLM client's input cap

GroupKey = tuple[str, str]  # (formation, event_type)


class LessonOut(BaseModel):
    title: str
    problem: str
    cause: str | None = None
    mitigation: str | None = None
    outcome: str | None = None
    successful_event_ids: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- grouping


def _recent_key(event: dict[str, Any]) -> tuple[str, str]:
    date, created = event.get("event_date"), event.get("created_at")
    return (date.isoformat() if date else "", created.isoformat() if created else "")


def group_events(events: list[dict[str, Any]]) -> dict[GroupKey, list[dict[str, Any]]]:
    """Qualifying groups only, each list most recent first (not yet capped)."""
    groups: dict[GroupKey, list[dict[str, Any]]] = {}
    for event in events:
        if event.get("formation"):
            groups.setdefault((event["formation"], str(event["event_type"])), []).append(event)
    return {
        key: sorted(rows, key=_recent_key, reverse=True)
        for key, rows in groups.items()
        if len(rows) >= MIN_EVENTS and len({r["well_id"] for r in rows}) >= MIN_WELLS
    }


def _clip(text: str | None) -> str | None:
    text = " ".join((text or "").split())
    return text[:FIELD_CHARS] if text else None


def event_line(event: dict[str, Any]) -> str:
    parts = [f"Description: {_clip(event['description'])}"]
    for label, key in (("Cause", "cause"), ("Action", "action"), ("Outcome", "outcome")):
        if _clip(event.get(key)):
            parts.append(f"{label}: {_clip(event[key])}")
    return f"[{event['id']}] " + " | ".join(parts)


def select_events(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """The (at most MAX_EVENTS, within budget) most recent events and their prompt text."""
    chosen, lines, size = [], [], 0
    for event in rows[:MAX_EVENTS]:
        line = event_line(event)
        if chosen and size + len(line) > PROMPT_BUDGET_CHARS:
            break
        chosen.append(event)
        lines.append(line)
        size += len(line) + 1
    return chosen, "\n".join(lines)


def build_user_prompt(key: GroupKey, events_text: str) -> str:
    return f"Formation: {key[0]}\nEvent type: {key[1]}\n\nEvents:\n{events_text}"


def success_stats(events: list[dict[str, Any]], returned_ids: list[str]) -> tuple[list[str], float]:
    """Returned ids restricted to the input events (unknown ones dropped), and the success rate."""
    valid = {str(e["id"]) for e in events}
    kept = list(dict.fromkeys(i for i in returned_ids if i in valid))
    if len(kept) != len(set(returned_ids)):
        logger.warning("lesson_unknown_event_ids dropped=%d", len(set(returned_ids)) - len(kept))
    return kept, len(kept) / len(events)


# ---------------------------------------------------------------- database


async def load_events() -> list[dict[str, Any]]:
    return await db.fetch_all(
        """
        select e.id, e.formation, e.event_type::text as event_type, e.description, e.cause, e.action,
               e.outcome, e.event_date, e.created_at, wb.well_id
        from events e
        join wellbores wb on wb.id = e.wellbore_id
        where e.review_status <> 'rejected' and e.formation is not null
        """
    )


async def upsert_lesson(key: GroupKey, lesson: LessonOut, events: list[dict[str, Any]]) -> str:
    kept, rate = success_stats(events, lesson.successful_event_ids)
    params = {
        "formation": key[0],
        "event_type": key[1],
        "title": lesson.title.strip(),
        "problem": lesson.problem.strip(),
        "cause": lesson.cause,
        "mitigation": lesson.mitigation,
        "outcome": lesson.outcome,
        "event_ids": [UUID(str(e["id"])) for e in events],
        "well_count": len({e["well_id"] for e in events}),
        "success_rate": rate,
    }
    existing = await db.fetch_one(
        "select id from lessons where formation = %(formation)s and event_type = %(event_type)s::event_type "
        "order by updated_at desc limit 1",
        params,
    )
    if existing:
        params["id"] = existing["id"]
        await db.execute(
            """
            update lessons set title = %(title)s, problem = %(problem)s, cause = %(cause)s,
                   mitigation = %(mitigation)s, outcome = %(outcome)s, event_ids = %(event_ids)s::uuid[],
                   well_count = %(well_count)s, success_rate = %(success_rate)s, updated_at = now()
            where id = %(id)s
            """,
            params,
        )
        return "updated"
    await db.execute(
        """
        insert into lessons (formation, event_type, title, problem, cause, mitigation, outcome,
                             event_ids, well_count, success_rate)
        values (%(formation)s, %(event_type)s::event_type, %(title)s, %(problem)s, %(cause)s,
                %(mitigation)s, %(outcome)s, %(event_ids)s::uuid[], %(well_count)s, %(success_rate)s)
        """,
        params,
    )
    return "created"


async def delete_stale(qualifying: set[GroupKey]) -> int:
    rows = await db.fetch_all("select id, formation, event_type::text as event_type from lessons")
    stale = [r["id"] for r in rows if (r["formation"], r["event_type"]) not in qualifying]
    if stale:
        await db.execute("delete from lessons where id = any(%(ids)s)", {"ids": stale})
    return len(stale)


# ---------------------------------------------------------------- rebuild


async def build_group(key: GroupKey, rows: list[dict[str, Any]], system: str) -> str:
    events, events_text = select_events(rows)
    lesson, _meta = await complete_json(system, build_user_prompt(key, events_text), LessonOut)
    return await upsert_lesson(key, lesson, events)


async def rebuild() -> Counter:
    """Rebuild every lesson. Counter keys: groups, created, updated, failed, deleted."""
    groups = group_events(await load_events())
    system = PROMPT_PATH.read_text(encoding="utf-8")
    stats: Counter = Counter(groups=len(groups))
    for key, rows in groups.items():
        try:
            stats[await build_group(key, rows, system)] += 1
        except NwisError:
            logger.exception("lesson_failed formation=%s event_type=%s", *key)
            stats["failed"] += 1
    stats["deleted"] = await delete_stale(set(groups))
    logger.info("lessons_rebuilt %s", dict(stats))
    return stats


async def _main() -> None:
    try:
        stats = await rebuild()
    finally:
        await db.close_pool()
    print(
        f"{stats['groups']} group(s): {stats['created']} created, {stats['updated']} updated, "
        f"{stats['failed']} failed, {stats['deleted']} deleted"
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.search.lessons", description="Build lessons from events.")
    parser.add_argument("--rebuild", action="store_true", required=True, help="rebuild every lesson")
    parser.parse_args(argv)
    configure_logging(get_settings().LOG_LEVEL)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_main())


if __name__ == "__main__":
    main()

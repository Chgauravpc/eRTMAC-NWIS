"""Alert recommendation from lessons (BE-19).

Top two lessons for the (formation, event types of the risk type) by success rate; the LLM
phrases them in at most two sentences using only their mitigation text. If the LLM fails, or
writes a number or unit that is not in the mitigation texts, a plain template is used instead.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app import db
from app.llm.client import complete_text
from app.logging import get_logger
from app.models.enums import EVENT_TO_RISK
from app.search.rag import quantities

logger = get_logger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "llm" / "prompts" / "recommend.md"
TOP_LESSONS = 2
MAX_SENTENCES = 2
NO_MITIGATION = "No recorded mitigation for this formation; review offset evidence."
_PERCENT_RE = re.compile(r"\d+(?:\.\d+)?\s*%")


def event_types_for(risk_type: str) -> list[str]:
    return [et.value for et, rt in EVENT_TO_RISK.items() if rt is not None and rt.value == risk_type]


async def top_lessons(formation: str | None, risk_type: str) -> list[dict[str, Any]]:
    if not formation:
        return []
    rows = await db.fetch_all(
        """
        select id, title, mitigation, success_rate
        from lessons
        where formation = %(formation)s and event_type::text = any(%(types)s::text[]) and mitigation is not null
        order by success_rate desc nulls last, well_count desc
        limit %(limit)s
        """,
        {"formation": formation, "types": event_types_for(risk_type), "limit": TOP_LESSONS},
    )
    return [
        {"id": str(r["id"]), "title": r["title"], "mitigation": r["mitigation"], "success_rate": r["success_rate"]}
        for r in rows
    ]


def template(lessons: list[dict[str, Any]]) -> str:
    if not lessons:
        return NO_MITIGATION
    return f"Offsets report: {lessons[0]['mitigation'].strip().rstrip('.')}."


def _prompt(formation: str | None, risk_type: str, lessons: list[dict[str, Any]]) -> str:
    blocks = []
    for number, lesson in enumerate(lessons, start=1):
        rate = lesson["success_rate"]
        share = f" | worked in {rate * 100:.0f}% of cases" if rate is not None else ""
        blocks.append(f"Lesson {number}: {lesson['title']}{share}\nMitigation: {lesson['mitigation']}")
    return f"Formation: {formation}\nRisk: {risk_type}\n\n" + "\n\n".join(blocks)


def _is_grounded(text: str, lessons: list[dict[str, Any]]) -> bool:
    """Every number+unit in `text` appears in a mitigation (percentages may come from success_rate)."""
    allowed = set()
    for lesson in lessons:
        allowed |= quantities(lesson["mitigation"])
    shares = {f"{lesson['success_rate'] * 100:.0f}" for lesson in lessons if lesson["success_rate"] is not None}
    percents_ok = all(re.sub(r"\s*%", "", p).split(".")[0] in shares for p in _PERCENT_RE.findall(text))
    unit_numbers = {q for q in quantities(text) if q[1] != "%"}
    return unit_numbers <= allowed and percents_ok


def _sentences(text: str) -> int:
    return len([s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s])


async def recommend(formation: str | None, risk_type: str) -> tuple[str, list[dict[str, Any]]]:
    """(recommendation text, the lessons used as evidence)."""
    lessons = await top_lessons(formation, risk_type)
    if not lessons:
        return NO_MITIGATION, []
    try:
        text, _meta = await complete_text(
            PROMPT_PATH.read_text(encoding="utf-8"), _prompt(formation, risk_type, lessons), max_tokens=200
        )
    except Exception:  # noqa: BLE001 - any LLM failure falls back to the template
        logger.warning("recommend_llm_failed formation=%s risk_type=%s", formation, risk_type)
        return template(lessons), lessons
    text = " ".join(text.split())
    if not text or _sentences(text) > MAX_SENTENCES or not _is_grounded(text, lessons):
        logger.warning("recommend_llm_rejected formation=%s risk_type=%s", formation, risk_type)
        return template(lessons), lessons
    return text, lessons

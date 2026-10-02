"""BE-11: lessons builder (DB and LLM mocked)."""

from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from app import db
from app.errors import NwisError
from app.llm.client import LlmMeta
from app.search import lessons
from app.search.lessons import LessonOut

WELL_A, WELL_B = str(uuid4()), str(uuid4())


def ev(formation="Tipam", event_type="loss_partial", well=WELL_A, day=1, **over):
    row = {
        "id": str(uuid4()), "formation": formation, "event_type": event_type, "well_id": well,
        "description": "Partial losses", "cause": "Fractured sand", "action": "Pumped LCM pill",
        "outcome": "Losses cured", "event_date": date(2020, 1, day),
        "created_at": datetime(2020, 1, day, tzinfo=timezone.utc),
    }  # fmt: skip
    row.update(over)
    return row


# ---------------------------------------------------------------- grouping


def test_group_needs_two_events_from_two_wells():
    events = [
        ev(well=WELL_A), ev(well=WELL_B),  # qualifies
        ev("Barail", "stuck_pipe_mech", well=WELL_A), ev("Barail", "stuck_pipe_mech", well=WELL_A),  # one well
        ev("Girujan", "kick"),  # one event
        ev(None, "loss_partial", well=WELL_B),  # no formation: not grouped
    ]  # fmt: skip
    assert list(lessons.group_events(events)) == [("Tipam", "loss_partial")]


def test_group_is_most_recent_first_and_capped_at_forty():
    events = [ev(well=WELL_A if i % 2 else WELL_B, day=(i % 28) + 1, created_at=None) for i in range(50)]
    rows = lessons.group_events(events)[("Tipam", "loss_partial")]
    assert [r["event_date"] for r in rows] == sorted((r["event_date"] for r in rows), reverse=True)
    chosen, text = lessons.select_events(rows)
    assert len(chosen) == lessons.MAX_EVENTS and text.count("\n") == lessons.MAX_EVENTS - 1


def test_select_events_stops_at_prompt_budget():
    big = "x" * lessons.FIELD_CHARS
    rows = [ev(description=big, cause=big, action=big, outcome=big) for _ in range(40)]
    chosen, text = lessons.select_events(rows)
    assert 0 < len(chosen) < 40 and len(text) <= lessons.PROMPT_BUDGET_CHARS + 100


def test_event_line_is_prefixed_with_id_and_skips_missing_fields():
    event = ev(cause=None, outcome=None)
    line = lessons.event_line(event)
    assert line.startswith(f"[{event['id']}] Description: Partial losses")
    assert "Cause" not in line and "Outcome" not in line and "Action: Pumped LCM pill" in line


def test_success_stats_drops_unknown_ids_and_computes_rate():
    events = [ev(), ev(), ev(), ev()]
    ids = [str(events[0]["id"]), str(events[1]["id"]), str(events[1]["id"]), "made-up-id"]
    kept, rate = lessons.success_stats(events, ids)
    assert kept == [str(events[0]["id"]), str(events[1]["id"])] and rate == 0.5


# ---------------------------------------------------------------- rebuild


class FakeDb:
    def __init__(self, events, existing=None):
        self.events, self.existing, self.writes = events, existing or [], []

    async def fetch_all(self, sql, params=None):
        if "from events e" in sql:
            return self.events
        if "from lessons" in sql:
            return self.existing
        raise AssertionError(sql)

    async def fetch_one(self, sql, params=None):
        assert "from lessons where formation" in sql
        match = [r for r in self.existing if (r["formation"], r["event_type"]) == (params["formation"], params["event_type"])]
        return {"id": match[0]["id"]} if match else None

    async def execute(self, sql, params=None):
        self.writes.append((sql.split()[0].lower(), params))


@pytest.fixture
def llm(monkeypatch):
    calls = {"n": [], "reply": None, "fail": set()}

    async def complete_json(system, user, schema, **kw):
        calls["n"].append((system, user, schema))
        if any(f in user for f in calls["fail"]):
            raise NwisError("NWIS_UPSTREAM", "down", 502)
        return calls["reply"](user), LlmMeta("groq", "m", False, 1.0, len(user))

    monkeypatch.setattr(lessons, "complete_json", complete_json)
    return calls


def install(monkeypatch, fake):
    for name in ("fetch_all", "fetch_one", "execute"):
        monkeypatch.setattr(db, name, getattr(fake, name))


def ids_in(user):
    import re

    return re.findall(r"^\[([0-9a-f-]{36})\]", user, re.MULTILINE)


@pytest.mark.asyncio
async def test_rebuild_creates_a_lesson_per_group_with_validated_ids(monkeypatch, llm):
    events = [ev(well=WELL_A, day=1), ev(well=WELL_B, day=2), ev(well=WELL_B, day=3, outcome="Losses continued")]
    fake = FakeDb(events)
    install(monkeypatch, fake)

    def reply(user):
        first, second, _ = ids_in(user)
        return LessonOut(
            title="Partial losses in Tipam", problem="Losses.", mitigation="LCM pills.",
            successful_event_ids=[first, second, "not-a-real-id"],
        )  # fmt: skip

    llm["reply"] = reply
    stats = await lessons.rebuild()

    assert stats["groups"] == 1 and stats["created"] == 1
    system, user, schema = llm["n"][0]
    assert "ONLY what the events say" in system and schema is LessonOut
    assert user.startswith("Formation: Tipam\nEvent type: loss_partial")
    op, params = fake.writes[0]
    assert op == "insert" and params["well_count"] == 2
    assert params["success_rate"] == pytest.approx(2 / 3)
    assert sorted(map(str, params["event_ids"])) == sorted(str(e["id"]) for e in events)


@pytest.mark.asyncio
async def test_rebuild_updates_existing_lesson_and_deletes_stale_ones(monkeypatch, llm):
    lesson_id, stale_id = uuid4(), uuid4()
    fake = FakeDb(
        [ev(well=WELL_A), ev(well=WELL_B)],
        existing=[
            {"id": lesson_id, "formation": "Tipam", "event_type": "loss_partial"},
            {"id": stale_id, "formation": "Barail", "event_type": "kick"},
        ],
    )
    install(monkeypatch, fake)
    llm["reply"] = lambda user: LessonOut(title="T", problem="P")
    stats = await lessons.rebuild()

    assert stats["updated"] == 1 and stats["created"] == 0 and stats["deleted"] == 1
    assert [op for op, _ in fake.writes] == ["update", "delete"]
    assert fake.writes[0][1]["id"] == lesson_id and fake.writes[0][1]["success_rate"] == 0.0
    assert fake.writes[1][1]["ids"] == [stale_id]


@pytest.mark.asyncio
async def test_failed_group_is_counted_and_keeps_its_old_lesson(monkeypatch, llm):
    events = [ev("Tipam", well=WELL_A), ev("Tipam", well=WELL_B), ev("Barail", "kick", WELL_A), ev("Barail", "kick", WELL_B)]
    fake = FakeDb(events, existing=[{"id": uuid4(), "formation": "Barail", "event_type": "kick"}])
    install(monkeypatch, fake)
    llm["fail"] = {"Formation: Barail"}
    llm["reply"] = lambda user: LessonOut(title="T", problem="P")
    stats = await lessons.rebuild()

    assert stats["failed"] == 1 and stats["created"] == 1 and stats["deleted"] == 0
    assert [op for op, _ in fake.writes] == ["insert"]


@pytest.mark.asyncio
async def test_no_qualifying_groups_makes_no_llm_calls(monkeypatch, llm):
    install(monkeypatch, FakeDb([ev(well=WELL_A), ev(well=WELL_A)]))
    stats = await lessons.rebuild()
    assert stats["groups"] == 0 and llm["n"] == []

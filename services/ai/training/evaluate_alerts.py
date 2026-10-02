"""Alert evaluation by replay (BE-21): did the system warn before the hazards that really happen?

    python -m training.evaluate_alerts [--reset] [--limit N] [--start-md M]

For every synthetic *drilling* well that has a truth file (db/data/synth_truth/<well_name>.json, the hidden future
events DB-09 withheld from `events`), the stream is replayed to TD with a fast clock through the real risk
scoring and alert engine, and each alert is recorded together with the bit depth at the moment it was raised.
Then, per truth event (same risk type):
  * hit  = an alert of that risk type whose zone covers the event depth was raised while the bit was above it;
  * lead = event depth - bit depth at the first such alert;
and per alert:
  * false = its zone covers no truth event of its risk type.
Reported: hit rate, median lead (m), false alerts per 1,000 m drilled.

The replay WRITES `alerts`, `risk_scores` and `stream_state` rows of the wells it runs. A well that already has
alerts is skipped unless --reset, which deletes that well's alerts and risk_scores first.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from app import db
from app.models.enums import EVENT_TO_RISK, EventType
from app.stream.replay import Clock, ReplayRegistry
from training import report

REPLAY_SPEED = 600


# ---------------------------------------------------------------- scoring (pure)


@dataclass
class TruthEvent:
    risk_type: str
    event_type: str
    md_from_m: float
    md_to_m: float


def load_truth(path: Path) -> list[TruthEvent]:
    """Hidden events with a risk type (events such as fishing have none and cannot be warned about)."""
    events = []
    for item in json.loads(path.read_text(encoding="utf-8")):
        try:
            risk = EVENT_TO_RISK.get(EventType(item["event_type"]))
        except ValueError:
            continue
        if risk is not None:
            md_from = float(item["md_from_m"])
            events.append(TruthEvent(risk.value, item["event_type"], md_from, float(item.get("md_to_m") or md_from)))
    return events


def covers(alert: dict[str, Any], event: TruthEvent) -> bool:
    """The alert zone overlaps the event interval."""
    return alert["zone_md_from_m"] <= event.md_to_m and alert["zone_md_to_m"] >= event.md_from_m


@dataclass
class WellScore:
    events: int = 0
    hits: int = 0
    leads_m: list[float] = field(default_factory=list)
    alerts: int = 0
    false_alerts: int = 0
    drilled_m: float = 0.0


def score_well(truth: list[TruthEvent], alerts: list[dict[str, Any]], start_md_m: float, td_md_m: float) -> WellScore:
    """`alerts`: one per dedup key, with risk_type, zone_md_from_m, zone_md_to_m and bit_md_m (the bit when it was raised)."""
    future = [t for t in truth if t.md_from_m > start_md_m]
    score = WellScore(events=len(future), alerts=len(alerts), drilled_m=max(0.0, td_md_m - start_md_m))
    for event in future:
        raised_early = [
            a["bit_md_m"] for a in alerts
            if a["risk_type"] == event.risk_type and covers(a, event) and a["bit_md_m"] < event.md_from_m
        ]  # fmt: skip
        if raised_early:
            score.hits += 1
            score.leads_m.append(event.md_from_m - min(raised_early))
    score.false_alerts = sum(
        1 for a in alerts if not any(t.risk_type == a["risk_type"] and covers(a, t) for t in truth)
    )
    return score


def combine(scores: list[WellScore]) -> dict[str, Any]:
    events = sum(s.events for s in scores)
    leads = [lead for s in scores for lead in s.leads_m]
    drilled_km = sum(s.drilled_m for s in scores) / 1000.0
    return {
        "wells": len(scores),
        "events": events,
        "hits": sum(s.hits for s in scores),
        "hit_rate": sum(s.hits for s in scores) / events if events else None,
        "median_lead_m": statistics.median(leads) if leads else None,
        "alerts": sum(s.alerts for s in scores),
        "false_alerts": sum(s.false_alerts for s in scores),
        "drilled_km": drilled_km,
        "false_per_1000m": sum(s.false_alerts for s in scores) / drilled_km if drilled_km else None,
    }


def render_markdown(per_well: dict[str, WellScore], total: dict[str, Any]) -> str:
    rows = []
    for name, s in per_well.items():
        median = statistics.median(s.leads_m) if s.leads_m else None
        rows.append([name, s.events, s.hits, report.fmt(s.hits / s.events if s.events else None, 2), report.fmt(median, 0), s.alerts, s.false_alerts, f"{s.drilled_m:.0f}"])
    table = report.markdown_table(["Well", "Hidden events", "Warned", "Hit rate", "Median lead (m)", "Alerts", "False alerts", "Drilled (m)"], rows)
    summary = report.markdown_table(
        ["Measure", "Value"],
        [
            ["Wells replayed", total["wells"]],
            ["Hidden events warned about before the bit reached them", f"{total['hits']} of {total['events']} ({report.fmt(total['hit_rate'], 2)})"],
            ["Median lead distance (m)", report.fmt(total["median_lead_m"], 0)],
            ["False alerts per 1,000 m", report.fmt(total["false_per_1000m"], 2)],
        ],
    )  # fmt: skip
    return (
        "Each synthetic drilling well was replayed to TD through the real scoring and alert engine. A hit is an alert of the "
        "same risk type whose zone covers the event depth, raised while the bit was above it; a false alert covers no hidden "
        f"event of its type.\n\n{summary}\n\n{table}"
    )


# ---------------------------------------------------------------- the replay


class FastClock(Clock):
    """Time that jumps instead of waiting, so a whole well replays in seconds."""

    def __init__(self) -> None:
        self.t = datetime.now(timezone.utc)

    def now(self) -> datetime:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += timedelta(seconds=seconds)
        await asyncio.sleep(0)


ReadAlerts = Callable[[str], Awaitable[list[dict[str, Any]]]]


async def read_alerts(wellbore_id: str) -> list[dict[str, Any]]:
    return await db.fetch_all(
        "select dedup_key, kind::text as kind, risk_type::text as risk_type, severity::text as severity, "
        "zone_md_from_m, zone_md_to_m from alerts where wellbore_id = %(id)s and kind <> 'system'",
        {"id": wellbore_id},
    )


class RecordingRegistry(ReplayRegistry):
    """A replay that notes the bit depth at which each alert first appears."""

    def __init__(self, alerts_reader: ReadAlerts = read_alerts, clock: Clock | None = None):
        super().__init__(clock or FastClock())
        self.first_seen: dict[str, dict[str, Any]] = {}
        self._alerts_reader = alerts_reader

    async def _risk_hook(self, wellbore_id: str, bank: Any) -> None:
        await super()._risk_hook(wellbore_id, bank)
        if not bank.samples:
            return
        bit = bank.samples[-1]["md_m"]
        for alert in await self._alerts_reader(wellbore_id):
            self.first_seen.setdefault(alert["dedup_key"], {**alert, "bit_md_m": bit})


async def replay_well(wellbore_id: str, start_md_m: float | None, alerts_reader: ReadAlerts = read_alerts) -> list[dict[str, Any]]:
    registry = RecordingRegistry(alerts_reader)
    await registry.start(wellbore_id, "synthetic", REPLAY_SPEED, start_md_m)
    task = registry.tasks.get(wellbore_id)
    if task is not None:
        await task
    return list(registry.first_seen.values())


async def drilling_wells() -> list[dict[str, Any]]:
    return await db.fetch_all(
        """
        select wb.id as wellbore_id, w.name, (select max(md_m) from depth_series d where d.wellbore_id = wb.id) as td_md_m
        from wells w join wellbores wb on wb.well_id = w.id and wb.is_primary
        where w.status = 'drilling' and w.provenance = 'synthetic' order by w.name
        """
    )


async def reset_well(wellbore_id: str) -> None:
    await db.execute("delete from alerts where wellbore_id = %(id)s", {"id": wellbore_id})
    await db.execute("delete from risk_scores where wellbore_id = %(id)s", {"id": wellbore_id})


async def run(reset: bool, limit: int | None, start_md_m: float | None, truth_dir: Path | None = None) -> dict[str, WellScore]:
    from app.risk import fuse

    truth_dir = truth_dir or report.SYNTH_TRUTH_DIR

    scores: dict[str, WellScore] = {}
    for well in (await drilling_wells())[:limit]:
        truth_file = truth_dir / f"{well['name']}.json"
        if not truth_file.exists():
            print(f"skip {well['name']}: no truth file {truth_file}")
            continue
        wellbore_id = str(well["wellbore_id"])
        if await read_alerts(wellbore_id) and not reset:
            print(f"skip {well['name']}: it already has alerts (use --reset to delete them and replay)")
            continue
        if reset:
            await reset_well(wellbore_id)
        start = start_md_m if start_md_m is not None else await fuse.bit_depth(wellbore_id)
        print(f"replaying {well['name']} from {start:.0f} m to {well['td_md_m']:.0f} m ...")
        alerts = await replay_well(wellbore_id, start)
        scores[well["name"]] = score_well(load_truth(truth_file), alerts, start, float(well["td_md_m"]))
    return scores


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m training.evaluate_alerts", description=__doc__.split("\n\n")[0])
    parser.add_argument("--reset", action="store_true", help="delete each well's alerts and risk_scores before replaying it")
    parser.add_argument("--limit", type=int, help="only the first N wells")
    parser.add_argument("--start-md", type=float, help="replay from this depth (default: the current bit depth)")
    parser.add_argument("--no-write", action="store_true", help="print the section instead of appending it to docs/eval_results.md")
    args = parser.parse_args(argv)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def go() -> dict[str, WellScore]:
        try:
            return await run(args.reset, args.limit, args.start_md)
        finally:
            await db.close_pool()

    per_well = asyncio.run(go())
    if not per_well:
        print("no well was replayed", file=sys.stderr)
        return 1
    body = render_markdown(per_well, combine(list(per_well.values())))
    if args.no_write:
        print(body)
    else:
        report.append_section("Alert hit rate, lead distance and false alerts", body)
        print(f"appended to {report.EVAL_RESULTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Stream replay (BE-18, contract §6 stream_state / depth_series, §9.2 stream endpoints, §11.7).

Replays a wellbore's stored `depth_series` rows as if they were arriving live. One asyncio
task per wellbore. Depth rows are *revealed* only by moving `stream_state.bit_md_m` (RLS then
shows them to users); nothing is copied anywhere.

For each sample the simulated time is the depth step divided by ROP (or the difference of the
samples' own `t`); the real wait is that divided by the speed. Samples are batched so at most
UPDATE_HZ updates per second reach the database. Each published batch:
  1. updates stream_state (bit, hole, latest channel values, last_sample_at, status live),
  2. feeds the wellbore's DetectorBank,
  3. every RISK_EVERY_M of new depth, or when the set of fired detectors changes, recomputes the
     risk scores and hands them to the alert engine (both imported lazily: BE-19 may not exist yet).
`drop` swallows samples and updates until `dropping_until`, so the alert engine sees the stream
go stale and then lost.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Jsonb

from app import db
from app.errors import NwisError
from app.geo.correlation import ALLOWED_CHANNELS
from app.logging import get_logger
from app.risk import fuse, l3

logger = get_logger(__name__)

UPDATE_HZ = 4  # at most this many stream_state updates per second
UPDATE_INTERVAL_S = 1.0 / UPDATE_HZ
RISK_EVERY_M = 5.0  # recompute risk after this much new depth
MIN_ROP_M_H = 1.0  # a lower (or missing) ROP is replaced by this when deriving sample time
MAX_SAMPLE_S = 3600.0  # simulated time of one sample is capped at this
MAX_SPEED = 600
MAX_DROP_S = 600
SOURCES = ("volve", "synthetic", "witsml")
SAMPLE_COLUMNS = ", ".join(("md_m", "t", *ALLOWED_CHANNELS))


class Clock:
    """Wall clock and sleep; tests replace it with a fake."""

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


@dataclass
class ReplayState:
    source: str
    speed: int
    dropping_until: datetime | None = None


def sample_duration_s(previous: dict[str, Any] | None, previous_md: float, sample: dict[str, Any]) -> float:
    """Simulated seconds between the previous sample (or the start depth) and this one."""
    if previous is not None and previous.get("t") is not None and sample.get("t") is not None:
        gap = (sample["t"] - previous["t"]).total_seconds()
        if gap > 0:
            return min(gap, MAX_SAMPLE_S)
    rop = sample.get("rop_m_h")
    rop = rop if rop is not None and rop > MIN_ROP_M_H else MIN_ROP_M_H
    return min(abs(sample["md_m"] - previous_md) / rop * 3600.0, MAX_SAMPLE_S)


def latest_channels(sample: dict[str, Any]) -> dict[str, Any]:
    """stream_state.latest: depth_series column names -> values (no nulls, no timestamp)."""
    return {k: v for k, v in sample.items() if k != "t" and v is not None}


def _utc_z(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ReplayRegistry:
    def __init__(self, clock: Clock | None = None):
        self.clock = clock or Clock()
        self.tasks: dict[str, asyncio.Task] = {}
        self.state: dict[str, ReplayState] = {}

    # ---------------------------------------------------------- control

    def _running(self, wellbore_id: str) -> ReplayState:
        task = self.tasks.get(wellbore_id)
        if task is None or task.done() or wellbore_id not in self.state:
            raise NwisError("NWIS_BAD_STATE", "No replay is running for this wellbore", 409, {"wellbore_id": wellbore_id})
        return self.state[wellbore_id]

    async def _cancel(self, wellbore_id: str) -> None:
        task = self.tasks.pop(wellbore_id, None)
        self.state.pop(wellbore_id, None)
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    async def start(self, wellbore_id: str, source: str, speed: int, start_md_m: float | None) -> dict[str, str]:
        if start_md_m is None:
            start_md_m = await fuse.bit_depth(wellbore_id)  # also 404s an unknown wellbore
        elif await db.fetch_one("select id from wellbores where id = %(id)s", {"id": wellbore_id}) is None:
            raise NwisError("NWIS_NOT_FOUND", "Wellbore not found", 404, {"wellbore_id": wellbore_id})

        samples = await db.fetch_all(
            f"select {SAMPLE_COLUMNS} from depth_series where wellbore_id = %(id)s and md_m > %(start)s order by md_m",
            {"id": wellbore_id, "start": start_md_m},
        )
        if not samples:
            raise NwisError(
                "NWIS_BAD_STATE", "No depth_series rows below the start depth", 409,
                {"wellbore_id": wellbore_id, "start_md_m": start_md_m},
            )  # fmt: skip

        await self._cancel(wellbore_id)  # starting again restarts
        l3.reset_bank(wellbore_id)
        await db.execute(
            """
            insert into stream_state (wellbore_id, status, source, speed, bit_md_m, hole_md_m, latest, last_sample_at, updated_at)
            values (%(id)s, 'live', %(source)s, %(speed)s, %(md)s, %(md)s, null, %(now)s, now())
            on conflict (wellbore_id) do update
            set status = 'live', source = excluded.source, speed = excluded.speed, bit_md_m = excluded.bit_md_m,
                hole_md_m = excluded.hole_md_m, latest = null, last_sample_at = excluded.last_sample_at, updated_at = now()
            """,
            {"id": wellbore_id, "source": source, "speed": speed, "md": start_md_m, "now": self.clock.now()},
        )
        self.state[wellbore_id] = ReplayState(source=source, speed=speed)
        self.tasks[wellbore_id] = asyncio.create_task(self._run(wellbore_id, samples, start_md_m))
        return {"status": "live"}

    async def stop(self, wellbore_id: str) -> dict[str, str]:
        await self._cancel(wellbore_id)
        await self._set_stopped(wellbore_id)
        return {"status": "stopped"}

    async def set_speed(self, wellbore_id: str, speed: int) -> dict[str, int]:
        self._running(wellbore_id).speed = speed
        await db.execute(
            "update stream_state set speed = %(speed)s, updated_at = now() where wellbore_id = %(id)s",
            {"speed": speed, "id": wellbore_id},
        )
        return {"speed": speed}

    async def drop(self, wellbore_id: str, seconds: int) -> dict[str, str]:
        state = self._running(wellbore_id)
        state.dropping_until = self.clock.now() + timedelta(seconds=seconds)
        return {"dropping_until": _utc_z(state.dropping_until)}

    async def shutdown(self) -> None:
        for wellbore_id in list(self.tasks):
            await self._cancel(wellbore_id)

    @staticmethod
    async def _set_stopped(wellbore_id: str) -> None:
        await db.execute(
            "update stream_state set status = 'stopped', updated_at = now() where wellbore_id = %(id)s",
            {"id": wellbore_id},
        )

    # ---------------------------------------------------------- the replay loop

    async def _run(self, wellbore_id: str, samples: list[dict[str, Any]], start_md_m: float) -> None:
        state = self.state[wellbore_id]
        bank = l3.bank_for(wellbore_id)
        progress = {"last_risk_md": None, "fired": frozenset()}
        previous, previous_md = None, start_md_m
        batch: list[dict[str, Any]] = []
        waiting = 0.0
        try:
            for index, sample in enumerate(samples):
                waiting += sample_duration_s(previous, previous_md, sample) / state.speed
                batch.append(sample)
                previous, previous_md = sample, sample["md_m"]
                if waiting >= UPDATE_INTERVAL_S or index == len(samples) - 1:
                    await self.clock.sleep(waiting)
                    await self._publish(wellbore_id, batch, state, bank, progress)
                    batch, waiting = [], 0.0
            logger.info("replay_reached_td wellbore_id=%s md=%.1f", wellbore_id, previous_md)  # stop at TD
            await self._set_stopped(wellbore_id)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - never leave a dead task showing "live"
            logger.exception("replay_failed wellbore_id=%s", wellbore_id)
            with contextlib.suppress(Exception):
                await self._set_stopped(wellbore_id)
        finally:
            if self.tasks.get(wellbore_id) is asyncio.current_task():
                self.tasks.pop(wellbore_id, None)
                self.state.pop(wellbore_id, None)

    async def _publish(
        self, wellbore_id: str, batch: list[dict[str, Any]], state: ReplayState, bank: l3.DetectorBank,
        progress: dict[str, Any],
    ) -> None:
        now = self.clock.now()
        if state.dropping_until is not None:
            if now < state.dropping_until:
                return  # the samples of a dropped stream are lost
            state.dropping_until = None

        for sample in batch:
            bank.update(sample)
        last = batch[-1]
        await db.execute(
            """
            update stream_state
            set status = 'live', bit_md_m = %(md)s, hole_md_m = greatest(coalesce(hole_md_m, 0), %(md)s),
                latest = %(latest)s, last_sample_at = %(now)s, updated_at = now()
            where wellbore_id = %(id)s
            """,
            {"id": wellbore_id, "md": last["md_m"], "latest": Jsonb(latest_channels(last)), "now": now},
        )

        fired = frozenset(r.name for r in bank.latest if r.fired)
        due = progress["last_risk_md"] is None or last["md_m"] - progress["last_risk_md"] >= RISK_EVERY_M
        if due or fired != progress["fired"]:
            progress["last_risk_md"], progress["fired"] = last["md_m"], fired
            await self._risk_hook(wellbore_id, bank)

    async def _risk_hook(self, wellbore_id: str, bank: l3.DetectorBank) -> None:
        """Recompute and store risk, then let the alert engine react. Failures never stop the replay."""
        try:
            scores = await fuse.compute_and_store(wellbore_id)
        except Exception:  # noqa: BLE001
            logger.exception("replay_risk_failed wellbore_id=%s", wellbore_id)
            return
        try:
            engine = importlib.import_module("app.alerts.engine")
        except ImportError:  # BE-19 not built yet
            return
        try:
            await engine.evaluate(wellbore_id, scores, list(bank.latest))
        except Exception:  # noqa: BLE001
            logger.exception("replay_alert_evaluate_failed wellbore_id=%s", wellbore_id)


registry = ReplayRegistry()


async def reset_live_streams() -> None:
    """On startup: replay tasks do not survive a restart, so no stream can still be live."""
    await db.execute("update stream_state set status = 'stopped', updated_at = now() where status <> 'stopped'")

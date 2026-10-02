"""Risk layer L3: physics detectors on the live stream (BE-15, contract §11.4).

One `DetectorBank` per wellbore keeps a rolling window of stream samples (last
DETECTOR_WINDOW_SAMPLES samples and last DETECTOR_WINDOW_M metres). `update(sample)` returns
one `DetectorResult` for each of the six detectors. A detector whose channels are missing
(Volve may have no pit volume) or whose history is still too short returns l3 = None.

Samples are dicts with the `depth_series` columns plus `t` (seconds, a datetime or an ISO
string). If `t` is missing it is derived from the depth step and ROP.

Interpretation choices where §11.4 is not specific:
* the circulation check (flow_in above CIRCULATION_MIN_FLOW_LPM) applies to the losses, total
  losses and kick detectors; when the pumps are off they report l3 = 0, not None;
* "pit volume falls/gains" is measured against the highest/lowest pit volume of the last window;
* a "connection" is a period with the pumps off (or, with no flow channel, ROP at zero); its
  overpull is the peak hookload during it against the mean hookload of the 30 m before it;
* `l3` is 1.0 when a detector fires, else its normalised signal clip((observed - normal) /
  (threshold - normal), 0, 1).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

import numpy as np

from app.models.enums import RiskType
from app.risk import config

MIN_Z_SAMPLES = 20  # history needed before a z-score means anything
MIN_TREND_SAMPLES = 5  # samples needed in each of the dxc / gas trend windows
RECENT_SAMPLES = 5  # "now" for the ROP-drop test
STD_FLOOR_FRACTION = 0.01  # a perfectly flat window must not turn a 1 % wobble into a huge z
GAS_RISE_FRACTION = 0.10  # "gas rising" = recent mean above the trend mean by this fraction ...
GAS_RISE_MIN_PCT = 0.05  # ... and by at least this many gas percent, so sensor noise is not a rise
DERIVED_STEP_S = 1.0  # time advance per sample when it cannot be derived from ROP
DERIVED_MIN_ROP_M_H = 1.0
RECENT_CONNECTIONS = config.STUCK_CONSECUTIVE_CONNECTIONS


@dataclass
class DetectorResult:
    name: str
    risk_type: str
    fired: bool
    signal: dict[str, Any]
    l3: float | None
    floor: int


def _clip01(value: float) -> float:
    return float(min(1.0, max(0.0, value)))


def _normalised(observed: float, normal: float, threshold: float) -> float:
    return _clip01((observed - normal) / (threshold - normal))


def _seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.timestamp()
    if isinstance(value, str):
        return datetime.fromisoformat(value).timestamp()
    return float(value)


def _has(sample: dict[str, Any], *keys: str) -> bool:
    return all(sample.get(k) is not None for k in keys)


def l3_by_risk(results: list[DetectorResult]) -> dict[str, float | None]:
    """l3 per risk type: the maximum over its detectors, None when none of them could evaluate."""
    out: dict[str, float | None] = {r.value: None for r in RiskType}
    for result in results:
        if result.l3 is not None:
            current = out[result.risk_type]
            out[result.risk_type] = result.l3 if current is None else max(current, result.l3)
    return out


@dataclass
class DetectorBank:
    wellbore_id: str | None = None
    samples: deque = field(default_factory=lambda: deque(maxlen=config.DETECTOR_WINDOW_SAMPLES))
    _last_t: float | None = None
    _connection: dict[str, Any] | None = None
    _overpulls: deque = field(default_factory=lambda: deque(maxlen=RECENT_CONNECTIONS))
    latest: list = field(default_factory=list)  # DetectorResults of the most recent update()

    # ------------------------------------------------------------ intake

    def _stamp(self, sample: dict[str, Any]) -> dict[str, Any]:
        s = dict(sample)
        t = _seconds(s.get("t"))
        if t is None:  # derive from the depth step and ROP
            if self._last_t is None or not self.samples:
                t = 0.0 if self._last_t is None else self._last_t + DERIVED_STEP_S
            else:
                rop = s.get("rop_m_h")
                step = abs(s["md_m"] - self.samples[-1]["md_m"])
                if rop is not None and rop >= DERIVED_MIN_ROP_M_H and step > 0:
                    t = self._last_t + step / rop * 3600.0
                else:
                    t = self._last_t + DERIVED_STEP_S
        s["_t"] = t
        self._last_t = t
        return s

    def _trim(self) -> None:
        floor_md = self.samples[-1]["md_m"] - config.DETECTOR_WINDOW_M
        while self.samples and self.samples[0]["md_m"] < floor_md:
            self.samples.popleft()

    def update(self, sample: dict[str, Any]) -> list[DetectorResult]:
        s = self._stamp(sample)
        self._track_connection(s)
        self.samples.append(s)
        self._trim()
        self.latest = [
            self._losses(s),
            self._total_losses(s),
            self._kick(s),
            self._overpressure(s),
            self._stuck_pipe(s),
            self._torque_spike(s),
        ]
        return self.latest

    # ------------------------------------------------------------ helpers

    @staticmethod
    def _circulating(s: dict[str, Any]) -> bool:
        return _has(s, "flow_in_lpm") and s["flow_in_lpm"] > config.CIRCULATION_MIN_FLOW_LPM

    def _run_start(self, predicate: Callable[[dict[str, Any]], bool]) -> float | None:
        """Time at which the unbroken run of samples satisfying `predicate`, ending now, began."""
        start = None
        for s in reversed(self.samples):
            if not predicate(s):
                break
            start = s["_t"]
        return start

    def _recent(self, seconds: float) -> list[dict[str, Any]]:
        now = self.samples[-1]["_t"]
        return [s for s in self.samples if s["_t"] >= now - seconds]

    @staticmethod
    def _result(name: str, risk: RiskType, floor: int, fired: bool, l3: float | None, signal: dict) -> DetectorResult:
        return DetectorResult(name, risk.value, fired, signal, 1.0 if fired else l3, floor)

    def _z_score(self, key: str, s: dict[str, Any]) -> float | None:
        """z-score of the current sample's `key` against the window before it."""
        before = list(self.samples)[:-1]  # the window excludes the sample being judged
        history = [x[key] for x in before[-config.TORQUE_WINDOW_SAMPLES :] if x.get(key) is not None]
        if len(history) < MIN_Z_SAMPLES or s.get(key) is None:
            return None
        mean, std = float(np.mean(history)), float(np.std(history))
        return (s[key] - mean) / max(std, STD_FLOOR_FRACTION * abs(mean), 1e-6)

    # ------------------------------------------------------------ losses

    def _flow_ratio_detector(
        self, ratio_ok: Callable[[float, float], bool], min_duration_s: float, now: dict[str, Any]
    ) -> tuple[bool, float | None, float | None]:
        """(fired, current flow ratio, seconds the condition has held) for a flow-in / flow-out rule."""
        if not _has(now, "flow_in_lpm", "flow_out_lpm"):
            return False, None, None
        ratio = now["flow_out_lpm"] / now["flow_in_lpm"] if now["flow_in_lpm"] > 0 else None
        start = self._run_start(
            lambda x: _has(x, "flow_in_lpm", "flow_out_lpm")
            and self._circulating(x)
            and ratio_ok(x["flow_out_lpm"], x["flow_in_lpm"])
        )
        held = now["_t"] - start if start is not None else 0.0
        return start is not None and held >= min_duration_s, ratio, held

    def _losses(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "losses", RiskType.LOSSES, config.LOSSES_FLOOR
        flow_possible = _has(now, "flow_in_lpm", "flow_out_lpm")
        pit_possible = _has(now, "flow_in_lpm", "pit_vol_m3")
        if not flow_possible and not pit_possible:
            return self._result(name, risk, floor, False, None, {})
        if not self._circulating(now):
            return self._result(name, risk, floor, False, 0.0, {})

        signal: dict[str, Any] = {}
        values = [0.0]
        fired = False
        if flow_possible:
            fired_flow, ratio, held = self._flow_ratio_detector(
                lambda out, inn: out < inn * config.LOSSES_FLOW_RATIO, config.LOSSES_DURATION_S, now
            )
            fired = fired or fired_flow
            if ratio is not None:
                values.append(_normalised(ratio, 1.0, config.LOSSES_FLOW_RATIO))
                signal.update(flow_ratio=round(ratio, 3), duration_s=round(held, 1))
        if pit_possible:
            window = [x["pit_vol_m3"] for x in self._recent(config.LOSSES_PIT_WINDOW_S) if x.get("pit_vol_m3") is not None]
            fall = max(window) - now["pit_vol_m3"] if window else 0.0
            fired = fired or fall >= config.LOSSES_PIT_FALL_M3
            values.append(_normalised(fall, 0.0, config.LOSSES_PIT_FALL_M3))
            signal["pit_fall_m3"] = round(fall, 2)
        return self._result(name, risk, floor, fired, max(values), signal)

    def _total_losses(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "total_losses", RiskType.LOSSES, config.TOTAL_LOSSES_FLOOR
        if not _has(now, "flow_in_lpm", "flow_out_lpm"):
            return self._result(name, risk, floor, False, None, {})
        if not self._circulating(now):
            return self._result(name, risk, floor, False, 0.0, {})
        fired, ratio, held = self._flow_ratio_detector(
            lambda out, inn: out < inn * config.TOTAL_LOSSES_FLOW_RATIO, config.TOTAL_LOSSES_DURATION_S, now
        )
        signal = {"flow_ratio": round(ratio, 3), "duration_s": round(held, 1)}
        return self._result(name, risk, floor, fired, _normalised(ratio, 1.0, config.TOTAL_LOSSES_FLOW_RATIO), signal)

    # ------------------------------------------------------------ kick

    def _kick(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "kick", RiskType.KICK, config.KICK_FLOOR
        flow_possible = _has(now, "flow_in_lpm", "flow_out_lpm")
        pit_possible = _has(now, "flow_in_lpm", "pit_vol_m3")
        if not flow_possible and not pit_possible:
            return self._result(name, risk, floor, False, None, {})
        if not self._circulating(now):
            return self._result(name, risk, floor, False, 0.0, {})

        signal: dict[str, Any] = {}
        values = [0.0]
        fired = False
        if flow_possible:
            fired_flow, ratio, held = self._flow_ratio_detector(
                lambda out, inn: out > inn * config.KICK_FLOW_RATIO, config.KICK_FLOW_DURATION_S, now
            )
            fired = fired or fired_flow
            if ratio is not None:
                values.append(_normalised(ratio, 1.0, config.KICK_FLOW_RATIO))
                signal.update(flow_ratio=round(ratio, 3), duration_s=round(held, 1))
        if pit_possible:
            window = [x["pit_vol_m3"] for x in self._recent(config.KICK_PIT_WINDOW_S) if x.get("pit_vol_m3") is not None]
            gain = now["pit_vol_m3"] - min(window) if window else 0.0
            fired = fired or gain >= config.KICK_PIT_GAIN_M3
            values.append(_normalised(gain, 0.0, config.KICK_PIT_GAIN_M3))
            signal["pit_gain_m3"] = round(gain, 2)
        return self._result(name, risk, floor, fired, max(values), signal)

    # ------------------------------------------------------------ overpressure trend

    def _overpressure(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "overpressure_trend", RiskType.KICK, config.OVERPRESSURE_FLOOR
        if not _has(now, "dxc", "gas_total_pct"):
            return self._result(name, risk, floor, False, None, {})
        md = now["md_m"]
        recent_from = md - config.OVERPRESSURE_WINDOW_M
        trend_from = md - config.OVERPRESSURE_WINDOW_M - config.OVERPRESSURE_TREND_M
        recent = [x for x in self.samples if x["md_m"] >= recent_from and _has(x, "dxc", "gas_total_pct")]
        trend = [x for x in self.samples if trend_from <= x["md_m"] < recent_from and _has(x, "dxc", "gas_total_pct")]
        if len(recent) < MIN_TREND_SAMPLES or len(trend) < MIN_TREND_SAMPLES:
            return self._result(name, risk, floor, False, None, {})
        trend_dxc = float(np.mean([x["dxc"] for x in trend]))
        recent_dxc = float(np.mean([x["dxc"] for x in recent]))
        trend_gas = float(np.mean([x["gas_total_pct"] for x in trend]))
        recent_gas = float(np.mean([x["gas_total_pct"] for x in recent]))
        gas_rising = recent_gas > max(trend_gas * (1 + GAS_RISE_FRACTION), trend_gas + GAS_RISE_MIN_PCT)
        fall = (trend_dxc - recent_dxc) / trend_dxc if trend_dxc > 0 else 0.0
        fired = bool(gas_rising and fall >= config.OVERPRESSURE_DXC_FALL_FRAC)
        signal_value = _normalised(fall, 0.0, config.OVERPRESSURE_DXC_FALL_FRAC) if gas_rising else 0.0
        return self._result(
            name, risk, floor, fired, signal_value,
            {"dxc_fall_pct": round(fall * 100, 1), "gas_rising": bool(gas_rising)},
        )  # fmt: skip

    # ------------------------------------------------------------ stuck pipe

    def _pumps_off(self, s: dict[str, Any]) -> bool | None:
        if _has(s, "flow_in_lpm"):
            return not self._circulating(s)
        if _has(s, "rop_m_h"):
            return s["rop_m_h"] <= 0
        return None

    def _track_connection(self, s: dict[str, Any]) -> None:
        """Record the peak hookload of each connection against the hookload just before it."""
        off = self._pumps_off(s)
        if off is None:
            return
        if off and self._connection is None:
            near = [
                x["hookload_kn"]
                for x in self.samples
                if x.get("hookload_kn") is not None and x["md_m"] >= s["md_m"] - config.STUCK_MA_WINDOW_M
            ]
            self._connection = {"baseline": float(np.mean(near)) if near else None, "peak": None}
        if off and self._connection is not None and _has(s, "hookload_kn"):
            peak = self._connection["peak"]
            self._connection["peak"] = s["hookload_kn"] if peak is None else max(peak, s["hookload_kn"])
        if not off and self._connection is not None:
            baseline, peak = self._connection["baseline"], self._connection["peak"]
            if baseline and peak is not None:
                self._overpulls.append((peak - baseline) / baseline)
            self._connection = None

    def _stuck_pipe(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "stuck_pipe", RiskType.STUCK_PIPE, config.STUCK_FLOOR
        overpull_possible = _has(now, "hookload_kn") and self._pumps_off(now) is not None
        torque_possible = _has(now, "torque_knm", "rop_m_h")
        if not overpull_possible and not torque_possible:
            return self._result(name, risk, floor, False, None, {})

        fired, values, signal = False, [], {}
        if overpull_possible:
            recent = list(self._overpulls)
            if len(recent) == RECENT_CONNECTIONS and min(recent) > config.STUCK_OVERPULL_FRAC:
                fired = True
            if recent:
                signal["overpull_pct"] = round(max(recent[-1], 0.0) * 100, 1)
                values.append(_normalised(min(recent) if len(recent) == RECENT_CONNECTIONS else recent[-1],
                                          0.0, config.STUCK_OVERPULL_FRAC))  # fmt: skip
        if torque_possible:
            z = self._z_score("torque_knm", now)
            history = [x["rop_m_h"] for x in list(self.samples)[-config.TORQUE_WINDOW_SAMPLES :] if x.get("rop_m_h") is not None]
            if z is not None and len(history) > RECENT_SAMPLES:
                baseline = float(np.mean(history[:-RECENT_SAMPLES]))
                current = float(np.mean(history[-RECENT_SAMPLES:]))
                drop = (baseline - current) / baseline if baseline > 0 else 0.0
                if z > config.STUCK_TORQUE_Z and drop > config.STUCK_ROP_DROP_FRAC:
                    fired = True
                values.append(
                    min(_normalised(z, 0.0, config.STUCK_TORQUE_Z), _normalised(drop, 0.0, config.STUCK_ROP_DROP_FRAC))
                )
                signal.update(torque_z=round(z, 2), rop_drop_pct=round(drop * 100, 1))
        if not values and not fired:
            return self._result(name, risk, floor, False, None if not signal else 0.0, signal)
        return self._result(name, risk, floor, fired, max(values) if values else 0.0, signal)

    # ------------------------------------------------------------ torque spike

    def _torque_spike(self, now: dict[str, Any]) -> DetectorResult:
        name, risk, floor = "torque_spike", RiskType.TORQUE, config.TORQUE_FLOOR
        if not _has(now, "torque_knm"):
            return self._result(name, risk, floor, False, None, {})
        z = self._z_score("torque_knm", now)
        if z is None:
            return self._result(name, risk, floor, False, None, {})
        fired = z > config.TORQUE_Z_THRESHOLD
        return self._result(name, risk, floor, fired, _normalised(z, 0.0, config.TORQUE_Z_THRESHOLD), {"torque_z": round(z, 2)})


# ---------------------------------------------------------------- registry (one bank per wellbore)

_banks: dict[str, DetectorBank] = {}


def bank_for(wellbore_id: str) -> DetectorBank:
    """The wellbore's bank, created on first use. Fed by the stream replay, read by the fusion step."""
    if wellbore_id not in _banks:
        _banks[wellbore_id] = DetectorBank(wellbore_id)
    return _banks[wellbore_id]


def existing_bank(wellbore_id: str) -> DetectorBank | None:
    return _banks.get(wellbore_id)


def reset_bank(wellbore_id: str) -> None:
    """Forget a wellbore's window (a restarted replay must not inherit the old one)."""
    _banks.pop(wellbore_id, None)

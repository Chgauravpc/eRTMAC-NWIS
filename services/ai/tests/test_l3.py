"""BE-15: L3 physics detectors on synthetic stream windows (numpy)."""

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.risk import config
from app.risk.l3 import DetectorBank, DetectorResult, l3_by_risk

DT = 5.0  # seconds between samples
STEP_M = 0.5


class Rig:
    """Feeds a DetectorBank with a controllable synthetic stream; tracks time and depth."""

    def __init__(self, channels=None, seed=0):
        self.bank = DetectorBank("wb")
        self.rng = np.random.default_rng(seed)
        self.t, self.md = 0.0, 2000.0
        self.channels = channels  # None = all channels
        self.last: dict[str, DetectorResult] = {}

    def sample(self, **over):
        r = self.rng
        flow = 2000.0 + r.normal(0, 5)
        s = {
            "md_m": self.md, "t": self.t, "rop_m_h": 12.0 + r.normal(0, 0.3),
            "flow_in_lpm": flow, "flow_out_lpm": flow * (1 + r.normal(0, 0.003)),
            "pit_vol_m3": 40.0 + r.normal(0, 0.02), "hookload_kn": 1500.0 + r.normal(0, 4),
            "torque_knm": 15.0 + r.normal(0, 0.4), "dxc": 1.2 + r.normal(0, 0.005),
            "gas_total_pct": 0.5 + r.normal(0, 0.01),
        }  # fmt: skip
        s.update(over)
        if self.channels is not None:
            s = {k: v for k, v in s.items() if k in self.channels or k in ("md_m", "t")}
        return s

    def push(self, n=1, advance=True, **over):
        """n samples; each override may be a value or a callable(i) -> value."""
        out = []
        for i in range(n):
            fixed = {k: (v(i) if callable(v) else v) for k, v in over.items()}
            results = self.bank.update(self.sample(**fixed))
            self.last = {x.name: x for x in results}
            out.append(self.last)
            if advance:
                self.t += DT
                self.md += STEP_M
        return out

    def warm(self, n=100):
        return self.push(n)


def fired_names(snapshot):
    return {name for name, r in snapshot.items() if r.fired}


# ---------------------------------------------------------------- shape and normal drilling


def test_six_detectors_with_contract_names_risk_types_and_floors():
    results = DetectorBank().update({"md_m": 100.0, "t": 0.0})
    assert [(r.name, r.risk_type, r.floor) for r in results] == [
        ("losses", "losses", config.LOSSES_FLOOR),
        ("total_losses", "losses", config.TOTAL_LOSSES_FLOOR),
        ("kick", "kick", config.KICK_FLOOR),
        ("overpressure_trend", "kick", config.OVERPRESSURE_FLOOR),
        ("stuck_pipe", "stuck_pipe", config.STUCK_FLOOR),
        ("torque_spike", "torque", config.TORQUE_FLOOR),
    ]
    assert all(not r.fired and r.l3 is None for r in results)  # no channels at all: nothing to evaluate


def test_normal_drilling_fires_nothing_and_scores_low():
    rig = Rig()
    for snapshot in rig.push(500):
        assert not fired_names(snapshot)
    assert all(r.l3 is not None and r.l3 < 0.5 for r in rig.last.values())


# ---------------------------------------------------------------- losses


def test_loss_signature_fires_losses_after_120_seconds():
    rig = Rig()
    rig.warm()
    low_flow = lambda i: 0.8 * 2000.0  # noqa: E731
    first = rig.push(20, flow_out_lpm=low_flow)  # 100 s of low returns
    assert "losses" not in fired_names(first[-1]) and first[-1]["losses"].l3 == pytest.approx(1.0)  # saturated signal
    after = rig.push(10, flow_out_lpm=low_flow)  # 150 s
    losses = after[-1]["losses"]
    assert losses.fired and losses.l3 == 1.0 and losses.risk_type == "losses" and losses.floor == 65
    assert losses.signal["flow_ratio"] == pytest.approx(0.8, abs=0.01) and losses.signal["duration_s"] >= 120


def test_a_short_dip_in_returns_does_not_fire_losses():
    rig = Rig()
    rig.warm()
    rig.push(10, flow_out_lpm=1600.0)  # 50 s
    snapshots = rig.push(40)
    assert all("losses" not in fired_names(s) for s in snapshots)


def test_pit_volume_fall_fires_losses_even_with_normal_returns():
    rig = Rig()
    rig.warm()
    snapshots = rig.push(130, pit_vol_m3=lambda i: 40.0 - 0.012 * i)  # 1.5 m3 in 650 s
    assert any("losses" in fired_names(s) for s in snapshots)
    assert "total_losses" not in fired_names(snapshots[-1])
    assert snapshots[-1]["losses"].signal["pit_fall_m3"] >= 1.0


def test_total_losses_fire_after_30_seconds_of_returns_below_half():
    rig = Rig()
    rig.warm()
    rig.push(4, flow_out_lpm=800.0)  # 20 s
    assert "total_losses" not in fired_names(rig.last)
    rig.push(4, flow_out_lpm=800.0)
    total = rig.last["total_losses"]
    assert total.fired and total.floor == 85 and total.risk_type == "losses"


# ---------------------------------------------------------------- kick


def test_pit_gain_fires_kick():
    rig = Rig()
    rig.warm()
    snapshots = rig.push(40, pit_vol_m3=lambda i: 40.0 + 0.06 * i)  # 2.4 m3 in 200 s
    kick = snapshots[-1]["kick"]
    assert any("kick" in fired_names(s) for s in snapshots) and kick.risk_type == "kick" and kick.floor == 85
    assert kick.signal["pit_gain_m3"] >= 1.6


def test_flow_out_above_flow_in_for_60_seconds_fires_kick():
    rig = Rig()
    rig.warm()
    rig.push(8, flow_out_lpm=2000.0 * 1.2)  # 40 s
    assert "kick" not in fired_names(rig.last)
    rig.push(6, flow_out_lpm=2000.0 * 1.2)
    assert rig.last["kick"].fired and "losses" not in fired_names(rig.last)


def test_overpressure_trend_needs_dxc_fall_and_rising_gas():
    def run(gas_rises):
        rig = Rig()
        rig.push(500)
        return rig.push(
            100,
            dxc=lambda i: 1.2 - 0.006 * i,  # averages about 25 % below the trend over the last 50 m
            gas_total_pct=(lambda i: 0.5 + 0.02 * i) if gas_rises else 0.5,
        )

    with_gas = run(True)
    assert any("overpressure_trend" in fired_names(s) for s in with_gas)
    last = with_gas[-1]["overpressure_trend"]
    assert last.risk_type == "kick" and last.floor == 65 and last.signal["dxc_fall_pct"] >= 15 and last.signal["gas_rising"]
    assert all("overpressure_trend" not in fired_names(s) for s in run(False))


def test_overpressure_trend_is_unknown_until_there_is_history():
    rig = Rig()
    assert rig.push(30)[-1]["overpressure_trend"].l3 is None


# ---------------------------------------------------------------- stuck pipe


def connection(rig, overpull, n_off=3):
    """40 drilling samples, then a connection with the pumps off and hookload `overpull` above normal."""
    rig.push(40)
    rig.push(n_off, flow_in_lpm=0.0, flow_out_lpm=0.0, hookload_kn=1500.0 * (1 + overpull))
    return rig.push(1)[-1]  # pumps back on: the connection ends and is scored


def test_overpull_on_three_consecutive_connections_fires_stuck_pipe():
    rig = Rig()
    rig.warm(40)
    first = connection(rig, 0.25)["stuck_pipe"]
    second = connection(rig, 0.25)["stuck_pipe"]
    assert not first.fired and not second.fired
    third = connection(rig, 0.25)["stuck_pipe"]
    assert third.fired and third.risk_type == "stuck_pipe" and third.floor == 65 and third.l3 == 1.0
    assert third.signal["overpull_pct"] == pytest.approx(25.0, abs=2.0)


def test_a_normal_connection_in_between_resets_the_run_of_three():
    rig = Rig()
    rig.warm(40)
    connection(rig, 0.25)
    connection(rig, 0.25)
    assert not connection(rig, 0.05)["stuck_pipe"].fired  # third one is small
    assert not connection(rig, 0.25)["stuck_pipe"].fired  # only one big one since


def test_torque_spike_with_rop_collapse_fires_stuck_pipe():
    rig = Rig()
    rig.warm(80)
    snapshots = rig.push(8, torque_knm=60.0, rop_m_h=2.0)
    stuck = [s["stuck_pipe"] for s in snapshots]
    assert any(s.fired for s in stuck)
    assert max(s.signal["torque_z"] for s in stuck) > 3 and max(s.signal["rop_drop_pct"] for s in stuck) > 50


def test_torque_spike_alone_does_not_fire_stuck_pipe():
    rig = Rig()
    rig.warm(80)
    snapshots = rig.push(3, torque_knm=60.0)
    assert not any(s["stuck_pipe"].fired for s in snapshots)


# ---------------------------------------------------------------- torque


def test_torque_spike_fires_on_a_z_score_above_3_5():
    rig = Rig()
    rig.warm(80)
    mild = rig.push(1, torque_knm=15.0 + 2 * 0.4)[-1]["torque_spike"]
    assert not mild.fired and 0 < mild.l3 < 1
    spike = rig.push(1, torque_knm=30.0)[-1]["torque_spike"]
    assert spike.fired and spike.l3 == 1.0 and spike.risk_type == "torque" and spike.floor == 65
    assert spike.signal["torque_z"] > 3.5


def test_flat_torque_with_a_tiny_wobble_does_not_fire():
    rig = Rig()
    rig.warm(60)
    rig.push(60, torque_knm=15.0)
    assert not rig.push(1, torque_knm=15.05)[-1]["torque_spike"].fired  # std floor keeps this quiet


# ---------------------------------------------------------------- missing channels, circulation, time


def test_missing_channels_give_none_not_zero():
    rig = Rig(channels=("rop_m_h", "torque_knm"))  # no flow, pit, hookload, dxc or gas
    rig.push(60)
    assert rig.last["losses"].l3 is None and rig.last["total_losses"].l3 is None
    assert rig.last["kick"].l3 is None and rig.last["overpressure_trend"].l3 is None
    assert rig.last["torque_spike"].l3 is not None
    assert rig.last["stuck_pipe"].l3 is not None  # the torque + ROP rule can still be evaluated


def test_no_pit_volume_channel_still_evaluates_the_flow_rules():
    rig = Rig(channels=("rop_m_h", "flow_in_lpm", "flow_out_lpm"))
    rig.warm(30)
    rig.push(30, flow_out_lpm=1500.0)
    assert rig.last["losses"].fired and "pit_fall_m3" not in rig.last["losses"].signal
    assert rig.last["kick"].l3 is not None


def test_no_circulation_means_no_flow_or_pit_alarm():
    rig = Rig()
    rig.warm()
    snapshot = rig.push(40, flow_in_lpm=100.0, flow_out_lpm=0.0, pit_vol_m3=lambda i: 40.0 - 0.1 * i)[-1]
    assert not fired_names(snapshot) & {"losses", "total_losses", "kick"}
    assert snapshot["losses"].l3 == 0.0 and snapshot["kick"].l3 == 0.0


def test_time_is_derived_from_rop_when_samples_carry_no_t():
    bank = DetectorBank()

    def feed(flow_out):
        return bank.update({"md_m": feed.md, "rop_m_h": 12.0, "flow_in_lpm": 2000.0, "flow_out_lpm": flow_out})

    feed.md = 2000.0
    for _ in range(5):
        feed(2000.0)
        feed.md += 0.5
    first = {r.name: r for r in feed(1600.0)}
    feed.md += 0.5
    second = {r.name: r for r in feed(1600.0)}  # 0.5 m at 12 m/h = 150 s later
    assert not first["losses"].fired and second["losses"].fired


def test_t_may_be_a_datetime_or_an_iso_string():
    bank = DetectorBank()
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(3):
        stamp = start + timedelta(seconds=5 * i)
        bank.update({"md_m": 100.0 + i, "t": stamp if i % 2 else stamp.isoformat(), "flow_in_lpm": 2000.0, "flow_out_lpm": 1000.0})
    assert [s["_t"] for s in bank.samples] == [start.timestamp() + 5 * i for i in range(3)]


# ---------------------------------------------------------------- window and helpers


def test_window_keeps_at_most_600_samples_and_300_m():
    rig = Rig()
    rig.push(2000)
    samples = rig.bank.samples
    assert len(samples) <= config.DETECTOR_WINDOW_SAMPLES
    assert samples[-1]["md_m"] - samples[0]["md_m"] <= config.DETECTOR_WINDOW_M

    deep = DetectorBank()
    for i in range(300):
        deep.update({"md_m": 1000.0 + i * 5.0, "t": float(i)})  # 5 m steps: the depth limit binds first
    assert deep.samples[-1]["md_m"] - deep.samples[0]["md_m"] <= config.DETECTOR_WINDOW_M


def test_l3_by_risk_takes_the_maximum_and_keeps_none_when_nothing_evaluated():
    mk = lambda name, risk, l3: DetectorResult(name, risk, False, {}, l3, 65)  # noqa: E731
    result = l3_by_risk([mk("a", "losses", 0.2), mk("b", "losses", 0.7), mk("c", "kick", None), mk("d", "torque", 0.0)])
    assert result["losses"] == 0.7 and result["kick"] is None and result["torque"] == 0.0
    assert result["stuck_pipe"] is None and result["cementing"] is None

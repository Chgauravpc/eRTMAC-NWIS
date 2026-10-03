"""Depth series generator for the synthetic wells (DB-09 part 2).

One row per `step` metres from the surface to TD, with formation- and lithology-dependent baselines plus noise, a
connection (pumps off) every stand, and the pre-event signatures the live detectors and the ML model learn from:

  losses          flow out below flow in, pit volume falling
  total losses    flow out below half of flow in, pit volume falling fast
  kick            pit gain, flow out above flow in, gas up, and an over-pressure approach (dxc falling, gas rising)
  stuck pipe      torque rising and ROP falling, hookload overpull on the last connections
  tight hole      overpull on the last connections
  pack off        stand-pipe pressure spike
  torque spike    torque peak
  hole instab.    torque and gas rising
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Sequence

import numpy as np

LITHOLOGIES = ("shale", "sandstone", "coal", "limestone")
GR_MEAN = {"shale": 110.0, "sandstone": 50.0, "coal": 32.0, "limestone": 25.0}
GR_SD = {"shale": 12.0, "sandstone": 8.0, "coal": 6.0, "limestone": 6.0}
ROP_MULT = {"shale": 0.80, "sandstone": 1.10, "coal": 1.30, "limestone": 0.70}
TORQUE_MULT = {"shale": 1.10, "sandstone": 1.00, "coal": 1.40, "limestone": 1.05}
GAS_MULT = {"shale": 1.0, "sandstone": 0.8, "coal": 3.0, "limestone": 0.7}

SERIES_COLUMNS = (
    "wellbore_id", "md_m", "t", "rop_m_h", "wob_kn", "rpm", "torque_knm", "spp_bar", "flow_in_lpm", "flow_out_lpm",
    "pit_vol_m3", "hookload_kn", "mw_sg", "ecd_sg", "gas_total_pct", "dxc", "gr_api",
)


def _ramp(x: np.ndarray, a: float, b: float) -> np.ndarray:
    """0 below a, 1 above b, linear in between."""
    return np.clip((x - a) / max(b - a, 1e-9), 0.0, 1.0)


def _ar1(rng: np.random.Generator, n: int, phi: float, sigma: float) -> np.ndarray:
    """Zero-mean AR(1) noise with stationary standard deviation `sigma`."""
    innov = rng.normal(0.0, sigma * np.sqrt(1 - phi**2), n)
    out = np.empty(n)
    acc = rng.normal(0.0, sigma)
    for i in range(n):
        acc = phi * acc + innov[i]
        out[i] = acc
    return out


def beds(rng: np.random.Generator, md: np.ndarray, formation_idx: np.ndarray, mixes: Sequence[dict[str, float]], step: float) -> np.ndarray:
    """Lithology index (into LITHOLOGIES) per sample: beds of 1.5-35 m drawn from the formation's lithology mix."""
    n = md.size
    out = np.zeros(n, dtype=np.int8)
    ptr = 0
    while ptr < n:
        thick = float(np.clip(rng.lognormal(np.log(7.0), 0.6), 1.5, 35.0))
        count = max(1, int(thick / step))
        mix = mixes[int(formation_idx[ptr])]
        names = list(mix)
        probs = np.array([mix[k] for k in names], dtype=float)
        choice = names[int(rng.choice(len(names), p=probs / probs.sum()))]
        out[ptr : ptr + count] = LITHOLOGIES.index(choice)
        ptr += count
    return out


def generate_series(
    rng: np.random.Generator,
    *,
    md_td: float,
    step: float,
    stations_md: np.ndarray,
    stations_tvd: np.ndarray,
    stations_inc: np.ndarray,
    tops_md: np.ndarray,
    mixes: Sequence[dict[str, float]],
    shoe1_md: float,
    shoe2_md: float,
    mud_md: np.ndarray,
    mud_mw: np.ndarray,
    events: Sequence[dict[str, Any]],
    t0: dt.datetime,
    stand_m: float = 28.5,
    connection_s: float = 300.0,
) -> dict[str, np.ndarray]:
    """Arrays for every column of `depth_series` (see SERIES_COLUMNS) plus 'connection' (bool) and 'lith' (int)."""
    n = int(round(md_td / step))
    md = np.arange(1, n + 1) * step
    tvd = np.interp(md, stations_md, stations_tvd)
    inc = np.interp(md, stations_md, stations_inc)
    form_idx = np.clip(np.searchsorted(tops_md, md, side="right") - 1, 0, len(tops_md) - 1)
    lith = beds(rng, md, form_idx, mixes, step)
    names = np.array(LITHOLOGIES)[lith]

    # connections: one sample per stand with the pumps off
    conn = np.zeros(n, dtype=bool)
    k = 1
    while True:
        i = int(round(k * stand_m / step)) - 1
        if i >= n:
            break
        conn[i] = True
        k += 1

    gr_off = np.zeros(n)
    edges = np.flatnonzero(np.diff(lith, prepend=-1) != 0)
    for a, b in zip(edges, list(edges[1:]) + [n]):
        gr_off[a:b] = rng.normal(0.0, 5.0)
    gr = np.clip(np.array([GR_MEAN[x] for x in names]) + gr_off + rng.normal(0, 4.0, n) * np.array([GR_SD[x] for x in names]) / 8.0, 5.0, 180.0)

    rop_mult = np.array([ROP_MULT[x] for x in names])
    rop = np.clip(30.0 * np.exp(-tvd / 2600.0) * rop_mult * np.exp(_ar1(rng, n, 0.97, 0.20)), 1.5, 60.0)
    wob = (60.0 + 0.03 * tvd) * (1 + rng.normal(0, 0.05, n))
    rpm = np.clip(125.0 - 0.01 * tvd + rng.normal(0, 3.0, n), 60.0, 140.0)
    torque_mult = np.array([TORQUE_MULT[x] for x in names])
    torque = (4.0 + 0.0035 * md) * (1 + 0.8 * np.sin(np.radians(inc))) * torque_mult * (1 + rng.normal(0, 0.06, n))
    flow_in = np.where(md < shoe1_md, 3200.0, np.where(md < shoe2_md, 2600.0, 1800.0)) * (1 + rng.normal(0, 0.01, n))
    flow_out = flow_in * (1 + rng.normal(0, 0.004, n))
    spp = (90.0 + 0.04 * md) * (flow_in / 2600.0) ** 1.8 * (1 + rng.normal(0, 0.02, n))
    pit = 82.0 + _ar1(rng, n, 0.995, 0.35)
    hook = (300.0 + 0.30 * md) * (1 + rng.normal(0, 0.015, n))
    mw = np.interp(md, mud_md, mud_mw)
    ecd = mw + 0.02 + 0.00002 * md + rng.normal(0, 0.003, n)
    gas = np.clip(0.35 * np.exp(rng.normal(0, 0.35, n)) * np.array([GAS_MULT[x] for x in names]), 0.02, 3.0)
    dxc = 0.9 + 0.00028 * tvd + 0.05 * (names == "shale") + _ar1(rng, n, 0.95, 0.015)

    # ---- pre-event signatures (the events the well will have, below and above the bit alike)
    for ev in events:
        e = float(ev["md_from_m"])
        etype = ev["event_type"]
        vol = float(ev.get("volume_m3") or 0.0)
        live = ~conn

        if etype == "loss_partial":
            prof = 1.0 - 0.15 * _ramp(md, e - 8, e - 4) + 0.13 * _ramp(md, e + 8, e + 12)
            m = live & (md >= e - 8) & (md <= e + 12)
            flow_out[m] = flow_in[m] * prof[m]
            fall = 5.0 * _ramp(md, e - 8, e) * (1 - _ramp(md, e + 12, e + 40))
            pit -= fall
            spp *= 1 - 0.06 * _ramp(md, e - 8, e) * (1 - _ramp(md, e + 12, e + 20))
        elif etype == "loss_total":
            prof = 1.0 - 0.62 * _ramp(md, e - 6, e - 2) + 0.35 * _ramp(md, e + 10, e + 16)
            m = live & (md >= e - 6) & (md <= e + 16)
            flow_out[m] = flow_in[m] * prof[m]
            pit -= 9.0 * _ramp(md, e - 6, e) * (1 - _ramp(md, e + 16, e + 50))
            spp *= 1 - 0.18 * _ramp(md, e - 6, e) * (1 - _ramp(md, e + 16, e + 30))
        elif etype == "kick":
            # over-pressure approach: dxc falls below its trend, gas rises (the 200 m before the kick)
            dxc *= 1 - 0.22 * _ramp(md, e - 180, e - 5) ** 2
            gas += 0.9 * _ramp(md, e - 150, e)
            # the influx itself
            prof = 1.0 + 0.20 * _ramp(md, e - 4, e) * (1 - _ramp(md, e + 4, e + 8))
            m = live & (md >= e - 4) & (md <= e + 8)
            flow_out[m] = flow_in[m] * prof[m]
            pit += max(vol, 1.6) * 1.4 * _ramp(md, e - 4, e + 1) * (1 - _ramp(md, e + 8, e + 30))
            gas += 1.5 * _ramp(md, e - 3, e) * (1 - _ramp(md, e + 6, e + 20))
            spp *= 1 - 0.05 * _ramp(md, e - 4, e)
        elif etype in ("stuck_pipe_diff", "stuck_pipe_mech"):
            lead = 30.0
            torque *= 1 + 0.6 * _ramp(md, e - lead, e)
            rop *= 1 - 0.55 * _ramp(md, e - lead + 10, e)
            # overpull on the last three connections before the event
            before = np.flatnonzero(conn & (md < e))[-3:]
            hook[before] *= 1.0 + rng.uniform(0.24, 0.34, before.size)
            after = (md >= e) & (md < e + 20)
            torque[after] *= 1.0 + 0.3 * (1 - _ramp(md[after], e, e + 20))
        elif etype == "tight_hole":
            before = np.flatnonzero(conn & (md < e))[-2:]
            hook[before] *= 1.0 + rng.uniform(0.12, 0.18, before.size)
            torque *= 1 + 0.2 * _ramp(md, e - 15, e) * (1 - _ramp(md, e + 5, e + 15))
        elif etype == "pack_off":
            spp *= 1 + 0.35 * _ramp(md, e - 3, e) * (1 - _ramp(md, e + 1, e + 4))
            m = live & (md >= e - 2) & (md <= e + 3)
            flow_out[m] = flow_in[m] * 0.82
            torque *= 1 + 0.4 * _ramp(md, e - 3, e) * (1 - _ramp(md, e + 1, e + 4))
        elif etype == "torque_spike":
            torque *= 1 + 0.9 * np.sin(np.pi * _ramp(md, e - 3, e + 3)) * ((md >= e - 3) & (md <= e + 3))
            rop *= 1 - 0.2 * ((md >= e - 3) & (md <= e + 3))
        elif etype == "hole_instability":
            torque *= 1 + 0.3 * _ramp(md, e - 15, e)
            gas += 0.3 * _ramp(md, e - 15, e)
        # cement_failure and fishing leave no trace in the drilling parameters

    # ---- connections: pumps off, no rotation, hookload carries the overpull
    hook[conn] *= 1.0 + rng.normal(0.03, 0.01, int(conn.sum()))
    for arr in (flow_in, flow_out, spp, rpm, wob, torque, rop):
        arr[conn] = 0.0
    flow_out = np.maximum(flow_out, 0.0)
    pit = np.maximum(pit, 5.0)

    dt_s = np.where(conn, connection_s, step / np.maximum(rop, 1.0) * 3600.0)
    t = np.array([t0 + dt.timedelta(seconds=float(s)) for s in np.cumsum(dt_s)], dtype=object)

    return {
        "md_m": md, "t": t, "rop_m_h": rop, "wob_kn": wob, "rpm": rpm, "torque_knm": torque, "spp_bar": spp,
        "flow_in_lpm": flow_in, "flow_out_lpm": flow_out, "pit_vol_m3": pit, "hookload_kn": hook, "mw_sg": mw,
        "ecd_sg": ecd, "gas_total_pct": gas, "dxc": dxc, "gr_api": gr, "connection": conn, "lith": lith,
    }

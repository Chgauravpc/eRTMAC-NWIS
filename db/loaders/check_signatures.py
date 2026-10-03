"""Do the injected pre-event signatures trip the live detectors (services/ai/app/risk/l3.py)?

  python -m db.loaders.check_signatures [--seed 42]

For every event with a detector (losses, total losses, kick / over-pressure, stuck pipe, torque spike) the series is fed
sample by sample into a fresh DetectorBank starting 250 m above the event; a hit is a matching detector that fires at or
before the event depth (+ a small tolerance). The same is done over stretches without any event to count false alarms
per 1,000 m. Prints a table; returns exit code 1 when fewer than 80 % of the events are detected.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

import numpy as np

from .common import REPO_ROOT
from .synth_assam import SynthData, generate

sys.path.insert(0, str(REPO_ROOT / "services" / "ai"))

# event type -> the detectors that count as a hit
DETECTORS = {
    "loss_partial": {"losses", "total_losses"},
    "loss_total": {"losses", "total_losses"},
    "kick": {"kick", "overpressure"},
    "stuck_pipe_diff": {"stuck_pipe"},
    "stuck_pipe_mech": {"stuck_pipe"},
    "torque_spike": {"torque_spike"},
}
SAMPLE_KEYS = ("rop_m_h", "wob_kn", "rpm", "torque_knm", "spp_bar", "flow_in_lpm", "flow_out_lpm", "pit_vol_m3", "hookload_kn", "mw_sg", "ecd_sg",
               "gas_total_pct", "dxc", "gr_api")
TOLERANCE_M = 3.0


def samples(series: dict, lo: float, hi: float):
    md = series["md_m"]
    for i in np.flatnonzero((md >= lo) & (md <= hi)):
        s = {k: float(series[k][i]) for k in SAMPLE_KEYS}
        s["md_m"] = float(md[i])
        s["t"] = series["t"][i]
        yield s


def first_fire(series: dict, lo: float, hi: float) -> dict[str, float]:
    from app.risk.l3 import DetectorBank

    bank = DetectorBank()
    fired: dict[str, float] = {}
    for s in samples(series, lo, hi):
        for r in bank.update(s):
            if r.fired and r.name not in fired:
                fired[r.name] = s["md_m"]
    return fired


def evaluate(data: SynthData) -> tuple[dict[str, list[bool]], int, float]:
    hits: dict[str, list[bool]] = defaultdict(list)
    false_alarms = 0
    quiet_m = 0.0
    for w in data.wells:
        if w.series is None:
            continue
        for e in w.events:
            wanted = DETECTORS.get(e["event_type"])
            if not wanted:
                continue
            fired = first_fire(w.series, e["md_from_m"] - 250.0, e["md_from_m"] + 15.0)
            ok = any(name in fired and fired[name] <= e["md_from_m"] + TOLERANCE_M for name in wanted)
            hits[e["event_type"]].append(ok)
        # a quiet stretch: from the surface casing shoe, 250 m before every event and 60 m after it are excluded
        md = w.series["md_m"]
        busy = np.zeros(md.size, dtype=bool)
        for e in w.events:
            busy |= (md >= e["md_from_m"] - 260.0) & (md <= e["md_from_m"] + 60.0)
        quiet = ~busy & (md > w.shoes["surface"] + 300.0)
        if quiet.sum() > 400:
            # take the longest quiet run
            idx = np.flatnonzero(quiet)
            runs = np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1)
            run = max(runs, key=len)
            if len(run) > 400:
                lo, hi = md[run[0]], md[run[-1]]
                false_alarms += len(first_fire(w.series, lo, hi))
                quiet_m += hi - lo
    return hits, false_alarms, quiet_m


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args(argv)
    data = generate(args.seed)
    hits, false_alarms, quiet_m = evaluate(data)
    total = hit = 0
    print(f"{'event type':18}{'events':>8}{'detected':>10}")
    for etype, results in sorted(hits.items()):
        print(f"{etype:18}{len(results):>8}{sum(results):>10}")
        total += len(results)
        hit += sum(results)
    rate = hit / total if total else 0.0
    print(f"\ndetected at or before the event depth: {hit} of {total} ({rate:.0%})")
    print(f"false alarms on quiet stretches: {false_alarms} detector firings over {quiet_m / 1000:.1f} km ({false_alarms / max(quiet_m / 1000, 1e-9):.2f} per 1,000 m)")
    return 0 if rate >= 0.8 else 1


if __name__ == "__main__":
    raise SystemExit(main())

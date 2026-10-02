"""Synthetic Upper Assam dataset (DB-09): 30 wells that make every NWIS feature demonstrable.

  python -m db.loaders.synth_assam --dry-run            # generate and print the summary, write nothing to the database
  python -m db.loaders.synth_assam --seed 42 --reset    # delete the synthetic rows, then load a fresh set (one transaction)

Deterministic: the same seed gives the same data. See db/data/synth_config.yaml for every number, and
db/data/synth_truth/<well>.json for the hazards the three drilling wells have NOT met yet (they are not in `events`).

Every row is labelled provenance 'synthetic', every well starts with SYN- (contract §4).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from .common import REPO_ROOT, copy_rows, get_conn
from .synth_series import SERIES_COLUMNS, generate_series
from .trajectories import build_trajectory, mcm

NAMESPACE = uuid.UUID("6f1c0b7e-5a2e-4c1f-9a3b-2d7e8f9a0b1c")
CONFIG_PATH = REPO_ROOT / "db" / "data" / "synth_config.yaml"
TEMPLATES_PATH = REPO_ROOT / "db" / "loaders" / "templates" / "event_text.yaml"
TRUTH_DIR = REPO_ROOT / "db" / "data" / "synth_truth"

# contract §5: event_type -> risk_type
RISK_OF = {
    "loss_partial": "losses", "loss_total": "losses", "kick": "kick", "stuck_pipe_diff": "stuck_pipe",
    "stuck_pipe_mech": "stuck_pipe", "tight_hole": "stuck_pipe", "pack_off": "stuck_pipe", "hole_instability": "stuck_pipe",
    "torque_spike": "torque", "cement_failure": "cementing", "fishing": None, "equipment_failure": None, "other": None,
}
SEVERITY = {
    "loss_partial": (2, 3), "loss_total": (4, 5), "kick": (4, 5), "stuck_pipe_diff": (3, 5), "stuck_pipe_mech": (3, 5),
    "tight_hole": (1, 3), "pack_off": (3, 4), "hole_instability": (2, 4), "torque_spike": (1, 3), "cement_failure": (3, 4),
    "fishing": (3, 4),
}
EXTENT_M = {"loss_partial": (2, 6), "loss_total": (3, 10), "kick": (4, 12), "stuck_pipe_diff": (0, 3), "stuck_pipe_mech": (0, 3),
            "tight_hole": (2, 15), "pack_off": (1, 4), "hole_instability": (5, 25), "torque_spike": (3, 8), "cement_failure": (0, 5), "fishing": (0, 3)}


def uid(*parts: Any) -> str:
    return str(uuid.uuid5(NAMESPACE, ":".join(str(p) for p in parts)))


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_templates(path: Path = TEMPLATES_PATH) -> dict[str, dict[str, list[str]]]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ geometry helpers


def km_offsets(lon: float, lat: float, lon0: float, lat0: float) -> tuple[float, float]:
    """(east_km, north_km) of a point relative to a reference point."""
    return (lon - lon0) * 111.320 * math.cos(math.radians(lat0)), (lat - lat0) * 110.574


@dataclass
class Well:
    index: int
    code: str
    number: int
    name: str
    field: str
    cluster: str
    lon: float
    lat: float
    status: str  # completed | drilling | planned
    kind: str  # vertical | deviated | horizontal
    kb_elev_m: float = 0.0
    spud: dt.date = dt.date(2020, 1, 1)
    tops_tvd: dict[str, float] = field(default_factory=dict)
    tops_md: dict[str, float] = field(default_factory=dict)
    td_tvd_m: float = 0.0
    td_md_m: float = 0.0
    stations: dict[str, np.ndarray] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    start_md: float | None = None  # drilling wells: where the bit is now
    sections: list[dict[str, Any]] = field(default_factory=list)
    cement: list[dict[str, Any]] = field(default_factory=list)
    mud: list[dict[str, Any]] = field(default_factory=list)
    series: dict[str, np.ndarray] | None = None
    shoes: dict[str, float] = field(default_factory=dict)

    @property
    def wellbore_name(self) -> str:
        return f"{self.name}-WB1"

    @property
    def well_id(self) -> str:
        return uid("well", self.name)

    @property
    def wellbore_id(self) -> str:
        return uid("wellbore", self.name)


@dataclass
class SynthData:
    seed: int
    wells: list[Well]
    truth: dict[str, list[dict[str, Any]]]
    config: dict[str, Any]


def plan_survey(kind: str, td_tvd: float, rng: np.random.Generator, cfg: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Stations every `survey_step_m` from the surface until TVD reaches `td_tvd`: (md, inc, azi)."""
    step = float(cfg["survey_step_m"])
    md = np.arange(0.0, 9001.0, step)
    inc = np.zeros_like(md)
    azi = np.zeros_like(md)
    if kind != "vertical":
        p = cfg[kind]
        kop = rng.uniform(*p["kop_m"])
        build = rng.uniform(*p["build_deg_per_30m"])
        max_inc = rng.uniform(*p["max_inc_deg"])
        azimuth = rng.uniform(0.0, 360.0)
        inc = np.clip((md - kop) / step * build, 0.0, max_inc)
        azi = np.where(inc > 0, azimuth, 0.0)
    tvd, _, _, _ = mcm(md, inc, azi)
    last = int(np.argmax(tvd >= td_tvd)) if np.any(tvd >= td_tvd) else len(md) - 1
    return md[: last + 1], inc[: last + 1], azi[: last + 1]


def hazard_field(rng: np.random.Generator, wells: list[Well], fcfg: dict[str, Any]) -> np.ndarray:
    """A smooth random field (a few Gaussian bumps) evaluated at the wells, scaled to a mean of 0.5."""
    if not wells:
        return np.array([])
    lon0 = float(np.mean([w.lon for w in wells]))
    lat0 = float(np.mean([w.lat for w in wells]))
    xy = np.array([km_offsets(w.lon, w.lat, lon0, lat0) for w in wells])
    centres = rng.normal(0.0, 2.5, size=(int(fcfg["bumps"]), 2))
    widths = rng.uniform(*fcfg["width_km"], size=int(fcfg["bumps"]))
    amps = rng.uniform(0.4, 1.0, size=int(fcfg["bumps"]))
    d2 = ((xy[:, None, :] - centres[None, :, :]) ** 2).sum(-1)
    f = (amps[None, :] * np.exp(-d2 / (2 * widths[None, :] ** 2))).sum(1)
    f = f / max(f.mean(), 1e-9) * 0.5
    return np.clip(f, 0.0, 1.0)


# ------------------------------------------------------------------------------------------------ generation


def make_wells(cfg: dict[str, Any], rng: np.random.Generator) -> list[Well]:
    clusters = cfg["clusters"]
    drilling = cfg["drilling"]
    planned = cfg["planned"]
    wells: list[Well] = []
    idx = 0
    for c in clusters:
        for n in range(1, int(c["wells"]) + 1):
            east = rng.normal(0.0, float(c["spread_km"]))
            north = rng.normal(0.0, float(c["spread_km"]))
            lat = float(np.clip(c["lat"] + north / 110.574, 26.9, 27.6))
            lon = float(np.clip(c["lon"] + east / (111.320 * math.cos(math.radians(c["lat"]))), 94.8, 95.6))
            status = "drilling" if drilling.get(c["code"]) == n else "planned" if planned.get(c["code"]) == n else "completed"
            wells.append(Well(index=idx, code=c["code"], number=n, name=f"SYN-{c['code']}-{n:02d}", field=c["field"], cluster=c["code"],
                              lon=round(lon, 5), lat=round(lat, 5), status=status, kind="vertical"))
            idx += 1

    # trajectory kinds: 40 / 50 / 10 % of the wells that are drilled or completed, the planned well is vertical
    real = [w for w in wells if w.status != "planned"]
    mix = cfg["trajectory_mix"]
    counts = {k: int(len(real) * v) for k, v in mix.items()}
    remainders = sorted(mix, key=lambda k: -(len(real) * mix[k] - counts[k]))
    for k in remainders[: len(real) - sum(counts.values())]:
        counts[k] += 1
    pool = [k for k, c in counts.items() for _ in range(c)]
    # the demo wells are never horizontal; the rest are shuffled
    demo = [w for w in real if w.status == "drilling"]
    others = [w for w in real if w.status != "drilling"]
    demo_kinds = {"DLJ": "deviated", "NHK": "vertical", "MRN": "deviated"}
    for w in demo:
        k = demo_kinds.get(w.cluster, "deviated")
        pool.remove(k)
        w.kind = k
    for w, k in zip(others, rng.permutation(pool)):
        w.kind = str(k)
    return wells


def generate_geology(w: Well, cfg: dict[str, Any], rng: np.random.Generator, ref: tuple[float, float]) -> None:
    """KB, regional tops (TVD), TD, survey and the tops in MD."""
    w.kb_elev_m = round(float(rng.uniform(*cfg["kb_elev_m"])), 1)
    east, north = km_offsets(w.lon, w.lat, ref[0], ref[1])
    se_km = (east - north) / math.sqrt(2.0)
    tops = cfg["tops"]
    prev = None
    for name, spec in tops.items():
        tvd = float(spec["tvd"])
        if tvd > 0:
            tvd += cfg["dip_m_per_km_se"] * se_km + float(rng.normal(0.0, cfg["top_noise_sigma_m"]))
        if prev is not None:
            tvd = max(tvd, prev + float(cfg["min_thickness_m"]))
        w.tops_tvd[name] = round(tvd, 1)
        prev = tvd
    td = float(rng.uniform(*cfg["td_tvd_m"]))
    td = max(td, w.tops_tvd["Sylhet"] + 80.0)  # every well crosses at least the first 8 formations
    w.td_tvd_m = round(td, 1)
    md, inc, azi = plan_survey(w.kind, w.td_tvd_m, rng, cfg)
    tvd, north_m, east_m, dls = mcm(md, inc, azi)
    w.stations = {"md": md, "inc": inc, "azi": azi, "tvd": tvd, "north": north_m, "east": east_m, "dls": dls}
    w.td_md_m = float(md[-1])
    w.td_tvd_m = round(float(tvd[-1]), 1)
    w.tops_tvd = {k: v for k, v in w.tops_tvd.items() if v < w.td_tvd_m - 20.0}
    w.tops_md = {k: round(float(np.interp(v, tvd, md)), 1) for k, v in w.tops_tvd.items()}


def md_at_tvd(w: Well, tvd: float) -> float:
    return float(np.interp(tvd, w.stations["tvd"], w.stations["md"]))


def tvd_at_md(w: Well, md: float) -> float:
    return float(np.interp(md, w.stations["md"], w.stations["tvd"]))


def formation_at(w: Well, md: float) -> str:
    name = None
    for k, v in w.tops_md.items():
        if md >= v:
            name = k
    return name or next(iter(w.tops_md))


def formation_interval(w: Well, name: str) -> tuple[float, float]:
    """(md_top, md_base) of a formation in this well."""
    names = list(w.tops_md)
    i = names.index(name)
    top = w.tops_md[name]
    base = w.tops_md[names[i + 1]] if i + 1 < len(names) else w.td_md_m
    return top, base


def pick_md(w: Well, formation: str, where: str, rng: np.random.Generator) -> float:
    top, base = formation_interval(w, formation)
    lo, hi = {"lower_third": (2 / 3, 0.97), "middle": (0.3, 0.7), "anywhere": (0.05, 0.95)}[where]
    return round(top + float(rng.uniform(lo, hi)) * (base - top), 1)


def make_event(w: Well, etype: str, formation: str, md: float, rng: np.random.Generator, text: dict[str, Any], cfg: dict[str, Any],
               mw: float, serial: int) -> dict[str, Any]:
    top, base = formation_interval(w, formation)
    ext = EXTENT_M[etype]
    md_to = round(min(md + float(rng.uniform(*ext)), base - 0.5), 1)
    sev = int(rng.integers(SEVERITY[etype][0], SEVERITY[etype][1] + 1))
    npt = float(rng.lognormal(math.log(cfg["npt_median_h"]), cfg["npt_sigma"])) * (0.5 + sev / 6.0)
    npt = round(max(0.5, npt), 1)
    volume = None
    if etype == "loss_partial":
        volume = round(float(rng.lognormal(math.log(20), 0.6)), 1)
    elif etype == "loss_total":
        volume = round(float(rng.lognormal(math.log(100), 0.5)), 1)
    elif etype == "kick":
        volume = round(1.6 + float(rng.lognormal(math.log(2.5), 0.5)), 1)
    fmt = {"md": int(round(md)), "formation": formation, "vol": volume if volume is not None else 0, "npt": npt, "mw": f"{mw:.2f}"}
    t = text[etype]
    pick = lambda key: t[key][int(rng.integers(0, len(t[key])))].format(**fmt)  # noqa: E731
    spud = w.spud
    days = int((md / max(w.td_md_m, 1.0)) * float(rng.uniform(80, 140)))
    return {
        "id": uid("event", w.name, serial), "event_type": etype, "risk_type": RISK_OF[etype], "md_from_m": round(md, 1), "md_to_m": md_to,
        "formation": formation, "relative_depth": round(float(np.clip((md - top) / max(base - top, 1.0), 0, 1)), 3), "severity": sev,
        "npt_h": npt, "volume_m3": volume, "description": pick("description"), "cause": pick("cause"), "action": pick("action"),
        "outcome": pick("outcome"), "event_date": spud + dt.timedelta(days=days), "confidence": round(float(rng.uniform(0.9, 1.0)), 2),
    }


def mud_weight_at(w: Well, md: float, cfg: dict[str, Any], deep_extra: float) -> float:
    m = cfg["mud"]
    tvd = tvd_at_md(w, md)
    mw = m["mw_start_sg"] + (m["mw_end_sg"] - m["mw_start_sg"]) * min(tvd / 3900.0, 1.0)
    if formation_at(w, md) in ("Kopili", "Sylhet"):
        mw += deep_extra
    return round(mw, 3)


def generate_events(w: Well, cfg: dict[str, Any], rng: np.random.Generator, fields: dict[str, float], text: dict[str, Any]) -> None:
    hz = cfg["hazards"]
    mult = cfg.get("cluster_multiplier", {}).get(w.cluster, {})
    fcfg = cfg["field"]
    deep_extra = float(rng.uniform(*cfg["mud"]["deep_extra_sg"]))

    def p_eff(name: str) -> float:
        base = float(hz[name]["p"]) * float(mult.get(name, 1.0))
        return float(np.clip(base * (fcfg["floor"] + fcfg["gain"] * fields[name]), 0.0, 0.95))

    serial = 0
    wanted: list[tuple[str, str, str]] = []  # (event_type, formation, where)
    has = lambda n: n in w.tops_md  # noqa: E731

    if has("Tipam") and rng.random() < p_eff("tipam_losses"):
        total = rng.random() < hz["tipam_losses"]["total_share"]
        wanted.append(("loss_total" if total else "loss_partial", "Tipam", hz["tipam_losses"]["where"]))
    if has("Girujan") and rng.random() < p_eff("girujan_tight_hole"):
        wanted.append(("tight_hole", "Girujan", "anywhere"))
    if has("Barail"):
        if rng.random() < p_eff("barail_stuck_pipe"):
            wanted.append(("stuck_pipe_diff" if rng.random() < hz["barail_stuck_pipe"]["diff_share"] else "stuck_pipe_mech", "Barail", "anywhere"))
        if rng.random() < p_eff("barail_pack_off"):
            wanted.append(("pack_off", "Barail", "anywhere"))
        if rng.random() < p_eff("barail_torque"):
            wanted.append(("torque_spike", "Barail", "anywhere"))
        if rng.random() < p_eff("barail_instability"):
            wanted.append(("hole_instability", "Barail", "anywhere"))
    if has("Kopili") and rng.random() < p_eff("deep_kick"):
        wanted.append(("kick", "Kopili" if rng.random() < hz["deep_kick"]["kopili_share"] or not has("Sylhet") else "Sylhet", "anywhere"))
    if has("Sylhet") and rng.random() < p_eff("sylhet_losses"):
        wanted.append(("loss_partial", "Sylhet", "anywhere"))

    # the demo hazard of a drilling well is always there
    forced = None
    if w.status == "drilling":
        d = cfg["demo_hazard"][w.cluster]
        wanted = [x for x in wanted if x[0] != d["event_type"] or x[1] != d["formation"]]
        forced = (d["event_type"], d["formation"], d["where"])
        wanted.insert(0, forced)

    placed: list[dict[str, Any]] = []
    for etype, formation, where in wanted:
        for _ in range(8):  # keep events at least 40 m apart so their signatures do not overlap
            md = pick_md(w, formation, where, rng)
            if all(abs(md - e["md_from_m"]) >= 40.0 for e in placed):
                break
        else:
            if (etype, formation, where) != forced:
                continue
        mw = mud_weight_at(w, md, cfg, deep_extra)
        placed.append(make_event(w, etype, formation, md, rng, text, cfg, mw, serial))
        serial += 1

    # fishing after a severe stuck pipe; remedial cementing after Tipam losses
    for e in list(placed):
        if e["event_type"].startswith("stuck_pipe") and e["severity"] >= 4 and rng.random() < hz["fishing_after_stuck"]["p"]:
            md = round(e["md_from_m"] + 3.0, 1)
            placed.append(make_event(w, "fishing", e["formation"], md, rng, text, cfg, mud_weight_at(w, md, cfg, deep_extra), serial))
            serial += 1
    w.events = sorted(placed, key=lambda e: e["md_from_m"])
    w._deep_extra = deep_extra  # type: ignore[attr-defined]


def casing_program(w: Well, cfg: dict[str, Any], rng: np.random.Generator, text: dict[str, Any]) -> None:
    c = cfg["casing"]
    s1 = round(md_at_tvd(w, c["surface"]["shoe_tvd_m"]), 1)
    tipam = w.tops_tvd.get("Tipam", w.td_tvd_m * 0.55)
    s2 = round(md_at_tvd(w, tipam - c["intermediate"]["above_tipam_m"]), 1)
    prod = c["production"]["options"][0 if rng.random() < c["production"]["liner_share"] else 1]
    w.shoes = {"surface": s1, "intermediate": s2, "production": round(w.td_md_m, 1)}
    w.sections = [
        {"hole_size_in": c["surface"]["hole_in"], "md_from_m": 0.0, "md_to_m": s1, "casing_od_in": c["surface"]["od_in"],
         "casing_weight_ppf": c["surface"]["ppf"], "casing_grade": c["surface"]["grade"], "shoe_md_m": s1, "toc_md_m": 0.0},
        {"hole_size_in": c["intermediate"]["hole_in"], "md_from_m": s1, "md_to_m": s2, "casing_od_in": c["intermediate"]["od_in"],
         "casing_weight_ppf": c["intermediate"]["ppf"], "casing_grade": c["intermediate"]["grade"], "shoe_md_m": s2, "toc_md_m": max(s1 - 50.0, 0.0)},
        {"hole_size_in": c["production"]["hole_in"], "md_from_m": s2, "md_to_m": round(w.td_md_m, 1), "casing_od_in": prod["od_in"],
         "casing_weight_ppf": prod["ppf"], "casing_grade": prod["grade"], "shoe_md_m": round(w.td_md_m, 1), "toc_md_m": max(s2 - 150.0, 0.0)},
    ]
    had_tipam_losses = any(e["event_type"] in ("loss_partial", "loss_total") and e["formation"] == "Tipam" for e in w.events)
    for i, sec in enumerate(w.sections):
        issue = None
        cbl = str(rng.choice(["good", "good", "fair"]))
        if i == 1 and had_tipam_losses and rng.random() < cfg["hazards"]["cement_failure_after_tipam_losses"]["p"]:
            issue = str(rng.choice(["losses during displacement", "poor CBL across the shoe track"]))
            cbl = "poor"
        w.cement.append({
            "job_type": "primary", "casing_od_in": sec["casing_od_in"], "slurry_density_sg": round(float(rng.uniform(1.82, 1.95)), 2),
            "volume_m3": round(float(rng.uniform(25, 90)), 1), "returns_to_surface": i == 0 or bool(rng.random() < 0.5),
            "plug_bumped": True, "woc_h": round(float(rng.uniform(8, 16)), 1), "cbl_result": cbl, "issue": issue,
        })
    # a cement failure also shows up as an event at the intermediate shoe
    issue_job = w.cement[1]
    if issue_job["issue"] and not any(e["event_type"] == "cement_failure" for e in w.events):
        md = round(w.shoes["intermediate"] - 5.0, 1)
        fm = formation_at(w, md)
        ev = make_event(w, "cement_failure", fm, md, rng, text, cfg, mud_weight_at(w, md, cfg, getattr(w, "_deep_extra", 0.07)), 99)
        w.events.append(ev)
        w.events.sort(key=lambda e: e["md_from_m"])


def mud_program(w: Well, cfg: dict[str, Any], rng: np.random.Generator) -> None:
    every = float(cfg["mud"]["record_every_m"])
    deep = getattr(w, "_deep_extra", 0.07)
    for md in np.arange(100.0, w.td_md_m, every):
        mw = mud_weight_at(w, float(md), cfg, deep)
        section = 0 if md < w.shoes["surface"] else 1 if md < w.shoes["intermediate"] else 2
        frac = md / w.td_md_m
        w.mud.append({
            "report_date": w.spud + dt.timedelta(days=int(frac * 110)), "md_m": float(md),
            "mud_type": ("Spud mud (bentonite)", "KCl-polymer WBM", "KCl-polymer WBM")[section], "mw_sg": mw,
            "pv_cp": round(8 + 14 * (mw - 1.0) + float(rng.normal(0, 1)), 1), "yp_lbf100ft2": round(9 + 8 * (mw - 1.0) + float(rng.normal(0, 1.2)), 1),
            "gel10s_lbf100ft2": round(float(rng.uniform(3, 8)), 1), "gel10m_lbf100ft2": round(float(rng.uniform(8, 18)), 1),
            "filtrate_ml": round(float(rng.uniform(4, 8)), 1), "ecd_sg": round(mw + 0.02 + 0.00002 * md + float(rng.normal(0, 0.003)), 3),
            "chlorides_mgl": round(float(rng.uniform(20000, 45000)), -2),
        })


def set_start_depth(w: Well, cfg: dict[str, Any], rng: np.random.Generator) -> dict[str, list[dict[str, Any]]]:
    """Drilling wells: the bit is `hazard_ahead_m` above the demo hazard; later events are hidden (truth files)."""
    d = cfg["demo_hazard"][w.cluster]
    demo = next(e for e in w.events if e["event_type"] == d["event_type"] and e["formation"] == d["formation"])
    ahead = float(rng.uniform(*cfg["hazard_ahead_m"]))
    w.start_md = round(demo["md_from_m"] - ahead, 1)
    hidden = [e for e in w.events if e["md_from_m"] > w.start_md]
    return {w.name: [{"event_type": e["event_type"], "md_from_m": e["md_from_m"], "md_to_m": e["md_to_m"], "formation": e["formation"]} for e in hidden]}


def generate(seed: int = 42, cfg: dict[str, Any] | None = None, with_series: bool = True) -> SynthData:
    cfg = cfg or load_config()
    text = load_templates()
    rng = np.random.default_rng(seed)
    wells = make_wells(cfg, rng)
    ref = (float(cfg["clusters"][0]["lon"]), float(cfg["clusters"][0]["lat"]))

    # hazard fields per cluster and hazard
    fields: dict[str, dict[str, float]] = {w.name: {} for w in wells}
    for c in cfg["clusters"]:
        members = [w for w in wells if w.cluster == c["code"]]
        for name in cfg["hazards"]:
            f = hazard_field(rng, members, cfg["field"])
            for w, v in zip(members, f):
                fields[w.name][name] = float(v)

    truth: dict[str, list[dict[str, Any]]] = {}
    for w in wells:
        wrng = np.random.default_rng([seed, w.index])  # every well has its own stream: adding a well never reshuffles the others
        year0, year1 = cfg["series"]["start_year"]
        w.spud = (dt.date(2026, 8, 1) if w.status == "drilling" else dt.date(int(wrng.integers(year0, year1)), int(wrng.integers(1, 13)), int(wrng.integers(1, 28))))
        generate_geology(w, cfg, wrng, ref)
        if w.status == "planned":
            continue
        generate_events(w, cfg, wrng, fields[w.name], text)
        casing_program(w, cfg, wrng, text)
        mud_program(w, cfg, wrng)
        if w.status == "drilling":
            truth.update(set_start_depth(w, cfg, wrng))
        if with_series:
            mixes = [cfg["tops"][k]["lithology"] for k in w.tops_md]
            t0 = dt.datetime.combine(w.spud, dt.time(6, 0), tzinfo=dt.timezone.utc)
            mud_md = np.array([m["md_m"] for m in w.mud])
            mud_mw = np.array([m["mw_sg"] for m in w.mud])
            w.series = generate_series(
                wrng, md_td=w.td_md_m, step=float(cfg["series"]["step_m"]), stations_md=w.stations["md"], stations_tvd=w.stations["tvd"],
                stations_inc=w.stations["inc"], tops_md=np.array(list(w.tops_md.values())), mixes=mixes, shoe1_md=w.shoes["surface"],
                shoe2_md=w.shoes["intermediate"], mud_md=np.concatenate([[0.0], mud_md]), mud_mw=np.concatenate([[mud_mw[0]], mud_mw]),
                events=w.events, t0=t0, stand_m=float(cfg["series"]["stand_m"]), connection_s=float(cfg["series"]["connection_s"]),
            )
    return SynthData(seed=seed, wells=wells, truth=truth, config=cfg)


# ------------------------------------------------------------------------------------------------ what goes into the database


def visible(w: Well, md: float) -> bool:
    """A drilling well only has records above the bit; everything else is withheld."""
    return w.status != "drilling" or md <= (w.start_md or 0.0)


def table_rows(data: SynthData) -> dict[str, list[tuple]]:
    rows: dict[str, list[tuple]] = {k: [] for k in (
        "wells", "wellbores", "survey_stations", "formation_tops", "hole_sections", "cement_jobs", "mud_records", "events", "depth_series", "stream_state")}
    for w in data.wells:
        wid, wbid = w.well_id, w.wellbore_id
        td_md = round(w.td_md_m, 1)
        rows["wells"].append((wid, w.name, w.field, data.config["basin"], data.config["operator"], f"SRID=4326;POINT({w.lon} {w.lat})", "WGS84",
                              w.kb_elev_m, w.spud, td_md, w.td_tvd_m, w.status, "synthetic"))
        rows["wellbores"].append((wbid, wid, w.wellbore_name, w.kind, True))
        s = w.stations
        for i in range(len(s["md"])):
            rows["survey_stations"].append((wbid, float(s["md"][i]), float(s["inc"][i]), float(s["azi"][i]), float(s["tvd"][i]),
                                            float(s["north"][i]), float(s["east"][i]), float(s["dls"][i])))
        for name, md in w.tops_md.items():
            if w.status == "planned":
                source = "prognosis"
            elif visible(w, md):
                source = "actual"
            else:
                continue
            rows["formation_tops"].append((wbid, name, md, round(w.tops_tvd[name] - w.kb_elev_m, 1), source, "synthetic"))
        if w.status == "planned":
            continue
        for sec, job in zip(w.sections, w.cement):
            done = visible(w, sec["md_to_m"])
            started = visible(w, sec["md_from_m"])
            if w.status == "drilling" and not done:
                if started:  # the section being drilled now: no casing yet
                    rows["hole_sections"].append((wbid, sec["hole_size_in"], sec["md_from_m"], None, None, None, None, None, None, False, "synthetic"))
                continue
            rows["hole_sections"].append((wbid, sec["hole_size_in"], sec["md_from_m"], sec["md_to_m"], sec["casing_od_in"], sec["casing_weight_ppf"],
                                          sec["casing_grade"], sec["shoe_md_m"], sec["toc_md_m"], False, "synthetic"))
            rows["cement_jobs"].append((wbid, job["job_type"], job["casing_od_in"], job["slurry_density_sg"], job["volume_m3"], job["returns_to_surface"],
                                        job["plug_bumped"], job["woc_h"], job["cbl_result"], job["issue"], "synthetic"))
        for m in w.mud:
            if visible(w, m["md_m"]):
                rows["mud_records"].append((wbid, m["report_date"], m["md_m"], m["mud_type"], m["mw_sg"], m["pv_cp"], m["yp_lbf100ft2"], m["gel10s_lbf100ft2"],
                                            m["gel10m_lbf100ft2"], m["filtrate_ml"], m["ecd_sg"], m["chlorides_mgl"], "synthetic"))
        for e in w.events:
            if visible(w, e["md_from_m"]):
                rows["events"].append((e["id"], wbid, e["event_type"], e["risk_type"], e["md_from_m"], e["md_to_m"], e["formation"], e["relative_depth"], e["severity"],
                                       e["npt_h"], e["volume_m3"], e["description"], e["cause"], e["action"], e["outcome"], e["event_date"], e["confidence"],
                                       "synthetic", "approved"))
        if w.series is not None:
            ser = w.series
            n = len(ser["md_m"])
            cols = [ser["md_m"].tolist(), ser["t"].tolist()] + [
                np.round(ser[c], 3).tolist()
                for c in ("rop_m_h", "wob_kn", "rpm", "torque_knm", "spp_bar", "flow_in_lpm", "flow_out_lpm", "pit_vol_m3", "hookload_kn",
                          "mw_sg", "ecd_sg", "gas_total_pct", "dxc", "gr_api")
            ]
            rows["depth_series"].extend(zip([wbid] * n, *cols))
        if w.status == "drilling":
            rows["stream_state"].append((wbid, "stopped", "synthetic", 1, w.start_md, w.start_md))
    return rows


COLUMNS = {
    "wells": ("id", "name", "field", "basin", "operator", "surface", "datum_src", "kb_elev_m", "spud_date", "td_md_m", "td_tvd_m", "status", "provenance"),
    "wellbores": ("id", "well_id", "name", "kind", "is_primary"),
    "survey_stations": ("wellbore_id", "md_m", "inc_deg", "azi_deg", "tvd_m", "north_m", "east_m", "dls_deg_per_30m"),
    "formation_tops": ("wellbore_id", "formation", "top_md_m", "top_tvdss_m", "source", "provenance"),
    "hole_sections": ("wellbore_id", "hole_size_in", "md_from_m", "md_to_m", "casing_od_in", "casing_weight_ppf", "casing_grade", "shoe_md_m", "toc_md_m", "planned", "provenance"),
    "cement_jobs": ("wellbore_id", "job_type", "casing_od_in", "slurry_density_sg", "volume_m3", "returns_to_surface", "plug_bumped", "woc_h", "cbl_result", "issue", "provenance"),
    "mud_records": ("wellbore_id", "report_date", "md_m", "mud_type", "mw_sg", "pv_cp", "yp_lbf100ft2", "gel10s_lbf100ft2", "gel10m_lbf100ft2", "filtrate_ml", "ecd_sg", "chlorides_mgl", "provenance"),
    "events": ("id", "wellbore_id", "event_type", "risk_type", "md_from_m", "md_to_m", "formation", "relative_depth", "severity", "npt_h", "volume_m3",
               "description", "cause", "action", "outcome", "event_date", "confidence", "provenance", "review_status"),
    "depth_series": SERIES_COLUMNS[:1] + SERIES_COLUMNS[1:],
    "stream_state": ("wellbore_id", "status", "source", "speed", "bit_md_m", "hole_md_m"),
}
LOAD_ORDER = ("wells", "wellbores", "survey_stations", "formation_tops", "hole_sections", "cement_jobs", "mud_records", "events", "depth_series", "stream_state")


def write_truth(data: SynthData, directory: Path = TRUTH_DIR) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    out = []
    for name, items in data.truth.items():
        path = directory / f"{name}.json"
        path.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
        out.append(path)
    return out


def summary(data: SynthData) -> str:
    lines = []
    status = Counter(w.status for w in data.wells)
    kinds = Counter(w.kind for w in data.wells if w.status != "planned")
    lines.append(f"wells: {len(data.wells)}  status {dict(status)}  trajectories {dict(kinds)}")
    ev = Counter((e["formation"], e["risk_type"] or "-") for w in data.wells for e in w.events)
    lines.append("events by formation x risk type:")
    risks = ["losses", "stuck_pipe", "kick", "torque", "cementing", "-"]
    lines.append(f"  {'formation':12}" + "".join(f"{r:>12}" for r in risks))
    for f in data.config["tops"]:
        if any(ev[(f, r)] for r in risks):
            lines.append(f"  {f:12}" + "".join(f"{ev[(f, r)]:>12}" for r in risks))
    for w in data.wells:
        if w.status == "drilling":
            hidden = data.truth[w.name]
            lines.append(f"  {w.name}: bit at {w.start_md:.0f} m of {w.td_md_m:.0f} m, {len(hidden)} hidden event(s), next {hidden[0]['event_type']} at {hidden[0]['md_from_m']:.0f} m")
    return "\n".join(lines)


def reset(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("delete from wells where provenance = 'synthetic'")
        return cur.rowcount


def load(conn, data: SynthData) -> dict[str, int]:
    rows = table_rows(data)
    counts: dict[str, int] = {}
    for table in LOAD_ORDER:
        counts[table] = copy_rows(conn, table, COLUMNS[table], rows[table])
    for w in data.wells:
        build_trajectory(conn, w.wellbore_id)
    return counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=None, help="random seed (default: the one in synth_config.yaml)")
    ap.add_argument("--reset", action="store_true", help="delete the synthetic rows first (provenance = 'synthetic')")
    ap.add_argument("--dry-run", action="store_true", help="generate and print the summary, do not touch the database")
    ap.add_argument("--no-truth", action="store_true", help="do not write db/data/synth_truth/*.json")
    args = ap.parse_args(argv)

    cfg = load_config()
    seed = args.seed if args.seed is not None else int(cfg["seed"])
    data = generate(seed, cfg)
    print(summary(data))
    if not args.no_truth:
        for p in write_truth(data):
            print("truth:", p.relative_to(REPO_ROOT))
    if args.dry_run:
        return 0
    with get_conn() as conn:
        try:
            if args.reset:
                print("deleted wells:", reset(conn))
            counts = load(conn, data)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    print("loaded:", counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

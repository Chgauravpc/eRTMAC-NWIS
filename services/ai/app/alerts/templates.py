"""Alert wording built from the evidence (BE-19, contract §11.6). No number in a title or message
is written by hand: every one comes from the evidence or the score."""

from __future__ import annotations

from typing import Any

from app.risk import config

RISK_LABELS = {
    "losses": "Mud loss",
    "stuck_pipe": "Stuck pipe",
    "kick": "Kick / overpressure",
    "torque": "Torque spike",
    "cementing": "Cementing problem",
}
AHEAD_ROUND_M = 5  # "~120 m ahead" is rounded to the nearest 5 m
STREAM_LOST_TITLE = "Live data lost"


def risk_label(risk_type: str | None) -> str:
    return RISK_LABELS.get(risk_type or "", (risk_type or "Risk").replace("_", " ").capitalize())


def title(risk_type: str, formation: str | None, kind: str, ahead_m: float) -> str:
    """e.g. "Stuck pipe risk ~120 m ahead (Barail)" or "Mud loss signature at the bit (Tipam)"."""
    where = f" ({formation})" if formation else ""
    if kind == "detector":
        return f"{risk_label(risk_type)} signature at the bit{where}"
    ahead = max(0, int(round(ahead_m / AHEAD_ROUND_M) * AHEAD_ROUND_M))
    return f"{risk_label(risk_type)} risk ~{ahead} m ahead{where}"


def _event_words(event_types: list[str]) -> str:
    unique = list(dict.fromkeys(t.replace("_", " ") for t in event_types))
    return ", ".join(unique[:-1]) + f" or {unique[-1]}" if len(unique) > 1 else unique[0]


def _detector_summary(detector: dict[str, Any]) -> str:
    signal = ", ".join(f"{key.replace('_', ' ')} {value}" for key, value in (detector.get("signal") or {}).items())
    return f"{detector['name'].replace('_', ' ')} detector fired" + (f" ({signal})" if signal else "")


def message(
    kind: str, risk_type: str, formation: str | None, score: float, evidence: dict[str, Any]
) -> str:
    """One sentence from the evidence: offsets with matching events and their average NPT, or the detector."""
    if kind == "detector" and evidence.get("detector"):
        return _detector_summary(evidence["detector"]) + "."
    offsets = [o for o in evidence.get("offsets", []) if o.get("events")]
    events = [e for o in offsets for e in o["events"]]
    if not events:
        return f"{risk_label(risk_type)} risk scored {score:.0f} of 100" + (f" in {formation}" if formation else "") + "."

    wells = len(offsets)
    km = max(o["depth_distance_m"] for o in offsets) / 1000.0
    here = f" in {formation}" if formation else " here"
    sentence = (
        f"{wells} offset well{'' if wells == 1 else 's'} within {km:.1f} km had "
        f"{_event_words([e['event_type'] for e in events])}{here}"
    )
    npt = [e["npt_h"] for e in events if e.get("npt_h") is not None]
    if npt:
        sentence += f"; average NPT {sum(npt) / len(npt):.0f} h"
    return sentence + "."


def band_threshold(severity: str) -> float:
    """Lower score bound of the band an alert severity comes from (info 20, watch 40, warning 60, critical 80)."""
    return {
        "info": config.BAND_LOW_MAX,
        "watch": config.BAND_MODERATE_MAX,
        "warning": config.BAND_ELEVATED_MAX,
        "critical": config.BAND_HIGH_MAX,
    }[severity]


def stream_lost_message(age_s: float) -> str:
    return f"No samples received for {age_s:.0f} s; look-ahead alerts are not auto-resolved while data is lost."

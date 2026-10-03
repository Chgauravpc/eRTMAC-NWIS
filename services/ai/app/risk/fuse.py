"""Fusion, bands, confidence and risk storage (BE-17, contract §11.1, §11.5, §6 risk_scores).

    fused = 100 * calibrate(W_L1*l1 + W_L2*l2 + W_L3*l3)   weights renormalised over the layers present
    a fired detector raises fused to at least its floor.

L2 (BE-16) is optional: `app.risk.l2` may be missing or have no active model, and then L1 and L3 carry
the score. Live detector evidence (L3) only exists for the interval the bit is in; intervals ahead of
the bit get L1 (and L2).
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Callable

from psycopg.types.json import Jsonb

from app import db
from app.errors import NwisError
from app.logging import get_logger
from app.models.enums import AlertSeverity, ConfidenceLevel, RiskBand
from app.risk import config, l1 as l1_module, l3 as l3_module

logger = get_logger(__name__)

DEEPEST_TOP_MARGIN_M = 20.0  # bit depth when not streaming: deepest actual top + this
MAX_WINDOW_M = 1000.0
L2_MAX_REASONS = 5

Calibrator = Callable[[float], float]


# ---------------------------------------------------------------- bands, severity, fusion, confidence


def band_for(score: float) -> str:
    """§11.1: score <= 20 low; 20 < s <= 40 moderate; 40 < s <= 60 elevated; 60 < s <= 80 high; else critical."""
    if score <= config.BAND_LOW_MAX:
        return RiskBand.LOW.value
    if score <= config.BAND_MODERATE_MAX:
        return RiskBand.MODERATE.value
    if score <= config.BAND_ELEVATED_MAX:
        return RiskBand.ELEVATED.value
    if score <= config.BAND_HIGH_MAX:
        return RiskBand.HIGH.value
    return RiskBand.CRITICAL.value


_SEVERITY = {
    RiskBand.LOW.value: None,
    RiskBand.MODERATE.value: AlertSeverity.INFO.value,
    RiskBand.ELEVATED.value: AlertSeverity.WATCH.value,
    RiskBand.HIGH.value: AlertSeverity.WARNING.value,
    RiskBand.CRITICAL.value: AlertSeverity.CRITICAL.value,
}


def severity_for(band: str) -> str | None:
    """Alert severity of a band (None for low: no alert)."""
    return _SEVERITY[band]


def fuse(
    l1: float | None,
    l2: float | None,
    l3: float | None,
    detector_floor: float | None = None,
    calibrator: Calibrator | None = None,
) -> float | None:
    """Fused score 0-100, or None when no layer has a value (no score for that interval)."""
    layers = [(config.W_L1, l1), (config.W_L2, l2), (config.W_L3, l3)]
    present = [(w, v) for w, v in layers if v is not None]
    if not present:
        return None
    combined = sum(w * v for w, v in present) / sum(w for w, _ in present)
    if calibrator is not None:
        combined = calibrator(combined)
    fused = 100.0 * min(1.0, max(0.0, combined))
    if detector_floor is not None:
        fused = max(fused, float(detector_floor))
    return fused


def confidence_for(
    n_offsets: int, mean_event_conf: float | None, n_unreviewed: int = 0
) -> tuple[str, str]:
    """(level, reason) per §11.5. A missing mean (no matching events) cannot reach the confidence thresholds."""
    strong = mean_event_conf is not None
    if n_offsets >= config.CONF_HIGH_MIN_OFFSETS and strong and mean_event_conf >= config.CONF_HIGH_MIN_EVENT_CONF:
        level = ConfidenceLevel.HIGH
    elif n_offsets >= config.CONF_MEDIUM_MIN_OFFSETS or (strong and mean_event_conf >= config.CONF_MEDIUM_MIN_EVENT_CONF):
        level = ConfidenceLevel.MEDIUM
    else:
        level = ConfidenceLevel.LOW

    parts = [f"{n_offsets} offset{'' if n_offsets == 1 else 's'} within {config.RADIUS_M / 1000:g} km"]
    parts.append(f"mean event confidence {mean_event_conf:.2f}" if strong else "no matching offset events")
    if n_unreviewed:
        parts.append(f"{n_unreviewed} unreviewed event{'' if n_unreviewed == 1 else 's'}")
    return level.value, "; ".join(parts)


def build_reasons(
    l1_reasons: list[dict[str, Any]],
    shap: list[dict[str, Any]] | None,
    detector: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """L1 offset events, then the L2 SHAP top features, then the detector that fired (if any)."""
    reasons = list(l1_reasons)
    reasons += [{"kind": "shap", "feature": s["feature"], "value": s["value"]} for s in (shap or [])[:L2_MAX_REASONS]]
    if detector is not None:
        reasons.append({"kind": "detector", **detector})
    return reasons


# ---------------------------------------------------------------- L2 and L3 inputs


async def _l2_inputs(
    wellbore_id: str, results: list[l1_module.L1Result]
) -> tuple[dict[tuple[float, str], tuple[float, list[dict[str, Any]], str | None]], Callable[[str], Calibrator | None] | None]:
    """L2 predictions keyed by (md_from_m, risk_type) -> (probability, shap top features, model_version), and
    the per-risk-type calibrator lookup (`l2.calibrator_for`), both empty when there is no L2."""
    try:
        from app.risk import l2
    except ImportError:
        return {}, None
    calibrator_for = getattr(l2, "calibrator_for", None)
    predict = getattr(l2, "predict_intervals", None)
    if predict is None:
        return {}, calibrator_for
    try:
        return await predict(wellbore_id, results), calibrator_for
    except Exception:  # noqa: BLE001 - a broken model must not take the risk score down
        logger.exception("l2_predict_failed wellbore_id=%s", wellbore_id)
        return {}, calibrator_for


def detector_state(wellbore_id: str) -> tuple[dict[str, float | None], dict[str, dict[str, Any]]]:
    """(l3 per risk type, the highest-floor fired detector per risk type) from the wellbore's live bank."""
    bank = l3_module.existing_bank(wellbore_id)
    if bank is None or not bank.latest:
        return {}, {}
    fired: dict[str, dict[str, Any]] = {}
    for result in bank.latest:
        if result.fired and (result.risk_type not in fired or result.floor > fired[result.risk_type]["floor"]):
            fired[result.risk_type] = {"name": result.name, "signal": result.signal, "floor": result.floor}
    return l3_module.l3_by_risk(bank.latest), fired


# ---------------------------------------------------------------- compute and store


async def bit_depth(wellbore_id: str) -> float:
    """Bit depth from stream_state, else the deepest actual top + DEEPEST_TOP_MARGIN_M."""
    if await db.fetch_one("select id from wellbores where id = %(id)s", {"id": wellbore_id}) is None:
        raise NwisError("NWIS_NOT_FOUND", "Wellbore not found", 404, {"wellbore_id": wellbore_id})
    streaming = await db.fetch_one("select bit_md_m from stream_state where wellbore_id = %(id)s", {"id": wellbore_id})
    if streaming and streaming["bit_md_m"] is not None:
        return float(streaming["bit_md_m"])
    deepest = await db.fetch_one(
        "select max(top_md_m) as md from formation_tops where wellbore_id = %(id)s and source = 'actual'",
        {"id": wellbore_id},
    )
    if deepest and deepest["md"] is not None:
        return float(deepest["md"]) + DEEPEST_TOP_MARGIN_M
    raise NwisError(
        "NWIS_BAD_STATE", "No bit depth: the wellbore is not streaming and has no actual formation tops", 409,
        {"wellbore_id": wellbore_id},
    )  # fmt: skip


def score_rows(
    wellbore_id: str,
    results: list[l1_module.L1Result],
    bit_md_m: float,
    l2_by_key: dict[tuple[float, str], tuple[float, list[dict[str, Any]], str | None]],
    calibrator_for: Callable[[str], Calibrator | None] | None,
    l3_by_risk: dict[str, float | None],
    fired: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """risk_scores rows (one per interval x risk type with a non-null score)."""
    rows = []
    for r in results:
        at_bit = r.md_from_m <= bit_md_m < r.md_to_m
        l2_value, shap, model_version = l2_by_key.get((r.md_from_m, r.risk_type), (None, None, None))
        l3_value = l3_by_risk.get(r.risk_type) if at_bit else None
        detector = fired.get(r.risk_type) if at_bit else None
        calibrator = calibrator_for(r.risk_type) if calibrator_for else None
        fused = fuse(r.l1, l2_value, l3_value, detector["floor"] if detector else None, calibrator)
        if fused is None:
            continue
        level, reason = confidence_for(r.n_offsets, r.mean_event_conf, r.n_unreviewed_events)
        rows.append(
            {
                "wellbore_id": wellbore_id,
                "md_from_m": r.md_from_m,
                "md_to_m": r.md_to_m,
                "risk_type": r.risk_type,
                "l1": r.l1,
                "l2": l2_value,
                "l3": l3_value,
                "fused": fused,
                "band": band_for(fused),
                "confidence": level,
                "confidence_reason": reason,
                "reasons": build_reasons(r.reasons, shap, detector),
                "formation": r.formation,
                "model_version": model_version,
            }
        )
    return rows


_UPSERT = """
    insert into risk_scores (wellbore_id, md_from_m, md_to_m, risk_type, l1, l2, l3, fused, band, confidence,
                             confidence_reason, reasons, formation, model_version, computed_at)
    values (%(wellbore_id)s, %(md_from_m)s, %(md_to_m)s, %(risk_type)s::risk_type, %(l1)s, %(l2)s, %(l3)s,
            %(fused)s, %(band)s::risk_band, %(confidence)s::confidence_level, %(confidence_reason)s,
            %(reasons)s, %(formation)s, %(model_version)s, %(computed_at)s)
    on conflict (wellbore_id, md_from_m, risk_type) do update
    set md_to_m = excluded.md_to_m, l1 = excluded.l1, l2 = excluded.l2, l3 = excluded.l3,
        fused = excluded.fused, band = excluded.band, confidence = excluded.confidence,
        confidence_reason = excluded.confidence_reason, reasons = excluded.reasons,
        formation = excluded.formation, model_version = excluded.model_version,
        computed_at = excluded.computed_at
"""


async def compute_and_store(
    wellbore_id: str, md_from: float | None = None, md_to: float | None = None
) -> list[dict[str, Any]]:
    """Score the window (default: the 25 m grid cell of the bit to bit + 300 m), upsert risk_scores and return the rows.

    The default window is anchored to multiples of INTERVAL_M, not to the bit: the primary key includes md_from_m,
    so a grid that moves with the bit writes a new set of rows at every depth and never overwrites the old ones
    (found on the first run against a real database: 268 distinct md_from_m for one well, overlapping and stale).
    """
    bit = await bit_depth(wellbore_id)
    default_window = md_from is None and md_to is None
    if md_from is None:
        start = math.floor(bit / config.INTERVAL_M) * config.INTERVAL_M
    else:
        start = md_from
    if md_to is None:
        reach = bit if md_from is None else start  # the default window reaches LOOKAHEAD_MAX_M past the bit
        end = start + math.ceil((reach + config.LOOKAHEAD_MAX_M - start) / config.INTERVAL_M) * config.INTERVAL_M
    else:
        end = md_to
    if end <= start or end - start > MAX_WINDOW_M:
        raise NwisError(
            "NWIS_BAD_REQUEST", f"md_to must be above md_from, at most {MAX_WINDOW_M:g} m apart", 400,
            {"md_from_m": start, "md_to_m": end},
        )  # fmt: skip

    l1_results = await l1_module.l1_scores(
        wellbore_id, start, n_intervals=math.ceil((end - start) / config.INTERVAL_M)
    )
    l2_by_key, calibrator_for = await _l2_inputs(wellbore_id, l1_results)
    l3_by_risk, fired = detector_state(wellbore_id)
    rows = score_rows(wellbore_id, l1_results, bit, l2_by_key, calibrator_for, l3_by_risk, fired)

    computed_at = datetime.now(timezone.utc)
    if rows:
        await db.execute_many(
            _UPSERT,
            [{**row, "reasons": Jsonb(row["reasons"]), "computed_at": computed_at} for row in rows],
        )
    if default_window and rows:
        # rows ahead of the window start that this run did not refresh come from an older grid or run: drop them
        await db.execute(
            "delete from risk_scores where wellbore_id = %(id)s and md_from_m >= %(start)s and computed_at < %(at)s",
            {"id": wellbore_id, "start": start, "at": computed_at},
        )
    logger.info("risk_scores_stored wellbore_id=%s rows=%d bit=%.1f", wellbore_id, len(rows), bit)
    stamp = computed_at.isoformat()
    return [{**row, "computed_at": stamp} for row in rows]

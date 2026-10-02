"""Risk layer L2: the trained models at inference time (BE-16, contract §11.5).

Active models are listed in `model_runs` (is_active) and stored as joblib artifacts in the `models` bucket:
{version, risk_type, model, feature_names, calibrator, trained_at, metrics}. They are loaded at startup and
after a retrain (`load_active`). The artifacts are pickles written by our own training code into a private
bucket; never load one from anywhere else.

One L2 probability per risk type describes the look-ahead window of the bit (an event 50-300 m below it), so
`predict_intervals` gives every interval that starts 50-300 m below the bit that same value. Feature
contributions are TreeSHAP values from LightGBM itself (`pred_contrib`), which equal `shap.TreeExplainer`'s.
"""

from __future__ import annotations

import asyncio
import io
import math
import time
from typing import Any, Callable

import joblib
import pandas as pd

from app import db, storage
from app.logging import get_logger
from app.risk import config

logger = get_logger(__name__)

SHAP_TOP_N = 5
LOOKBACK_M = 200.0  # depth_series read below the bit for the trailing statistics and latest mud values
POOL_TTL_S = 600.0

_models: dict[str, dict[str, Any]] = {}
_pool: tuple[float, list[Any], dict[str, int]] | None = None


# ---------------------------------------------------------------- loading


async def load_active() -> int:
    """Load every active model from the `models` bucket. Returns how many were loaded."""
    rows = await db.fetch_all(
        "select risk_type::text as risk_type, version, artifact_path from model_runs "
        "where is_active and artifact_path is not null"
    )
    loaded: dict[str, dict[str, Any]] = {}
    for row in rows:
        try:
            data = await asyncio.to_thread(storage.download, "models", row["artifact_path"])
            loaded[row["risk_type"]] = joblib.load(io.BytesIO(data))
        except Exception:  # noqa: BLE001 - one bad artifact must not hide the others
            logger.exception("l2_model_load_failed version=%s", row["version"])
    _models.clear()
    _models.update(loaded)
    logger.info("l2_models_loaded versions=%s", {k: v["version"] for k, v in _models.items()})
    return len(_models)


def set_models(models: dict[str, dict[str, Any]]) -> None:
    """Replace the loaded models (used by tests and after training in-process)."""
    _models.clear()
    _models.update(models)


def active_versions() -> dict[str, str]:
    return {risk: artifact["version"] for risk, artifact in _models.items()}


def calibrator_for(risk_type: str) -> Callable[[float], float] | None:
    """The isotonic calibration of a risk type's combined score, or None when it has none (identity)."""
    calibrator = _models.get(risk_type, {}).get("calibrator")
    if calibrator is None:
        return None
    return lambda x: float(calibrator.predict([x])[0])


# ---------------------------------------------------------------- scoring


def predict_features(risk_type: str, feature_row: dict[str, float]) -> tuple[float, list[dict[str, Any]], str] | None:
    """(probability, top SHAP features, model version) for one feature row, or None if no model is loaded."""
    artifact = _models.get(risk_type)
    if artifact is None:
        return None
    x = pd.DataFrame([{name: feature_row.get(name, math.nan) for name in artifact["feature_names"]}])
    probability = float(artifact["model"].predict_proba(x)[0, 1])
    contributions = artifact["model"].booster_.predict(x, pred_contrib=True)[0][:-1]  # last column is the bias
    ranked = sorted(zip(artifact["feature_names"], contributions), key=lambda fc: abs(fc[1]), reverse=True)
    shap = [{"feature": name, "value": round(float(value), 3)} for name, value in ranked[:SHAP_TOP_N]]
    return probability, shap, artifact["version"]


async def _offset_pool() -> tuple[list[Any], dict[str, int]]:
    """Completed wells for the offset-based features (cached: loading them reads every depth series)."""
    global _pool
    if _pool is None or time.monotonic() - _pool[0] > POOL_TTL_S:
        from training import features

        wells, strat_order = await features.load_wells()
        _pool = (time.monotonic(), wells, strat_order)
    return _pool[1], _pool[2]


async def current_features(wellbore_id: str, bit_md_m: float) -> dict[str, dict[str, float]]:
    """Feature row per risk type for the wellbore with the bit at `bit_md_m` (reads only data at or above it)."""
    from training import features

    pool, strat_order = await _offset_pool()
    well = await features.load_well_at(wellbore_id, bit_md_m, LOOKBACK_M)
    others = [w for w in pool if w.wellbore_id != wellbore_id]
    thickness = features.thickness_by_formation(others, strat_order)
    base, formation, top = features.base_features(well, bit_md_m, strat_order, thickness)
    offset = features.offset_features(well, bit_md_m, formation, top, base["relative_depth"], others)
    return {
        risk: {**base, "l1": offset[f"l1_{risk}"], "nearest_event_dist_m": offset[f"nearest_{risk}"]}
        for risk in features.RISK_TYPES
    }


async def predict_intervals(wellbore_id: str, l1_results: list[Any]) -> dict[tuple[float, str], tuple[float, list[dict[str, Any]], str | None]]:
    """L2 for the look-ahead intervals: {(md_from_m, risk_type): (probability, shap top features, version)}."""
    if not _models:
        return {}
    from app.risk import fuse

    bit = await fuse.bit_depth(wellbore_id)
    rows = await current_features(wellbore_id, bit)
    prediction = {risk: predict_features(risk, rows[risk]) for risk in _models if risk in rows}
    out = {}
    for result in l1_results:
        ahead = result.md_from_m - bit
        found = prediction.get(result.risk_type)
        if found is not None and config.LOOKAHEAD_MIN_M <= ahead <= config.LOOKAHEAD_MAX_M:
            out[(result.md_from_m, result.risk_type)] = found
    return out

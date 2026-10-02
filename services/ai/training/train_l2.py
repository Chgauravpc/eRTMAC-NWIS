"""Train, validate, calibrate and save the L2 models (BE-16, contract §11.5, §6 model_runs).

    python -m training.train_l2 --all                 # every risk type
    python -m training.train_l2 --risk losses --risk kick
    python -m training.train_l2 --all --no-store      # train and write results.md only (no upload, no model_runs)

Per risk type: a LightGBM binary classifier (num_leaves 15, 200 rounds, learning rate 0.05, balanced class
weights); leave-one-well-out validation (GroupKFold by well when there are more than 20 wells) in which the
offset-based features of every fold are rebuilt without the held-out wells; PR-AUC, precision and recall at the
`high` band threshold, and the PR-AUC of L1 alone as the baseline; isotonic calibration on the out-of-fold
combined score. A model is activated only if its PR-AUC beats the baseline. `training/results.md` records every
number, including where the model does not beat the baseline.

The CPU-heavy part (`train_risk`) is synchronous and database-free so BE-24 can run it in a thread.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from psycopg.types.json import Jsonb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score
from sklearn.model_selection import GroupKFold

from app import db, storage
from app.config import get_settings
from app.logging import configure_logging, get_logger
from app.risk import config
from training import features

logger = get_logger(__name__)

LGBM_PARAMS = dict(
    num_leaves=15, n_estimators=200, learning_rate=0.05, class_weight="balanced", random_state=0, verbose=-1,
    n_jobs=1,  # one thread: avoids OpenMP oversubscription next to the embedding model and the web server
)
GROUPKFOLD_MIN_WELLS = 20
N_SPLITS = 5
MIN_POSITIVES = 2  # fewer positive rows than this: no model for that risk type
HIGH_BAND_SCORE = config.BAND_ELEVATED_MAX  # the `high` band is a score above this
RESULTS_PATH = Path(__file__).with_name("results.md")


@dataclass
class TrainResult:
    risk_type: str
    artifact: dict[str, Any] | None  # None when no model could be trained
    metrics: dict[str, Any]
    reason: str | None = None  # why there is no artifact


# ---------------------------------------------------------------- folds and models


def make_folds(wellbore_ids: list[str]) -> list[set[str]]:
    """Held-out wellbores per fold: leave-one-well-out, or 5-fold GroupKFold by well above 20 wells."""
    if len(wellbore_ids) > GROUPKFOLD_MIN_WELLS:
        splitter = GroupKFold(n_splits=min(N_SPLITS, len(wellbore_ids)))
        ids = np.array(wellbore_ids)
        return [set(ids[test]) for _, test in splitter.split(ids, groups=ids)]
    return [{w} for w in wellbore_ids]


def fit_model(x: pd.DataFrame, y: pd.Series) -> LGBMClassifier | None:
    if int(y.sum()) < MIN_POSITIVES or int(y.sum()) == len(y):
        return None
    return LGBMClassifier(**LGBM_PARAMS).fit(x, y)


def oof_predictions(wells: list[features.WellData], strat_order: dict[str, int], risk: str) -> pd.DataFrame:
    """Out-of-fold l2 for every row, with the offset-based features rebuilt per fold without the held-out wells."""
    all_ids = {w.wellbore_id for w in wells}
    parts = []
    for held in make_folds(sorted(all_ids)):
        train = features.build_dataset(wells, strat_order, rows_for=all_ids - held, pool_exclude=held)
        test = features.build_dataset(wells, strat_order, rows_for=held, pool_exclude=held)
        if test.empty:
            continue
        model = fit_model(features.matrix_for(train, risk), train[f"y_{risk}"]) if not train.empty else None
        l2 = model.predict_proba(features.matrix_for(test, risk))[:, 1] if model is not None else np.nan
        parts.append(
            pd.DataFrame(
                {"wellbore_id": test.wellbore_id, "provenance": test.provenance, "y": test[f"y_{risk}"],
                 "l1": test[f"l1_{risk}"], "l2": l2}  # fmt: skip
            )
        )
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["wellbore_id", "provenance", "y", "l1", "l2"])


# ---------------------------------------------------------------- metrics and calibration


def combine(l1: np.ndarray, l2: np.ndarray) -> np.ndarray:
    """W_L1*l1 + W_L2*l2 renormalised; where l1 is unknown the score is l2 alone."""
    both = (config.W_L1 * l1 + config.W_L2 * l2) / (config.W_L1 + config.W_L2)
    return np.where(np.isnan(l1), l2, both)


def score_metrics(frame: pd.DataFrame) -> dict[str, Any]:
    scored = frame[frame.l2.notna()]
    y = scored.y.to_numpy(int)
    out: dict[str, Any] = {"n_rows": int(len(scored)), "positives": int(y.sum())}
    if y.sum() == 0 or y.sum() == len(y):
        return {**out, "pr_auc": None, "baseline_pr_auc": None, "precision": None, "recall": None}
    l1, l2 = scored.l1.to_numpy(float), scored.l2.to_numpy(float)
    predicted = combine(l1, l2) * 100 > HIGH_BAND_SCORE
    true_positive = int((predicted & (y == 1)).sum())
    return {
        **out,
        "pr_auc": float(average_precision_score(y, l2)),
        "baseline_pr_auc": float(average_precision_score(y, np.nan_to_num(l1, nan=0.0))),
        "precision": true_positive / int(predicted.sum()) if predicted.any() else None,
        "recall": true_positive / int(y.sum()),
    }


def fit_calibrator(frame: pd.DataFrame) -> IsotonicRegression | None:
    scored = frame[frame.l2.notna()]
    if scored.y.nunique() < 2:
        return None
    combined = combine(scored.l1.to_numpy(float), scored.l2.to_numpy(float))
    return IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(combined, scored.y.to_numpy(float))


# ---------------------------------------------------------------- train one risk type


def train_risk(wells: list[features.WellData], strat_order: dict[str, int], risk: str) -> TrainResult:
    oof = oof_predictions(wells, strat_order, risk)
    metrics = score_metrics(oof)
    metrics["n_wells"] = len(wells)
    metrics["by_provenance"] = {p: score_metrics(g) for p, g in oof.groupby("provenance")} if not oof.empty else {}

    full = features.build_dataset(wells, strat_order)
    model = fit_model(features.matrix_for(full, risk), full[f"y_{risk}"]) if not full.empty else None
    if model is None:
        return TrainResult(risk, None, metrics, f"fewer than {MIN_POSITIVES} positive rows (or only positives)")
    artifact = {
        "version": None,  # assigned when stored
        "risk_type": risk,
        "model": model,
        "feature_names": list(features.MODEL_FEATURES),
        "calibrator": fit_calibrator(oof),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }
    return TrainResult(risk, artifact, metrics)


def beats_baseline(metrics: dict[str, Any]) -> bool:
    return metrics.get("pr_auc") is not None and metrics.get("baseline_pr_auc") is not None and metrics["pr_auc"] > metrics["baseline_pr_auc"]


# ---------------------------------------------------------------- store (database and bucket)


async def next_version(risk: str, now: datetime | None = None) -> str:
    """e.g. 'l2-stuck_pipe-2026-10-04-01' (contract §6 model_runs)."""
    prefix = f"l2-{risk}-{(now or datetime.now(timezone.utc)):%Y-%m-%d}-"
    row = await db.fetch_one("select count(*) as n from model_runs where version like %(prefix)s", {"prefix": prefix + "%"})
    return f"{prefix}{(row['n'] if row else 0) + 1:02d}"


async def store_result(result: TrainResult) -> dict[str, Any]:
    """Upload the artifact, insert model_runs and activate it only if it beats the baseline."""
    if result.artifact is None:
        return {"risk_type": result.risk_type, "version": None, "activated": False, "reason": result.reason}
    artifact = result.artifact
    artifact["version"] = await next_version(result.risk_type)
    buffer = io.BytesIO()
    joblib.dump(artifact, buffer)
    path = f"{artifact['version']}.joblib"
    await asyncio.to_thread(storage.upload, "models", path, buffer.getvalue(), "application/octet-stream")

    activate = beats_baseline(result.metrics)
    if activate:
        await db.execute(
            "update model_runs set is_active = false where risk_type = %(risk)s::risk_type and is_active",
            {"risk": result.risk_type},
        )
    await db.execute(
        """
        insert into model_runs (risk_type, version, metrics, params, artifact_path, is_active)
        values (%(risk)s::risk_type, %(version)s, %(metrics)s, %(params)s, %(path)s, %(active)s)
        """,
        {"risk": result.risk_type, "version": artifact["version"], "metrics": Jsonb(result.metrics),
         "params": Jsonb(LGBM_PARAMS), "path": path, "active": activate},
    )  # fmt: skip
    logger.info("l2_model_stored version=%s activated=%s", artifact["version"], activate)
    return {"risk_type": result.risk_type, "version": artifact["version"], "activated": activate, "reason": None}


# ---------------------------------------------------------------- report


def _fmt(value: float | None, digits: int = 3) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def results_markdown(results: list[TrainResult], stored: dict[str, dict[str, Any]], now: datetime | None = None) -> str:
    when = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# L2 training results", "",
        f"Trained {when}. Leave-one-well-out validation; the offset features of each fold are rebuilt without the "
        "held-out wells. PR-AUC is of L2 alone; the baseline is the PR-AUC of L1 alone on the same rows. Precision and "
        f"recall are of the combined L1+L2 score above {HIGH_BAND_SCORE:g} (the `high` band), before calibration.", "",
        "| Risk type | Wells | Rows | Positives | L2 PR-AUC | L1 baseline PR-AUC | Precision@high | Recall@high | Active |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]  # fmt: skip
    for r in results:
        m = r.metrics
        active = stored.get(r.risk_type, {}).get("activated")
        lines.append(
            f"| {r.risk_type} | {m.get('n_wells')} | {m.get('n_rows')} | {m.get('positives')} | {_fmt(m.get('pr_auc'))} | "
            f"{_fmt(m.get('baseline_pr_auc'))} | {_fmt(m.get('precision'))} | {_fmt(m.get('recall'))} | "
            f"{'yes' if active else 'no'} |"
        )
    lines += ["", "## By provenance", "", "| Risk type | Provenance | Rows | Positives | L2 PR-AUC | L1 baseline PR-AUC |", "| --- | --- | --- | --- | --- | --- |"]
    for r in results:
        for provenance, m in sorted(r.metrics.get("by_provenance", {}).items()):
            lines.append(f"| {r.risk_type} | {provenance} | {m['n_rows']} | {m['positives']} | {_fmt(m['pr_auc'])} | {_fmt(m['baseline_pr_auc'])} |")
    lines += ["", "## Where L2 does not beat the baseline", ""]
    losers = [r for r in results if not beats_baseline(r.metrics)]
    if losers:
        for r in losers:
            why = r.reason or ("PR-AUC is not above the L1-only baseline, so the model was not activated" if r.artifact else "no model")
            lines.append(f"- **{r.risk_type}**: {why}.")
    else:
        lines.append("- None: every risk type beats its L1-only baseline.")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- CLI


async def run(risks: list[str], store: bool, results_path: Path = RESULTS_PATH) -> list[TrainResult]:
    wells, strat_order = await features.load_wells()
    if len(wells) < 2:
        raise SystemExit(f"need at least 2 completed wells with depth data, found {len(wells)}")
    results, stored = [], {}
    for risk in risks:
        print(f"training {risk} on {len(wells)} wells ...")
        result = await asyncio.to_thread(train_risk, wells, strat_order, risk)  # CPU-bound, off the event loop
        results.append(result)
        if store:
            stored[risk] = await store_result(result)
        print(f"  pr_auc={_fmt(result.metrics.get('pr_auc'))} baseline={_fmt(result.metrics.get('baseline_pr_auc'))}")
    results_path.write_text(results_markdown(results, stored), encoding="utf-8")
    print(f"wrote {results_path}")
    return results


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m training.train_l2", description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="every risk type")
    group.add_argument("--risk", action="append", choices=features.RISK_TYPES, help="one risk type (repeatable)")
    parser.add_argument("--no-store", action="store_true", help="skip the bucket upload and model_runs rows")
    args = parser.parse_args(argv)
    configure_logging(get_settings().LOG_LEVEL)
    if sys.platform == "win32":  # psycopg's async pool cannot use the default Proactor loop
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def go() -> None:
        try:
            await run(list(features.RISK_TYPES) if args.all else args.risk, store=not args.no_store)
        finally:
            await db.close_pool()

    asyncio.run(go())


if __name__ == "__main__":
    main()

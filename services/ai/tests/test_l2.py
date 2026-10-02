"""BE-16 part 2: training, validation, calibration, storage and L2 inference (small synthetic wells, DB/storage mocked)."""

import io
import math
from datetime import datetime, timezone
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import average_precision_score

from app import db, storage
from app.risk import config, l2
from app.risk.l1 import L1Result
from tests.test_features import STRAT, event, make_well
from training import features, train_l2


def synthetic_wells(n=6, with_events=True):
    wells = []
    for i in range(n):
        events = [event(300.0 + i, rel=0.4)] if with_events else []
        wells.append(make_well(f"W{i}", lon=95.0 + 0.01 * i, seed=i, td=600.0, events=events,
                               provenance="synthetic" if i % 2 else "direct"))  # fmt: skip
    return wells


@pytest.fixture(autouse=True)
def clean_models():
    l2.set_models({})
    yield
    l2.set_models({})


# ---------------------------------------------------------------- folds and models


def test_leave_one_well_out_up_to_20_wells_and_group_kfold_above():
    ids = [f"w{i}" for i in range(6)]
    assert train_l2.make_folds(ids) == [{i} for i in ids]
    many = [f"w{i:02d}" for i in range(25)]
    folds = train_l2.make_folds(many)
    assert len(folds) == 5 and sorted(w for f in folds for w in f) == many  # every well held out exactly once
    assert all(f.isdisjoint(g) for i, f in enumerate(folds) for g in folds[i + 1 :])


def test_model_needs_both_classes_and_enough_positives():
    x = pd.DataFrame({"a": range(10)})
    assert train_l2.fit_model(x, pd.Series([0] * 10)) is None
    assert train_l2.fit_model(x, pd.Series([0] * 9 + [1])) is None  # one positive
    assert train_l2.fit_model(x, pd.Series([1] * 10)) is None  # nothing to separate
    assert train_l2.fit_model(x, pd.Series([0] * 5 + [1] * 5)) is not None


def test_model_parameters_are_the_spec():
    p = train_l2.LGBM_PARAMS
    assert (p["num_leaves"], p["n_estimators"], p["learning_rate"], p["class_weight"]) == (15, 200, 0.05, "balanced")


# ---------------------------------------------------------------- out-of-fold predictions


def test_every_well_is_predicted_by_a_model_that_never_saw_it_or_its_events(monkeypatch):
    wells = synthetic_wells(5)
    calls = []
    original = features.build_dataset

    def spy(w, strat, rows_for=None, pool_exclude=None):
        calls.append((set(rows_for), set(pool_exclude or ())))
        return original(w, strat, rows_for=rows_for, pool_exclude=pool_exclude)

    monkeypatch.setattr(features, "build_dataset", spy)
    oof = train_l2.oof_predictions(wells, STRAT, "losses")

    assert sorted(oof.wellbore_id.unique()) == sorted(w.wellbore_id for w in wells)
    assert len(calls) == 2 * len(wells)  # train and test rows rebuilt for every fold
    for (train_rows, train_pool), (test_rows, test_pool) in zip(calls[::2], calls[1::2]):
        held = test_rows
        assert len(held) == 1 and train_rows.isdisjoint(held)
        assert train_pool == held and test_pool == held  # the held-out well's events are in neither pool
    assert oof.l2.notna().all() and oof.l2.between(0, 1).all()


def test_a_fold_without_enough_positives_leaves_l2_unknown(monkeypatch):
    oof = train_l2.oof_predictions(synthetic_wells(4, with_events=False), STRAT, "losses")
    assert oof.l2.isna().all() and (oof.y == 0).all()


# ---------------------------------------------------------------- metrics and calibration


def test_combine_renormalises_and_falls_back_to_l2_when_l1_is_unknown():
    l1, l2_ = np.array([0.8, np.nan]), np.array([0.2, 0.7])
    combined = train_l2.combine(l1, l2_)
    assert combined[0] == pytest.approx((0.5 * 0.8 + 0.3 * 0.2) / 0.8) and combined[1] == 0.7


def test_metrics_are_pr_auc_baseline_and_precision_recall_at_the_high_band():
    frame = pd.DataFrame({"y": [1, 0, 1, 1, 0], "l1": [np.nan] * 5, "l2": [0.9, 0.8, 0.7, 0.2, 0.1]})
    m = train_l2.score_metrics(frame)
    assert m["pr_auc"] == pytest.approx(average_precision_score([1, 0, 1, 1, 0], [0.9, 0.8, 0.7, 0.2, 0.1]))
    assert m["baseline_pr_auc"] == pytest.approx(average_precision_score([1, 0, 1, 1, 0], [0.0] * 5))  # unknown l1 -> 0
    assert m["precision"] == pytest.approx(2 / 3) and m["recall"] == pytest.approx(2 / 3)  # score > 60 flags the top three
    assert (m["n_rows"], m["positives"]) == (5, 3)


def test_metrics_without_positives_or_predictions_are_none_not_zero():
    none = train_l2.score_metrics(pd.DataFrame({"y": [0, 0], "l1": [0.1, 0.2], "l2": [0.3, 0.1]}))
    assert none["pr_auc"] is None and none["recall"] is None
    unscored = train_l2.score_metrics(pd.DataFrame({"y": [1, 0], "l1": [0.1, 0.2], "l2": [np.nan, np.nan]}))
    assert unscored["n_rows"] == 0 and unscored["pr_auc"] is None
    quiet = train_l2.score_metrics(pd.DataFrame({"y": [1, 0], "l1": [np.nan, np.nan], "l2": [0.2, 0.1]}))
    assert quiet["precision"] is None and quiet["recall"] == 0.0  # nothing reached the high band


def test_beats_baseline_needs_a_strictly_higher_pr_auc():
    assert train_l2.beats_baseline({"pr_auc": 0.41, "baseline_pr_auc": 0.28})
    assert not train_l2.beats_baseline({"pr_auc": 0.28, "baseline_pr_auc": 0.28})
    assert not train_l2.beats_baseline({"pr_auc": None, "baseline_pr_auc": None})


def test_calibrator_is_monotone_clipped_and_needs_both_classes():
    frame = pd.DataFrame({"y": [0, 0, 1, 0, 1, 1], "l1": [np.nan] * 6, "l2": [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]})
    cal = train_l2.fit_calibrator(frame)
    xs = np.linspace(-1, 2, 25)
    ys = cal.predict(xs)
    assert (np.diff(ys) >= 0).all() and ys.min() >= 0 and ys.max() <= 1
    assert train_l2.fit_calibrator(frame.assign(y=0)) is None


# ---------------------------------------------------------------- train one risk type


def test_train_risk_returns_a_complete_artifact_and_metrics():
    result = train_l2.train_risk(synthetic_wells(6), STRAT, "losses")
    art = result.artifact
    assert art is not None and art["risk_type"] == "losses" and art["version"] is None
    assert art["feature_names"] == list(features.MODEL_FEATURES) and art["calibrator"] is not None
    assert set(art) == {"version", "risk_type", "model", "feature_names", "calibrator", "trained_at", "metrics"}
    m = result.metrics
    assert m["n_wells"] == 6 and m["n_rows"] > 0 and m["positives"] > 0 and m["pr_auc"] is not None
    assert set(m["by_provenance"]) == {"synthetic", "direct"}


def test_train_risk_with_no_events_has_no_artifact_and_says_why():
    result = train_l2.train_risk(synthetic_wells(4, with_events=False), STRAT, "kick")
    assert result.artifact is None and "positive" in result.reason and result.metrics["n_wells"] == 4


# ---------------------------------------------------------------- storing


class FakeStore:
    def __init__(self, existing=2):
        self.existing, self.executed, self.uploads = existing, [], []

    async def fetch_one(self, sql, params=None):
        assert "from model_runs where version like" in sql
        self.prefix = params["prefix"]
        return {"n": self.existing}

    async def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def upload(self, bucket, path, data, content_type):
        self.uploads.append((bucket, path, data, content_type))


@pytest.fixture
def fake_store(monkeypatch):
    s = FakeStore()
    monkeypatch.setattr(db, "fetch_one", s.fetch_one)
    monkeypatch.setattr(db, "execute", s.execute)
    monkeypatch.setattr(storage, "upload", s.upload)
    return s


@pytest.mark.asyncio
async def test_version_names_follow_the_contract_example(fake_store):
    now = datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert await train_l2.next_version("stuck_pipe", now) == "l2-stuck_pipe-2026-10-04-03"
    assert fake_store.prefix == "l2-stuck_pipe-2026-10-04-%"


@pytest.mark.asyncio
async def test_a_model_that_beats_the_baseline_is_uploaded_inserted_and_activated_after_deactivating_the_old_one(fake_store):
    result = train_l2.train_risk(synthetic_wells(6), STRAT, "losses")
    result.metrics.update(pr_auc=0.5, baseline_pr_auc=0.3)
    stored = await train_l2.store_result(result)
    assert stored["activated"] is True and stored["version"].startswith("l2-losses-")

    bucket, path, data, _ = fake_store.uploads[0]
    assert bucket == "models" and path == f"{stored['version']}.joblib"
    artifact = joblib.load(io.BytesIO(data))
    assert artifact["version"] == stored["version"] and artifact["risk_type"] == "losses"
    first, second = fake_store.executed
    assert first[0].startswith("update model_runs set is_active = false") and first[1] == {"risk": "losses"}
    assert second[0].startswith("insert into model_runs") and second[1]["active"] is True and second[1]["path"] == path


@pytest.mark.asyncio
async def test_a_model_that_does_not_beat_the_baseline_is_stored_but_not_activated(fake_store):
    result = train_l2.train_risk(synthetic_wells(6), STRAT, "losses")
    result.metrics.update(pr_auc=0.2, baseline_pr_auc=0.3)
    stored = await train_l2.store_result(result)
    assert stored["activated"] is False and len(fake_store.uploads) == 1
    assert [sql.split()[0] for sql, _ in fake_store.executed] == ["insert"]  # the old active model is left alone
    assert fake_store.executed[0][1]["active"] is False


@pytest.mark.asyncio
async def test_no_artifact_means_nothing_is_stored(fake_store):
    result = train_l2.train_risk(synthetic_wells(4, with_events=False), STRAT, "kick")
    stored = await train_l2.store_result(result)
    assert stored["version"] is None and not stored["activated"] and fake_store.uploads == [] and fake_store.executed == []


# ---------------------------------------------------------------- report and run


def test_results_markdown_has_the_table_provenance_rows_and_the_honest_section():
    good = train_l2.TrainResult("losses", {}, {"n_wells": 6, "n_rows": 100, "positives": 20, "pr_auc": 0.5, "baseline_pr_auc": 0.3,
                                               "precision": 0.6, "recall": 0.4, "by_provenance": {"synthetic": {"n_rows": 60, "positives": 12, "pr_auc": 0.55, "baseline_pr_auc": 0.3}}})  # fmt: skip
    bad = train_l2.TrainResult("kick", None, {"n_wells": 6, "pr_auc": None, "baseline_pr_auc": None}, "fewer than 2 positive rows")
    text = train_l2.results_markdown([good, bad], {"losses": {"activated": True}}, datetime(2026, 10, 4, tzinfo=timezone.utc))
    assert "| losses | 6 | 100 | 20 | 0.500 | 0.300 | 0.600 | 0.400 | yes |" in text
    assert "| kick | 6 | None | None | n/a | n/a | n/a | n/a | no |" in text
    assert "| losses | synthetic | 60 | 12 | 0.550 | 0.300 |" in text
    assert "## Where L2 does not beat the baseline" in text and "**kick**: fewer than 2 positive rows" in text
    assert "2026-10-04" in text


@pytest.mark.asyncio
async def test_run_trains_each_risk_writes_results_and_can_skip_storing(monkeypatch, tmp_path):
    wells = synthetic_wells(4)

    async def load():
        return wells, STRAT

    monkeypatch.setattr(features, "load_wells", load)
    results = await train_l2.run(["losses", "kick"], store=False, results_path=tmp_path / "results.md")
    assert [r.risk_type for r in results] == ["losses", "kick"]
    text = (tmp_path / "results.md").read_text(encoding="utf-8")
    assert "| losses |" in text and "| kick |" in text


@pytest.mark.asyncio
async def test_run_needs_at_least_two_wells(monkeypatch, tmp_path):
    async def load():
        return synthetic_wells(1), STRAT

    monkeypatch.setattr(features, "load_wells", load)
    with pytest.raises(SystemExit):
        await train_l2.run(["losses"], store=False, results_path=tmp_path / "r.md")


# ---------------------------------------------------------------- inference (app.risk.l2)


@pytest.fixture
def loaded():
    result = train_l2.train_risk(synthetic_wells(6), STRAT, "losses")
    result.artifact["version"] = "l2-losses-test-01"
    l2.set_models({"losses": result.artifact})
    return result.artifact


def a_row(**over):
    row = {name: 1.0 for name in features.MODEL_FEATURES}
    row.update(over)
    return row


def test_prediction_is_a_probability_with_ranked_shap_features_and_the_version(loaded):
    probability, shap, version = l2.predict_features("losses", a_row())
    assert 0.0 <= probability <= 1.0 and version == "l2-losses-test-01"
    assert len(shap) == l2.SHAP_TOP_N and {s["feature"] for s in shap} <= set(features.MODEL_FEATURES)
    assert [abs(s["value"]) for s in shap] == sorted((abs(s["value"]) for s in shap), reverse=True)


def test_shap_contributions_add_up_to_the_model_margin(loaded):
    x = pd.DataFrame([a_row()])[loaded["feature_names"]]
    contrib = loaded["model"].booster_.predict(x, pred_contrib=True)[0]
    margin = loaded["model"].predict(x, raw_score=True)[0]
    assert contrib.sum() == pytest.approx(margin, abs=1e-6)  # TreeSHAP is additive: it explains this very score


def test_missing_features_are_unknown_not_errors(loaded):
    assert l2.predict_features("losses", {})[0] >= 0.0
    assert l2.predict_features("losses", {"l1": math.nan})[0] >= 0.0


def test_no_model_means_no_prediction_and_no_calibrator():
    assert l2.predict_features("kick", a_row()) is None
    assert l2.calibrator_for("kick") is None


def test_calibrator_for_returns_a_monotone_function(loaded):
    calibrate = l2.calibrator_for("losses")
    values = [calibrate(x) for x in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert values == sorted(values) and all(0.0 <= v <= 1.0 for v in values)
    assert l2.active_versions() == {"losses": "l2-losses-test-01"}


def l1r(md_from, risk="losses"):
    return L1Result(md_from, md_from + 25, risk, 0.5, "Tipam", 3, 0.9)


@pytest.mark.asyncio
async def test_predict_intervals_covers_only_50_to_300_m_ahead_and_only_loaded_risk_types(loaded, monkeypatch):
    from app.risk import fuse

    async def bit(wellbore_id):
        return 2000.0

    async def current(wellbore_id, bit_md_m):
        assert bit_md_m == 2000.0
        return {risk: a_row() for risk in features.RISK_TYPES}

    monkeypatch.setattr(fuse, "bit_depth", bit)
    monkeypatch.setattr(l2, "current_features", current)
    results = [l1r(2000.0 + k * 25.0) for k in range(13)] + [l1r(2100.0, "kick")]
    out = await l2.predict_intervals("wb", results)
    assert sorted(md for md, _ in out) == [2000.0 + k * 25.0 for k in range(2, 13)]  # +50 .. +300 inclusive
    assert {risk for _, risk in out} == {"losses"}  # no kick model loaded
    values = {v[0] for v in out.values()}
    assert len(values) == 1  # one L2 value describes the whole look-ahead window


@pytest.mark.asyncio
async def test_predict_intervals_without_models_does_nothing():
    assert await l2.predict_intervals("wb", [l1r(2000.0)]) == {}


@pytest.mark.asyncio
async def test_current_features_reads_the_bit_state_and_uses_other_wells_as_offsets(monkeypatch):
    pool = synthetic_wells(3)
    target = make_well("T", lon=95.005, seed=9, td=600.0)
    seen = {}

    async def offset_pool():
        return pool, STRAT

    async def load_well_at(wellbore_id, bit, lookback):
        seen.update(bit=bit, lookback=lookback)
        return target

    monkeypatch.setattr(l2, "_offset_pool", offset_pool)
    monkeypatch.setattr(features, "load_well_at", load_well_at)
    rows = await l2.current_features(target.wellbore_id, 300.0)
    assert seen == {"bit": 300.0, "lookback": l2.LOOKBACK_M}
    assert set(rows) == set(features.RISK_TYPES) and set(rows["losses"]) == set(features.MODEL_FEATURES)
    assert rows["losses"]["l1"] > 0 and rows["losses"]["nearest_event_dist_m"] == pytest.approx(0.0, abs=2.0)
    assert math.isnan(rows["kick"]["nearest_event_dist_m"]) or rows["kick"]["nearest_event_dist_m"] >= 0


# ---------------------------------------------------------------- loading active models


@pytest.mark.asyncio
async def test_load_active_downloads_artifacts_and_survives_a_bad_one(monkeypatch):
    result = train_l2.train_risk(synthetic_wells(6), STRAT, "losses")
    result.artifact["version"] = "good"
    buffer = io.BytesIO()
    joblib.dump(result.artifact, buffer)

    async def fetch_all(sql, params=None):
        assert "is_active" in sql
        return [{"risk_type": "losses", "version": "good", "artifact_path": "good.joblib"},
                {"risk_type": "kick", "version": "broken", "artifact_path": "broken.joblib"}]  # fmt: skip

    def download(bucket, path):
        assert bucket == "models"
        if path == "broken.joblib":
            raise RuntimeError("object not found")
        return buffer.getvalue()

    monkeypatch.setattr(db, "fetch_all", fetch_all)
    monkeypatch.setattr(storage, "download", download)
    assert await l2.load_active() == 1
    assert l2.active_versions() == {"losses": "good"}

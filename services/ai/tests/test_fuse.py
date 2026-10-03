"""BE-17: fusion, bands, confidence, reasons and the risk endpoint (DB mocked)."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app import db, main as app_main
from app.errors import NwisError
from app.risk import config, fuse, l1 as l1_module, l3
from app.risk.l1 import L1Result
from app.risk.l3 import DetectorResult

TOKEN = "test-token"
WB = str(uuid4())


# ---------------------------------------------------------------- bands and severity


@pytest.mark.parametrize(
    "score,band",
    [(0, "low"), (20, "low"), (20.01, "moderate"), (40, "moderate"), (40.01, "elevated"), (60, "elevated"),
     (60.01, "high"), (80, "high"), (80.01, "critical"), (100, "critical")],
)  # fmt: skip
def test_band_boundaries_are_exactly_the_contract(score, band):
    assert fuse.band_for(score) == band


def test_severity_for_each_band():
    assert [fuse.severity_for(b) for b in ("low", "moderate", "elevated", "high", "critical")] == [
        None, "info", "watch", "warning", "critical",
    ]  # fmt: skip


# ---------------------------------------------------------------- fusion


def test_fuse_all_three_layers_uses_the_contract_weights():
    assert fuse.fuse(0.6, 0.4, 0.8) == pytest.approx(100 * (0.5 * 0.6 + 0.3 * 0.4 + 0.2 * 0.8))


def test_missing_l2_renormalises_over_l1_and_l3():
    assert fuse.fuse(0.6, None, 0.8) == pytest.approx(100 * (0.5 * 0.6 + 0.2 * 0.8) / 0.7)


def test_single_layer_is_its_own_score_and_no_layers_is_no_score():
    assert fuse.fuse(0.42, None, None) == pytest.approx(42.0)
    assert fuse.fuse(None, 0.3, None) == pytest.approx(30.0)
    assert fuse.fuse(None, None, None) is None


def test_a_fired_detector_raises_the_score_to_at_least_its_floor_but_never_lowers_it():
    assert fuse.fuse(0.2, None, 1.0, detector_floor=85) >= 85
    assert fuse.fuse(0.2, None, None, detector_floor=65) == 65
    assert fuse.fuse(0.9, None, None, detector_floor=65) == pytest.approx(90.0)


def test_calibrator_is_applied_to_the_combined_score_and_clipped():
    assert fuse.fuse(0.6, None, None, calibrator=lambda x: x / 2) == pytest.approx(30.0)
    assert fuse.fuse(0.6, None, None, calibrator=lambda x: x * 10) == 100.0
    assert fuse.fuse(0.6, None, None, calibrator=lambda x: -1.0) == 0.0


# ---------------------------------------------------------------- confidence and reasons


@pytest.mark.parametrize(
    "n,mean,level",
    [(3, 0.85, "high"), (3, 0.8, "high"), (3, 0.79, "medium"), (2, 0.1, "medium"), (1, 0.9, "medium"),
     (1, 0.6, "medium"), (1, 0.59, "low"), (0, None, "low"), (1, None, "low"), (2, None, "medium"), (5, None, "medium")],
)  # fmt: skip
def test_confidence_levels(n, mean, level):
    assert fuse.confidence_for(n, mean)[0] == level


def test_confidence_reason_lists_what_there_is():
    assert fuse.confidence_for(1, 0.5, 2)[1] == "1 offset within 10 km; mean event confidence 0.50; 2 unreviewed events"
    assert fuse.confidence_for(0, None)[1] == "0 offsets within 10 km; no matching offset events"
    assert fuse.confidence_for(3, 0.9, 1)[1].endswith("1 unreviewed event")


def test_reasons_are_l1_then_shap_then_detector():
    reasons = fuse.build_reasons(
        [{"kind": "offset_event", "event_id": "e1"}],
        [{"feature": f"f{i}", "value": i / 10} for i in range(8)],
        {"name": "kick", "signal": {"pit_gain_m3": 2.1}, "floor": 85},
    )
    assert [r["kind"] for r in reasons] == ["offset_event"] + ["shap"] * 5 + ["detector"]
    assert reasons[1] == {"kind": "shap", "feature": "f0", "value": 0.0}
    assert reasons[-1] == {"kind": "detector", "name": "kick", "signal": {"pit_gain_m3": 2.1}, "floor": 85}
    assert fuse.build_reasons([], None, None) == []


# ---------------------------------------------------------------- score_rows


def res(md_from, risk="losses", l1=0.6, n=3, conf=0.9, unrev=0, formation="Tipam"):
    return L1Result(md_from, md_from + 25, risk, l1, formation, n, conf, unrev, [{"kind": "offset_event", "event_id": "e"}])


def test_l3_and_the_floor_apply_only_to_the_interval_the_bit_is_in():
    results = [res(2000.0), res(2025.0), res(2050.0)]
    fired = {"losses": {"name": "losses", "signal": {"flow_ratio": 0.8}, "floor": 65}}
    rows = fuse.score_rows(WB, results, 2010.0, {}, None, {"losses": 1.0}, fired)
    at_bit, ahead = rows[0], rows[1]
    assert at_bit["l3"] == 1.0 and at_bit["fused"] >= 65 and at_bit["reasons"][-1]["kind"] == "detector"
    assert ahead["l3"] is None and ahead["fused"] == pytest.approx(60.0) and len(ahead["reasons"]) == 1


def test_interval_with_no_layer_value_gets_no_row():
    rows = fuse.score_rows(WB, [res(2000.0, l1=None, n=0, conf=None)], 1000.0, {}, None, {}, {})
    assert rows == []


def test_l3_alone_still_scores_the_bit_interval_when_l1_is_unknown():
    rows = fuse.score_rows(WB, [res(2000.0, l1=None, n=0, conf=None)], 2010.0, {}, None, {"losses": 0.4}, {})
    assert rows[0]["fused"] == pytest.approx(40.0) and rows[0]["l1"] is None


def test_l2_values_shap_and_model_version_flow_into_the_row():
    shap = [{"feature": "torque_trend_30m", "value": 0.12}]
    rows = fuse.score_rows(WB, [res(2000.0)], 1000.0, {(2000.0, "losses"): (0.4, shap, "v7")}, None, {}, {})
    row = rows[0]
    assert row["l2"] == 0.4 and row["model_version"] == "v7"
    assert row["fused"] == pytest.approx(100 * (0.5 * 0.6 + 0.3 * 0.4) / 0.8)
    assert row["reasons"][-1] == {"kind": "shap", "feature": "torque_trend_30m", "value": 0.12}


def test_row_has_exactly_the_risk_scores_columns_and_valid_enums():
    row = fuse.score_rows(WB, [res(2000.0, unrev=2, n=1, conf=0.5)], 1000.0, {}, None, {}, {})[0]
    assert set(row) == {"wellbore_id", "md_from_m", "md_to_m", "risk_type", "l1", "l2", "l3", "fused", "band",
                        "confidence", "confidence_reason", "reasons", "formation", "model_version"}  # fmt: skip
    assert row["fused"] == pytest.approx(60.0) and row["band"] == "elevated" and row["confidence"] == "low"
    assert row["confidence_reason"].endswith("2 unreviewed events")


# ---------------------------------------------------------------- compute_and_store


class FakeDb:
    def __init__(self):
        self.exists = True
        self.bit = 2400.0
        self.deepest = None
        self.stored = []

    async def fetch_one(self, sql, params=None):
        if "from wellbores" in sql:
            return {"id": params["id"]} if self.exists else None
        if "from stream_state" in sql:
            return {"bit_md_m": self.bit} if self.bit is not None else None
        if "from formation_tops" in sql:
            return {"md": self.deepest}
        raise AssertionError(sql)

    async def execute_many(self, sql, rows):
        self.stored.append((sql, rows))

    async def execute(self, sql, params=None):
        self.deleted.append((" ".join(sql.split()), params))


@pytest.fixture
def env(monkeypatch):
    fake = FakeDb()
    fake.deleted = []
    calls = []

    async def l1_scores(wellbore_id, start, risk_types=l1_module.RISK_TYPES, n_intervals=config.LOOKAHEAD_INTERVALS):
        calls.append((wellbore_id, start, n_intervals))
        return [res(start + k * 25.0, rt) for k in range(n_intervals) for rt in ("losses", "kick")]

    monkeypatch.setattr(db, "fetch_one", fake.fetch_one)
    monkeypatch.setattr(db, "execute_many", fake.execute_many)
    monkeypatch.setattr(db, "execute", fake.execute)
    monkeypatch.setattr(l1_module, "l1_scores", l1_scores)
    l3.reset_bank(WB)
    fake.l1_calls = calls
    yield fake
    l3.reset_bank(WB)


@pytest.mark.asyncio
async def test_default_window_is_bit_to_plus_300_and_rows_are_upserted(env):
    rows = await fuse.compute_and_store(WB)
    assert env.l1_calls == [(WB, 2400.0, 12)]
    assert len(rows) == 24 and {r["risk_type"] for r in rows} == {"losses", "kick"}
    sql, params = env.stored[0]
    assert "on conflict (wellbore_id, md_from_m, risk_type) do update" in sql
    assert "%(risk_type)s::risk_type" in sql and "::risk_band" in sql and "::confidence_level" in sql
    assert isinstance(params[0]["reasons"], Jsonb) and params[0]["computed_at"] is not None
    assert rows[0]["computed_at"] and isinstance(rows[0]["reasons"], list)


@pytest.mark.asyncio
async def test_default_window_sits_on_a_fixed_25_m_grid_so_rows_are_overwritten_not_piled_up(env):
    """The key includes md_from_m: a grid that followed the bit wrote a new set of rows at every depth."""
    env.bit = 2412.5
    rows = await fuse.compute_and_store(WB)
    assert env.l1_calls == [(WB, 2400.0, 13)]  # the cell holding the bit, up to bit + 300 m (2712.5 -> 2725)
    assert min(r["md_from_m"] for r in rows) == 2400.0 and max(r["md_to_m"] for r in rows) == 2725.0
    env.bit = 2424.0
    await fuse.compute_and_store(WB)
    assert env.l1_calls[-1][1] == 2400.0  # still the same cell: same keys, so the upsert overwrites


@pytest.mark.asyncio
async def test_default_run_drops_unrefreshed_rows_ahead_but_an_explicit_window_does_not(env):
    await fuse.compute_and_store(WB)
    sql, params = env.deleted[0]
    assert sql.startswith("delete from risk_scores where wellbore_id = %(id)s and md_from_m >= %(start)s")
    assert "computed_at < %(at)s" in sql and params["id"] == WB and params["start"] == 2400.0
    env.deleted.clear()
    await fuse.compute_and_store(WB, 2400.0, 2700.0)  # planning / what-if windows keep other rows
    assert env.deleted == []


@pytest.mark.asyncio
async def test_bit_depth_falls_back_to_deepest_actual_top_plus_20(env):
    env.bit, env.deepest = None, 3100.0
    await fuse.compute_and_store(WB)
    assert env.l1_calls[0][1] == 3100.0  # the bit is 3120; the window starts at the 25 m cell that holds it


@pytest.mark.asyncio
async def test_no_bit_depth_is_409_and_unknown_wellbore_is_404(env):
    env.bit = None
    with pytest.raises(NwisError) as exc:
        await fuse.compute_and_store(WB)
    assert exc.value.status_code == 409
    env.exists = False
    with pytest.raises(NwisError) as exc:
        await fuse.compute_and_store(WB)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_explicit_window_sets_the_grid_start_and_interval_count(env):
    await fuse.compute_and_store(WB, 2400.0, 2700.0)
    await fuse.compute_and_store(WB, 2400.0, 2460.0)
    assert [(c[1], c[2]) for c in env.l1_calls] == [(2400.0, 12), (2400.0, 3)]  # 60 m = 3 intervals (rounded up)


@pytest.mark.asyncio
@pytest.mark.parametrize("window", [(2500.0, 2400.0), (2400.0, 2400.0), (2400.0, 4000.0)])
async def test_bad_windows_are_400(env, window):
    with pytest.raises(NwisError) as exc:
        await fuse.compute_and_store(WB, *window)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_a_live_detector_raises_the_stored_score_at_the_bit(env):
    bank = l3.bank_for(WB)
    bank.latest = [DetectorResult("kick", "kick", True, {"pit_gain_m3": 2.4}, 1.0, config.KICK_FLOOR)]
    rows = await fuse.compute_and_store(WB)
    at_bit = [r for r in rows if r["md_from_m"] == 2400.0]
    kick = next(r for r in at_bit if r["risk_type"] == "kick")
    losses = next(r for r in at_bit if r["risk_type"] == "losses")
    assert kick["fused"] >= 85 and kick["band"] == "critical" and kick["l3"] == 1.0
    assert kick["reasons"][-1]["kind"] == "detector" and kick["reasons"][-1]["name"] == "kick"
    assert losses["l3"] is None and losses["fused"] == pytest.approx(60.0)  # only the kick detector reported
    assert all(r["l3"] is None for r in rows if r["md_from_m"] > 2400.0)


@pytest.mark.asyncio
async def test_telemetry_changes_change_the_stored_scores(env):
    before = await fuse.compute_and_store(WB)
    bank = l3.bank_for(WB)
    bank.latest = [DetectorResult("losses", "losses", True, {"flow_ratio": 0.7}, 1.0, config.LOSSES_FLOOR)]
    after = await fuse.compute_and_store(WB)
    pick = lambda rows: next(r for r in rows if r["md_from_m"] == 2400.0 and r["risk_type"] == "losses")  # noqa: E731
    assert pick(after)["fused"] > pick(before)["fused"]


@pytest.mark.asyncio
async def test_l2_is_used_when_it_predicts_and_its_failure_is_tolerated(env, monkeypatch):
    from app.risk import l2

    async def predict_intervals(wellbore_id, results):
        return {(r.md_from_m, r.risk_type): (0.9, [{"feature": "mw_sg", "value": 0.3}], "v3") for r in results}

    monkeypatch.setattr(l2, "predict_intervals", predict_intervals)
    monkeypatch.setattr(l2, "calibrator_for", lambda risk_type: (lambda x: x / 2) if risk_type == "kick" else None)
    rows = await fuse.compute_and_store(WB)
    losses = next(r for r in rows if r["risk_type"] == "losses")
    kick = next(r for r in rows if r["risk_type"] == "kick")
    assert losses["l2"] == 0.9 and losses["model_version"] == "v3"
    assert losses["fused"] == pytest.approx(100 * (0.5 * 0.6 + 0.3 * 0.9) / 0.8)
    assert kick["fused"] == pytest.approx(100 * (0.5 * 0.6 + 0.3 * 0.9) / 0.8 / 2)  # its own calibrator was applied

    async def boom(wellbore_id, results):
        raise RuntimeError("model file corrupt")

    monkeypatch.setattr(l2, "predict_intervals", boom)
    rows = await fuse.compute_and_store(WB)
    assert rows[0]["l2"] is None and rows[0]["l1"] == 0.6  # L1 still scores


# ---------------------------------------------------------------- route


@pytest.fixture
def client(env, monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return TestClient(app_main.app)


def headers(role="rig_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


def test_route_returns_scores_with_and_without_a_body(client, env):
    response = client.post(f"/v1/wells/{WB}/risk", headers=headers())
    assert response.status_code == 200 and len(response.json()["scores"]) == 24
    client.post(f"/v1/wells/{WB}/risk", json={"md_from_m": 2400, "md_to_m": 2500}, headers=headers())
    assert env.l1_calls[-1] == (WB, 2400.0, 4)


def test_route_validation_and_auth(client):
    assert client.post("/v1/wells/not-a-uuid/risk", headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{WB}/risk", json={"md_from_m": "x"}, headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{WB}/risk", json={"md_from_m": 5, "md_to_m": 1}, headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{WB}/risk", headers=headers("nobody")).status_code == 403
    assert client.post(f"/v1/wells/{WB}/risk").status_code == 401

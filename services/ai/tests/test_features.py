"""BE-16 part 1: L2 features and labels. Mostly proves no feature reads data below the interval start."""

import copy
import math
from uuid import uuid4

import numpy as np
import pytest

from app import db
from training import features
from training.features import WellData

STRAT = {"Tipam": 1, "Barail": 2, "Girujan": 3}


def make_well(name="W", lon=95.0, lat=27.0, top_shift=0.0, events=(), td=1000.0, seed=0, provenance="synthetic"):
    rng = np.random.default_rng(seed)
    md = np.arange(0.0, td + 1, 1.0)
    series = {"md_m": md}
    for col, base in [("rop_m_h", 12.0), ("torque_knm", 15.0), ("spp_bar", 200.0), ("hookload_kn", 1500.0),
                      ("flow_in_lpm", 2000.0), ("flow_out_lpm", 2000.0), ("dxc", 1.2), ("gas_total_pct", 0.5),
                      ("mw_sg", 1.2), ("ecd_sg", 1.25)]:  # fmt: skip
        series[col] = base + rng.normal(0, base * 0.01, md.size)
    return WellData(
        wellbore_id=str(uuid4()), well_id=str(uuid4()), name=name, provenance=provenance, lon=lon, lat=lat,
        stations=[{"md_m": float(m), "tvd_m": float(m), "inc_deg": 0.0, "north_m": 0.0, "east_m": 0.0} for m in range(0, int(td) + 1, 100)],
        series=series, tops={"Tipam": 100.0 + top_shift, "Barail": 600.0 + top_shift, "Girujan": 900.0 + top_shift},
        events=list(events), sections=[{"hole_size_in": 12.25, "md_from_m": 0.0, "md_to_m": 500.0},
                                       {"hole_size_in": 8.5, "md_from_m": 500.0, "md_to_m": td}],
    )  # fmt: skip


def event(md, risk="losses", formation="Tipam", rel=0.5, status="approved", conf=0.9):
    return {"id": str(uuid4()), "event_type": "loss_partial", "risk_type": risk, "formation": formation,
            "md_from_m": md, "relative_depth": rel, "review_status": status, "confidence": conf}  # fmt: skip


def values_close(a, b):
    return all((math.isnan(a[k]) and math.isnan(b[k])) or a[k] == pytest.approx(b[k]) for k in a)


# ---------------------------------------------------------------- no look-ahead leakage


def corrupt_below(well, md0):
    """A copy of the well with everything below md0 replaced by garbage."""
    bad = copy.deepcopy(well)
    below = bad.series["md_m"] > md0
    for col, arr in bad.series.items():
        if col != "md_m":
            arr[below] = 9e6
    bad.tops = {f: (t if t <= md0 else t + 777.0) for f, t in bad.tops.items()}
    bad.stations = [s if s["md_m"] <= md0 else {**s, "tvd_m": 9e6, "inc_deg": 80.0} for s in bad.stations]
    bad.sections = [s if s["md_from_m"] <= md0 else {**s, "hole_size_in": 99.0} for s in bad.sections]
    return bad


@pytest.mark.parametrize("md0", [250.0, 475.0, 650.0, 925.0])
def test_base_features_ignore_everything_below_the_interval_start(md0):
    well = make_well()
    thickness = {"Tipam": 500.0, "Barail": 300.0}
    original, _, _ = features.base_features(well, md0, STRAT, thickness)
    corrupted, _, _ = features.base_features(corrupt_below(well, md0), md0, STRAT, thickness)
    assert values_close(original, corrupted)


def test_the_whole_dataset_is_unchanged_above_a_cut_when_the_well_below_it_is_corrupted():
    well, other = make_well("A"), make_well("B", lon=95.05, seed=1, top_shift=20.0)
    cut = 500.0
    base = features.build_dataset([well, other], STRAT, rows_for={well.wellbore_id})
    changed = features.build_dataset([corrupt_below(well, cut), other], STRAT, rows_for={well.wellbore_id})
    feature_cols = list(features.BASE_FEATURES) + [f"{p}_{r}" for p in ("l1", "nearest") for r in features.RISK_TYPES]
    a, b = base[base.md_from_m <= cut].reset_index(drop=True), changed[changed.md_from_m <= cut].reset_index(drop=True)
    assert len(a) == len(b) > 0
    for col in feature_cols:
        assert np.allclose(a[col].to_numpy(float), b[col].to_numpy(float), equal_nan=True), col


def test_a_wells_own_deeper_tops_do_not_leak_into_its_relative_depth_through_thickness():
    well, other = make_well("A"), make_well("B", lon=95.05, seed=1)
    shifted = copy.deepcopy(well)
    shifted.tops["Barail"] += 150.0  # changes the well's own Tipam thickness, which must not matter
    a = features.build_dataset([well, other], STRAT, rows_for={well.wellbore_id})
    b = features.build_dataset([shifted, other], STRAT, rows_for={well.wellbore_id})
    early = a.md_from_m <= 550  # the bit is still above the shifted Barail top
    assert np.allclose(a.loc[early, "relative_depth"], b.loc[early, "relative_depth"], equal_nan=True)


def test_window_stats_use_only_the_30_m_above_the_start():
    md = np.arange(0.0, 200.0)
    series = {"md_m": md, "flow_in_lpm": np.full(md.size, 2000.0), "flow_out_lpm": np.full(md.size, 2000.0)}
    for col in features.SERIES_COLUMNS:
        series.setdefault(col, np.full(md.size, np.nan))
    series["rop_m_h"] = 10.0 + 0.1 * md  # a ramp: slope 0.1 per metre
    series["torque_knm"] = np.where(md > 100, 1e6, 5.0)  # junk below the interval start
    stats = features.window_stats(series, 100.0)
    window = (md > 70) & (md <= 100)
    assert stats["rop_m_h_mean_30m"] == pytest.approx(series["rop_m_h"][window].mean())
    assert stats["rop_m_h_slope_30m"] == pytest.approx(0.1 * 30.0)
    assert stats["torque_knm_mean_30m"] == 5.0 and stats["torque_knm_slope_30m"] == pytest.approx(0.0)
    assert stats["flow_ratio_mean_30m"] == 1.0
    assert math.isnan(stats["dxc_mean_30m"])  # channel absent: unknown, not zero


def test_window_with_too_few_points_is_unknown():
    series = {"md_m": np.array([0.0, 1.0]), **{c: np.array([1.0, 2.0]) for c in features.SERIES_COLUMNS}}
    assert math.isnan(features.window_stats(series, 1.0)["rop_m_h_mean_30m"])


def test_formation_is_the_deepest_top_at_or_above_the_start():
    well = make_well()
    assert features.formation_at(well, 50.0) == (None, None)
    assert features.formation_at(well, 100.0) == ("Tipam", 100.0)
    assert features.formation_at(well, 599.9) == ("Tipam", 100.0)
    assert features.formation_at(well, 600.0) == ("Barail", 600.0)


def test_base_feature_values():
    well = make_well()
    f, formation, top = features.base_features(well, 350.0, STRAT, {"Tipam": 500.0})
    assert (formation, top) == ("Tipam", 100.0)
    assert f["strat_order"] == 1 and f["relative_depth"] == pytest.approx(0.5) and f["tvd_m"] == pytest.approx(350.0)
    assert f["hole_size_in"] == 12.25 and f["mw_sg"] == pytest.approx(1.2, abs=0.1)
    assert math.isnan(features.base_features(well, 50.0, STRAT, {})[0]["strat_order"])  # above the first top
    assert math.isnan(features.base_features(well, 350.0, STRAT, {})[0]["relative_depth"])  # no thickness estimate


def test_tvd_extends_along_the_last_surveyed_inclination_instead_of_reading_ahead():
    well = make_well()
    well.stations = [{"md_m": 0.0, "tvd_m": 0.0, "inc_deg": 0.0, "north_m": 0, "east_m": 0},
                     {"md_m": 100.0, "tvd_m": 100.0, "inc_deg": 60.0, "north_m": 0, "east_m": 0},
                     {"md_m": 400.0, "tvd_m": 5000.0, "inc_deg": 0.0, "north_m": 0, "east_m": 0}]  # fmt: skip
    f, _, _ = features.base_features(well, 300.0, STRAT, {})
    assert f["tvd_m"] == pytest.approx(100.0 + 200.0 * math.cos(math.radians(60.0)))  # never uses the 400 m station


# ---------------------------------------------------------------- labels


def test_label_window_is_50_to_300_m_below_the_start_inclusive():
    well = make_well(events=[event(450.0), event(700.0, "kick")])
    assert features.labels(well, 400.0)["y_losses"] == 1  # 450 = start + 50
    assert features.labels(well, 400.1)["y_losses"] == 0  # 49.9 m ahead
    assert features.labels(well, 150.0)["y_losses"] == 1  # 450 = start + 300
    assert features.labels(well, 149.9)["y_losses"] == 0
    assert features.labels(well, 400.0)["y_kick"] == 1 and features.labels(well, 400.0)["y_stuck_pipe"] == 0
    assert set(features.labels(well, 0.0)) == {f"y_{r}" for r in features.RISK_TYPES}


# ---------------------------------------------------------------- offset features and cross-validation exclusion


def test_l1_feature_uses_other_wells_and_never_the_well_itself():
    # Tipam top 100 m, median thickness 500 m: an event at 300 m is at relative depth 0.4
    target = make_well("T", events=[event(300.0, rel=0.4)])  # its own event must not count
    quiet, noisy = make_well("Q", lon=95.02, seed=1), make_well("N", lon=95.03, seed=2, events=[event(300.0, rel=0.4)])
    frame = features.build_dataset([target, quiet, noisy], STRAT, rows_for={target.wellbore_id})
    row = frame[frame.md_from_m == 300.0].iloc[0]  # same depth below the top as the offset's event
    own_only = features.build_dataset([target, make_well("Q", lon=95.02, seed=1)], STRAT, rows_for={target.wellbore_id})
    own_row = own_only[own_only.md_from_m == 300.0].iloc[0]
    assert row["l1_losses"] > own_row["l1_losses"]  # the noisy offset's event raised l1
    assert own_row["l1_losses"] < 0.5  # the well's own event did not (one quiet offset, no hit)
    assert row["nearest_losses"] == pytest.approx(0.0, abs=1.0) and math.isnan(own_row["nearest_losses"])
    far = frame[frame.md_from_m == 500.0].iloc[0]
    assert far["nearest_losses"] == pytest.approx(200.0, abs=1.0)  # 200 m below the offset event's depth


def test_pool_exclude_recomputes_features_without_a_held_out_wells_events():
    target = make_well("T")
    noisy = make_well("N", lon=95.03, seed=2, events=[event(300.0)])
    quiet = make_well("Q", lon=95.02, seed=1)
    with_noisy = features.build_dataset([target, quiet, noisy], STRAT, rows_for={target.wellbore_id})
    held_out = features.build_dataset([target, quiet, noisy], STRAT, rows_for={target.wellbore_id}, pool_exclude={noisy.wellbore_id})
    without = features.build_dataset([target, quiet], STRAT, rows_for={target.wellbore_id})
    a, b = held_out.l1_losses.to_numpy(), without.l1_losses.to_numpy()
    assert np.allclose(a, b, equal_nan=True)
    assert not np.allclose(with_noisy.l1_losses.to_numpy(), a, equal_nan=True)
    assert held_out.nearest_losses.isna().all()


def test_offsets_that_never_drilled_the_formation_leave_l1_unknown():
    target, other = make_well("T"), make_well("O", lon=95.02, seed=1)
    other.tops = {"Girujan": 900.0}
    frame = features.build_dataset([target, other], STRAT, rows_for={target.wellbore_id})
    early = frame[(frame.md_from_m >= 100) & (frame.md_from_m < 600)]
    assert early.l1_losses.isna().all()


def test_offsets_beyond_the_radius_are_ignored():
    target, far = make_well("T"), make_well("F", lon=96.5, events=[event(300.0)])  # about 150 km away
    frame = features.build_dataset([target, far], STRAT, rows_for={target.wellbore_id})
    assert frame.l1_losses.isna().all()


def test_matrix_has_the_model_features_in_order_with_per_risk_columns():
    frame = features.build_dataset([make_well("T"), make_well("O", lon=95.02, seed=1)], STRAT)
    x = features.matrix_for(frame, "kick")
    assert list(x.columns) == list(features.MODEL_FEATURES) and len(x) == len(frame)
    assert x["l1"].equals(frame["l1_kick"])


def test_thickness_is_the_median_over_wells():
    wells = [make_well("A", top_shift=0), make_well("B", top_shift=30), make_well("C", top_shift=60)]
    wells[1].tops["Barail"] += 40  # Tipam thickness 540 in B, 500 elsewhere
    assert features.thickness_by_formation(wells, STRAT) == {"Tipam": 500.0, "Barail": 300.0}


def test_dataset_rows_are_one_per_25_m_and_carry_meta_and_all_labels():
    frame = features.build_dataset([make_well("T", td=500.0)], STRAT)
    assert list(frame.md_from_m) == [float(m) for m in range(0, 500, 25)]
    assert set(features.META_COLUMNS) <= set(frame.columns) and {f"y_{r}" for r in features.RISK_TYPES} <= set(frame.columns)


def test_surface_distance_is_haversine():
    a, b = make_well("A", lon=95.0, lat=27.0), make_well("B", lon=95.0, lat=28.0)
    assert features.surface_distance_m(a, b) == pytest.approx(111_195, rel=0.005)
    assert features.surface_distance_m(a, a) == 0.0


# ---------------------------------------------------------------- database loader


@pytest.mark.asyncio
async def test_load_wells_assembles_well_data_from_the_tables(monkeypatch):
    wb = uuid4()

    async def fetch_all(sql, params=None):
        if "from wellbores wb join wells" in sql:
            return [{"wellbore_id": wb, "well_id": uuid4(), "name": "SYN-1", "provenance": "synthetic", "kb_elev_m": None, "lon": 95.0, "lat": 27.0}]
        if "from formations" in sql:
            return [{"name": "Tipam", "strat_order": 1}]
        if "from depth_series" in sql:
            return [{"md_m": 2.0, "rop_m_h": 11.0}, {"md_m": 1.0, "rop_m_h": None}]
        if "from survey_stations" in sql:
            return [{"md_m": 0.0, "inc_deg": 0.0, "tvd_m": 0.0, "north_m": 0.0, "east_m": 0.0}]
        if "from formation_tops" in sql:
            assert "source = 'actual'" in sql
            return [{"formation": "Tipam", "top_md_m": 1.0}]
        if "from events" in sql:
            assert "<> 'rejected'" in sql
            return []
        if "from hole_sections" in sql:
            assert "planned = false" in sql
            return []
        raise AssertionError(sql)

    monkeypatch.setattr(db, "fetch_all", fetch_all)
    wells, strat = await features.load_wells()
    assert strat == {"Tipam": 1} and len(wells) == 1
    well = wells[0]
    assert well.name == "SYN-1" and well.kb_elev_m == 0.0 and well.tops == {"Tipam": 1.0}
    assert list(well.series["md_m"]) == [1.0, 2.0] and math.isnan(well.series["rop_m_h"][0]) and well.series["rop_m_h"][1] == 11.0
    assert math.isnan(well.series["torque_knm"][0])

"""DB-09: the synthetic Assam dataset, checked offline (no database needed).

  services/ai/.venv/Scripts/python -m pytest db/tests/test_synth.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "ai"))

from db.loaders import synth_assam as sa  # noqa: E402
from db.loaders.check_signatures import first_fire  # noqa: E402


@pytest.fixture(scope="module")
def data():
    return sa.generate(42)


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def real(data):
    return [w for w in data.wells if w.status != "planned"]


def test_thirty_labelled_wells_in_three_clusters(data):
    assert len(data.wells) == 30
    assert {w.status for w in data.wells} == {"completed", "drilling", "planned"}
    counts = {s: sum(1 for w in data.wells if w.status == s) for s in ("completed", "drilling", "planned")}
    assert counts == {"completed": 26, "drilling": 3, "planned": 1}
    assert all(w.name.startswith("SYN-") for w in data.wells)
    assert {w.field for w in data.wells} == {"SYN-Duliajan", "SYN-Naharkatiya", "SYN-Moran"}
    assert {w.name for w in data.wells if w.status == "drilling"} == {"SYN-DLJ-03", "SYN-NHK-03", "SYN-MRN-03"}
    assert all(26.9 <= w.lat <= 27.6 and 94.8 <= w.lon <= 95.6 for w in data.wells)
    assert len({w.name for w in data.wells}) == 30


def test_trajectory_mix_is_40_50_10_percent(data):
    kinds = [w.kind for w in real(data)]
    assert (kinds.count("vertical"), kinds.count("deviated"), kinds.count("horizontal")) == (12, 14, 3)
    assert next(w for w in data.wells if w.status == "planned").kind == "vertical"
    for w in real(data):
        inc = w.stations["inc"]
        if w.kind == "vertical":
            assert inc.max() == 0
        elif w.kind == "deviated":
            assert 20 <= inc.max() <= 45
        else:
            assert 70 <= inc.max() <= 80
        assert w.stations["dls"][1:].max() <= 4.0  # builds are 2-3.5 deg / 30 m
        assert np.all(np.diff(w.stations["md"]) == 30.0)


def test_vertical_wells_have_tvd_equal_to_md(data):
    for w in real(data):
        if w.kind == "vertical":
            assert np.allclose(w.stations["tvd"], w.stations["md"])
            assert np.allclose(w.stations["north"], 0) and np.allclose(w.stations["east"], 0)


def test_every_well_has_tops_in_order_and_at_least_eight(data):
    for w in data.wells:
        names = list(w.tops_md)
        assert len(names) >= 8, w.name
        assert names == list(data.config["tops"])[: len(names)]
        tvd = [w.tops_tvd[n] for n in names]
        md = [w.tops_md[n] for n in names]
        assert tvd == sorted(tvd) and md == sorted(md)
        assert all(b - a >= 39.0 for a, b in zip(tvd, tvd[1:]))
        assert md[-1] < w.td_md_m
    # regional dip of 40 m/km towards the south-east: relative to Duliajan, Naharkatiya is 1.3 km "down-dip" (+54 m) and
    # Moran 6.9 km "up-dip" (-275 m); the 15 m noise and the spread of the wells are far smaller than the Moran step
    by_cluster = {c: np.mean([w.tops_tvd["Tipam"] for w in data.wells if w.cluster == c]) for c in ("DLJ", "NHK", "MRN")}
    assert by_cluster["NHK"] > by_cluster["DLJ"] > by_cluster["MRN"]
    assert by_cluster["DLJ"] - by_cluster["MRN"] > 150


def test_casing_cement_and_mud_programs(data):
    for w in real(data):
        assert len(w.sections) == 3 and len(w.cement) == 3
        assert [s["hole_size_in"] for s in w.sections] == [17.5, 12.25, 8.5]
        assert [s["casing_od_in"] for s in w.sections][:2] == [13.375, 9.625]
        assert w.shoes["surface"] < w.shoes["intermediate"] < w.shoes["production"]
        # the 12 1/4" shoe is 30 m (TVD) above the Tipam top
        assert tvd_gap(w) == pytest.approx(30.0, abs=1.5)
        mw = [m["mw_sg"] for m in w.mud]
        assert len(mw) >= 30 and 1.0 <= min(mw) and max(mw) <= 1.95
        assert mw[-1] > mw[0]
        assert all(abs(m["md_m"] % 100) < 1e-6 for m in w.mud)


def tvd_gap(w):
    return w.tops_tvd["Tipam"] - sa.tvd_at_md(w, w.shoes["intermediate"])


def test_events_lie_inside_their_formation_and_are_complete(data):
    for w in real(data):
        for e in w.events:
            top, base = sa.formation_interval(w, e["formation"])
            assert top <= e["md_from_m"] <= base, (w.name, e)
            assert e["md_from_m"] <= e["md_to_m"] <= base
            assert 0.0 <= e["relative_depth"] <= 1.0
            assert 1 <= e["severity"] <= 5 and e["npt_h"] > 0
            assert e["risk_type"] == sa.RISK_OF[e["event_type"]]
            assert 0.9 <= e["confidence"] <= 1.0
            assert e["description"] and e["cause"] and e["action"] and e["outcome"]
            assert "{" not in e["description"] + e["cause"] + e["action"] + e["outcome"]  # every placeholder was filled
            if e["event_type"].startswith("loss"):
                assert e["volume_m3"] and e["volume_m3"] > 0


def test_event_texts_have_at_least_five_variants_per_type():
    text = sa.load_templates()
    for etype in sa.SEVERITY:
        for key in ("description", "cause", "action", "outcome"):
            assert len(text[etype][key]) >= 5, (etype, key)


def test_event_mix_is_plausible(data):
    tipam_losses = sum(1 for w in real(data) if any(e["formation"] == "Tipam" and e["risk_type"] == "losses" for e in w.events))
    assert 0.35 <= tipam_losses / len(real(data)) <= 0.80  # configured at 55 %
    types = {e["event_type"] for w in data.wells for e in w.events}
    assert {"loss_partial", "kick", "stuck_pipe_diff", "tight_hole", "torque_spike", "cement_failure"} <= types
    for w in data.wells:
        for e in w.events:
            if e["event_type"] == "loss_partial" and e["formation"] == "Tipam":
                top, base = sa.formation_interval(w, "Tipam")
                assert e["md_from_m"] >= top + (base - top) * (2 / 3 - 0.01) or w.status == "drilling"


def test_same_seed_gives_the_same_data_and_another_seed_does_not(data):
    again = sa.generate(42, with_series=False)
    assert [w.name for w in again.wells] == [w.name for w in data.wells]
    assert [w.events[0]["id"] if w.events else None for w in again.wells] == [w.events[0]["id"] if w.events else None for w in data.wells]
    assert [e["md_from_m"] for w in again.wells for e in w.events] == [e["md_from_m"] for w in data.wells for e in w.events]
    assert again.truth == data.truth
    other = sa.generate(7, with_series=False)
    assert [e["md_from_m"] for w in other.wells for e in w.events] != [e["md_from_m"] for w in data.wells for e in w.events]


def test_row_counts_do_not_change_between_runs(data):
    a = {k: len(v) for k, v in sa.table_rows(data).items()}
    b = {k: len(v) for k, v in sa.table_rows(sa.generate(42)).items()}
    assert a == b
    assert a["wells"] == 30 and a["wellbores"] == 30 and a["stream_state"] == 3


def test_every_drilling_well_has_at_least_five_offsets_within_10_km(data):
    for w in data.wells:
        if w.status == "drilling":
            near = [o for o in data.wells if o is not w and haversine_km(w.lon, w.lat, o.lon, o.lat) <= 10.0]
            assert len(near) >= 5, w.name


def test_drilling_wells_hide_their_future(data):
    rows = sa.table_rows(data)
    for w in data.wells:
        if w.status != "drilling":
            continue
        start = w.start_md
        assert 0 < start < w.td_md_m
        hidden = data.truth[w.name]
        assert hidden and all(h["md_from_m"] > start for h in hidden)
        # at least one hazard within 300 m below the start depth, and further than 50 m (so a look-ahead score can warn)
        ahead = [h["md_from_m"] - start for h in hidden]
        assert min(ahead) <= 300.0 and min(ahead) >= 50.0
        assert set(hidden[0]) == {"event_type", "md_from_m", "md_to_m", "formation"}
        # nothing below the start depth is stored in events, tops, mud or sections
        wb = w.wellbore_id
        assert all(r[4] <= start for r in rows["events"] if r[1] == wb)
        assert all(r[2] <= start for r in rows["formation_tops"] if r[0] == wb)
        assert all(r[2] <= start for r in rows["mud_records"] if r[0] == wb)
        sections = [r for r in rows["hole_sections"] if r[0] == wb]
        assert all((r[3] is None) or r[3] <= start for r in sections)
        state = [r for r in rows["stream_state"] if r[0] == wb][0]
        assert state[1] == "stopped" and state[4] == start
        # the whole series to TD exists (RLS hides the part below the bit, the replay reveals it)
        assert w.series["md_m"][-1] == pytest.approx(w.td_md_m, abs=0.5)
    # only the three drilling wells have truth files
    assert set(data.truth) == {"SYN-DLJ-03", "SYN-NHK-03", "SYN-MRN-03"}


def test_the_demo_hazards_are_the_planned_ones(data):
    kinds = {name: items[0]["event_type"] for name, items in data.truth.items()}
    assert kinds == {"SYN-DLJ-03": "loss_partial", "SYN-NHK-03": "stuck_pipe_diff", "SYN-MRN-03": "kick"}
    assert {n: items[0]["formation"] for n, items in data.truth.items()} == {"SYN-DLJ-03": "Tipam", "SYN-NHK-03": "Barail", "SYN-MRN-03": "Kopili"}


def test_planned_well_has_prognosis_tops_and_nothing_else(data):
    rows = sa.table_rows(data)
    w = next(x for x in data.wells if x.status == "planned")
    tops = [r for r in rows["formation_tops"] if r[0] == w.wellbore_id]
    assert tops and all(r[4] == "prognosis" for r in tops)
    for table in ("events", "mud_records", "depth_series", "hole_sections", "cement_jobs"):
        assert not [r for r in rows[table] if r[1 if table == "events" else 0] == w.wellbore_id]


def test_depth_series_is_dense_sane_and_replayable(data):
    for w in real(data):
        s = w.series
        md = s["md_m"]
        assert md[0] == pytest.approx(0.5) and np.allclose(np.diff(md), 0.5)
        assert 5 <= s["gr_api"].min() and s["gr_api"].max() <= 180
        assert s["flow_out_lpm"].min() >= 0 and s["pit_vol_m3"].min() >= 5
        assert 1.0 <= s["mw_sg"].min() and s["mw_sg"].max() <= 1.95
        assert np.all(s["ecd_sg"] >= s["mw_sg"] - 0.02)
        assert 0.05 <= s["gas_total_pct"].min() and s["gas_total_pct"].max() < 12
        # one connection (pumps off) per stand; those samples have no flow and no rotation
        conn = s["connection"]
        assert abs(conn.sum() - w.td_md_m / 28.5) <= 2
        assert np.all(s["flow_in_lpm"][conn] == 0) and np.all(s["rpm"][conn] == 0) and np.all(s["rop_m_h"][conn] == 0)
        assert np.all(s["flow_in_lpm"][~conn] > 500)
        # time moves forward and never jumps (a replay waits for the difference of two samples)
        dt = np.diff([x.timestamp() for x in s["t"]])
        assert dt.min() > 0 and dt.max() < 1500


def test_lithology_drives_the_gamma_ray_log(data):
    w = next(x for x in real(data) if x.kind == "vertical")
    s = w.series
    names = np.array(["shale", "sandstone", "coal", "limestone"])[s["lith"]]
    assert s["gr_api"][names == "shale"].mean() > s["gr_api"][names == "sandstone"].mean() + 30
    assert s["gr_api"][names == "coal"].mean() < s["gr_api"][names == "shale"].mean()


@pytest.mark.parametrize("name", ["SYN-DLJ-03", "SYN-NHK-03", "SYN-MRN-03"])
def test_the_demo_hazards_trip_the_live_detectors_before_the_event_depth(data, name):
    pytest.importorskip("app.risk.l3", reason="needs services/ai on sys.path")
    w = next(x for x in data.wells if x.name == name)
    hz = data.truth[name][0]
    fired = first_fire(w.series, hz["md_from_m"] - 250.0, hz["md_from_m"] + 15.0)
    wanted = {"loss_partial": {"losses", "total_losses"}, "stuck_pipe_diff": {"stuck_pipe"}, "kick": {"kick", "overpressure"}}[hz["event_type"]]
    assert any(n in fired and fired[n] <= hz["md_from_m"] + 3.0 for n in wanted), fired


def test_table_rows_match_the_column_lists(data):
    rows = sa.table_rows(data)
    for table, cols in sa.COLUMNS.items():
        assert rows[table], table
        assert {len(r) for r in rows[table]} == {len(cols)}, table


def test_truth_files_are_written_in_the_agreed_shape(data, tmp_path):
    paths = sa.write_truth(data, tmp_path)
    assert sorted(p.name for p in paths) == ["SYN-DLJ-03.json", "SYN-MRN-03.json", "SYN-NHK-03.json"]
    import json

    items = json.loads((tmp_path / "SYN-DLJ-03.json").read_text())
    assert items[0].keys() == {"event_type", "md_from_m", "md_to_m", "formation"}

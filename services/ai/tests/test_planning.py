"""BE-23: planning brief for a virtual vertical well (DB mocked, read-only)."""

import math
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main
from app.geo import planning, tops

TOKEN = "test-token"
A, B, C = str(uuid4()), str(uuid4()), str(uuid4())
KB = 20.0
VERTICAL = [{"md_m": 0.0, "tvd_m": 0.0, "inc_deg": 0.0, "north_m": 0.0, "east_m": 0.0},
            {"md_m": 4000.0, "tvd_m": 4000.0, "inc_deg": 0.0, "north_m": 0.0, "east_m": 0.0}]  # fmt: skip

TIPAM = {A: 1000.0, B: 1100.0, C: 900.0}  # TVDSS of the Tipam top in each offset
BARAIL = {A: 2000.0, B: 2100.0, C: 1900.0}
DISTANCE = {A: 1000.0, B: 2000.0, C: 3000.0}
LESSON = {"id": uuid4(), "formation": "Tipam", "event_type": "loss_partial", "title": "LCM pills", "mitigation": "Pump LCM", "well_count": 2, "success_rate": 0.8}
KICK_LESSON = {**LESSON, "id": uuid4(), "event_type": "kick", "title": "Weight up"}
BARAIL_LESSON = {**LESSON, "id": uuid4(), "formation": "Barail", "title": "Barail losses"}


class FakeDb:
    def __init__(self):
        self.offsets = [
            {"wellbore_id": A, "well_name": "SYN-A", "basin": "Assam", "kb_elev_m": KB, "surface_distance_m": 1000.04},
            {"wellbore_id": B, "well_name": "SYN-B", "basin": "Assam", "kb_elev_m": KB, "surface_distance_m": 2000.0},
            {"wellbore_id": C, "well_name": "SYN-C", "basin": "Assam", "kb_elev_m": KB, "surface_distance_m": 3000.0},
        ]  # fmt: skip
        self.formations = [{"name": "Tipam", "strat_order": 1}, {"name": "Barail", "strat_order": 2}]
        self.tvdss = {"Tipam": dict(TIPAM), "Barail": dict(BARAIL)}
        self.events = [
            {"id": uuid4(), "wellbore_id": A, "risk_type": "losses", "formation": "Tipam", "md_from_m": 1180.0,
             "relative_depth": 0.16, "review_status": "approved", "confidence": 0.9},
            {"id": uuid4(), "wellbore_id": B, "risk_type": "losses", "formation": "Tipam", "md_from_m": 1280.0,
             "relative_depth": 0.16, "review_status": "approved", "confidence": 0.9},
        ]  # fmt: skip
        self.lessons = [LESSON, KICK_LESSON, BARAIL_LESSON]
        self.sql = []
        self.params = {}

    async def fetch_all(self, sql, params=None):
        self.sql.append(sql)
        if "from wells w join wellbores wb" in sql:
            self.params["offsets"] = params
            return self.offsets
        if "from formations" in sql:
            self.params["formations"] = params
            return self.formations
        if "from formation_tops" in sql and "top_tvdss_m" in sql:
            return [{"wellbore_id": wb, "formation": f, "top_md_m": v[wb] + KB, "top_tvdss_m": v[wb]}
                    for f, v in self.tvdss.items() for wb in v]  # fmt: skip
        if "from formation_tops" in sql:
            return [{"wellbore_id": wb, "formation": f, "top_md_m": v[wb] + KB} for f, v in self.tvdss.items() for wb in v]
        if "from survey_stations" in sql:
            return [dict(s, wellbore_id=wb) for wb in params["ids"] for s in VERTICAL]
        if "kb_elev_m" in sql:
            return [{"wellbore_id": wb, "kb_elev_m": KB} for wb in params["ids"]]
        if "from events" in sql:
            assert "<> 'rejected'" in sql
            return self.events
        if "from lessons" in sql:
            self.params["lessons"] = params
            return self.lessons
        raise AssertionError(sql)


@pytest.fixture
def fake(monkeypatch):
    f = FakeDb()

    async def forbidden(*args, **kwargs):
        raise AssertionError("the planning brief must not write to the database")

    monkeypatch.setattr(db, "fetch_all", f.fetch_all)
    for name in ("execute", "execute_many", "fetch_one", "call_fn"):
        monkeypatch.setattr(db, name, forbidden)
    return f


# ---------------------------------------------------------------- pure helpers


def test_interval_bounds_are_25_m_with_a_shorter_last_interval():
    assert planning.interval_bounds(50) == [(0.0, 25.0), (25.0, 50.0)]
    assert planning.interval_bounds(60) == [(0.0, 25.0), (25.0, 50.0), (50.0, 60.0)]


def test_formation_at_returns_the_deepest_top_above_and_the_next_top():
    ps = [tops.PredictedTop("Tipam", 1, 1000, 1020, 20, 3), tops.PredictedTop("Barail", 2, 2000, 2020, 20, 3)]
    assert planning.formation_at(ps, 500) == (None, None)
    assert planning.formation_at(ps, 1500)[0].formation == "Tipam" and planning.formation_at(ps, 1500)[1] == 2020
    assert planning.formation_at(ps, 2500)[0].formation == "Barail" and planning.formation_at(ps, 2500)[1] is None


def test_depth_distance_combines_surface_distance_and_vertical_offset():
    assert planning.depth_distance_m(3000.0, 2000.0, 1996.0) == pytest.approx(math.hypot(3000.0, 4.0))
    assert planning.depth_distance_m(0.0, 2000.0, 1500.0) == 500.0


def test_main_basin_is_the_most_common_one():
    assert planning.main_basin([{"basin": "A"}, {"basin": "B"}, {"basin": "B"}, {"basin": None}]) == "B"
    assert planning.main_basin([{"basin": None}]) is None


# ---------------------------------------------------------------- the brief


@pytest.mark.asyncio
async def test_brief_has_the_contract_shape(fake):
    result = await planning.brief(27.35, 95.30, 3000.0, 10000.0)
    assert set(result) == {"location", "offsets", "predicted_tops", "risk_profile", "lessons"}
    assert result["location"] == {"lat": 27.35, "lon": 95.30}
    assert result["offsets"][0] == {"wellbore_id": A, "well_name": "SYN-A", "surface_distance_m": 1000.0}
    assert [o["well_name"] for o in result["offsets"]] == ["SYN-A", "SYN-B", "SYN-C"]
    assert set(result["predicted_tops"][0]) == {"formation", "top_md_m", "uncertainty_m", "n_offsets"}
    assert set(result["risk_profile"][0]) == {"md_from_m", "md_to_m", "risk_type", "fused", "band", "confidence"}
    assert set(result["lessons"][0]) == {"id", "formation", "event_type", "title", "mitigation", "well_count"}


@pytest.mark.asyncio
async def test_offsets_come_from_a_spatial_query_with_the_radius_and_a_limit(fake):
    await planning.brief(27.35, 95.30, 3000.0, 7500.0)
    sql = next(s for s in fake.sql if "from wells w join wellbores wb" in s)
    assert "ST_DWithin" in sql and "is_primary" in sql and "w.status <> 'planned'" in sql
    assert fake.params["offsets"] == {"lat": 27.35, "lon": 95.30, "radius": 7500.0, "limit": 12}
    assert fake.params["formations"] == {"basin": "Assam"}  # the offsets' main basin picks the formations


@pytest.mark.asyncio
async def test_predicted_tops_are_idw_with_tvd_equal_to_md(fake):
    result = await planning.brief(27.35, 95.30, 3000.0, 10000.0)
    tipam = tops.idw([(DISTANCE[w], TIPAM[w]) for w in (A, B, C)])
    top = result["predicted_tops"][0]
    assert top["formation"] == "Tipam" and top["n_offsets"] == 3
    assert top["top_md_m"] == pytest.approx(tipam + KB, abs=0.06)  # vertical: MD = TVDSS + the offsets' mean KB
    assert top["uncertainty_m"] >= tops.MIN_UNCERTAINTY_M
    assert [t["formation"] for t in result["predicted_tops"]] == ["Tipam", "Barail"]
    assert result["predicted_tops"][0]["top_md_m"] < result["predicted_tops"][1]["top_md_m"]


@pytest.mark.asyncio
async def test_a_formation_with_one_offset_is_skipped(fake):
    fake.tvdss["Barail"] = {A: 2000.0}
    result = await planning.brief(27.35, 95.30, 3000.0, 10000.0)
    assert [t["formation"] for t in result["predicted_tops"]] == ["Tipam"]


@pytest.mark.asyncio
async def test_risk_profile_is_high_where_offsets_had_losses_and_low_elsewhere(fake):
    result = await planning.brief(27.35, 95.30, 3000.0, 10000.0)
    tipam_top = result["predicted_tops"][0]["top_md_m"]
    rows = result["risk_profile"]
    assert all(r["md_to_m"] <= 3000.0 for r in rows) and min(r["md_from_m"] for r in rows) >= 0
    assert all(r["md_from_m"] + 25 > tipam_top for r in rows)  # nothing above the first predicted top
    losses = {r["md_from_m"]: r for r in rows if r["risk_type"] == "losses"}
    hit = [r for md, r in losses.items() if md <= tipam_top + 160 < md + 25]
    assert hit and hit[0]["band"] == "high" and hit[0]["confidence"] == "high" and hit[0]["fused"] == pytest.approx(66.5, abs=1.0)
    quiet = losses[min(losses)]
    assert quiet["band"] == "low" and quiet["confidence"] == "medium"  # three offsets, no matching events
    assert {r["band"] for r in rows if r["risk_type"] == "kick"} == {"low"}


@pytest.mark.asyncio
async def test_all_five_risk_types_are_profiled(fake):
    rows = (await planning.brief(27.35, 95.30, 3000.0, 10000.0))["risk_profile"]
    assert {r["risk_type"] for r in rows} == {"losses", "stuck_pipe", "kick", "torque", "cementing"}
    one_interval = [r for r in rows if r["md_from_m"] == rows[0]["md_from_m"]]
    assert len(one_interval) == 5


@pytest.mark.asyncio
async def test_offsets_that_never_drilled_a_formation_do_not_count(fake):
    del fake.tvdss["Tipam"][C]
    rows = (await planning.brief(27.35, 95.30, 3000.0, 10000.0))["risk_profile"]
    tipam_top = (await planning.brief(27.35, 95.30, 3000.0, 10000.0))["predicted_tops"][0]["top_md_m"]
    hit = next(r for r in rows if r["risk_type"] == "losses" and r["md_from_m"] <= tipam_top + 160 < r["md_from_m"] + 25)
    assert hit["confidence"] == "medium"  # two offsets now, not three


@pytest.mark.asyncio
async def test_lessons_only_for_elevated_formation_and_risk_pairs(fake):
    result = await planning.brief(27.35, 95.30, 3000.0, 10000.0)
    assert [l["title"] for l in result["lessons"]] == ["LCM pills"]  # Tipam losses is high; Tipam kick and Barail are not
    assert fake.params["lessons"] == {"f": ["Tipam"]}


@pytest.mark.asyncio
async def test_no_offsets_gives_an_empty_brief_without_further_queries(fake):
    fake.offsets = []
    result = await planning.brief(10.0, 20.0, 3000.0, 10000.0)
    assert result == {"location": {"lat": 10.0, "lon": 20.0}, "offsets": [], "predicted_tops": [], "risk_profile": [], "lessons": []}
    assert len(fake.sql) == 1


@pytest.mark.asyncio
async def test_a_planned_td_above_every_predicted_top_gives_an_empty_profile(fake):
    result = await planning.brief(27.35, 95.30, 500.0, 10000.0)
    assert result["risk_profile"] == [] and result["lessons"] == []


# ---------------------------------------------------------------- route


@pytest.fixture
def client(fake, monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return TestClient(app_main.app)


def headers(role="office_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


GOOD = {"lat": 27.35, "lon": 95.30, "planned_td_m": 3600}


def test_route_returns_the_brief_and_defaults_the_radius(client, fake):
    response = client.post("/v1/planning/brief", json=GOOD, headers=headers())
    assert response.status_code == 200 and response.json()["location"] == {"lat": 27.35, "lon": 95.30}
    assert fake.params["offsets"]["radius"] == 10000.0
    assert client.post("/v1/planning/brief", json={**GOOD, "radius_m": 5000}, headers=headers("admin")).status_code == 200
    assert fake.params["offsets"]["radius"] == 5000.0


@pytest.mark.parametrize("body", [{**GOOD, "lat": 91}, {**GOOD, "lon": -181}, {**GOOD, "planned_td_m": 0},
                                  {**GOOD, "planned_td_m": 20000}, {**GOOD, "radius_m": -1}, {"lat": 1, "lon": 2}])  # fmt: skip
def test_route_rejects_bad_bodies(client, body):
    assert client.post("/v1/planning/brief", json=body, headers=headers()).status_code == 400


def test_route_is_for_office_engineer_and_admin_only(client):
    for role in ("rig_engineer", "rtoc_engineer", "reviewer", "nobody"):
        assert client.post("/v1/planning/brief", json=GOOD, headers=headers(role)).status_code == 403
    assert client.post("/v1/planning/brief", json=GOOD).status_code == 401

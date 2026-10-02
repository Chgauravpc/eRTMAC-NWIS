"""BE-12: predicted formation tops (IDW) and position helpers. DB mocked, hand-computed numbers."""

import math
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main
from app.errors import NwisError
from app.geo import position, tops
from training import eval_tops

TOKEN = "test-token"
ACTIVE = str(uuid4())
OFF_A, OFF_B = str(uuid4()), str(uuid4())


def st(md, tvd, inc=0.0, north=0.0, east=0.0):
    return {"md_m": md, "tvd_m": tvd, "inc_deg": inc, "north_m": north, "east_m": east}


# a vertical hole to 1000 m, then 30 degrees inclination to 2000 m MD
SURVEY = [st(0, 0), st(1000, 1000), st(2000, 1900, inc=30.0, north=500.0, east=0.0)]


# ---------------------------------------------------------------- position


def test_interpolate_clamps_like_the_sql_function():
    assert position.interpolate(SURVEY, 500) == (0.0, 0.0, 500.0)
    assert position.interpolate(SURVEY, 1500) == (250.0, 0.0, 1450.0)
    assert position.interpolate(SURVEY, 5000) == (500.0, 0.0, 1900.0)  # clamped, not extended
    assert position.interpolate(SURVEY, -10) == (0.0, 0.0, 0.0)
    assert position.interpolate([], 700) == (0.0, 0.0, 700)  # no survey: vertical at the surface


def test_md_at_tvd_interpolates_and_extends_past_the_last_station():
    assert position.md_at_tvd(SURVEY, 500) == pytest.approx(500)
    assert position.md_at_tvd(SURVEY, 1450) == pytest.approx(1500)
    assert position.md_at_tvd(SURVEY, 2000) == pytest.approx(2000 + 100 / math.cos(math.radians(30)))
    assert position.md_at_tvd([], 800) == 800


def test_tvd_at_md_extends_and_is_the_inverse_of_md_at_tvd():
    assert position.tvd_at_md(SURVEY, 2100) == pytest.approx(1900 + 100 * math.cos(math.radians(30)))
    for tvd in (300, 1450, 1950):
        assert position.tvd_at_md(SURVEY, position.md_at_tvd(SURVEY, tvd)) == pytest.approx(tvd)


def test_near_horizontal_last_station_cannot_explode_the_extension():
    flat = [st(0, 0), st(1000, 1000), st(2000, 1010, inc=89.9)]
    assert position.md_at_tvd(flat, 1020) - 2000 == pytest.approx(10 / position.MIN_COS_INC)


def test_position_projects_north_then_east_on_the_ellipsoid():
    lon, lat, tvd = position.position_at_md(91.0, 26.0, [st(0, 0), st(1000, 900, north=1000.0, east=0.0)], 1000)
    assert tvd == 900 and lon == pytest.approx(91.0, abs=1e-9)
    assert lat - 26.0 == pytest.approx(1000 / 110_700, rel=0.01)  # ~110.7 km per degree at 26 N

    lon, lat, _ = position.position_at_md(91.0, 26.0, [st(0, 0), st(1000, 900, east=-1000.0)], 1000)
    assert lon < 91.0 and (91.0 - lon) == pytest.approx(1000 / (111_320 * math.cos(math.radians(26))), rel=0.01)

    assert position.position_at_md(91.0, 26.0, [], 640) == (91.0, 26.0, 640)


# ---------------------------------------------------------------- IDW maths


def test_idw_weights_by_inverse_square_distance():
    assert tops.idw([(100, 2000), (100, 2100)]) == pytest.approx(2050)
    assert tops.idw([(100, 2000), (200, 2100)]) == pytest.approx(2020)  # w = 1e-4 and 2.5e-5


def test_idw_treats_distances_under_100_m_as_100():
    assert tops.idw([(5, 2000), (100, 2100)]) == pytest.approx(2050)


def test_uncertainty_combines_spread_and_leave_one_out():
    points = [(100, 2000), (100, 2100)]
    assert tops.weighted_spread(points, 2050) == pytest.approx(50)
    assert tops.loo_rmse(points) == pytest.approx(100)
    assert tops.uncertainty(points, 2050) == pytest.approx(math.sqrt(50**2 + 100**2))


def test_uncertainty_has_a_floor_of_10_m():
    assert tops.uncertainty([(100, 2000), (500, 2000)], 2000) == tops.MIN_UNCERTAINTY_M


def test_predict_for_formation_needs_two_offsets_and_converts_to_md():
    assert tops.predict_for_formation("Tipam", 1, [(500, 2000)], SURVEY, 20.0) is None
    top = tops.predict_for_formation("Tipam", 1, [(100, 1000), (100, 1100)], [st(0, 0), st(3000, 3000)], 25.0)
    assert top.top_tvdss_m == pytest.approx(1050) and top.top_md_m == pytest.approx(1075)  # TVD = TVDSS + KB
    assert top.n_offsets == 2


def top_(name, order, tvdss, md, unc=20.0):
    return tops.PredictedTop(name, order, tvdss, md, unc, 3)


def test_enforce_order_moves_a_shallow_top_below_the_previous_and_widens_it():
    result = [top_("B", 2, 1990, 2010), top_("A", 1, 2000, 2020), top_("C", 3, 2300, 2320)]
    tops.enforce_order(result)
    assert [t.formation for t in result] == ["A", "B", "C"]
    assert result[1].top_tvdss_m == 2005 and result[1].top_md_m == 2025
    assert result[1].uncertainty_m == pytest.approx(20 + 15 + 15)
    assert result[2].top_tvdss_m == 2300 and result[2].uncertainty_m == 20  # already in order: untouched


def test_enforce_order_always_gives_a_strictly_increasing_result():
    result = [top_(str(i), i, 3000 - i, 3000 - i) for i in range(1, 8)]
    tops.enforce_order(result)
    assert all(a.top_tvdss_m < b.top_tvdss_m and a.top_md_m < b.top_md_m for a, b in zip(result, result[1:]))


# ---------------------------------------------------------------- predict_tops with a fake DB


class FakeDb:
    def __init__(self):
        self.active = {"basin": "Assam", "kb_elev_m": 20.0}
        self.survey = {ACTIVE: [st(0, 0), st(3000, 3000)], OFF_A: [st(0, 0), st(3000, 3000)], OFF_B: [st(0, 0), st(3000, 3000)]}
        self.kb = {OFF_A: 20.0, OFF_B: 20.0}
        self.offsets = [
            {"wellbore_id": OFF_A, "surface_distance_m": 1000.0},
            {"wellbore_id": OFF_B, "surface_distance_m": 1000.0},
        ]
        self.formations = [{"name": "Tipam", "strat_order": 1}, {"name": "Barail", "strat_order": 2}]
        self.tops = [
            {"wellbore_id": OFF_A, "formation": "Tipam", "top_md_m": 2000.0, "top_tvdss_m": 2000.0},
            {"wellbore_id": OFF_B, "formation": "Tipam", "top_md_m": 2120.0, "top_tvdss_m": None},  # from MD
            {"wellbore_id": OFF_A, "formation": "Barail", "top_md_m": 2500.0, "top_tvdss_m": 2480.0},  # one offset only
        ]
        self.calls, self.stored = [], []

    async def fetch_one(self, sql, params=None):
        assert "from wellbores wb join wells" in sql
        return self.active

    async def fetch_all(self, sql, params=None):
        self.calls.append(sql)
        if "from survey_stations" in sql:
            return [dict(s, wellbore_id=wb) for wb in params["ids"] for s in self.survey.get(wb, [])]
        if "kb_elev_m" in sql:
            return [{"wellbore_id": wb, "kb_elev_m": kb} for wb, kb in self.kb.items()]
        if "from formations" in sql:
            return self.formations
        if "from formation_tops" in sql:
            assert "source = 'actual'" in sql
            return self.tops
        raise AssertionError(sql)

    async def call_fn(self, name, **params):
        assert name == "offsets_within"
        self.calls.append(("offsets_within", params))
        return self.offsets

    async def execute_many(self, sql, rows):
        self.stored.append((sql, rows))


@pytest.fixture
def fake(monkeypatch):
    f = FakeDb()
    monkeypatch.setattr(db, "fetch_one", f.fetch_one)
    monkeypatch.setattr(db, "fetch_all", f.fetch_all)
    monkeypatch.setattr(db, "call_fn", f.call_fn)
    monkeypatch.setattr(db, "execute_many", f.execute_many)
    return f


@pytest.mark.asyncio
async def test_predict_tops_end_to_end_with_md_derived_offset_top(fake):
    result = await tops.predict_tops(ACTIVE)
    # Tipam: offset A tvdss 2000; offset B md 2120 -> tvd 2120 -> tvdss 2100; equal distances -> 2050; TVD 2070 = MD 2070
    assert [t.formation for t in result] == ["Tipam"]  # Barail has one offset only: skipped
    assert result[0].top_tvdss_m == pytest.approx(2050) and result[0].top_md_m == pytest.approx(2070)
    assert result[0].uncertainty_m == pytest.approx(math.sqrt(50**2 + 100**2))
    assert result[0].as_response() == {
        "formation": "Tipam", "top_md_m": 2070.0, "top_tvdss_m": 2050.0, "uncertainty_m": 111.8, "n_offsets": 2,
    }  # fmt: skip

    sql, rows = fake.stored[0]
    assert "on conflict (wellbore_id, formation, source)" in sql and "'predicted'" in sql and "'analog'" in sql
    assert "'actual'" not in sql  # actual tops are never written
    assert rows[0]["wellbore_id"] == ACTIVE and rows[0]["n_offsets"] == 2


@pytest.mark.asyncio
async def test_predict_tops_uses_default_radius_surface_mode_and_the_12_nearest(fake):
    fake.offsets = [{"wellbore_id": str(uuid4()), "surface_distance_m": float(d)} for d in range(15000, 0, -1000)]
    fake.tops = []
    await tops.predict_tops(ACTIVE)
    name, params = [c for c in fake.calls if isinstance(c, tuple)][0]
    assert params == {"p_wellbore": ACTIVE, "p_radius_m": 10000.0, "p_md": None, "p_mode": "surface"}


@pytest.mark.asyncio
async def test_only_the_12_nearest_offsets_are_used(fake, monkeypatch):
    seen = {}
    original = fake.fetch_all

    async def spy(sql, params=None):
        if "from formation_tops" in sql:
            seen["ids"] = params["ids"]
        return await original(sql, params)

    monkeypatch.setattr(db, "fetch_all", spy)
    fake.offsets = [{"wellbore_id": f"w{d}", "surface_distance_m": float(d)} for d in range(15, 0, -1)]
    await tops.predict_tops(ACTIVE)
    assert len(seen["ids"]) == 12 and "w13" not in seen["ids"] and "w1" in seen["ids"]


@pytest.mark.asyncio
async def test_no_offsets_returns_nothing_and_stores_nothing(fake):
    fake.offsets = []
    assert await tops.predict_tops(ACTIVE) == []
    assert fake.stored == []


@pytest.mark.asyncio
async def test_unknown_wellbore_is_404_and_missing_survey_is_409(fake):
    fake.active = None
    with pytest.raises(NwisError) as exc:
        await tops.predict_tops(ACTIVE)
    assert exc.value.status_code == 404

    fake.active = {"basin": "Assam", "kb_elev_m": 0.0}
    fake.survey[ACTIVE] = []
    with pytest.raises(NwisError) as exc:
        await tops.predict_tops(ACTIVE)
    assert exc.value.status_code == 409 and exc.value.code == "NWIS_BAD_STATE"


@pytest.mark.asyncio
async def test_store_result_false_writes_nothing(fake):
    assert len(await tops.predict_tops(ACTIVE, store_result=False)) == 1
    assert fake.stored == []


# ---------------------------------------------------------------- route


@pytest.fixture
def client(fake, monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return TestClient(app_main.app)


def headers(role="rtoc_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


def test_route_returns_contract_shape_with_no_body(client):
    response = client.post(f"/v1/wells/{ACTIVE}/predict-tops", headers=headers())
    assert response.status_code == 200
    assert response.json() == {
        "tops": [{"formation": "Tipam", "top_md_m": 2070.0, "top_tvdss_m": 2050.0, "uncertainty_m": 111.8, "n_offsets": 2}]
    }


def test_route_passes_radius_through(client, fake):
    client.post(f"/v1/wells/{ACTIVE}/predict-tops", json={"radius_m": 4000}, headers=headers())
    params = [c for c in fake.calls if isinstance(c, tuple)][0][1]
    assert params["p_radius_m"] == 4000


def test_route_rejects_wrong_role_bad_id_and_bad_radius(client):
    assert client.post(f"/v1/wells/{ACTIVE}/predict-tops", headers=headers("rig_engineer")).status_code == 403
    assert client.post("/v1/wells/not-a-uuid/predict-tops", headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{ACTIVE}/predict-tops", json={"radius_m": -5}, headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{ACTIVE}/predict-tops", json={"radius_m": 10**7}, headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{ACTIVE}/predict-tops", content=b"{oops", headers=headers()).status_code == 400
    assert client.post(f"/v1/wells/{ACTIVE}/predict-tops").status_code == 401


# ---------------------------------------------------------------- leave-one-well-out report


def test_eval_summary_counts_tops_within_uncertainty():
    summary = eval_tops.summarise([(2000, 2010, 20), (2100, 2150, 20), (2200, 2200, 10), (2300, 2290, 10)])
    assert summary["n"] == 4 and summary["within"] == 3 and summary["coverage"] == 0.75
    assert summary["mean_abs_error_m"] == pytest.approx(17.5)
    assert eval_tops.summarise([])["coverage"] is None

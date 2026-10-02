"""BE-13: correlation endpoint (DB mocked)."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main
from app.errors import NwisError
from app.geo import correlation

TOKEN = "test-token"
ACTIVE, OFF_A, OFF_B = str(uuid4()), str(uuid4()), str(uuid4())


def top(wb, formation, md, source="actual", unc=None):
    return {"wellbore_id": wb, "formation": formation, "top_md_m": md, "source": source, "uncertainty_m": unc}


def series(md_from, md_to, step=0.5):
    n = int((md_to - md_from) / step) + 1
    return [
        {"md_m": md_from + i * step, "gr_api": 60.0 + i % 7, "rop_m_h": 12.0, "mw_sg": 1.2, "ecd_sg": 1.25,
         "torque_knm": 10.0}
        for i in range(n)
    ]  # fmt: skip


class FakeDb:
    def __init__(self):
        self.names = {ACTIVE: "SYN-DLJ-03", OFF_A: "SYN-DLJ-01", OFF_B: "SYN-DLJ-02"}
        self.tops = [
            top(ACTIVE, "Barail", 2400.0),
            top(OFF_A, "Barail", 2442.0, "predicted", 20.0),
            top(OFF_A, "Barail", 2450.0, "actual"),  # actual beats predicted
            top(OFF_A, "Tipam", 2000.0, "prognosis"),
            top(ACTIVE, "Tipam", 1950.0, "predicted", 28.4),
        ]
        self.events = [
            {"wellbore_id": ACTIVE, "id": uuid4(), "event_type": "loss_partial", "md_from_m": 2395.0, "severity": 3, "description": "losses"},
            {"wellbore_id": ACTIVE, "id": uuid4(), "event_type": "kick", "md_from_m": 2999.0, "severity": 4, "description": "future"},
            {"wellbore_id": OFF_A, "id": uuid4(), "event_type": "kick", "md_from_m": 2999.0, "severity": 4, "description": "offset"},
        ]  # fmt: skip
        self.casing = [
            {"wellbore_id": ACTIVE, "casing_od_in": 9.625, "shoe_md_m": 2280.0},
            {"wellbore_id": ACTIVE, "casing_od_in": 7.0, "shoe_md_m": 3500.0},  # below the bit
        ]
        self.depth = {ACTIVE: series(2300.0, 2400.0), OFF_A: series(2300.0, 2310.0), OFF_B: series(2300.0, 2310.0)}
        self.bit = {ACTIVE: None, OFF_A: None, OFF_B: None}
        self.offsets = [
            {"wellbore_id": OFF_B, "surface_distance_m": 3000.0},
            {"wellbore_id": OFF_A, "surface_distance_m": 1000.0},
            {"wellbore_id": ACTIVE, "surface_distance_m": 0.0},
        ]
        self.sql = []

    async def fetch_all(self, sql, params=None):
        self.sql.append(sql)
        ids = params.get("ids") if params else None
        if "from wellbores wb join wells" in sql:
            return [{"id": i, "name": self.names[i]} for i in ids if i in self.names]
        if "from formation_tops" in sql:
            return [r for r in self.tops if r["wellbore_id"] in ids]
        if "from events" in sql:
            assert "review_status <> 'rejected'" in sql
            return [r for r in self.events if str(r["wellbore_id"]) in ids]
        if "from hole_sections" in sql:
            assert "planned = false" in sql
            return [r for r in self.casing if r["wellbore_id"] in ids]
        if "from depth_series" in sql:
            rows = self.depth[params["id"]]
            if "limit" in params:
                rows = [r for r in rows if r["md_m"] <= params["limit"]]
            return [dict(r) for r in rows]
        raise AssertionError(sql)

    async def call_fn(self, name, **params):
        assert name == "offsets_within" and params["p_mode"] == "surface"
        return self.offsets

    async def visible_depth_limit(self, wellbore_id):
        return self.bit[str(wellbore_id)]


class Resolver:
    def resolve(self, name):
        return {"barail": "Barail", "tipam": "Tipam"}.get(name.strip().lower())


@pytest.fixture
def fake(monkeypatch):
    f = FakeDb()
    monkeypatch.setattr(db, "fetch_all", f.fetch_all)
    monkeypatch.setattr(db, "call_fn", f.call_fn)
    monkeypatch.setattr(db, "visible_depth_limit", f.visible_depth_limit)

    async def resolver():
        return Resolver()

    monkeypatch.setattr(correlation, "get_resolver", resolver)
    return f


# ---------------------------------------------------------------- pure helpers


def test_best_tops_prefers_actual_then_predicted_then_prognosis_and_sorts_by_depth():
    rows = [top("w", "B", 2500, "prognosis"), top("w", "B", 2450, "predicted", 9.0), top("w", "B", 2460, "actual"),
            top("w", "A", 1000, "prognosis")]  # fmt: skip
    assert best_names(correlation.best_tops(rows)) == [("A", 1000, "prognosis"), ("B", 2460, "actual")]


def best_names(tops):
    return [(t["formation"], t["top_md_m"], t["source"]) for t in tops]


def test_shift_is_active_minus_offset_or_none_when_missing():
    assert correlation.shift_for(2400.0, 2442.0) == -42.0
    assert correlation.shift_for(None, 2442.0) is None
    assert correlation.shift_for(2400.0, None) is None


def test_channel_validation():
    assert correlation.parse_channels(None) == ["gr_api", "rop_m_h", "mw_sg", "ecd_sg"]
    assert correlation.parse_channels("rop_m_h, torque_knm,rop_m_h") == ["rop_m_h", "torque_knm"]
    for bad in ("gr_api,evil; drop table x", "md_m", "t", "wellbore_id"):
        with pytest.raises(NwisError) as exc:
            correlation.parse_channels(bad)
        assert exc.value.status_code == 400


def test_offsets_validation_drops_the_active_well_and_caps_at_six():
    assert correlation.parse_offsets(f"{OFF_A},{OFF_A},{ACTIVE}", ACTIVE) == [OFF_A]
    with pytest.raises(NwisError):
        correlation.parse_offsets("nope", ACTIVE)
    with pytest.raises(NwisError):
        correlation.parse_offsets(",".join(str(uuid4()) for _ in range(7)), ACTIVE)


def test_downsample_keeps_torque_spike_at_its_depth_and_stays_within_limit():
    rows = [{"md_m": i * 0.5, "torque_knm": 10.0, "rop_m_h": 1.0} for i in range(10000)]
    rows[4321]["torque_knm"] = 55.0
    tracks = correlation.downsample(rows, ["torque_knm", "rop_m_h"])
    assert len(tracks["md_m"]) <= correlation.MAX_POINTS
    assert max(tracks["torque_knm"]) == 55.0 and tracks["md_m"][tracks["torque_knm"].index(55.0)] == 4321 * 0.5
    assert tracks["md_m"] == sorted(tracks["md_m"])
    assert set(tracks) == {"md_m", "torque_knm", "rop_m_h"}


def test_downsample_leaves_short_series_alone_and_without_torque_takes_first_of_bucket():
    rows = [{"md_m": float(i), "gr_api": float(i)} for i in range(100)]
    assert correlation.downsample(rows, ["gr_api"])["md_m"] == [float(i) for i in range(100)]
    big = [{"md_m": float(i), "gr_api": float(i)} for i in range(4001)]
    thinned = correlation.downsample(big, ["gr_api"])
    assert len(thinned["md_m"]) <= 2000 and thinned["md_m"][:3] == [0.0, 3.0, 6.0]


def test_downsample_handles_missing_torque_values():
    rows = [{"md_m": float(i), "torque_knm": None if i % 2 else 5.0} for i in range(5000)]
    assert len(correlation.downsample(rows, ["torque_knm"])["md_m"]) <= 2000


# ---------------------------------------------------------------- build_correlation


@pytest.mark.asyncio
async def test_shift_and_flatten_missing(fake):
    result = await correlation.build_correlation(ACTIVE, f"{OFF_A},{OFF_B}", "barail", "gr_api,rop_m_h")
    assert result["flatten_formation"] == "Barail"
    active, a, b = result["wells"]
    assert active["is_active"] and active["shift_m"] == 0.0 and "flatten_missing" not in active
    assert a["wellbore_id"] == OFF_A and a["name"] == "SYN-DLJ-01" and a["shift_m"] == 2400.0 - 2450.0  # actual top used
    assert "flatten_missing" not in a
    assert b["shift_m"] == 0.0 and b["flatten_missing"] is True  # no Barail top in that well
    assert active["tops"][0] == {"formation": "Tipam", "top_md_m": 1950.0, "source": "predicted", "uncertainty_m": 28.4}


@pytest.mark.asyncio
async def test_active_well_without_the_flatten_top_flags_everyone(fake):
    fake.tops = [t for t in fake.tops if not (t["wellbore_id"] == ACTIVE and t["formation"] == "Barail")]
    result = await correlation.build_correlation(ACTIVE, OFF_A, "Barail", None)
    assert all(w["shift_m"] == 0.0 and w["flatten_missing"] for w in result["wells"])


@pytest.mark.asyncio
async def test_no_flatten_means_no_shift_and_no_flags(fake):
    result = await correlation.build_correlation(ACTIVE, OFF_A, None, None)
    assert result["flatten_formation"] is None
    assert all(w["shift_m"] == 0.0 and "flatten_missing" not in w for w in result["wells"])


@pytest.mark.asyncio
async def test_default_offsets_are_the_nearest_excluding_the_active_well(fake):
    result = await correlation.build_correlation(ACTIVE, None, None, None)
    assert [w["wellbore_id"] for w in result["wells"]] == [ACTIVE, OFF_A, OFF_B]  # nearest first


@pytest.mark.asyncio
async def test_unknown_flatten_formation_and_unknown_wellbore(fake):
    with pytest.raises(NwisError) as exc:
        await correlation.build_correlation(ACTIVE, OFF_A, "Atlantis", None)
    assert exc.value.status_code == 400
    with pytest.raises(NwisError) as exc:
        await correlation.build_correlation(ACTIVE, str(uuid4()), None, None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_nothing_below_the_bit_is_returned_for_a_drilling_well(fake):
    fake.bit[ACTIVE] = 2350.0
    result = await correlation.build_correlation(ACTIVE, OFF_A, None, "gr_api")
    active, offset = result["wells"]
    assert max(active["tracks"]["md_m"]) <= 2350.0
    assert active["events"] == []  # the 2395 m and 2999 m events are below the 2350 m bit
    assert active["casing"] == [{"casing_od_in": 9.625, "shoe_md_m": 2280.0}]
    assert max(offset["tracks"]["md_m"]) == 2310.0  # a completed offset is returned in full
    assert [e["md_from_m"] for e in offset["events"]] == [2999.0]


@pytest.mark.asyncio
async def test_events_exclude_rejected_in_sql_and_use_contract_fields(fake):
    result = await correlation.build_correlation(ACTIVE, OFF_A, None, None)
    event = result["wells"][0]["events"][0]
    assert set(event) == {"id", "event_type", "md_from_m", "severity", "description"}
    assert any("from events" in s and "<> 'rejected'" in s for s in fake.sql)


@pytest.mark.asyncio
async def test_track_query_selects_only_requested_whitelisted_columns(fake):
    await correlation.build_correlation(ACTIVE, OFF_A, None, "torque_knm,gr_api")
    assert any(s.startswith("select md_m, torque_knm, gr_api from depth_series") for s in fake.sql)


# ---------------------------------------------------------------- route


@pytest.fixture
def client(fake, monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return TestClient(app_main.app)


def headers(role="rig_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


def test_route_matches_the_contract_shape(client):
    response = client.get(
        f"/v1/wells/{ACTIVE}/correlation",
        params={"offsets": f"{OFF_A},{OFF_B}", "flatten": "Barail", "channels": "gr_api,rop_m_h,mw_sg,ecd_sg"},
        headers=headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"flatten_formation", "wells"}
    well = body["wells"][0]
    assert set(well) >= {"wellbore_id", "name", "is_active", "shift_m", "tops", "casing", "events", "tracks"}
    assert set(well["tracks"]) == {"md_m", "gr_api", "rop_m_h", "mw_sg", "ecd_sg"}
    assert set(well["tops"][0]) == {"formation", "top_md_m", "source", "uncertainty_m"}


def test_route_rejects_bad_input_and_unauthenticated(client):
    url = f"/v1/wells/{ACTIVE}/correlation"
    assert client.get(url, params={"channels": "bogus"}, headers=headers()).status_code == 400
    assert client.get("/v1/wells/not-a-uuid/correlation", headers=headers()).status_code == 400
    assert client.get(url, headers=headers("nobody")).status_code == 403
    assert client.get(url).status_code == 401

"""BE-24: POST /v1/admin/retrain (training, storage and model loading mocked)."""

import asyncio
import threading
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.errors import NwisError
from app.risk import l2
from app.routers import admin
from training import features, train_l2

TOKEN = "test-token"


@pytest.fixture(autouse=True)
def idle(monkeypatch):
    """Every test starts with no retrain running and cleans up one it started."""
    monkeypatch.setattr(admin, "_task", None)
    yield
    task = admin._task
    if task is not None and not task.done():
        task.cancel()


class Recorder:
    def __init__(self, wells=2):
        self.events: list[tuple] = []
        self.wells = wells
        self.gate: asyncio.Event | None = None
        self.train_thread = None
        self.fail_train = False

    async def load_wells(self):
        self.events.append(("load_wells",))
        return [object()] * self.wells, {"Tipam": 1}

    def train_risk(self, wells, strat, risk):
        self.train_thread = threading.current_thread()
        self.events.append(("train", risk))
        if self.fail_train:
            raise RuntimeError("boom")
        return train_l2.TrainResult(risk, None, {"n_wells": len(wells)}, "fake")

    async def store_result(self, result):
        self.events.append(("store", result.risk_type))
        if self.gate is not None:
            await self.gate.wait()
        return {"risk_type": result.risk_type, "version": f"v-{result.risk_type}", "activated": False}

    async def load_active(self):
        self.events.append(("reload",))
        return 0


@pytest.fixture
def rec(monkeypatch):
    r = Recorder()
    monkeypatch.setattr(features, "load_wells", r.load_wells)
    monkeypatch.setattr(train_l2, "train_risk", r.train_risk)
    monkeypatch.setattr(train_l2, "store_result", r.store_result)
    monkeypatch.setattr(l2, "load_active", r.load_active)
    return r


# ---------------------------------------------------------------- risk type handling


def test_risk_types_default_to_all_and_are_validated_and_deduplicated():
    assert admin.resolve_risk_types(None) == list(features.RISK_TYPES)
    assert admin.resolve_risk_types([]) == list(features.RISK_TYPES)
    assert admin.resolve_risk_types(["kick", "losses", "kick"]) == ["kick", "losses"]
    with pytest.raises(NwisError) as exc:
        admin.resolve_risk_types(["losses", "magic"])
    assert exc.value.status_code == 400 and exc.value.details["risk_types"] == ["magic"]


# ---------------------------------------------------------------- the background job


@pytest.mark.asyncio
async def test_retrain_trains_each_type_in_a_thread_stores_it_then_reloads_the_models(rec):
    admin.start_retrain(["losses", "kick"])
    await admin._task
    assert [e for e in rec.events] == [
        ("load_wells",), ("train", "losses"), ("store", "losses"), ("train", "kick"), ("store", "kick"), ("reload",),
    ]
    assert rec.train_thread is not threading.main_thread()  # the CPU-bound work did not run on the event loop
    assert not admin.retrain_running()


@pytest.mark.asyncio
async def test_only_one_retrain_at_a_time_and_it_can_run_again_afterwards(rec):
    rec.gate = asyncio.Event()
    admin.start_retrain(["losses"])
    await asyncio.sleep(0.05)
    assert admin.retrain_running()
    with pytest.raises(NwisError) as exc:
        admin.start_retrain(["kick"])
    assert exc.value.status_code == 409 and exc.value.code == "NWIS_BAD_STATE"

    rec.gate.set()
    await admin._task
    assert not admin.retrain_running()
    admin.start_retrain(["kick"])  # free again
    await admin._task
    assert ("train", "kick") in rec.events


@pytest.mark.asyncio
async def test_a_failing_retrain_is_logged_not_raised_and_releases_the_lock(rec):
    rec.fail_train = True
    admin.start_retrain(["losses"])
    await admin._task  # does not raise
    assert not admin.retrain_running() and ("reload",) not in rec.events


@pytest.mark.asyncio
async def test_too_few_wells_ends_quietly_without_training(rec):
    rec.wells = 1
    admin.start_retrain(["losses"])
    await admin._task
    assert rec.events == [("load_wells",)]


# ---------------------------------------------------------------- route


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    started = []
    monkeypatch.setattr(admin, "start_retrain", lambda risks: started.append(risks))
    test_client = TestClient(app_main.app)
    test_client.started = started
    return test_client


def headers(role="admin"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


def test_admin_gets_202_with_an_empty_run_id_list_immediately(client):
    response = client.post("/v1/admin/retrain", json={"risk_types": ["stuck_pipe"]}, headers=headers())
    assert response.status_code == 202 and response.json() == {"model_run_ids": []}
    assert client.started == [["stuck_pipe"]]
    assert client.post("/v1/admin/retrain", json={}, headers=headers()).status_code == 202
    assert client.started[-1] == list(features.RISK_TYPES)


def test_everyone_else_is_forbidden_and_nothing_starts(client):
    for role in ("rig_engineer", "rtoc_engineer", "office_engineer", "reviewer", "nobody"):
        assert client.post("/v1/admin/retrain", json={}, headers=headers(role)).status_code == 403
    assert client.post("/v1/admin/retrain", json={}).status_code == 401
    assert client.started == []


def test_bad_bodies_are_400(client):
    assert client.post("/v1/admin/retrain", json={"risk_types": ["magic"]}, headers=headers()).status_code == 400
    assert client.post("/v1/admin/retrain", json={"risk_types": "losses"}, headers=headers()).status_code == 400
    assert client.post("/v1/admin/retrain", content=b"{bad", headers=headers()).status_code == 400
    assert client.started == []


def test_a_running_retrain_makes_the_route_return_409(monkeypatch):
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)

    def busy(risks):
        raise NwisError("NWIS_BAD_STATE", "A retrain is already running", 409)

    monkeypatch.setattr(admin, "start_retrain", busy)
    response = TestClient(app_main.app).post("/v1/admin/retrain", json={}, headers=headers())
    assert response.status_code == 409 and response.json()["error"]["code"] == "NWIS_BAD_STATE"

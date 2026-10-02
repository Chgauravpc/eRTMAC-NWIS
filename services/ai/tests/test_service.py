"""BE-01 behaviour beyond /v1/health: token acceptance, error shapes, lifespan, deps."""

from __future__ import annotations

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import get_settings
from app.deps import CurrentUser, current_user
from app.errors import NwisError


@pytest.fixture
def token_client(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", "s3cret")
    get_settings.cache_clear()
    monkeypatch.setattr(main_module, "settings", get_settings())

    app = main_module.app

    @app.get("/v1/_t/nwis-error")
    async def _nwis_error():
        raise NwisError("NWIS_BAD_REQUEST", "nope", 400, {"field": "x"})

    @app.get("/v1/_t/boom")
    async def _boom():
        raise RuntimeError("secret internal detail")

    @app.get("/v1/_t/whoami")
    async def _whoami(user: CurrentUser = Depends(current_user)):
        user.require_role("admin", "reviewer")
        return {"id": user.id, "role": user.role, "request_id": user.request_id}

    yield TestClient(app, raise_server_exceptions=False)
    get_settings.cache_clear()


H = {"X-Service-Token": "s3cret"}


def test_valid_token_is_accepted_and_reaches_the_route(token_client):
    assert token_client.get("/v1/_t/whoami", headers={**H, "X-User-Role": "admin"}).status_code == 200


def test_unset_service_token_rejects_everything(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", "")
    get_settings.cache_clear()
    monkeypatch.setattr(main_module, "settings", get_settings())
    resp = TestClient(main_module.app).get("/v1/anything", headers={"X-Service-Token": ""})
    assert resp.status_code == 401
    get_settings.cache_clear()


def test_nwis_error_uses_contract_error_shape(token_client):
    resp = token_client.get("/v1/_t/nwis-error", headers=H)
    assert resp.status_code == 400
    assert resp.json() == {"error": {"code": "NWIS_BAD_REQUEST", "message": "nope", "details": {"field": "x"}}}


def test_unknown_error_is_500_nwis_internal_without_traceback(token_client):
    resp = token_client.get("/v1/_t/boom", headers=H)
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "NWIS_INTERNAL"
    assert "secret internal detail" not in resp.text
    assert "Traceback" not in resp.text


def test_identity_headers_populate_request_state(token_client):
    resp = token_client.get(
        "/v1/_t/whoami", headers={**H, "X-User-Id": "u-1", "X-User-Role": "reviewer", "X-Request-Id": "req-9"}
    )
    assert resp.json() == {"id": "u-1", "role": "reviewer", "request_id": "req-9"}
    assert resp.headers["X-Request-Id"] == "req-9"


def test_require_role_raises_forbidden(token_client):
    resp = token_client.get("/v1/_t/whoami", headers={**H, "X-User-Role": "rig_engineer"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "NWIS_FORBIDDEN"


def test_lifespan_warms_up_in_background_and_closes_pool(monkeypatch):
    calls = {"warm": 0, "closed": 0}

    async def fake_warm():
        calls["warm"] += 1

    async def fake_close():
        calls["closed"] += 1

    monkeypatch.setattr(main_module, "_warm_up_models", fake_warm)
    monkeypatch.setattr(main_module, "close_pool", fake_close)
    with TestClient(main_module.app) as client:
        assert client.get("/v1/health").status_code == 200
    assert calls["closed"] == 1
    assert calls["warm"] <= 1  # scheduled as a background task, health did not wait on it


def test_lifespan_starts_the_database_jobs_only_when_a_database_is_configured(monkeypatch):
    from app.alerts import engine

    started = {"engine": 0, "stopped": 0, "reset": 0, "models": 0}

    async def noop():
        return None

    async def reset():
        started["reset"] += 1

    async def models():
        started["models"] += 1

    async def stop():
        started["stopped"] += 1

    monkeypatch.setattr(main_module, "_warm_up_models", noop)
    monkeypatch.setattr(main_module, "close_pool", noop)
    monkeypatch.setattr(main_module, "_reset_live_streams", reset)
    monkeypatch.setattr(main_module, "_load_l2_models", models)
    monkeypatch.setattr(engine, "start_engine", lambda: started.__setitem__("engine", started["engine"] + 1))
    monkeypatch.setattr(engine, "stop_engine", stop)

    monkeypatch.setattr(main_module.settings, "SUPABASE_DB_URL", "")
    with TestClient(main_module.app):
        pass
    assert (started["engine"], started["reset"], started["models"]) == (0, 0, 0) and started["stopped"] == 1

    monkeypatch.setattr(main_module.settings, "SUPABASE_DB_URL", "postgresql://example/db")
    with TestClient(main_module.app):
        pass
    assert (started["engine"], started["reset"], started["models"]) == (1, 1, 1)

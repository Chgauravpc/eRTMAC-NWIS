from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200_without_service_token():
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "version": "0.1.0", "models": {"l2": []}}


def test_other_path_without_service_token_returns_401():
    response = client.get("/v1/documents")

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "NWIS_UNAUTHORIZED"


def test_other_path_with_wrong_service_token_returns_401():
    response = client.get("/v1/documents", headers={"X-Service-Token": "wrong"})

    assert response.status_code == 401

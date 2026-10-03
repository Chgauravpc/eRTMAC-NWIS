"""Slim profile: embeddings through the Hugging Face Inference API (EMBED_BACKEND=hf_api), HTTP mocked."""

import math

import httpx
import pytest
import respx

from app.config import get_settings
from app.search import embed

URL = embed.HF_API_URL.format(model=get_settings().EMBED_MODEL)


@pytest.fixture(autouse=True)
def api_backend(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EMBED_BACKEND", "hf_api")
    monkeypatch.setattr(settings, "HF_TOKEN", "hf_test")
    monkeypatch.setattr(embed.time, "sleep", lambda s: None)  # no real waiting between retries


def norm(v):
    return math.sqrt(sum(x * x for x in v))


@respx.mock
def test_passages_are_batched_normalised_and_sent_with_the_token():
    route = respx.post(URL).mock(
        side_effect=lambda request: httpx.Response(200, json=[[3.0, 4.0]] * len(__import__("json").loads(request.content)["inputs"]))
    )
    vectors = embed.embed_passages(["a"] * 70)  # 70 texts = 3 batches of at most 32
    assert route.call_count == 3 and len(vectors) == 70
    assert vectors[0] == pytest.approx([0.6, 0.8]) and norm(vectors[5]) == pytest.approx(1.0)
    assert route.calls[0].request.headers["authorization"] == "Bearer hf_test"


@respx.mock
def test_query_gets_the_bge_instruction_and_token_level_output_is_mean_pooled():
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=[[[1.0, 0.0], [0.0, 1.0]]]))
    vector = embed.embed_query("mud losses")
    assert b"Represent this sentence for searching relevant passages: mud losses" in route.calls[0].request.content
    assert vector == pytest.approx([math.sqrt(0.5), math.sqrt(0.5)])  # (1,0) and (0,1) averaged, then normalised


@respx.mock
def test_busy_model_is_retried_then_succeeds_and_a_hard_failure_raises():
    respx.post(URL).mock(side_effect=[httpx.Response(503, text="loading"), httpx.Response(200, json=[[1.0, 0.0]])])
    assert embed.embed_query("x") == [1.0, 0.0]

    respx.post(URL).mock(return_value=httpx.Response(401, text="bad token"))
    with pytest.raises(RuntimeError, match="HTTP 401"):
        embed.embed_query("x")


def test_a_missing_token_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(get_settings(), "HF_TOKEN", "")
    with pytest.raises(RuntimeError, match="HF_TOKEN"):
        embed.embed_query("x")


def test_local_backend_is_unchanged(monkeypatch):
    monkeypatch.setattr(get_settings(), "EMBED_BACKEND", "local")

    class FakeModel:
        def encode(self, text, **kwargs):
            import numpy as np

            return np.array([0.1, 0.2]) if isinstance(text, str) else np.array([[0.1, 0.2]] * len(text))

    monkeypatch.setattr(embed, "_model", lambda: FakeModel())
    assert embed.embed_query("x") == pytest.approx([0.1, 0.2])
    assert len(embed.embed_passages(["a", "b"])) == 2

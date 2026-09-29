"""Tests for app/llm/client.py (contract §6 llm_cache; §13 GROQ_*/OPENROUTER_*).

respx mocks openai's classic-httpx transport for both providers.
requirements.txt pins openai<3 specifically so this works: openai>=3 moved
to httpx2 internally, which respx (built for classic httpx) cannot
intercept — verified directly against the installed package before writing
this module.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from pydantic import BaseModel

from app.errors import NwisError
from app.llm import client as client_module

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class Answer(BaseModel):
    value: int


def _chat_payload(content: str, model: str = "test-model") -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1,
        "model": model,
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def _error_payload(message: str, err_type: str = "rate_limit_error") -> dict:
    return {"error": {"message": message, "type": err_type}}


@pytest.fixture(autouse=True)
def _fast_llm_defaults(monkeypatch):
    """Default: cache is a miss, writes are no-ops, and the no-retry-after
    backoff is near-instant so tests don't pay real wall-clock delays."""
    monkeypatch.setattr(client_module, "get_cached", AsyncMock(return_value=None))
    monkeypatch.setattr(client_module, "set_cached", AsyncMock(return_value=None))
    monkeypatch.setattr(client_module, "DEFAULT_RETRY_DELAY_S", 0.01)


def test_truncate_respects_max_input_chars():
    long_user = "x" * (client_module.MAX_INPUT_CHARS + 500)
    truncated = client_module._truncate(long_user)
    assert len(truncated) <= client_module.MAX_INPUT_CHARS
    assert truncated.endswith("[...truncated...]")


@pytest.mark.asyncio
async def test_complete_json_cache_hit_skips_http(monkeypatch):
    monkeypatch.setattr(
        client_module,
        "get_cached",
        AsyncMock(
            return_value={
                "provider": "groq",
                "model": "llama-3.3-70b-versatile",
                "response": {"value": 42},
            }
        ),
    )

    with respx.mock(assert_all_called=False) as mock:
        model, meta = await client_module.complete_json("sys", "user", Answer)

    assert mock.calls.call_count == 0
    assert model.value == 42
    assert meta.cached is True
    assert meta.provider == "groq"


@pytest.mark.asyncio
async def test_groq_429_fails_over_to_openrouter():
    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(
            return_value=httpx.Response(
                429, json=_error_payload("rate limited"), headers={"retry-after": "0"}
            )
        )
        mock.post(OPENROUTER_URL).mock(return_value=httpx.Response(200, json=_chat_payload('{"value": 7}')))

        model, meta = await client_module.complete_json("sys", "user", Answer)

        # groq: initial attempt + 1 retry = 2 calls; openrouter: 1 call
        assert mock.calls.call_count == 3

    assert model.value == 7
    assert meta.provider == "openrouter"


@pytest.mark.asyncio
async def test_invalid_json_triggers_one_repair_call():
    call_count = {"n": 0}

    def _groq_side_effect(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(200, json=_chat_payload("not json at all"))
        return httpx.Response(200, json=_chat_payload('{"value": 99}'))

    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(side_effect=_groq_side_effect)

        model, meta = await client_module.complete_json("sys", "user", Answer)

    assert model.value == 99
    assert meta.provider == "groq"
    assert call_count["n"] == 2


@pytest.mark.asyncio
async def test_both_providers_failing_raises_nwis_upstream():
    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(500, json=_error_payload("boom", "server_error")))
        mock.post(OPENROUTER_URL).mock(
            return_value=httpx.Response(500, json=_error_payload("boom", "server_error"))
        )

        with pytest.raises(NwisError) as excinfo:
            await client_module.complete_json("sys", "user", Answer)

        # each provider: initial attempt + 1 retry = 2 calls -> 4 total
        assert mock.calls.call_count == 4

    assert excinfo.value.code == "NWIS_UPSTREAM"
    assert excinfo.value.status_code == 502


@pytest.mark.asyncio
async def test_openrouter_retries_without_response_format_on_rejection():
    call_count = {"n": 0}

    def _openrouter_side_effect(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        body = json.loads(request.content)
        if "response_format" in body:
            return httpx.Response(
                400,
                json=_error_payload("response_format is not supported for this model", "invalid_request_error"),
            )
        return httpx.Response(200, json=_chat_payload('{"value": 5}'))

    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(500, json=_error_payload("boom", "server_error")))
        mock.post(OPENROUTER_URL).mock(side_effect=_openrouter_side_effect)

        model, meta = await client_module.complete_json("sys", "user", Answer)

    assert model.value == 5
    assert meta.provider == "openrouter"
    assert call_count["n"] == 2  # first with response_format (rejected), then without


@pytest.mark.asyncio
async def test_complete_text_uses_groq_and_caches(monkeypatch):
    set_cached = AsyncMock(return_value=None)
    monkeypatch.setattr(client_module, "set_cached", set_cached)

    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(200, json=_chat_payload("hello there")))

        text, meta = await client_module.complete_text("sys", "user")

    assert text == "hello there"
    assert meta.provider == "groq"
    assert meta.cached is False
    set_cached.assert_awaited_once()


@pytest.mark.asyncio
async def test_cache_backend_failure_does_not_break_the_call(monkeypatch):
    """A broken llm_cache (DB down) must degrade to a miss, not fail the LLM call."""
    from app.llm import cache as cache_module

    async def _boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.undo()  # drop the autouse mocks so the real cache functions are used
    monkeypatch.setattr(cache_module, "fetch_one", _boom)
    monkeypatch.setattr(cache_module, "execute", _boom)
    monkeypatch.setattr(client_module, "DEFAULT_RETRY_DELAY_S", 0.01)

    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(200, json=_chat_payload('{"value": 5}')))
        model, meta = await client_module.complete_json("sys", "user", Answer)

    assert model.value == 5
    assert meta.cached is False


@pytest.mark.asyncio
async def test_stale_cached_row_is_treated_as_a_miss(monkeypatch):
    monkeypatch.setattr(
        client_module,
        "get_cached",
        AsyncMock(return_value={"provider": "groq", "model": "m", "response": {"unexpected": "shape"}}),
    )
    with respx.mock(assert_all_called=True) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(200, json=_chat_payload('{"value": 9}')))
        model, meta = await client_module.complete_json("sys", "user", Answer)

    assert model.value == 9
    assert meta.cached is False


@pytest.mark.asyncio
async def test_upstream_error_does_not_leak_provider_error_text():
    secret = "sk-secret-provider-detail"
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GROQ_URL).mock(return_value=httpx.Response(500, json=_error_payload(secret, "server_error")))
        mock.post(OPENROUTER_URL).mock(return_value=httpx.Response(500, json=_error_payload(secret, "server_error")))
        with pytest.raises(NwisError) as exc_info:
            await client_module.complete_json("sys", "user", Answer)

    assert exc_info.value.code == "NWIS_UPSTREAM"
    assert exc_info.value.status_code == 502
    assert secret not in json.dumps(exc_info.value.details)
    assert secret not in exc_info.value.message

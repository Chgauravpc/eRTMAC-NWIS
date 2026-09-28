"""LLM client: Groq primary, OpenRouter fallback, cached via llm_cache.

Contract §6 (llm_cache), §13 (GROQ_*, OPENROUTER_*).

Tenacity handles the single intra-provider retry on 429/5xx/timeout; the
Groq -> OpenRouter failover itself is explicit (this module's own
try/except), not a tenacity concern.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, TypeVar

import openai
import tenacity
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import NwisError
from app.llm.cache import cache_key, get_cached, set_cached
from app.logging import get_logger

logger = get_logger(__name__)

ModelT = TypeVar("ModelT", bound=BaseModel)

MAX_INPUT_CHARS = 24000
_TRUNCATION_NOTE = "\n[...truncated...]"
REQUEST_TIMEOUT_S = 20.0
MAX_RETRY_AFTER_S = 5.0
DEFAULT_RETRY_DELAY_S = 1.0

PROVIDERS = ("groq", "openrouter")

RETRYABLE_EXCEPTIONS = (
    openai.RateLimitError,
    openai.InternalServerError,
    openai.APITimeoutError,
    openai.APIConnectionError,
)

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*\n?(.*?)\n?```$", re.DOTALL)


@dataclass
class LlmMeta:
    provider: str
    model: str
    cached: bool
    latency_ms: float
    input_chars: int


@dataclass(frozen=True)
class _ProviderConfig:
    name: str
    base_url: str
    api_key: str
    model: str


class _ProviderFailed(Exception):
    """Raised when a provider (after its own retry, and repair for JSON) can't
    produce a usable response. Caught by complete_json/complete_text to
    trigger failover to the next provider."""


def _provider_configs() -> dict[str, _ProviderConfig]:
    settings = get_settings()
    return {
        "groq": _ProviderConfig(
            name="groq",
            base_url="https://api.groq.com/openai/v1",
            api_key=settings.GROQ_API_KEY,
            model=settings.GROQ_MODEL,
        ),
        "openrouter": _ProviderConfig(
            name="openrouter",
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.OPENROUTER_API_KEY,
            model=settings.OPENROUTER_MODEL,
        ),
    }


@lru_cache
def _client_for(provider: str) -> openai.AsyncOpenAI:
    cfg = _provider_configs()[provider]
    # max_retries=0: we own retries via tenacity, not the SDK's own retry loop.
    return openai.AsyncOpenAI(api_key=cfg.api_key or "unset", base_url=cfg.base_url, max_retries=0)


def _truncate(user: str) -> str:
    if len(user) <= MAX_INPUT_CHARS:
        return user
    return user[: MAX_INPUT_CHARS - len(_TRUNCATION_NOTE)] + _TRUNCATION_NOTE


def _retry_after_wait(retry_state: tenacity.RetryCallState) -> float:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    response = getattr(exc, "response", None)
    if response is not None:
        header = response.headers.get("retry-after")
        if header:
            try:
                return min(float(header), MAX_RETRY_AFTER_S)
            except ValueError:
                pass
    return min(DEFAULT_RETRY_DELAY_S, MAX_RETRY_AFTER_S)


async def _create_with_single_retry(client: openai.AsyncOpenAI, **kwargs: Any):
    retrying = tenacity.AsyncRetrying(
        stop=tenacity.stop_after_attempt(2),
        wait=_retry_after_wait,
        retry=tenacity.retry_if_exception_type(RETRYABLE_EXCEPTIONS),
        reraise=True,
    )
    async for attempt in retrying:
        with attempt:
            return await client.chat.completions.create(**kwargs)
    raise AssertionError("unreachable")  # AsyncRetrying always returns or raises


def _mentions_response_format(exc: openai.BadRequestError) -> bool:
    text = str(exc).lower()
    return "response_format" in text or "json_object" in text


async def _chat_completion(
    provider: str, system: str, user: str, max_tokens: int, *, json_mode: bool
) -> str:
    cfg = _provider_configs()[provider]
    client = _client_for(provider)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    kwargs: dict[str, Any] = {
        "model": cfg.model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": max_tokens,
        "timeout": REQUEST_TIMEOUT_S,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    try:
        response = await _create_with_single_retry(client, **kwargs)
    except openai.BadRequestError as exc:
        if json_mode and _mentions_response_format(exc):
            kwargs.pop("response_format", None)
            response = await _create_with_single_retry(client, **kwargs)
        else:
            raise

    return response.choices[0].message.content or ""


async def _try_chat(provider: str, system: str, user: str, max_tokens: int, *, json_mode: bool) -> str:
    try:
        return await _chat_completion(provider, system, user, max_tokens, json_mode=json_mode)
    except Exception as exc:  # noqa: BLE001 - any failure here means "this provider is down"
        raise _ProviderFailed(f"{provider} request failed: {exc}") from exc


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    match = _CODE_FENCE_RE.match(text)
    return match.group(1).strip() if match else text


def _try_parse(raw: str, schema: type[ModelT]) -> tuple[ModelT | None, str | None]:
    cleaned = _strip_code_fences(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"
    try:
        return schema.model_validate(data), None
    except ValidationError as exc:
        return None, f"schema validation failed: {exc}"


async def _complete_json_with_provider(
    provider: str, system: str, user: str, schema: type[ModelT], max_tokens: int
) -> ModelT:
    raw = await _try_chat(provider, system, user, max_tokens, json_mode=True)
    model, error = _try_parse(raw, schema)
    if model is not None:
        return model

    logger.warning("llm_json_repair_attempt provider=%s schema=%s", provider, schema.__name__)
    repair_user = (
        f"{user}\n\n---\nYour previous reply could not be parsed: {error}\n"
        "Reply again with corrected JSON only, matching the schema exactly. "
        "No prose, no markdown, no code fences."
    )
    raw2 = await _try_chat(provider, system, repair_user, max_tokens, json_mode=True)
    model2, error2 = _try_parse(raw2, schema)
    if model2 is not None:
        return model2

    raise _ProviderFailed(f"{provider} produced invalid JSON after one repair attempt: {error2}")


async def complete_json(
    system: str,
    user: str,
    schema: type[ModelT],
    *,
    max_tokens: int = 2000,
    cache: bool = True,
) -> tuple[ModelT, LlmMeta]:
    user = _truncate(user)
    prompt_hash = cache_key(system, user, schema.__name__)

    if cache:
        cached = await get_cached(prompt_hash)
        if cached is not None:
            logger.info("llm_cache_hit prompt_hash=%s schema=%s", prompt_hash, schema.__name__)
            model = schema.model_validate(cached["response"])
            meta = LlmMeta(
                provider=cached["provider"],
                model=cached["model"],
                cached=True,
                latency_ms=0.0,
                input_chars=len(user),
            )
            return model, meta

    schema_json = schema.model_json_schema()
    full_system = (
        f"{system}\n\nRespond with a single JSON object matching this JSON Schema exactly:\n"
        f"{json.dumps(schema_json)}"
    )

    start = time.monotonic()
    try:
        model = await _complete_json_with_provider("groq", full_system, user, schema, max_tokens)
        provider_used = "groq"
    except _ProviderFailed as groq_exc:
        logger.warning("llm_failover from=groq to=openrouter reason=%s", groq_exc)
        try:
            model = await _complete_json_with_provider("openrouter", full_system, user, schema, max_tokens)
            provider_used = "openrouter"
        except _ProviderFailed as openrouter_exc:
            raise NwisError(
                "NWIS_UPSTREAM",
                "Both LLM providers failed to produce a valid response.",
                502,
                {"groq_error": str(groq_exc), "openrouter_error": str(openrouter_exc)},
            ) from openrouter_exc
    latency_ms = (time.monotonic() - start) * 1000

    model_name = _provider_configs()[provider_used].model
    if cache:
        await set_cached(prompt_hash, provider_used, model_name, model.model_dump(mode="json"))

    meta = LlmMeta(
        provider=provider_used, model=model_name, cached=False, latency_ms=latency_ms, input_chars=len(user)
    )
    return model, meta


async def complete_text(
    system: str, user: str, *, max_tokens: int = 800, cache: bool = True
) -> tuple[str, LlmMeta]:
    user = _truncate(user)
    prompt_hash = cache_key(system, user, "text")

    if cache:
        cached = await get_cached(prompt_hash)
        if cached is not None:
            logger.info("llm_cache_hit prompt_hash=%s schema=text", prompt_hash)
            meta = LlmMeta(
                provider=cached["provider"],
                model=cached["model"],
                cached=True,
                latency_ms=0.0,
                input_chars=len(user),
            )
            return cached["response"], meta

    start = time.monotonic()
    try:
        text = await _try_chat("groq", system, user, max_tokens, json_mode=False)
        provider_used = "groq"
    except _ProviderFailed as groq_exc:
        logger.warning("llm_failover from=groq to=openrouter reason=%s", groq_exc)
        try:
            text = await _try_chat("openrouter", system, user, max_tokens, json_mode=False)
            provider_used = "openrouter"
        except _ProviderFailed as openrouter_exc:
            raise NwisError(
                "NWIS_UPSTREAM",
                "Both LLM providers failed to produce a response.",
                502,
                {"groq_error": str(groq_exc), "openrouter_error": str(openrouter_exc)},
            ) from openrouter_exc
    latency_ms = (time.monotonic() - start) * 1000

    model_name = _provider_configs()[provider_used].model
    if cache:
        await set_cached(prompt_hash, provider_used, model_name, text)

    meta = LlmMeta(
        provider=provider_used, model=model_name, cached=False, latency_ms=latency_ms, input_chars=len(user)
    )
    return text, meta


class _PingSchema(BaseModel):
    pong: bool


async def _ping() -> None:
    """Pings each provider individually (not through complete_json's
    Groq->OpenRouter failover) so both are actually exercised."""
    schema_json = _PingSchema.model_json_schema()
    system = (
        "You are a health check.\n\nRespond with a single JSON object matching this JSON Schema exactly:\n"
        f"{json.dumps(schema_json)}"
    )
    user = 'Set "pong" to true.'
    for provider in PROVIDERS:
        try:
            result = await _complete_json_with_provider(provider, system, user, _PingSchema, max_tokens=200)
            print(f"{provider}: {result.model_dump_json()}")
        except _ProviderFailed as exc:
            print(f"{provider}: FAILED ({exc})")


if __name__ == "__main__":
    if "--ping" in sys.argv:
        asyncio.run(_ping())
    else:
        print("usage: python -m app.llm.client --ping")

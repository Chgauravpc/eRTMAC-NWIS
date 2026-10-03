"""Embedding service (contract §6: chunks.embedding vector(384); §13: EMBED_MODEL).

Two backends, chosen by EMBED_BACKEND:
  local   loads the model lazily in this process (sentence-transformers; module-level singleton, so importing
          this module stays cheap and the weights only load on the first embed_* call);
  hf_api  the Hugging Face Inference API (HF_TOKEN) with the same model: the vectors are the same 384-d bge-small
          vectors, so a database embedded with one backend can be searched with the other. It needs no torch,
          which is what lets the service run in 512 MB.
"""

from __future__ import annotations

import math
import time
from functools import lru_cache
from typing import Any

import httpx

from app.config import get_settings

BATCH_SIZE = 32
HF_API_URL = "https://router.huggingface.co/hf-inference/models/{model}/pipeline/feature-extraction"
HF_TIMEOUT_S = 60.0
HF_RETRIES = 4  # the model may be loading (503) or the free tier rate-limited (429)
# bge's documented instruction prefix for query-side encoding (asymmetric
# search: passages are encoded plain, queries get this prefix).
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


@lru_cache
def _model() -> Any:
    from sentence_transformers import SentenceTransformer  # imported late: it pulls in torch

    settings = get_settings()
    return SentenceTransformer(settings.EMBED_MODEL, device="cpu")


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def _pool(item: Any) -> list[float]:
    """One text's embedding from the API: already a vector, or one vector per token (mean-pooled)."""
    if item and isinstance(item[0], list):
        tokens = item
        return [sum(column) / len(tokens) for column in zip(*tokens)]
    return item


def _hf_embed(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    if not settings.HF_TOKEN:
        raise RuntimeError("EMBED_BACKEND=hf_api needs HF_TOKEN")
    url = HF_API_URL.format(model=settings.EMBED_MODEL)
    headers = {"Authorization": f"Bearer {settings.HF_TOKEN}", "x-wait-for-model": "true"}
    last = "no response"
    for attempt in range(HF_RETRIES):
        try:
            response = httpx.post(url, headers=headers, json={"inputs": texts}, timeout=HF_TIMEOUT_S)
        except httpx.HTTPError as exc:
            last = str(exc)
        else:
            if response.status_code == 200:
                data = response.json()
                if len(data) != len(texts):
                    raise RuntimeError(f"embedding API returned {len(data)} vectors for {len(texts)} texts")
                return [_normalize(_pool(item)) for item in data]
            last = f"HTTP {response.status_code}: {response.text[:200]}"
            if response.status_code not in (429, 500, 502, 503, 504):
                break
        time.sleep(min(2.0 * (attempt + 1), 8.0))
    raise RuntimeError(f"embedding API failed: {last}")


def _use_api() -> bool:
    return get_settings().EMBED_BACKEND.strip().lower() == "hf_api"


def embed_passages(texts: list[str]) -> list[list[float]]:
    if _use_api():
        out: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            out += _hf_embed(texts[start : start + BATCH_SIZE])
        return out
    embeddings = _model().encode(
        texts,
        batch_size=BATCH_SIZE,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    if _use_api():
        return _hf_embed([QUERY_INSTRUCTION + text])[0]
    embedding = _model().encode(
        QUERY_INSTRUCTION + text,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return embedding.tolist()


def to_pgvector(values: list[float]) -> str:
    """pgvector's text input/output format: '[0.1,0.2,...]'."""
    return "[" + ",".join(str(v) for v in values) + "]"

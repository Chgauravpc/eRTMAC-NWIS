"""Embedding service (contract §6: chunks.embedding vector(384); §13: EMBED_MODEL).

Loads the model lazily (module-level singleton) so importing this module
stays cheap; the actual weights only load on first embed_* call.
"""

from __future__ import annotations

from functools import lru_cache

from sentence_transformers import SentenceTransformer

from app.config import get_settings

BATCH_SIZE = 32
# bge's documented instruction prefix for query-side encoding (asymmetric
# search: passages are encoded plain, queries get this prefix).
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


@lru_cache
def _model() -> SentenceTransformer:
    settings = get_settings()
    return SentenceTransformer(settings.EMBED_MODEL, device="cpu")


def embed_passages(texts: list[str]) -> list[list[float]]:
    embeddings = _model().encode(
        texts,
        batch_size=BATCH_SIZE,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
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

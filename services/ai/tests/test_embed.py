"""Tests for app/search/embed.py (contract §6 chunks.embedding vector(384); §13 EMBED_MODEL).

Loads the real BAAI/bge-small-en-v1.5 model (a ~130MB download on first
run) and is marked slow; run with `pytest -m "not slow"` to skip it in a
fast local loop.
"""

from __future__ import annotations

import math

import pytest

from app.search.embed import embed_passages, embed_query, to_pgvector

pytestmark = pytest.mark.slow


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b)


def test_embed_passages_dimension_and_batching():
    vectors = embed_passages(["hello world", "mud losses while drilling", "BOP test completed"])
    assert len(vectors) == 3
    assert all(len(v) == 384 for v in vectors)


def test_embed_query_dimension():
    vector = embed_query("mud losses in Tipam")
    assert len(vector) == 384


def test_embed_query_prefixes_the_bge_instruction(monkeypatch):
    import app.search.embed as embed_module

    captured: dict[str, str] = {}

    class _FakeModel:
        def encode(self, text, **kwargs):
            captured["text"] = text
            return __import__("numpy").zeros(384)

    monkeypatch.setattr(embed_module, "_model", lambda: _FakeModel())
    embed_query("mud losses in Tipam")

    assert captured["text"] == (
        "Represent this sentence for searching relevant passages: mud losses in Tipam"
    )


def test_embed_query_ranking_sanity():
    """contract BE-04 acceptance: a relevant passage should score higher
    than an irrelevant one for the same query."""
    query = embed_query("mud losses in Tipam")
    relevant, irrelevant = embed_passages(
        ["partial losses while drilling Tipam sandstone", "BOP test completed"]
    )

    assert _cosine(query, relevant) > _cosine(query, irrelevant)


def test_to_pgvector_format():
    assert to_pgvector([0.1, 0.2, -0.3]) == "[0.1,0.2,-0.3]"
    assert to_pgvector([]) == "[]"

"""BE-10: /v1/search and /v1/ask (DB, embedding model and LLM mocked)."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db, main as app_main
from app.llm.client import LlmMeta
from app.search import rag

TOKEN = "test-token"
WELLBORE = str(uuid4())
DOC_A, DOC_B = str(uuid4()), str(uuid4())


def chunk(text, score=0.031, doc_id=DOC_A, page=4):
    return {
        "chunk_id": str(uuid4()), "doc_id": doc_id, "doc_title": "WCR SYN-DLJ-03", "page": page,
        "text": text, "well_name": "SYN-DLJ-03", "formation": "Tipam", "score": score,
    }  # fmt: skip


def event(**over):
    row = {
        "event_type": "loss_partial", "md_from_m": 2310.5, "md_to_m": None, "formation": "Tipam",
        "description": "Partial losses while drilling", "cause": None, "action": "Pumped LCM pill",
        "outcome": "Losses cured", "npt_h": 6.0, "volume_m3": None, "doc_id": DOC_B, "page": 12,
        "well_name": "SYN-DLJ-05", "surface_distance_m": 800.0,
    }  # fmt: skip
    row.update(over)
    return row


@pytest.fixture
def env(monkeypatch):
    state = {"chunks": [], "events": [], "calls": [], "llm_calls": [], "llm_reply": "", "embedded": []}

    async def call_fn(name, **params):
        state["calls"].append((name, params))
        return state["chunks"] if name == "hybrid_search" else state["events"]

    async def fetch_all(sql, params=None):
        return [{"id": DOC_B, "title": "DDR SYN-DLJ-05"}]

    async def complete_text(system, user, **kwargs):
        state["llm_calls"].append((system, user))
        return state["llm_reply"], LlmMeta("groq", "test-model", False, 5.0, len(user))

    class Resolver:
        alias_map = {"tipam": "Tipam", "barail": "Barail"}

    async def resolver():
        return Resolver()

    def embed(text):
        state["embedded"].append(text)
        return "[0.1,0.2]"

    monkeypatch.setattr(db, "call_fn", call_fn)
    monkeypatch.setattr(db, "fetch_all", fetch_all)
    monkeypatch.setattr(rag, "complete_text", complete_text)
    monkeypatch.setattr(rag, "get_resolver", resolver)
    monkeypatch.setattr(rag, "_embed_query", embed)
    monkeypatch.setattr(app_main.settings, "SERVICE_TOKEN", TOKEN)
    return state


@pytest.fixture
def client(env):
    return TestClient(app_main.app)


def headers(role="rig_engineer"):
    return {"X-Service-Token": TOKEN, "X-User-Id": str(uuid4()), "X-User-Role": role}


# ---------------------------------------------------------------- pure helpers


def test_snippet_centres_on_best_keyword_hit_else_starts_at_chunk_start():
    text = "x" * 400 + " partial losses of 15 m3/h were seen " + "y" * 400
    snippet = rag.snippet_for(text, "losses in tipam")
    assert len(snippet) == rag.SNIPPET_CHARS and "losses" in snippet
    assert rag.snippet_for(text, "nothing matches here qqq") == text[: rag.SNIPPET_CHARS]
    assert rag.snippet_for("short text", "short") == "short text"


def test_clean_citations_drops_numbers_that_do_not_exist():
    assert rag.clean_citations("LCM worked [1]. Also [7].", {1, 2}) == "LCM worked [1]. Also."
    assert rag.clean_citations("Both agree [1, 9].", {1, 2}) == "Both agree [1]."


def test_quantities_normalise_units():
    assert rag.quantities("losses of 15 m3/h at 2,310.5 metres, MW 1.25 SG") == {
        (15.0, "m3/h"), (2310.5, "m"), (1.25, "sg"),
    }  # fmt: skip
    assert rag.quantities("volume 12 m³ in 3 hours") == {(12.0, "m3"), (3.0, "h")}
    assert rag.quantities("page 4 of 12 wells in Tipam") == set()


def test_check_numbers_removes_only_unsupported_sentences():
    sources = {1: "Losses of 15 m3/h at 2310 m.", 2: "Mud weight raised to 1.3 SG."}
    answer = "Losses were 15 m3/h [1]. They reached 40 m3/h [1].\n- MW went to 1.3 SG [2]."
    cleaned, removed = rag.check_numbers(answer, sources)
    assert removed is True
    assert cleaned == "Losses were 15 m3/h [1].\n- MW went to 1.3 SG [2]."


def test_number_must_be_in_a_cited_source():
    sources = {1: "Losses of 15 m3/h.", 2: "Mud weight 1.3 SG."}
    _, removed = rag.check_numbers("MW was 1.3 SG [1].", sources)  # right number, wrong source
    assert removed is True


def test_event_line_has_depth_formation_and_action():
    line = rag.event_line(event())
    assert "SYN-DLJ-05" in line and "2310.5 m" in line and "Tipam" in line and "Pumped LCM pill" in line


# ---------------------------------------------------------------- /v1/search


def test_search_returns_contract_shape_and_passes_filters(client, env):
    env["chunks"] = [chunk("...partial losses 15 m3/h in the Tipam section...")]
    response = client.post(
        "/v1/search",
        json={"q": "losses in tipam", "filters": {"formation": "Tipam"}, "limit": 5},
        headers=headers(),
    )
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert set(result) == {"chunk_id", "doc_id", "doc_title", "page", "snippet", "well_name", "formation", "score"}
    assert "partial losses" in result["snippet"]
    name, params = env["calls"][0]
    assert name == "hybrid_search" and params["p_formation"] == "Tipam" and params["p_limit"] == 5
    assert params["p_embedding"] == "[0.1,0.2]" and params["p_event_type"] is None


def test_search_rejects_bad_body_and_wrong_auth(client):
    assert client.post("/v1/search", json={"q": ""}, headers=headers()).status_code == 400
    assert client.post("/v1/search", json={"q": "x", "limit": 500}, headers=headers()).status_code == 400
    assert client.post("/v1/search", json={"q": "x"}).status_code == 401
    assert client.post("/v1/search", json={"q": "x"}, headers=headers(role="nobody")).status_code == 403


# ---------------------------------------------------------------- /v1/ask


def test_insufficient_when_few_sources_makes_no_llm_call(client, env):
    env["chunks"] = [chunk("Only one chunk about losses.", score=0.03)]
    response = client.post("/v1/ask", json={"question": "What worked for losses?"}, headers=headers())
    body = response.json()
    assert response.status_code == 200
    assert body["evidence"] == "insufficient"
    assert body["answer_md"].startswith(rag.INSUFFICIENT_HEAD)
    assert body["citations"][0]["n"] == 1 and "[1]" in body["answer_md"]
    assert body["provider"] is None and body["cached"] is False
    assert env["llm_calls"] == []


def test_insufficient_when_best_rrf_is_low_makes_no_llm_call(client, env):
    env["chunks"] = [chunk(f"text {i}", score=rag.MIN_RRF - 0.001) for i in range(4)]
    body = client.post("/v1/ask", json={"question": "anything"}, headers=headers()).json()
    assert body["evidence"] == "insufficient"
    assert len(body["citations"]) == rag.CLOSEST_RECORDS
    assert env["llm_calls"] == []


def test_min_rrf_sits_between_a_vector_only_top_hit_and_a_keyword_plus_vector_hit():
    vector_only_rank_1 = 1 / 61  # hybrid_search: RRF k = 60, and the vector list always returns its 50 nearest chunks
    keyword_and_vector_worst = 1 / 61 + 1 / 110  # rank 1 in one list, rank 50 in the other
    assert vector_only_rank_1 < rag.MIN_RRF < keyword_and_vector_worst


def test_an_off_topic_question_whose_best_chunk_is_a_vector_only_hit_is_refused_without_the_llm(client, env):
    env["chunks"] = [chunk(f"unrelated text {i}", score=1 / (60 + 1 + i)) for i in range(8)]  # vector-only ranks 1..8
    body = client.post("/v1/ask", json={"question": "recipe for lamb curry"}, headers=headers()).json()
    assert body["evidence"] == "insufficient" and env["llm_calls"] == []


def test_a_chunk_found_by_both_keyword_and_vector_search_is_enough_evidence(client, env):
    env["chunks"] = [chunk("LCM pill 30 m3 cured the losses.", score=1 / 61 + 1 / 62), chunk("second")]
    env["llm_reply"] = "An LCM pill cured the losses [1]."
    body = client.post("/v1/ask", json={"question": "what cured the losses?"}, headers=headers()).json()
    assert body["evidence"] == "sufficient" and len(env["llm_calls"]) == 1


def test_no_hits_at_all_is_insufficient(client, env):
    body = client.post("/v1/ask", json={"question": "something not in the data"}, headers=headers()).json()
    assert body["evidence"] == "insufficient" and body["citations"] == [] and env["llm_calls"] == []


def test_sufficient_answer_drops_invalid_citations_and_unsupported_numbers(client, env):
    env["chunks"] = [
        chunk("Partial losses of 15 m3/h in Tipam were cured with an LCM pill.", page=4),
        chunk("A second LCM pill at 2310 m stopped the losses.", page=5),
    ]
    env["llm_reply"] = (
        "Losses of 15 m3/h were cured with an LCM pill [1]. "
        "A second pill at 2310 m also worked [2][9]. "
        "Total NPT was 40 h [2]."
    )
    response = client.post("/v1/ask", json={"question": "What worked for losses in Tipam?"}, headers=headers())
    body = response.json()
    assert response.status_code == 200 and len(env["llm_calls"]) == 1
    assert body["evidence"] == "sufficient"
    assert "[9]" not in body["answer_md"]
    assert "40 h" not in body["answer_md"]
    assert body["answer_md"].endswith(rag.REMOVED_NOTE)
    assert [c["n"] for c in body["citations"]] == [1, 2]
    assert body["citations"][0]["page"] == 4
    assert body["provider"] == "groq" and body["model"] == "test-model" and body["cached"] is False


def test_prompt_uses_ask_system_and_numbers_the_sources(client, env):
    env["chunks"] = [chunk("Losses of 15 m3/h."), chunk("LCM pill pumped.")]
    env["llm_reply"] = "LCM was pumped [2]."
    client.post("/v1/ask", json={"question": "What worked?"}, headers=headers())
    system, user = env["llm_calls"][0]
    assert "ONLY the numbered sources" in system
    assert "[1] (WCR SYN-DLJ-03, page 4)" in user and "[2] (WCR SYN-DLJ-03, page 4)" in user
    assert user.endswith("Question: What worked?")


def test_wellbore_adds_event_sources_filtered_by_formation_in_question(client, env):
    env["chunks"] = [chunk("Losses in the Tipam were cured with LCM.")]
    env["events"] = [event(), event(doc_id=None)]  # the second has no document: not citable
    env["llm_reply"] = "An LCM pill was pumped at 2310.5 m in SYN-DLJ-05 [2]."
    body = client.post(
        "/v1/ask",
        json={"question": "What worked for losses in Tipam?", "wellbore_id": WELLBORE},
        headers=headers(),
    ).json()
    name, params = [c for c in env["calls"] if c[0] == "events_for_offsets"][0]
    assert params["p_wellbore"] == WELLBORE and params["p_radius_m"] == 10000.0
    assert params["p_formations"] == ["Tipam"] and params["p_limit"] == 20
    assert body["evidence"] == "sufficient"
    cited = body["citations"][0]
    assert cited["n"] == 2 and cited["doc_id"] == DOC_B and cited["page"] == 12
    assert cited["doc_title"] == "DDR SYN-DLJ-05" and cited["chunk_id"] is None


def test_wellbore_without_formation_in_question_passes_null(client, env):
    env["chunks"] = [chunk("a"), chunk("b")]
    env["llm_reply"] = "Nothing numeric [1]."
    client.post("/v1/ask", json={"question": "What happened?", "wellbore_id": WELLBORE}, headers=headers())
    _, params = [c for c in env["calls"] if c[0] == "events_for_offsets"][0]
    assert params["p_formations"] is None


def test_answer_with_every_sentence_removed_falls_back_to_insufficient(client, env):
    env["chunks"] = [chunk("Losses of 15 m3/h."), chunk("Other text.")]
    env["llm_reply"] = "Losses were 99 m3/h [1]."
    body = client.post("/v1/ask", json={"question": "How big were the losses?"}, headers=headers()).json()
    assert body["evidence"] == "insufficient" and body["provider"] == "groq"


def test_ask_rejects_bad_body(client):
    assert client.post("/v1/ask", json={"question": ""}, headers=headers()).status_code == 400
    assert client.post("/v1/ask", json={"question": "x", "wellbore_id": "nope"}, headers=headers()).status_code == 400

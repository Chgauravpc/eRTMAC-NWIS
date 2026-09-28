---
title: NWIS AI
emoji: 🛢️
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# NWIS AI service

Python FastAPI backend for eRTMAC-NWIS (SIH26121): document AI (OCR + LLM
extraction), search/RAG, risk engine, stream replay and the alert engine.
Runs as a Hugging Face Docker Space. Owned by the Backend workstream — see
`docs/team/00_SHARED_CONTRACTS.md` (source of truth for names and shapes)
and `docs/team/02_PRD_BACKEND.md`.

All routes live under `/v1` and require the `X-Service-Token` header, except
`GET /v1/health`. Callers also pass `X-User-Id`, `X-User-Role` and
`X-Request-Id` (contract §9.1); the Node API layer on Vercel is the only
intended caller in production.

## Local development

```bash
cd services/ai
python -m venv .venv && . .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
cp ../../.env.example .env   # fill in the Space variables below
uvicorn app.main:app --reload --port 7860
```

```bash
curl http://localhost:7860/v1/health
```

## What's implemented so far

| Module | What it does | Task |
| --- | --- | --- |
| `app/main.py`, `config.py`, `errors.py`, `logging.py`, `routers/health.py` | FastAPI skeleton, `X-Service-Token` auth middleware, `NwisError` → contract §4 error shape, JSON line logging | BE-01 |
| `app/db.py` | Async Postgres pool (`psycopg_pool`), `fetch_all`/`fetch_one`/`execute`/`execute_many`, `call_fn()` for contract §7 RPCs (allowlisted by name *and* parameter name), `visible_depth_limit()` for the §6/§8 depth-hiding rule | BE-02 |
| `app/models/enums.py`, `app/models/rows.py` | Every contract §5 enum + `EVENT_TO_RISK`; Pydantic v2 row models for the tables the backend reads/writes | BE-02 |
| `app/storage.py` | Supabase Storage (service role) — upload/download/move/signed_url for the `documents`, `page-images`, `models` buckets | BE-02 |
| `app/llm/client.py`, `app/llm/cache.py` | `complete_json`/`complete_text`: Groq primary → OpenRouter fallback, one JSON repair attempt, `llm_cache` (contract §6), tenacity-based single retry on 429/5xx/timeout | BE-03 |
| `app/search/embed.py` | `BAAI/bge-small-en-v1.5` embeddings (384-dim) for `chunks.embedding`, `to_pgvector()` | BE-04 |

## Tests

```bash
cd services/ai
pytest                  # everything: DB-integration and embedding-model tests skip/deselect as below
pytest -m "not slow"    # fast loop: skips tests/test_embed.py (loads a real ~130MB model)
```

Some tests need extra setup or take longer:

- **`tests/test_embed.py`** is marked `slow` — first run downloads and loads the real `BAAI/bge-small-en-v1.5` model (contract §13 `EMBED_MODEL`). Deselect with `-m "not slow"` for a fast local loop; CI should still run it at least once.
- **`tests/test_db.py`**'s integration tests (insert/read a well, `offsets_within`, `visible_depth_limit`) need a real Postgres with the contract §6 schema applied. Set `DATABASE_URL_TEST` to a local Docker Postgres+PostGIS connection string to run them — they skip automatically otherwise.
- **`tests/test_llm_client.py`** mocks Groq/OpenRouter with `respx` — no network or real API keys needed. `requirements.txt` pins `openai<3` because `openai>=3.0.0` moved its internal HTTP client to a new `httpx2` package that `respx` (built for classic `httpx`) can't intercept.

## Docker

```bash
cd services/ai
docker build -t nwis-ai .
docker run -p 7860:7860 --env-file .env nwis-ai
```

## Manual deploy (Hugging Face Space)

Deployment is manual — no CI/CD (contract §2.5).

```bash
# once, from the repo root
git remote add space https://huggingface.co/spaces/<user>/nwis-ai

# every deploy
git subtree push --prefix services/ai space main
```

Then set these as **Secrets** (never commit real values) in the Space's
Settings → Variables and secrets (contract §13):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `SERVICE_TOKEN`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `EMBED_MODEL`
- `OCR_ENGINE`
- `LOG_LEVEL`

The Space sleeps when idle on the free CPU tier; warm it up before a demo
(BE-22).

> **Heads up:** contract §13's example `GROQ_MODEL` value
> (`llama-3.3-70b-versatile`) no longer exists on Groq's current lineup
> (confirmed via `GET /v1/models` with a real key while testing BE-03).
> Check `https://api.groq.com/openai/v1/models` for what's currently
> available before setting this secret — `openai/gpt-oss-120b` worked at
> time of writing. Sanity-check any provider/model pair with
> `python -m app.llm.client --ping`.

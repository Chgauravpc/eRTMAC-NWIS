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

## Tests

```bash
cd services/ai
pytest
```

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

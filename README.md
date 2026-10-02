# eRTMAC-NWIS — Nearby Wells Intelligence System

SIH26121 · Oil India Limited · AI-powered offset-well knowledge and decision support for drilling operations.

## Documents
- [`NWIS_PRD.md`](NWIS_PRD.md) — product requirements (problem, data, OCR decision, features, architecture, workflows).
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — **start here when picking the project up**: state, open PRs, how to work, next steps, a prompt for a new session.
- [`docs/GO_LIVE.md`](docs/GO_LIVE.md) — what is verified, and what is left to go live on Supabase, the Hugging Face Space and Vercel.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — **where the project stands**: task status, merged PRs, handover items, known gaps, how to run things.
- [`docs/team/00_SHARED_CONTRACTS.md`](docs/team/00_SHARED_CONTRACTS.md) — **source of truth** for schema, APIs, enums, rules and task dependencies. Read first.
- [`docs/team/01_PRD_DATABASE.md`](docs/team/01_PRD_DATABASE.md) — Database + data tasks.
- [`docs/team/02_PRD_BACKEND.md`](docs/team/02_PRD_BACKEND.md) — Backend tasks (FastAPI on Hugging Face, Node routes on Vercel).
- [`docs/team/03_PRD_FRONTEND.md`](docs/team/03_PRD_FRONTEND.md) — Frontend tasks (React on Vercel).

## Stack
Supabase (Postgres + PostGIS + pgvector) · Python FastAPI on a Hugging Face Space · React + Node on Vercel · Groq / OpenRouter LLMs · Docling + RapidOCR.

# Deploy now, free and without a card: Render (backend) + Vercel (site) + Supabase (database)

The long checklist is `GO_LIVE.md`. **YOU** marks what needs your account. One site, two modes: the **real** system (Supabase + backend)
and **demo mode** (sample data in the browser: "Explore with sample data" on the login page, or any link with `?demo=1`).

## What runs where

| Part | Host | Notes |
| --- | --- | --- |
| Site + `/api` routes (`apps/web`) | **Vercel** (free) | the public URL |
| Backend (`services/ai`, slim image) | **Render** free web service (no card) | 512 MB, sleeps after 15 min idle, wakes in about 1 minute |
| Database, auth, storage | **Supabase** (already set up) | |
| Optional mirror of the demo-mode site | **Hugging Face Static Space** | needs no backend, see the end |

The slim backend (`services/ai/Dockerfile.slim`) differs from the full image: embeddings come from the Hugging Face Inference API (`EMBED_BACKEND=hf_api`,
same bge-small model and vectors), scans go through Tesseract (`OCR_ENGINE=tesseract`; no Docling), and the ML layer is off (`L2_ENABLED=false`), so the
risk score is the offset look-ahead + the live detectors (the alerts in the demo come from those). Measured: about 146 MB of RAM while replaying.

## 0. Before anything public (YOU)

1. Supabase -> Authentication -> Sign In / Providers: **turn OFF "Allow new users to sign up"** (today anyone can register and read all data).
2. Put these in the repo-root `.env`: `GROQ_API_KEY`, `OPENROUTER_API_KEY` (empty today), `HF_TOKEN` (huggingface.co -> Settings -> Access Tokens -> a **Read**
   token; used for embeddings), and `SERVICE_TOKEN` (`python -c "import secrets; print(secrets.token_urlsafe(32))"`).

## 1. Backend on Render (YOU)

1. render.com -> sign in with GitHub -> New -> **Blueprint** -> pick this repo and branch (it reads `render.yaml`) -> Apply.
2. It asks for the secrets once (copy from `.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (the session pooler string), `SERVICE_TOKEN`,
   `HF_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_MODEL`, `OPENROUTER_MODEL`.
3. Wait for the first build (about 5 minutes). Check `https://<name>.onrender.com/v1/health` -> `{"ok":true,...}`.

## 2. Site on Vercel (YOU)

1. vercel.com -> Add New Project -> import the repo, **Root Directory** `apps/web`, framework Vite.
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE=/api`, `VITE_USE_MOCKS=false`, **`VITE_DEMO_DEFAULT=on`** (new visitors start in demo
   mode; they can switch to the real system on the login page), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_SERVICE_URL=https://<name>.onrender.com`, `SERVICE_TOKEN` (same value).
3. Deploy. Then Supabase -> Authentication -> URL Configuration: Site URL = the Vercel URL (add it to Redirect URLs too).

## 3. Check it

```
python scripts/warmup.py --skip-reset          # wakes Render (up to 3 minutes), checks the stack; prints READY
cd apps/web && node scripts/live-smoke.mjs     # the app's queries as each demo role against Supabase
```
Then on the site: "Leave demo mode" on the login page, sign in as `rtoc@nwis.test` (password `DEMO_PASSWORD` in `.env`), open SYN-DLJ-03, press Start.
Keep a tab pinging `https://<site>/api/health` every 5 minutes (e.g. UptimeRobot, free) before a live demo so Render does not sleep.

## What the real mode has and has not

* Has: 30 synthetic wells, trajectories, offsets, correlation, risk, the live replay and alerts. Upload a PDF on the Documents page (as `admin`, `reviewer` or
  `office`; RTOC cannot): text-layer PDFs and Tesseract-read scans go through extraction (needs the LLM keys) into the review queue.
* Has not: documents or lessons yet (Search / Ask have nothing to cite until documents are uploaded; alert recommendations say "No recorded mitigation");
  the ML layer; Docling table extraction; Tesseract is less accurate than the full OCR on poor scans. A free Render instance is slow (0.1 CPU): a big scan takes minutes.
* The replay lives in the backend's memory: when Render sleeps and wakes, press Start again.

## Optional: Hugging Face Static Space as a demo-mode mirror

Create the Space with the **Blank** static template, then:
```
cd apps/web
$env:VITE_USE_MOCKS='true'; npm run build        # bash: VITE_USE_MOCKS=true npm run build
# copy dist/* into the Space repo; README.md must start with:  ---\ntitle: NWIS\nsdk: static\napp_file: index.html\n---
```
A static host has no SPA rewrite, so a refresh on a deep link (e.g. /wells) is a 404: share the root URL. The primary URL is the Vercel one.

## The full image (Dockerfile) is for a host with about 2 GB RAM

Embeddings in-process, Docling + RapidOCR, and the ML layer. Not needed for the demo.

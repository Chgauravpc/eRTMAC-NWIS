# Deploy now: Hugging Face Space + Vercel (the short version)

The long checklist is `GO_LIVE.md`. This is the order that gets a working public site, with what only you can do marked **YOU**.
Both modes live on one site: the **real** system (Supabase + Space) and **demo mode** (sample data in the browser: the
"Explore with sample data" button on the login page, or any link with `?demo=1`). Judges can always fall back to demo mode.

## 0. Before anything public (YOU, 2 minutes)

1. Supabase dashboard, Authentication -> Sign In / Providers: **turn OFF "Allow new users to sign up"**. Today anyone who finds the
   project URL can register and read all data.
2. Get the two LLM keys (Groq, OpenRouter) and put them in the repo-root `.env` as `GROQ_API_KEY` and `OPENROUTER_API_KEY`
   (they are empty there now). Without them Ask, document extraction and alert recommendations do not work.
3. Make one deployment secret and put it in `.env` as `SERVICE_TOKEN`:
   `python -c "import secrets; print(secrets.token_urlsafe(32))"` (the same value goes to the Space and to Vercel).

## 1. Hugging Face Space (the backend, `services/ai`)

1. huggingface.co -> New Space -> name `nwis-ai`, SDK **Docker**, hardware **CPU basic (16 GB)**, **Public or Private** (Private needs the
   token on every call; use Public: the service token protects it).
2. Settings -> Access Tokens -> New token, role **Write**.
3. Space -> Settings -> Variables and secrets, add these as **Secrets** (copy the values from `.env`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (the session pooler string), `SERVICE_TOKEN`, `GROQ_API_KEY`,
   `OPENROUTER_API_KEY`, `GROQ_MODEL`, `OPENROUTER_MODEL`; as **Variables**: `LOG_LEVEL=INFO`, `OCR_ENGINE=rapidocr`
   (use `tesseract` if the Space runs out of memory on a big scan).
4. Push the service (from the repo root; the token is the write token, do not paste it into a chat):
   ```
   git remote add space https://<hf-user>:<write-token>@huggingface.co/spaces/<hf-user>/nwis-ai
   git subtree push --prefix services/ai space main
   ```
   The first build takes 10-20 minutes (the models are baked into the image). Watch the Space's Logs tab.
5. Check: `https://<hf-user>-nwis-ai.hf.space/v1/health` returns `{"ok":true,...,"models":{"l2":[...4 names...]}}`.
   The first request after the build can take about 2 minutes while the L2 offset data loads from Supabase.

## 2. Vercel (the site and `/api`, `apps/web`)

1. vercel.com -> Add New Project -> import `Chgauravpc/eRTMAC-NWIS`, **Root Directory** `apps/web`, framework Vite.
2. Environment variables (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE=/api`, `VITE_USE_MOCKS=false`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_SERVICE_URL=https://<hf-user>-nwis-ai.hf.space`, `SERVICE_TOKEN` (same as the Space).
   (To make the whole site demo-only, e.g. while the Space is down, set `VITE_USE_MOCKS=true` and redeploy.)
3. Deploy. Then Supabase -> Authentication -> URL Configuration: Site URL = the Vercel URL, and add it to Redirect URLs.

## 3. Check it (from this repo)

```
python scripts/warmup.py --skip-reset          # wakes the Space, loads models; prints READY
cd apps/web && node scripts/live-smoke.mjs     # the app's queries as each demo role against Supabase
```
Then sign in on the site as `rtoc@nwis.test` (password: `DEMO_PASSWORD` in `.env`), open SYN-DLJ-03, press Start.

## What the deployed system does and does not have

* Real mode: 30 synthetic wells, trajectories, offsets, correlation, risk, live replay and alerts. **No documents or lessons yet**:
  Search/Ask have nothing to cite until documents are uploaded, and alert recommendations say "No recorded mitigation" until lessons exist.
* Ingesting new data = upload a PDF on the Documents page (as `admin`, `reviewer` or `office` account; RTOC cannot). It runs
  OCR -> LLM extraction -> review queue on the Space and needs the LLM keys. A large scan can take about a minute per page.
* The replay lives in the Space's memory: a restart (or a sleeping free Space waking up) stops it. Press Start again.

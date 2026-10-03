# Going live: Supabase, Hugging Face Space, Vercel

State on 3 Oct 2026. Tick items off as they are done. **Who** says who has to do it: *you* means it needs an account, a token or a
dashboard click that cannot be done from the repo; *repo* means it is a code or file change.

Order that works: Supabase (done mostly) -> Space -> Vercel -> connect them -> rehearse.

## 0. What is verified already (on the real Supabase project, with the synthetic dataset)

| Check | Result |
| --- | --- |
| Migrations `0001`-`0013` applied and recorded, no drift (`db/scripts/check_drift.py`) | 15 of 15 functions match the repo |
| SQL tests (`db/scripts/run_sql_tests.py`) | 10 of 10 pass, data unchanged afterwards |
| Dataset (`db/scripts/verify_synthetic.py`) | 35 of 35 checks (trajectories, tops, offsets within 10 km, the future hidden from signed-in users) |
| What the app reads, as each role (`apps/web/scripts/live-smoke.mjs`, anon key + real sign-in) | 29 of 29 |
| Predicted tops (backend code, real database), leave-one-well-out | 81 % within the stated uncertainty, mean error 42 m (target 80 %) |
| Live detectors against the injected hazards (`python -m db.loaders.check_signatures`) | 44 of 45 events detected at or before their depth, 0.09 false alarms per 1,000 m |

Not verified: the app in a browser, the Space (never built or started), Vercel (never deployed), the LLM-backed paths (extraction,
Ask) on real documents, and anything with real data (Volve / NPD loaders do not exist yet).

## 1. Supabase

| | Item | Who |
| --- | --- | --- |
| [ ] | **Turn off public sign-ups.** Authentication -> Sign In / Providers -> *Allow new users to sign up* OFF. Today sign-ups are open and auto-confirmed, and any signed-in user can read 21 tables in full (the policies are `select ... using (true)` for `authenticated`), so anyone who finds the project URL and anon key (both are in the browser bundle) can register and read everything. Invite people from the Admin -> Users page instead. | you |
| [ ] | **Custom SMTP** (Authentication -> Emails -> SMTP, e.g. Resend / Brevo / SendGrid). The built-in mailer only allows a handful of emails per hour, which breaks invites and password resets. | you |
| [ ] | **URL configuration:** Site URL = the Vercel URL; add it (and any preview domain you use) to Redirect URLs, otherwise the invite and reset links point to localhost. | you |
| [ ] | **Delete the demo accounts** (`*@nwis.test`, made by `db/scripts/create_demo_users.py`, one shared password in `.env` as `DEMO_PASSWORD`) before real users exist, or keep them only on a separate demo project. | you |
| [ ] | Run **Dashboard -> Advisors** (security and performance) and fix what it flags. Expect: the PostGIS table `spatial_ref_sys` is visible through the API (enable RLS on it or move the extensions out of `public`), and functions without a fixed `search_path`. | you / repo |
| [ ] | **Backups.** The free plan has no point-in-time recovery and no downloadable daily backups. Either upgrade (Pro) or schedule `pg_dump` with the session-pooler string to storage you control (weekly is enough for this data). | you |
| [ ] | **Do not let the project pause.** Free projects pause after about 7 days without traffic; the uptime ping in section 4 prevents it (or upgrade). Size now: 70 MB of 500 MB, almost all `depth_series`. | you |
| [ ] | Keep the **service role key** only in the Vercel and Space secrets. It bypasses all security. Rotate it (Project Settings -> API) if it was ever pasted anywhere shared. | you |
| [ ] | Production data: decide what the live project holds. The synthetic wells are labelled and removable (`python -m db.loaders.synth_assam --reset` replaces them; `delete from wells where provenance = 'synthetic'` removes them). Real data needs the Volve / NPD loaders (DB-10, DB-11, not written). | repo |
| [x] | Migrations, RLS, storage buckets, realtime publication, demo dataset | done |

Use `db/scripts/migrate.py` for every schema change (it records history in the same table as the Supabase CLI) and
`db/scripts/check_drift.py` after any manual SQL-editor change.

## 2. Hugging Face Space (the Python service, `services/ai`)

| | Item | Who |
| --- | --- | --- |
| [ ] | Create a **Space** (SDK: Docker, hardware: CPU basic 2 vCPU / 16 GB for the free tier). Create a **write token** (Settings -> Access Tokens). | you |
| [ ] | Deploy by subtree push (no CI exists): `git remote add space https://<user>:<token>@huggingface.co/spaces/<user>/nwis-ai` then `git subtree push --prefix services/ai space main`. `services/ai/README.md` already has the Space front matter (Docker, port 7860). | you |
| [ ] | **Secrets** (Space -> Settings -> Variables and secrets): `SUPABASE_URL` (with `https://`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (the **session pooler** string, port 5432; the transaction pooler does not suit the connection pool), `SERVICE_TOKEN` (new random value, e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`), `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `EMBED_MODEL`, `OCR_ENGINE`, `LOG_LEVEL`. | you |
| [ ] | **Build once and read the log.** The image has never been built. Risks: `torch` CPU plus `docling` is a large install (watch the build time and the image size), and unpinned requirements can resolve differently on build day. Pin them (`pip freeze` from the working `.venv`). | you / repo |
| [ ] | **Memory:** Docling on a long PDF can use many GB. The pipeline limits (60 pages, 60 s per page) help, but if the free 16 GB runs out set `OCR_ENGINE=tesseract` (lighter, lower quality) for the first deployment. | you |
| [ ] | **Cold starts:** a free Space sleeps after 48 h without traffic and starts in 1-3 minutes, and it has no persistent disk, so the embedding and OCR models are downloaded again at every start. Bake them into the image (a `RUN python -c "..."` step in the Dockerfile) or accept a slow first request. | repo |
| [ ] | Keep **one replica, one worker** (as the Dockerfile has it): the stream replay and the alert engine loop live in that process's memory. A restart stops replays by design. | - |
| [ ] | Check: `curl https://<space>.hf.space/v1/health`, then a call with `X-Service-Token`, then `python scripts/warmup.py`. | you |

## 3. Vercel (the web app and the Node `/api` routes, `apps/web`)

| | Item | Who |
| --- | --- | --- |
| [ ] | Import the GitHub repo; **Root Directory** `apps/web`, framework Vite (build `npm run build`, output `dist`). | you |
| [ ] | **Environment variables** (Production, and Preview if you use it): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE=/api`, `VITE_USE_MOCKS=false` (never `true` in production), and for the `/api` functions `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_SERVICE_URL=https://<space>.hf.space`, `SERVICE_TOKEN` (the same value as in the Space), optional `FORWARD_TIMEOUT_MS`. Nothing secret may start with `VITE_`. | you |
| [ ] | `vercel.json` sets `maxDuration` 60 s and the forward timeout is 50 s. A cold Space can take longer than that to wake: the first call after idle may time out with a 504; the warm-up script or an uptime ping avoids it. | - |
| [ ] | **Security headers** are not set. Add `headers` in `vercel.json` (at least `X-Content-Type-Options`, `Referrer-Policy`, a CSP). The CSP has to allow the map tiles (OpenStreetMap, Esri) and Supabase; `PlanningForm.jsx` loads Leaflet marker icons from unpkg.com, which is better bundled. | repo |
| [ ] | Custom domain with HTTPS, then put it in the Supabase Site URL (section 1). | you |
| [ ] | After deploying: `cd apps/web && node scripts/live-smoke.mjs` against the same project, then log in as each demo role in the browser. | you |

## 4. Repository and process

| | Item | Who |
| --- | --- | --- |
| [ ] | **CI.** There is no `.github/`. Add a workflow: `npm run check` + `npx vitest run` + `npm run build` in `apps/web`; `pytest -m "not slow"` in `services/ai`; the SQL tests against a throw-away Supabase (`supabase start`) or a separate test project. Turn on branch protection for `main`. | repo / you |
| [ ] | Clean-up: the tracked `fix_tests.py` (repo root) and `apps/web/test_output.txt` look like leftovers. | repo |
| [ ] | The **pending contract change**: auto-resolve of look-ahead alerts (contract §12, `docs/SKIPPED_FOR_PRODUCTION.md`) needs the other owners' approval; so does a `provenance` column on `v_npt_by_formation`. | owners |
| [ ] | **Real data and measurement:** DB-10 (Volve), DB-11 (NPD), DB-14 (labelled eval set), DB-13 (`reset_demo`), then BE-21 (OCR bake-off, extraction precision / recall, alert hit rate). `docs/eval_results.md` still says nothing was measured. Check the licence terms of any real dataset before it is shown publicly. | repo |
| [ ] | **Test in a browser and on a tablet** (rig view at 1024 x 768): nothing has been opened in a real browser yet. Run Lighthouse (performance, accessibility). | you |
| [ ] | **Monitoring:** an uptime check on `https://<site>/api/health` every 5 minutes (it also keeps the Space and Supabase awake), and optionally Sentry for the web app and the Space. | you |
| [ ] | Rehearse `docs/DEMO_CHECKLIST.md` end to end once everything is deployed, and fix the steps that differ. | you |

## 5. Quick commands

```bash
# database
python db/scripts/migrate.py                      # status; --apply to apply pending files
python db/scripts/check_drift.py                  # live functions vs the repo
python db/scripts/run_sql_tests.py                # the SQL tests, with a data-unchanged proof
python db/scripts/verify_synthetic.py             # the loaded dataset vs the DB-09 criteria
python -m db.loaders.synth_assam --reset          # reload the synthetic wells (about 90 s)
python db/scripts/create_demo_users.py            # the five demo accounts

# app against the real project
cd apps/web && node scripts/live-smoke.mjs
```

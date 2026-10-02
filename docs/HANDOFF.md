# Handoff: pick up the NWIS project here

Written 3 Oct 2026 at the end of a long working session. Read this first, then `docs/PROGRESS.md` (task table),
`docs/GO_LIVE.md` (production checklist) and `docs/team/00_SHARED_CONTRACTS.md` (source of truth for names and shapes).
There is a prompt to paste into a fresh session at the bottom.

## 1. What the project is

**eRTMAC-NWIS** (Oil India, SIH26121): an offset-well intelligence platform for drilling teams. It reads old well reports
(OCR + LLM extraction), keeps wells, tops, events and telemetry in Postgres (Supabase), and warns the rig team about
hazards that offset wells met at the depth the bit is about to reach (look-ahead risk from offsets, an ML layer, and live
detectors on the stream). Three workstreams, one repo: Database (`db/`), Backend (`services/ai` FastAPI for a Hugging Face
Space, and Node routes in `apps/web/api` for Vercel), Frontend (`apps/web`, React + Vite).

## 2. State at the end of the session

### Pull requests (merge in this order)

| PR | Branch | Base | What | State |
| --- | --- | --- | --- | --- |
| #14 | `fe/frontend-prd-alignment` | main | Frontend aligned with the PRD, invented data removed, Search & Ask built, `/sources` route, `npm run check` (lint + hardcoded names + contrast), lazy bundles | **merged** |
| #15 | `db/views-and-well-assignment` | main | `0012_views.sql` (5 views), `0013_review_well_assignment.sql`, `db/scripts/migrate.py`, `check_drift.py`, `run_sql_tests.py` | open, **already applied to the live project** |
| #16 | `data/trajectories-and-synthetic-assam` | #15 | DB-08 trajectory builder, DB-09 synthetic dataset (parts 1-2), `verify_synthetic.py`, `create_demo_users.py`, `apps/web/scripts/live-smoke.mjs`, `docs/GO_LIVE.md`, L2 `results.md` | open, **dataset already loaded** |
| #17 | `chore/single-env-file` | main | One repo-root `.env`; unit tests made hermetic (they must never see real credentials) | open |
| (this) | `docs/handoff` | #16 | This file, refreshed `PROGRESS.md` | open |

#15, #17 can merge now. After #15 merges, retarget #16 to `main` (GitHub offers it), then retarget this PR.

### The live Supabase project

- Project ref `wwambzovvgoefuttwpql` (Seoul, Postgres 17.6, free plan). URL `https://wwambzovvgoefuttwpql.supabase.co`.
- Migrations `0001`-`0013` applied and recorded; `python db/scripts/check_drift.py` says 15 of 15 functions match the repo.
- Data: 30 synthetic wells (26 completed / 3 drilling / 1 planned), 261,060 depth samples, 71 events, predicted tops for the
  drilling wells, 5 `model_runs` (4 active; cementing is not: it does not beat the L1 baseline), 5 L2 models in the `models` bucket.
- Five demo accounts `admin@`, `rtoc@`, `reviewer@`, `office@`, `rig@nwis.test`; shared password in the root `.env` as `DEMO_PASSWORD`.
  The rig engineer is assigned to `SYN-DLJ-03`.
- **Sign-ups are open and auto-confirmed** (security hole, see `docs/GO_LIVE.md` section 1). The user has to switch them off in the dashboard.

### What has been verified on the live project (all scripts are in the repo)

| What | Command | Result |
| --- | --- | --- |
| SQL tests | `python db/scripts/run_sql_tests.py` | 10 of 10, data unchanged |
| Dataset vs the DB-09 criteria | `python db/scripts/verify_synthetic.py` | 35 of 35 (includes: RLS hides the series below the bit) |
| The app's queries as each role | `cd apps/web && node scripts/live-smoke.mjs` | 29 of 29 |
| Offline generator tests | `services/ai/.venv/Scripts/python -m pytest db/tests/test_trajectories.py db/tests/test_synth.py` | 29 pass |
| Backend unit tests | `cd services/ai && .venv/Scripts/python -m pytest -m "not slow"` | 689 pass; `test_a_failing_tick_does_not_end_the_loop` is a 60 ms timing test that fails under load and passes alone |
| Frontend | `cd apps/web && npm run check && npx vitest run && npm run build` | all green on #14 |
| Predicted tops (BE-12) on real data | `training/eval_tops` | 81 % within stated uncertainty, mean error 41.7 m |
| Live detectors vs injected hazards | `python -m db.loaders.check_signatures` | 44 of 45 detected at or before the event depth, 0.09 false alarms per 1,000 m |

### Not verified (nothing below has ever run)

- The app in a **browser** (or a tablet); everything front-end is tested on mocks (MSW) and by the live-smoke script.
- The **demo loop**: stream replay (BE-18) -> risk recompute -> alert engine -> Realtime -> banner and sound. Each part is
  unit-tested; the whole chain has never run against the database. This is the most valuable next check (section 4, item 1).
- The **Docker image** of the Space (never built), the Space itself, Vercel, the Node routes with real Supabase tokens.
- **LLM-backed paths** on real documents (extraction, Ask), OCR quality, and the OCR / extraction evaluation (BE-21: `docs/eval_results.md` says nothing was measured).
- Anything with **real data**: there is no Volve, NPD or real report in the project.

### Honest quality notes

- L1 look-ahead is strong only where a hazard is common and concentrated (Tipam losses). For rarer hazards (kick, stuck pipe)
  it gives weak warning on this data; the live detectors are what catch them (tested).
- L2: PR-AUC beats the L1-only baseline for 4 of 5 risk types (losses 0.20 vs 0.08), but precision and recall at the `high`
  band are very low (recall 0.00-0.03), so it rarely reaches `high`. Synthetic data only. Do not quote it without that caveat.

## 3. Environment and how to work here

- Windows 11; repo `D:\Desktop\Projects\eRTMAC`; GitHub `Chgauravpc/eRTMAC-NWIS`. Python 3.11 venv at `services/ai/.venv`
  (has numpy, psycopg, pytest, lightgbm, reportlab, docling...). Node deps in `apps/web/node_modules`.
- **One env file**: the repo-root `.env` (git-ignored; template `.env.example`). It holds `SUPABASE_URL` (must start with
  `https://`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (session pooler), the `VITE_*` public keys, the Groq / OpenRouter
  keys, `DEMO_PASSWORD`, `TEST_EMAIL`, `TEST_PASSWORD`. `AI_SERVICE_URL` and `SERVICE_TOKEN` are empty until the Space exists.
  On a new machine copy the values from the Supabase dashboard (Project Settings -> API, and Connect -> Session pooler) and the
  LLM providers. Never paste a secret into a chat or a commit. (The one-file loading is in PR #17; on `main` before it merges,
  the backend still reads `services/ai/.env`.)
- Run backend code by hand from the **repo root** with `sys.path` including `services/ai`. **Windows quirk:** psycopg's async
  pool needs the selector event loop: `asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())` before
  `asyncio.run` (the test `conftest.py` does it; the Linux Space does not need it). `uvicorn` on Windows uses the Proactor
  loop, so a local uvicorn needs a small launcher that sets the policy first.
- psycopg treats a literal `%` as a placeholder whenever a params tuple is passed, even an empty one (pass `None`).
- `git switch` aborts when uncommitted changes overlap files that differ between branches: commit or stash first.
- Bash heredocs with quotes and backslashes were fragile in this setup; write files with the editor tool and run small scripts from a file.
- Line endings: Git warns LF -> CRLF; harmless.
- The tools in `db/scripts` and `db/loaders` need only `SUPABASE_DB_URL` and the venv. `python db/scripts/migrate.py` is the
  way to apply schema changes (same history table as the Supabase CLI); run `check_drift.py` after any SQL-editor change.

### Working agreements with the user (keep them)

- **Sequential work, no parallel sub-agents.** Do tasks in dependency order. Log anything skipped for lack of a live service in `docs/SKIPPED_FOR_PRODUCTION.md`.
- **Do not run heavy local jobs without asking** (Docling crashed their PC once). Training LightGBM and the synthetic generator are fine.
- **Commit and open PRs only when asked.** Separate PRs per workstream are fine now; the earlier "one PR for everything" preference was relaxed when the user asked for a frontend PR on its own.
- Anything that changes the contract needs a `contract:` PR title and the other owners' approval; handovers to another owner are written into that task's section of the team PRD and the contract, not just said.
- Confirm before changing the shared Supabase project in a way that is not obviously requested; the user approved migrations, the dataset, demo accounts and model training this session.
- Report outcomes plainly, including failures and what was not verified.

## 4. What to do next (in this order)

1. **Prove the demo loop on the real project.** Start the backend locally with a launcher that sets the selector loop and
   `SERVICE_TOKEN` in the environment; `POST /v1/stream/start` for `SYN-DLJ-03` at speed 60 (headers `X-Service-Token`,
   `X-User-Role: admin`); watch `stream_state`, `risk_scores` and `alerts` change; confirm an alert for the Tipam losses appears
   **before** the hidden event at 3,002 m (`db/data/synth_truth/SYN-DLJ-03.json`). Then the same for the other two wells
   (`stuck_pipe_diff` at about 3,253 m on `SYN-NHK-03`, `kick` at about 3,505 m on `SYN-MRN-03`). Fix what breaks; this chain has
   never run end to end. `training/evaluate_alerts.py` (BE-21) measures the hit rate once it works.
2. **Run the frontend against the project in a browser.** `cd apps/web && npm run dev` with `VITE_USE_MOCKS=false` (the `/api`
   routes need `vercel dev`, or run the Node layer another way); log in as each demo role; walk the PRD screens; fix what the
   mocks hid. Add a few Playwright smoke tests if it helps.
3. **Build the Space image** (`docker build` in `services/ai`) and read the log: torch CPU + docling size, unpinned requirements
   (pin them from the working venv), models baked in to avoid cold-start downloads. Then follow `docs/GO_LIVE.md` sections 2 and 3.
4. **DB-09 part 3**: `db/loaders/synth_docs.py`, 10 WCR and 5 DDR PDFs with reportlab (reportlab is installed) containing the same facts as the
   database, three rendered as scanned-looking images. Spec: `docs/team/01_PRD_DATABASE.md`, DB-09 part 3. They are for upload and OCR demos and for the evaluation.
5. **DB-13 `reset_demo`** (`db/scripts/reset_demo.sh/.ps1` + SQL): clears alerts, risk scores, shift notes, audit log, resets
   the three `stream_state` rows to their start depth. `scripts/warmup.py` calls it and reports red without it (`--skip-reset`).
6. **Fill in `docs/DEMO_CHECKLIST.md`** with the real wells and depths (it deliberately names none today), then rehearse it.
7. **CI** (`.github/workflows`): frontend `npm run check`, vitest, build; backend `pytest -m "not slow"`; SQL tests against a throw-away database.
8. **DB-14 evaluation set, then BE-21 measurements** (OCR bake-off, extraction precision / recall, alert hit rate). The OCR runs are heavy: ask first.
9. **DB-10 Volve loader / DB-11 NPD loader**: the user must register and download the datasets (licence terms apply).
10. **Contract items for the other owners**: auto-resolve of look-ahead alerts (contract §12, already coded), and a `provenance` column on `v_npt_by_formation`.
11. Smaller: `/api/search` results carry no `provenance` (the frontend shows the badge only when present); the Wells page "Top risk" is the most common historical event type, not a live band.

## 5. Open questions for the user

- Has the sign-up setting been switched off, and is custom SMTP planned? (`docs/GO_LIVE.md` section 1)
- Hugging Face and Vercel accounts: who creates them, and which GitHub account owns the deployments?
- Is the Supabase project the real one or a demo one? That decides whether the demo accounts and synthetic wells stay.

## 6. Prompt for the next session

Copy everything in the block into the new session.

```text
You are continuing work on the eRTMAC-NWIS repository (D:\Desktop\Projects\eRTMAC, GitHub Chgauravpc/eRTMAC-NWIS), an
offset-well intelligence platform (Database in db/, Backend in services/ai and apps/web/api, Frontend in apps/web).

First read, in this order: docs/HANDOFF.md (state, how to work, next steps), docs/PROGRESS.md, docs/GO_LIVE.md, and the
contract docs/team/00_SHARED_CONTRACTS.md. Also read your memory notes. Run `git fetch` and `gh pr list` and check which of
PRs #15, #16, #17 and the docs/handoff PR are merged before you branch; base new work on origin/main.

Ground rules: work sequentially, no parallel agents; do not run heavy local jobs (Docling, big OCR) without asking; commit
and open PRs only when I ask; contract changes need a `contract:` PR title; never print or paste secrets (everything is in
the git-ignored repo-root .env; the Supabase project ref is wwambzovvgoefuttwpql); report failures and unverified parts plainly.
On Windows, run backend code that uses psycopg's async pool with the selector event loop policy.

Start with item 1 of section 4 of docs/HANDOFF.md: prove the demo loop on the real Supabase project (stream replay -> risk
scores -> alerts for the hidden hazards of SYN-DLJ-03, SYN-NHK-03, SYN-MRN-03 in db/data/synth_truth/), fixing what breaks.
Then continue down that list. Before each step tell me in two lines what you are about to do.

Useful checks that exist: python db/scripts/run_sql_tests.py, verify_synthetic.py, check_drift.py, migrate.py;
cd apps/web && node scripts/live-smoke.mjs && npm run check && npx vitest run;
cd services/ai && .venv/Scripts/python -m pytest -m "not slow".
```

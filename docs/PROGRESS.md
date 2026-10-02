# NWIS: progress report

**As of 2 Oct 2026**, `main` at PR #11. Task IDs and sprints are the ones in
[`team/00_SHARED_CONTRACTS.md`](team/00_SHARED_CONTRACTS.md) §14, which stays the source of truth.

Legend: ✅ done and merged · ◐ present and checked from the code (see §3a), not run on a live system · 🟡 present, not checked · ⬜ not started · ⛔ blocked

## 1. Where we are in one paragraph

The backend document pipeline is complete from upload to search index: a file is uploaded, classified,
read (text layer, OCR or a structured parser), extracted by the LLM, validated, written to the tables with
review fields, and chunked and embedded for search. The database schema, security, storage and realtime
migrations are in place, and the frontend screens exist. **Nothing has run end to end yet:** every
backend test mocks the database, storage and LLM, nothing is deployed, and the data that the risk engine
needs (synthetic Assam wells, Volve, trajectories) does not exist yet. The Database data tasks (DB-08, DB-09,
DB-10) are the bottleneck for most of the remaining backend work.

## 2. Pull requests

| PR | Merged | Contents |
| --- | --- | --- |
| #10 | 1 Oct | BE-05 upload / classify / pipeline, BE-06 parsers, frontend wiring to real data, contract: unmatched documents get a well through `review_field` |
| #11 | 2 Oct | BE-07 OCR, BE-08 extraction, BE-09 indexing, contract: `review_field` moves a document's records + `POST /api/documents/{id}/reprocess`, well matching from the extracted name |

## 3. Task status

### Backend (`services/ai`, `apps/web/api`)

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| BE-01 | FastAPI skeleton, Dockerfile, auth | 🟡 | On `main` before this report; Space never deployed |
| BE-02 | DB access layer, models | 🟡 | The integration tests need `DATABASE_URL_TEST` and are skipped |
| BE-03 | LLM client (Groq → OpenRouter, cache) | 🟡 | Tested with mocked HTTP only |
| BE-04 | Embeddings | 🟡 | Real model test marked `slow` |
| BE-05 | Upload, jobs, classifier | ✅ | `POST /v1/documents`; a re-upload of a failed document starts a new job; batch CLI |
| BE-06 | WITSML / LAS / table parsers, units | ✅ | Names the DB-10 loader imports; element names for equipment failure, control incident, lith show and strat blocks are unchecked against real Volve XML |
| BE-07 | OCR pipeline | ✅ | PyMuPDF text layer, Docling + RapidOCR, Tesseract fallback below 0.60; 60 pages, 60 s per page |
| BE-08 | LLM extraction, normalisation, validation | ✅ | Never run against a real LLM |
| BE-09 | Chunking and indexing | ✅ | `python -m app.search.index --reindex-all` |
| BE-10 | Search and Ask (RAG) | ◐ | Built, tested with mocks; `MIN_RRF` raised to 0.0165 so off-topic questions are refused |
| BE-11 | Lessons builder | ◐ | `python -m app.search.lessons --rebuild`; mocked DB and LLM |
| BE-12 | Predicted tops (IDW) | ◐ | Mocked; leave-one-well-out coverage not measured (`python -m training.eval_tops`) |
| BE-13 | Correlation endpoint | ◐ | Mocked; reads the base tables, so DB-12 views are not needed |
| BE-14 | Risk L1 (offset look-ahead) | ◐ | `app/risk/config.py` has every §11 constant; mocked DB |
| BE-15 | Risk L3 (live detectors) | ◐ | Six detectors on synthetic windows; thresholds untuned on real data |
| BE-16 | Risk L2 (ML) | ◐ | Features, training, calibration, inference; only run on tiny in-memory wells |
| BE-17 | Fusion and risk endpoint | ◐ | `POST /v1/wells/{id}/risk`; mocked DB |
| BE-18 | Stream replay | ◐ | Fake-clock tests; never run against Supabase |
| BE-19 | Alert engine | ◐ | In-memory store tests; auto-resolve on "bit past the zone" (contract §12 amended) |
| BE-20 | Node API routes on Vercel | ◐ | 181 Node tests (`npm run test:api`); includes `documents/[documentId]/reprocess.js`; not deployed |
| BE-21 | Evaluation (OCR bake-off, extraction P/R, alerts) | ◐ | Scripts and scoring tested; **nothing measured** (`docs/eval_results.md`) |
| BE-22 | Warm-up script and demo checklist | ◐ | `scripts/warmup.py` tested on a fake stack; checklist never rehearsed |
| BE-23 | Planning brief | ◐ | `POST /v1/planning/brief`; mocked DB |
| BE-24 | Retrain endpoint | ◐ | `POST /v1/admin/retrain`; training mocked |

**BE-10 to BE-24 were built after the 2 Oct report, in dependency order, with the database, storage, LLM and embedding model mocked.**
Everything that needs a live Supabase project, the Hugging Face Space, Vercel or real data was skipped on purpose and is listed, with what
to run in production, in [`SKIPPED_FOR_PRODUCTION.md`](SKIPPED_FOR_PRODUCTION.md). The evaluation numbers are in
[`eval_results.md`](eval_results.md) (empty until the scripts are run) and the demo script is [`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md).

Also built, not in the task list: `POST /v1/documents/{document_id}/reprocess`; a well is assigned from the
name extraction reads, and the unmatched-well review row is raised only if that fails.

### Database (`db/`)

| ID | Task | Status |
| --- | --- | --- |
| DB-01 … DB-07 | project, schema, reference data, geo and search functions, RLS and RPCs, storage, realtime | ◐ migrations `0001`–`0011` match the contract exactly (§3a); the SQL has never been run in this report, and there is no live Supabase project from the backend's side |
| DB-08 | Trajectory builder (Minimum Curvature) | ⬜ **critical path** |
| DB-09 | Synthetic Assam dataset | ⬜ **critical path** (blocked by DB-08) |
| DB-10 | Volve loader | ⬜ (BE-06 is ready for it) |
| DB-11 | NPD loader | ⬜ |
| DB-12 | Views (`0012_views.sql`) | ✅ all five contract views, `security_invoker`; `db/tests/test_views.sql` passes; applied to the live project and served by its REST API (empty until DB-09 data exists) |
| DB-13, DB-14 | Reset scripts, evaluation set | ⬜ |
| **DB-05 follow-up** | `review_field`: assign a well and move the records | ✅ `0013_review_well_assignment.sql` (also carries the 0009 hardening); `db/tests/test_review_well_assignment.sql` passes; applied to the live project |

### Frontend (`apps/web`)

FE-01 … FE-17 screens exist on `main` (a landing page was added by teammates). ◐ Checked from the code, and it is
**not green**: failing tests, lint errors, the hardcoded-name check, and invented display numbers. Details in §3a.
FE-11 still needs the well select and the reprocess call (§5).

### 3a. Verified from the code (2 Oct)

**Database, static check** of the contract's SQL against migrations `0001`–`0011` (a throwaway script, not committed):
29 of 29 tables with 301 columns of identical name and base type; 17 of 17 enums with identical values; all 13 §7 functions
with the same parameter names; every contract index; RLS enabled on every table and a policy on each except `llm_cache`
(as specified); the three buckets; realtime on the four tables; `handle_new_user` and `set_updated_at`; reference data
19 formations / 36 synonyms / 34 IADC codes with trouble codes 3, 5, 19, 24, 27. Behaviours present in the SQL: rig engineers
limited to assigned wellbores, `depth_series` hidden below the bit, one open alert per `dedup_key`, replica identity full on alerts.
**Gaps:** the five views (no `0012`), and `review_field` does not handle `well_id` (§5).
**Not checked:** that the SQL executes on Postgres, and the RPC and RLS behaviour (eight SQL test scripts exist in `db/tests/`; none was run).

**Frontend** (`npm run test`, `lint`, `check:hardcoded`, and reading the code):
- **Tests:** 1038 of 1064 pass; 26 fail in 5 files (app 3, alerts 5, wells 7, map 4, workspace 7). Most are stale tests: they look for
  labels, test ids and colour classes the redesign changed. The features behind them are still in the code (the surface / depth
  toggle on the map, the stream pill word + icon + colour, the unacknowledged alerts section). `app.test.jsx` expects the heading
  "Welcome back" but the login page now says "Sign in to NWIS".
- **Lint fails** (FE-01 acceptance says it must pass): 7 errors, 3 in `LoginPage.jsx` and 4 unused imports in `LandingPage.jsx`.
- **`check:hardcoded` fails** (FE-17): 16 hits, all in `LandingPage.jsx` (hardcoded `SYN-` well names and evidence text).
- **Invented numbers in the Wells table:** `WellsPage.jsx` shows `event_count || 18` and `npt_h_total || 6.4`, so a well with no events
  or no NPT displays 18 events or 6.4 h. This breaks the "no hardcoded values" rule. The summary tile "NPT this shift" also sums the
  all-time `npt_h_total`.
- **PRD drift and dead controls:** the Wells table has no TD column (its "Bit Depth" column falls back to TD) and its Status / Risk / Provenance
  dropdowns do nothing; `/alerts` lost grouping by well, the state filter and sort controls (FE-09).
- **Fine:** all 18 PRD routes exist, and all 17 contract enums exist as frozen arrays with identical values.
- **Not checked:** behaviour in a browser, the real-data (non-mock) path against a live Supabase, accessibility, performance.

Full detail (each failing test with its error and cause, every lint error and hardcoded line, the per-table schema comparison, and
corrections to earlier figures): [`AUDIT_2026-10-02.md`](AUDIT_2026-10-02.md).

## 4. Contract amendments merged

1. **#10:** a document with no matched well gets a `well_header` / `well_id` review field (reason `unmatched_well`);
   `review_field` approve/edit sets `documents.well_id` and `documents.wellbore_id` (the well's primary wellbore).
2. **#11:** the same action also moves every row with the document's `doc_id` (events, formation_tops,
   hole_sections, cement_jobs, mud_records, time_log) to the new wellbore (source: `NWIS_PRD.md` W2, "all its
   records move with it"). New endpoint `POST /api/documents/{document_id}/reprocess` (§9.2).
3. **Pending (made on 2026-10-04 in BE-19, not yet merged):** §12 auto-resolve no longer requires "fused score < band threshold" (scores behind the bit are not recomputed, so look-ahead alerts would never close). It now needs only `bit_md > zone_md_to + 25`, the acknowledgement rule for warning/critical, and a stream that is not `lost`. Per contract rule 2 this needs a `contract:` PR that the other two owners approve.
4. **Also changed in BE-10 (a backend constant, not a contract name):** `MIN_RRF` 0.015 -> 0.0165 in `02_PRD_BACKEND.md` BE-10.

## 5. Handover: what other owners must do

| Owner | Task | What |
| --- | --- | --- |
| Database (Person A) | DB-05 | Add the `well_id` branch to `review_field` (set `documents.well_id` / `wellbore_id`, move the records, delete a `formation_tops` row that would duplicate `(wellbore_id, formation, source)`) and a test. Today approving an unmatched-well row fails. |
| Backend / Node (BE-20) | BE-20 | Add `documents/[documentId]/reprocess.js`: roles reviewer, office_engineer, admin; uuid check (400); forward to the Space `POST /v1/documents/{id}/reprocess`; pass 202 / 404 / 409 through. Spec and tests are in `02_PRD_BACKEND.md` BE-20. The Space side is done. |
| Frontend (Person C) | FE-11 | Well select for the `well_id` field (Approve disabled until chosen); `unmatched_well` reason text; call reprocess after approval and show the job's progress. |

## 6. Decisions worth knowing

- **Rows need a wellbore.** `events` and the other tables require `wellbore_id`. A document with no matched well keeps
  its extraction as review fields only (no rows) until a reviewer assigns the well and the document is reprocessed.
- **Survey stations are not stored from reports.** `tvd_m`, `north_m` and `east_m` are NOT NULL and come from the DB-08 builder.
- **Confidence:** `min(LLM, page OCR)` minus 0.3 per failed rule, capped at 0.5 when a rule failed; auto-approve at 0.85.
  An unknown formation is capped at 0.80 so it is always reviewed.
- **RapidOCR runs with `use_cls=False`.** Its angle classifier turned upright English lines into garbage (2 of 5 lines at about 0.6
  confidence); without it all five were exact at 0.98 or higher. A page scanned upside-down would not be corrected.
- **Well matching:** exact name first; otherwise a fuzzy match of at least 90 that is unique. Names one character apart score 90, so a tie goes to a reviewer.
- **Search text vs markdown:** `document_pages.text` is the line-preserving OCR text; Docling's markdown (which merges
  lines) and tables are returned by `ocr_or_parse` but not stored. Tables are only kept whole in chunks when the text itself looks like a table.

## 7. Known gaps and risks

1. **No end-to-end run.** No real Supabase, no real LLM call, no real upload. Prompt quality, JSON truncation on dense pages
   (`max_tokens` 4000), and the `::vector` insert are untested. BE-21 will measure extraction quality.
2. **Not deployed.** No Supabase project linked from the backend (`services/ai/.env` holds only the LLM keys), no Space, no Vercel project.
3. **Docker image never built.** Docling brings a large torch dependency; the Dockerfile installs CPU `torch` first, but `torchvision`
   and Docling's other packages could still pull mismatched builds. The first page after a restart will be slow (model downloads).
4. **Docling is heavy.** Running it locally crashed a developer PC once. Its table extraction has not been verified (the one
   successful test page had no real table). The real Docling test only runs with `NWIS_RUN_DOCLING=1`.
5. **Tesseract is not installed on the dev machine,** so its two real tests skip; the fallback logic is covered by mocks.
6. **Frontend is not green** on `main`: 26 failing tests, 7 lint errors, a failing hardcoded-name check, and invented numbers in the Wells table (§3a).

## 8. Recommended next steps

1. **DB-08 → DB-09 (Person A):** they unblock BE-11, 12, 13, 14, 16 and the whole look-ahead and alert chain.
2. **BE-20 (Node routes)** and **BE-15 (live detectors)** can start now.
3. ~~Fix the DB-05 follow-up~~ done in `0013` (3 Oct). The review flow now works in SQL; the frontend side is PR #14.
4. First deployment: Supabase (push `0001`–`0011`), then a health-only Space, then run one real upload through the pipeline.
5. **Frontend clean-up (Person C):** remove the `|| 18` and `|| 6.4` fallbacks; fix the 7 lint errors; update or restore the 26 stale tests;
   move the landing page's sample wells out of `src/features` (or exempt it explicitly); on the Wells page add a TD column, make the filters work or remove them, and restore the `/alerts` grouping and filters.
6. **Database (Person A):** add `0012_views.sql`; the frontend and BE-13 depend on the views.

## 9. How to run things

```bash
# backend tests (fast; mocks the DB, storage and LLM)
cd services/ai && .venv/Scripts/python -m pytest -m "not slow"     # 305 passed, 5 skipped, 10 deselected on 2 Oct
.venv/Scripts/python -m pytest tests/test_ocr.py                    # includes the slow RapidOCR tests (about 20 s)
set NWIS_RUN_DOCLING=1                                              # opt in to the real, heavy Docling test

# ingest and index (need SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
python -m app.ingest.batch --doc-type witsml --limit 50             # documents already in the DB with no job
python -m app.ingest.batch --dir path/to/folder                     # local files
python -m app.search.index --reindex-all                            # rebuild all chunks and embeddings
python -m app.llm.client --ping                                     # check both LLM providers
```

Environment variables are listed in `team/00_SHARED_CONTRACTS.md` §13 and `.env.example`.

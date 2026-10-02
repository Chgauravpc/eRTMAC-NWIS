# Skipped for production testing

Backend tasks BE-10 onwards were built and tested **locally with the database, storage, LLM and embedding
model mocked**. Anything that needs a live Supabase project or the Hugging Face Space was skipped and is listed
here, with what to run once those exist. Each section is added as its task is finished.

Prerequisites for every item below: a Supabase project with migrations `0001`-`0011` applied, `services/ai/.env`
with `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the LLM keys, and (for the HTTP checks)
the Space running with `SERVICE_TOKEN` set.

## BE-10 Search and Ask

| Skipped | Why | Run in production |
| --- | --- | --- |
| `tests/rag_questions.yaml` (10 acceptance questions) | Needs synthetic data indexed in Supabase (DB-09) and the Database owner | Write the questions from the indexed data; for each, call `POST /v1/ask` and check every citation's page contains the cited fact |
| "Not in the data" returns `insufficient` | **Decided 2026-10-04: `MIN_RRF` raised from 0.015 to 0.0165.** The vector half of `hybrid_search` always returns 50 rows, so any chunk scores at least 1/61 = 0.01639 from the vector list alone and 0.015 never refused anything. Tested only with scores built by hand, not on a real index | Ask an off-topic question (nothing in the data, for example a cooking question): it must come back `insufficient` with no LLM call. Then ask a real question with keywords from the data: it must be answered. If real questions are refused, the keyword half is not matching (check `chunks.tsv`); lower `MIN_RRF` only after looking at real scores |
| p95 latency < 5 s | Needs the Space and real Groq | Run 20 uncached `/v1/ask` calls and read the `ask_done latency_ms` log lines |
| Real `hybrid_search` / `events_for_offsets` calls | Mocked; signatures were checked by reading migrations `0006` and `0007` only | One `/v1/search` and one `/v1/ask` with a `wellbore_id` against the real database |

## BE-11 Lessons builder

| Skipped | Why | Run in production |
| --- | --- | --- |
| Lessons for the main synthetic hazards with real event ids | Needs DB-09 events in Supabase and a real LLM | `python -m app.search.lessons --rebuild`, then check `lessons` has Tipam losses, Barail stuck pipe, and that every `event_ids` entry exists in `events` |
| Insert/update SQL (`::uuid[]`, `::event_type` casts) | Never executed against Postgres | The same rebuild; a type error would show as a `failed` count |
| Batch hook (`app.ingest.batch` rebuilds lessons at the end) | Mocked | Run a small batch and confirm the `lessons:` summary line |
| `lessons` has no unique key on (formation, event_type) | The contract table has none, so the "upsert" is look-up then update/insert; two concurrent rebuilds could duplicate a row | Do not run two rebuilds at once; or ask the Database owner for a unique index |

## BE-12 Predicted tops (IDW) and position helpers

| Skipped | Why | Run in production |
| --- | --- | --- |
| Leave-one-well-out coverage (target: at least 80 % of predicted tops within their uncertainty) | Needs completed synthetic wells with actual tops and surveys (DB-08, DB-09) | `python -m training.eval_tops` (writes nothing; prints coverage and flags any order violation); put the number in the PR |
| Real SQL for the upsert (`on conflict (wellbore_id, formation, source)`), the `::text[]` id casts and the survey/KB queries | Mocked, never executed on Postgres | `POST /v1/wells/{wellbore_id}/predict-tops` on a synthetic wellbore, then `select * from formation_tops where source = 'predicted'`; run it twice to confirm the second run updates rather than duplicates, and that `actual` rows are unchanged |
| `position.py` agrees with PostGIS `well_position_at_md` | The mirror uses a pure-Python Vincenty formula; it was only checked against known distances, not against PostGIS | Compare `position_at_md` with `select * from well_position_at_md(<wellbore>, <md>)` at a few depths (expect agreement within a few millimetres) |
| Route over HTTP with the service token | Needs the Space | `curl -X POST $SPACE/v1/wells/<id>/predict-tops -H "X-Service-Token: ..." -H "X-User-Role: admin"` |

Decisions to know: order is enforced in both TVDSS and MD independently; a basin of `null` on the well means all formations are considered; the BE-12 route returns 409 `NWIS_BAD_STATE` when the wellbore has no survey stations (tops cannot be converted to MD).

## BE-13 Correlation endpoint

| Skipped | Why | Run in production |
| --- | --- | --- |
| Real queries (`depth_series`, `formation_tops`, `events`, `hole_sections`, the `::text[]` casts) and the "never below the bit" rule against real RLS and `stream_state` | Mocked; `visible_depth_limit` is faked | `GET /v1/wells/<drilling wellbore>/correlation?offsets=...&flatten=Barail` while the replay is at a known bit depth; the largest `tracks.md_m` of the active well must be at or below `stream_state.bit_md_m` |
| Response validated against the §9.3 example by the frontend | FE-06 not run against it | Open the Correlation tab (FE-06) on real data |
| DB-12 views | The endpoint reads the base tables, so it does not need them (the PRD lists DB-12 as a blocker) | Nothing to run |
| Speed of 2,000-point tracks on real Volve-length series | Only tested on in-memory lists | Time one call on a Volve wellbore (about 8,000+ rows per well) |

Decisions to know: with no `flatten` parameter the response has `flatten_formation: null`, all shifts are 0 and no `flatten_missing` flag; `flatten_missing: true` is added to any well (the active one too) that lacks the flatten top; the visible-depth limit is also applied to the events and casing shoes of a drilling well, and to offsets that are themselves being drilled; the default channels are `gr_api, rop_m_h, mw_sg, ecd_sg` (the §9.3 example).

## BE-14 Risk layer L1 (offset look-ahead)

| Skipped | Why | Run in production |
| --- | --- | --- |
| "Runs in under 1 s for 12 intervals x 5 risk types on synthetic data" | The maths alone runs in milliseconds (tested on in-memory data), but the real cost is the SQL calls (`formation_at_md`, `offsets_within` per interval, `events_for_offsets` per formation, one tops query per interval) | Time `await l1.l1_scores(<wellbore>, <bit md>)` against Supabase on a synthetic well; if it is slow, the per-interval `offsets_within` calls are the first thing to batch |
| Real function calls (`formation_at_md`, `offsets_within(..., 'depth')`, `events_for_offsets`) | Mocked; names and columns were checked against migrations `0006` only | Same call, check no SQL error and that `n_offsets` and `l1` look sensible for a formation with known offset events |
| Sanity of the scores on DB-09 data | No synthetic data yet | Compare `l1` just above a known offset event depth (should be high) with a quiet interval (about 0.25 to 0.4) |

Decisions to know: all five `risk_type` values are scored; an offset "drilled the formation" if it has an `actual` top for it (offsets without events still count, which is what makes l1 low rather than unknown); an offset counts once, at the best of its matching events (reviewed 1.0, pending 0.5); `mean_event_conf` is the mean confidence of the events that counted as hits and is `None` when there were none; with an unknown relative depth the hit rule compares MD at the same depth below the formation top, within 25 m.

## BE-15 Risk layer L3 (live detectors)

| Skipped | Why | Run in production |
| --- | --- | --- |
| "At least 60 % of hidden losses and kicks trigger the matching detector at or before the event depth" | Needs the DB-09 hidden future events and the BE-18 replay | Replay a synthetic well with `training/evaluate_alerts.py` (BE-21) and read the hit rate per detector |
| False-alarm rate on real data | Only tested on Gaussian noise, where the torque rule (z above 3.5 over 60 samples) fired in 5 of 20 random 500-sample normal runs, i.e. about one false fire per few thousand samples | Count false alerts per 1,000 m in the BE-21 alert evaluation and tune `TORQUE_Z_THRESHOLD`, or require two consecutive samples, if too noisy |
| Thresholds suit real Volve / Assam data | Initial contract proposals, never tried on real channels | Tune in `app/risk/config.py` after BE-21 and record the change in the contract |

Decisions to know: a detector returns `l3 = None` when its channels are missing or its history is too short (20 samples for z-scores, 5 per window for the dxc trend), and `0.0` when the pumps are off; a "connection" is a pumps-off period (or ROP at zero when there is no flow channel) and its overpull is peak hookload against the mean of the 30 m before it; "gas rising" needs a 10 % and 0.05 percentage-point rise so noise is not a rise; `l3_by_risk(results)` gives BE-17 the per-risk-type maximum.

## BE-17 Fusion, bands, confidence and the risk endpoint

| Skipped | Why | Run in production |
| --- | --- | --- |
| "Changing telemetry in the replay changes the stored scores" (integration with BE-18) | Needs a live `stream_state`, `depth_series`, the replay task and Supabase. A unit test covers the same behaviour with a fake detector bank | Start a replay (BE-18), call `POST /v1/wells/<id>/risk` before and after a loss signature appears; the at-bit `losses` row must go up and show a `detector` reason |
| Real upsert into `risk_scores` (`::risk_type`, `::risk_band`, `::confidence_level` casts, `Jsonb` reasons, `on conflict`) | Mocked, never run on Postgres | `POST /v1/wells/<id>/risk`, then `select md_from_m, risk_type, fused, band, confidence from risk_scores where wellbore_id = ...`; call it twice to confirm rows are updated, not duplicated |
| Real L2 input | `app.risk.l2` does not exist until BE-16, so L2 is skipped (weights renormalise over L1 and L3). The hook it must satisfy is `async predict_intervals(wellbore_id, l1_results) -> {(md_from_m, risk_type): (probability, [{"feature","value"}], model_version)}` plus an optional `calibrate(x)` | After BE-16, check `l2` and `model_version` are filled in the rows |
| Endpoint over HTTP with the service token | Needs the Space | `curl -X POST $SPACE/v1/wells/<id>/risk -H "X-Service-Token: ..." -H "X-User-Role: rtoc_engineer"` |

Decisions to know: live detector evidence (L3 and the detector floor) applies only to the interval the bit is currently in; intervals ahead of the bit are scored from L1 (and L2). A custom window needs `md_to_m` above `md_from_m` and at most 1,000 m, else 400. With no bit depth (not streaming and no actual tops) the endpoint returns 409 `NWIS_BAD_STATE`; an unknown wellbore returns 404. Confidence cannot reach `high` when there are no matching offset events (the mean confidence is unknown).

## BE-18 Stream replay

| Skipped | Why | Run in production |
| --- | --- | --- |
| Real-time pacing and "at most 4 updates per second" on the real database | Tested with a fake clock (no real sleeping) and a mocked database | `POST /v1/stream/start` with `speed` 60 on a drilled wellbore with `depth_series` data; watch `stream_state` (or Realtime) and confirm `bit_md_m` moves about 60 x ROP and `updated_at` changes at most 4 times a second |
| `drop` for 45 s makes `last_sample_at` stop advancing, then resume | Unit-tested with the fake clock only | `POST /v1/stream/drop {"seconds": 45}` during a replay; `select last_sample_at from stream_state` must freeze for 45 s |
| Restart consistency | `reset_live_streams` is tested for its SQL only | Restart the Space during a replay; afterwards no `stream_state` row may say `live`, `stale` or `lost` |
| Real SQL (`stream_state` upsert, the `depth_series` read, `greatest(coalesce(...))`, `Jsonb` latest) | Mocked | Start a replay and `select * from stream_state` |
| Alert engine hook | `app.alerts.engine` is BE-19; the replay calls `engine.evaluate(wellbore_id, scores, detector_results)` and skips it quietly if the module is missing | Re-run after BE-19 |
| RLS hiding rows below `bit_md_m` from users while the replay runs | Needs real RLS | Log in as a rig engineer and confirm `depth_series` rows below `bit_md_m` are not returned |
| The Space free tier sleeping or restarting mid-demo kills replay tasks | Hosting behaviour | Do the BE-22 warm-up before a demo and start the replay after it |

Decisions to know: replay tasks live in the Space's memory, so a restart ends them (startup sets every non-stopped stream to `stopped`); speed is 1 to 600 and a drop is 1 to 600 s (400 otherwise); `speed`, `drop` and (when nothing is running) `stop` behave as follows: `speed` and `drop` return 409 `NWIS_BAD_STATE` if no replay is running, `stop` is idempotent; time per sample is the difference of the samples' own `t` when present, else the depth step over ROP (floor 1 m/h, cap 3,600 s).

## BE-19 Alert engine

| Skipped | Why | Run in production |
| --- | --- | --- |
| "An alert appears before at least one hidden future event depth" end to end with the replay (show in the PR) | Needs a synthetic drilling well with a truth file (DB-09), the replay, Supabase and a real LLM | Replay a synthetic well (`POST /v1/stream/start`), open the Alerts page (or `select * from alerts`) and compare the first alert's `zone_md_from_m` with the depth of a hidden event in `db/data/synth_truth/*.json`; `training/evaluate_alerts.py` (BE-21) does this for every well |
| All SQL in the engine (`insert ... returning id`, the enum casts, `alerts_one_open_per_key` collision, `update alerts set ...`, the `audit_log` rows, the `risk_scores` zone query) | Replaced by an in-memory store in the tests; never run on Postgres | Run one replay and check `alerts` and `audit_log` (actions `alert.system.generated`, `sent`, `renotified`, `escalated`, `auto_resolved` with `user_id` null) |
| Supabase Realtime pushing the insert and the `sent` update to the browser | Needs a live project and the frontend (FE-09) | Watch the Alerts banner and sound while a replay runs; the alert should appear once and update in place |
| Escalation and stale/lost timings on real time | Tested with injected timestamps | Start a replay, `POST /v1/stream/drop {"seconds": 45}`: status goes `stale` after 10 s, `lost` after 30 s with a "Live data lost" warning, then back to `live` and the system alert resolves |
| The real recommendation text | Needs lessons in the database (BE-11 on DB-09 data) and a real LLM; the tests cover the template fallback and the number guard | Open an alert and read `recommendation`; with no lesson it must say "No recorded mitigation for this formation; review offset evidence." |
| The engine loop started by the app | Started in the FastAPI lifespan, which the tests do not run | Start the Space and look for `engine_tick` log lines; a database outage logs `engine_tick_failed` every 5 s |

**Decided 2026-10-04: look-ahead alerts auto-resolve once the bit is more than 25 m below the zone** (flag `AUTO_RESOLVE_REQUIRES_LOW_SCORE` in `app/alerts/engine.py`, now `False`). The contract used to add "and the zone's latest fused score is below the band threshold", but scores of zones behind the bit are never recomputed, so that condition would have kept look-ahead alerts open for ever. Contract §12, `02_PRD_BACKEND.md` BE-19 and `NWIS_PRD.md` were amended to match. The other rules are unchanged: warning and critical must be acknowledged first, and nothing auto-resolves while the stream is `lost`. In production, watch the first replay: an alert should close about 25 m after the bit passes its zone. If you would rather keep alerts open until someone resolves them, set the flag back to `True`.

Decisions to know: look-ahead alerts cover intervals starting 50 to 300 m ahead of the bit at band moderate or above; detector alerts cover the bit +/- 25 m, take the highest fired floor per risk type and are never capped by low confidence; a higher severity re-notifies (state back to `sent`, even after acknowledgement), anything else updates score and evidence quietly; after a resolve, a new alert needs a higher band, a fired detector, or score at least the resolved band's lower bound + 15 (moderate 20, elevated 40, high 60, critical 80); the message says "N offset wells within X km had ... ; average NPT Y h" using only the offset events behind the score (it cannot say "of M" because the score row does not carry the offset total); a recommendation that adds a number or unit not in the lesson text, or runs over two sentences, is replaced by "Offsets report: <mitigation>".

## BE-16 Risk layer L2 (ML training, calibration, SHAP)

| Skipped | Why | Run in production |
| --- | --- | --- |
| `python -m training.train_l2 --all` end to end (writes `model_runs` and `training/results.md`) | Needs completed wells with `depth_series`, actual tops and events in Supabase (DB-09 synthetic, DB-10 Volve) and the `models` bucket. Locally it ran only on 4 to 6 tiny in-memory wells | `cd services/ai && .venv/Scripts/python -m training.train_l2 --all`, then read `training/results.md` (leave-one-well-out PR-AUC against the L1-only baseline, per provenance) and `select risk_type, version, is_active, metrics from model_runs` |
| Whether L2 beats L1 | Unknown until there is real data. A model is activated only if it does | Commit `results.md` as measured, including the risk types where it loses |
| Real SQL (`load_wells`, `load_well_at`, `model_runs` insert/update, bucket upload and download) | Mocked | The training run above, then restart the Space and look for the `l2_models_loaded versions=...` log line |
| Training time on real data | The offset features are rebuilt for every fold, so cost grows with wells x rows (leave-one-well-out up to 20 wells, then 5-fold) | Time a `--risk losses` run first; if slow, the per-fold rebuild in `oof_predictions` is the place to optimise |
| Train / inference consistency of the offset features | Training computes offset distances in Python (haversine plus the TVD difference) while the live risk score uses `offsets_within` in SQL; they should agree closely but were never compared | Compare `l1` from `l1_scores` with the `l1` feature from `l2.current_features` for one live wellbore |
| Real leakage on real wells | The no-look-ahead rules are unit-tested (corrupting everything below the interval start leaves features unchanged) but real wells may hide others, for example a mud report that was entered late | After the first real run, spot-check one interval's features against its raw rows |

Decisions to know: one L2 probability per risk type describes the bit's look-ahead window (an event 50 to 300 m deeper), so every interval that starts 50 to 300 m ahead gets the same L2 value, and the first two intervals (under 50 m ahead) get none. SHAP values come from LightGBM's own TreeSHAP (`pred_contrib`, additive, tested to sum to the model margin) instead of the `shap` package, which would add numba; they are the same quantity as `shap.TreeExplainer`. Calibration is isotonic per risk type on the out-of-fold combined score and is fitted on the same rows it is evaluated on, so any calibrated figure is optimistic; precision and recall in `results.md` are therefore reported before calibration. `lightgbm`, `scikit-learn` and `joblib` were added to `requirements.txt` (the Docker image needs them). `tests/test_l2.py` was added beyond the file list in the PRD.

## BE-23 Planning brief

| Skipped | Why | Run in production |
| --- | --- | --- |
| The spatial query (`ST_DWithin`, `ST_Distance` on `wells.surface`, the `is_primary` join) | Mocked; PostGIS was not available | `POST /v1/planning/brief {"lat": ..., "lon": ..., "planned_td_m": 3600}` near the synthetic wells; check `offsets` are the wells you expect and in distance order |
| Sensible predicted tops and profile on real data | Only hand-made numeric fixtures | Compare the brief's `predicted_tops` with `POST /v1/wells/<nearby wellbore>/predict-tops` for a wellbore close to the point (they should be close); open the Planning page (FE-13) |
| Read-only guarantee | Tested by making every write call raise in the mocked database | After a call, `select count(*) from formation_tops where source = 'predicted'` must not have changed |
| Lessons present | Needs `lessons` built from real events (BE-11) | Check `lessons` is not empty for formations with elevated risk |

Decisions to know: the virtual well is vertical, so MD = TVD and KB is the mean KB of the offsets; wells with status `planned` are not offsets; at most 12 offsets (the nearest); the formations come from the offsets' most common basin (all formations if none has one); only formations with at least 2 offsets get a predicted top, and intervals above the first predicted top get no score; `risk_profile` lists every interval and risk type with a known L1 (so up to 5 rows per 25 m, about 700 rows for 3,600 m), L1 only (no L2 or L3 for a well that does not exist); `lessons` are those whose (formation, event type) matches a profile row at band `elevated` or above.

## BE-24 Admin retrain endpoint

| Skipped | Why | Run in production |
| --- | --- | --- |
| A real retrain started over HTTP, with `model_runs` rows appearing as each risk type finishes, and the active models reloaded afterwards | Needs wells in Supabase, the `models` bucket and the Space; the tests mock training, storage and loading and prove the order of steps, the thread, and the single-flight lock | `POST /v1/admin/retrain {"risk_types": ["losses"]}` as admin: expect 202 at once with `{"model_run_ids": []}`, then `select version, is_active, created_at from model_runs order by created_at desc` after a few minutes, then the `l2_models_loaded` log line |
| Memory and CPU on the free Space during training | Not measurable locally with tiny data | Watch the Space's resources during the first real retrain; a retrain of all five risk types rebuilds the offset features for every fold |
| The Node route `apps/web/api/admin/retrain.js` that forwards to this endpoint | It belongs to BE-20 | See BE-20 |

Decisions to know: `{"risk_types": []}` or no list retrains every risk type; an unknown name is 400; a second request while one runs is 409 `NWIS_BAD_STATE`; the lock lives in the Space's memory, so a restart (which also ends the training thread's task) frees it; a retrain that fails is only logged (look for `retrain_failed`), because nobody is waiting for the result.

## BE-20 Node API routes on Vercel

Run the local tests with `cd apps/web && npm run test:api` (181 tests, Node environment; `npm test` also runs them under jsdom).

| Skipped | Why | Run in production |
| --- | --- | --- |
| Deployment (`vercel --prod` from `apps/web`) and setting the environment variables in the Vercel dashboard | You asked to skip Vercel and Space work; nothing was deployed | Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_SERVICE_URL`, `SERVICE_TOKEN` (and optionally `FORWARD_TIMEOUT_MS`) in the Vercel project, then `vercel --prod` |
| `GET /api/health` shows the Space status | Needs the deployed function and a running Space | `curl https://<site>/api/health`; expect `{"ok":true,"space":{"ok":true,"version":...,"models":{"l2":[...]}}}`; with the Space asleep, `space.ok` is `false` until it wakes |
| "A 20 MB PDF uploads via the signed-URL flow (not through the function)" | Needs real Supabase Storage. The tests prove the function only handles metadata and accepts 20 MB | In the app, upload a 20 MB PDF on the Documents page (FE-10); in the network tab the file must go to `supabase.co`, not to `/api/...` |
| The real Supabase calls (`auth.getUser`, `profiles` select/upsert/update, `auth.admin.inviteUserByEmail`, `storage.createSignedUploadUrl`, `audit_log` insert) | Mocked supabase-js | Invite a test user as admin, change their role, upload a file; check `profiles` and `audit_log` (actions `user.invite`, `user.update`) |
| Role checks against real `profiles.role` and the 401/403 behaviour in a browser | Mocked | Call each route with a token of a wrong role; expect 403 with the contract error body |
| The Space's `X-Service-Token` check against the Node layer's token | Needs both deployed | A call through `/api/search` must succeed and a direct call to the Space without the header must return 401 |
| `maxDuration` | Set to 60 s. Vercel's limits page (updated Aug 2026) says Hobby with Fluid compute allows up to 300 s; I could not check your project's plan or whether Fluid compute is on | In the Vercel dashboard, confirm Fluid compute and raise `functions["api/**/*.js"].maxDuration` in `apps/web/vercel.json` if you want longer. The forward timeout is 50 s (`FORWARD_TIMEOUT_MS`) and must stay below it |

Decisions to know: the wrong HTTP method returns 405 with code `NWIS_BAD_REQUEST` (the contract has no 405 code); a Space timeout is 504 and an unreachable Space 502, both `NWIS_UPSTREAM`; the file-size and type checks for uploads return 400, not 413; `documents/[documentId]/reprocess` always sends no body to the Space; `admin/users/invite` upserts the `profiles` row so the role is set even if the sign-up trigger has not created it yet, and an audit-log failure is logged but does not fail the request; `api/__tests__/helpers.js` sits under an underscore folder so Vercel does not deploy it as a function; `vitest.api.config.js` and an `npm run test:api` script were added (the frontend setup file needs a DOM, so the Node tests have their own config).

## BE-21 Evaluation: OCR bake-off, extraction precision / recall, alert replay

`docs/eval_results.md` currently says plainly that **nothing has been measured**. The scoring and orchestration logic is unit-tested (`services/ai/tests/test_evaluation.py`, 37 tests); none of the three scripts has been run, because their inputs do not exist yet.

| Skipped | Why | Run in production |
| --- | --- | --- |
| **OCR bake-off**: Docling + RapidOCR vs Tesseract (preprocessed) vs Tesseract (raw) on the labelled pages | `db/eval/` (DB-14) does not exist, Tesseract is not installed on the dev PC, and Docling crashed a developer PC once | With the eval set in place: `cd services/ai && .venv/Scripts/python -m training.ocr_bakeoff` (light), then `... --docling` **on its own, with nothing else running**. Lock the OCR engine from the recommendation it writes |
| **Extraction precision / recall / F1**, per doc type, and formation tops within 5 m against targets 0.80 / 0.70 / 85 % | Same missing eval set, and it calls the real LLM | `python -m training.evaluate_extraction` (uses the ground-truth transcription, which isolates the LLM); `--source ocr` also OCRs the page files (heavy) |
| **Alert hit rate, median lead, false alerts per 1,000 m** | Needs Supabase with the synthetic drilling wells (DB-09), their `db/data/synth_truth/*.json` files and the replay | `python -m training.evaluate_alerts` (add `--reset` to delete a well's old alerts and risk_scores first; it writes `alerts`, `risk_scores` and `stream_state`) |
| `docs/eval_results.md` with the three tables, date and commit hash | Filled by the scripts above | Run all three, then remove the "nothing has been measured" paragraph at the top and commit the file. Put the numbers in the pitch as measured, good or bad |

Things to know before running: the page-level table ground truth is optional and is **not in the DB-14 spec** (a `ground_truth.jsonl` line may carry `"tables": [[["cell", ...], ...]]`; pages without it only count for CER, so ask the Database owner to add it for the table pages or the cell accuracy column will say n/a); extraction is scored on the LLM stage only (before unit normalisation, which needs the database), so it measures the prompts and the model, not the review rules; an alert counts as a hit only if its zone covers the event depth and it was raised while the bit was above that depth, and the lead is measured from the bit depth at the first such alert (taken at the risk recomputation, every 5 m); a "false alert" covers no hidden event of its type, so an alert for a real event raised too late is counted as late, not false; every dedup key counts once, so a re-notification is not a new alert.

## BE-22 Warm-up script and demo checklist

`scripts/warmup.py` is unit-tested against a fake stack (19 tests in `services/ai/tests/test_warmup.py`). `docs/DEMO_CHECKLIST.md` is written but has never been rehearsed.

| Skipped | Why | Run in production |
| --- | --- | --- |
| Running `python scripts/warmup.py` against the real stack | Nothing is deployed; needs the Vercel site, the Space, Supabase, a demo account and `SUPABASE_DB_URL` | Set `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_EMAIL`, `TEST_PASSWORD`, `SUPABASE_DB_URL`, then `python scripts/warmup.py --ask "<each scripted question>"`; every line must be `[ OK ]` |
| The reset step | `db/scripts/reset_demo.sh` / `.ps1` is DB-13, which does not exist yet; the warm-up reports a red check for it (use `--skip-reset` until then) | After DB-13: confirm it takes under 30 s and that the warm-up then reports `Demo reset` green |
| Waking a sleeping Hugging Face Space within 3 minutes | Needs the real Space | Let the Space sleep, then run the warm-up and time step 1 |
| A full rehearsal of the 7-minute demo, including `/api/stream/drop` timings | Needs everything deployed and DB-09 data | Follow `docs/DEMO_CHECKLIST.md` once end to end; fix the steps that differ |
| Cached answers for the scripted questions | The cache is the `llm_cache` table, written by the first real call | The warm-up's `--ask` fills it; check `select count(*) from llm_cache` and that the on-stage question gives `cached: true` |

Decisions to know: the order differs slightly from the PRD (Supabase is checked and the demo account signs in before the search warm-up, because search needs a session and a paused project would make sign-in fail confusingly); the sign-in uses the Supabase password grant, which needs the anon key (`SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`); the drilling wells are listed through PostgREST with the demo account, so RLS applies; the checklist deliberately names no wells or depths (they come from the DB-09 data and its truth files); the PRD's "rig view marks look-ahead scores stale" and "backfill the gap on reconnect" are not implemented, and the checklist says not to claim them.

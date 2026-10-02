# Demo checklist (about 7 minutes)

Written from `NWIS_PRD.md` §10.4 and the contract. **None of it has been rehearsed against a live system yet**: nothing is deployed, so every step below is what *should* happen. Run the full list once end to end before the real demo and correct this file with what you see.

## 1. Before the demo

Do this 30 minutes ahead, on the network you will present from.

1. Set the environment (a demo account that can call risk, search and ask; any role works, `rtoc_engineer` or `admin` is best because stream control needs one of them):

   ```powershell
   $env:API_BASE = "https://<site>.vercel.app/api"
   $env:SUPABASE_URL = "https://<ref>.supabase.co"
   $env:SUPABASE_ANON_KEY = "<anon key>"
   $env:TEST_EMAIL = "<demo account>"; $env:TEST_PASSWORD = "<its password>"
   $env:SUPABASE_DB_URL = "<pooler connection string>"
   ```

2. Run the warm-up. Give it every question you will ask on stage, spelled exactly as you will type it (an answer is only cached for the same text and filters):

   ```bash
   python scripts/warmup.py --ask "What worked for losses in Tipam?"
   ```

   It wakes the Space (up to 3 minutes), checks Supabase is not paused, signs in, loads the embedding model, caches the questions, loads the risk models for every drilling well, then runs `db/scripts/reset_demo` so the demo starts clean. **Do not start the demo until it prints `READY`.** If you only want the warm-up without the reset, add `--skip-reset`.

3. Open the app in the browser you will use, sign in, and click once on the page (browsers block the alert sound until you interact with the page).
4. Have a backup: a screen recording of a good run, and screenshots of the alert card and the correlation view.

## 2. Which wells to use

* **Active wells:** the synthetic wells with status `drilling` (DB-09), the ones the warm-up lists under "Risk warmed". `reset_demo` puts each one back at its start depth with the stream stopped.
* **Pick the replay well by its hidden hazards.** Each drilling well has a truth file, `db/data/synth_truth/<well name>.json`, listing the events that will happen below the start depth. Choose the well whose first hidden event is **50 to 300 m below the start depth**: the look-ahead alert covers 50 to 300 m ahead, so it appears within the first minute of the replay instead of after several minutes of drilling.
* **Offsets and correlation:** use the same well; its offsets are the completed synthetic and Volve wells within 10 km.
* **Never read the truth file out loud or show it before the alert fires**: the point is that the system warned about something it was not told.

## 3. The seven minutes

| # | Say / do | What should happen | If it does not |
| --- | --- | --- | --- |
| 1 | **Upload** a scanned report the judges pick (Documents page). Approve one extracted event in the Review queue. | Progress bar through OCR, extraction, validation; events appear with page references. | A big scan can take about a minute per page. Keep a small text-layer PDF ready (`DEMO-UPLOAD` in the title, so `reset_demo` removes it); say that scans use OCR and show the review queue on a document uploaded earlier. |
| 2 | **Pick the active well** on the map. Change the radius and the depth. | Offsets highlighted; the depth distance (not just surface distance) updates. | Reload the page. If the map is empty, the offsets function failed: check the Space logs. |
| 3 | **Open Correlation.** | Wells aligned on a flatten formation; predicted tops with uncertainty bars; events and casing shoes. | Choose another flatten formation (a well without that top shows a "flatten missing" note and is not shifted). |
| 4 | **Start the live replay at 60x** (Replay panel, or `POST /api/stream/start`). | Gauges move with telemetry; within about a minute a look-ahead alert appears for a hazard 50 to 300 m ahead. | If no alert: wrong well (see section 2), or the stream did not start (check `stream_state`). Raise the speed (up to 600). |
| 5 | **Open the alert.** Show the evidence (offset events, source pages), what worked, then acknowledge and rate it. | Title like "... risk ~N m ahead (formation)"; message built from offset events; recommendation from lessons; acknowledging removes the repeating sound. | With no LLM the recommendation falls back to "Offsets report: ..." or "No recorded mitigation for this formation; review offset evidence." Both are intended. |
| 6 | **Ask** the cached question: "What worked for losses in Tipam?" Click a citation. | A short answer with `[n]` citations; the source page opens. | If the answer says "Not enough evidence...", the data is not indexed (`python -m app.search.index --reindex-all`); use Search instead. If both LLM providers fail you get a 502: show Search results and say the answer step needs the model. |
| 7 | **Model page.** Show the metrics under leave-one-well-out and the retrain button. | The numbers in `training/results.md` and `docs/eval_results.md`, **as measured**, including any risk type where L2 does not beat L1. | If no model is active, say so: the score is then L1 + L3 only. Never quote a number that is not in those files. |
| 8 | **Hand over the URL.** | Judges try their own well, depth or document. | Have the demo account's password ready; keep `--skip-reset` runs for repeats. |

## 4. Showing the telemetry-loss rule

With the replay running and at least one look-ahead alert open:

```bash
curl -X POST "$API_BASE/stream/drop" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"wellbore_id":"<wellbore uuid>","seconds":45}'
```

(`$TOKEN` is the access token of a signed-in `rtoc_engineer` or `admin`: in the browser dev tools, Application > Local Storage > the `sb-...-auth-token` entry.) Expected, with the alert engine running on the Space:

| After | You should see |
| --- | --- |
| 10 s | stream status `stale` |
| 30 s | status `lost` and a **"Live data lost"** warning alert; L3 detectors stop; the open look-ahead alert stays open (never auto-resolved while data is lost) |
| 45 s | samples resume, status `live`, the "Live data lost" alert **auto-resolves** |

The PRD also promises that the rig view marks look-ahead scores as stale and backfills the gap on reconnect; the backend does not do either yet (see `docs/SKIPPED_FOR_PRODUCTION.md`), so do not claim them.

## 5. Fallbacks

| Problem | What to do |
| --- | --- |
| **Groq is rate-limited** | Nothing: the service retries once, then fails over to OpenRouter by itself. Scripted questions are already cached by the warm-up. |
| **Both LLM providers fail** | Alerts still fire and the recommendation uses the template. Ask returns an error: show Search. Extraction (upload) will fail the job: use a document processed earlier. |
| **The Space is asleep or slow** | Run `python scripts/warmup.py --skip-reset` (wakes it, up to 3 minutes). Free Spaces sleep after inactivity and lose the in-memory replay: restart the replay after a restart. |
| **Supabase is paused** | Restore the project in the Supabase dashboard (a minute or two), then re-run the warm-up. |
| **Alerts do not appear in the browser** | Reload the page (Realtime reconnects); check `select * from alerts order by created_at desc` to see whether the backend raised them. |
| **The replay is stuck or a run went badly** | Stop the stream, run `db/scripts/reset_demo`, run the warm-up again. |
| **No sound** | The browser blocked it until you clicked the page; click and trigger the next alert. |
| **Nothing works** | Play the backup recording and walk through the screenshots; be honest that it is a recording. |

## 6. Questions to answer honestly

* *Is the model learning from real data?* The offsets are synthetic Assam wells plus real Volve data; say which a given result comes from (the `provenance` column) and quote only measured numbers.
* *What if a look-ahead alert is never acknowledged?* It escalates (critical after 5 minutes, warning after 15) and is logged. Once acknowledged (or straight away for Info and Watch) an alert closes by itself about 25 m after the bit passes its zone, and never while the stream is lost.
* *What if confidence is low?* The alert says so with the reason and is capped at Watch, unless a physics detector confirms the risk.

## 7. After the demo

Run `db/scripts/reset_demo` so the next run starts clean, and write any step above that did not behave as described into this file.

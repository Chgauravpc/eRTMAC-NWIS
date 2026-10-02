# Evaluation results

Measured numbers only. Each section is appended by one script and carries the date and the git commit it ran at. Nothing here is an estimate. Targets come from `NWIS_PRD.md` §1.

**Status: nothing has been measured yet.** The labelled evaluation set (`db/eval/`, DB-14) and the synthetic drilling wells (DB-09) do not exist, and no OCR engine, LLM or Supabase project was run for this. The three scripts are written and their scoring logic is unit-tested (`services/ai/tests/test_evaluation.py`); run them as listed in `docs/SKIPPED_FOR_PRODUCTION.md` (section BE-21) and the sections below will be appended here:

| Script | Appends | Needs |
| --- | --- | --- |
| `python -m training.ocr_bakeoff` (`--docling` for the heavy engine) | OCR bake-off: CER, table cell accuracy, seconds per page, recommendation | `db/eval/ground_truth.jsonl` and `db/eval/pages/` |
| `python -m training.evaluate_extraction` | Extraction precision, recall, F1 per doc type, formation tops within 5 m | the same ground truth, and an LLM key |
| `python -m training.evaluate_alerts` | Alert hit rate, median lead distance, false alerts per 1,000 m | Supabase with the synthetic drilling wells and `db/data/synth_truth/*.json` |

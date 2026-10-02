# L2 training (BE-16)

The L2 layer is a LightGBM classifier per risk type that estimates, from the state with the bit at some depth,
the chance that an event of that type starts 50 to 300 m deeper. Layer weights, bands and the high-band threshold
are in `app/risk/config.py` (contract §11).

## What is here

| File | Role |
| --- | --- |
| `features.py` | One row per (completed wellbore, 25 m interval): features that read only data at or above the interval start, plus the look-ahead labels. `build_dataset(...)` can rebuild the offset-based features without held-out wells. `load_wells()` reads the tables. |
| `train_l2.py` | Leave-one-well-out validation, PR-AUC against the L1-only baseline, precision and recall at the `high` band, isotonic calibration, artifact upload and `model_runs`. |
| `eval_tops.py` | Leave-one-well-out check of the predicted formation tops (BE-12). |
| `results.md` | Written by `train_l2.py`: every number, including where L2 does not beat L1. |

## Running it (needs the database)

Needs completed wells with `depth_series`, actual `formation_tops` and `events` (the synthetic Assam wells from
DB-09 and the Volve wells from DB-10), and `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `services/ai/.env`.

```bash
cd services/ai
.venv/Scripts/python -m training.train_l2 --all               # train every risk type, upload, write model_runs
.venv/Scripts/python -m training.train_l2 --risk losses       # one risk type
.venv/Scripts/python -m training.train_l2 --all --no-store    # train and write results.md only
```

Training time grows with wells x rows, because the offset features are rebuilt for every fold; expect minutes
for tens of wells. Run it when nothing else heavy is running.

## How to read the results

* A model is **activated only if its PR-AUC is above the L1-only baseline** on the same held-out rows. Otherwise
  it is stored in `model_runs` with `is_active = false` and the risk score stays L1 + L3 for that risk type.
* Check the "By provenance" table: a model that wins on synthetic wells but not on Volve is learning the generator.
* Precision and recall are of the combined L1 + L2 score above 60 (the `high` band), before calibration.

## Leakage rules (tested in `tests/test_features.py`)

* Window statistics use depth_series rows in (md0 - 30 m, md0] only; mud weight and ECD are the last values at or above md0.
* TVD comes from survey stations at or above md0 and is extended along the last inclination, never read from below.
* Relative depth uses the median formation thickness of **other** wells, not the well's own next top.
* `l1` and the nearest offset event come from other wells only, and cross-validation rebuilds them without the held-out wells.

## At inference

`app/risk/l2.py` loads active models from the `models` bucket at startup (and after a retrain), builds the feature
row for the bit's current depth, and gives every interval that starts 50 to 300 m ahead the same probability plus the
top-5 TreeSHAP features (LightGBM `pred_contrib`, equal to `shap.TreeExplainer`). `fuse.py` then combines it with L1 and L3.

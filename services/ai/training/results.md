# L2 training results

Trained 2026-10-02 19:11 UTC. Leave-one-well-out validation; the offset features of each fold are rebuilt without the held-out wells. PR-AUC is of L2 alone; the baseline is the PR-AUC of L1 alone on the same rows. Precision and recall are of the combined L1+L2 score above 60 (the `high` band), before calibration.

| Risk type | Wells | Rows | Positives | L2 PR-AUC | L1 baseline PR-AUC | Precision@high | Recall@high | Active |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| losses | 26 | 4693 | 201 | 0.200 | 0.082 | 0.500 | 0.025 | yes |
| stuck_pipe | 26 | 4693 | 269 | 0.159 | 0.098 | 0.000 | 0.000 | yes |
| kick | 26 | 4693 | 50 | 0.044 | 0.034 | n/a | 0.000 | yes |
| torque | 26 | 4693 | 50 | 0.054 | 0.010 | n/a | 0.000 | yes |
| cementing | 26 | 4693 | 50 | 0.027 | 0.033 | 0.000 | 0.000 | no |

## By provenance

| Risk type | Provenance | Rows | Positives | L2 PR-AUC | L1 baseline PR-AUC |
| --- | --- | --- | --- | --- | --- |
| losses | synthetic | 4693 | 201 | 0.200 | 0.082 |
| stuck_pipe | synthetic | 4693 | 269 | 0.159 | 0.098 |
| kick | synthetic | 4693 | 50 | 0.044 | 0.034 |
| torque | synthetic | 4693 | 50 | 0.054 | 0.010 |
| cementing | synthetic | 4693 | 50 | 0.027 | 0.033 |

## Where L2 does not beat the baseline

- **cementing**: PR-AUC is not above the L1-only baseline, so the model was not activated.

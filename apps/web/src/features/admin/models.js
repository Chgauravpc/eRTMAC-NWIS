// Pure helpers for the Models page (FE-14).

export const POLL_MS = 10_000;
export const POLL_WINDOW_MS = 10 * 60_000;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Does this run beat the offset-only baseline? null when either number is missing. */
export function beatsBaseline(metrics) {
  const a = num(metrics?.pr_auc);
  const b = num(metrics?.baseline_pr_auc);
  return a === null || b === null ? null : a > b;
}

/** Bar widths (0-100 %) for the PR-AUC pair; both numbers are on a 0..1 scale. */
export function prAucBars(metrics) {
  const clamp = (v) => (v === null ? null : Math.max(0, Math.min(100, Math.round(v * 100))));
  return { model: clamp(num(metrics?.pr_auc)), baseline: clamp(num(metrics?.baseline_pr_auc)) };
}

export const fmt3 = (v) => (num(v) === null ? '—' : num(v).toFixed(3));
export const fmt2 = (v) => (num(v) === null ? '—' : num(v).toFixed(2));

/**
 * Risk types that have no new run yet. A run is "new" when its id was not in the list when Retrain was clicked
 * (comparing ids avoids any clock difference between the browser and the server).
 */
export function stillTraining(requestedTypes, baselineIds, rows) {
  const before = new Set(baselineIds);
  const done = new Set((rows || []).filter((r) => !before.has(r.id)).map((r) => r.risk_type));
  return requestedTypes.filter((t) => !done.has(t));
}

/** Newest first, grouped by risk type in the order given (unknown types go last). */
export function groupRuns(rows, order) {
  const byType = new Map();
  for (const r of rows || []) {
    if (!byType.has(r.risk_type)) byType.set(r.risk_type, []);
    byType.get(r.risk_type).push(r);
  }
  const known = order.filter((t) => byType.has(t));
  const extra = [...byType.keys()].filter((t) => !order.includes(t));
  return [...known, ...extra].map((t) => [t, byType.get(t).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))]);
}

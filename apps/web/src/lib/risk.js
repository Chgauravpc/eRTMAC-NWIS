// Risk bands and alert severities (contract §11.1). The ONLY place that turns a score into a band.
//   score <= 20 -> low; 20 < score <= 40 -> moderate; ... (use > / <= exactly like this)
// Meaning text follows the NWIS_PRD F5 band table ("What the engineer should do").

export const BAND_ORDER = Object.freeze(['low', 'moderate', 'elevated', 'high', 'critical']);

export const BAND_META = Object.freeze({
  low: {
    label: 'Low',
    range: '0–20',
    token: 'risk-low',
    icon: 'check',
    severity: 'none',
    alertRaised: 'None',
    meaning: 'Normal drilling',
    // light-theme tint (text stays >= 4.5:1); the solid token colour is used for swatches/borders
    color: 'bg-green-100 text-green-900 border-green-600',
    swatch: 'bg-risk-low',
  },
  moderate: {
    label: 'Moderate',
    range: '21–40',
    token: 'risk-moderate',
    icon: 'info',
    severity: 'info',
    alertRaised: 'Info (no sound)',
    meaning: 'Be aware; lessons shown on the rig view',
    color: 'bg-sky-100 text-sky-900 border-sky-600',
    swatch: 'bg-risk-moderate',
  },
  elevated: {
    label: 'Elevated',
    range: '41–60',
    token: 'risk-elevated',
    icon: 'eye',
    severity: 'watch',
    alertRaised: 'Watch (no sound)',
    meaning: 'Review offset evidence; prepare mitigation',
    color: 'bg-amber-100 text-amber-900 border-amber-500',
    swatch: 'bg-risk-elevated',
  },
  high: {
    label: 'High',
    range: '61–80',
    token: 'risk-high',
    icon: 'alert',
    severity: 'warning',
    alertRaised: 'Warning (sound, must acknowledge)',
    meaning: 'Apply the recommended mitigation; inform RTOC',
    color: 'bg-orange-100 text-orange-900 border-orange-600',
    swatch: 'bg-risk-high',
  },
  critical: {
    label: 'Critical',
    range: '81–100',
    token: 'risk-critical',
    icon: 'octagon',
    severity: 'critical',
    alertRaised: 'Critical (sound, must acknowledge, escalates)',
    meaning: 'Act now; follow the well-control or trouble procedure',
    color: 'bg-red-100 text-red-900 border-red-600',
    swatch: 'bg-risk-critical',
  },
});

export const SEVERITY_META = Object.freeze({
  info: { label: 'Info', band: 'moderate', rank: 1 },
  watch: { label: 'Watch', band: 'elevated', rank: 2 },
  warning: { label: 'Warning', band: 'high', rank: 3 },
  critical: { label: 'Critical', band: 'critical', rank: 4 },
});

/** Band for a 0..100 score; null when there is no score. */
export function bandFor(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const s = Number(score);
  if (s <= 20) return 'low';
  if (s <= 40) return 'moderate';
  if (s <= 60) return 'elevated';
  if (s <= 80) return 'high';
  return 'critical';
}

export function bandLabel(band) {
  return BAND_META[band]?.label ?? '';
}

export function severityFor(band) {
  return BAND_META[band]?.severity || 'none';
}

/** Rank used to sort alerts: critical first. */
export function severityRank(severity) {
  return SEVERITY_META[severity]?.rank ?? 0;
}

// ---------------------------------------------------------------- look-ahead grid (contract §11.2)
export const INTERVAL_M = 25;
export const LOOKAHEAD_MAX_M = 300;
export const LOOKAHEAD_MIN_M = 50; // first 50 m are "at bit": detectors only
export const RISK_COLUMNS = LOOKAHEAD_MAX_M / INTERVAL_M; // 12

/** Length (m) of the overlap between a score row [md_from_m, md_to_m) and [from, to). */
export function overlapM(row, from, to) {
  return Math.max(0, Math.min(row.md_to_m, to) - Math.max(row.md_from_m, from));
}

/** Rows that lie (at least partly) within [bit, bit + 300 m]. */
export function scoresInWindow(scores, bitMd) {
  if (bitMd == null) return [];
  return (scores || []).filter((r) => overlapM(r, bitMd, bitMd + LOOKAHEAD_MAX_M) > 0);
}

/** 12 columns of 25 m starting at the bit; the first two are "at bit". */
export function riskColumns(bitMd) {
  return Array.from({ length: RISK_COLUMNS }, (_, i) => ({
    from: bitMd + i * INTERVAL_M,
    to: bitMd + (i + 1) * INTERVAL_M,
    atBit: (i + 1) * INTERVAL_M <= LOOKAHEAD_MIN_M,
  }));
}

/**
 * The score row that represents a grid column for a risk type: the row with the largest overlap with
 * the column (so engine grids need not be aligned to ours); ties go to the most recently computed row.
 */
export function pickCell(scores, riskType, from, to) {
  let best = null;
  let bestOverlap = 0;
  for (const r of scores || []) {
    if (r.risk_type !== riskType) continue;
    const o = overlapM(r, from, to);
    if (o <= 0) continue;
    const newer = best && Date.parse(r.computed_at || 0) > Date.parse(best.computed_at || 0);
    if (o > bestOverlap || (o === bestOverlap && newer)) {
      best = r;
      bestOverlap = o;
    }
  }
  return best;
}

/** Identity of a score row for Realtime upserts: wellbore + risk type + md range. */
export function riskKey(r) {
  return `${r.wellbore_id}|${r.risk_type}|${r.md_from_m}|${r.md_to_m}`;
}

/** Insert or replace `row` in `list` (same identity), returning a new array. */
export function upsertScore(list, row) {
  const key = riskKey(row);
  const next = [...(list || [])];
  const idx = next.findIndex((r) => riskKey(r) === key);
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return next;
}

/**
 * Rig gauges: per risk type, the row with the highest fused score among rows within the next 300 m
 * of the bit (ties: the shallower row). Types without rows map to null.
 */
export function maxFusedByType(scores, bitMd, riskTypes) {
  const inWin = scoresInWindow(scores, bitMd);
  const out = {};
  for (const rt of riskTypes) {
    let best = null;
    for (const r of inWin) {
      if (r.risk_type !== rt) continue;
      if (!best || r.fused > best.fused || (r.fused === best.fused && r.md_from_m < best.md_from_m)) best = r;
    }
    out[rt] = best;
  }
  return out;
}

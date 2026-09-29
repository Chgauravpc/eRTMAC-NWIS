// Pure defaults for the correlation controls.

export const ALL_CHANNELS = Object.freeze(['gr_api', 'rop_m_h', 'torque_knm', 'mw_sg', 'ecd_sg']);
export const DEFAULT_CHANNELS = Object.freeze(['gr_api', 'rop_m_h', 'mw_sg']);
export const MAX_OFFSETS = 6;
export const DEFAULT_OFFSET_COUNT = 4;
export const OFFSET_SEARCH_RADIUS_M = 25000;

/** Formation names present in the active well's tops, shallowest first (one entry per formation). */
export function formationsFromTops(tops) {
  const seen = new Map();
  for (const t of tops || []) {
    if (!seen.has(t.formation) || t.top_md_m < seen.get(t.formation)) seen.set(t.formation, t.top_md_m);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

/**
 * Default flatten formation = the next formation below the bit (formation_at_md.next_formation) when it is in
 * the well's tops; otherwise the shallowest top deeper than the bit; '' (true MD) when there is no bit.
 */
export function defaultFlattenFormation({ tops, bitMd, next }) {
  const names = formationsFromTops(tops);
  if (next && names.includes(next)) return next;
  if (bitMd == null) return '';
  const below = [...(tops || [])].filter((t) => t.top_md_m > bitMd).sort((a, b) => a.top_md_m - b.top_md_m)[0];
  return below?.formation ?? '';
}

/** The 4 nearest offsets (input is already ordered by distance, but sort defensively). */
export function defaultOffsetIds(offsets, count = DEFAULT_OFFSET_COUNT) {
  return [...(offsets || [])]
    .sort((a, b) => a.surface_distance_m - b.surface_distance_m)
    .slice(0, count)
    .map((o) => o.wellbore_id);
}

/** Warning text for wells that lack the flatten formation (API field `flatten_missing`), or null. */
export function flattenWarning(wells, flatten) {
  const missing = (wells || []).filter((w) => w.flatten_missing).map((w) => w.name);
  if (!flatten || missing.length === 0) return null;
  const one = missing.length === 1;
  return `${missing.join(', ')} ${one ? 'has' : 'have'} no ${flatten} top and ${one ? 'is' : 'are'} shown unshifted.`;
}

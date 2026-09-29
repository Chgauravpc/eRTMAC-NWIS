// Pure helpers for the map tab (no React, no Leaflet) so they can be unit tested.
import { EVENT_TO_RISK, RISK_LABELS } from '../../lib/constants';

const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

/** Marker colours by risk type (grey when the well has none). Always paired with words in the legend. */
export const RISK_COLORS = Object.freeze({
  losses: '#2563eb',
  stuck_pipe: '#ea580c',
  kick: '#dc2626',
  torque: '#7c3aed',
  cementing: '#92400e',
});
export const NO_RISK_COLOR = '#6b7280';
export const riskColor = (risk) => RISK_COLORS[risk] || NO_RISK_COLOR;

export const DEFAULT_MAP_PARAMS = Object.freeze({
  radius: 10000, // metres; the slider works in km (1..25)
  depth: null, // null = follow the current bit depth
  mode: 'surface',
  formation: '',
  eventType: '',
  provenance: '',
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Depth actually used: the user's slider value, else the bit depth, clamped to 0..TD. null if unknown. */
export function effectiveDepth(depth, bitMd, td) {
  const raw = depth ?? bitMd ?? null;
  if (raw == null) return null;
  return clamp(raw, 0, td != null ? td : raw);
}

/** Map control state -> exact offsets_within parameters (contract §7 names). */
export function buildOffsetRpcParams(wellboreId, radiusM, md, mode) {
  return { p_wellbore: wellboreId, p_radius_m: radiusM, p_md: md ?? null, p_mode: mode };
}

/** Distance the list is sorted by: depth distance in depth mode when available, else surface. */
export function activeDistance(offset, mode) {
  return mode === 'depth' && offset.depth_distance_m != null ? offset.depth_distance_m : offset.surface_distance_m;
}

/** Sorted copy by the active distance (nulls last, ties by name). */
export function sortOffsets(offsets, mode) {
  return [...(offsets || [])].sort((a, b) => {
    const da = activeDistance(a, mode), db = activeDistance(b, mode);
    if (da == null && db == null) return String(a.well_name).localeCompare(String(b.well_name));
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db || String(a.well_name).localeCompare(String(b.well_name));
  });
}

/** Number of matching events per wellbore ({wellbore_id: n}) for an optional event type. */
export function countMatchingEvents(events, eventType) {
  const out = {};
  for (const e of events || []) {
    if (eventType && e.event_type !== eventType) continue;
    out[e.wellbore_id] = (out[e.wellbore_id] || 0) + 1;
  }
  return out;
}

/**
 * Apply the map filters. `matchCounts` (from countMatchingEvents) is set when a formation or event-type
 * filter is active: only offsets with at least one matching event stay, and their count becomes the matching count.
 */
export function filterOffsets(offsets, { provenance = '', matchCounts = null } = {}) {
  return (offsets || [])
    .filter((o) => !provenance || o.provenance === provenance)
    .filter((o) => !matchCounts || (matchCounts[o.wellbore_id] ?? 0) > 0)
    .map((o) => (matchCounts ? { ...o, event_count: matchCounts[o.wellbore_id] } : o));
}

/** Event counts by risk type; events without a scored risk are counted under `other`. */
export function countByRisk(events) {
  const out = {};
  for (const e of events || []) {
    const risk = e.risk_type ?? EVENT_TO_RISK[e.event_type] ?? 'other';
    out[risk] = (out[risk] || 0) + 1;
  }
  return out;
}

export const riskLabel = (risk) => (risk === 'other' ? 'Other (not scored)' : RISK_LABELS[risk] || risk);

/** North/east offset (m) from a surface point -> lon/lat. */
export function offsetToLonLat(surface, north, east) {
  return {
    lat: surface.lat + north / M_PER_DEG,
    lon: surface.lon + east / (M_PER_DEG * Math.cos(surface.lat * RAD)),
  };
}

/**
 * Position of an offset well at the point of its survey whose TVD is closest to `tvd`
 * (the same matching rule as offsets_within's depth distance). `stations` need md_m/tvd_m/north_m/east_m.
 */
export function positionAtTvd(stations, tvd, surface) {
  const s = [...(stations || [])].sort((a, b) => a.md_m - b.md_m);
  if (s.length === 0 || tvd == null) return null;
  let best = { d: Infinity, north: s[0].north_m, east: s[0].east_m, md: s[0].md_m };
  const consider = (d, north, east, md) => {
    if (d < best.d) best = { d, north, east, md };
  };
  s.forEach((p) => consider(Math.abs(p.tvd_m - tvd), p.north_m, p.east_m, p.md_m));
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const lo = Math.min(a.tvd_m, b.tvd_m), hi = Math.max(a.tvd_m, b.tvd_m);
    if (tvd >= lo && tvd <= hi && hi > lo) {
      const f = (tvd - a.tvd_m) / (b.tvd_m - a.tvd_m);
      consider(0, a.north_m + (b.north_m - a.north_m) * f, a.east_m + (b.east_m - a.east_m) * f, a.md_m + (b.md_m - a.md_m) * f);
    }
  }
  return { ...offsetToLonLat(surface, best.north, best.east), md_m: best.md };
}

/** [[south, west], [north, east]] box around a circle. */
export function circleBounds(center, radiusM) {
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.cos(center.lat * RAD));
  return [
    [center.lat - dLat, center.lon - dLon],
    [center.lat + dLat, center.lon + dLon],
  ];
}

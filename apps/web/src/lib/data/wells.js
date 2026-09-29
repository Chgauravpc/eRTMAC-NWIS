// Data access for wells, streams, formations and the correlation API. Components never call
// supabase/fetch directly; TanStack Query hooks in ../hooks/wells.js wrap these functions.
import { supabase } from '../supabase';
import { api } from '../api';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const STATUS_ORDER = { drilling: 0, planned: 1, completed: 2 };

/** Drilling wells first, then planned, then completed; alphabetical inside each group. Pure. */
export function sortDrillingFirst(wells) {
  return [...(wells || [])].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
      String(a.well_name).localeCompare(String(b.well_name)),
  );
}

/** v_well_summary rows (contract §6 views). */
export async function getWellSummaries() {
  return unwrap(await supabase.from('v_well_summary').select('*'));
}

export async function getWellSummary(wellboreId) {
  return unwrap(await supabase.from('v_well_summary').select('*').eq('wellbore_id', wellboreId).single());
}

/** All stream_state rows (one per wellbore). */
export async function getStreamStates() {
  return unwrap(await supabase.from('stream_state').select('*'));
}

export async function getStreamState(wellboreId) {
  return unwrap(await supabase.from('stream_state').select('*').eq('wellbore_id', wellboreId).maybeSingle());
}

const OPEN_STATES = ['resolved', 'feedback'];

/** Open (not resolved/feedback) alert counts per wellbore: { [wellbore_id]: {info,watch,warning,critical,total} }. */
export async function getOpenAlertCounts() {
  const rows = unwrap(
    await supabase.from('alerts').select('wellbore_id,severity,state').not('state', 'in', `(${OPEN_STATES.join(',')})`),
  );
  return countAlertsByWell(rows);
}

export function countAlertsByWell(rows) {
  const out = {};
  for (const r of rows || []) {
    if (OPEN_STATES.includes(r.state)) continue;
    const c = (out[r.wellbore_id] ||= { info: 0, watch: 0, warning: 0, critical: 0, total: 0 });
    if (r.severity in c) c[r.severity] += 1;
    c.total += 1;
  }
  return out;
}

/** RPC formation_at_md (contract §7) -> first row or null. */
export async function getFormationAtMd(wellboreId, md) {
  const rows = unwrap(await supabase.rpc('formation_at_md', { p_wellbore: wellboreId, p_md: md }));
  return rows?.[0] ?? null;
}

export async function getFormationTops(wellboreId) {
  return unwrap(await supabase.from('formation_tops').select('*').eq('wellbore_id', wellboreId).order('top_md_m', { ascending: true }));
}

export async function getHoleSections(wellboreId) {
  return unwrap(await supabase.from('hole_sections').select('*').eq('wellbore_id', wellboreId).order('md_from_m', { ascending: true }));
}

/** Formation lookup, shallowest first within a basin. */
export async function getFormations() {
  return unwrap(await supabase.from('formations').select('name,basin,strat_order,lithology').order('strat_order', { ascending: true }));
}

/** Lessons, optionally limited to some formations. */
export async function getLessons(formations) {
  let q = supabase.from('lessons').select('*');
  if (formations?.length) q = q.in('formation', formations);
  return unwrap(await q.order('well_count', { ascending: false }));
}

/** POST /api/wells/{id}/predict-tops (contract §9.2). */
export async function predictTops(wellboreId, radiusM = 10000) {
  return api.post(`/wells/${wellboreId}/predict-tops`, { radius_m: radiusM });
}

/** GET /api/wells/{id}/correlation (contract §9.2/§9.3). */
export async function getCorrelation(wellboreId, { offsets, flatten, channels }) {
  return api.get(`/wells/${wellboreId}/correlation`, {
    params: { offsets: (offsets || []).join(','), flatten, channels: (channels || []).join(',') },
  });
}

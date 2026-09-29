import { supabase } from '../supabase';
import { api } from '../api';
import { EVENT_TO_RISK } from '../constants';
import { LOOKAHEAD_MAX_M, INTERVAL_M } from '../risk';

/**
 * risk_scores for [bit, bit + 300 m]: every row that overlaps the window, so engine grids that are not
 * aligned to ours still show up. `bitMd` is snapped down to the 25 m grid to keep the query stable
 * while the bit creeps forward; the view filters to the exact window.
 */
export async function getRiskScores(wellboreId, bitMd) {
  const from = Math.floor(bitMd / INTERVAL_M) * INTERVAL_M;
  const { data, error } = await supabase
    .from('risk_scores')
    .select('*')
    .eq('wellbore_id', wellboreId)
    .gt('md_to_m', from)
    .lt('md_from_m', from + LOOKAHEAD_MAX_M + INTERVAL_M)
    .order('md_from_m', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** POST /api/wells/{id}/risk -> {scores:[...]} (the server also upserts them). */
export async function recomputeRisk(wellboreId, range = undefined) {
  const res = await api.post(`/wells/${wellboreId}/risk`, range);
  return res?.scores ?? [];
}

const first = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

/** formation_at_md (contract §7) for the bit position. */
export async function getFormationAt(wellboreId, md) {
  const { data, error } = await supabase.rpc('formation_at_md', { p_wellbore: wellboreId, p_md: md });
  if (error) throw error;
  return first(data);
}

/** formation_tops rows of a wellbore (predicted tops carry uncertainty_m). */
export async function getFormationTops(wellboreId) {
  const { data, error } = await supabase.from('formation_tops').select('*').eq('wellbore_id', wellboreId);
  if (error) throw error;
  return data ?? [];
}

const TOP_PRIORITY = { actual: 0, predicted: 1, prognosis: 2 };

/** The top of `formation` to trust (actual > predicted > prognosis), or null. */
export function bestTop(tops, formation) {
  return (
    (tops || [])
      .filter((t) => t.formation === formation)
      .sort((a, b) => (TOP_PRIORITY[a.source] ?? 9) - (TOP_PRIORITY[b.source] ?? 9))[0] ?? null
  );
}

/** Top lessons for formations (rig view) or for a formation + risk type (interval detail). */
export async function getLessons({ formations, riskType = null, limit = 3 }) {
  const list = (formations || []).filter(Boolean);
  if (list.length === 0) return [];
  let q = supabase.from('lessons').select('*').in('formation', list);
  if (riskType) {
    const types = Object.entries(EVENT_TO_RISK)
      .filter(([, rt]) => rt === riskType)
      .map(([et]) => et);
    q = q.in('event_type', types);
  }
  const { data, error } = await q.order('success_rate', { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Events behind an L1 score. Best effort: a failure must not break the detail panel. */
export async function getEventsByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (list.length === 0) return [];
  try {
    const { data, error } = await supabase.from('events').select('*').in('id', list);
    if (error) return [];
    return (data ?? []).filter((e) => list.includes(e.id));
  } catch {
    return [];
  }
}

/** Depth distance of each offset wellbore from the active well at `md` (best effort). */
export async function getOffsetDistances(wellboreId, md) {
  try {
    const { data, error } = await supabase.rpc('offsets_within', {
      p_wellbore: wellboreId,
      p_radius_m: 10000,
      p_md: md,
      p_mode: 'depth',
    });
    if (error) return {};
    return Object.fromEntries((data ?? []).map((o) => [o.wellbore_id, o.depth_distance_m]));
  } catch {
    return {};
  }
}

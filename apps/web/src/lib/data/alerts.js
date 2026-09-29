import { supabase } from '../supabase';

// ------------------------------------------------------------------ errors (PRD FE-09: plain words)
export const ALERT_ERROR_TEXT = Object.freeze({
  NWIS_FORBIDDEN: "You don't have permission for this.",
  NWIS_BAD_STATE: 'This alert has changed; refreshed.',
  NWIS_NOT_FOUND: 'This alert no longer exists; refreshed.',
  NWIS_BAD_REQUEST: 'That request is not valid.',
});

export class AlertActionError extends Error {
  constructor(nwisCode, message, cause) {
    super(message);
    this.name = 'AlertActionError';
    this.nwisCode = nwisCode;
    this.cause = cause;
  }

  /** The alert changed under us: callers should refetch. */
  get stale() {
    return this.nwisCode === 'NWIS_BAD_STATE' || this.nwisCode === 'NWIS_NOT_FOUND';
  }
}

/** Map a Supabase error ({code:'P0001', message:'NWIS_FORBIDDEN: ...'}) to a friendly error. */
export function mapAlertError(err) {
  if (err instanceof AlertActionError) return err;
  const raw = String(err?.message || '');
  const m = /NWIS_[A-Z_]+/.exec(raw);
  const code = m ? m[0] : null;
  if (code === 'NWIS_BAD_REQUEST') {
    const detail = raw.split(':').slice(1).join(':').trim();
    const text = detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.` : ALERT_ERROR_TEXT[code];
    return new AlertActionError(code, text, err);
  }
  if (code && ALERT_ERROR_TEXT[code]) return new AlertActionError(code, ALERT_ERROR_TEXT[code], err);
  return new AlertActionError('NWIS_UNKNOWN', 'Something went wrong. Please try again.', err);
}

async function callRpc(fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw mapAlertError(error);
  return data ?? null;
}

// ------------------------------------------------------------------ lifecycle RPCs (contract §7)
export const markAlertViewed = (id) => callRpc('mark_alert_viewed', { p_alert: id });
export const ackAlert = (id, note = null) => callRpc('ack_alert', { p_alert: id, p_note: note || null });
export const resolveAlert = (id, outcome, note = null) =>
  callRpc('resolve_alert', { p_alert: id, p_outcome: outcome, p_note: note || null });
export const dismissAlert = (id, reason) => callRpc('dismiss_alert', { p_alert: id, p_reason: reason });
export const rateAlert = (id, useful) => callRpc('rate_alert', { p_alert: id, p_useful: useful });

// ------------------------------------------------------------------ reads
/** Open alerts (v_open_alerts: all alert columns + well_name). RLS already limits rig engineers. */
export async function listOpenAlerts(profile) {
  let q = supabase.from('v_open_alerts').select('*');
  if (profile?.role === 'rig_engineer' && profile.assigned_wellbore_ids?.length) {
    q = q.in('wellbore_id', profile.assigned_wellbore_ids);
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Resolved / feedback alerts of one well (history). */
export async function listWellHistory(wellboreId) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('wellbore_id', wellboreId)
    .in('state', ['resolved', 'feedback'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** The current user's own view row for an alert (alert_views RLS: own rows), or null. */
export async function getMyAlertView(alertId) {
  const { data, error } = await supabase.from('alert_views').select('*').eq('alert_id', alertId);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** One alert by id (any state), or null. */
export async function getAlert(id) {
  const { data, error } = await supabase.from('alerts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

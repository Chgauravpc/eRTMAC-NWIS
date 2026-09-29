import { supabase } from '../supabase';

export async function markAlertViewed(id) {
  return supabase.rpc('mark_alert_viewed', { p_alert: id });
}

export async function ackAlert(id, note = null) {
  const { error } = await supabase.rpc('ack_alert', { p_alert: id, p_note: note });
  if (error) throw mapError(error);
}

export async function resolveAlert(id, outcome, note = null) {
  const { error } = await supabase.rpc('resolve_alert', { p_alert: id, p_outcome: outcome, p_note: note });
  if (error) throw mapError(error);
}

export async function dismissAlert(id, reason) {
  const { error } = await supabase.rpc('dismiss_alert', { p_alert: id, p_reason: reason });
  if (error) throw mapError(error);
}

export async function rateAlert(id, useful) {
  const { error } = await supabase.rpc('rate_alert', { p_alert: id, p_useful: useful });
  if (error) throw mapError(error);
}

function mapError(err) {
  const msg = err.message || '';
  if (msg.includes('NWIS_FORBIDDEN')) return new Error("You don't have permission for this.");
  if (msg.includes('NWIS_BAD_STATE')) return new Error("This alert has changed state. Please refresh.");
  return err;
}

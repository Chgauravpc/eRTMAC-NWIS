import { supabase } from '../supabase';

export async function fetchOpenAlerts(wellboreId) {
  let query = supabase.from('alerts').select('*').not('state', 'in', '("resolved","feedback")');
  if (wellboreId) query = query.eq('wellbore_id', wellboreId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function ackAlert(alertId, note) {
  const { data, error } = await supabase.rpc('ack_alert', { p_alert: alertId, p_note: note });
  if (error) throw error;
  return data;
}

export async function resolveAlert(alertId, outcome, note) {
  const { data, error } = await supabase.rpc('resolve_alert', { p_alert: alertId, p_outcome: outcome, p_note: note });
  if (error) throw error;
  return data;
}

export async function dismissAlert(alertId, reason) {
  const { data, error } = await supabase.rpc('dismiss_alert', { p_alert: alertId, p_reason: reason });
  if (error) throw error;
  return data;
}

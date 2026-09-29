import { supabase } from '../supabase';
import { api } from '../api';

/** stream_state row for a wellbore (contract §6), or null when the well has no stream. */
export async function getStreamState(wellboreId) {
  const { data, error } = await supabase.from('stream_state').select('*').eq('wellbore_id', wellboreId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** All stream_state rows visible to the user (one per wellbore). */
export async function listStreamStates() {
  const { data, error } = await supabase.from('stream_state').select('*');
  if (error) throw error;
  return data ?? [];
}

export const startStream = (wellboreId, { source = 'synthetic', speed = 1, start_md_m = null } = {}) =>
  api.post('/stream/start', { wellbore_id: wellboreId, source, speed, start_md_m });

export const stopStream = (wellboreId) => api.post('/stream/stop', { wellbore_id: wellboreId });

export const setStreamSpeed = (wellboreId, speed) => api.post('/stream/speed', { wellbore_id: wellboreId, speed });

/** Demo: stop sending samples for N seconds to show the "stream lost" rules. */
export const dropStream = (wellboreId, seconds = 45) => api.post('/stream/drop', { wellbore_id: wellboreId, seconds });

export const getHealth = () => api.get('/health');

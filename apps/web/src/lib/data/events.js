// Event and lesson data access (contract §6 events/lessons, §7 events_for_offsets).
import { supabase } from '../supabase';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** RPC events_for_offsets: events of the offsets within the radius (rejected excluded server-side). */
export async function getEventsForOffsets(wellboreId, radiusM, formations = null, limit = 200) {
  return unwrap(
    await supabase.rpc('events_for_offsets', {
      p_wellbore: wellboreId,
      p_radius_m: radiusM,
      p_formations: formations && formations.length ? formations : null,
      p_limit: limit,
    }),
  );
}

/** Events of one wellbore (popup counts by risk type). */
export async function getWellEvents(wellboreId) {
  return unwrap(
    await supabase
      .from('events')
      .select('id,event_type,risk_type,formation,npt_h')
      .eq('wellbore_id', wellboreId)
      .neq('review_status', 'rejected'),
  );
}

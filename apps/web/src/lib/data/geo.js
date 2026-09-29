// Spatial data access: offsets_within, trajectories, survey stations, position at MD (contract §7/§6).
import { supabase } from '../supabase';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** RPC offsets_within. Parameter names are the contract's (§7); p_md may be null. */
export async function getOffsets(wellboreId, radiusM, md = null, mode = 'surface') {
  return unwrap(
    await supabase.rpc('offsets_within', {
      p_wellbore: wellboreId,
      p_radius_m: radiusM,
      p_md: md ?? null,
      p_mode: mode,
    }),
  );
}

/** v_trajectory_geojson rows {wellbore_id, well_name, geojson}. */
export async function getTrajectories() {
  return unwrap(await supabase.from('v_trajectory_geojson').select('*'));
}

/** survey_stations for a set of wellbores (used to place the depth-mode markers). */
export async function getSurveyStations(wellboreIds) {
  if (!wellboreIds?.length) return [];
  return unwrap(
    await supabase
      .from('survey_stations')
      .select('wellbore_id,md_m,tvd_m,north_m,east_m')
      .in('wellbore_id', wellboreIds)
      .order('md_m', { ascending: true }),
  );
}

/** RPC well_position_at_md -> {lon, lat, tvd_m} or null. */
export async function getWellPositionAtMd(wellboreId, md) {
  const rows = unwrap(await supabase.rpc('well_position_at_md', { p_wellbore: wellboreId, p_md: md }));
  return rows?.[0] ?? null;
}

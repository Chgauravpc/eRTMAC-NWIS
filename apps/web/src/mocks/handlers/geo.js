// Mock handlers: geo domain (see handlers/index.js).
// v_trajectory_geojson, survey_stations, RPC well_position_at_md / offsets_within / events_for_offsets.
import { http, HttpResponse } from 'msw';
import { db } from '../db';
import trajectoryData from '../fixtures/trajectories.json';
import eventsData from '../fixtures/events.json';
import { SUPABASE_URL, tableHandler } from './wells';

const REST = `${SUPABASE_URL}/rest/v1`;
const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

const surveyRows = trajectoryData.flatMap((t) =>
  t.rows.map((r) => Object.fromEntries([['wellbore_id', t.wellbore_id], ...t.columns.map((c, i) => [c, r[i]])])),
);
const stationsOf = (id) => surveyRows.filter((s) => s.wellbore_id === id);
const wellOf = (id) => db.wells.find((w) => w.wellbore_id === id);

/** Local metres east/north of a reference lon/lat (equirectangular, fine at field scale). */
function localXY(lon, lat, ref) {
  return { x: (lon - ref.lon) * M_PER_DEG * Math.cos(ref.lat * RAD), y: (lat - ref.lat) * M_PER_DEG };
}

export function surfaceDistance(a, b) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Linear interpolation of the survey at md (clamped): {tvd, north, east}. */
export function interpAtMd(stations, md) {
  if (!stations.length) return null;
  if (md <= stations[0].md_m) return stations[0];
  const last = stations[stations.length - 1];
  if (md >= last.md_m) return last;
  const i = stations.findIndex((s) => s.md_m >= md);
  const a = stations[i - 1], b = stations[i];
  const f = (md - a.md_m) / (b.md_m - a.md_m);
  const mix = (k) => a[k] + (b[k] - a[k]) * f;
  return { md_m: md, tvd_m: mix('tvd_m'), north_m: mix('north_m'), east_m: mix('east_m') };
}

function toLonLat(surface, north, east) {
  const lat = surface.lat + north / M_PER_DEG;
  const lon = surface.lon + east / (M_PER_DEG * Math.cos(surface.lat * RAD));
  return { lon, lat };
}

export function positionAtMd(wellboreId, md) {
  const w = wellOf(wellboreId);
  const p = w && interpAtMd(stationsOf(wellboreId), md);
  if (!p) return [];
  return [{ ...toLonLat(w, p.north_m, p.east_m), tvd_m: p.tvd_m }];
}

/** Contract §7 offsets_within. */
export function offsetsWithin(wellboreId, radiusM, md = null, mode = 'surface') {
  const active = wellOf(wellboreId);
  if (!active) return [];
  const aStations = stationsOf(wellboreId);
  const aPos = md != null ? interpAtMd(aStations, md) : null;
  const useDepth = mode === 'depth' && md != null;
  const rows = db.wells
    .filter((w) => w.wellbore_id !== wellboreId)
    .map((w) => {
      const surface = surfaceDistance(active, w);
      let depth = null;
      if (aPos) {
        // 3D distance to the offset at the MD whose TVD is closest to the active TVD
        const s = stationsOf(w.wellbore_id);
        let best = null;
        for (let m = 0; m <= s[s.length - 1].md_m; m += 5) {
          const p = interpAtMd(s, m);
          const d = Math.abs(p.tvd_m - aPos.tvd_m);
          if (!best || d < best.d) best = { d, p };
        }
        const off = localXY(w.lon, w.lat, active);
        const dx = off.x + best.p.east_m - aPos.east_m;
        const dy = off.y + best.p.north_m - aPos.north_m;
        const dz = best.p.tvd_m - aPos.tvd_m;
        depth = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      return {
        wellbore_id: w.wellbore_id,
        well_id: w.well_id,
        well_name: w.well_name,
        field: w.field,
        provenance: w.provenance,
        lon: w.lon,
        lat: w.lat,
        surface_distance_m: Math.round(surface * 10) / 10,
        depth_distance_m: depth == null ? null : Math.round(depth * 10) / 10,
        event_count: eventsData.filter((e) => e.wellbore_id === w.wellbore_id && e.review_status !== 'rejected').length,
      };
    });
  const key = useDepth ? 'depth_distance_m' : 'surface_distance_m';
  return rows.filter((r) => r[key] <= radiusM).sort((a, b) => a[key] - b[key]);
}

const geojsonRows = trajectoryData.map((t) => {
  const w = wellOf(t.wellbore_id);
  return {
    wellbore_id: t.wellbore_id,
    well_name: t.well_name,
    geojson: {
      type: 'LineString',
      coordinates: stationsOf(t.wellbore_id).map((s) => {
        const p = toLonLat(w, s.north_m, s.east_m);
        return [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6];
      }),
    },
  };
});

export const handlers = [
  tableHandler('v_trajectory_geojson', () => geojsonRows),
  tableHandler('survey_stations', () => surveyRows),

  http.post(`${REST}/rpc/well_position_at_md`, async ({ request }) => {
    const { p_wellbore, p_md } = await request.json();
    return HttpResponse.json(positionAtMd(p_wellbore, p_md));
  }),

  http.post(`${REST}/rpc/offsets_within`, async ({ request }) => {
    const { p_wellbore, p_radius_m, p_md = null, p_mode = 'surface' } = await request.json();
    return HttpResponse.json(offsetsWithin(p_wellbore, p_radius_m, p_md, p_mode));
  }),

  http.post(`${REST}/rpc/events_for_offsets`, async ({ request }) => {
    const { p_wellbore, p_radius_m, p_formations = null, p_limit = 200 } = await request.json();
    const offs = offsetsWithin(p_wellbore, p_radius_m);
    const rows = offs.flatMap((o) =>
      eventsData
        .filter((e) => e.wellbore_id === o.wellbore_id && e.review_status !== 'rejected' && (!p_formations || p_formations.includes(e.formation)))
        .map((e) => ({ ...e, well_name: o.well_name, surface_distance_m: o.surface_distance_m })),
    );
    return HttpResponse.json(rows.slice(0, p_limit));
  }),
];

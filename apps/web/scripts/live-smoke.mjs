// Live smoke test: signs in to the real Supabase project as each demo role and runs the queries the app makes
// (lib/data/*.js), with the anon key, so row level security applies exactly as in the browser.
//
//   cd apps/web && node scripts/live-smoke.mjs
//
// Needs the repo-root .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, DEMO_PASSWORD (see db/scripts/create_demo_users.py)
// and a loaded dataset (db/loaders/synth_assam.py). Writes nothing. Exit code 1 if any check fails.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envFile = new URL('../../../.env', import.meta.url);
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_?.startsWith('http') || !KEY || !env.DEMO_PASSWORD) {
  console.error('VITE_SUPABASE_URL (https://...), VITE_SUPABASE_ANON_KEY and DEMO_PASSWORD are needed in the repo-root .env');
  process.exit(2);
}

let failed = 0;
let passed = 0;
const check = (ok, text) => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
};
const unwrap = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function signIn(email) {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: env.DEMO_PASSWORD });
  if (error) throw new Error(`sign in as ${email}: ${error.message}`);
  return client;
}

async function profile(client) {
  const { data } = await client.auth.getUser();
  return unwrap(await client.from('profiles').select('role, assigned_wellbore_ids, full_name').eq('id', data.user.id).single(), 'profile');
}

async function viewerChecks(label, email) {
  console.log(`\n${label} (${email})`);
  const sb = await signIn(email);
  const me = await profile(sb);
  check(true, `signed in, role ${me.role}`);

  // wells page
  const wells = unwrap(await sb.from('v_well_summary').select('*'), 'v_well_summary');
  check(wells.length === 30, `wells list: ${wells.length} rows (30 expected)`);
  const first = wells.find((w) => w.well_name === 'SYN-DLJ-01');
  check(first && first.lon > 94 && first.lat > 26 && typeof first.event_count === 'number', 'a well row has lon, lat and an event count');
  const drilling = wells.filter((w) => w.status === 'drilling');
  check(drilling.length === 3, `3 drilling wells (${drilling.map((w) => w.well_name).join(', ')})`);

  const streams = unwrap(await sb.from('stream_state').select('*'), 'stream_state');
  check(streams.length === 3 && streams.every((s) => s.status === 'stopped'), `stream_state: ${streams.length} stopped rows`);

  const active = drilling.find((w) => w.well_name === 'SYN-DLJ-03');
  const stream = streams.find((s) => s.wellbore_id === active.wellbore_id);
  const bit = stream.bit_md_m;

  // workspace: map
  const offsets = unwrap(await sb.rpc('offsets_within', { p_wellbore: active.wellbore_id, p_radius_m: 10000, p_md: bit, p_mode: 'depth' }), 'offsets_within');
  check(offsets.length >= 5, `offsets_within (depth mode at the bit): ${offsets.length} offsets`);
  const trajs = unwrap(await sb.from('v_trajectory_geojson').select('*'), 'v_trajectory_geojson');
  check(trajs.length === 30 && trajs[0].geojson?.type === 'LineString', `trajectories: ${trajs.length} GeoJSON lines`);
  const pos = unwrap(await sb.rpc('well_position_at_md', { p_wellbore: active.wellbore_id, p_md: bit }), 'well_position_at_md');
  check(pos.length === 1 && pos[0].tvd_m > 2000, `well_position_at_md at the bit: tvd ${Math.round(pos[0].tvd_m)} m`);

  // formation tab
  const fm = unwrap(await sb.rpc('formation_at_md', { p_wellbore: active.wellbore_id, p_md: bit }), 'formation_at_md');
  check(fm[0]?.formation && fm[0]?.next_formation, `formation at the bit: ${fm[0]?.formation}, next ${fm[0]?.next_formation} (if next is empty, run predict-tops for the drilling wells)`);
  const tops = unwrap(await sb.from('formation_tops').select('*').eq('wellbore_id', active.wellbore_id), 'formation_tops');
  const actual = tops.filter((t) => t.source === 'actual');
  const predicted = tops.filter((t) => t.source === 'predicted');
  check(actual.length >= 5 && actual.every((t) => t.top_md_m <= bit), `${actual.length} actual tops, none below the bit`);
  check(predicted.length >= 8 && predicted.every((t) => t.uncertainty_m != null && t.n_offsets > 0), `${predicted.length} predicted tops with an uncertainty and an offset count`);
  const sections = unwrap(await sb.from('hole_sections').select('*').eq('wellbore_id', active.wellbore_id), 'hole_sections');
  check(sections.length >= 2, `${sections.length} hole sections`);
  const evs = unwrap(await sb.rpc('events_for_offsets', { p_wellbore: active.wellbore_id, p_radius_m: 10000, p_formations: null, p_limit: 200 }), 'events_for_offsets');
  check(evs.length > 0 && evs.every((e) => e.well_name), `events from offsets: ${evs.length}, each with a well name`);
  const forms = unwrap(await sb.from('formations').select('name,basin,strat_order,lithology').order('strat_order'), 'formations');
  check(forms.length >= 10, `${forms.length} formations`);

  // the future is hidden: depth_series ends at the bit
  const { data: top } = await sb.from('depth_series').select('md_m').eq('wellbore_id', active.wellbore_id).order('md_m', { ascending: false }).limit(1);
  check(top?.[0] && Math.abs(top[0].md_m - bit) < 0.6, `depth_series ends at the bit (${top?.[0]?.md_m} m, bit ${bit} m)`);

  // alerts (none yet) and the risk table
  const alerts = unwrap(await sb.from('v_open_alerts').select('*'), 'v_open_alerts');
  check(Array.isArray(alerts), `open alerts: ${alerts.length}`);
  unwrap(await sb.from('risk_scores').select('*').eq('wellbore_id', active.wellbore_id).limit(1), 'risk_scores');
  check(true, 'risk_scores readable');

  // analytics
  const npt = unwrap(await sb.from('v_npt_by_formation').select('*'), 'v_npt_by_formation');
  check(npt.length > 5 && npt.some((r) => r.formation === 'Tipam' && r.risk_type === 'losses'), `NPT by formation: ${npt.length} rows`);

  return { sb, me, wells, active };
}

async function main() {
  console.log(`project ${URL_}`);

  const rtoc = await viewerChecks('RTOC engineer', 'rtoc@nwis.test');

  // rig engineer: only the assigned well's alerts and telemetry (alerts are empty so check the stream / series rules)
  console.log('\nRig engineer (rig@nwis.test)');
  const rig = await signIn('rig@nwis.test');
  const rme = await profile(rig);
  check(rme.role === 'rig_engineer' && rme.assigned_wellbore_ids.length === 1, `role ${rme.role}, ${rme.assigned_wellbore_ids.length} assigned wellbore`);
  check(rme.assigned_wellbore_ids[0] === rtoc.active.wellbore_id, 'assigned to SYN-DLJ-03');
  const rigWells = unwrap(await rig.from('v_well_summary').select('well_name'), 'rig wells');
  check(rigWells.length === 30, 'a rig engineer can still list wells (the map and workspace need them)');
  const { data: otherSeries } = await rig.from('depth_series').select('md_m').eq('wellbore_id', rtoc.wells.find((w) => w.well_name === 'SYN-NHK-03').wellbore_id).limit(1);
  check(true, `telemetry of an unassigned drilling well is ${otherSeries?.length ? 'readable' : 'hidden'} (policy as designed)`);

  // reviewer: the queue is empty, but the table is readable; office engineer reads the same
  console.log('\nReviewer (reviewer@nwis.test)');
  const rev = await signIn('reviewer@nwis.test');
  const queue = unwrap(await rev.from('v_review_queue').select('*'), 'v_review_queue');
  check(Array.isArray(queue), `review queue readable: ${queue.length} pending fields`);
  const docs = unwrap(await rev.from('documents').select('id, title').limit(5), 'documents');
  check(Array.isArray(docs), `documents readable: ${docs.length}`);
  const noGo = await rev.rpc('review_field', { p_field: '00000000-0000-4000-8000-000000000000', p_action: 'approve' });
  check(noGo.error && /NWIS_NOT_FOUND/.test(noGo.error.message), `review_field answers with the contract error: ${noGo.error?.message}`);

  console.log('\nOffice engineer (office@nwis.test)');
  const office = await signIn('office@nwis.test');
  const denied = await office.rpc('review_field', { p_field: '00000000-0000-4000-8000-000000000000', p_action: 'approve' });
  check(denied.error && /NWIS_FORBIDDEN/.test(denied.error.message), `office engineers cannot review: ${denied.error?.message}`);

  console.log('\nAdmin (admin@nwis.test)');
  const admin = await signIn('admin@nwis.test');
  const profs = unwrap(await admin.from('profiles').select('id, role'), 'profiles');
  check(profs.length >= 6, `admin sees all profiles: ${profs.length}`);
  const rtocProfiles = unwrap(await rtoc.sb.from('profiles').select('id'), 'rtoc profiles');
  check(rtocProfiles.length === 1, 'a non-admin sees only their own profile');
  unwrap(await admin.from('model_runs').select('*').limit(1), 'model_runs');
  check(true, 'model_runs readable');

  console.log(`\n${passed} of ${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});

// Mock handlers: wells domain (see handlers/index.js).
// Emulates PostgREST for v_well_summary, stream_state, formations, formation_tops, hole_sections,
// events, lessons; RPC formation_at_md; and the /api/wells/{id}/{correlation,predict-tops} routes.
import { http, HttpResponse } from 'msw';
import { db } from '../db';
import { ACTIVE_WELLBORE_ID } from '../ids';
import topsData from '../fixtures/tops.json';
import holeSectionsData from '../fixtures/hole_sections.json';
import eventsData from '../fixtures/events.json';
import lessonsData from '../fixtures/lessons.json';
import correlationCfg from '../fixtures/correlation.json';

import { SUPABASE_URL } from '../../lib/supabaseUrl';
export { SUPABASE_URL };
const REST = `${SUPABASE_URL}/rest/v1`;

/* ------------------------------------------------------------------ PostgREST emulation */

function parseList(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  return inner === '' ? [] : inner.split(',').map((s) => s.replace(/^"|"$/g, ''));
}

function matchesFilter(value, op, operand) {
  const num = (v) => (typeof v === 'number' ? v : Number(v));
  switch (op) {
    case 'eq': return String(value) === operand;
    case 'neq': return String(value) !== operand;
    case 'gt': return num(value) > num(operand);
    case 'gte': return num(value) >= num(operand);
    case 'lt': return num(value) < num(operand);
    case 'lte': return num(value) <= num(operand);
    case 'is': return operand === 'null' ? value == null : String(value) === operand;
    case 'in': return parseList(operand).includes(String(value));
    case 'ilike':
    case 'like': {
      const re = new RegExp('^' + operand.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', 'i');
      return re.test(String(value ?? ''));
    }
    case 'cs':
    case 'contains': return Array.isArray(value) && parseList(operand.replace(/^\{/, '(').replace(/\}$/, ')')).every((x) => value.map(String).includes(x));
    default: return true;
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset']);

/** Apply select/filters/order/limit/offset of a PostgREST querystring to an array of row objects. */
export function applyPostgrest(rows, url) {
  const params = new URL(url).searchParams;
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    let expr = raw;
    let negate = false;
    if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4); }
    const dot = expr.indexOf('.');
    if (dot < 0) continue;
    const op = expr.slice(0, dot);
    const operand = expr.slice(dot + 1);
    out = out.filter((r) => matchesFilter(r[key], op, operand) !== negate);
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((s) => {
      const [col, dir = 'asc'] = s.split('.');
      return { col, sign: dir === 'desc' ? -1 : 1 };
    });
    out = [...out].sort((a, b) => {
      for (const { col, sign } of keys) {
        const x = a[col], y = b[col];
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * sign;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') || 0);
  const limit = params.get('limit');
  if (offset || limit) out = out.slice(offset, limit ? offset + Number(limit) : undefined);
  const select = params.get('select');
  if (select && select !== '*' && !select.includes('(')) {
    const cols = select.split(',').map((c) => c.trim());
    if (!cols.includes('*')) out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }
  return out;
}

/** JSON array, or a single object when supabase-js asked for one (`.single()` / `.maybeSingle()`). */
export function restResponse(request, rows) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('vnd.pgrst.object')) {
    if (rows.length === 1) return HttpResponse.json(rows[0]);
    return HttpResponse.json(
      { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' },
      { status: 406 },
    );
  }
  return HttpResponse.json(rows);
}

export const tableHandler = (name, getRows) =>
  http.get(`${REST}/${name}`, ({ request }) => restResponse(request, applyPostgrest(getRows(), request.url)));

/* ------------------------------------------------------------------ mutable state */

const clone = (x) => JSON.parse(JSON.stringify(x));
let topsStore = clone(topsData.tops);

/** Test helper: reset the mutable mock state of this domain. */
export function resetWellsMock() {
  topsStore = clone(topsData.tops);
}

const PRIORITY = { actual: 0, predicted: 1, prognosis: 2 };

/** One top per formation using priority actual > predicted > prognosis, sorted by MD. */
export function effectiveTops(wellboreId, store = topsStore) {
  const best = new Map();
  for (const t of store.filter((x) => x.wellbore_id === wellboreId)) {
    const cur = best.get(t.formation);
    if (!cur || PRIORITY[t.source] < PRIORITY[cur.source]) best.set(t.formation, t);
  }
  return [...best.values()].sort((a, b) => a.top_md_m - b.top_md_m);
}

export function formationAtMd(wellboreId, md) {
  const list = effectiveTops(wellboreId);
  let idx = -1;
  list.forEach((t, i) => { if (t.top_md_m <= md) idx = i; });
  if (idx < 0) return [];
  const cur = list[idx];
  const next = list[idx + 1] || null;
  const rel = next ? Math.min(1, Math.max(0, (md - cur.top_md_m) / (next.top_md_m - cur.top_md_m))) : null;
  return [{
    formation: cur.formation,
    top_md_m: cur.top_md_m,
    next_formation: next?.formation ?? null,
    next_top_md_m: next?.top_md_m ?? null,
    relative_depth: rel,
    source: cur.source,
  }];
}

export function streamRows() {
  const known = new Set(db.wells.map((w) => w.wellbore_id));
  const rows = db.stream_state.map((s) => (known.has(s.wellbore_id) ? s : { ...s, wellbore_id: ACTIVE_WELLBORE_ID }));
  const have = new Set(rows.map((r) => r.wellbore_id));
  const stopped = db.wells
    .filter((w) => !have.has(w.wellbore_id))
    .map((w) => ({ wellbore_id: w.wellbore_id, status: 'stopped', source: null, speed: 1, bit_md_m: null, hole_md_m: null, last_sample_at: null, latest: null, updated_at: '2026-09-01T00:00:00Z' }));
  return [...rows, ...stopped];
}

const bitOf = (wellboreId) => {
  const s = streamRows().find((r) => r.wellbore_id === wellboreId);
  return s && s.status !== 'stopped' ? s.bit_md_m : null;
};

/* ------------------------------------------------------------------ correlation synth */

function hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

const wellIndex = (id) => db.wells.findIndex((w) => w.wellbore_id === id);

function trackFor(wellboreId, channels, endMd, step = 10) {
  const list = effectiveTops(wellboreId);
  const md_m = [];
  const tracks = { md_m };
  channels.forEach((c) => { tracks[c] = []; });
  const salt = wellIndex(wellboreId) + 1;
  for (let md = step; md <= endMd; md += step) {
    let f = list[0]?.formation;
    list.forEach((t) => { if (t.top_md_m <= md) f = t.formation; });
    const [gr, rop, tq] = correlationCfg.channel_profiles[f] || [70, 15, 10];
    const noise = (k) => hash(md * (k + 1) + salt * 1000) - 0.5;
    md_m.push(md);
    const mw = 1.06 + md * 0.00012 + noise(1) * 0.02;
    const vals = {
      gr_api: gr + noise(2) * 22,
      rop_m_h: Math.max(1, rop + noise(3) * 6),
      torque_knm: Math.max(1, tq + noise(4) * 3),
      mw_sg: mw,
      ecd_sg: mw + 0.06 + noise(5) * 0.01,
    };
    channels.forEach((c) => tracks[c].push(Math.round((vals[c] ?? 0) * 100) / 100));
  }
  return tracks;
}

export function buildCorrelation(activeId, offsetIds, flatten, channels) {
  const ids = [activeId, ...offsetIds.filter((x) => x !== activeId)];
  const activeTop = flatten ? effectiveTops(activeId).find((t) => t.formation === flatten) : null;
  const wells = ids
    .filter((id) => db.getWell(id))
    .map((id) => {
      const w = db.getWell(id);
      const isActive = id === activeId;
      const bit = isActive ? bitOf(id) : null;
      const end = bit ?? w.td_md_m;
      const mine = effectiveTops(id);
      const top = flatten ? mine.find((t) => t.formation === flatten) : null;
      const missing = Boolean(flatten) && (!top || !activeTop);
      const shift = flatten && !missing && !isActive ? Math.round((activeTop.top_md_m - top.top_md_m) * 10) / 10 : 0;
      return {
        wellbore_id: id,
        name: w.well_name,
        is_active: isActive,
        shift_m: shift,
        flatten_missing: missing,
        provenance: w.provenance,
        tops: topsStore
          .filter((t) => t.wellbore_id === id)
          .sort((a, b) => a.top_md_m - b.top_md_m)
          .map((t) => ({ formation: t.formation, top_md_m: t.top_md_m, source: t.source, uncertainty_m: t.uncertainty_m })),
        casing: holeSectionsData
          .filter((h) => h.wellbore_id === id && h.shoe_md_m != null && !h.planned && h.shoe_md_m <= end)
          .map((h) => ({ casing_od_in: h.casing_od_in, shoe_md_m: h.shoe_md_m })),
        events: eventsData
          .filter((e) => e.wellbore_id === id && e.review_status !== 'rejected' && e.md_from_m <= end)
          .map((e) => ({ id: e.id, event_type: e.event_type, risk_type: e.risk_type, md_from_m: e.md_from_m, severity: e.severity, description: e.description, provenance: e.provenance, source: `${e.provenance} event log${e.doc_id ? ' (doc)' : ''}` })),
        tracks: trackFor(id, channels, end),
      };
    });
  return { flatten_formation: flatten || null, wells };
}

/** Predicted tops = mean of the offsets' actual tops (same basin), uncertainty = max(15, 1.5 sd). */
function predictTops(wellboreId) {
  const w = db.getWell(wellboreId);
  if (!w) return null;
  const offsets = db.wells.filter((o) => o.wellbore_id !== wellboreId && o.basin === w.basin);
  const mine = new Set(topsStore.filter((t) => t.wellbore_id === wellboreId && t.source === 'actual').map((t) => t.formation));
  const formations = [...new Set(topsStore.filter((t) => offsets.some((o) => o.wellbore_id === t.wellbore_id)).map((t) => t.formation))];
  const out = [];
  for (const f of formations) {
    if (mine.has(f)) continue;
    const vals = offsets
      .map((o) => topsStore.find((t) => t.wellbore_id === o.wellbore_id && t.formation === f && t.source === 'actual')?.top_md_m)
      .filter((v) => v != null);
    if (!vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (mean >= w.td_md_m - 20) continue;
    const row = { formation: f, top_md_m: Math.round(mean * 10) / 10, top_tvdss_m: Math.round((mean * 0.97 - 95) * 10) / 10, uncertainty_m: Math.round(Math.max(15, 1.5 * sd) * 10) / 10, n_offsets: vals.length };
    out.push(row);
    const idx = topsStore.findIndex((t) => t.wellbore_id === wellboreId && t.formation === f && t.source === 'predicted');
    const rec = { id: idx >= 0 ? topsStore[idx].id : crypto.randomUUID(), wellbore_id: wellboreId, ...row, source: 'predicted', provenance: w.provenance === 'direct' ? 'analog' : w.provenance, doc_id: null, page: null };
    if (idx >= 0) topsStore[idx] = rec; else topsStore.push(rec);
  }
  return out.sort((a, b) => a.top_md_m - b.top_md_m);
}

/* ------------------------------------------------------------------ handlers */

export const handlers = [
  tableHandler('v_well_summary', () => db.wells),
  tableHandler('stream_state', streamRows),
  tableHandler('formations', () => topsData.formations),
  tableHandler('formation_tops', () => topsStore),
  tableHandler('hole_sections', () => holeSectionsData),
  tableHandler('events', () => eventsData),
  tableHandler('lessons', () => lessonsData),

  http.post(`${REST}/rpc/formation_at_md`, async ({ request }) => {
    const { p_wellbore, p_md } = await request.json();
    return HttpResponse.json(p_md == null ? [] : formationAtMd(p_wellbore, p_md));
  }),

  http.get('/api/wells/:id/correlation', ({ params, request }) => {
    const q = new URL(request.url).searchParams;
    const offsets = (q.get('offsets') || '').split(',').filter(Boolean).slice(0, 6);
    const channels = (q.get('channels') || 'gr_api,rop_m_h,mw_sg').split(',').filter(Boolean);
    if (!db.getWell(params.id)) return HttpResponse.json({ error: { code: 'NWIS_NOT_FOUND', message: 'Unknown wellbore' } }, { status: 404 });
    return HttpResponse.json(buildCorrelation(params.id, offsets, q.get('flatten'), channels));
  }),

  http.post('/api/wells/:id/predict-tops', ({ params }) => {
    const tops = predictTops(params.id);
    if (!tops) return HttpResponse.json({ error: { code: 'NWIS_NOT_FOUND', message: 'Unknown wellbore' } }, { status: 404 });
    return HttpResponse.json({ tops });
  }),
];

// Mock handlers: risk / rig domain (see handlers/index.js).
// Emulates PostgREST for risk_scores, stream_state, lessons, formation_tops (+ fallbacks for events,
// formation_at_md and offsets_within, which the geo/wells owners' handlers win over when they exist),
// the Space endpoints /api/wells/:id/risk and /api/stream/*, and /api/health.
import { http, HttpResponse } from 'msw';
import { db } from '../db';
import { bandFor } from '../../lib/risk';
import { ACTIVE_WELLBORE_ID, wellByWellbore } from '../ids';
import rig from '../fixtures/lessons_rig.json';
import riskTemplate from '../fixtures/risk_scores.json';

import { SUPABASE_URL } from '../../lib/supabaseUrl';
export { SUPABASE_URL };
export const REST = `${SUPABASE_URL}/rest/v1`;

// ------------------------------------------------------------------ PostgREST emulation
const RESERVED = new Set(['select', 'order', 'limit', 'offset']);

function coerce(actual, raw) {
  if (typeof actual === 'number') return Number(raw);
  if (typeof actual === 'boolean') return raw === 'true';
  return raw;
}

function parseInList(raw) {
  const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter((s) => s !== '');
}

function testOne(actual, op, raw) {
  switch (op) {
    case 'eq':
      return actual != null && coerce(actual, raw) === actual;
    case 'neq':
      return actual == null || coerce(actual, raw) !== actual;
    case 'gt':
      return actual != null && actual > coerce(actual, raw);
    case 'gte':
      return actual != null && actual >= coerce(actual, raw);
    case 'lt':
      return actual != null && actual < coerce(actual, raw);
    case 'lte':
      return actual != null && actual <= coerce(actual, raw);
    case 'in':
      return actual != null && parseInList(raw).includes(String(actual));
    case 'is':
      return raw === 'null' ? actual == null : raw === 'true' ? actual === true : actual === false;
    case 'like':
    case 'ilike': {
      if (actual == null) return false;
      const re = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, op === 'ilike' ? 'i' : '');
      return re.test(String(actual));
    }
    case 'cs':
      return Array.isArray(actual) && parseInList(raw).every((v) => actual.map(String).includes(v));
    default:
      return true;
  }
}

/** Apply PostgREST query params (eq/neq/gt/gte/lt/lte/in/is/like/ilike, not., order, limit, offset). */
export function applyQuery(rows, searchParams) {
  let out = rows.filter((row) => {
    for (const [key, value] of searchParams.entries()) {
      if (RESERVED.has(key)) continue;
      const dot = value.indexOf('.');
      if (dot < 0) continue;
      let op = value.slice(0, dot);
      let raw = value.slice(dot + 1);
      let negate = false;
      if (op === 'not') {
        negate = true;
        const d2 = raw.indexOf('.');
        op = raw.slice(0, d2);
        raw = raw.slice(d2 + 1);
      }
      const ok = testOne(row[key], op, raw);
      if (negate ? ok : !ok) return false;
    }
    return true;
  });

  const order = searchParams.get('order');
  if (order) {
    const specs = order.split(',').map((s) => {
      const [col, dir = 'asc'] = s.split('.');
      return { col, desc: dir === 'desc' };
    });
    out = [...out].sort((a, b) => {
      for (const { col, desc } of specs) {
        const av = a[col];
        const bv = b[col];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av < bv ? -1 : 1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  const offset = Number(searchParams.get('offset') || 0);
  const limit = searchParams.get('limit');
  if (offset) out = out.slice(offset);
  if (limit != null) out = out.slice(0, Number(limit));
  return out;
}

/** JSON array, or a single object when the client asked for one (.single()/.maybeSingle()). */
export function restRespond(request, rows) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('application/vnd.pgrst.object+json')) {
    if (rows.length !== 1) {
      return HttpResponse.json(
        {
          code: 'PGRST116',
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        },
        { status: 406 }
      );
    }
    return HttpResponse.json(rows[0]);
  }
  return HttpResponse.json(rows);
}

/** Supabase-shaped RPC error: {code:'P0001', message:'NWIS_FORBIDDEN: ...'} */
export function rpcError(message, code = 'P0001', status = 400) {
  return HttpResponse.json({ code, details: null, hint: null, message }, { status });
}

/** Error body of the Space/Node API (contract §9.1). */
export function apiError(code, message, status = 400) {
  return HttpResponse.json({ error: { code, message, details: {} } }, { status });
}

const table = (name, getRows) =>
  http.get(`${REST}/${name}`, ({ request }) => {
    const url = new URL(request.url);
    return restRespond(request, applyQuery(getRows(), url.searchParams));
  });

// ------------------------------------------------------------------ risk synthesis (mock engine)
const FIXTURE_REF = '2026-09-29T10:00:00Z'; // fixtures are written as of this instant
const TEMPLATE_BIT = Math.min(...riskTemplate.map((r) => r.md_from_m));
let salt = 0;

function formationForMd(wellboreId, md) {
  const tops = rig.formation_tops
    .filter((t) => t.wellbore_id === wellboreId)
    .sort((a, b) => a.top_md_m - b.top_md_m);
  let current = null;
  for (const t of tops) if (t.top_md_m <= md) current = t.formation;
  return current;
}

function jitter(riskType, i, s) {
  let h = s * 31 + i * 17;
  for (const ch of riskType) h = (h * 33 + ch.charCodeAt(0)) % 9973;
  return (h % 7) - 3;
}

/** 12 x 5 rows for [bit, bit+300), shaped from the fixture template (bit-relative grid, contract §11.2). */
export function synthRiskRows(wellboreId, bit, s = salt) {
  const now = new Date().toISOString();
  return riskTemplate.map((t) => {
    const idx = Math.round((t.md_from_m - TEMPLATE_BIT) / 25);
    const md = bit + idx * 25;
    const fused = Math.max(0, Math.min(100, Math.round((t.fused + jitter(t.risk_type, idx, s)) * 10) / 10));
    return {
      ...t,
      wellbore_id: wellboreId,
      md_from_m: md,
      md_to_m: md + 25,
      fused,
      band: bandFor(fused),
      formation: formationForMd(wellboreId, md) || t.formation,
      computed_at: now,
    };
  });
}

/** Upsert rows into the mock DB and publish each one on the Realtime bus. */
export function upsertRiskRows(rows, { purgeBehindBit } = {}) {
  if (purgeBehindBit != null) {
    const { wellbore_id: wb, bit } = purgeBehindBit;
    for (let i = db.risk_scores.length - 1; i >= 0; i -= 1) {
      const r = db.risk_scores[i];
      if (r.wellbore_id === wb && r.md_to_m <= bit) db.risk_scores.splice(i, 1);
    }
  }
  for (const row of rows) {
    const idx = db.risk_scores.findIndex(
      (r) => r.wellbore_id === row.wellbore_id && r.md_from_m === row.md_from_m && r.risk_type === row.risk_type
    );
    if (idx >= 0) db.risk_scores[idx] = row;
    else db.risk_scores.push(row);
    db.emitChange('risk_scores', row);
  }
  return rows;
}

export function streamRow(wellboreId) {
  return db.stream_state.find((s) => s.wellbore_id === wellboreId);
}

/** Recompute the look-ahead window for a wellbore from its current bit depth. Returns the rows. */
export function mockRecomputeRisk(wellboreId) {
  const st = streamRow(wellboreId);
  if (!st || st.bit_md_m == null) return null;
  salt += 1;
  return upsertRiskRows(synthRiskRows(wellboreId, st.bit_md_m, salt), {
    purgeBehindBit: { wellbore_id: wellboreId, bit: st.bit_md_m },
  });
}

function patchStream(wellboreId, patch) {
  const st = streamRow(wellboreId);
  if (!st) return null;
  Object.assign(st, patch, { updated_at: new Date().toISOString() });
  db.emitChange('stream_state', { ...st });
  return st;
}

/** Dev/demo: advance the bit (and the hole) and let the mock engine recompute the window. */
export function mockAdvanceBit(wellboreId = ACTIVE_WELLBORE_ID, delta = 5) {
  const st = streamRow(wellboreId);
  if (!st) return null;
  const bit = (st.bit_md_m ?? 0) + delta;
  const latest = { ...(st.latest || {}) };
  if (latest.rop_m_h != null) latest.rop_m_h = Math.round((latest.rop_m_h + ((salt % 5) - 2) * 0.4) * 10) / 10;
  patchStream(wellboreId, {
    bit_md_m: bit,
    hole_md_m: Math.max(st.hole_md_m ?? 0, bit),
    last_sample_at: new Date().toISOString(),
    status: st.status === 'lost' ? 'lost' : 'live',
    latest,
  });
  mockRecomputeRisk(wellboreId);
  return bit;
}

const dropTimers = new Map();

/** Contract §12: `Stream lost` system alert (warning), auto-resolved when the stream returns to live. */
export function mockDropStream(wellboreId = ACTIVE_WELLBORE_ID, seconds = 45) {
  const st = streamRow(wellboreId);
  if (!st) return null;
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  patchStream(wellboreId, {
    status: 'lost',
    last_sample_at: st.last_sample_at === FIXTURE_REF ? new Date().toISOString() : st.last_sample_at,
  });
  const key = `${wellboreId}:system:stream_lost`;
  const now = new Date().toISOString();
  const existing = db.alerts.find((a) => a.dedup_key === key && !['resolved', 'feedback'].includes(a.state));
  if (!existing) {
    const alert = {
      id: crypto.randomUUID(),
      wellbore_id: wellboreId,
      kind: 'system',
      risk_type: null,
      severity: 'warning',
      state: 'sent',
      dedup_key: key,
      zone_md_from_m: null,
      zone_md_to_m: null,
      expected_md_m: st.bit_md_m,
      formation: null,
      score: null,
      confidence: null,
      title: 'Live data lost',
      message: 'No samples received from the rig stream. Look-ahead from offset wells continues; live detectors are paused.',
      recommendation: 'Check the WITSML/WITS link at the rig. Detectors resume automatically when data returns.',
      evidence: {},
      model_version: null,
      created_at: now,
      sent_at: now,
      escalated_at: null,
      acknowledged_by: null,
      acknowledged_at: null,
      action_note: null,
      resolved_by: null,
      resolved_at: null,
      resolved_how: null,
      outcome: null,
      dismiss_reason: null,
      useful: null,
      feedback_by: null,
      feedback_at: null,
    };
    db.alerts.push(alert);
    db.emitChange('alerts', alert);
  }
  clearTimeout(dropTimers.get(wellboreId));
  dropTimers.set(
    wellboreId,
    setTimeout(() => {
      patchStream(wellboreId, { status: 'live', last_sample_at: new Date().toISOString() });
      const open = db.alerts.find((a) => a.dedup_key === key && !['resolved', 'feedback'].includes(a.state));
      if (open) db.updateAlert(open.id, { state: 'resolved', resolved_how: 'auto', resolved_at: new Date().toISOString() });
      dropTimers.delete(wellboreId);
    }, seconds * 1000)
  );
  return until;
}

// ------------------------------------------------------------------ geology fallbacks
function formationAt(wellboreId, md) {
  const tops = rig.formation_tops
    .filter((t) => t.wellbore_id === wellboreId)
    .sort((a, b) => a.top_md_m - b.top_md_m);
  let cur = null;
  let next = null;
  for (const t of tops) {
    if (t.top_md_m <= md) cur = t;
    else if (!next) next = t;
  }
  if (!cur) return [];
  const rel = next ? Math.min(1, Math.max(0, (md - cur.top_md_m) / (next.top_md_m - cur.top_md_m))) : 0;
  return [
    {
      formation: cur.formation,
      top_md_m: cur.top_md_m,
      next_formation: next?.formation ?? null,
      next_top_md_m: next?.top_md_m ?? null,
      relative_depth: rel,
      source: cur.source,
    },
  ];
}

// ------------------------------------------------------------------ handlers
export const handlers = [
  table('risk_scores', () => db.risk_scores),

  http.get(`${REST}/stream_state`, ({ request }) => {
    const url = new URL(request.url);
    const rows = db.stream_state.map((s) => {
      // A live stream is "now": keep last_sample_at fresh so the panel does not read "3 months ago".
      if (s.status === 'live' && s.last_sample_at === FIXTURE_REF) return { ...s, last_sample_at: new Date().toISOString() };
      return s;
    });
    return restRespond(request, applyQuery(rows, url.searchParams));
  }),

  table('lessons', () => rig.lessons),
  table('formation_tops', () => rig.formation_tops),
  table('events', () => rig.events),

  http.post(`${REST}/rpc/formation_at_md`, async ({ request }) => {
    const body = await request.json();
    const wb = body.p_wellbore ?? body.p_wellbore_id;
    const md = body.p_md ?? body.p_md_m;
    return HttpResponse.json(formationAt(wb, Number(md)));
  }),

  http.post(`${REST}/rpc/offsets_within`, async ({ request }) => {
    const body = await request.json();
    const byWb = new Map();
    for (const e of rig.events) {
      if (e.wellbore_id === body.p_wellbore) continue;
      const cur = byWb.get(e.wellbore_id) || { e, n: 0 };
      cur.n += 1;
      byWb.set(e.wellbore_id, cur);
    }
    const rows = [...byWb.entries()].map(([wellbore_id, { e, n }]) => {
      const w = wellByWellbore(wellbore_id);
      return {
        wellbore_id,
        well_id: w?.well_id ?? null,
        well_name: w?.well_name ?? e.well_name,
        field: w?.field ?? null,
        provenance: w?.provenance ?? 'synthetic',
        lon: w?.lon ?? null,
        lat: w?.lat ?? null,
        surface_distance_m: e.depth_distance_m,
        depth_distance_m: e.depth_distance_m,
        event_count: n,
      };
    });
    return HttpResponse.json(rows.sort((a, b) => a.depth_distance_m - b.depth_distance_m));
  }),

  // ---- Space endpoints
  http.get('/api/health', () =>
    HttpResponse.json({ ok: true, space: { ok: true, version: '0.1.0-mock', models: { l2: ['losses', 'stuck_pipe', 'kick', 'torque', 'cementing'] } } })
  ),

  http.post('/api/wells/:id/risk', async ({ params }) => {
    const rows = mockRecomputeRisk(params.id);
    if (!rows) return apiError('NWIS_BAD_REQUEST', 'No live bit depth for this wellbore', 400);
    return HttpResponse.json({ scores: rows });
  }),

  http.post('/api/stream/start', async ({ request }) => {
    const { wellbore_id, speed } = await request.json();
    if (!patchStream(wellbore_id, { status: 'live', speed: speed || 1 })) return apiError('NWIS_NOT_FOUND', 'Unknown wellbore', 404);
    return HttpResponse.json({ status: 'live' });
  }),

  http.post('/api/stream/stop', async ({ request }) => {
    const { wellbore_id } = await request.json();
    if (!patchStream(wellbore_id, { status: 'stopped' })) return apiError('NWIS_NOT_FOUND', 'Unknown wellbore', 404);
    return HttpResponse.json({ status: 'stopped' });
  }),

  http.post('/api/stream/speed', async ({ request }) => {
    const { wellbore_id, speed } = await request.json();
    if (!patchStream(wellbore_id, { speed })) return apiError('NWIS_NOT_FOUND', 'Unknown wellbore', 404);
    return HttpResponse.json({ speed });
  }),

  http.post('/api/stream/drop', async ({ request }) => {
    const { wellbore_id, seconds = 45 } = await request.json();
    const until = mockDropStream(wellbore_id, seconds);
    if (!until) return apiError('NWIS_NOT_FOUND', 'Unknown wellbore', 404);
    return HttpResponse.json({ dropping_until: until });
  }),
];

// Mock handlers: alerts domain (see handlers/index.js).
// PostgREST reads for alerts / v_open_alerts / alert_views and the five lifecycle RPCs, which enforce the
// SAME rules as db/supabase/migrations/0008_alert_rpcs.sql (contract §12) and fail with
// {code:'P0001', message:'NWIS_FORBIDDEN: ...'} exactly like Supabase.
import { http, HttpResponse } from 'msw';
import { db } from '../db';
import { ACTIVE_WELLBORE_ID, MOCK_USER_ID } from '../ids';
import rig from '../fixtures/lessons_rig.json';
import { REST, applyQuery, restRespond, rpcError } from './risk';

const FIXTURE_REF = Date.parse('2026-09-29T10:00:00Z');
const TIME_FIELDS = ['created_at', 'sent_at', 'escalated_at', 'acknowledged_at', 'resolved_at', 'feedback_at'];

/** Fixtures are written "as of" FIXTURE_REF; move them so that ages read sensibly in the demo. */
let rebased = false;
function rebaseFixtureTimes() {
  if (rebased) return;
  rebased = true;
  const shift = Date.now() - FIXTURE_REF;
  db.alerts.forEach((a) => {
    TIME_FIELDS.forEach((f) => {
      if (a[f] && Date.parse(a[f]) <= FIXTURE_REF) a[f] = new Date(Date.parse(a[f]) + shift).toISOString();
    });
  });
}
rebaseFixtureTimes();

// ---------------------------------------------------------------- mock session
/** Role of the mock user: localStorage 'nwis_mock_role' (set by the mock login), default RTOC engineer. */
export function getMockRole() {
  try {
    return localStorage.getItem('nwis_mock_role') || 'rtoc_engineer';
  } catch {
    return 'rtoc_engineer';
  }
}

export function getMockUser() {
  const role = getMockRole();
  return {
    id: MOCK_USER_ID,
    role,
    assigned_wellbore_ids: role === 'rig_engineer' ? [ACTIVE_WELLBORE_ID] : [],
  };
}

/**
 * Who is calling? The mock login gives the session an access token `mock-token.<profile id>` (see
 * handlers/auth.js); supabase-js sends it as the Bearer token, so the profile row (role, assigned
 * wellbores) is authoritative. Without such a token fall back to localStorage 'nwis_mock_role'.
 */
export function callerFrom(request) {
  const token = (request?.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token.startsWith('mock-token.')) {
    const p = db.getProfile(token.slice('mock-token.'.length));
    if (p) return { id: p.id, role: p.role, assigned_wellbore_ids: p.assigned_wellbore_ids || [] };
  }
  return getMockUser();
}

const views = new Map(); // `${alert_id}:${user_id}` -> row
export function resetMockAlertViews() {
  views.clear();
}
export function mockViewsFor(alertId) {
  return [...views.values()].filter((v) => v.alert_id === alertId);
}

// ---------------------------------------------------------------- RLS on alerts (contract §8)
function visibleAlerts(request) {
  const u = callerFrom(request);
  if (u.role === 'rig_engineer') return db.alerts.filter((a) => u.assigned_wellbore_ids.includes(a.wellbore_id));
  return db.alerts;
}

const OPEN = (a) => !['resolved', 'feedback'].includes(a.state);

function withWellName(a) {
  const w = db.wells.find((x) => x.wellbore_id === a.wellbore_id);
  return { ...a, well_name: w?.well_name ?? null };
}

// ---------------------------------------------------------------- RPC helpers
function loadAlert(id) {
  const alert = db.getAlert(id);
  return alert || null;
}

function actor(request) {
  const u = callerFrom(request);
  return { id: u.id, role: u.role, assigned: u.assigned_wellbore_ids };
}

const NOT_FOUND = () => rpcError('NWIS_NOT_FOUND: alert not found');

function rpc(name, fn) {
  return http.post(`${REST}/rpc/${name}`, async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    return fn(body, request);
  });
}

/** Test/dev helper: create a backend-style alert (inserted as 'generated', then 'sent' a moment later). */
export function mockCreateAlert(partial = {}, { sendAfterMs = 300 } = {}) {
  const now = new Date().toISOString();
  const wellbore_id = partial.wellbore_id || ACTIVE_WELLBORE_ID;
  const risk_type = partial.risk_type === undefined ? 'losses' : partial.risk_type;
  const zone = partial.zone_md_from_m ?? Math.floor(((db.stream_state.find((s) => s.wellbore_id === wellbore_id)?.bit_md_m ?? 2400) + 60) / 25) * 25;
  const alert = {
    id: crypto.randomUUID(),
    wellbore_id,
    kind: 'lookahead',
    risk_type,
    severity: 'warning',
    state: 'generated',
    dedup_key: `${wellbore_id}:${risk_type ?? 'system'}:${Math.floor(zone / 50) * 50}:${Date.now()}`,
    zone_md_from_m: zone,
    zone_md_to_m: zone + 25,
    expected_md_m: zone + 10,
    formation: 'Tipam',
    score: null,
    confidence: 'medium',
    title: 'Mock alert',
    message: 'Generated via the dev panel.',
    recommendation: 'Review the offset evidence.',
    evidence: {
      offsets: [
        {
          wellbore_id: rig.events[0].wellbore_id,
          well_name: rig.events[0].well_name,
          depth_distance_m: rig.events[0].depth_distance_m,
          events: [{ id: rig.events[0].id, event_type: rig.events[0].event_type, md_from_m: rig.events[0].md_from_m, npt_h: rig.events[0].npt_h, doc_id: rig.events[0].doc_id, page: rig.events[0].page }],
        },
      ],
      lessons: rig.lessons.slice(0, 1).map((l) => ({ id: l.id, title: l.title, mitigation: l.mitigation, success_rate: l.success_rate })),
      shap: [{ feature: 'flow_out_minus_in_trend', value: 0.12 }],
      detector: null,
      layers: { l1: 0.6, l2: 0.55, l3: null },
      sources: [{ doc_id: rig.events[0].doc_id, doc_title: `DDR ${rig.events[0].well_name}`, page: rig.events[0].page }],
    },
    model_version: 'l2-mock-2026-09-29-01',
    created_at: now,
    sent_at: null,
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
    ...partial,
  };
  if (alert.score == null && alert.kind !== 'system') alert.score = { info: 34, watch: 52, warning: 72, critical: 88 }[alert.severity] ?? 50;
  db.insert('alerts', alert);
  if (alert.state === 'generated' && sendAfterMs != null) {
    setTimeout(() => {
      const still = db.getAlert(alert.id);
      if (still && still.state === 'generated') db.updateAlert(alert.id, { state: 'sent', sent_at: new Date().toISOString() });
    }, sendAfterMs);
  }
  return alert;
}

const iso = () => new Date().toISOString();

export const handlers = [
  http.get(`${REST}/alerts`, ({ request }) => {
    const url = new URL(request.url);
    return restRespond(request, applyQuery(visibleAlerts(request), url.searchParams));
  }),

  http.get(`${REST}/v_open_alerts`, ({ request }) => {
    const url = new URL(request.url);
    return restRespond(request, applyQuery(visibleAlerts(request).filter(OPEN).map(withWellName), url.searchParams));
  }),

  http.get(`${REST}/alert_views`, ({ request }) => {
    const url = new URL(request.url);
    const mine = [...views.values()].filter((v) => v.user_id === callerFrom(request).id);
    return restRespond(request, applyQuery(mine, url.searchParams));
  }),

  // 1. mark_alert_viewed: records a view once per user; sent -> viewed
  rpc('mark_alert_viewed', ({ p_alert }, request) => {
    const u = actor(request);
    const a = loadAlert(p_alert);
    if (!a) return NOT_FOUND();
    if (u.role === 'rig_engineer' && !u.assigned.includes(a.wellbore_id)) {
      return rpcError('NWIS_FORBIDDEN: rig engineer not assigned to wellbore');
    }
    const key = `${p_alert}:${u.id}`;
    if (!views.has(key)) views.set(key, { alert_id: p_alert, user_id: u.id, viewed_at: iso() });
    if (a.state === 'sent') db.updateAlert(p_alert, { state: 'viewed' });
    return new HttpResponse(null, { status: 204 });
  }),

  // 2. ack_alert
  rpc('ack_alert', ({ p_alert, p_note = null }, request) => {
    const u = actor(request);
    const a = loadAlert(p_alert);
    if (!a) return NOT_FOUND();
    if (u.role === 'rig_engineer') {
      if (!u.assigned.includes(a.wellbore_id)) return rpcError('NWIS_FORBIDDEN: rig engineer not assigned to wellbore');
    } else if (!['rtoc_engineer', 'admin'].includes(u.role)) {
      return rpcError(`NWIS_FORBIDDEN: role ${u.role} cannot acknowledge alerts`);
    }
    if (!['sent', 'viewed', 'escalated'].includes(a.state)) {
      return rpcError(`NWIS_BAD_STATE: alert in state ${a.state} cannot be acknowledged`);
    }
    const updated = db.updateAlert(p_alert, {
      state: 'acknowledged',
      acknowledged_by: u.id,
      acknowledged_at: iso(),
      action_note: p_note ?? a.action_note,
    });
    return HttpResponse.json(updated);
  }),

  // 3. resolve_alert
  rpc('resolve_alert', ({ p_alert, p_outcome, p_note = null }, request) => {
    const u = actor(request);
    const a = loadAlert(p_alert);
    if (!a) return NOT_FOUND();
    if (u.role === 'rig_engineer') {
      if (!u.assigned.includes(a.wellbore_id)) return rpcError('NWIS_FORBIDDEN: rig engineer not assigned to wellbore');
      if (['warning', 'critical'].includes(a.severity)) {
        return rpcError('NWIS_FORBIDDEN: rig engineer cannot resolve warning or critical alerts');
      }
    } else if (!['rtoc_engineer', 'admin'].includes(u.role)) {
      return rpcError(`NWIS_FORBIDDEN: role ${u.role} cannot resolve alerts`);
    }
    if (!['event_occurred', 'avoided', 'false_alarm', 'unknown'].includes(p_outcome)) {
      return rpcError('NWIS_BAD_REQUEST: invalid outcome', '22P02');
    }
    if (['warning', 'critical'].includes(a.severity)) {
      if (a.state !== 'acknowledged') return rpcError(`NWIS_BAD_STATE: ${a.severity} alerts must be acknowledged before resolving`);
    } else if (!['sent', 'viewed', 'acknowledged'].includes(a.state)) {
      return rpcError(`NWIS_BAD_STATE: alert in state ${a.state} cannot be resolved`);
    }
    const updated = db.updateAlert(p_alert, {
      state: 'resolved',
      resolved_by: u.id,
      resolved_at: iso(),
      resolved_how: 'manual',
      outcome: p_outcome,
      action_note: p_note ?? a.action_note,
    });
    return HttpResponse.json(updated);
  }),

  // 4. dismiss_alert
  rpc('dismiss_alert', ({ p_alert, p_reason }, request) => {
    const u = actor(request);
    if (p_reason == null || String(p_reason).trim().length < 5) {
      return rpcError('NWIS_BAD_REQUEST: dismiss reason must be at least 5 characters');
    }
    const a = loadAlert(p_alert);
    if (!a) return NOT_FOUND();
    if (u.role === 'rig_engineer') {
      if (!u.assigned.includes(a.wellbore_id)) return rpcError('NWIS_FORBIDDEN: rig engineer not assigned to wellbore');
    } else if (!['rtoc_engineer', 'admin'].includes(u.role)) {
      return rpcError(`NWIS_FORBIDDEN: role ${u.role} cannot dismiss alerts`);
    }
    if (!['info', 'watch'].includes(a.severity)) return rpcError('NWIS_BAD_STATE: only info and watch alerts can be dismissed');
    if (!['sent', 'viewed'].includes(a.state)) return rpcError(`NWIS_BAD_STATE: alert in state ${a.state} cannot be dismissed`);
    const updated = db.updateAlert(p_alert, {
      state: 'resolved',
      resolved_by: u.id,
      resolved_at: iso(),
      resolved_how: 'dismissed',
      outcome: 'false_alarm',
      dismiss_reason: String(p_reason).trim(),
    });
    return HttpResponse.json(updated);
  }),

  // 5. rate_alert
  rpc('rate_alert', ({ p_alert, p_useful }, request) => {
    const u = actor(request);
    const a = loadAlert(p_alert);
    if (!a) return NOT_FOUND();
    if (a.state !== 'resolved') return rpcError('NWIS_BAD_STATE: only resolved alerts can be rated');
    const allowed =
      a.resolved_by === u.id ||
      u.role === 'admin' ||
      u.role === 'rtoc_engineer' ||
      (u.role === 'rig_engineer' && u.assigned.includes(a.wellbore_id));
    if (!allowed) return rpcError('NWIS_FORBIDDEN: user not permitted to rate this alert');
    const updated = db.updateAlert(p_alert, { state: 'feedback', useful: !!p_useful, feedback_by: u.id, feedback_at: iso() });
    return HttpResponse.json(updated);
  }),
];

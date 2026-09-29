import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALERT_SEVERITIES, ALERT_STATES } from '../../lib/constants';
import { db } from '../../mocks/db';
import { ACTIVE_WELLBORE_ID } from '../../mocks/ids';
import { createServer, installRelativeFetch, resetMockState } from '../../dev/testHarness';
import { canAcknowledge, canDismiss, canRate, canResolve } from './permissions';
import { mapAlertError } from '../../lib/data/alerts';

// The mock RPCs must enforce exactly what permissions.js promises (contract §12), with Supabase-shaped
// errors: {code:'P0001', message:'NWIS_...: ...'}.
const server = createServer();
let restoreFetch;
import { REST } from '../../mocks/handlers/risk';
const OTHER_WELLBORE = '00000000-0000-4000-8000-000000000004';
const ID = '00000000-0000-4000-b000-0000000000ff';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  restoreFetch = installRelativeFetch();
});
afterAll(() => {
  restoreFetch();
  server.close();
});
beforeEach(() => resetMockState());

const USERS = {
  rig_assigned: { role: 'rig_engineer', assigned_wellbore_ids: [ACTIVE_WELLBORE_ID], wellbore: ACTIVE_WELLBORE_ID },
  rig_other_well: { role: 'rig_engineer', assigned_wellbore_ids: [ACTIVE_WELLBORE_ID], wellbore: OTHER_WELLBORE },
  rtoc_engineer: { role: 'rtoc_engineer', assigned_wellbore_ids: [], wellbore: ACTIVE_WELLBORE_ID },
  office_engineer: { role: 'office_engineer', assigned_wellbore_ids: [], wellbore: ACTIVE_WELLBORE_ID },
  reviewer: { role: 'reviewer', assigned_wellbore_ids: [], wellbore: ACTIVE_WELLBORE_ID },
  admin: { role: 'admin', assigned_wellbore_ids: [], wellbore: ACTIVE_WELLBORE_ID },
};

async function rpc(fn, params, token) {
  const res = await fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

function seed(user, state, severity) {
  db.alerts.push({
    id: ID,
    wellbore_id: user.wellbore,
    kind: 'lookahead',
    risk_type: 'losses',
    severity,
    state,
    dedup_key: `k:${state}:${severity}`,
    title: 't',
    message: 'm',
    evidence: {},
    created_at: new Date().toISOString(),
    resolved_by: 'someone-else',
  });
}

const CALL = {
  acknowledge: (token) => rpc('ack_alert', { p_alert: ID, p_note: null }, token),
  resolve: (token) => rpc('resolve_alert', { p_alert: ID, p_outcome: 'avoided', p_note: null }, token),
  dismiss: (token) => rpc('dismiss_alert', { p_alert: ID, p_reason: 'not relevant here' }, token),
  rate: (token) => rpc('rate_alert', { p_alert: ID, p_useful: true }, token),
};
const CAN = { acknowledge: canAcknowledge, resolve: canResolve, dismiss: canDismiss, rate: canRate };

describe('mock RPCs enforce the same rules as permissions.js (contract §12)', () => {
  for (const action of Object.keys(CALL)) {
    for (const [key, u] of Object.entries(USERS)) {
      it(`${action} as ${key}: every state x severity`, async () => {
        localStorage.setItem('nwis_mock_role', u.role);
        const profile = { id: '00000000-0000-4000-a000-000000000001', role: u.role, assigned_wellbore_ids: u.assigned_wellbore_ids };
        for (const state of ALERT_STATES) {
          for (const severity of ALERT_SEVERITIES) {
            db.reset();
            seed(u, state, severity);
            const alert = db.getAlert(ID);
            const expected = CAN[action](profile, alert);
            const res = await CALL[action]();
            if (expected) {
              expect(res.ok, `${action} ${key} ${state}/${severity}`).toBe(true);
            } else {
              expect(res.ok, `${action} ${key} ${state}/${severity} should be refused`).toBe(false);
              expect(res.body.code).toBe('P0001');
              expect(res.body.message).toMatch(/^NWIS_(FORBIDDEN|BAD_STATE): /);
            }
          }
        }
      }, 60000);
    }
  }

  it('errors have the Supabase shape and map to plain words', async () => {
    localStorage.setItem('nwis_mock_role', 'office_engineer');
    seed(USERS.office_engineer, 'sent', 'warning');
    const forbidden = await CALL.acknowledge();
    expect(forbidden.status).toBe(400);
    expect(forbidden.body).toMatchObject({ code: 'P0001', message: expect.stringMatching(/^NWIS_FORBIDDEN: /) });
    expect(mapAlertError(forbidden.body).message).toBe("You don't have permission for this.");

    localStorage.setItem('nwis_mock_role', 'rtoc_engineer');
    const stale = await CALL.resolve();
    expect(stale.body.message).toMatch(/^NWIS_BAD_STATE: /);
    expect(mapAlertError(stale.body).message).toBe('This alert has changed; refreshed.');
    expect(mapAlertError(stale.body).stale).toBe(true);
  });

  it('dismiss needs a reason of >= 5 characters (NWIS_BAD_REQUEST) and info/watch only (NWIS_BAD_STATE)', async () => {
    localStorage.setItem('nwis_mock_role', 'rtoc_engineer');
    seed(USERS.rtoc_engineer, 'sent', 'watch');
    const short = await rpc('dismiss_alert', { p_alert: ID, p_reason: 'bad' });
    expect(short.body.message).toMatch(/^NWIS_BAD_REQUEST: /);
    expect(mapAlertError(short.body).message).toMatch(/at least 5 characters/);
    db.reset();
    seed(USERS.rtoc_engineer, 'sent', 'warning');
    const wrongSeverity = await CALL.dismiss();
    expect(wrongSeverity.body.message).toMatch(/^NWIS_BAD_STATE: /);
  });

  it('the caller is taken from the mock session token when there is one', async () => {
    localStorage.setItem('nwis_mock_role', 'admin'); // would be allowed...
    seed(USERS.rtoc_engineer, 'sent', 'warning');
    const office = db.profiles.find((p) => p.role === 'office_engineer');
    const res = await CALL.acknowledge(`mock-token.${office.id}`); // ...but the token says office engineer
    expect(res.ok).toBe(false);
    expect(res.body.message).toMatch(/NWIS_FORBIDDEN/);
    const rtoc = db.profiles.find((p) => p.role === 'rtoc_engineer');
    expect((await CALL.acknowledge(`mock-token.${rtoc.id}`)).ok).toBe(true);
  });

  it('mark_alert_viewed records one view per user and moves only sent -> viewed', async () => {
    localStorage.setItem('nwis_mock_role', 'rtoc_engineer');
    for (const state of ALERT_STATES) {
      db.reset();
      seed(USERS.rtoc_engineer, state, 'warning');
      const a = await rpc('mark_alert_viewed', { p_alert: ID });
      const b = await rpc('mark_alert_viewed', { p_alert: ID });
      expect(a.ok && b.ok).toBe(true);
      expect(db.getAlert(ID).state).toBe(state === 'sent' ? 'viewed' : state);
    }
  });
});

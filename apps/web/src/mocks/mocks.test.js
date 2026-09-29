import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { db } from './db';
import { handlers } from './handlers';
import { ACTIVE_WELLBORE_ID } from './ids';

const BASE = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'; // same rule as the handlers
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => db.reset());
afterEach(() => server.resetHandlers());

describe('mock db', () => {
  it('keeps the named arrays and normalises the legacy wellbore literal', () => {
    for (const t of ['wells', 'stream_state', 'alerts', 'risk_scores', 'profiles']) expect(Array.isArray(db[t])).toBe(true);
    expect(db.stream_state[0].wellbore_id).toBe(ACTIVE_WELLBORE_ID);
    expect(JSON.stringify(db.alerts)).not.toContain('mock-wellbore-id');
    expect(db.getWell(ACTIVE_WELLBORE_ID).status).toBe('drilling');
  });

  it('insert / update / remove mutate the table and emit realtime events', () => {
    const seen = [];
    const onChange = (e) => seen.push(['change', e.detail]);
    const onEvent = (e) => seen.push(['event', e.detail.eventType]);
    db.emitter.addEventListener('change:alerts', onChange);
    db.emitter.addEventListener('event:alerts', onEvent);
    const a = db.emitAlert({ severity: 'warning' });
    expect(db.getAlert(a.id).state).toBe('sent');
    db.updateAlert(a.id, { state: 'acknowledged' });
    expect(db.getAlert(a.id).state).toBe('acknowledged');
    db.remove('alerts', a.id);
    expect(db.getAlert(a.id)).toBeUndefined();
    expect(seen.filter(([k]) => k === 'event').map(([, t]) => t)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
    expect(seen.filter(([k]) => k === 'change')).toHaveLength(3);
    db.emitter.removeEventListener('change:alerts', onChange);
    db.emitter.removeEventListener('event:alerts', onEvent);
  });

  it('advanceBit moves the bit and emits stream_state', () => {
    const before = db.get('stream_state', ACTIVE_WELLBORE_ID).bit_md_m;
    const handler = vi.fn();
    db.emitter.addEventListener('change:stream_state', handler);
    const row = db.advanceBit(undefined, 5);
    expect(row.bit_md_m).toBe(before + 5);
    expect(handler).toHaveBeenCalledTimes(1);
    db.emitter.removeEventListener('change:stream_state', handler);
  });

  it('composite keys work for risk_scores', () => {
    const r = db.risk_scores[0];
    const upd = db.update('risk_scores', { wellbore_id: r.wellbore_id, md_from_m: r.md_from_m, risk_type: r.risk_type }, { fused: 99 });
    expect(upd.fused).toBe(99);
  });

  it('reset() restores seeds in place (same array references)', () => {
    const alertsRef = db.alerts;
    const seeded = db.alerts.length;
    db.emitAlert();
    db.advanceBit(undefined, 100);
    expect(db.alerts.length).toBe(seeded + 1);
    db.reset();
    expect(db.alerts).toBe(alertsRef);
    expect(db.alerts).toHaveLength(seeded);
    expect(() => db.table('nope')).toThrow(/unknown table/);
  });

  it('has one realistic profile per role, rig assigned to the active wellbore', () => {
    expect(db.profiles.map((p) => p.role).sort()).toEqual(['admin', 'office_engineer', 'reviewer', 'rig_engineer', 'rtoc_engineer']);
    expect(db.profiles.find((p) => p.role === 'rig_engineer').assigned_wellbore_ids).toEqual([ACTIVE_WELLBORE_ID]);
  });
});

describe('auth handlers', () => {
  const post = (path, body, headers = {}) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('signs in a fixture user and rejects bad credentials', async () => {
    const ok = await post('/auth/v1/token?grant_type=password', { email: 'ADMIN@syn-nwis.test', password: 'x' });
    expect(ok.status).toBe(200);
    const session = await ok.json();
    expect(session.user.email).toBe('admin@syn-nwis.test');
    expect(session.access_token).toMatch(/^mock-token\./);

    expect((await post('/auth/v1/token?grant_type=password', { email: 'nobody@x.in', password: 'x' })).status).toBe(400);
    expect((await post('/auth/v1/token?grant_type=password', { email: 'admin@syn-nwis.test', password: 'wrong-password' })).status).toBe(400);
  });

  it('serves /auth/v1/user, logout and recover', async () => {
    const { access_token } = await (await post('/auth/v1/token?grant_type=password', { email: 'rig@syn-nwis.test', password: 'x' })).json();
    const me = await fetch(`${BASE}/auth/v1/user`, { headers: { Authorization: `Bearer ${access_token}` } });
    expect((await me.json()).email).toBe('rig@syn-nwis.test');
    expect((await fetch(`${BASE}/auth/v1/user`)).status).toBe(401);
    expect((await post('/auth/v1/logout', {})).status).toBe(204);
    expect((await post('/auth/v1/recover', { email: 'anyone@x.in' })).status).toBe(200);
  });

  it('GET /rest/v1/profiles applies RLS-like scoping and single-object semantics', async () => {
    const rig = db.profiles.find((p) => p.role === 'rig_engineer');
    const admin = db.profiles.find((p) => p.role === 'admin');
    const asRig = await (await fetch(`${BASE}/rest/v1/profiles?select=*`, { headers: { Authorization: `Bearer mock-token.${rig.id}` } })).json();
    expect(asRig.map((p) => p.id)).toEqual([rig.id]);
    const asAdmin = await (await fetch(`${BASE}/rest/v1/profiles?select=*`, { headers: { Authorization: `Bearer mock-token.${admin.id}` } })).json();
    expect(asAdmin).toHaveLength(5);

    const single = await fetch(`${BASE}/rest/v1/profiles?select=*&id=eq.${rig.id}`, { headers: { Accept: 'application/vnd.pgrst.object+json' } });
    expect((await single.json()).role).toBe('rig_engineer');
    const none = await fetch(`${BASE}/rest/v1/profiles?select=*&id=eq.nope`, { headers: { Accept: 'application/vnd.pgrst.object+json' } });
    expect(none.status).toBe(406);
  });

  it('admin user routes enforce the admin role and mutate profiles', async () => {
    const rtoc = db.profiles.find((p) => p.role === 'rtoc_engineer');
    const admin = db.profiles.find((p) => p.role === 'admin');
    const call = (method, path, body, who) =>
      fetch(`${window.location.origin}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer mock-token.${who.id}` },
        body: JSON.stringify(body),
      });

    const denied = await call('POST', '/api/admin/users/invite', { email: 'n@x.in', role: 'reviewer' }, rtoc);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('NWIS_FORBIDDEN');

    const ok = await call('POST', '/api/admin/users/invite', { email: 'new@x.in', role: 'reviewer', full_name: 'New Person' }, admin);
    const { user_id } = await ok.json();
    expect(db.getProfile(user_id).role).toBe('reviewer');
    expect((await call('POST', '/api/admin/users/invite', { email: 'new@x.in', role: 'reviewer' }, admin)).status).toBe(409);

    const patched = await call('PATCH', `/api/admin/users/${user_id}`, { role: 'rtoc_engineer' }, admin);
    expect(await patched.json()).toEqual({ ok: true });
    expect(db.getProfile(user_id).role).toBe('rtoc_engineer');
    expect((await call('PATCH', '/api/admin/users/missing', { role: 'admin' }, admin)).status).toBe(404);
  });
});

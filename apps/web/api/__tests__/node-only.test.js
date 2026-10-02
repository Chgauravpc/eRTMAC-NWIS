import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import invite from '../admin/users/invite.js';
import patchUser from '../admin/users/[id].js';
import health from '../health.js';
import uploadUrl, { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, sanitiseFilename, validateUploadRequest } from '../documents/upload-url.js';
import { fakeSpace, fakeSupabase, mockReq, mockRes, ROLE_LIST, setEnv, USER_ID, WELLBORE_ID } from './helpers.js';

function signIn(options) {
  const fake = fakeSupabase(options);
  vi.mocked(createClient).mockReturnValue(fake.client);
  return fake;
}

beforeEach(() => {
  setEnv();
  vi.mocked(createClient).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- documents/upload-url

describe('sanitiseFilename', () => {
  it('replaces everything outside [a-zA-Z0-9._-] with an underscore', () => {
    expect(sanitiseFilename('DDR 12 (final).pdf')).toBe('DDR_12__final_.pdf');
    expect(sanitiseFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitiseFilename('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(sanitiseFilename('Rapport é.pdf')).toBe('Rapport__.pdf');
  });

  it('caps the name at 120 characters and keeps the extension', () => {
    const long = `${'x'.repeat(300)}.pdf`;
    const out = sanitiseFilename(long);
    expect(out).toHaveLength(120);
    expect(out.endsWith('.pdf')).toBe(true);
    expect(sanitiseFilename('y'.repeat(300))).toHaveLength(120);
  });

  it('never returns an empty or dots-only name', () => {
    for (const bad of ['', '   ', '...', '___', undefined, null]) expect(sanitiseFilename(bad)).toMatch(/\w/);
  });
});

describe('validateUploadRequest (25 MB, DB-06 types)', () => {
  const ok = { filename: 'DDR_12.pdf', size_bytes: 1830211, mime_type: 'application/pdf' };

  it('accepts a normal request and exactly 25 MB', () => {
    expect(validateUploadRequest(ok).filename).toBe('DDR_12.pdf');
    expect(() => validateUploadRequest({ ...ok, size_bytes: MAX_UPLOAD_BYTES })).not.toThrow();
  });

  it.each([MAX_UPLOAD_BYTES + 1, 0, -5, 1.5, '1000', null, undefined])('rejects size_bytes %s', (size) => {
    expect(() => validateUploadRequest({ ...ok, size_bytes: size })).toThrow(expect.objectContaining({ status: 400, code: 'NWIS_BAD_REQUEST' }));
  });

  it.each(['application/x-msdownload', 'text/html', '', undefined, 'video/mp4'])('rejects mime type %s', (mime) => {
    expect(() => validateUploadRequest({ ...ok, mime_type: mime })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('accepts every type of the documents bucket and ignores a charset suffix', () => {
    for (const mime of ALLOWED_MIME_TYPES) expect(() => validateUploadRequest({ ...ok, mime_type: mime })).not.toThrow();
    expect(() => validateUploadRequest({ ...ok, mime_type: 'text/csv; charset=utf-8' })).not.toThrow();
  });

  it('requires a filename', () => {
    for (const filename of ['', '  ', undefined, 5]) expect(() => validateUploadRequest({ ...ok, filename })).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('POST /api/documents/upload-url', () => {
  const body = { filename: 'DDR 12.pdf', size_bytes: 20 * 1024 * 1024, mime_type: 'application/pdf' };

  it.each(['reviewer', 'office_engineer', 'admin'])('gives %s a signed upload URL for incoming/<uuid>/<name>', async (role) => {
    const fake = signIn({ role });
    const res = mockRes();
    await uploadUrl(mockReq({ body }), res);
    expect(res.statusCode).toBe(200);
    const { upload_id: uploadId, storage_path: path, signed_url: signedUrl, token } = res.body;
    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(path).toBe(`incoming/${uploadId}/DDR_12.pdf`);
    expect(signedUrl).toBe('https://supabase.test/signed');
    expect(token).toBe('upload-token');
    expect(fake.calls.buckets).toEqual(['documents']);
    expect(fake.calls.signed).toEqual([path]);
  });

  it('accepts a 20 MB file because only metadata passes through the function', async () => {
    signIn({ role: 'reviewer' });
    const res = mockRes();
    await uploadUrl(mockReq({ body: { ...body, size_bytes: 20 * 1024 * 1024 } }), res);
    expect(res.statusCode).toBe(200);
  });

  it.each(['rig_engineer', 'rtoc_engineer'])('rejects %s with 403', async (role) => {
    const fake = signIn({ role });
    const res = mockRes();
    await uploadUrl(mockReq({ body }), res);
    expect(res.statusCode).toBe(403);
    expect(fake.calls.signed).toEqual([]);
  });

  it('rejects an oversized file, a bad type, a missing token and the wrong method', async () => {
    const fake = signIn({ role: 'admin' });
    const big = mockRes();
    await uploadUrl(mockReq({ body: { ...body, size_bytes: MAX_UPLOAD_BYTES + 1 } }), big);
    expect(big.statusCode).toBe(400);
    const bad = mockRes();
    await uploadUrl(mockReq({ body: { ...body, mime_type: 'application/x-msdownload' } }), bad);
    expect(bad.statusCode).toBe(400);
    const anonymous = mockRes();
    await uploadUrl(mockReq({ body, token: null }), anonymous);
    expect(anonymous.statusCode).toBe(401);
    const wrong = mockRes();
    await uploadUrl(mockReq({ method: 'GET' }), wrong);
    expect(wrong.statusCode).toBe(405);
    expect(fake.calls.signed).toEqual([]);
  });

  it('turns a Supabase storage failure into 502 NWIS_UPSTREAM', async () => {
    signIn({ role: 'admin', signedUpload: { data: null, error: { message: 'bucket missing' } } });
    const res = mockRes();
    await uploadUrl(mockReq({ body }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error.code).toBe('NWIS_UPSTREAM');
  });

  it('gives every upload a different id', async () => {
    signIn({ role: 'admin' });
    const a = mockRes();
    const b = mockRes();
    await uploadUrl(mockReq({ body }), a);
    await uploadUrl(mockReq({ body }), b);
    expect(a.body.upload_id).not.toBe(b.body.upload_id);
  });
});

// ---------------------------------------------------------------- admin/users

describe('POST /api/admin/users/invite', () => {
  const body = { email: 'new@oil.example', role: 'rig_engineer', full_name: 'New Person', assigned_wellbore_ids: [WELLBORE_ID, WELLBORE_ID.toUpperCase()] };

  it('invites by e-mail, saves role and assignments on profiles, audits and returns the user id', async () => {
    const fake = signIn({ role: 'admin' });
    const res = mockRes();
    await invite(mockReq({ body }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ user_id: '44444444-4444-4444-8444-444444444444' });
    expect(fake.calls.invites).toEqual([{ address: 'new@oil.example', options: { data: { full_name: 'New Person' } } }]);
    expect(fake.calls.upserts[0].row).toEqual({
      id: '44444444-4444-4444-8444-444444444444', email: 'new@oil.example', full_name: 'New Person', role: 'rig_engineer', assigned_wellbore_ids: [WELLBORE_ID],
    });
    expect(fake.calls.audits[0]).toMatchObject({ user_id: USER_ID, action: 'user.invite', entity: 'profile', entity_id: '44444444-4444-4444-8444-444444444444' });
    expect(fake.calls.audits[0].details).toMatchObject({ email: 'new@oil.example', role: 'rig_engineer' });
  });

  it.each(ROLE_LIST.filter((r) => r !== 'admin'))('rejects %s with 403 before inviting anyone', async (role) => {
    const fake = signIn({ role });
    const res = mockRes();
    await invite(mockReq({ body }), res);
    expect(res.statusCode).toBe(403);
    expect(fake.calls.invites).toEqual([]);
  });

  it.each([
    ['no email', { ...body, email: undefined }],
    ['bad email', { ...body, email: 'not-an-email' }],
    ['unknown role', { ...body, role: 'superuser' }],
    ['bad wellbore ids', { ...body, assigned_wellbore_ids: ['x'] }],
    ['wellbores not a list', { ...body, assigned_wellbore_ids: 'abc' }],
    ['name too long', { ...body, full_name: 'x'.repeat(201) }],
  ])('rejects %s with 400', async (_label, payload) => {
    const fake = signIn({ role: 'admin' });
    const res = mockRes();
    await invite(mockReq({ body: payload }), res);
    expect(res.statusCode).toBe(400);
    expect(fake.calls.invites).toEqual([]);
  });

  it('defaults the assignments to an empty list', async () => {
    const fake = signIn({ role: 'admin' });
    await invite(mockReq({ body: { email: 'a@b.in', role: 'reviewer' } }), mockRes());
    expect(fake.calls.upserts[0].row.assigned_wellbore_ids).toEqual([]);
  });

  it('maps an invite rejection to 400 and other failures to 502', async () => {
    signIn({ role: 'admin', invite: { data: null, error: { status: 422, message: 'already registered' } } });
    const rejected = mockRes();
    await invite(mockReq({ body }), rejected);
    expect(rejected.statusCode).toBe(400);
    signIn({ role: 'admin', invite: { data: null, error: { status: 500, message: 'smtp down' } } });
    const failed = mockRes();
    await invite(mockReq({ body }), failed);
    expect(failed.statusCode).toBe(502);
  });

  it('reports a profile failure after a successful invite with the user id', async () => {
    signIn({ role: 'admin', upsertError: { message: 'constraint' } });
    const res = mockRes();
    await invite(mockReq({ body }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error.details.user_id).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('still succeeds when only the audit row fails', async () => {
    signIn({ role: 'admin', auditError: { message: 'audit down' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await invite(mockReq({ body }), res);
    expect(res.statusCode).toBe(200);
    spy.mockRestore();
  });
});

describe('PATCH /api/admin/users/{id}', () => {
  const target = '55555555-5555-4555-8555-555555555555';
  const req = (extra = {}) => mockReq({ method: 'PATCH', query: { id: target }, body: { role: 'rtoc_engineer', assigned_wellbore_ids: [WELLBORE_ID] }, ...extra });

  it('updates role and assignments, audits and returns ok', async () => {
    const fake = signIn({ role: 'admin' });
    const res = mockRes();
    await patchUser(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fake.calls.updates).toEqual([{ patch: { role: 'rtoc_engineer', assigned_wellbore_ids: [WELLBORE_ID] }, column: 'id', value: target }]);
    expect(fake.calls.audits[0]).toMatchObject({ user_id: USER_ID, action: 'user.update', entity_id: target });
  });

  it('accepts a role-only or assignments-only change', async () => {
    const fake = signIn({ role: 'admin' });
    await patchUser(req({ body: { role: 'reviewer' } }), mockRes());
    await patchUser(req({ body: { assigned_wellbore_ids: [] } }), mockRes());
    expect(fake.calls.updates.map((u) => u.patch)).toEqual([{ role: 'reviewer' }, { assigned_wellbore_ids: [] }]);
  });

  it.each(ROLE_LIST.filter((r) => r !== 'admin'))('rejects %s with 403', async (role) => {
    const fake = signIn({ role });
    const res = mockRes();
    await patchUser(req(), res);
    expect(res.statusCode).toBe(403);
    expect(fake.calls.updates).toEqual([]);
  });

  it('validates the id and the body', async () => {
    const fake = signIn({ role: 'admin' });
    const badId = mockRes();
    await patchUser(req({ query: { id: 'nope' } }), badId);
    expect(badId.statusCode).toBe(400);
    for (const body of [{}, { role: 'god' }, { assigned_wellbore_ids: ['x'] }, undefined]) {
      const res = mockRes();
      await patchUser(req({ body }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(fake.calls.updates).toEqual([]);
  });

  it('returns 404 when no profile matches, 502 on a database error and 405 for other methods', async () => {
    signIn({ role: 'admin', updateResult: { data: [], error: null } });
    const missing = mockRes();
    await patchUser(req(), missing);
    expect(missing.statusCode).toBe(404);
    expect(missing.body.error.code).toBe('NWIS_NOT_FOUND');
    signIn({ role: 'admin', updateResult: { data: null, error: { message: 'boom' } } });
    const failed = mockRes();
    await patchUser(req(), failed);
    expect(failed.statusCode).toBe(502);
    const wrong = mockRes();
    await patchUser(req({ method: 'POST' }), wrong);
    expect(wrong.statusCode).toBe(405);
  });
});

// ---------------------------------------------------------------- health

describe('GET /api/health', () => {
  const get = (extra = {}) => mockReq({ method: 'GET', token: null, ...extra });

  it('is public and shows the Space health', async () => {
    const space = fakeSpace({ status: 200, body: { ok: true, version: '0.1.0', models: { l2: ['stuck_pipe'] } } });
    const res = mockRes();
    await health(get(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, space: { ok: true, version: '0.1.0', models: { l2: ['stuck_pipe'] } } });
    expect(new URL(space.calls[0].url).pathname).toBe('/v1/health');
    expect(createClient).not.toHaveBeenCalled(); // no authentication
  });

  it('still answers ok when the Space is down, with space.ok false', async () => {
    fakeSpace(new TypeError('fetch failed'));
    const res = mockRes();
    await health(get(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.space.ok).toBe(false);
  });

  it('reports a Space error status and an unconfigured Space', async () => {
    fakeSpace({ status: 503, body: { error: { code: 'x' } } });
    const down = mockRes();
    await health(get(), down);
    expect(down.body.space).toEqual({ ok: false, status: 503 });
    delete process.env.AI_SERVICE_URL;
    const unconfigured = mockRes();
    await health(get(), unconfigured);
    expect(unconfigured.body.space.ok).toBe(false);
  });

  it('gives up on the Space after 5 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const res = mockRes();
    const pending = health(get(), res);
    await vi.advanceTimersByTimeAsync(4900);
    expect(res.body).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(res.body.ok).toBe(true);
    expect(res.body.space.ok).toBe(false);
  });

  it('rejects other methods', async () => {
    const res = mockRes();
    await health(get({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});

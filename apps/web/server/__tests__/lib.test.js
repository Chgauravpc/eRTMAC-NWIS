import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import { requireUser, ROLES, supabaseAdmin } from '../_lib/auth.js';
import { ApiError, assertMethod, errorBody, isUuid, requireUuid, sendError } from '../_lib/errors.js';
import { forwardToSpace, sendForwarded } from '../_lib/forward.js';
import { fakeSpace, fakeSupabase, mockReq, mockRes, ROLE_LIST, setEnv, USER_ID, WELLBORE_ID } from './helpers.js';

beforeEach(() => {
  setEnv();
  vi.mocked(createClient).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('errors (contract §4)', () => {
  it('has the contract body shape', () => {
    expect(errorBody('NWIS_FORBIDDEN', 'no', { a: 1 })).toEqual({ error: { code: 'NWIS_FORBIDDEN', message: 'no', details: { a: 1 } } });
    expect(errorBody('NWIS_NOT_FOUND', 'x')).toEqual({ error: { code: 'NWIS_NOT_FOUND', message: 'x', details: {} } });
  });

  it('sends an ApiError with its status and hides unexpected errors', () => {
    const res = mockRes();
    sendError(res, new ApiError(409, 'NWIS_BAD_STATE', 'busy', { id: 1 }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toEqual({ code: 'NWIS_BAD_STATE', message: 'busy', details: { id: 1 } });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crash = mockRes();
    sendError(crash, new Error('database password is hunter2'));
    expect(crash.statusCode).toBe(500);
    expect(JSON.stringify(crash.body)).not.toContain('hunter2');
    expect(crash.body.error.code).toBe('NWIS_INTERNAL');
    spy.mockRestore();
  });

  it('answers the wrong method with 405 and an Allow header', () => {
    const res = mockRes();
    expect(assertMethod({ method: 'GET' }, res, ['POST', 'PATCH'])).toBe(false);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST, PATCH');
    expect(res.body.error.code).toBe('NWIS_BAD_REQUEST');
    expect(assertMethod({ method: 'POST' }, mockRes(), 'POST')).toBe(true);
  });

  it('recognises uuids', () => {
    expect(isUuid(WELLBORE_ID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(() => requireUuid('nope', 'id')).toThrow(/uuid/);
    expect(requireUuid(WELLBORE_ID.toUpperCase(), 'id')).toBe(WELLBORE_ID);
  });
});

describe('requireUser (contract §9.1)', () => {
  const use = (options) => {
    const fake = fakeSupabase(options);
    vi.mocked(createClient).mockReturnValue(fake.client);
    return fake;
  };

  it('rejects a missing or malformed Authorization header with 401', async () => {
    use();
    await expect(requireUser(mockReq({ token: null }))).rejects.toMatchObject({ status: 401, code: 'NWIS_UNAUTHORIZED' });
    await expect(requireUser(mockReq({ token: null, headers: { authorization: 'Basic abc' } }))).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token Supabase does not accept with 401', async () => {
    use({ getUserError: { message: 'invalid JWT' } });
    await expect(requireUser(mockReq())).rejects.toMatchObject({ status: 401, code: 'NWIS_UNAUTHORIZED' });
  });

  it('rejects an account with no profile role with 403', async () => {
    use({ role: null });
    await expect(requireUser(mockReq())).rejects.toMatchObject({ status: 403, code: 'NWIS_FORBIDDEN' });
    use({ profileError: { message: 'no rows' } });
    await expect(requireUser(mockReq())).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a role outside the allowed list with 403 and accepts one inside it', async () => {
    const fake = use({ role: 'rig_engineer' });
    await expect(requireUser(mockReq(), ['admin'])).rejects.toMatchObject({ status: 403, code: 'NWIS_FORBIDDEN' });
    await expect(requireUser(mockReq(), ['rig_engineer', 'admin'])).resolves.toEqual({ id: USER_ID, role: 'rig_engineer', email: 'user@example.org' });
    expect(fake.calls.getUser).toEqual(['good-token', 'good-token']);
  });

  it('accepts any role when no list is given', async () => {
    for (const role of ROLE_LIST) {
      use({ role });
      await expect(requireUser(mockReq())).resolves.toMatchObject({ role });
    }
    expect(ROLES).toEqual(ROLE_LIST);
  });

  it('uses the service role key server-side and fails clearly when Supabase is not configured', () => {
    use();
    supabaseAdmin();
    expect(createClient).toHaveBeenCalledWith('https://supabase.test', 'service-role-key', expect.objectContaining({ auth: expect.any(Object) }));
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => supabaseAdmin()).toThrow(/not configured/);
  });
});

describe('forwardToSpace (contract §9.1)', () => {
  const user = { id: USER_ID, role: 'admin' };

  it('calls ${AI_SERVICE_URL}/v1<path> with the service token, identity and a request id', async () => {
    const space = fakeSpace({ status: 200, body: { ok: true } });
    const out = await forwardToSpace(mockReq(), '/search', { user, body: { q: 'losses' } });
    const { url, init } = space.calls[0];
    expect(url).toBe('https://space.test/v1/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Service-Token': 'service-token', 'X-User-Id': USER_ID, 'X-User-Role': 'admin', 'Content-Type': 'application/json' });
    expect(init.headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body)).toEqual({ q: 'losses' });
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('reuses an incoming request id', async () => {
    const space = fakeSpace();
    await forwardToSpace(mockReq({ headers: { 'x-request-id': 'req-123' } }), '/health', { method: 'GET' });
    expect(space.calls[0].init.headers['X-Request-Id']).toBe('req-123');
  });

  it('sends GET without a body and puts the query in the URL, skipping empty values', async () => {
    const space = fakeSpace();
    await forwardToSpace(mockReq({ method: 'GET' }), '/wells/x/correlation', {
      method: 'GET',
      user,
      body: { ignored: true },
      query: { offsets: 'a,b', flatten: 'Barail', channels: '', other: undefined },
    });
    const { url, init } = space.calls[0];
    expect(url).toBe('https://space.test/v1/wells/x/correlation?offsets=a%2Cb&flatten=Barail');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sends no body and no content type for null, undefined or empty bodies', async () => {
    const space = fakeSpace();
    for (const body of [null, undefined, '']) await forwardToSpace(mockReq(), '/x', { user, body });
    expect(space.calls.every((c) => c.init.body === undefined && !c.init.headers['Content-Type'])).toBe(true);
  });

  it('passes the Space status and body through unchanged, including errors', async () => {
    const error = { error: { code: 'NWIS_BAD_STATE', message: 'busy', details: { job_id: 'j' } } };
    fakeSpace({ status: 409, body: error });
    await expect(forwardToSpace(mockReq(), '/x', { user })).resolves.toMatchObject({ status: 409, body: error });
    fakeSpace({ status: 202, body: { document_id: 'd', job_id: 'j' } });
    await expect(forwardToSpace(mockReq(), '/x', { user })).resolves.toMatchObject({ status: 202 });
  });

  it('turns a network error into 502 NWIS_UPSTREAM', async () => {
    fakeSpace(new TypeError('fetch failed'));
    await expect(forwardToSpace(mockReq(), '/x', { user })).rejects.toMatchObject({ status: 502, code: 'NWIS_UPSTREAM' });
  });

  it('turns a timeout into 504 NWIS_UPSTREAM', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const pending = forwardToSpace(mockReq(), '/slow', { user, timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toMatchObject({ status: 504, code: 'NWIS_UPSTREAM' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('uses FORWARD_TIMEOUT_MS when set', async () => {
    vi.useFakeTimers();
    process.env.FORWARD_TIMEOUT_MS = '200';
    vi.stubGlobal('fetch', (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))));
    const assertion = expect(forwardToSpace(mockReq(), '/slow', { user })).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it('rejects an unreadable answer with 502 and a missing configuration with 500', async () => {
    fakeSpace({ status: 200, body: '<html>gateway</html>' });
    await expect(forwardToSpace(mockReq(), '/x', { user })).rejects.toMatchObject({ status: 502 });
    delete process.env.SERVICE_TOKEN;
    await expect(forwardToSpace(mockReq(), '/x', { user })).rejects.toMatchObject({ status: 500, code: 'NWIS_INTERNAL' });
  });

  it('writes the forwarded answer to the response, with the request id', () => {
    const res = mockRes();
    sendForwarded(res, { status: 202, body: { job_id: 'j' }, requestId: 'r1' });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ job_id: 'j' });
    expect(res.headers['X-Request-Id']).toBe('r1');
    const empty = mockRes();
    sendForwarded(empty, { status: 204, body: null, requestId: 'r2' });
    expect(empty.statusCode).toBe(204);
    expect(empty.ended).toBe(true);
  });
});

describe('vercel.json', () => {
  const readRelative = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), 'utf8');
  const config = JSON.parse(readRelative('../../vercel.json'));

  it('sets maxDuration for the functions and keeps the SPA rewrites', () => {
    expect(config.functions['api/dispatch.js'].maxDuration).toBeGreaterThan(0);
    expect(config.functions['api/dispatch.js'].maxDuration).toBeLessThanOrEqual(300); // Hobby limit with Fluid compute
    expect(config.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('keeps the forward timeout below the function limit', () => {
    const limitMs = config.functions['api/dispatch.js'].maxDuration * 1000;
    const source = readRelative('../_lib/forward.js');
    const defaultMs = Number(/DEFAULT_TIMEOUT_MS = ([\d_]+)/.exec(source)[1].replaceAll('_', ''));
    expect(defaultMs).toBeLessThan(limitMs);
  });
});

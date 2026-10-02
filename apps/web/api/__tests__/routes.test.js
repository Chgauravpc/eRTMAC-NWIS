import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import ask from '../ask.js';
import documents from '../documents.js';
import reprocess from '../documents/[documentId]/reprocess.js';
import planning from '../planning/brief.js';
import search from '../search.js';
import drop from '../stream/drop.js';
import speed from '../stream/speed.js';
import start from '../stream/start.js';
import stop from '../stream/stop.js';
import retrain from '../admin/retrain.js';
import correlation from '../wells/[wellboreId]/correlation.js';
import predictTops from '../wells/[wellboreId]/predict-tops.js';
import risk from '../wells/[wellboreId]/risk.js';
import { DOCUMENT_ID, fakeSpace, fakeSupabase, mockReq, mockRes, ROLE_LIST, setEnv, USER_ID, WELLBORE_ID } from './helpers.js';

const ALL = ROLE_LIST;
const UPLOAD = ['reviewer', 'office_engineer', 'admin'];
const RTOC = ['rtoc_engineer', 'admin'];

// contract §9.2: method, roles, Space path
const ROUTES = [
  { name: 'search', handler: search, method: 'POST', roles: ALL, space: '/v1/search' },
  { name: 'ask', handler: ask, method: 'POST', roles: ALL, space: '/v1/ask' },
  { name: 'documents', handler: documents, method: 'POST', roles: UPLOAD, space: '/v1/documents' },
  { name: 'reprocess', handler: reprocess, method: 'POST', roles: UPLOAD, space: `/v1/documents/${DOCUMENT_ID}/reprocess`, query: { documentId: DOCUMENT_ID } },
  { name: 'predict-tops', handler: predictTops, method: 'POST', roles: ['rtoc_engineer', 'office_engineer', 'admin'], space: `/v1/wells/${WELLBORE_ID}/predict-tops`, query: { wellboreId: WELLBORE_ID } },
  { name: 'correlation', handler: correlation, method: 'GET', roles: ALL, space: `/v1/wells/${WELLBORE_ID}/correlation`, query: { wellboreId: WELLBORE_ID } },
  { name: 'risk', handler: risk, method: 'POST', roles: ALL, space: `/v1/wells/${WELLBORE_ID}/risk`, query: { wellboreId: WELLBORE_ID } },
  { name: 'stream/start', handler: start, method: 'POST', roles: RTOC, space: '/v1/stream/start' },
  { name: 'stream/stop', handler: stop, method: 'POST', roles: RTOC, space: '/v1/stream/stop' },
  { name: 'stream/speed', handler: speed, method: 'POST', roles: RTOC, space: '/v1/stream/speed' },
  { name: 'stream/drop', handler: drop, method: 'POST', roles: RTOC, space: '/v1/stream/drop' },
  { name: 'planning/brief', handler: planning, method: 'POST', roles: ['office_engineer', 'admin'], space: '/v1/planning/brief' },
  { name: 'admin/retrain', handler: retrain, method: 'POST', roles: ['admin'], space: '/v1/admin/retrain' },
];

function signIn(role) {
  const fake = fakeSupabase({ role });
  vi.mocked(createClient).mockReturnValue(fake.client);
  return fake;
}

beforeEach(() => {
  setEnv();
  vi.mocked(createClient).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe.each(ROUTES)('$name', ({ handler, method, roles, space, query }) => {
  const request = (extra = {}) => mockReq({ method, query, body: method === 'GET' ? undefined : { example: 1 }, ...extra });

  it.each(ROLE_LIST.filter((r) => !roles.includes(r)))('rejects %s with 403 and never calls the Space', async (role) => {
    signIn(role);
    const spaceFake = fakeSpace();
    const res = mockRes();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('NWIS_FORBIDDEN');
    expect(spaceFake.calls).toHaveLength(0);
  });

  it.each(roles)('forwards %s to the Space with the service token and identity', async (role) => {
    signIn(role);
    const spaceFake = fakeSpace({ status: 200, body: { from: 'space' } });
    const res = mockRes();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ from: 'space' });
    const call = spaceFake.calls[0];
    expect(new URL(call.url).pathname).toBe(space);
    expect(call.init.method).toBe(method);
    expect(call.init.headers).toMatchObject({ 'X-Service-Token': 'service-token', 'X-User-Id': USER_ID, 'X-User-Role': role });
  });

  it('answers a missing token with 401 and the wrong method with 405', async () => {
    signIn('admin');
    const spaceFake = fakeSpace();
    const noToken = mockRes();
    await handler(request({ token: null }), noToken);
    expect(noToken.statusCode).toBe(401);
    const wrong = mockRes();
    await handler(request({ method: method === 'GET' ? 'DELETE' : 'GET' }), wrong);
    expect(wrong.statusCode).toBe(405);
    expect(spaceFake.calls).toHaveLength(0);
  });

  it('reports an unreachable Space as 502 NWIS_UPSTREAM', async () => {
    signIn(roles[0]);
    fakeSpace(new TypeError('fetch failed'));
    const res = mockRes();
    await handler(request(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error.code).toBe('NWIS_UPSTREAM');
  });
});

describe('bodies are forwarded verbatim', () => {
  it('search sends the request body as JSON', async () => {
    signIn('rig_engineer');
    const spaceFake = fakeSpace();
    const body = { q: 'losses in tipam', filters: { formation: 'Tipam' }, limit: 20 };
    await search(mockReq({ body }), mockRes());
    expect(JSON.parse(spaceFake.calls[0].init.body)).toEqual(body);
  });
});

describe('reprocess (new route, contract §9.2)', () => {
  it('rejects a non-uuid id with 400 NWIS_BAD_REQUEST before calling the Space', async () => {
    signIn('reviewer');
    const spaceFake = fakeSpace();
    const res = mockRes();
    await reprocess(mockReq({ query: { documentId: 'not-a-uuid' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('NWIS_BAD_REQUEST');
    expect(spaceFake.calls).toHaveLength(0);
  });

  it('sends no body even if the browser sent one', async () => {
    signIn('reviewer');
    const spaceFake = fakeSpace({ status: 202, body: { document_id: DOCUMENT_ID, job_id: 'j' } });
    await reprocess(mockReq({ query: { documentId: DOCUMENT_ID }, body: { sneaky: true } }), mockRes());
    expect(spaceFake.calls[0].init.body).toBeUndefined();
    expect(spaceFake.calls[0].init.headers['Content-Type']).toBeUndefined();
  });

  it.each([
    [202, { document_id: DOCUMENT_ID, job_id: 'j' }],
    [404, { error: { code: 'NWIS_NOT_FOUND', message: 'Document not found', details: { document_id: DOCUMENT_ID } } }],
    [409, { error: { code: 'NWIS_BAD_STATE', message: 'This document is already being processed', details: { job_id: 'j' } } }],
  ])('passes the Space answer %i through unchanged', async (status, body) => {
    signIn('office_engineer');
    fakeSpace({ status, body });
    const res = mockRes();
    await reprocess(mockReq({ query: { documentId: DOCUMENT_ID } }), res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual(body);
  });

  it('lower-cases the id in the Space path', async () => {
    signIn('admin');
    const spaceFake = fakeSpace();
    await reprocess(mockReq({ query: { documentId: DOCUMENT_ID.toUpperCase() } }), mockRes());
    expect(spaceFake.calls[0].url.endsWith(`/documents/${DOCUMENT_ID}/reprocess`)).toBe(true);
  });
});

describe('well routes validate the wellbore id', () => {
  it.each([predictTops, correlation, risk])('returns 400 for a non-uuid id', async (handler) => {
    signIn('admin');
    const spaceFake = fakeSpace();
    const res = mockRes();
    await handler(mockReq({ method: handler === correlation ? 'GET' : 'POST', query: { wellboreId: '123' } }), res);
    expect(res.statusCode).toBe(400);
    expect(spaceFake.calls).toHaveLength(0);
  });

  it('correlation forwards offsets, flatten and channels and drops empty ones', async () => {
    signIn('rig_engineer');
    const spaceFake = fakeSpace();
    await correlation(
      mockReq({ method: 'GET', query: { wellboreId: WELLBORE_ID, offsets: `${DOCUMENT_ID},${USER_ID}`, flatten: 'Barail', channels: '' } }),
      mockRes(),
    );
    const url = new URL(spaceFake.calls[0].url);
    expect(url.searchParams.get('offsets')).toBe(`${DOCUMENT_ID},${USER_ID}`);
    expect(url.searchParams.get('flatten')).toBe('Barail');
    expect(url.searchParams.has('channels')).toBe(false);
  });

  it('correlation passes the Space 400 for an unknown channel through', async () => {
    signIn('rig_engineer');
    const body = { error: { code: 'NWIS_BAD_REQUEST', message: 'Unknown channel', details: {} } };
    fakeSpace({ status: 400, body });
    const res = mockRes();
    await correlation(mockReq({ method: 'GET', query: { wellboreId: WELLBORE_ID, channels: 'bogus' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(body);
  });
});

describe('retrain', () => {
  it('passes the Space 202 and its 409 through', async () => {
    signIn('admin');
    fakeSpace({ status: 202, body: { model_run_ids: [] } });
    const accepted = mockRes();
    await retrain(mockReq({ body: { risk_types: ['stuck_pipe'] } }), accepted);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.body).toEqual({ model_run_ids: [] });

    fakeSpace({ status: 409, body: { error: { code: 'NWIS_BAD_STATE', message: 'A retrain is already running', details: {} } } });
    const busy = mockRes();
    await retrain(mockReq({ body: {} }), busy);
    expect(busy.statusCode).toBe(409);
  });
});

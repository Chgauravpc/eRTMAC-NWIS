// Shared test helpers for the Vercel functions: fake req/res, a fake Supabase client, a fake Space (fetch).
import { vi } from 'vitest';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const WELLBORE_ID = '22222222-2222-4222-8222-222222222222';
export const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
export const ROLE_LIST = ['rig_engineer', 'rtoc_engineer', 'office_engineer', 'reviewer', 'admin'];

export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}

export function mockReq({ method = 'POST', token = 'good-token', headers = {}, body, query } = {}) {
  const base = token ? { authorization: `Bearer ${token}` } : {};
  return { method, headers: { ...base, ...headers }, body, query: query ?? {} };
}

export function setEnv() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.AI_SERVICE_URL = 'https://space.test/';
  process.env.SERVICE_TOKEN = 'service-token';
  delete process.env.FORWARD_TIMEOUT_MS;
}

/** A chainable stand-in for the part of supabase-js the routes use. `calls` records what was written. */
export function fakeSupabase({
  role = 'admin',
  userId = USER_ID,
  email = 'user@example.org',
  getUserError = null,
  profileError = null,
  invite = { data: { user: { id: '44444444-4444-4444-8444-444444444444' } }, error: null },
  signedUpload = { data: { signedUrl: 'https://supabase.test/signed', token: 'upload-token' }, error: null },
  upsertError = null,
  updateResult = { data: [{ id: userId }], error: null },
  auditError = null,
} = {}) {
  const calls = { upserts: [], updates: [], audits: [], invites: [], signed: [], buckets: [], getUser: [] };
  const client = {
    auth: {
      getUser: vi.fn(async (token) => {
        calls.getUser.push(token);
        return getUserError ? { data: { user: null }, error: getUserError } : { data: { user: { id: userId, email } }, error: null };
      }),
      admin: {
        inviteUserByEmail: vi.fn(async (address, options) => {
          calls.invites.push({ address, options });
          return invite;
        }),
      },
    },
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: async () => (profileError ? { data: null, error: profileError } : { data: role ? { role } : null, error: null }) }) }),
          upsert: async (row, options) => {
            calls.upserts.push({ row, options });
            return { error: upsertError };
          },
          update: (patch) => ({
            eq: (column, value) => ({
              select: async () => {
                calls.updates.push({ patch, column, value });
                return updateResult;
              },
            }),
          }),
        };
      }
      if (table === 'audit_log') {
        return {
          insert: async (row) => {
            calls.audits.push(row);
            return { error: auditError };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    storage: {
      from: vi.fn((bucket) => {
        calls.buckets.push(bucket);
        return {
          createSignedUploadUrl: vi.fn(async (path) => {
            calls.signed.push(path);
            return signedUpload;
          }),
        };
      }),
    },
  };
  return { client, calls };
}

/** Replace global fetch with a fake Space. `answer` is { status, body } or a function (url, init) -> that, or an Error to throw. */
export function fakeSpace(answer = { status: 200, body: { ok: true } }) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const result = typeof answer === 'function' ? await answer(url, init) : answer;
    if (result instanceof Error) throw result;
    const text = result.body === undefined || result.body === null ? '' : typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return new Response(text, { status: result.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

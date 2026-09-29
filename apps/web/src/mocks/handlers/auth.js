// Mock handlers: auth domain (see handlers/index.js).
// Supabase GoTrue endpoints (/auth/v1/*) and the profiles table (/rest/v1/profiles), plus the
// admin user routes (/api/admin/users*), so the real-mode code paths (signInWithPassword,
// resetPasswordForEmail, signOut, profiles select) also work when VITE_USE_MOCKS=true.
//
// Conventions:
//   - any email in fixtures/profiles.json signs in with any non-empty password except "wrong-password".
//   - access tokens look like `mock-token.<profile id>` so /auth/v1/user and RLS-like scoping can
//     identify the caller.
import { http, HttpResponse } from 'msw';
import { db } from '../db';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
export const MOCK_TOKEN_PREFIX = 'mock-token.';
export const BAD_PASSWORD = 'wrong-password';

const tokenFor = (id) => `${MOCK_TOKEN_PREFIX}${id}`;

function userFromRequest(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token.startsWith(MOCK_TOKEN_PREFIX)) return null;
  return db.getProfile(token.slice(MOCK_TOKEN_PREFIX.length));
}

function authUser(profile) {
  return {
    id: profile.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: profile.email,
    email_confirmed_at: profile.created_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: profile.full_name },
    created_at: profile.created_at,
    updated_at: profile.created_at,
  };
}

function sessionFor(profile) {
  const expiresIn = 3600;
  return {
    access_token: tokenFor(profile.id),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `mock-refresh.${profile.id}`,
    user: authUser(profile),
  };
}

const invalidCredentials = () =>
  HttpResponse.json(
    { code: 400, error_code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' },
    { status: 400 },
  );

const err = (code, message, status, details = {}) => HttpResponse.json({ error: { code, message, details } }, { status });

export const handlers = [
  // --- GoTrue ---
  http.post(`${SUPABASE_URL}/auth/v1/token`, async ({ request }) => {
    const grant = new URL(request.url).searchParams.get('grant_type');
    const body = await request.json().catch(() => ({}));
    if (grant === 'refresh_token') {
      const id = String(body.refresh_token || '').replace('mock-refresh.', '');
      const profile = db.getProfile(id);
      return profile ? HttpResponse.json(sessionFor(profile)) : invalidCredentials();
    }
    const profile = db.getProfileByEmail(body.email);
    if (!profile || !body.password || body.password === BAD_PASSWORD) return invalidCredentials();
    return HttpResponse.json(sessionFor(profile));
  }),

  http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
    const profile = userFromRequest(request);
    if (!profile) return HttpResponse.json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: 401 });
    return HttpResponse.json(authUser(profile));
  }),

  http.post(`${SUPABASE_URL}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),

  // resetPasswordForEmail: GoTrue always answers 200 {} (does not reveal whether the email exists).
  http.post(`${SUPABASE_URL}/auth/v1/recover`, () => HttpResponse.json({})),

  // --- profiles (RLS: own row, admin sees all) ---
  http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
    const url = new URL(request.url);
    const caller = userFromRequest(request); // null when the mock session lives only in AuthProvider
    let rows = db.profiles.slice();
    if (caller && caller.role !== 'admin') rows = rows.filter((p) => p.id === caller.id);
    const idFilter = url.searchParams.get('id');
    if (idFilter?.startsWith('eq.')) rows = rows.filter((p) => p.id === idFilter.slice(3));
    const roleFilter = url.searchParams.get('role');
    if (roleFilter?.startsWith('eq.')) rows = rows.filter((p) => p.role === roleFilter.slice(3));

    const wantsObject = (request.headers.get('accept') || '').includes('application/vnd.pgrst.object+json');
    if (wantsObject) {
      if (rows.length !== 1) {
        return HttpResponse.json(
          { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' },
          { status: 406 },
        );
      }
      return HttpResponse.json(rows[0]);
    }
    return HttpResponse.json(rows);
  }),

  // --- admin user routes (Node only, contract 9.2) ---
  http.post('/api/admin/users/invite', async ({ request }) => {
    const caller = userFromRequest(request);
    if (caller && caller.role !== 'admin') return err('NWIS_FORBIDDEN', 'Admin role required', 403);
    const body = await request.json();
    if (!body.email || !body.role) return err('NWIS_BAD_REQUEST', 'email and role are required', 400);
    if (db.getProfileByEmail(body.email)) return err('NWIS_BAD_STATE', 'A user with this email already exists', 409);
    const created = db.insert('profiles', {
      email: body.email,
      full_name: body.full_name || body.email,
      role: body.role,
      assigned_wellbore_ids: body.assigned_wellbore_ids || [],
      created_at: new Date().toISOString(),
    });
    return HttpResponse.json({ user_id: created.id });
  }),

  http.patch('/api/admin/users/:userId', async ({ request, params }) => {
    const caller = userFromRequest(request);
    if (caller && caller.role !== 'admin') return err('NWIS_FORBIDDEN', 'Admin role required', 403);
    const body = await request.json();
    const patch = {};
    if (body.role) patch.role = body.role;
    if (body.assigned_wellbore_ids) patch.assigned_wellbore_ids = body.assigned_wellbore_ids;
    const updated = db.update('profiles', params.userId, patch);
    return updated ? HttpResponse.json({ ok: true }) : err('NWIS_NOT_FOUND', 'User not found', 404);
  }),
];

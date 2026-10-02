// Contract §9.1: verify the Supabase access token, load profiles.role, check it against the route's role list.
import { createClient } from '@supabase/supabase-js';
import { forbidden, internal, unauthorized } from './errors.js';

export const ROLES = ['rig_engineer', 'rtoc_engineer', 'office_engineer', 'reviewer', 'admin'];
export const UPLOAD_ROLES = ['reviewer', 'office_engineer', 'admin']; // upload-url, documents, reprocess

/** A client with the service role (server-side only: it bypasses RLS). A new one per call keeps serverless simple. */
export function supabaseAdmin() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw internal('Supabase is not configured');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bearerToken(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * requireUser(req, allowedRoles?) -> { id, role, email }
 * 401 if the token is missing or invalid; 403 if the profile has no role or the role is not allowed.
 */
export async function requireUser(req, allowedRoles) {
  const token = bearerToken(req);
  if (!token) throw unauthorized();

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw unauthorized();

  const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
  if (profileError || !profile?.role) throw forbidden('No role is assigned to this account');
  if (allowedRoles && !allowedRoles.includes(profile.role)) throw forbidden(`Role ${profile.role} may not call this endpoint`);

  return { id: data.user.id, role: profile.role, email: data.user.email ?? null };
}

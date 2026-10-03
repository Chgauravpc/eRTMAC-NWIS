// POST /api/admin/users/invite: admin. Node only (contract §9.2).
// Invites the user by e-mail, sets their role and assigned wellbores on `profiles`, and writes an audit row.
import { requireUser, ROLES, supabaseAdmin } from '../../../_lib/auth.js';
import { ApiError, assertMethod, badRequest, isUuid, sendError, upstream } from '../../../_lib/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_CHARS = 200;

export function validateAssignments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isUuid)) throw badRequest('assigned_wellbore_ids must be a list of uuids');
  return [...new Set(value.map((v) => v.toLowerCase()))];
}

export function validateRole(value) {
  if (!ROLES.includes(value)) throw badRequest('Unknown role', { role: value, allowed: ROLES });
  return value;
}

export async function writeAudit(supabase, userId, action, entityId, details) {
  const { error } = await supabase.from('audit_log').insert({ user_id: userId, action, entity: 'profile', entity_id: entityId, details });
  if (error) console.error('audit_failed', action, error.message); // the change itself already happened
}

export default async function handler(req, res) {
  try {
    if (!assertMethod(req, res, 'POST')) return undefined;
    const admin = await requireUser(req, ['admin']);
    const { email, role, full_name: fullName, assigned_wellbore_ids: assigned } = req.body ?? {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) throw badRequest('A valid email is required');
    validateRole(role);
    if (fullName !== undefined && fullName !== null && (typeof fullName !== 'string' || fullName.length > MAX_NAME_CHARS)) {
      throw badRequest('full_name must be text of at most 200 characters');
    }
    const wellbores = validateAssignments(assigned);

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), { data: { full_name: fullName ?? null } });
    if (error || !data?.user) {
      if (error?.status === 400 || error?.status === 422) throw new ApiError(400, 'NWIS_BAD_REQUEST', error.message);
      throw upstream('Could not send the invitation', { reason: error?.message });
    }
    const userId = data.user.id;

    // the sign-up trigger normally creates the profile row; upsert so the role is set either way
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: userId, email: email.trim(), full_name: fullName ?? null, role, assigned_wellbore_ids: wellbores }, { onConflict: 'id' });
    if (profileError) throw upstream('The user was invited but their role could not be saved', { user_id: userId, reason: profileError.message });

    await writeAudit(supabase, admin.id, 'user.invite', userId, { email: email.trim(), role, assigned_wellbore_ids: wellbores });
    return res.status(200).json({ user_id: userId });
  } catch (err) {
    return sendError(res, err);
  }
}

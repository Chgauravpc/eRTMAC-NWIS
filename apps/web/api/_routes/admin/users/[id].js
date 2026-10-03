// PATCH /api/admin/users/{id}: admin. Node only (contract §9.2). Changes role and/or assigned wellbores; audit row.
import { requireUser, supabaseAdmin } from '../../../_lib/auth.js';
import { assertMethod, badRequest, notFound, requireUuid, sendError, upstream } from '../../../_lib/errors.js';
import { validateAssignments, validateRole, writeAudit } from './invite.js';

export default async function handler(req, res) {
  try {
    if (!assertMethod(req, res, 'PATCH')) return undefined;
    const admin = await requireUser(req, ['admin']);
    const userId = requireUuid(req.query?.id, 'id');

    const { role, assigned_wellbore_ids: assigned } = req.body ?? {};
    const patch = {};
    if (role !== undefined) patch.role = validateRole(role);
    if (assigned !== undefined) patch.assigned_wellbore_ids = validateAssignments(assigned);
    if (Object.keys(patch).length === 0) throw badRequest('Send role and/or assigned_wellbore_ids');

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('id');
    if (error) throw upstream('Could not update the user', { reason: error.message });
    if (!data || data.length === 0) throw notFound('User not found', { user_id: userId });

    await writeAudit(supabase, admin.id, 'user.update', userId, patch);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return sendError(res, err);
  }
}

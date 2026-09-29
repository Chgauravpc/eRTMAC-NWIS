// Mirrors contract §12 (alert lifecycle + permission table) so the UI shows only what the server allows.
// The server (RPCs in 0008_alert_rpcs.sql) still enforces every rule.
//
// | Action      | Who                                                          | Allowed from state                         | Severity |
// | acknowledge | rig_engineer assigned; rtoc_engineer; admin                  | sent, viewed, escalated                    | any      |
// | resolve     | rtoc/admin: any; rig assigned: info, watch                   | warning/critical: acknowledged;            |          |
// |             |                                                              | info/watch: sent, viewed, acknowledged     |          |
// | dismiss     | rig assigned, rtoc_engineer, admin                           | sent, viewed                               | info/watch |
// | rate        | the resolver, or any rig (assigned)/rtoc engineer, admin     | resolved                                   | any      |
// | view        | any user who can see the alert (rig: assigned wells only)    | any state (only 'sent' changes state)      | any      |

const LOW_SEVERITY = ['info', 'watch'];
const HIGH_SEVERITY = ['warning', 'critical'];

const isAssignedRig = (user, alert) =>
  user?.role === 'rig_engineer' && !!alert && (user.assigned_wellbore_ids || []).includes(alert.wellbore_id);
const isRtocOrAdmin = (user) => user?.role === 'rtoc_engineer' || user?.role === 'admin';

/** Rig engineers see only their assigned wells (RLS); everyone else sees all. */
export function canView(user, alert) {
  if (!user || !alert) return false;
  if (user.role === 'rig_engineer') return isAssignedRig(user, alert);
  return true;
}

export function canAcknowledge(user, alert) {
  if (!user || !alert) return false;
  if (!['sent', 'viewed', 'escalated'].includes(alert.state)) return false;
  return isRtocOrAdmin(user) || isAssignedRig(user, alert);
}

export function canResolve(user, alert) {
  if (!user || !alert) return false;
  const lowSev = LOW_SEVERITY.includes(alert.severity);
  const highSev = HIGH_SEVERITY.includes(alert.severity);
  const stateOk = highSev
    ? alert.state === 'acknowledged'
    : lowSev && ['sent', 'viewed', 'acknowledged'].includes(alert.state);
  if (!stateOk) return false;
  if (isRtocOrAdmin(user)) return true;
  return isAssignedRig(user, alert) && lowSev;
}

export function canDismiss(user, alert) {
  if (!user || !alert) return false;
  if (!LOW_SEVERITY.includes(alert.severity)) return false;
  if (!['sent', 'viewed'].includes(alert.state)) return false;
  return isRtocOrAdmin(user) || isAssignedRig(user, alert);
}

export function canRate(user, alert) {
  if (!user || !alert) return false;
  if (alert.state !== 'resolved') return false;
  if (alert.resolved_by && alert.resolved_by === user.id) return true;
  return isRtocOrAdmin(user) || isAssignedRig(user, alert);
}

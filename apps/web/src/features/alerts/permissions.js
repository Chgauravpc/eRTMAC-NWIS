export function canAcknowledge(user, alert) {
  if (!user || !alert) return false;
  if (!['sent', 'viewed', 'escalated'].includes(alert.state)) return false;
  
  if (user.role === 'admin' || user.role === 'rtoc_engineer') return true;
  if (user.role === 'rig_engineer' && user.assigned_wellbore_ids?.includes(alert.wellbore_id)) return true;
  return false;
}

export function canResolve(user, alert) {
  if (!user || !alert) return false;
  
  const isRigEng = user.role === 'rig_engineer' && user.assigned_wellbore_ids?.includes(alert.wellbore_id);
  const isHighPower = user.role === 'admin' || user.role === 'rtoc_engineer';

  if (!isRigEng && !isHighPower) return false;

  const isLowSev = ['info', 'watch'].includes(alert.severity);

  if (isHighPower) {
    if (['warning', 'critical'].includes(alert.severity)) {
      return alert.state === 'acknowledged';
    }
    return ['sent', 'viewed', 'acknowledged', 'escalated'].includes(alert.state);
  }

  if (isRigEng) {
    if (!isLowSev) return false; // Rig engineers cannot manually resolve warning/critical
    return ['sent', 'viewed', 'acknowledged', 'escalated'].includes(alert.state);
  }

  return false;
}

export function canDismiss(user, alert) {
  if (!user || !alert) return false;
  if (!['info', 'watch'].includes(alert.severity)) return false;
  if (!['sent', 'viewed'].includes(alert.state)) return false;
  
  if (user.role === 'admin' || user.role === 'rtoc_engineer') return true;
  if (user.role === 'rig_engineer' && user.assigned_wellbore_ids?.includes(alert.wellbore_id)) return true;
  return false;
}

export function canRate(user, alert) {
  if (!user || !alert) return false;
  if (alert.state !== 'resolved') return false;
  
  // the resolver, or any rig/rtoc engineer on that well
  if (alert.resolved_by === user.id) return true;
  if (user.role === 'admin') return true;
  if (user.role === 'rtoc_engineer') return true;
  if (user.role === 'rig_engineer' && user.assigned_wellbore_ids?.includes(alert.wellbore_id)) return true;
  
  return false;
}

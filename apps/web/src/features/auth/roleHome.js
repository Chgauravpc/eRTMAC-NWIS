/**
 * Home page per role (PRD section 4): rig engineer -> /rig/<first assigned wellbore>,
 * reviewer -> /review, everyone else (and a rig engineer with no assignment) -> /wells.
 */
export function roleHome(profile) {
  if (!profile) return '/login';
  if (profile.role === 'rig_engineer') {
    const first = profile.assigned_wellbore_ids?.[0];
    return first ? `/rig/${first}` : '/wells';
  }
  if (profile.role === 'reviewer') return '/review';
  return '/wells';
}

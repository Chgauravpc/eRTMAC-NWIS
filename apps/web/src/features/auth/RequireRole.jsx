import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useProfile } from './useProfile';
import { Button, Spinner, ErrorState } from '../../components/ui/Primitives';
import { ForbiddenPage } from './ForbiddenPage';

/**
 * Route guard. No session -> /login (remembering where you were going). Session but no profile row
 * -> an explicit error with sign-out. Role not in `roles` -> 403 page. `roles` omitted = any signed-in role.
 */
export function RequireRole({ roles, children }) {
  const { session, profile, isLoading, profileError, signOut } = useProfile();
  const location = useLocation();

  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!profile) {
    return (
      <div className="p-10 max-w-lg mx-auto">
        <ErrorState
          title="Your profile could not be loaded"
          message={profileError || 'No profile is set up for this account. Ask an administrator.'}
        />
        <Button className="mt-4" variant="outline" onClick={() => signOut?.()}>Sign out</Button>
      </div>
    );
  }
  if (roles && !roles.includes(profile.role)) return <ForbiddenPage role={profile.role} />;

  return children;
}

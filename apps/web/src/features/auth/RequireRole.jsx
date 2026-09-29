import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useProfile } from './useProfile';
import { Spinner, ErrorState } from '../../components/ui/Primitives';

export function RequireRole({ roles, children }) {
  const { session, profile, isLoading } = useProfile();
  const location = useLocation();

  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  if (!session || !profile) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="p-10">
        <ErrorState message="403 Forbidden: You do not have permission to access this page." />
      </div>
    );
  }

  return children;
}

import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ROLE_LABELS } from '../../lib/constants';
import { FOCUS_RING, cn } from '../../components/ui/Primitives';

/** 403 page shown by RequireRole when the signed-in role may not open a route. */
export function ForbiddenPage({ role }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center p-10 max-w-lg mx-auto">
      <ShieldAlert className="h-10 w-10 text-red-600 mb-3" aria-hidden="true" />
      <h1 className="text-2xl font-bold text-gray-900">403 Forbidden</h1>
      <p className="mt-2 text-gray-600">
        {role ? `Your role (${ROLE_LABELS[role] || role}) does not have access to this page.` : 'You do not have access to this page.'}
      </p>
      <Link to="/" className={cn('mt-6 rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700', FOCUS_RING)}>
        Go to my home page
      </Link>
    </div>
  );
}

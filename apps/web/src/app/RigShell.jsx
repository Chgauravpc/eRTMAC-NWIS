import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../components/ui/Primitives';
import { UserBar } from './Layout';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Wrapper for the full-screen rig view: a slim dark strip with the user, role badge, sign-out and the
 * sound button above the rig page (which brings its own banner and header).
 */
export function RigShell({ children }) {
  return (
    <div className="rig flex min-h-screen flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-950 px-4 py-2 text-gray-100">
        <Link to="/" className="text-sm font-bold tracking-widest">NWIS</Link>
        <UserBar />
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className="flex justify-center p-10"><Spinner /></div>}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  );
}

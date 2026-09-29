import React from 'react';
import { Spinner } from '../../components/ui/Primitives';

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-gray-400">
      <Spinner className="text-blue-500" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyBlock({ children }) {
  return <div className="p-6 text-center text-sm text-gray-500">{children}</div>;
}

export function ErrorBlock({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" className="m-2 flex items-center justify-between gap-4 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded border border-red-800 bg-transparent px-3 py-1 font-medium text-red-300 hover:bg-red-900/50 transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

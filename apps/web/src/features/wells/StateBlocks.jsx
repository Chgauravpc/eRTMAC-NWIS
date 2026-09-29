import React from 'react';
import { Spinner } from '../../components/ui/Primitives';

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-gray-500">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyBlock({ children }) {
  return <div className="p-6 text-center text-sm text-gray-500">{children}</div>;
}

export function ErrorBlock({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" className="m-2 flex items-center justify-between gap-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded border border-red-300 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-100">
          Retry
        </button>
      )}
    </div>
  );
}

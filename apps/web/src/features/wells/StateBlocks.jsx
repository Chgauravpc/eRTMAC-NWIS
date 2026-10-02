import React from 'react';
import { Spinner } from '../../components/ui/Primitives';

/** `light` = the block sits on a white page (workspace tabs are dark, the default). */
// @contrast-skip has a `light` prop: gray-400 on #0f172a is 7.2:1, gray-700 on white is 10.3:1, blue-400 / blue-700 are icons
export function LoadingBlock({ label = 'Loading…', light = false }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 p-8 text-sm ${light ? 'text-gray-700' : 'text-gray-400'}`}>
      <Spinner className={light ? 'text-blue-700' : 'text-blue-400'} />
      <span>{label}</span>
    </div>
  );
}

// @contrast-skip has a `light` prop: gray-400 on #0f172a is 7.2:1, gray-700 on white is 10.3:1
export function EmptyBlock({ children, light = false }) {
  return <div className={`p-6 text-center text-sm ${light ? 'text-gray-700' : 'text-gray-400'}`}>{children}</div>;
}

/** Carries its own light surface, so it reads the same on a white or a dark page. */
export function ErrorBlock({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" className="m-2 flex items-center justify-between gap-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded border border-red-700 bg-white px-3 py-1 font-medium text-red-800 hover:bg-red-100 transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

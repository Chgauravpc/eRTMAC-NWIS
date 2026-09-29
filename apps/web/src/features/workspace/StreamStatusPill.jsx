import React from 'react';
import { cn } from '../../components/ui/Primitives';
import { fmtTimeAgo } from '../../lib/units';

export function StreamStatusPill({ status, lastSampleAt }) {
  let color = 'bg-gray-100 text-gray-800 border-gray-200';
  let text = 'stopped';

  if (status === 'live') {
    color = 'bg-green-100 text-green-800 border-green-200';
    text = 'live';
  } else if (status === 'stale') {
    color = 'bg-amber-100 text-amber-800 border-amber-200';
    text = `last data ${fmtTimeAgo(lastSampleAt)}`;
  } else if (status === 'lost') {
    color = 'bg-red-100 text-red-800 border-red-200';
    text = `last data ${fmtTimeAgo(lastSampleAt)}`;
  }

  return (
    <span data-testid="stream-status" className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", color)}>
      {text}
    </span>
  );
}

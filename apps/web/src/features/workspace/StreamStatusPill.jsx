import React, { useEffect, useState } from 'react';
import { Clock, PauseCircle, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../../components/ui/Primitives';
import { fmtTimeAgo } from '../../lib/units';

const CONFIG = {
  live: { cls: 'bg-green-100 text-green-800 border-green-200', Icon: Wifi },
  stale: { cls: 'bg-amber-100 text-amber-800 border-amber-200', Icon: Clock },
  lost: { cls: 'bg-red-100 text-red-800 border-red-200', Icon: WifiOff },
  stopped: { cls: 'bg-gray-100 text-gray-800 border-gray-200', Icon: PauseCircle },
};

/** Stream status: icon + word (never colour alone); stale/lost add "last data {time ago}". */
export function StreamStatusPill({ status = 'stopped', lastSampleAt }) {
  const cfg = CONFIG[status] || CONFIG.stopped;
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'stale' && status !== 'lost') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [status]);

  const ago = status === 'stale' || status === 'lost' ? ` · last data ${fmtTimeAgo(lastSampleAt)}` : '';
  const { Icon } = cfg;
  return (
    <span
      data-testid="stream-status"
      data-status={status}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', cfg.cls)}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      <span>{`${status}${ago}`}</span>
    </span>
  );
}

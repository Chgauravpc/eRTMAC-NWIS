import React, { useEffect, useState } from 'react';
import { Clock, PauseCircle, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../../components/ui/Primitives';
import { fmtTimeAgo } from '../../lib/units';

// `light` variants keep >= 4.5:1 contrast on a white page (the default ones are for dark headers).
const LIGHT = {
  live: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  stale: 'bg-amber-50 text-amber-800 border-amber-300',
  lost: 'bg-red-50 text-red-800 border-red-300',
  stopped: 'bg-gray-100 text-gray-700 border-gray-300',
};

const CONFIG = {
  live: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', Icon: Wifi },
  stale: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20', Icon: Clock },
  lost: { cls: 'bg-red-500/10 text-red-400 border-red-500/20', Icon: WifiOff },
  stopped: { cls: 'bg-gray-800 text-gray-400 border-gray-700', Icon: PauseCircle },
};

/** Stream status: icon + word (never colour alone); stale/lost add "last data {time ago}". */
export function StreamStatusPill({ status = 'stopped', lastSampleAt, light = false }) {
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
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', light ? LIGHT[status] || LIGHT.stopped : cfg.cls)}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      <span className="capitalize">{`${status}${ago}`}</span>
    </span>
  );
}

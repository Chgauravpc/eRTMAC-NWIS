import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Eye, Info } from 'lucide-react';

const SEVERITIES = [
  { key: 'critical', label: 'Critical', Icon: AlertOctagon, icon: 'text-red-400', chip: 'bg-red-500/10 border-red-500/20 text-red-100' },
  { key: 'warning', label: 'Warning', Icon: AlertTriangle, icon: 'text-orange-400', chip: 'bg-orange-500/10 border-orange-500/20 text-orange-100' },
  { key: 'watch', label: 'Watch', Icon: Eye, icon: 'text-amber-400', chip: 'bg-amber-500/10 border-amber-500/20 text-amber-100' },
  { key: 'info', label: 'Info', Icon: Info, icon: 'text-sky-400', chip: 'bg-sky-500/10 border-sky-500/20 text-sky-100' },
];

/** Open alert counts by severity: icon + word + number per non-zero severity. */
export function AlertCountChips({ counts }) {
  const shown = SEVERITIES.filter((s) => (counts?.[s.key] ?? 0) > 0);
  if (shown.length === 0) {
    return (
      <span data-testid="alert-counts" className="inline-flex items-center gap-1 text-xs text-gray-400">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-400" />
        No open alerts
      </span>
    );
  }
  return (
    <ul data-testid="alert-counts" aria-label="Open alerts by severity" className="flex flex-wrap gap-1.5">
      {shown.map(({ key, label, Icon, icon, chip }) => (
        <li key={key} data-severity={key} className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase ${chip}`}>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${icon}`} />
          {counts[key]} {label}
        </li>
      ))}
    </ul>
  );
}

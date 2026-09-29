import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Eye, Info } from 'lucide-react';

const SEVERITIES = [
  { key: 'critical', label: 'Critical', Icon: AlertOctagon, icon: 'text-risk-critical', chip: 'bg-red-50 border-red-200' },
  { key: 'warning', label: 'Warning', Icon: AlertTriangle, icon: 'text-risk-high', chip: 'bg-orange-50 border-orange-200' },
  { key: 'watch', label: 'Watch', Icon: Eye, icon: 'text-risk-elevated', chip: 'bg-amber-50 border-amber-200' },
  { key: 'info', label: 'Info', Icon: Info, icon: 'text-risk-moderate', chip: 'bg-sky-50 border-sky-200' },
];

/** Open alert counts by severity: icon + word + number per non-zero severity. */
export function AlertCountChips({ counts }) {
  const shown = SEVERITIES.filter((s) => (counts?.[s.key] ?? 0) > 0);
  if (shown.length === 0) {
    return (
      <span data-testid="alert-counts" className="inline-flex items-center gap-1 text-xs text-gray-500">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
        No open alerts
      </span>
    );
  }
  return (
    <ul data-testid="alert-counts" aria-label="Open alerts by severity" className="flex flex-wrap gap-1.5">
      {shown.map(({ key, label, Icon, icon, chip }) => (
        <li key={key} data-severity={key} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium text-gray-900 ${chip}`}>
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${icon}`} />
          {counts[key]} {label}
        </li>
      ))}
    </ul>
  );
}

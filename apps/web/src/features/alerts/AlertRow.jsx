import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { RISK_LABELS } from '../../lib/constants';
import { bandFor } from '../../lib/risk';
import { BandBadge, SeverityBadge } from '../risk/BandBadge';
import { fmtAge } from './alertUtils';

const STATE_WORD = {
  generated: 'Generated',
  sent: 'Sent',
  viewed: 'Viewed',
  escalated: 'Escalated',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  feedback: 'Feedback given',
};

/** Compact alert line for lists: severity, title, well, zone, state, live age counter, Open button. */
export function AlertRow({ alert, wellName, now, onOpen, showAge = true, pinned = false }) {
  const band = alert.score != null ? bandFor(alert.score) : null;
  return (
    <li
      data-alert-id={alert.id}
      data-severity={alert.severity}
      data-state={alert.state}
      className={`flex flex-wrap items-center gap-3 rounded-lg border-2 bg-white p-3 text-gray-900 ${pinned ? 'border-red-800' : 'border-gray-400'}`}
    >
      {alert.kind === 'system' && <ShieldAlert size={18} aria-label="System alert" />}
      <SeverityBadge severity={alert.severity} kind={alert.kind} />
      {band && <BandBadge band={band} score={alert.score} />}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{alert.title}</div>
        <div className="text-sm text-gray-800">
          {wellName ?? 'Unknown well'}
          {alert.risk_type ? ` · ${RISK_LABELS[alert.risk_type] ?? alert.risk_type}` : ''}
          {alert.zone_md_from_m != null ? ` · ${alert.zone_md_from_m}–${alert.zone_md_to_m} m` : ''}
          {alert.outcome ? ` · outcome: ${String(alert.outcome).replace(/_/g, ' ')}` : ''}
          {alert.useful != null ? ` · ${alert.useful ? 'rated useful' : 'rated not useful'}` : ''}
        </div>
      </div>
      <span className="rounded border border-gray-700 px-2 py-0.5 text-sm font-medium">{STATE_WORD[alert.state] ?? alert.state}</span>
      {showAge && (
        <span data-testid="alert-age" aria-label={`Open for ${fmtAge(alert.created_at, now)}`} className="w-16 text-right font-mono text-sm tabular-nums">
          {fmtAge(alert.created_at, now)}
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(alert)}
        aria-label={`Open alert: ${alert.title}`}
        className="min-h-[48px] min-w-[48px] rounded-lg border-2 border-gray-800 px-4 font-semibold"
      >
        Open
      </button>
    </li>
  );
}

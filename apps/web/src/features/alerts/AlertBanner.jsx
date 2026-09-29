import React from 'react';
import { Bell, WifiOff } from 'lucide-react';
import { useProfile } from '../auth/useProfile';
import { severityRank } from '../../lib/risk';
import { useAlertActions, useRealtimeConnected } from '../../lib/hooks/alerts';
import { useAlerts } from './AlertProvider';
import { canAcknowledge } from './permissions';
import { depthPhrase, isPinned } from './alertUtils';
import { SeverityBadge } from '../risk/BandBadge';

// Contrast: black on orange-300 and white on red-800 are both above 7:1.
const TONE = {
  warning: 'bg-orange-300 text-black border-orange-700',
  critical: 'bg-red-800 text-white border-red-950',
};

/** Live connection indicator (PRD §9: show "Reconnecting…" when Realtime drops). */
export function ConnectionIndicator() {
  const connected = useRealtimeConnected();
  if (connected) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-gray-900 px-4 py-2 text-lg font-semibold text-white">
      <WifiOff size={16} aria-hidden="true" /> Reconnecting… live updates are paused; open alerts are refetched when the link returns.
    </div>
  );
}

/**
 * Top-of-screen banner for unacknowledged warning/critical alerts (states generated, sent, viewed,
 * escalated). Shows title, well NAME and "~N m ahead"; "View" opens the alert card full screen.
 */
export function AlertBanner() {
  const { alerts, wellNames, bitDepths, openAlert, notificationPermission, requestNotificationPermission } = useAlerts();
  const { profile } = useProfile();
  const actions = useAlertActions();

  const pinned = alerts
    .filter(isPinned)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Date.parse(b.created_at) - Date.parse(a.created_at));
  const top = pinned[0];
  const canAsk = typeof Notification !== 'undefined' && notificationPermission === 'default';

  return (
    <div data-testid="alert-banner-region">
      <ConnectionIndicator />
      {canAsk && (
        <div className="flex justify-end bg-gray-100 px-4 py-1">
          <button
            type="button"
            onClick={requestNotificationPermission}
            className="inline-flex min-h-[48px] items-center gap-2 text-lg font-medium text-gray-900 underline"
          >
            <Bell size={16} aria-hidden="true" /> Enable browser notifications
          </button>
        </div>
      )}
      {top && (
        <div
          role={top.severity === 'critical' ? 'alert' : 'status'}
          aria-live={top.severity === 'critical' ? 'assertive' : 'polite'}
          aria-atomic="true"
          data-severity={top.severity}
          className={`flex flex-wrap items-center justify-between gap-3 border-b-4 px-4 py-3 text-lg ${TONE[top.severity]}`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <SeverityBadge severity={top.severity} kind={top.kind} large className="bg-white text-black" />
            <strong>{top.title}</strong>
            <span>· {wellNames[top.wellbore_id] ?? top.well_name ?? 'Unknown well'}</span>
            {depthPhrase(top, bitDepths[top.wellbore_id]) && <span>· {depthPhrase(top, bitDepths[top.wellbore_id])}</span>}
            {top.state === 'escalated' && (
              <span className="rounded border-2 border-current px-2 font-bold">Escalated to RTOC lead</span>
            )}
            {pinned.length > 1 && <span>(+{pinned.length - 1} more)</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openAlert(top)}
              className="min-h-[48px] min-w-[48px] rounded-lg border-2 border-current px-4 font-semibold"
            >
              View
            </button>
            {canAcknowledge(profile, top) && (
              <button
                type="button"
                disabled={actions.pending}
                onClick={() => actions.ack(top.id)}
                className="min-h-[48px] min-w-[48px] rounded-lg border-2 border-current bg-white px-4 font-semibold text-black disabled:opacity-60"
              >
                Acknowledge
              </button>
            )}
          </div>
          {actions.error && (
            <p role="alert" className="w-full rounded bg-white px-3 py-1 font-medium text-red-900">
              {actions.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AlertBanner;

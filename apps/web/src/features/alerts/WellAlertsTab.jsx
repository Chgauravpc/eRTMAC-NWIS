import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useNow, useWellHistory } from '../../lib/hooks/alerts';
import { useAlerts } from './AlertProvider';
import { AlertRow } from './AlertRow';
import { compareBySeverityThenAge } from './alertUtils';

/** Outcome + feedback summary of resolved alerts (PRD: history with outcome and feedback). */
export function summarizeHistory(history) {
  const s = { total: history.length, avoided: 0, event_occurred: 0, false_alarm: 0, unknown: 0, useful: 0, notUseful: 0, unrated: 0 };
  for (const a of history) {
    if (a.outcome && s[a.outcome] != null) s[a.outcome] += 1;
    else s.unknown += 1;
    if (a.useful === true) s.useful += 1;
    else if (a.useful === false) s.notUseful += 1;
    else s.unrated += 1;
  }
  return s;
}

/** Alerts of one well: the open ones (shared provider list, live) and the resolved history. */
export function WellAlertsTab() {
  const { wellboreId } = useParams();
  const { alerts, wellNames, openAlert } = useAlerts();
  const historyQ = useWellHistory(wellboreId);
  const now = useNow(1000);
  const wellName = wellNames[wellboreId] ?? null;

  const open = useMemo(() => alerts.filter((a) => a.wellbore_id === wellboreId).sort(compareBySeverityThenAge), [alerts, wellboreId]);
  const history = useMemo(
    () => [...(historyQ.data || [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [historyQ.data]
  );
  const summary = summarizeHistory(history);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <section aria-label="Open alerts">
        <h2 className="mb-2 text-xl font-bold">Open alerts ({open.length})</h2>
        {open.length > 0 ? (
          <ul className="space-y-2">
            {open.map((a) => (
              <AlertRow key={a.id} alert={a} wellName={wellName} now={now} onOpen={openAlert} pinned={a.severity === 'critical' && a.state !== 'acknowledged'} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border-2 border-dashed border-gray-500 p-6 text-center text-gray-800">No open alerts for this well.</p>
        )}
      </section>

      <section aria-label="Alert history">
        <h2 className="mb-2 text-xl font-bold">History ({history.length})</h2>
        {history.length > 0 && (
          <p data-testid="history-summary" className="mb-3 rounded-lg border border-gray-500 bg-white p-3 text-sm">
            Outcomes: {summary.avoided} avoided, {summary.event_occurred} event occurred, {summary.false_alarm} false alarm
            {summary.unknown ? `, ${summary.unknown} unknown` : ''}. Feedback: {summary.useful} useful, {summary.notUseful} not useful, {summary.unrated} not rated.
          </p>
        )}
        {historyQ.isLoading ? (
          <p role="status">Loading history…</p>
        ) : history.length > 0 ? (
          <ul className="space-y-2">
            {history.map((a) => (
              <AlertRow key={a.id} alert={a} wellName={wellName} now={now} onOpen={openAlert} showAge={false} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border-2 border-dashed border-gray-500 p-6 text-center text-gray-800">No resolved alerts for this well yet.</p>
        )}
      </section>
    </div>
  );
}

export default WellAlertsTab;

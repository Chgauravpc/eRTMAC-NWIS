import React, { useMemo, useState } from 'react';
import { Pin } from 'lucide-react';
import { useNow } from '../../lib/hooks/alerts';
import { useAlerts } from './AlertProvider';
import { AlertRow } from './AlertRow';
import { compareBySeverityThenAge, isPinned } from './alertUtils';

const STATE_FILTERS = ['generated', 'sent', 'viewed', 'escalated', 'acknowledged'];
const SORTS = {
  severity: compareBySeverityThenAge,
  age: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
};

/**
 * /alerts (RTOC): every open alert from v_open_alerts (the provider's shared list, live through
 * Realtime), grouped by well NAME, sortable by severity or age, filterable by state. Unacknowledged
 * warning/critical alerts are pinned on top with running age counters.
 */
export function AlertsPage() {
  const { alerts, isLoading, wellNames, openAlert } = useAlerts();
  const now = useNow(1000);
  const [states, setStates] = useState(() => new Set(STATE_FILTERS));
  const [sort, setSort] = useState('severity');

  const toggle = (s) =>
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const nameOf = (a) => wellNames[a.wellbore_id] ?? a.well_name ?? 'Unknown well';

  const { pinned, groups } = useMemo(() => {
    const visible = alerts.filter((a) => states.has(a.state));
    const pin = visible.filter(isPinned).sort(compareBySeverityThenAge);
    const rest = visible.filter((a) => !isPinned(a));
    const byWell = new Map();
    for (const a of rest) {
      const name = wellNames[a.wellbore_id] ?? a.well_name ?? 'Unknown well';
      if (!byWell.has(name)) byWell.set(name, []);
      byWell.get(name).push(a);
    }
    const sorted = [...byWell.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => [name, [...list].sort(SORTS[sort])]);
    return { pinned: pin, groups: sorted };
  }, [alerts, states, sort, wellNames]);

  const total = pinned.length + groups.reduce((n, [, l]) => n + l.length, 0);

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">Open alerts</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-1">
            {STATE_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={states.has(s)}
                onClick={() => toggle(s)}
                className={`min-h-[44px] rounded-lg border-2 px-3 text-sm font-semibold capitalize ${states.has(s) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-500 bg-white text-gray-900'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-[44px] rounded-lg border-2 border-gray-500 px-2">
              <option value="severity">Severity</option>
              <option value="age">Age (oldest first)</option>
            </select>
          </label>
        </div>
      </div>

      {isLoading && <p role="status">Loading alerts…</p>}

      {pinned.length > 0 && (
        <section aria-label="Needs acknowledgement" className="mb-6 rounded-xl border-2 border-red-800 bg-red-50 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-red-950">
            <Pin size={18} aria-hidden="true" /> Needs acknowledgement ({pinned.length})
          </h2>
          <ul className="space-y-2">
            {pinned.map((a) => (
              <AlertRow key={a.id} alert={a} wellName={nameOf(a)} now={now} onOpen={openAlert} pinned />
            ))}
          </ul>
        </section>
      )}

      {groups.map(([name, list]) => (
        <section key={name} aria-label={`Alerts for ${name}`} className="mb-6">
          <h2 className="mb-2 text-lg font-bold">
            {name} <span className="text-sm font-medium text-gray-800">({list.length})</span>
          </h2>
          <ul className="space-y-2">
            {list.map((a) => (
              <AlertRow key={a.id} alert={a} wellName={name} now={now} onOpen={openAlert} />
            ))}
          </ul>
        </section>
      ))}

      {!isLoading && total === 0 && (
        <p className="rounded-xl border-2 border-dashed border-gray-500 p-10 text-center text-lg text-gray-800">
          No open alerts match the current filter.
        </p>
      )}
    </div>
  );
}

export default AlertsPage;

import React, { useMemo, useState } from 'react';
import { useNow } from '../../lib/hooks/alerts';
import { useAlerts } from './AlertProvider';
import { AlertRow } from './AlertRow';
import { compareBySeverityThenAge, depthPhrase, isPinned, isUnacked } from './alertUtils';

// Open states only: resolved / feedback alerts live in each well's history tab.
const OPEN_STATE_FILTERS = Object.freeze(['generated', 'sent', 'viewed', 'escalated', 'acknowledged']);
const SORTS = Object.freeze({ severity: 'Severity', age: 'Age (oldest first)' });
const byAge = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);

/** Mean time from creation to acknowledgement as "04m" / "1h 05m"; an em dash when nothing was acknowledged. */
function avgResponse(alerts) {
  const times = alerts
    .filter((a) => a.acknowledged_at && a.created_at)
    .map((a) => new Date(a.acknowledged_at) - new Date(a.created_at))
    .filter((ms) => ms >= 0);
  if (!times.length) return { label: '—', n: 0 };
  const mins = Math.round(times.reduce((x, y) => x + y, 0) / times.length / 60000);
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${String(mins).padStart(2, '0')}m`;
  return { label, n: times.length };
}

export function AlertsPage() {
  const { alerts = [], wellNames = {}, openAlert } = useAlerts();
  const now = useNow(1000);
  const [states, setStates] = useState(() => new Set(OPEN_STATE_FILTERS));
  const [sort, setSort] = useState('severity');

  const open = useMemo(() => [...alerts].sort(compareBySeverityThenAge), [alerts]);
  const unacked = open.filter(isUnacked);
  const unackedWells = new Set(unacked.map((a) => a.wellbore_id)).size;
  const critical = open.filter((a) => a.severity === 'critical');
  const topCritical = critical[0];
  const response = avgResponse(alerts);
  const nameOf = (a) => wellNames[a.wellbore_id] || 'Unknown well';

  // Unacknowledged warning/critical are pinned on top and never hidden by a filter.
  const pinned = open.filter(isPinned);
  const groups = useMemo(() => {
    const cmp = sort === 'age' ? byAge : compareBySeverityThenAge;
    const byWell = new Map();
    for (const a of alerts) {
      if (isPinned(a) || !states.has(a.state)) continue;
      const name = wellNames[a.wellbore_id] || 'Unknown well';
      if (!byWell.has(name)) byWell.set(name, []);
      byWell.get(name).push(a);
    }
    return [...byWell.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([name, list]) => [name, list.sort(cmp)]);
  }, [alerts, states, sort, wellNames]);

  const toggle = (state) =>
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-2">
          Operations / Response Center
        </div>
        <h1 className="text-5xl font-medium tracking-tight text-gray-900 mb-3">Open alerts</h1>
        <p className="text-gray-600 text-lg">A calm view of signals that need an engineering decision.</p>
      </div>

      <div className="border-y border-gray-200 bg-gray-50/50 flex mb-8">
        <div className="flex-1 p-6 border-r border-gray-200">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Unacknowledged</div>
          <div className="text-4xl font-medium text-[#b45309] mb-1">{String(unacked.length).padStart(2, '0')}</div>
          <div className="text-sm text-gray-600">Across {unackedWells} {unackedWells === 1 ? 'well' : 'wells'}</div>
        </div>
        <div className="flex-1 p-6 border-r border-gray-200">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Critical</div>
          <div className="text-4xl font-medium text-red-700 mb-1">{String(critical.length).padStart(2, '0')}</div>
          <div className="text-sm text-gray-600">{topCritical ? `${nameOf(topCritical)} · ${depthPhrase(topCritical)}` : 'None open'}</div>
        </div>
        <div className="flex-1 p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Avg response</div>
          <div className="text-4xl font-medium text-gray-900 mb-1">{response.label}</div>
          <div className="text-sm text-gray-600">{response.n ? `Across ${response.n} acknowledged` : 'None acknowledged yet'}</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <p className="rounded border border-dashed border-gray-400 p-8 text-center text-gray-700">No open alerts. New alerts appear here as they are raised.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div role="group" aria-label="Filter by state" className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">State</span>
              {OPEN_STATE_FILTERS.map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={states.has(st)}
                  onClick={() => toggle(st)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${states.has(st) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-400 bg-white text-gray-700'}`}
                >
                  {st}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded border border-gray-400 bg-white px-2 py-1 text-sm">
                {Object.entries(SORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {pinned.length > 0 && (
            <section aria-label="Needs acknowledgement" className="mb-8">
              <h2 className="mb-2 text-xl font-bold text-red-800">Needs acknowledgement ({pinned.length})</h2>
              <ul className="space-y-2">
                {pinned.map((a) => (
                  <AlertRow key={a.id} alert={a} wellName={nameOf(a)} now={now} onOpen={openAlert} pinned />
                ))}
              </ul>
            </section>
          )}

          {groups.map(([name, list]) => (
            <section key={name} aria-label={`Alerts for ${name}`} className="mb-6">
              <h2 className="mb-2 text-lg font-bold text-gray-900">{name} <span className="text-sm font-normal text-gray-600">({list.length})</span></h2>
              <ul className="space-y-2">
                {list.map((a) => (
                  <AlertRow key={a.id} alert={a} wellName={name} now={now} onOpen={openAlert} />
                ))}
              </ul>
            </section>
          ))}
          {pinned.length === 0 && groups.length === 0 && (
            <p className="rounded border border-dashed border-gray-400 p-8 text-center text-gray-700">No alerts match the selected states.</p>
          )}
        </>
      )}
    </div>
  );
}

export default AlertsPage;

import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOpenAlertCounts, useStreamStates, useWells, useFormationAtMd } from '../../lib/hooks/wells';
import { sortDrillingFirst } from '../../lib/data/wells';
import { PROVENANCES, RISK_LABELS, RISK_TYPES, WELL_STATUSES } from '../../lib/constants';
import { fmtDepth, fmtDuration } from '../../lib/units';
import { ProvenanceBadge } from './ProvenanceBadge';
import { AlertCountChips } from './AlertCountChips';
import { StreamStatusPill } from '../workspace/StreamStatusPill';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './StateBlocks';
import { Map, ChevronRight, Activity, Download, Search } from 'lucide-react';

const FILTER = 'border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-700 bg-white outline-none focus:border-gray-500';
const TH = 'px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-600';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const riskLabel = (type) => (type ? RISK_LABELS[type] || type.replace('_', ' ') : '-');

/** Download the rows currently shown in the table as a CSV file. */
function exportCsv(rows) {
  const head = ['well', 'field', 'status', 'td_md_m', 'event_count', 'npt_h_total', 'provenance', 'top_risk_type'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(','), ...rows.map((w) => [w.well_name, w.field, w.status, w.td_md_m, w.event_count, w.npt_h_total, w.provenance, w.top_risk_type].map(cell).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wells.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function WellsPage() {
  const navigate = useNavigate();
  const { data: wells, isLoading, error, refetch } = useWells();
  const { data: streams } = useStreamStates();
  const { data: alertCounts } = useOpenAlertCounts();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const [provenance, setProvenance] = useState('');

  const drilling = useMemo(() => sortDrillingFirst((wells || []).filter((w) => w.status === 'drilling')), [wells]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortDrillingFirst(wells || []).filter(
      (w) =>
        (!q || w.well_name?.toLowerCase().includes(q) || w.field?.toLowerCase().includes(q)) &&
        (!status || w.status === status) &&
        (!risk || w.top_risk_type === risk) &&
        (!provenance || w.provenance === provenance),
    );
  }, [wells, search, status, risk, provenance]);
  const filtering = !!(search.trim() || status || risk || provenance);

  const summary = useMemo(() => {
    const counts = Object.values(alertCounts || {});
    const live = drilling.filter((w) => streams?.[w.wellbore_id]?.status === 'live').length;
    return {
      openAlerts: counts.reduce((n, c) => n + c.total, 0),
      highPriority: counts.reduce((n, c) => n + c.critical + c.warning, 0),
      needReview: counts.filter((c) => c.critical + c.warning > 0).length,
      livePct: drilling.length ? Math.round((live / drilling.length) * 1000) / 10 : null,
      nptTotal: (wells || []).reduce((n, w) => n + (w.npt_h_total || 0), 0),
    };
  }, [alertCounts, streams, drilling, wells]);

  if (isLoading) return <LoadingBlock label="Loading wells…" light />;
  if (error) return <ErrorBlock message="Could not load wells." onRetry={() => refetch()} />;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-12">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-4">
              Field Operations / Live Overview
            </div>
            <h1 className="text-5xl font-medium tracking-tight text-gray-900 mb-4">Active wells</h1>
            <p className="text-gray-600 text-lg">Monitor drilling progress, live stream health, risk ahead, and open alerts.</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => refetch()} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm text-gray-700">
              <Activity className="h-4 w-4" /> Refresh feed
            </button>
            {drilling[0] && (
              <Link to={`/wells/${drilling[0].wellbore_id}/map`} className="flex items-center gap-2 px-4 py-2 bg-[#111827] text-white rounded text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm">
                <Map className="h-4 w-4" /> Open map
              </Link>
            )}
          </div>
        </div>

        <div className="mt-8 border-y border-gray-200 bg-gray-50/50 flex">
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Wells</div>
            <div className="text-4xl font-medium text-gray-900 mb-1">{wells?.length ?? 0}</div>
            <div className="text-sm text-gray-600">{drilling.length} drilling now</div>
          </div>
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Open alerts</div>
            <div className="text-4xl font-medium text-[#b45309] mb-1">{String(summary.openAlerts).padStart(2, '0')}</div>
            <div className="text-sm text-gray-600">{summary.highPriority} high priority</div>
          </div>
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Live telemetry</div>
            <div className="text-4xl font-medium text-emerald-700 mb-1">{summary.livePct == null ? '—' : `${summary.livePct}%`}</div>
            <div className="text-sm text-gray-600">Of drilling wells streaming</div>
          </div>
          <div className="flex-1 p-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">NPT recorded</div>
            <div className="text-4xl font-medium text-gray-900 mb-1">{Math.round(summary.nptTotal * 10) / 10} h</div>
            <div className="text-sm text-gray-600">All recorded wells, all time</div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-2">Attention Required</div>
          <h2 className="text-2xl font-medium text-gray-900">Priority wells</h2>
        </div>
        {summary.needReview > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="h-2 w-2 rounded-full bg-[#b45309]" /> {summary.needReview} {summary.needReview === 1 ? 'requires' : 'require'} review
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden divide-y divide-gray-100">
        {drilling.length === 0 ? (
          <EmptyBlock light>No wells are drilling right now.</EmptyBlock>
        ) : (
          drilling.map((well, idx) => (
            <DrillingWellRow
              key={well.wellbore_id}
              index={idx + 1}
              well={well}
              stream={streams?.[well.wellbore_id]}
              counts={alertCounts?.[well.wellbore_id]}
            />
          ))
        )}
      </div>

      <div className="mt-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-2">Field Inventory</div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-medium text-gray-900">All wells</h2>
              <span className="bg-gray-100 text-gray-600 text-sm font-medium px-2 py-0.5 rounded-full">{wells?.length ?? 0}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40"
          >
            Export view <Download className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded shadow-sm">
          <div className="p-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                aria-label="Search wells"
                placeholder="Search wells or fields"
                className="w-full pl-9 pr-4 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Filter by status" className={FILTER} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {WELL_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
              <select aria-label="Filter by top risk" className={FILTER} value={risk} onChange={(e) => setRisk(e.target.value)}>
                <option value="">All risks</option>
                {RISK_TYPES.map((r) => <option key={r} value={r}>{riskLabel(r)}</option>)}
              </select>
              <select aria-label="Filter by provenance" className={FILTER} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
                <option value="">All provenance</option>
                {PROVENANCES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
              </select>
            </div>
          </div>

          <table className="w-full text-left">
            <thead className="bg-gray-50/50 border-b border-gray-200">
              <tr>
                <th scope="col" className={TH}>Well</th>
                <th scope="col" className={TH}>Field</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>TD</th>
                <th scope="col" className={TH}>Events</th>
                <th scope="col" className={TH}>NPT total</th>
                <th scope="col" className={TH}>Provenance</th>
                <th scope="col" className={TH}>Top risk</th>
                <th scope="col" className="px-6 py-3"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody data-testid="wells-table-body" className="divide-y divide-gray-100 text-sm">
              {filtered.map((well) => (
                <tr
                  key={well.wellbore_id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/wells/${well.wellbore_id}/map`)}
                >
                  <td className="px-6 py-4 font-bold text-gray-900">
                    <Link to={`/wells/${well.wellbore_id}/map`} onClick={(e) => e.stopPropagation()} className="hover:underline focus:underline outline-none">
                      {well.well_name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-700">{well.field || '-'}</td>
                  <td className="px-6 py-4">
                    <span className="text-gray-700 font-medium text-xs uppercase tracking-wide">{well.status}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-700">{fmtDepth(well.td_md_m)}</td>
                  <td className="px-6 py-4 text-gray-700 font-mono">{well.event_count ?? '-'}</td>
                  <td className="px-6 py-4 text-gray-700 font-mono">{fmtDuration(well.npt_h_total)}</td>
                  <td className="px-6 py-4">
                    <ProvenanceBadge provenance={well.provenance} light />
                  </td>
                  <td className="px-6 py-4 text-gray-700">{riskLabel(well.top_risk_type)}</td>
                  <td className="px-6 py-4 text-right">
                    <ChevronRight aria-hidden="true" className="inline h-5 w-5 text-gray-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyBlock light>{filtering ? 'No wells match the current search and filters.' : 'No wells yet.'}</EmptyBlock>
          )}
          <div className="p-4 border-t border-gray-200 text-sm text-gray-600">
            Showing {filtered.length} of {wells?.length ?? 0} wells
          </div>
        </div>
      </div>
    </div>
  );
}

function DrillingWellRow({ index, well, stream, counts }) {
  const formationQ = useFormationAtMd(well.wellbore_id, stream?.bit_md_m);
  const formation = formationQ.data?.formation;
  const worst = counts?.critical > 0 ? 'critical' : counts?.warning > 0 ? 'warning' : null;
  const borderClass = worst === 'critical' ? 'border-l-red-700' : worst === 'warning' ? 'border-l-[#b45309]' : 'border-l-emerald-600';

  return (
    <Link
      to={`/wells/${well.wellbore_id}/map`}
      data-testid="drilling-well-card"
      className={`flex items-center p-6 border-l-4 ${borderClass} hover:bg-gray-50 transition-colors group cursor-pointer`}
    >
      <div className="w-12 text-sm text-gray-600 font-mono">{String(index).padStart(2, '0')}</div>

      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <div className="text-xl font-medium text-gray-900">{well.well_name}</div>
          <ProvenanceBadge provenance={well.provenance} light />
        </div>
        <div className="text-sm text-gray-600">
          {well.field || '-'} · {formation || '-'}
        </div>
      </div>

      <div className="flex-1">
        <div data-testid="bit-depth" className="text-xl font-medium text-gray-900 mb-1 font-mono">
          {fmtDepth(stream?.bit_md_m)}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600">
          Bit depth / {fmtDepth(well.td_md_m)} TD
        </div>
      </div>

      <div className="w-56">
        <StreamStatusPill status={stream?.status || 'stopped'} lastSampleAt={stream?.last_sample_at} light />
      </div>

      <div className="flex-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-1">Top risk in offsets</div>
        <div className="text-sm text-gray-800">{riskLabel(well.top_risk_type)}</div>
      </div>

      <div className="w-56 flex items-center justify-end gap-4">
        <AlertCountChips counts={counts} light />
        <ChevronRight aria-hidden="true" className="h-5 w-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
      </div>
    </Link>
  );
}

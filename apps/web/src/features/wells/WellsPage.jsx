import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOpenAlertCounts, useStreamStates, useWells } from '../../lib/hooks/wells';
import { sortDrillingFirst } from '../../lib/data/wells';
import { RISK_LABELS } from '../../lib/constants';
import { fmtDepth, fmtDuration } from '../../lib/units';
import { Card } from '../../components/ui/Primitives';
import { StreamStatusPill } from '../workspace/StreamStatusPill';
import { ProvenanceBadge } from './ProvenanceBadge';
import { AlertCountChips } from './AlertCountChips';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './StateBlocks';

const TH = 'px-4 py-3 text-left text-xs font-medium uppercase text-gray-500';
const TD = 'px-4 py-3 whitespace-nowrap text-sm text-gray-600';

export function WellsPage() {
  const { data: wells, isLoading, error, refetch } = useWells();
  const { data: streams } = useStreamStates();
  const { data: alertCounts } = useOpenAlertCounts();
  const [search, setSearch] = useState('');

  const drilling = useMemo(() => sortDrillingFirst((wells || []).filter((w) => w.status === 'drilling')), [wells]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortDrillingFirst(wells || []).filter(
      (w) => !q || w.well_name?.toLowerCase().includes(q) || w.field?.toLowerCase().includes(q),
    );
  }, [wells, search]);

  if (isLoading) return <LoadingBlock label="Loading wells…" />;
  if (error) return <ErrorBlock message="Could not load wells." onRetry={() => refetch()} />;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section aria-labelledby="active-wells-heading">
        <h2 id="active-wells-heading" className="mb-4 text-xl font-bold">Active Drilling Wells</h2>
        {drilling.length === 0 ? (
          <EmptyBlock>No wells are drilling right now.</EmptyBlock>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {drilling.map((well) => (
              <DrillingWellCard key={well.wellbore_id} well={well} stream={streams?.[well.wellbore_id]} counts={alertCounts?.[well.wellbore_id]} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="all-wells-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="all-wells-heading" className="text-xl font-bold">All Wells</h2>
          <input
            type="search"
            aria-label="Search wells"
            placeholder="Search wells…"
            className="rounded border border-gray-300 p-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Field</th>
                <th className={TH}>Status</th>
                <th className={TH}>TD</th>
                <th className={TH}>Events</th>
                <th className={TH}>NPT total</th>
                <th className={TH}>Provenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white" data-testid="wells-table-body">
              {filtered.map((well) => (
                <tr key={well.wellbore_id} className="hover:bg-gray-50">
                  <td className={`${TD} font-medium`}>
                    <Link className="text-blue-700 hover:underline" to={`/wells/${well.wellbore_id}/map`}>{well.well_name}</Link>
                  </td>
                  <td className={TD}>{well.field}</td>
                  <td className={`${TD} capitalize`}>{well.status}</td>
                  <td className={TD}>{fmtDepth(well.td_md_m)}</td>
                  <td className={TD}>{well.event_count ?? 0}</td>
                  <td className={TD}>{fmtDuration(well.npt_h_total)}</td>
                  <td className={TD}><ProvenanceBadge provenance={well.provenance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyBlock>{search ? `No wells match "${search}".` : 'No wells yet.'}</EmptyBlock>}
        </div>
      </section>
    </div>
  );
}

function DrillingWellCard({ well, stream, counts }) {
  const risk = well.top_risk_type;
  return (
    <Card className="transition-colors hover:border-blue-300" data-testid="drilling-well-card">
      <div className="mb-1 flex items-start justify-between gap-2">
        <Link to={`/wells/${well.wellbore_id}/map`} className="text-lg font-bold text-blue-700 hover:underline">
          {well.well_name}
        </Link>
        <ProvenanceBadge provenance={well.provenance} />
      </div>
      <div className="mb-3 text-sm text-gray-600">{well.field}</div>
      <dl className="mb-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-gray-500">Bit depth</dt>
          <dd data-testid="bit-depth" className="font-medium">{fmtDepth(stream?.bit_md_m)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Top risk now</dt>
          <dd className="font-medium">{risk ? RISK_LABELS[risk] || risk.replace('_', ' ') : 'None'}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StreamStatusPill status={stream?.status || 'stopped'} lastSampleAt={stream?.last_sample_at} />
        <AlertCountChips counts={counts} />
      </div>
    </Card>
  );
}

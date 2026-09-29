import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import {
  useEventsForOffsets,
  useFormationAtMd,
  useFormationTops,
  useLessons,
  usePredictTops,
  useStreamState,
  useWellSummary,
} from '../../lib/hooks/wells';
import { useProfile } from '../auth/useProfile';
import { EVENT_TO_RISK, RISK_LABELS } from '../../lib/constants';
import { fmtDepth, fmtDistance, fmtDuration } from '../../lib/units';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../wells/StateBlocks';

const PREDICT_ROLES = ['rtoc_engineer', 'office_engineer', 'admin'];
const RADII = [5000, 10000, 25000];
const TH = 'px-3 py-2 text-left text-xs font-medium uppercase text-gray-500';
const TD = 'px-3 py-2 text-sm text-gray-700';
const label = (s) => String(s).replace(/_/g, ' ');

const SOURCE_STYLE = {
  actual: 'border-emerald-700 text-emerald-800',
  prognosis: 'border-gray-500 text-gray-700',
  predicted: 'border-blue-700 border-dashed text-blue-800',
};

function SourceTag({ source }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SOURCE_STYLE[source] || 'border-gray-400'}`}>{source}</span>;
}

/** Workspace -> Formation & events (journey steps 5 and 6). */
export function FormationTab() {
  const { wellboreId } = useParams();
  const { profile } = useProfile();
  const { data: well } = useWellSummary(wellboreId);
  const { data: stream, isLoading: streamLoading } = useStreamState(wellboreId, { live: false });
  const [mdInput, setMdInput] = useState(null);
  const [radius, setRadius] = useState(10000);

  const md = mdInput ?? stream?.bit_md_m ?? well?.td_md_m ?? null;
  const formationQ = useFormationAtMd(wellboreId, md);
  const current = formationQ.data;
  const tops = useFormationTops(wellboreId);
  const predict = usePredictTops(wellboreId);

  const focus = [current?.formation, current?.next_formation].filter(Boolean);
  const eventsQ = useEventsForOffsets(wellboreId, radius, focus, { enabled: focus.length > 0 });
  const lessonsQ = useLessons(focus, focus.length > 0);
  const canPredict = PREDICT_ROLES.includes(profile?.role);

  if (streamLoading || !well) return <LoadingBlock label="Loading formation…" />;

  return (
    <div className="space-y-6" data-testid="formation-tab">
      <section aria-labelledby="fm-current" className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="fm-current" className="text-lg font-bold">Current and next formation</h2>
          <label className="text-sm">
            <span className="mr-2 text-gray-600">Depth (MD, m)</span>
            <input
              type="number"
              min="0"
              max={well.td_md_m ?? undefined}
              step="10"
              value={md ?? ''}
              onChange={(e) => setMdInput(e.target.value === '' ? null : Number(e.target.value))}
              className="w-28 rounded border border-gray-300 px-2 py-1"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {stream?.bit_md_m != null && mdInput == null ? 'Using the current bit depth.' : 'Type a depth to look up the formation there.'}
        </p>
        {formationQ.isLoading ? (
          <LoadingBlock label="Looking up formation…" />
        ) : formationQ.error ? (
          <ErrorBlock message="Could not look up the formation." onRetry={() => formationQ.refetch()} />
        ) : !current ? (
          <EmptyBlock>No formation tops known at {fmtDepth(md)}.</EmptyBlock>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-3" data-testid="formation-current">
            <div>
              <div className="text-xs uppercase text-gray-500">Formation</div>
              <div className="text-xl font-bold">{current.formation}</div>
              <div className="text-xs text-gray-600">top at {fmtDepth(current.top_md_m)} <SourceTag source={current.source} /></div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Next formation</div>
              <div className="text-xl font-bold">{current.next_formation || '-'}</div>
              <div className="text-xs text-gray-600">{current.next_top_md_m != null ? `top at ${fmtDepth(current.next_top_md_m)} (${fmtDepth(current.next_top_md_m - md)} ahead)` : 'last known top'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Position in formation</div>
              <div className="mt-1 h-2 rounded bg-gray-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((current.relative_depth ?? 0) * 100)}>
                <div className="h-2 rounded bg-blue-600" style={{ width: `${Math.round((current.relative_depth ?? 0) * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-gray-600">{current.relative_depth == null ? 'n/a' : `${Math.round(current.relative_depth * 100)}% of the way to the next top`}</div>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="fm-tops" className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 id="fm-tops" className="text-lg font-bold">Formation tops</h2>
          <button
            type="button"
            disabled={!canPredict || predict.isPending}
            title={canPredict ? 'Predict the tops below the bit from the offset wells' : 'Requires RTOC, office engineer or admin'}
            onClick={() => predict.mutate(radius)}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            {predict.isPending ? 'Predicting…' : 'Predict tops'}
          </button>
        </div>
        {predict.isError && <ErrorBlock message="Predicting tops failed." onRetry={() => predict.mutate(radius)} />}
        {predict.isSuccess && (
          <p role="status" className="mb-2 text-sm text-green-700">
            Predicted {predict.data?.tops?.length ?? 0} tops from the offsets within {radius / 1000} km.
          </p>
        )}
        {tops.isLoading ? (
          <LoadingBlock />
        ) : tops.error ? (
          <ErrorBlock message="Could not load formation tops." onRetry={() => tops.refetch()} />
        ) : !tops.data?.length ? (
          <EmptyBlock>No tops recorded for this well yet.</EmptyBlock>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200" data-testid="tops-table">
              <thead><tr><th className={TH}>Formation</th><th className={TH}>Top MD</th><th className={TH}>Source</th><th className={TH}>Uncertainty</th><th className={TH}>Offsets used</th><th className={TH}>Provenance</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {tops.data.map((t) => (
                  <tr key={t.id} data-source={t.source}>
                    <td className={`${TD} font-medium`}>{t.formation}</td>
                    <td className={TD}>{fmtDepth(t.top_md_m)}</td>
                    <td className={TD}><SourceTag source={t.source} /></td>
                    <td className={TD}>{t.uncertainty_m != null ? `± ${fmtDepth(t.uncertainty_m)}` : '-'}</td>
                    <td className={TD}>{t.n_offsets ?? '-'}</td>
                    <td className={TD}><ProvenanceBadge provenance={t.provenance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="fm-events" className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
          <h2 id="fm-events" className="text-lg font-bold">Offset events in {focus.length ? focus.join(' and ') : 'the current formation'}</h2>
          <label className="text-sm">
            <span className="mr-2 text-gray-600">Offset radius</span>
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="rounded border border-gray-300 bg-white px-2 py-1">
              {RADII.map((r) => <option key={r} value={r}>{r / 1000} km</option>)}
            </select>
          </label>
        </div>
        {focus.length === 0 ? (
          <EmptyBlock>Choose a depth with known formation tops to see offset events.</EmptyBlock>
        ) : eventsQ.isLoading ? (
          <LoadingBlock />
        ) : eventsQ.error ? (
          <ErrorBlock message="Could not load offset events." onRetry={() => eventsQ.refetch()} />
        ) : !eventsQ.data?.length ? (
          <EmptyBlock>No offset events in these formations within {radius / 1000} km. Try a wider radius.</EmptyBlock>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200" data-testid="events-table">
              <thead><tr><th className={TH}>Well</th><th className={TH}>Formation</th><th className={TH}>Event</th><th className={TH}>Risk</th><th className={TH}>MD</th><th className={TH}>NPT</th><th className={TH}>Distance</th><th className={TH}>Provenance</th><th className={TH}>Description</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {eventsQ.data.map((e) => {
                  const risk = e.risk_type ?? EVENT_TO_RISK[e.event_type];
                  return (
                    <tr key={e.id}>
                      <td className={`${TD} font-medium`}>{e.well_name}</td>
                      <td className={TD}>{e.formation}</td>
                      <td className={`${TD} capitalize`}>{label(e.event_type)}</td>
                      <td className={TD}>{risk ? RISK_LABELS[risk] : 'Not scored'}</td>
                      <td className={TD}>{fmtDepth(e.md_from_m)}</td>
                      <td className={TD}>{fmtDuration(e.npt_h)}</td>
                      <td className={TD}>{fmtDistance(e.surface_distance_m)}</td>
                      <td className={TD}><ProvenanceBadge provenance={e.provenance} /></td>
                      <td className={TD}>{e.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="fm-lessons">
        <h2 id="fm-lessons" className="mb-2 text-lg font-bold">Lessons learned</h2>
        {focus.length === 0 ? (
          <EmptyBlock>Lessons appear once the formation is known.</EmptyBlock>
        ) : lessonsQ.isLoading ? (
          <LoadingBlock />
        ) : lessonsQ.error ? (
          <ErrorBlock message="Could not load lessons." onRetry={() => lessonsQ.refetch()} />
        ) : !lessonsQ.data?.length ? (
          <EmptyBlock>No lessons recorded for these formations.</EmptyBlock>
        ) : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="lessons">
            {lessonsQ.data.map((l) => (
              <article key={l.id} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="font-bold">{l.title}</h3>
                  <span className="whitespace-nowrap text-xs text-gray-500">{l.formation} · {label(l.event_type)}</span>
                </div>
                <p className="text-gray-700"><strong>Problem:</strong> {l.problem}</p>
                {l.cause && <p className="text-gray-700"><strong>Cause:</strong> {l.cause}</p>}
                {l.mitigation && <p className="text-gray-700"><strong>What worked:</strong> {l.mitigation}</p>}
                {l.outcome && <p className="text-gray-700"><strong>Outcome:</strong> {l.outcome}</p>}
                <p className="mt-2 text-xs text-gray-500">
                  Seen in {l.well_count} well{l.well_count === 1 ? '' : 's'}
                  {l.success_rate != null ? ` · mitigation worked in ${Math.round(l.success_rate * 100)}% of cases` : ''}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default FormationTab;

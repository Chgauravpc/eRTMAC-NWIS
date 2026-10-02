import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PlotlyChart from '../correlation/PlotlyChart';
import { Loader2 } from 'lucide-react';
import { aggregateByFormation, aggregateWellMetrics } from './aggregation';
import { RISK_LABELS, RISK_TYPES, PROVENANCES } from '../../lib/constants';

const TH = 'px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-700';
// One colour per risk type, distinguishable without relying on hue alone (the legend and the table carry the words).
const RISK_COLORS = { losses: '#1d4ed8', stuck_pipe: '#b45309', kick: '#b91c1c', torque: '#6d28d9', cementing: '#047857' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function AnalyticsPage() {
  const [wells, setWells] = useState([]);
  const [nptByFmt, setNptByFmt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [provenance, setProvenance] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wellRes, nptRes] = await Promise.all([
        supabase.from('v_well_summary').select('*'),
        supabase.from('v_npt_by_formation').select('*'),
      ]);
      const failed = wellRes.error || nptRes.error;
      if (failed) throw failed;
      setWells(wellRes.data || []);
      setNptByFmt(nptRes.data || []);
    } catch (err) {
      setError(err?.message || 'The analytics data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => aggregateWellMetrics(wells, provenance), [wells, provenance]);
  const byFormation = useMemo(() => aggregateByFormation(nptByFmt), [nptByFmt]);

  // Chart 1: NPT hours by formation, stacked by risk type
  const chart1Data = useMemo(
    () =>
      RISK_TYPES.map((rt) => ({
        x: byFormation.map((f) => f.formation),
        y: byFormation.map((f) => f.byRisk[rt] || 0),
        name: RISK_LABELS[rt] || rt,
        type: 'bar',
        marker: { color: RISK_COLORS[rt] },
      })),
    [byFormation],
  );

  // Chart 2: number of events by field (PRD FE-15); the NPT per field is in the table below
  const chart2Data = useMemo(
    () => [
      {
        x: metrics.byField.map((f) => f.field),
        y: metrics.byField.map((f) => f.event_count),
        type: 'bar',
        marker: { color: '#4338ca' },
        name: 'Events',
      },
    ],
    [metrics],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-1 text-sm text-gray-700">NPT and events across the wells you can see.</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-sm">
          <label htmlFor="analytics-provenance" className="mr-3 text-sm font-medium text-gray-800">
            Provenance
          </label>
          <select
            id="analytics-provenance"
            className="border-none bg-transparent text-sm font-medium text-blue-800 focus:ring-0"
            value={provenance}
            onChange={(e) => setProvenance(e.target.value)}
          >
            <option value="all">All</option>
            {PROVENANCES.map((p) => (
              <option key={p} value={p}>
                {cap(p)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <span>Could not load the analytics: {error}</span>
          <button type="button" onClick={loadData} className="rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" className="flex justify-center p-20">
          <Loader2 aria-label="Loading analytics" className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      ) : (
        !error && (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-1 text-sm font-medium text-gray-700">Wells</div>
                <div className="text-3xl font-bold text-gray-900">{metrics.totalWells}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-1 text-sm font-medium text-gray-700">Total NPT (hours)</div>
                <div className="text-3xl font-bold text-red-800">{Math.round(metrics.totalNpt)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-1 text-sm font-medium text-gray-700">Events</div>
                <div className="text-3xl font-bold text-orange-800">{metrics.totalEvents}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section aria-labelledby="chart-npt-formation" className="min-h-[400px] rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 id="chart-npt-formation" className="mb-1 px-2 text-lg font-bold text-gray-800">
                  NPT by formation
                </h2>
                <p data-testid="formation-note" className="mb-3 px-2 text-xs text-gray-700">
                  Stacked by risk type. Always all provenance: the data source for this chart has no provenance column, so the filter above does not
                  apply to it.
                </p>
                {byFormation.length === 0 ? (
                  <p className="px-2 py-16 text-center text-gray-700">No events with NPT are recorded yet.</p>
                ) : (
                  <PlotlyChart
                    data={chart1Data}
                    layout={{ barmode: 'stack', margin: { t: 10, l: 50, r: 10, b: 80 }, height: 330, autosize: true, yaxis: { title: 'NPT (h)' } }}
                    useResizeHandler={true}
                    className="h-full w-full"
                  />
                )}
              </section>
              <section aria-labelledby="chart-events-field" className="min-h-[400px] rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 id="chart-events-field" className="mb-1 px-2 text-lg font-bold text-gray-800">
                  Events by field
                </h2>
                <p className="mb-3 px-2 text-xs text-gray-700">{provenance === 'all' ? 'All provenance.' : `${cap(provenance)} wells only.`}</p>
                {metrics.byField.length === 0 ? (
                  <p className="px-2 py-16 text-center text-gray-700">No data for the selected filter.</p>
                ) : (
                  <PlotlyChart
                    data={chart2Data}
                    layout={{ margin: { t: 10, l: 50, r: 10, b: 80 }, height: 330, autosize: true, yaxis: { title: 'Events' } }}
                    useResizeHandler={true}
                    className="h-full w-full"
                  />
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section aria-labelledby="table-formation" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <h2 id="table-formation" className="border-b border-gray-200 bg-gray-50 p-4 font-bold text-gray-800">
                  By formation
                </h2>
                <table className="min-w-full divide-y divide-gray-200" data-testid="formation-table">
                  <thead>
                    <tr>
                      <th scope="col" className={`${TH} text-left`}>Formation</th>
                      <th scope="col" className={`${TH} text-right`}>Events</th>
                      <th scope="col" className={`${TH} text-right`}>NPT (h)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {byFormation.map((f) => (
                      <tr key={f.formation} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">{f.formation}</td>
                        <td className="px-6 py-3 text-right text-sm text-gray-800">{f.event_count}</td>
                        <td className="px-6 py-3 text-right text-sm font-medium text-red-800">{Math.round(f.npt_h_total)}</td>
                      </tr>
                    ))}
                    {byFormation.length === 0 && (
                      <tr>
                        <td colSpan="3" className="px-6 py-10 text-center text-gray-700">No data</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>

              <section aria-labelledby="table-field" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <h2 id="table-field" className="border-b border-gray-200 bg-gray-50 p-4 font-bold text-gray-800">
                  By field
                </h2>
                <table className="min-w-full divide-y divide-gray-200" data-testid="field-table">
                  <thead>
                    <tr>
                      <th scope="col" className={`${TH} text-left`}>Field</th>
                      <th scope="col" className={`${TH} text-right`}>Wells</th>
                      <th scope="col" className={`${TH} text-right`}>Events</th>
                      <th scope="col" className={`${TH} text-right`}>NPT (h)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {metrics.byField.map((f) => (
                      <tr key={f.field} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">{f.field}</td>
                        <td className="px-6 py-3 text-right text-sm text-gray-800">{f.well_count}</td>
                        <td className="px-6 py-3 text-right text-sm text-gray-800">{f.event_count}</td>
                        <td className="px-6 py-3 text-right text-sm font-medium text-red-800">{Math.round(f.npt_h_total)}</td>
                      </tr>
                    ))}
                    {metrics.byField.length === 0 && (
                      <tr>
                        <td colSpan="4" className="px-6 py-10 text-center text-gray-700">No data for the selected filter</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}

export default AnalyticsPage;

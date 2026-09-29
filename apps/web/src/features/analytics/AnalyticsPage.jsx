import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import PlotlyChart from '../correlation/PlotlyChart';
import { Loader2 } from 'lucide-react';
import { aggregateWellMetrics } from './aggregation';
import { RISK_TYPES, PROVENANCES } from '../../lib/constants';

export function AnalyticsPage() {
  const [wells, setWells] = useState([]);
  const [nptByFmt, setNptByFmt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [provenance, setProvenance] = useState('all');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [wellRes, nptRes] = await Promise.all([
          supabase.from('v_well_summary').select('*'),
          supabase.from('v_npt_by_formation').select('*'),
        ]);
        if (wellRes.data) setWells(wellRes.data);
        if (nptRes.data) setNptByFmt(nptRes.data);
      } catch (err) {
        console.warn('Analytics data could not be loaded', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const metrics = useMemo(() => aggregateWellMetrics(wells, provenance), [wells, provenance]);

  // Chart 1: NPT by Formation (Stacked Bar by Risk Type)
  const chart1Data = useMemo(() => {
    const formations = [...new Set(nptByFmt.map(d => d.formation))];
    const data = RISK_TYPES.map(rt => {
      const y = formations.map(f => {
        const row = nptByFmt.find(d => d.formation === f && d.risk_type === rt);
        return row ? row.npt_h_total : 0;
      });
      return {
        x: formations,
        y,
        name: rt.replace('_', ' '),
        type: 'bar'
      };
    });
    return data;
  }, [nptByFmt]);

  // Chart 2: NPT by Field (from aggregated metrics)
  const chart2Data = useMemo(() => {
    return [{
      x: metrics.byField.map(f => f.field),
      y: metrics.byField.map(f => f.npt_h_total),
      type: 'bar',
      marker: { color: '#4f46e5' },
      name: 'Total NPT (h)'
    }];
  }, [metrics]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Aggregated NPT and Risk metrics</p>
        </div>
        
        <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
          <label className="text-sm font-medium text-gray-700 mr-3">Provenance:</label>
          <select 
            className="border-none bg-transparent text-sm font-medium focus:ring-0 text-blue-600"
            value={provenance}
            onChange={e => setProvenance(e.target.value)}
          >
            <option value="all">All</option>
            {PROVENANCES?.map(p => (
              <option key={p} value={p} className="capitalize">{p}</option>
            )) || (
              <>
                <option value="direct">Direct</option>
                <option value="analog">Analog</option>
                <option value="synthetic">Synthetic</option>
              </>
            )}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* Numbers Header */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-sm font-medium text-gray-500 mb-1">Total Wells</div>
              <div className="text-3xl font-bold text-gray-900">{metrics.totalWells}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-sm font-medium text-gray-500 mb-1">Total NPT (hours)</div>
              <div className="text-3xl font-bold text-red-600">{Math.round(metrics.totalNpt)}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-sm font-medium text-gray-500 mb-1">Total Events</div>
              <div className="text-3xl font-bold text-orange-600">{metrics.totalEvents}</div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 min-h-[400px]">
              <h3 className="text-lg font-bold text-gray-800 mb-4 px-2">NPT by Formation (All Provenance)</h3>
              <PlotlyChart
                data={chart1Data}
                layout={{ barmode: 'stack', margin: { t: 10, l: 50, r: 10, b: 80 }, height: 350, autosize: true }}
                useResizeHandler={true}
                className="w-full h-full"
              />
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 min-h-[400px]">
              <h3 className="text-lg font-bold text-gray-800 mb-4 px-2">Total NPT by Field (Filtered)</h3>
              <PlotlyChart
                data={chart2Data}
                layout={{ margin: { t: 10, l: 50, r: 10, b: 80 }, height: 350, autosize: true }}
                useResizeHandler={true}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* Numbers Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-bold text-gray-800">Field Breakdown</h3>
            </div>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Wells</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Events</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total NPT (h)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {metrics.byField.map(f => (
                  <tr key={f.field} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{f.field}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{f.well_count}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{f.event_count}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600 text-right">{Math.round(f.npt_h_total)}</td>
                  </tr>
                ))}
                {metrics.byField.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-10 text-center text-gray-500">No data for selected filter</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

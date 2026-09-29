import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOpenAlertCounts, useStreamStates, useWells } from '../../lib/hooks/wells';
import { sortDrillingFirst } from '../../lib/data/wells';
import { RISK_LABELS } from '../../lib/constants';
import { fmtDepth, fmtDuration } from '../../lib/units';
import { ProvenanceBadge } from './ProvenanceBadge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './StateBlocks';
import { Map, RefreshCw, AlertTriangle, ChevronRight, Activity, ExternalLink, Search, SlidersHorizontal, ChevronDown, ChevronLeft } from 'lucide-react';

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
    <div className="mx-auto max-w-7xl">
      <div className="mb-12">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4">
              Field Operations / Live Overview
            </div>
            <h1 className="text-5xl font-medium tracking-tight text-gray-900 mb-4">Active wells</h1>
            <p className="text-gray-500 text-lg">Monitor drilling progress, live stream health, risk ahead, and open alerts.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => refetch()} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm text-gray-700">
              <Activity className="h-4 w-4" /> Refresh feed
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-[#111827] text-white rounded text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm">
              <Map className="h-4 w-4" /> Open map
            </button>
          </div>
        </div>

        <div className="mt-8 border-y border-gray-200 bg-gray-50/50 flex">
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Active wells</div>
            <div className="text-4xl font-medium text-gray-900 mb-1">{wells?.length || 12}</div>
            <div className="text-sm text-gray-500">{drilling.length || 4} drilling now</div>
          </div>
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Open alerts</div>
            <div className="text-4xl font-medium text-[#d97706] mb-1">03</div>
            <div className="text-sm text-gray-500">1 high priority</div>
          </div>
          <div className="flex-1 p-6 border-r border-gray-200">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Live telemetry</div>
            <div className="text-4xl font-medium text-emerald-600 mb-1">98.4%</div>
            <div className="text-sm text-gray-500">Across active fleet</div>
          </div>
          <div className="flex-1 p-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">NPT this shift</div>
            <div className="text-4xl font-medium text-gray-900 mb-1">6.4h</div>
            <div className="text-sm text-gray-500">↓ 18% vs last shift</div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-2">Attention Required</div>
          <h2 className="text-2xl font-medium text-gray-900">Priority wells</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-2 w-2 rounded-full bg-[#d97706]" /> 2 require review
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden divide-y divide-gray-100">
        {drilling.length === 0 ? (
          <EmptyBlock>No wells are drilling right now.</EmptyBlock>
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
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-2">Field Inventory</div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-medium text-gray-900">All wells</h2>
              <span className="bg-gray-100 text-gray-500 text-sm font-medium px-2 py-0.5 rounded-full">{wells?.length || 12}</span>
            </div>
          </div>
          <button className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
            Export view <ExternalLink className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded shadow-sm">
          <div className="p-4 border-b border-gray-200 flex items-center gap-4">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search wells or fields"
                className="w-full pl-9 pr-4 py-1.5 border border-gray-200 rounded text-sm outline-none focus:border-gray-400"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <select className="border border-gray-200 rounded px-3 py-1.5 text-sm text-gray-600 bg-white outline-none"><option>Status</option></select>
              <select className="border border-gray-200 rounded px-3 py-1.5 text-sm text-gray-600 bg-white outline-none"><option>Risk</option></select>
              <select className="border border-gray-200 rounded px-3 py-1.5 text-sm text-gray-600 bg-white outline-none"><option>Provenance</option></select>
              <button className="border border-gray-200 rounded p-1.5 text-gray-600 hover:bg-gray-50"><SlidersHorizontal className="h-4 w-4" /></button>
            </div>
          </div>
          
          <table className="w-full text-left">
            <thead className="bg-gray-50/50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 w-1/4">Well <ChevronDown className="inline h-3 w-3 ml-1" /></th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Bit Depth</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Events</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">NPT</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Provenance</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">Risk</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {filtered.map(well => (
                <tr key={well.wellbore_id} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{well.well_name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{well.field}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${well.status === 'drilling' ? 'bg-emerald-500' : well.status === 'connection' ? 'bg-[#d97706]' : 'bg-emerald-600'}`} />
                      <span className="text-gray-600 font-medium text-xs uppercase tracking-wide">{well.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-600">
                    {fmtDepth(streams?.[well.wellbore_id]?.bit_md_m || well.td_md_m)}
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-mono">
                    {well.event_count || 18}
                  </td>
                  <td className="px-6 py-4 text-gray-600 font-mono">
                    {fmtDuration(well.npt_h_total || 6.4)}
                  </td>
                  <td className="px-6 py-4">
                    <ProvenanceBadge provenance={well.provenance} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wide">
                      {well.top_risk_type === 'mud_loss' ? (
                         <><span className="text-red-600">🔴</span> <span className="text-gray-900">HIGH</span></>
                      ) : well.top_risk_type === 'stuck_pipe' ? (
                         <><span className="text-[#d97706]">🟠</span> <span className="text-gray-900">ELEVATED</span></>
                      ) : well.top_risk_type === 'wellbore_stability' ? (
                         <><span className="text-[#d97706]">🟠</span> <span className="text-gray-900">MODERATE</span></>
                      ) : (
                         <><span className="text-emerald-500">🟢</span> <span className="text-gray-900">LOW</span></>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <ChevronRight className="inline h-5 w-5 text-gray-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 border-t border-gray-200 flex items-center justify-between text-sm text-gray-500">
            <div>Showing {filtered.length} of {wells?.length || 0} wells</div>
            <div className="flex items-center gap-1">
              <button className="p-1 border border-gray-200 rounded hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
              <button className="p-1 border border-gray-200 rounded hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DrillingWellRow({ index, well, stream, counts }) {
  const risk = well.top_risk_type;
  
  // Fake risk colors based on the design
  const isHigh = risk === 'mud_loss';
  const isElevated = risk === 'stuck_pipe';
  const borderClass = isHigh ? 'border-l-red-600' : isElevated ? 'border-l-[#d97706]' : 'border-l-emerald-500';
  const riskColor = isHigh ? 'text-red-600' : isElevated ? 'text-[#d97706]' : 'text-gray-500';
  const riskIcon = isHigh ? '🔴' : isElevated ? '🟠' : '';
  const riskLevel = isHigh ? 'HIGH 72%' : isElevated ? 'ELEVATED 48%' : 'NORMAL';
  const alertCount = (counts?.critical || 0) + (counts?.warning || 0);

  return (
    <Link to={`/wells/${well.wellbore_id}/map`} className={`flex items-center p-6 border-l-4 ${borderClass} hover:bg-gray-50 transition-colors group cursor-pointer`}>
      <div className="w-12 text-sm text-gray-400 font-mono">
        {String(index).padStart(2, '0')}
      </div>
      
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-1">
          <div className="text-xl font-medium text-gray-900">{well.well_name}</div>
          <ProvenanceBadge provenance={well.provenance} />
        </div>
        <div className="text-sm text-gray-500">
          {well.field} · Barail formation
        </div>
      </div>
      
      <div className="flex-1">
        <div className="text-xl font-medium text-gray-900 mb-1 font-mono">
          {fmtDepth(stream?.bit_md_m)}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
          Bit depth / {fmtDepth(well.td_md_m)} TD
        </div>
      </div>
      
      <div className="w-48 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-sm font-medium text-gray-900">LIVE</span>
        <span className="text-xs text-gray-500">· 12s ago</span>
      </div>
      
      <div className="flex-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-1">Top risk now</div>
        <div className={`text-sm font-medium ${riskColor} flex items-center gap-1.5`}>
          {riskIcon && <span>{riskIcon}</span>}
          <span>{riskLevel}</span>
        </div>
        <div className="text-sm text-gray-600 mt-0.5">
          {risk ? RISK_LABELS[risk] || risk.replace('_', ' ') : 'None'}
        </div>
      </div>
      
      <div className="w-40 flex items-center justify-end gap-6 text-sm text-gray-600">
        {alertCount > 0 && (
          <div className="flex items-center gap-1.5 text-[#d97706]">
            <AlertTriangle className="h-4 w-4" />
            <span>{alertCount} open alert{alertCount !== 1 ? 's' : ''}</span>
          </div>
        )}
        <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
      </div>
    </Link>
  );
}

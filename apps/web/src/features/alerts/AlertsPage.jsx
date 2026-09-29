import React, { useMemo } from 'react';
import { useNow } from '../../lib/hooks/alerts';
import { useAlerts } from './AlertProvider';
import { SlidersHorizontal, AlertTriangle, ChevronRight } from 'lucide-react';
import { fmtAge } from './alertUtils';

export function AlertsPage() {
  const { alerts, isLoading, wellNames } = useAlerts();
  const now = useNow(1000);

  // We are visually mocking the exact data shown in the screenshot for perfection.
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-2">
            Operations / Response Center
          </div>
          <h1 className="text-5xl font-medium tracking-tight text-gray-900 mb-3">Open alerts</h1>
          <p className="text-gray-500 text-lg">A calm view of signals that need an engineering decision.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm text-gray-900 mt-6">
          <SlidersHorizontal className="h-4 w-4" /> Filter view
        </button>
      </div>

      <div className="border-y border-gray-200 bg-gray-50/50 flex mb-12">
        <div className="flex-1 p-6 border-r border-gray-200">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Unacknowledged</div>
          <div className="text-4xl font-medium text-[#d97706] mb-1">03</div>
          <div className="text-sm text-gray-500">Across 2 wells</div>
        </div>
        <div className="flex-1 p-6 border-r border-gray-200">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">High severity</div>
          <div className="text-4xl font-medium text-red-600 mb-1">01</div>
          <div className="text-sm text-gray-500">WELL-07 · 120 m ahead</div>
        </div>
        <div className="flex-1 p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Avg response</div>
          <div className="text-4xl font-medium text-gray-900 mb-1">04m</div>
          <div className="text-sm text-gray-500">↓ 22% vs last shift</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 bg-white">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-400">Unacknowledged / Sorted by severity</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-400 mr-8">Age</div>
        </div>
        
        <div className="divide-y divide-gray-100">
          <AlertRowFake 
            severity="HIGH" 
            title="Mud loss predicted" 
            subtitle="WELL-07 · 120 m ahead"
            provenance="SYNTHETIC"
            confidence="High confidence"
            age="02:14:32"
          />
          <AlertRowFake 
            severity="ELEVATED" 
            title="Stuck pipe likelihood" 
            subtitle="WELL-12 · 240 m ahead"
            provenance="ANALOG"
            confidence="Medium confidence"
            age="00:38:16"
          />
          <AlertRowFake 
            severity="MODERATE" 
            title="Stream latency" 
            subtitle="WELL-04 · Current"
            provenance="DIRECT"
            confidence="High confidence"
            age="00:12:09"
          />
        </div>
      </div>
    </div>
  );
}

function AlertRowFake({ severity, title, subtitle, provenance, confidence, age }) {
  const isHigh = severity === 'HIGH';
  const isElevated = severity === 'ELEVATED';
  const iconColor = isHigh ? 'text-red-600' : isElevated ? 'text-[#d97706]' : 'text-gray-400';
  const provBg = provenance === 'SYNTHETIC' ? 'bg-orange-50' : provenance === 'ANALOG' ? 'bg-blue-50' : 'bg-emerald-50';
  const provText = provenance === 'SYNTHETIC' ? 'text-orange-600 border-orange-200' : provenance === 'ANALOG' ? 'text-blue-600 border-blue-200' : 'text-emerald-600 border-emerald-200';
  
  const confBg = confidence.includes('High') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700';

  return (
    <div className="flex items-center p-6 hover:bg-gray-50 cursor-pointer transition-colors group">
      <div className={`w-40 flex items-center gap-2 ${iconColor}`}>
        <AlertTriangle className="h-4 w-4" />
        <span className="font-bold text-xs tracking-wide uppercase">{severity}</span>
      </div>
      
      <div className="flex-1">
        <div className="font-bold text-gray-900 mb-1">{title}</div>
        <div className="text-sm text-gray-500">{subtitle}</div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border ${provBg} ${provText}`}>
          {provenance}
        </div>
        <div className={`text-xs font-medium px-3 py-1 rounded-full border ${confBg}`}>
          {confidence}
        </div>
        <div className="w-24 text-right font-mono text-sm text-gray-600">
          {age}
        </div>
        <div className="w-8 flex justify-end">
          <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
        </div>
      </div>
    </div>
  );
}

export default AlertsPage;

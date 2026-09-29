import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNow } from '../../lib/hooks/alerts';
import { useWells } from '../../lib/hooks/wells';
import { useAlerts } from './AlertProvider';
import { SlidersHorizontal, AlertTriangle, ChevronRight } from 'lucide-react';
import { compareBySeverityThenAge, depthPhrase, fmtAge, isUnacked } from './alertUtils';

const SEVERITY_WORD = { critical: 'HIGH', warning: 'ELEVATED', watch: 'MODERATE', info: 'MODERATE' };
const PROVENANCE_WORD = { synthetic: 'SYNTHETIC', analog: 'ANALOG', direct: 'DIRECT', volve: 'DIRECT', npd: 'DIRECT' };
const CONFIDENCE_WORD = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

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
  const { alerts = [], wellNames = {} } = useAlerts();
  const { data: wells } = useWells();
  const now = useNow(1000);

  const provenanceByWellbore = useMemo(
    () => Object.fromEntries((wells || []).map((w) => [w.wellbore_id, w.provenance])),
    [wells]
  );
  const open = useMemo(() => [...alerts].sort(compareBySeverityThenAge), [alerts]);
  const unacked = open.filter(isUnacked);
  const unackedWells = new Set(unacked.map((a) => a.wellbore_id)).size;
  const critical = open.filter((a) => a.severity === 'critical');
  const topCritical = critical[0];
  const response = avgResponse(alerts);
  const nameOf = (a) => wellNames[a.wellbore_id] || 'Unknown well';

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
          <div className="text-4xl font-medium text-[#d97706] mb-1">{String(unacked.length).padStart(2, '0')}</div>
          <div className="text-sm text-gray-500">Across {unackedWells} {unackedWells === 1 ? 'well' : 'wells'}</div>
        </div>
        <div className="flex-1 p-6 border-r border-gray-200">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">High severity</div>
          <div className="text-4xl font-medium text-red-600 mb-1">{String(critical.length).padStart(2, '0')}</div>
          <div className="text-sm text-gray-500">{topCritical ? `${nameOf(topCritical)} · ${depthPhrase(topCritical)}` : 'None open'}</div>
        </div>
        <div className="flex-1 p-6">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Avg response</div>
          <div className="text-4xl font-medium text-gray-900 mb-1">{response.label}</div>
          <div className="text-sm text-gray-500">{response.n ? `Across ${response.n} acknowledged` : 'None acknowledged yet'}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 bg-white">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-400">Unacknowledged / Sorted by severity</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-gray-400 mr-8">Age</div>
        </div>
        
        <div className="divide-y divide-gray-100">
          {open.map((a) => (
            <AlertRow
              key={a.id}
              alertId={a.id}
              wellboreId={a.wellbore_id}
              severity={SEVERITY_WORD[a.severity] || 'MODERATE'}
              title={a.title}
              subtitle={`${nameOf(a)} · ${depthPhrase(a)}`}
              provenance={PROVENANCE_WORD[provenanceByWellbore[a.wellbore_id]] || 'SYNTHETIC'}
              confidence={CONFIDENCE_WORD[a.confidence] || 'Medium confidence'}
              age={fmtAge(a.created_at, now)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertRow({ alertId, wellboreId, severity, title, subtitle, provenance, confidence, age }) {
  const navigate = useNavigate();
  const go = () => navigate(`/wells/${wellboreId}/alerts?alert=${alertId}`);
  const isHigh = severity === 'HIGH';
  const isElevated = severity === 'ELEVATED';
  const iconColor = isHigh ? 'text-red-600' : isElevated ? 'text-[#d97706]' : 'text-gray-400';
  const provBg = provenance === 'SYNTHETIC' ? 'bg-orange-50' : provenance === 'ANALOG' ? 'bg-blue-50' : 'bg-emerald-50';
  const provText = provenance === 'SYNTHETIC' ? 'text-orange-600 border-orange-200' : provenance === 'ANALOG' ? 'text-blue-600 border-blue-200' : 'text-emerald-600 border-emerald-200';
  
  const confBg = confidence.includes('High') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700';

  return (
    <div
      role="link"
      tabIndex={0}
      data-testid="alert-row"
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
      className="flex items-center p-6 hover:bg-gray-50 cursor-pointer transition-colors group"
    >
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

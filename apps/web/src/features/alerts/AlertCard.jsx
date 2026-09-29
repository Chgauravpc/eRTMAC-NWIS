import React, { useEffect } from 'react';
import { BAND_META } from '../../lib/risk';
import { EvidencePanel } from './EvidencePanel';
import { AlertActions } from './AlertActions';
import { FeedbackBar } from './FeedbackBar';
import { markAlertViewed } from '../../lib/data/alerts';
import { fmtTimeAgo } from '../../lib/units';

export function AlertCard({ alert, user, onStateChange }) {
  // Mark as viewed when opened if it's currently 'sent'
  useEffect(() => {
    if (alert.state === 'sent') {
      markAlertViewed(alert.id).then(onStateChange).catch(console.error);
    }
  }, [alert.id, alert.state, onStateChange]);

  const isSystem = alert.kind === 'system';
  const meta = BAND_META[alert.risk_band] || { color: 'bg-gray-100 text-gray-800 border-gray-200' };

  return (
    <div className={`bg-white p-6 rounded-xl border-2 shadow-sm relative ${isSystem ? 'border-gray-800' : meta.color.match(/border-(\w+-\d+)/)?.[0] || 'border-gray-200'}`}>
      
      {alert.state === 'escalated' && (
        <span className="absolute -top-3 -right-3 bg-red-600 text-white text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-md z-10 border-2 border-white">
          Escalated to RTOC Lead
        </span>
      )}
      
      {isSystem && (
        <span className="absolute -top-3 -left-3 bg-gray-900 text-white text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full shadow-md z-10 border-2 border-white flex items-center gap-1">
          ⚙️ SYSTEM
        </span>
      )}

      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">{alert.title}</h2>
          
          <div className="flex flex-wrap gap-2 items-center text-sm mb-4">
            {!isSystem && <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider border ${meta.color}`}>{alert.severity} • {alert.risk_band}</span>}
            {isSystem && <span className="bg-gray-800 text-white px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Warning</span>}
            
            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 font-medium">Zone: {alert.zone_md_from_m} - {alert.zone_md_to_m}m</span>
            
            {!isSystem && alert.formation && <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded border border-blue-200 font-medium">{alert.formation}</span>}
            
            {!isSystem && alert.confidence && <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-200 font-medium">Conf: <span className="capitalize">{alert.confidence}</span></span>}
          </div>
        </div>
        
        {!isSystem && alert.fused != null && (
          <div className="flex flex-col items-end">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Fused Score</span>
            <div className={`text-4xl font-black ${meta.color.split(' ')[1]}`}>{Math.round(alert.fused)}</div>
          </div>
        )}
      </div>

      <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg mb-5">
        <p className="text-gray-900 font-medium text-lg mb-2">{alert.message}</p>
        {alert.recommendation && (
          <div className="mt-3 text-blue-900 bg-blue-100/50 p-3 rounded border border-blue-200 text-sm">
            <span className="font-bold uppercase tracking-wider text-xs block mb-1">Action Recommendation:</span>
            {alert.recommendation}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 mb-6 bg-white border border-gray-100 p-3 rounded shadow-sm">
        <span className="font-bold uppercase tracking-wider text-gray-400 mr-2">Timeline:</span>
        <TimelineStep label="Generated" time={alert.created_at} active={true} />
        <span className="opacity-50">→</span>
        <TimelineStep label="Sent" time={alert.sent_at} active={!!alert.sent_at} />
        <span className="opacity-50">→</span>
        <TimelineStep label="Viewed" time={alert.viewed_at} active={!!alert.viewed_at} />
        
        {alert.state === 'escalated' && (
          <>
            <span className="opacity-50">→</span>
            <TimelineStep label="Escalated" active={true} className="text-red-600 border-red-200 bg-red-50" />
          </>
        )}
        
        <span className="opacity-50">→</span>
        <TimelineStep label="Acknowledged" time={alert.acknowledged_at} active={!!alert.acknowledged_at} className="text-green-700 border-green-200 bg-green-50" />
        <span className="opacity-50">→</span>
        <TimelineStep label="Resolved" time={alert.resolved_at} active={!!alert.resolved_at} className="text-blue-700 border-blue-200 bg-blue-50" />
      </div>

      <EvidencePanel alert={alert} />

      <div className="mt-2">
        <AlertActions alert={alert} user={user} onStateChange={onStateChange} />
        <FeedbackBar alert={alert} user={user} />
      </div>
    </div>
  );
}

function TimelineStep({ label, time, active, className = "text-gray-800 border-gray-300 bg-gray-100" }) {
  if (!active) return <span className="opacity-50 font-medium">{label}</span>;
  
  return (
    <span className={`px-2 py-0.5 rounded border font-bold flex gap-2 items-center ${className}`}>
      {label}
      {time && <span className="font-normal opacity-75 text-[10px]">{fmtTimeAgo(time)}</span>}
    </span>
  );
}

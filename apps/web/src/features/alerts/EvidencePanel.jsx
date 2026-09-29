import React from 'react';
import { Link } from 'react-router-dom';

export function EvidencePanel({ alert }) {
  if (alert.kind === 'system') return null;

  const { reasons = [] } = alert;
  
  const offsets = reasons.filter(r => r.kind === 'offset_event');
  const shaps = reasons.filter(r => r.kind === 'shap');
  const lessons = reasons.filter(r => r.kind === 'lesson');
  
  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm mt-4 shadow-sm">
      <h3 className="font-bold mb-3 border-b border-gray-200 pb-2 text-gray-800">Evidence Panel</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 uppercase tracking-wide text-xs">Layer Contributions</h4>
          <div className="space-y-1 mb-6 bg-white p-3 rounded border">
            <div className="flex justify-between"><span>L1 (Offsets):</span> <span className="font-mono font-medium">{alert.l1 != null ? (alert.l1 * 100).toFixed(1) + '%' : '-'}</span></div>
            <div className="flex justify-between"><span>L2 (ML):</span> <span className="font-mono font-medium">{alert.l2 != null ? (alert.l2 * 100).toFixed(1) + '%' : '-'}</span></div>
            <div className="flex justify-between"><span>L3 (Realtime):</span> <span className="font-mono font-medium">{alert.l3 != null ? (alert.l3 * 100).toFixed(1) + '%' : '-'}</span></div>
          </div>
          
          <h4 className="font-semibold text-gray-700 mb-2 uppercase tracking-wide text-xs">SHAP Features</h4>
          <ul className="list-disc pl-5 space-y-1">
            {shaps.length === 0 && <li className="text-gray-500 italic list-none -ml-5">No explicit feature reasons provided.</li>}
            {shaps.map((s, i) => (
              <li key={i}>{s.feature}: <span className="font-mono font-medium text-blue-600">{s.value?.toFixed(2)}</span></li>
            ))}
          </ul>
        </div>
        
        <div>
          {offsets.length > 0 && (
            <div className="mb-6">
              <h4 className="font-semibold text-gray-700 mb-2 uppercase tracking-wide text-xs">Offset Events (L1 Source)</h4>
              <ul className="space-y-2">
                {offsets.map((o, i) => (
                  <li key={i} className="bg-white p-3 border rounded shadow-sm">
                    <div className="font-bold text-gray-800">Well: {o.well_name || o.wellbore_id}</div>
                    <div className="text-gray-600">Distance behind bit: <span className="font-medium">{Math.round(o.depth_distance_m || 0)}m</span></div>
                    <div className="text-gray-600">NPT: <span className="font-medium">{o.npt_h}h</span></div>
                    {o.source_doc && (
                      <div className="mt-2 pt-2 border-t text-right">
                        <Link to={`/review/${o.source_doc}`} className="text-blue-600 font-medium hover:underline text-xs uppercase tracking-wider">View Source Report</Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lessons.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-2 uppercase tracking-wide text-xs">Recommended Lessons</h4>
              <ul className="space-y-2">
                {lessons.map((l, i) => (
                  <li key={i} className="bg-white p-3 border rounded shadow-sm">
                    <div className="text-gray-800">{l.mitigation}</div>
                    <div className="text-green-600 font-bold mt-1 text-xs uppercase tracking-wider">Success: {Math.round(l.success_rate * 100)}%</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

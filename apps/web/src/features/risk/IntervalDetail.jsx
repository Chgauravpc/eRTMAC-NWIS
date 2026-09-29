import React from 'react';
import { bandFor, BAND_META } from '../../lib/risk';

export function IntervalDetail({ score }) {
  if (!score) return <div className="p-8 text-gray-500 text-center border border-gray-200 border-dashed rounded-lg">Select a cell in the strip to view detailed risk breakdown.</div>;

  const band = bandFor(score.fused);
  const meta = BAND_META[band];

  return (
    <div className="p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold capitalize mb-1">{score.risk_type.replace('_', ' ')}</h3>
          <p className="text-sm text-gray-600 font-medium bg-gray-100 inline-block px-2 py-0.5 rounded">
            {score.md_from_m} - {score.md_to_m}m {score.formation && <span className="ml-1 text-gray-500">({score.formation})</span>}
          </p>
        </div>
        <div className={`px-4 py-1.5 rounded-full text-sm font-bold border ${meta.color} shadow-sm`}>
          Score: {Math.round(score.fused)} - {meta.label}
        </div>
      </div>

      <div className="mb-6 flex items-center gap-2">
        <strong className="text-sm text-gray-700">Confidence:</strong>
        <span className="capitalize text-sm font-medium bg-gray-100 px-2 py-0.5 rounded">{score.confidence}</span>
        {score.confidence_reason && <span className="text-sm text-amber-600 ml-2">({score.confidence_reason})</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <h4 className="font-bold text-sm mb-3 border-b border-gray-200 pb-2">Layer Contributions</h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">L1 (Offsets):</span> 
              <span className="font-mono font-medium">{score.l1 != null ? (score.l1 * 100).toFixed(1) + '%' : 'Not available'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">L2 (ML):</span> 
              <span className="font-mono font-medium">{score.l2 != null ? (score.l2 * 100).toFixed(1) + '%' : 'Not available'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">L3 (Realtime):</span> 
              <span className="font-mono font-medium">{score.l3 != null ? (score.l3 * 100).toFixed(1) + '%' : 'Not available'}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <h4 className="font-bold text-sm mb-3 border-b border-gray-200 pb-2">Reasons (SHAP & Offset Events)</h4>
          {score.reasons?.length > 0 ? (
            <ul className="text-sm space-y-2">
              {score.reasons.map((r, i) => (
                <li key={i} className="flex justify-between items-start">
                  <span className="truncate pr-3 text-gray-700">{r.feature || r.kind || r.event_id || JSON.stringify(r)}</span>
                  {r.value != null && <span className="font-mono font-medium text-blue-600">{Number(r.value).toFixed(3)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-500 italic">No specific feature reasons available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

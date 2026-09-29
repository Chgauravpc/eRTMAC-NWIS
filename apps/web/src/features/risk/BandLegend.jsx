import React from 'react';
import { BAND_META } from '../../lib/risk';

export function BandLegend() {
  const bands = [
    { range: '0–20', key: 'low' },
    { range: '21–40', key: 'moderate' },
    { range: '41–60', key: 'elevated' },
    { range: '61–80', key: 'high' },
    { range: '81–100', key: 'critical' }
  ];

  return (
    <div className="flex flex-wrap gap-4 text-sm mt-4 p-2 bg-gray-50 rounded border border-gray-100">
      {bands.map(b => (
        <div key={b.key} className="flex items-center gap-2 group relative">
          <div className={`w-4 h-4 rounded border ${BAND_META[b.key].color}`} />
          <span><strong>{b.range}</strong> {BAND_META[b.key].label}</span>
          
          <div className="hidden group-hover:block absolute bottom-full mb-1 left-0 bg-gray-800 text-white text-xs p-2 rounded shadow-lg whitespace-nowrap z-50">
            {BAND_META[b.key].meaning}
          </div>
        </div>
      ))}
    </div>
  );
}

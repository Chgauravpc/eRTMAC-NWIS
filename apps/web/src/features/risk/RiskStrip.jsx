import React from 'react';
import { bandFor, BAND_META } from '../../lib/risk';

const RISK_TYPES = ['losses', 'stuck_pipe', 'kick', 'torque', 'cementing'];
const LABELS = {
  losses: 'Mud losses',
  stuck_pipe: 'Stuck pipe',
  kick: 'Kick / overpressure',
  torque: 'Torque spike',
  cementing: 'Cementing issue'
};

export function RiskStrip({ bitMd, scores, onSelectCell, selectedCell }) {
  // Generate 12 intervals of 25m from bit
  const baseMd = Math.floor(bitMd / 25) * 25;
  const intervals = Array.from({ length: 12 }, (_, i) => {
    return { from: baseMd + i * 25, to: baseMd + (i + 1) * 25, isAtBit: i < 2 };
  });

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
      <div className="grid" style={{ gridTemplateColumns: `150px repeat(12, minmax(80px, 1fr))` }}>
        {/* Header row */}
        <div className="p-2 font-medium border-b border-r bg-gray-50 sticky left-0 z-10 flex items-center">
          Risk Type
        </div>
        {intervals.map((int, i) => (
          <div key={i} className={`p-2 text-xs font-medium border-b text-center border-r flex flex-col items-center justify-center ${int.isAtBit ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <span>{int.from} - {int.to}m</span>
            {int.isAtBit && <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mt-0.5">At Bit</span>}
          </div>
        ))}

        {/* Rows */}
        {RISK_TYPES.map(rt => (
          <React.Fragment key={rt}>
            <div className="p-2 text-sm border-r border-b bg-white sticky left-0 z-10 font-medium text-gray-700 flex items-center">
              {LABELS[rt]}
            </div>
            {intervals.map((int, i) => {
              const cellScore = scores.find(s => s.risk_type === rt && s.md_from_m === int.from && s.md_to_m === int.to);
              const val = cellScore?.fused;
              const band = val != null ? bandFor(val) : null;
              const meta = band ? BAND_META[band] : null;
              
              const isSelected = selectedCell === cellScore;
              const lowConf = cellScore?.confidence === 'low';
              
              let classes = "border-b border-r flex items-center justify-center p-2 cursor-pointer text-sm font-bold transition-all hover:opacity-80";
              if (meta) {
                classes += ` ${meta.color}`;
              } else {
                classes += " bg-white text-gray-400";
              }
              if (isSelected) classes += " ring-2 ring-inset ring-blue-500 shadow-inner";
              
              return (
                <div 
                  key={i} 
                  className={classes} 
                  style={lowConf ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.4) 5px, rgba(255,255,255,0.4) 10px)' } : {}}
                  onClick={() => cellScore && onSelectCell(cellScore)}
                >
                  {val != null ? Math.round(val) : '-'}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

import React from 'react';
import { bandFor, BAND_META } from '../../lib/risk';

export function computeMaxGauges(scores) {
  const maxes = {};
  ['losses', 'stuck_pipe', 'kick', 'torque', 'cementing'].forEach(rt => {
    const rtScores = scores.filter(s => s.risk_type === rt);
    if (rtScores.length === 0) {
      maxes[rt] = null;
      return;
    }
    const maxScore = rtScores.reduce((prev, curr) => (curr.fused > prev.fused ? curr : prev), rtScores[0]);
    maxes[rt] = maxScore;
  });
  return maxes;
}

const borderColorMap = {
  low: 'border-green-500',
  moderate: 'border-yellow-500',
  elevated: 'border-amber-500',
  high: 'border-orange-500',
  critical: 'border-red-500'
};

const textColorMap = {
  low: 'text-green-400',
  moderate: 'text-yellow-400',
  elevated: 'text-amber-400',
  high: 'text-orange-400',
  critical: 'text-red-400'
};

export function RiskGauges({ scores }) {
  const maxes = computeMaxGauges(scores);
  const order = ['losses', 'stuck_pipe', 'kick', 'torque', 'cementing'];
  const labels = {
    losses: 'Mud losses',
    stuck_pipe: 'Stuck pipe',
    kick: 'Kick / overpressure',
    torque: 'Torque spike',
    cementing: 'Cementing issue'
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg text-white h-full flex flex-col justify-center">
      <h2 className="text-gray-400 text-xl font-bold uppercase tracking-wider mb-6">Look-Ahead Risk (Next 300m)</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {order.map(rt => {
          const max = maxes[rt];
          if (!max) return <GaugeEmpty key={rt} label={labels[rt]} />;
          
          const band = bandFor(max.fused);
          const bColor = borderColorMap[band] || 'border-gray-500';
          const tColor = textColorMap[band] || 'text-gray-400';

          return (
            <div key={rt} className={`border-t-4 p-4 bg-gray-700/50 rounded flex flex-col justify-between ${bColor}`}>
              <h3 className="text-sm font-bold text-gray-300 mb-2 h-10">{labels[rt]}</h3>
              <div>
                <div className="text-4xl font-black mb-1">{Math.round(max.fused)}</div>
                <div className={`text-sm font-bold uppercase ${tColor}`}>{band}</div>
              </div>
              <div className="mt-4 text-xs text-gray-400">
                Peak at <span className="text-gray-200">{max.md_from_m}m</span>
                <br/>
                Conf: <span className="capitalize">{max.confidence}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GaugeEmpty({ label }) {
  return (
    <div className="border-t-4 border-gray-600 p-4 bg-gray-700/30 rounded flex flex-col justify-between">
      <h3 className="text-sm font-bold text-gray-400 mb-2 h-10">{label}</h3>
      <div className="text-2xl font-bold text-gray-500">-</div>
    </div>
  );
}

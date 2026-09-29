import React from 'react';
import { fmtTimeAgo } from '../../lib/units';

export function DepthPanel({ streamState }) {
  if (!streamState) return (
    <div className="bg-gray-800 p-6 rounded-lg text-white min-h-[200px] flex items-center justify-center">
      <div className="text-gray-500 text-xl font-bold">Waiting for stream state...</div>
    </div>
  );

  const { bit_md_m, hole_md_m, status, last_sample_at, latest } = streamState;
  
  return (
    <div className="bg-gray-800 p-6 rounded-lg text-white">
      <div className="flex justify-between items-start mb-8 border-b border-gray-700 pb-6">
        <div>
          <h2 className="text-gray-400 text-xl font-bold uppercase tracking-wider mb-2">Bit Depth (MD)</h2>
          <div className="text-7xl font-black text-blue-400 drop-shadow-sm">{bit_md_m != null ? bit_md_m.toFixed(1) : '-'} <span className="text-4xl text-gray-500 font-bold ml-1">m</span></div>
        </div>
        <div className="text-right">
          <h2 className="text-gray-400 text-lg uppercase tracking-wider mb-1">Hole Depth</h2>
          <div className="text-4xl font-bold">{hole_md_m != null ? hole_md_m.toFixed(1) : '-'} <span className="text-2xl text-gray-500">m</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5 text-lg">
        <Metric label="ROP" val={latest?.rop_m_h} unit="m/h" />
        <Metric label="Torque" val={latest?.torque_knm} unit="kN.m" />
        <Metric label="Flow In" val={latest?.flow_in_lpm} unit="L/min" />
        <Metric label="Flow Out" val={latest?.flow_out_lpm} unit="L/min" />
        <Metric label="Pit Vol" val={latest?.pit_vol_m3} unit="m³" />
      </div>

      {status === 'lost' && (
        <div className="mt-6 bg-red-900/50 border border-red-500 text-red-200 p-4 rounded-lg font-bold">
          Live data lost at {new Date(last_sample_at).toLocaleTimeString()}. Look-ahead from offset wells continues; live detectors paused.
        </div>
      )}
      
      {status !== 'lost' && status !== 'stopped' && (
        <div className="mt-6 flex items-center justify-end text-gray-400 text-sm font-medium">
          <span className={`w-3 h-3 rounded-full mr-2 ${status === 'live' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
          Stream {status}: last data {fmtTimeAgo(last_sample_at)}
        </div>
      )}
      {status === 'stopped' && (
        <div className="mt-6 flex items-center justify-end text-gray-500 text-sm font-medium">
          <span className="w-3 h-3 rounded-full mr-2 bg-gray-600"></span>
          Stream stopped
        </div>
      )}
    </div>
  );
}

function Metric({ label, val, unit }) {
  return (
    <div className="bg-gray-700/40 p-4 rounded-lg text-center border border-gray-700">
      <div className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2">{label}</div>
      <div className="text-3xl font-bold text-gray-100">{val != null ? val.toFixed(1) : '-'}</div>
      <div className="text-xs text-gray-500 font-medium uppercase mt-1">{unit}</div>
    </div>
  );
}

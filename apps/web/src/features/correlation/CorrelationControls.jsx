import React from 'react';
import { ALL_CHANNELS, MAX_OFFSETS } from './correlationModel';
import { CHANNEL_META } from './traceBuilder';
import { fmtDistance } from '../../lib/units';

/** Presentational controls: offsets (max 6), flatten formation, channels. State lives in CorrelationTab. */
export function CorrelationControls({ offsets, selectedOffsets, onOffsetsChange, formations, flatten, onFlattenChange, channels, onChannelsChange }) {
  const toggleOffset = (id) => {
    const on = selectedOffsets.includes(id);
    if (!on && selectedOffsets.length >= MAX_OFFSETS) return;
    onOffsetsChange(on ? selectedOffsets.filter((x) => x !== id) : [...selectedOffsets, id]);
  };
  const toggleChannel = (ch) => {
    const on = channels.includes(ch);
    if (on && channels.length === 1) return; // keep at least one track
    onChannelsChange(ALL_CHANNELS.filter((c) => (c === ch ? !on : channels.includes(c))));
  };

  return (
    <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm md:grid-cols-3">
      <div>
        <label htmlFor="corr-flatten" className="mb-1 block font-medium text-gray-700">Flatten on formation</label>
        <select id="corr-flatten" className="w-full rounded border border-gray-300 bg-white p-2" value={flatten} onChange={(e) => onFlattenChange(e.target.value)}>
          <option value="">None (true MD)</option>
          {formations.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <fieldset>
        <legend className="mb-1 font-medium text-gray-700">Offsets ({selectedOffsets.length}/{MAX_OFFSETS})</legend>
        <div className="max-h-28 space-y-1 overflow-y-auto">
          {offsets.length === 0 && <p className="text-gray-500">No offsets in range.</p>}
          {offsets.map((o) => {
            const on = selectedOffsets.includes(o.wellbore_id);
            return (
              <label key={o.wellbore_id} className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={on} disabled={!on && selectedOffsets.length >= MAX_OFFSETS} onChange={() => toggleOffset(o.wellbore_id)} />
                <span>{o.well_name} <span className="text-gray-500">({fmtDistance(o.surface_distance_m)})</span></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-medium text-gray-700">Channels</legend>
        <div className="grid grid-cols-2 gap-2">
          {ALL_CHANNELS.map((ch) => (
            <label key={ch} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} />
              <span>{CHANNEL_META[ch]?.label || ch} <span className="text-xs text-gray-500">{ch}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

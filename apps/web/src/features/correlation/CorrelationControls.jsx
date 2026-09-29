import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const ALL_CHANNELS = ['gr_api', 'rop_m_h', 'torque_knm', 'mw_sg', 'ecd_sg'];

export function CorrelationControls({ params, onChange, wellboreId }) {
  const [availableOffsets, setAvailableOffsets] = useState([]);
  const [availableFormations, setAvailableFormations] = useState([]);

  useEffect(() => {
    supabase.rpc('offsets_within', { p_wellbore: wellboreId, p_radius_m: 25000 })
      .then(({ data }) => setAvailableOffsets(data || []));

    supabase.from('formation_tops').select('formation').eq('wellbore_id', wellboreId)
      .then(({ data }) => {
        if (data) setAvailableFormations([...new Set(data.map(d => d.formation))]);
      });
  }, [wellboreId]);

  const toggleChannel = (ch) => {
    onChange(p => {
      const next = p.channels.includes(ch) ? p.channels.filter(c => c !== ch) : [...p.channels, ch];
      return { ...p, channels: next };
    });
  };

  const handleOffsetChange = (e) => {
    const selected = Array.from(e.target.selectedOptions, option => option.value);
    if (selected.length <= 6) {
      onChange(p => ({ ...p, offsets: selected }));
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 flex gap-6 items-start text-sm">
      <div className="flex flex-col gap-1">
        <label className="font-medium text-gray-700">Flatten Formation</label>
        <select 
          className="border border-gray-300 rounded p-2 w-48" 
          value={params.flatten} 
          onChange={e => onChange(p => ({ ...p, flatten: e.target.value }))}
        >
          <option value="">None (True MD)</option>
          {availableFormations.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1 flex-1">
        <label className="font-medium text-gray-700">Offsets (max 6)</label>
        <select 
          multiple 
          className="border border-gray-300 rounded p-1 h-24 w-full" 
          value={params.offsets} 
          onChange={handleOffsetChange}
        >
          {availableOffsets.map(o => (
            <option key={o.wellbore_id} value={o.wellbore_id}>
              {o.well_name} ({Math.round(o.surface_distance_m)}m away)
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 w-64">
        <label className="font-medium text-gray-700">Channels</label>
        <div className="grid grid-cols-2 gap-2">
          {ALL_CHANNELS.map(ch => (
            <label key={ch} className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={params.channels.includes(ch)} 
                onChange={() => toggleChannel(ch)} 
              />
              {ch}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

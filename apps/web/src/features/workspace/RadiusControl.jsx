import React from 'react';

export function RadiusControl({ params, onChange }) {
  const update = (key, val) => onChange(prev => ({ ...prev, [key]: val }));

  return (
    <div className="absolute top-4 right-4 z-[400] bg-white p-4 rounded shadow-md w-72 text-sm border border-gray-200">
      <h3 className="font-bold mb-3">Map Controls</h3>
      
      <div className="mb-3">
        <label className="block text-gray-700 mb-1" htmlFor="radius">Radius: {params.radius / 1000} km</label>
        <input 
          id="radius"
          type="range" min="1000" max="25000" step="1000" 
          value={params.radius} 
          onChange={e => update('radius', Number(e.target.value))} 
          className="w-full"
        />
      </div>

      <div className="mb-3">
        <label className="block text-gray-700 mb-1" htmlFor="depth">Depth (MD m)</label>
        <input 
          id="depth"
          type="range" min="0" max="5000" step="10" 
          value={params.depth || 0} 
          onChange={e => update('depth', Number(e.target.value))} 
          className="w-full"
        />
      </div>

      <div className="mb-3">
        <label className="flex items-center gap-2">
          <input 
            id="mode"
            type="checkbox" 
            checked={params.mode === 'depth'} 
            onChange={e => update('mode', e.target.checked ? 'depth' : 'surface')} 
          />
          Distance at depth
        </label>
        <p className="text-xs text-gray-500 mt-1">Deviated wells can be far apart at depth even when close at surface.</p>
      </div>

      <div className="space-y-2">
        <input 
          id="formation"
          type="text" placeholder="Formation filter..." 
          className="w-full border rounded px-2 py-1" 
          value={params.formation} 
          onChange={e => update('formation', e.target.value)} 
        />
        <input 
          id="event_type"
          type="text" placeholder="Event type filter..." 
          className="w-full border rounded px-2 py-1" 
          value={params.eventType} 
          onChange={e => update('eventType', e.target.value)} 
        />
      </div>
    </div>
  );
}

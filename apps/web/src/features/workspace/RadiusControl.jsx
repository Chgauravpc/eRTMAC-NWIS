import React from 'react';
import { EVENT_TYPES, PROVENANCES } from '../../lib/constants';
import { fmtDepth } from '../../lib/units';

const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const SELECT = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none';

/**
 * Map controls. `params` = {radius (m), depth (m|null), mode, formation, eventType, provenance};
 * `onChange` receives an updater `(prev) => next`. The depth slider runs 0..maxDepth (active TD) and
 * shows `depth` (already resolved to the bit depth by the parent when the user has not moved it).
 */
export function RadiusControl({ params, onChange, maxDepth = 0, depth = 0, bitMd = null, formations = [] }) {
  const update = (key, val) => onChange((prev) => ({ ...prev, [key]: val }));

  return (
    <section aria-label="Map controls" className="space-y-6 rounded-xl border border-gray-800/60 bg-[#111827] shadow-lg shadow-black/20 p-5 text-sm">
      <div>
        <label className="mb-2 block font-medium text-gray-200" htmlFor="map-radius">
          Radius: {params.radius / 1000} km
        </label>
        <input
          id="map-radius"
          type="range"
          min="1"
          max="25"
          step="1"
          value={params.radius / 1000}
          onChange={(e) => update('radius', Number(e.target.value) * 1000)}
          className="w-full accent-blue-500"
        />
      </div>

      <div>
        <label className="mb-2 block font-medium text-gray-200" htmlFor="map-depth">
          Depth (MD): {fmtDepth(depth)}
        </label>
        <input
          id="map-depth"
          type="range"
          min="0"
          max={maxDepth || 0}
          step="10"
          value={Math.min(depth ?? 0, maxDepth || 0)}
          onChange={(e) => update('depth', Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>0 m</span>
          <span>{bitMd != null ? 'default: bit depth' : 'no live bit depth'}</span>
          <span>TD {fmtDepth(maxDepth)}</span>
        </div>
        {bitMd != null && params.depth != null && (
          <button type="button" className="mt-2 text-xs text-blue-400 hover:text-blue-300 hover:underline" onClick={() => update('depth', null)}>
            Reset to bit depth
          </button>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 font-medium text-gray-200">Distance mode</legend>
        <div className="flex gap-4 text-gray-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="map-mode" checked={params.mode === 'surface'} onChange={() => update('mode', 'surface')} className="text-blue-400 focus:ring-blue-500 bg-gray-800 border-gray-700" />
            Distance at surface
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="map-mode" checked={params.mode === 'depth'} onChange={() => update('mode', 'depth')} className="text-blue-400 focus:ring-blue-500 bg-gray-800 border-gray-700" />
            Distance at depth
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">Deviated wells can be far apart at depth even when close at surface.</p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400" htmlFor="map-formation">Formation</label>
          <select id="map-formation" className={SELECT} value={params.formation} onChange={(e) => update('formation', e.target.value)}>
            <option value="">All formations</option>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400" htmlFor="map-event-type">Event type</label>
          <select id="map-event-type" className={SELECT} value={params.eventType} onChange={(e) => update('eventType', e.target.value)}>
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400" htmlFor="map-provenance">Provenance</label>
          <select id="map-provenance" className={SELECT} value={params.provenance} onChange={(e) => update('provenance', e.target.value)}>
            <option value="">All provenances</option>
            {PROVENANCES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
    </section>
  );
}

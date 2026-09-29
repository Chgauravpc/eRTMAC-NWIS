import React from 'react';
import { EVENT_TYPES, PROVENANCES } from '../../lib/constants';
import { fmtDepth } from '../../lib/units';

const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const SELECT = 'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm';

/**
 * Map controls. `params` = {radius (m), depth (m|null), mode, formation, eventType, provenance};
 * `onChange` receives an updater `(prev) => next`. The depth slider runs 0..maxDepth (active TD) and
 * shows `depth` (already resolved to the bit depth by the parent when the user has not moved it).
 */
export function RadiusControl({ params, onChange, maxDepth = 0, depth = 0, bitMd = null, formations = [] }) {
  const update = (key, val) => onChange((prev) => ({ ...prev, [key]: val }));

  return (
    <section aria-label="Map controls" className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <div>
        <label className="mb-1 block font-medium text-gray-700" htmlFor="map-radius">
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
          className="w-full"
        />
      </div>

      <div>
        <label className="mb-1 block font-medium text-gray-700" htmlFor="map-depth">
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
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>0 m</span>
          <span>{bitMd != null ? 'default: bit depth' : 'no live bit depth'}</span>
          <span>TD {fmtDepth(maxDepth)}</span>
        </div>
        {bitMd != null && params.depth != null && (
          <button type="button" className="mt-1 text-xs text-blue-700 hover:underline" onClick={() => update('depth', null)}>
            Reset to bit depth
          </button>
        )}
      </div>

      <fieldset>
        <legend className="mb-1 font-medium text-gray-700">Distance</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-1">
            <input type="radio" name="map-mode" checked={params.mode === 'surface'} onChange={() => update('mode', 'surface')} />
            Distance at surface
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="map-mode" checked={params.mode === 'depth'} onChange={() => update('mode', 'depth')} />
            Distance at depth
          </label>
        </div>
        <p className="mt-1 text-xs text-gray-500">Deviated wells can be far apart at depth even when close at surface.</p>
      </fieldset>

      <div className="grid grid-cols-1 gap-2">
        <div>
          <label className="mb-0.5 block text-xs font-medium text-gray-600" htmlFor="map-formation">Formation</label>
          <select id="map-formation" className={SELECT} value={params.formation} onChange={(e) => update('formation', e.target.value)}>
            <option value="">All formations</option>
            {formations.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs font-medium text-gray-600" htmlFor="map-event-type">Event type</label>
          <select id="map-event-type" className={SELECT} value={params.eventType} onChange={(e) => update('eventType', e.target.value)}>
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs font-medium text-gray-600" htmlFor="map-provenance">Provenance</label>
          <select id="map-provenance" className={SELECT} value={params.provenance} onChange={(e) => update('provenance', e.target.value)}>
            <option value="">All provenances</option>
            {PROVENANCES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
    </section>
  );
}

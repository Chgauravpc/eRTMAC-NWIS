import React from 'react';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../wells/StateBlocks';
import { fmtDistance } from '../../lib/units';
import { activeDistance, sortOffsets } from './mapGeo';

/** Offsets sorted by the active distance; both distances are shown; clicking a row calls onSelect(wellbore_id). */
export function OffsetList({ offsets, mode, isLoading, error, onRetry, radiusM, selectedId, onSelect }) {
  if (isLoading) return <LoadingBlock label="Finding offsets…" />;
  if (error) return <ErrorBlock message="Could not load offset wells." onRetry={onRetry} />;
  if (!offsets || offsets.length === 0) {
    return <EmptyBlock>No offsets within {radiusM ? `${radiusM / 1000} km` : 'this radius'}. Widen the radius or relax the filters.</EmptyBlock>;
  }
  const sorted = sortOffsets(offsets, mode);
  const depthMode = mode === 'depth';

  return (
    <div>
      <h3 className="mb-2 text-lg font-bold text-white">Offset wells ({sorted.length})</h3>
      <p className="mb-4 text-xs text-gray-400">Sorted by {depthMode ? 'distance at depth' : 'distance at surface'}.</p>
      <ol className="space-y-3" data-testid="offset-list">
        {sorted.map((o) => {
          const used = activeDistance(o, mode);
          return (
            <li key={o.wellbore_id}>
              <button
                type="button"
                data-testid="offset-row"
                aria-pressed={selectedId === o.wellbore_id}
                onClick={() => onSelect?.(o.wellbore_id)}
                className={`w-full rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedId === o.wellbore_id ? 'border-blue-500/50 bg-blue-900/20' : 'border-gray-800 bg-[#0f172a] hover:border-gray-700 hover:bg-gray-800/50'}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span data-testid="offset-name" className="font-medium text-blue-400 hover:text-blue-300">{o.well_name}</span>
                  <ProvenanceBadge provenance={o.provenance} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                  <div className={!depthMode ? 'font-semibold text-gray-200' : ''}>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Surface</span>
                    <span data-testid="surface-dist">{fmtDistance(o.surface_distance_m)}</span>
                  </div>
                  <div className={depthMode ? 'font-semibold text-gray-200' : ''}>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Depth</span>
                    <span data-testid="depth-dist">{o.depth_distance_m == null ? '-' : fmtDistance(o.depth_distance_m)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Events</span>
                    <span className="font-medium text-gray-200">{o.event_count ?? 0}</span>
                  </div>
                </div>
                <span className="sr-only">Sorted distance {fmtDistance(used)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

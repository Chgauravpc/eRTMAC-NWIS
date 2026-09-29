import React from 'react';
import { Badge, Spinner } from '../../components/ui/Primitives';

export function OffsetList({ offsets, mode, isLoading }) {
  if (isLoading) return <div className="flex justify-center p-4"><Spinner /></div>;
  if (!offsets || offsets.length === 0) return <div className="text-gray-500">No offsets found.</div>;

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-lg mb-4">Offset Wells ({offsets.length})</h3>
      {offsets.map(offset => (
        <div key={offset.wellbore_id} className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition-colors">
          <div className="flex justify-between items-start mb-1">
            <span className="font-medium text-blue-600">{offset.well_name}</span>
            <Badge>{offset.provenance}</Badge>
          </div>
          <div className="text-xs text-gray-600 grid grid-cols-2 gap-1 mt-2">
            <div>Events: <span className="font-medium">{offset.event_count || 0}</span></div>
            <div>
              {mode === 'depth' ? 'Depth dist: ' : 'Surface dist: '} 
              <span className="font-medium">
                {Math.round(mode === 'depth' ? offset.depth_distance_m : offset.surface_distance_m)}m
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

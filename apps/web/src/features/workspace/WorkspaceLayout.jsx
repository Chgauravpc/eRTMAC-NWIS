import React from 'react';
import { Outlet, useParams, NavLink } from 'react-router-dom';
import { WellHeader } from './WellHeader';
import { useFormationAtMd, useStreamState, useWellSummary } from '../../lib/hooks/wells';
import { cn } from '../../components/ui/Primitives';
import { ErrorBlock } from '../wells/StateBlocks';

// Tab order = the journey order (PRD FE-04).
export const WORKSPACE_TABS = [
  { name: 'Map', path: 'map' },
  { name: 'Formation & events', path: 'formation' },
  { name: 'Correlation', path: 'correlation' },
  { name: 'Risk ahead', path: 'risk' },
  { name: 'Alerts', path: 'alerts' },
];

export default function WorkspaceLayout() {
  const { wellboreId } = useParams();
  const { data: well, error, refetch } = useWellSummary(wellboreId);
  const { data: streamState } = useStreamState(wellboreId); // Realtime: header follows the bit
  const { data: formation } = useFormationAtMd(wellboreId, streamState?.bit_md_m);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {error ? (
        <ErrorBlock message="This well could not be loaded." onRetry={() => refetch()} />
      ) : (
        <WellHeader well={well} streamState={streamState} formation={formation} />
      )}
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <nav aria-label="Well workspace" className="-mb-px flex space-x-6 px-4">
          {WORKSPACE_TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  isActive ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )
              }
            >
              {tab.name}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="relative z-0 flex-1 overflow-auto p-4">
        <Outlet />
      </div>
    </div>
  );
}

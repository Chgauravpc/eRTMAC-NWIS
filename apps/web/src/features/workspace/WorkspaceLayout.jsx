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
    <div className="flex h-full flex-col">
      {error ? (
        <ErrorBlock message="This well could not be loaded." onRetry={() => refetch()} />
      ) : (
        <WellHeader well={well} streamState={streamState} formation={formation} />
      )}
      <div className="border-b border-gray-800/60 bg-[#0B0F19]">
        <nav aria-label="Well workspace" className="-mb-px flex space-x-6 px-6">
          {WORKSPACE_TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  isActive ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:border-gray-700 hover:text-gray-300',
                )
              }
            >
              {tab.name}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="relative z-0 flex-1 overflow-auto bg-[#0f172a] p-4 sm:p-6 lg:p-8">
        <Outlet />
      </div>
    </div>
  );
}

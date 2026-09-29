import React, { useEffect, useState } from 'react';
import { Outlet, useParams, NavLink } from 'react-router-dom';
import { WellHeader } from './WellHeader';
import { useWellSummary, useFormationAtMd } from '../../lib/hooks/wells';
import { subscribe } from '../../lib/realtime';
import { supabase } from '../../lib/supabase';
import { cn } from '../../components/ui/Primitives';

export default function WorkspaceLayout() {
  const { wellboreId } = useParams();
  const { data: well } = useWellSummary(wellboreId);
  
  const [streamState, setStreamState] = useState(null);
  const bitDepth = streamState?.bit_md_m;
  const { data: formation } = useFormationAtMd(wellboreId, bitDepth);

  useEffect(() => {
    // Initial fetch
    supabase.from('stream_state').select('*').eq('wellbore_id', wellboreId).single().then(({ data }) => {
      if (data) setStreamState(data);
    });

    const unsub = subscribe('stream_state', `wellbore_id=eq.${wellboreId}`, (payload) => {
      setStreamState(payload.new);
    });
    return () => unsub();
  }, [wellboreId]);

  const tabs = [
    { name: 'Map', path: 'map' },
    { name: 'Formation & events', path: 'formation' },
    { name: 'Correlation', path: 'correlation' },
    { name: 'Risk ahead', path: 'risk' },
    { name: 'Alerts', path: 'alerts' }
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <WellHeader well={well} streamState={streamState} formation={formation} />
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <nav className="flex -mb-px px-4 space-x-6">
          {tabs.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) => cn(
                "whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors",
                isActive ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              {tab.name}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-auto p-4 relative z-0">
        <Outlet />
      </div>
    </div>
  );
}

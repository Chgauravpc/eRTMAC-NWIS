import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useProfile } from '../auth/useProfile';
import { AlertCard } from './AlertCard';

export function AlertsPage() {
  const { profile } = useProfile();
  const [filterState, setFilterState] = useState('open'); // all, open, resolved

  const { data: alerts, refetch } = useQuery({
    queryKey: ['v_open_alerts'],
    queryFn: async () => {
      // In a real app we'd query v_open_alerts for open, and standard table for resolved history
      // We'll query standard alerts table to handle history too
      const { data, error } = await supabase.from('alerts').select('*');
      if (error) throw error;
      return data || [];
    }
  });

  const filtered = (alerts || []).filter(a => {
    if (filterState === 'open') return a.state !== 'resolved';
    if (filterState === 'resolved') return a.state === 'resolved';
    return true;
  }).sort((a, b) => {
    // Unacknowledged warning/critical pinned to top
    const aPin = ['sent','viewed','escalated'].includes(a.state) && ['warning','critical'].includes(a.severity);
    const bPin = ['sent','viewed','escalated'].includes(b.state) && ['warning','critical'].includes(b.severity);
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    
    // Sort descending by created_at
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Group by well
  const byWell = {};
  filtered.forEach(a => {
    if (!byWell[a.wellbore_id]) byWell[a.wellbore_id] = [];
    byWell[a.wellbore_id].push(a);
  });

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">RTOC Global Alerts</h1>
        
        <div className="bg-white rounded-lg border border-gray-200 p-1 flex shadow-sm">
          <button 
            className={`px-4 py-1.5 rounded-md text-sm font-bold ${filterState === 'open' ? 'bg-blue-100 text-blue-800' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setFilterState('open')}
          >
            Open / Active
          </button>
          <button 
            className={`px-4 py-1.5 rounded-md text-sm font-bold ${filterState === 'resolved' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setFilterState('resolved')}
          >
            Resolved History
          </button>
        </div>
      </div>

      {Object.keys(byWell).length === 0 ? (
        <div className="text-center p-16 bg-white border border-gray-200 rounded-xl shadow-sm text-gray-500 text-lg">
          No alerts matching the current filter.
        </div>
      ) : (
        <div className="space-y-12">
          {Object.entries(byWell).map(([well, wellAlerts]) => (
            <div key={well} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
              <h2 className="text-xl font-bold uppercase tracking-wider text-gray-700 mb-6 flex items-center gap-3">
                <span className="bg-gray-300 text-gray-800 w-8 h-8 flex items-center justify-center rounded-full text-sm">📍</span>
                Wellbore: {well}
                <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded ml-auto font-medium">{wellAlerts.length} Alerts</span>
              </h2>
              
              <div className="space-y-6">
                {wellAlerts.map(a => (
                  <AlertCard key={a.id} alert={a} user={profile} onStateChange={refetch} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

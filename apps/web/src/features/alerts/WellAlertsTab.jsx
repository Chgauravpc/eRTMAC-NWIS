import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useProfile } from '../auth/useProfile';
import { AlertCard } from './AlertCard';

export function WellAlertsTab() {
  const { wellboreId } = useParams();
  const { profile } = useProfile();

  const { data: alerts, refetch } = useQuery({
    queryKey: ['alerts', wellboreId],
    queryFn: async () => {
      const { data, error } = await supabase.from('alerts').select('*').eq('wellbore_id', wellboreId).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  return (
    <div className="flex flex-col h-full gap-6 pb-6">
      <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">Well Alerts History</h2>
        <span className="text-sm font-bold bg-gray-100 text-gray-600 px-3 py-1 rounded uppercase tracking-wider">
          Total: {alerts?.length || 0}
        </span>
      </div>
      
      <div className="space-y-6">
        {alerts?.map(a => (
          <AlertCard key={a.id} alert={a} user={profile} onStateChange={refetch} />
        ))}
        {alerts?.length === 0 && (
          <div className="p-16 text-center text-gray-500 bg-white rounded-lg border border-gray-200 shadow-sm border-dashed">
            <span className="text-4xl mb-4 block">✅</span>
            No alerts generated for this wellbore yet.
          </div>
        )}
      </div>
    </div>
  );
}

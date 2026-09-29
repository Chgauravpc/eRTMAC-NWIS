import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CorrelationControls } from './CorrelationControls';
import { CorrelationPlot } from './CorrelationPlot';
import { Spinner, ErrorState } from '../../components/ui/Primitives';
import { api } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useDebounce } from 'use-debounce';

export function CorrelationTab() {
  const { wellboreId } = useParams();
  
  const [params, setParams] = useState({
    offsets: [],
    flatten: '',
    channels: ['gr_api', 'rop_m_h', 'mw_sg']
  });
  const [debouncedParams] = useDebounce(params, 300);

  useEffect(() => {
    if (params.offsets.length === 0) {
      supabase.rpc('offsets_within', { p_wellbore: wellboreId, p_radius_m: 10000, p_mode: 'surface' })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setParams(p => ({ ...p, offsets: data.slice(0, 4).map(w => w.wellbore_id) }));
          }
        });
    }
  }, [wellboreId, params.offsets.length]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['correlation', wellboreId, debouncedParams],
    queryFn: async () => {
      if (debouncedParams.offsets.length === 0) return null;
      const qs = new URLSearchParams();
      qs.set('offsets', debouncedParams.offsets.join(','));
      if (debouncedParams.flatten) qs.set('flatten', debouncedParams.flatten);
      if (debouncedParams.channels.length > 0) qs.set('channels', debouncedParams.channels.join(','));
      return api.get(`/api/wells/${wellboreId}/correlation?${qs.toString()}`);
    },
    enabled: !!wellboreId && debouncedParams.offsets.length > 0
  });

  return (
    <div className="flex flex-col h-full gap-4 pb-4">
      <CorrelationControls params={params} onChange={setParams} wellboreId={wellboreId} />
      <div className="flex-1 min-h-[600px] border border-gray-200 rounded-lg bg-white overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center"><Spinner /></div>
        ) : error ? (
          <div className="p-10"><ErrorState message="Failed to load correlation data" /></div>
        ) : data ? (
          <CorrelationPlot data={data} channels={debouncedParams.channels} flatten={debouncedParams.flatten} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">Select offsets to correlate</div>
        )}
      </div>
    </div>
  );
}

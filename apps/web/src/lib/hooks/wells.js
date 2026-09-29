import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

export function useWells() {
  return useQuery({
    queryKey: ['wells'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_well_summary').select('*');
      if (error) throw error;
      // Sort drilling first
      return data.sort((a, b) => {
        if (a.status === 'drilling' && b.status !== 'drilling') return -1;
        if (a.status !== 'drilling' && b.status === 'drilling') return 1;
        return 0;
      });
    }
  });
}

export function useWellSummary(wellboreId) {
  return useQuery({
    queryKey: ['wellSummary', wellboreId],
    queryFn: async () => {
      if (!wellboreId) return null;
      const { data, error } = await supabase.from('v_well_summary').select('*').eq('wellbore_id', wellboreId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!wellboreId
  });
}

export function useFormationAtMd(wellboreId, md) {
  return useQuery({
    queryKey: ['formation_at_md', wellboreId, md],
    queryFn: async () => {
      if (!wellboreId || md == null) return null;
      const { data, error } = await supabase.rpc('formation_at_md', { p_wellbore_id: wellboreId, p_md_m: md });
      if (error) throw error;
      return data[0] || null;
    },
    enabled: !!wellboreId && md != null
  });
}

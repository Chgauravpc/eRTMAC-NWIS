import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useDebounce } from 'use-debounce';

export function useMapData(wellboreId, params) {
  const [activeWell, setActiveWell] = useState(null);
  const [offsets, setOffsets] = useState([]);
  const [trajectories, setTrajectories] = useState([]);
  const [activeTrajectory, setActiveTrajectory] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Debounce the changing parameters like radius, depth
  const [debouncedParams] = useDebounce(params, 300);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      const { data: wellData } = await supabase.from('v_well_summary').select('*').eq('wellbore_id', wellboreId).single();
      setActiveWell(wellData);

      const { data: offsetData } = await supabase.rpc('offsets_within', {
        p_wellbore: wellboreId,
        p_radius_m: debouncedParams.radius,
        p_md: debouncedParams.depth,
        p_mode: debouncedParams.mode
      });
      setOffsets(offsetData || []);

      const { data: trajData } = await supabase.from('v_trajectory_geojson').select('*');
      
      if (trajData) {
        setActiveTrajectory(trajData.find(t => t.wellbore_id === wellboreId));
        setTrajectories(trajData.filter(t => offsetData?.some(o => o.wellbore_id === t.wellbore_id)));
      }

      setIsLoading(false);
    }
    
    if (wellboreId) fetchData();
  }, [wellboreId, debouncedParams]);

  return { activeWell, offsets, trajectories, activeTrajectory, isLoading };
}

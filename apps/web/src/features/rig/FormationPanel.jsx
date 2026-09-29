import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export function FormationPanel({ wellboreId, bitMd }) {
  const { data, isLoading } = useQuery({
    queryKey: ['formation_at_md', wellboreId, bitMd],
    queryFn: async () => {
      if (!wellboreId || bitMd == null) return null;
      const { data, error } = await supabase.rpc('formation_at_md', { p_wellbore_id: wellboreId, p_md_m: bitMd });
      if (error) throw error;
      return data[0];
    },
    enabled: !!wellboreId && bitMd != null
  });

  if (isLoading || !data) return (
    <div className="bg-gray-800 p-6 rounded-lg text-white min-h-[180px] flex items-center justify-center">
      <div className="text-gray-600 font-bold uppercase tracking-widest text-sm">Determining Formation...</div>
    </div>
  );

  const distToNext = data.next_top_md_m != null ? (data.next_top_md_m - bitMd) : null;

  return (
    <div className="bg-gray-800 p-6 rounded-lg text-white h-full flex flex-col justify-center">
      <h2 className="text-gray-400 text-xl font-bold uppercase tracking-wider mb-4">Formation</h2>
      <div className="text-4xl font-black mb-4 text-blue-400">{data.formation || 'Unknown'}</div>
      
      {data.next_formation ? (
        <div className="text-lg text-gray-400 border-t border-gray-700 pt-4 mt-2">
          <span className="font-bold text-gray-200">{data.next_formation}</span> in <span className="font-bold text-amber-400">~{Math.round(distToNext)} m</span>
        </div>
      ) : (
        <div className="text-lg text-gray-600 border-t border-gray-700 pt-4 mt-2">No expected formations ahead</div>
      )}
    </div>
  );
}

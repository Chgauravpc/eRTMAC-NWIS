import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export function LessonsPanel({ formation, nextFormation }) {
  const { data: lessons, isLoading } = useQuery({
    queryKey: ['lessons', formation, nextFormation],
    queryFn: async () => {
      const formations = [formation, nextFormation].filter(Boolean);
      if (formations.length === 0) return [];
      
      const { data, error } = await supabase.from('lessons')
        .select('*')
        .in('formation', formations)
        .order('success_rate', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
    enabled: !!formation || !!nextFormation
  });

  return (
    <div className="bg-gray-800 p-6 rounded-lg text-white">
      <h2 className="text-gray-400 text-xl font-bold uppercase tracking-wider mb-6">Top Lessons Ahead</h2>
      
      {isLoading ? (
        <div className="text-gray-600 font-bold uppercase tracking-widest text-sm text-center py-6">Loading lessons...</div>
      ) : !lessons || lessons.length === 0 ? (
        <div className="text-gray-500 text-center py-10 bg-gray-700/20 rounded-lg border border-gray-700 border-dashed">
          No lessons available for upcoming formations.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {lessons.map(l => (
            <div key={l.id} className="bg-gray-700/50 p-5 rounded-lg border border-gray-600 shadow-md">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-lg text-blue-300 mr-2">{l.title}</h3>
                <span className="text-xs font-bold uppercase tracking-wider bg-gray-600 text-gray-200 px-2 py-1 rounded shrink-0">{l.formation}</span>
              </div>
              <p className="text-gray-300 text-sm mb-4 leading-relaxed">{l.mitigation}</p>
              <div className="flex gap-4 text-xs font-bold uppercase tracking-wider text-gray-400 border-t border-gray-600/50 pt-3">
                <span>Success: <strong className="text-green-400">{Math.round(l.success_rate * 100)}%</strong></span>
                <span>Wells applied: <strong className="text-blue-300">{l.well_count}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

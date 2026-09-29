import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import { useProfile } from '../auth/useProfile';
import { fmtTimeAgo } from '../../lib/units';

export function ReviewQueue() {
  const { profile } = useProfile();
  const isReadOnly = profile?.role === 'office_engineer';

  const { data: queue, isLoading } = useQuery({
    queryKey: ['v_review_queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_review_queue').select('*');
      if (error) throw error;
      
      const byDoc = {};
      for (const row of (data || [])) {
        if (!byDoc[row.document_id]) {
          byDoc[row.document_id] = {
            document_id: row.document_id,
            doc_title: row.doc_title || 'Unknown Document',
            doc_type: row.doc_type || 'Unknown Type',
            wellbore_id: row.wellbore_id,
            pending_count: 0,
            oldest_created: row.created_at
          };
        }
        byDoc[row.document_id].pending_count += 1;
        if (new Date(row.created_at) < new Date(byDoc[row.document_id].oldest_created)) {
          byDoc[row.document_id].oldest_created = row.created_at;
        }
      }
      return Object.values(byDoc).sort((a, b) => new Date(a.oldest_created) - new Date(b.oldest_created));
    }
  });

  if (isLoading) return <div className="p-10 text-center font-bold text-gray-500">Loading queue...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Review Queue</h1>
          <p className="text-gray-500 mt-2">Validate extracted fields to unblock risk predictions.</p>
        </div>
        {isReadOnly && <span className="bg-gray-200 text-gray-700 px-3 py-1 rounded font-bold text-sm uppercase tracking-wider">Read Only</span>}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr>
              <th className="p-4">Document</th>
              <th className="p-4">Type</th>
              <th className="p-4 text-center">Pending Fields</th>
              <th className="p-4">Oldest Pending</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {queue?.map(d => (
              <tr key={d.document_id} className="hover:bg-blue-50/50 transition-colors">
                <td className="p-4 font-bold text-gray-900">{d.doc_title}</td>
                <td className="p-4"><span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">{d.doc_type}</span></td>
                <td className="p-4 font-mono font-black text-blue-600 text-center">{d.pending_count}</td>
                <td className="p-4 text-gray-500 font-medium">{fmtTimeAgo(d.oldest_created)}</td>
                <td className="p-4 text-right">
                  <Link to={`/review/${d.document_id}`} className={`inline-block font-bold py-1.5 px-4 rounded transition-colors text-sm uppercase tracking-wider ${isReadOnly ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    {isReadOnly ? 'View' : 'Review'}
                  </Link>
                </td>
              </tr>
            ))}
            {queue?.length === 0 && (
              <tr>
                <td colSpan="5" className="p-16 text-center text-gray-500 font-medium text-lg border-dashed">
                  <span className="text-4xl block mb-4">🎉</span>
                  Queue is empty. All documents reviewed!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

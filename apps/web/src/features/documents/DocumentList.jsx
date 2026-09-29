import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export function DocumentList() {
  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('documents')
        .select(`
          id, title, filename, doc_type, page_count, ocr_engine, provenance, created_at, status, 
          profiles (full_name),
          wellbores (well_name)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  if (isLoading) return <div className="p-10 text-center font-bold text-gray-500 uppercase tracking-widest">Loading documents...</div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex justify-between items-center p-5 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-bold text-gray-800">Library Index</h2>
        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 bg-gray-200 px-3 py-1 rounded">{docs?.length || 0} Files</span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-white text-gray-500 uppercase text-xs font-bold tracking-wider border-b border-gray-200">
            <tr>
              <th className="p-4">Title / Filename</th>
              <th className="p-4">Type</th>
              <th className="p-4">Well</th>
              <th className="p-4 text-center">Pages</th>
              <th className="p-4">Engine</th>
              <th className="p-4">Provenance</th>
              <th className="p-4">Uploaded</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {docs?.map(d => (
              <tr key={d.id} className="hover:bg-blue-50/50 transition-colors">
                <td className="p-4">
                  <div className="font-bold text-gray-900 truncate max-w-[250px]">{d.title || d.filename}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[250px]">{d.filename}</div>
                </td>
                <td className="p-4"><span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold uppercase">{d.doc_type || 'Auto'}</span></td>
                <td className="p-4 font-medium text-gray-800">{d.wellbores?.well_name || '-'}</td>
                <td className="p-4 text-center font-mono text-gray-500">{d.page_count || '-'}</td>
                <td className="p-4 text-xs font-bold uppercase tracking-wider text-gray-400">{d.ocr_engine || '-'}</td>
                <td className="p-4 capitalize text-gray-600">{d.provenance}</td>
                <td className="p-4 text-xs text-gray-500">
                  <div className="font-medium">{new Date(d.created_at).toLocaleDateString()}</div>
                  <div>{d.profiles?.full_name}</div>
                </td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    d.status === 'indexed' ? 'bg-green-100 text-green-800 border border-green-200' :
                    d.status === 'failed' ? 'bg-red-100 text-red-800 border border-red-200' : 
                    d.status === 'needs_review' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                    'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}>
                    {d.status}
                  </span>
                </td>
              </tr>
            ))}
            {docs?.length === 0 && (
              <tr>
                <td colSpan="8" className="p-16 text-center text-gray-500 font-medium text-lg border-dashed">
                  No documents found in the library.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

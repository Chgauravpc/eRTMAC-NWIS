import React from 'react';
import { Link } from 'react-router-dom';
import { PartyPopper } from 'lucide-react';
import { useProfile } from '../auth/useProfile';
import { useReviewQueue } from '../../lib/hooks/review';
import { fmtTimeAgo } from '../../lib/units';

export function ReviewQueue() {
  const { profile } = useProfile();
  const isReadOnly = !(profile?.role === 'reviewer' || profile?.role === 'admin');
  const { data: queue, isLoading, error } = useReviewQueue();

  if (isLoading) return <div className="p-10 text-center font-bold text-gray-600">Loading queue…</div>;
  if (error) {
    return (
      <div role="alert" className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 font-bold text-red-700">
        Could not load the review queue: {error.message}
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-7xl overflow-y-auto p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Review queue</h1>
          <p className="mt-2 text-gray-600">Check fields the extractor was unsure about before they feed the risk models.</p>
        </div>
        {isReadOnly && (
          <span className="rounded bg-gray-200 px-3 py-1 text-sm font-bold uppercase tracking-wider text-gray-700">Read only</span>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th scope="col" className="p-4">Document</th>
              <th scope="col" className="p-4">Type</th>
              <th scope="col" className="p-4">Well</th>
              <th scope="col" className="p-4 text-center">Pending fields</th>
              <th scope="col" className="p-4">Oldest pending</th>
              <th scope="col" className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {queue?.map((d) => (
              <tr key={d.doc_id} className="transition-colors hover:bg-blue-50/50">
                <td className="p-4 font-bold text-gray-900">{d.doc_title}</td>
                <td className="p-4">
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold uppercase text-gray-700">{d.doc_type}</span>
                </td>
                <td className="p-4 font-medium text-gray-800">{d.well_name || '-'}</td>
                <td className="p-4 text-center font-mono font-black text-blue-600">{d.pending_count}</td>
                <td className="p-4 font-medium text-gray-600">{fmtTimeAgo(d.oldest_at)}</td>
                <td className="p-4 text-right">
                  <Link
                    to={`/review/${d.doc_id}`}
                    aria-label={`${isReadOnly ? 'View' : 'Review'} ${d.doc_title}`}
                    className={`inline-block rounded px-4 py-1.5 text-sm font-bold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                      isReadOnly ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isReadOnly ? 'View' : 'Review'}
                  </Link>
                </td>
              </tr>
            ))}
            {queue?.length === 0 && (
              <tr>
                <td colSpan="6" className="p-16 text-center text-lg font-medium text-gray-700">
                  <PartyPopper className="mx-auto mb-4 h-10 w-10 text-gray-600" aria-hidden="true" />
                  Queue is empty. All documents are reviewed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

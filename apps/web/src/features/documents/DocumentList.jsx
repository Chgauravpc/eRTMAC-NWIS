import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useDocuments } from '../../lib/hooks/documents';
import { JOB_STATUS_LABELS, stageLabel } from './stages';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../wells/StateBlocks';

const STATUS_STYLE = {
  done: { cls: 'bg-green-100 text-green-800 border-green-200', Icon: CheckCircle2 },
  failed: { cls: 'bg-red-100 text-red-800 border-red-200', Icon: XCircle },
  needs_review: { cls: 'bg-amber-100 text-amber-800 border-amber-200', Icon: AlertTriangle },
  running: { cls: 'bg-blue-100 text-blue-800 border-blue-200', Icon: Loader2 },
  queued: { cls: 'bg-gray-100 text-gray-700 border-gray-200', Icon: Clock },
};

function StatusBadge({ job }) {
  if (!job) return <span className="text-xs text-gray-600">No job</span>;
  const style = STATUS_STYLE[job.status] || STATUS_STYLE.queued;
  const { Icon } = style;
  const label = JOB_STATUS_LABELS[job.status] || job.status;
  return (
    <span
      data-testid="doc-status"
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${style.cls}`}
    >
      <Icon className={`h-3 w-3 ${job.status === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {label}
      {job.status === 'running' && ` · ${stageLabel(job)} ${job.progress ?? 0}%`}
    </span>
  );
}

export function DocumentList() {
  const { data: docs, isLoading, error, refetch } = useDocuments();

  if (isLoading) return <LoadingBlock label="Loading documents…" />;
  if (error) return <ErrorBlock message={`Could not load documents: ${error.message}`} onRetry={refetch} />;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 p-5">
        <h2 className="text-lg font-bold text-gray-800">Library</h2>
        <span className="rounded bg-gray-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-600">
          {docs?.length || 0} files
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-gray-200 bg-white text-xs font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th scope="col" className="p-4">Title</th>
              <th scope="col" className="p-4">Type</th>
              <th scope="col" className="p-4">Well</th>
              <th scope="col" className="p-4 text-center">Pages</th>
              <th scope="col" className="p-4">OCR engine</th>
              <th scope="col" className="p-4">Provenance</th>
              <th scope="col" className="p-4">Uploaded</th>
              <th scope="col" className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {docs?.map((d) => (
              <tr key={d.id} className="transition-colors hover:bg-blue-50/50">
                <td className="max-w-[260px] truncate p-4 font-bold text-gray-900" title={d.title}>{d.title}</td>
                <td className="p-4">
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold uppercase text-gray-700">{d.doc_type}</span>
                </td>
                <td className="p-4 font-medium text-gray-800">{d.well_name || '-'}</td>
                <td className="p-4 text-center font-mono text-gray-600">{d.pages ?? '-'}</td>
                <td className="p-4 text-xs font-bold uppercase tracking-wider text-gray-500">{d.ocr_engine || '-'}</td>
                <td className="p-4">
                  <ProvenanceBadge provenance={d.provenance} />
                </td>
                <td className="p-4 text-xs text-gray-600">
                  <div className="font-medium">{d.created_at ? format(new Date(d.created_at), 'yyyy-MM-dd HH:mm') : '-'}</div>
                  <div>{d.uploaded_by_name || (d.uploaded_by ? `user ${String(d.uploaded_by).slice(0, 8)}` : '-')}</div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge job={d.job} />
                    {d.job?.status === 'needs_review' && (
                      <Link
                        to={`/review/${d.id}`}
                        className="text-xs font-bold uppercase tracking-wider text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        Review
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {docs?.length === 0 && (
              <tr>
                <td colSpan="8" className="p-0 border-t border-gray-200">
                  <EmptyBlock>No documents found in the library.</EmptyBlock>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

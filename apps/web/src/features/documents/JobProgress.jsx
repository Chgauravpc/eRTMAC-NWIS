import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw, XCircle } from 'lucide-react';
import { useJob, useJobSummary } from '../../lib/hooks/documents';
import { JOB_STAGES, stageIndex, stageLabel } from './stages';

/**
 * Live job progress (Realtime on jobs id=eq.<jobId>): stage stepper + bar, then the final states
 *  done -> "Ready: N events extracted", needs_review -> "N fields need review" + link, failed -> error + retry.
 * `onRetry` (optional) re-POSTs /api/documents only.
 */
export function JobProgress({ jobId, docId = null, onRetry }) {
  const { job } = useJob(jobId);
  const status = job?.status || 'queued';
  const { data: summary } = useJobSummary(docId, status);

  if (status === 'failed') {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <span className="flex items-start gap-2 font-bold">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Failed: {job?.error || 'Unknown error during processing'}</span>
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Retry processing
          </button>
        )}
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="flex items-center justify-between rounded border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Ready: {summary ? summary.events : '…'} events extracted
        </span>
        {docId && (
          <span className="flex gap-2">
            <Link to={`/search?doc=${docId}`} className="rounded border border-green-300 bg-white px-3 py-1 text-xs uppercase tracking-wider hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              View in search
            </Link>
            <Link to={`/review/${docId}`} className="rounded border border-green-300 bg-white px-3 py-1 text-xs uppercase tracking-wider hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              Review
            </Link>
          </span>
        )}
      </div>
    );
  }

  if (status === 'needs_review') {
    return (
      <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {summary ? summary.pending : '…'} fields need review
        </span>
        {docId && (
          <Link to={`/review/${docId}`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1 text-xs uppercase tracking-wider hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
            <ClipboardCheck className="h-3 w-3" aria-hidden="true" /> Review now
          </Link>
        )}
      </div>
    );
  }

  const idx = stageIndex(job);
  const progress = job?.progress ?? 0;
  return (
    <div className="w-full rounded border border-gray-100 bg-white p-3 shadow-sm">
      <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider text-gray-600">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
          {stageLabel(job)}
        </span>
        <span className="text-blue-600">{progress}%</span>
      </div>
      <ol className="mb-2 flex gap-1 text-[10px] font-bold uppercase tracking-wider" aria-label="Processing stages">
        {JOB_STAGES.map((s, i) => (
          <li
            key={s.key}
            aria-current={i === idx ? 'step' : undefined}
            className={`flex-1 rounded px-1 py-0.5 text-center ${
              i < idx ? 'bg-green-100 text-green-800' : i === idx ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-400' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {s.label}
          </li>
        ))}
      </ol>
      <div
        role="progressbar"
        aria-label="Document processing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
      >
        <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.max(3, progress)}%` }} />
      </div>
    </div>
  );
}

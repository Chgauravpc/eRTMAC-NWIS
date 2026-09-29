import React, { useEffect, useState } from 'react';
import { subscribe } from '../../lib/realtime';
import { Link } from 'react-router-dom';

export function JobProgress({ jobId, initialStatus = 'processing', docId = null, eventsExtracted = 0, needsReview = 0 }) {
  const [jobState, setJobState] = useState({ 
    status: initialStatus, 
    stage: 'Classify', 
    progress: 0,
    eventsExtracted,
    needsReview,
    errorMsg: ''
  });

  useEffect(() => {
    if (!jobId) return;
    
    const unsub = subscribe('jobs', `id=eq.${jobId}`, (payload) => {
      const j = payload.new;
      setJobState({
        status: j.status,
        stage: j.stage || 'Processing',
        progress: j.progress || 0,
        eventsExtracted: j.events_extracted || 0,
        needsReview: j.needs_review || 0,
        errorMsg: j.error_text || ''
      });
    });

    return () => unsub();
  }, [jobId]);

  if (jobState.status === 'failed') {
    return (
      <div className="text-red-600 text-sm font-bold bg-red-50 p-2 rounded border border-red-100">
        ❌ Failed: {jobState.errorMsg || 'Unknown error occurred during processing'}
      </div>
    );
  }

  if (jobState.status === 'completed') {
    return (
      <div className="text-sm bg-gray-50 p-3 rounded border border-gray-200 shadow-sm mt-2">
        {jobState.needsReview > 0 ? (
          <div className="text-amber-700 font-bold flex items-center justify-between">
            <span>⚠️ {jobState.needsReview} fields need manual review</span>
            {docId && <Link to={`/review/${docId}`} className="ml-4 bg-amber-100 px-3 py-1 rounded text-amber-800 hover:bg-amber-200 transition-colors uppercase tracking-wider text-xs">Review Now</Link>}
          </div>
        ) : (
          <div className="text-green-700 font-bold flex items-center justify-between">
            <span>✅ Ready: {jobState.eventsExtracted} events extracted</span>
            {docId && <Link to={`/search?doc=${docId}`} className="ml-4 bg-green-100 px-3 py-1 rounded text-green-800 hover:bg-green-200 transition-colors uppercase tracking-wider text-xs">View in Search</Link>}
          </div>
        )}
      </div>
    );
  }

  // Processing state
  return (
    <div className="w-full mt-2 bg-white p-3 rounded border border-gray-100 shadow-sm">
      <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          {jobState.stage}
        </span>
        <span className="text-blue-600">{jobState.progress}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${Math.max(5, jobState.progress)}%` }}></div>
      </div>
    </div>
  );
}

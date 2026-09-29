import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../realtime';
import { getJob, getJobSummary, getWellOptions, listDocuments } from '../data/documents';

export const documentKeys = {
  list: ['documents', 'list'],
  wells: ['documents', 'well-options'],
  summary: (docId) => ['documents', 'job-summary', docId],
};

/** Library list. Live: any change on `jobs` (status/stage) refreshes the rows. */
export function useDocuments() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: documentKeys.list, queryFn: listDocuments });
  useEffect(() => {
    const unsub = subscribe('jobs', undefined, () => {
      qc.invalidateQueries({ queryKey: documentKeys.list });
    });
    return unsub;
  }, [qc]);
  return query;
}

export function useWellOptions() {
  return useQuery({ queryKey: documentKeys.wells, queryFn: getWellOptions, staleTime: 5 * 60 * 1000 });
}

/**
 * Live state of one job: an initial read, then Realtime `jobs` `id=eq.<jobId>`.
 * @returns {{job: object|null, error: Error|null}}
 */
export function useJob(jobId) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true;
    setJob(null);
    // Subscribe first so no update is missed between the read and the subscription.
    const unsub = subscribe('jobs', `id=eq.${jobId}`, (payload) => {
      if (alive && payload?.new) setJob((prev) => ({ ...prev, ...payload.new }));
    });
    getJob(jobId)
      .then((j) => {
        // a Realtime event that arrived while the read was in flight is newer: it wins
        if (alive && j) setJob((prev) => ({ ...j, ...prev }));
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
      unsub();
    };
  }, [jobId]);

  return { job, error };
}

/** Counts for the final states (events extracted / fields pending). Refetches when the job status changes. */
export function useJobSummary(docId, status) {
  const enabled = !!docId && (status === 'done' || status === 'needs_review');
  return useQuery({
    queryKey: [...documentKeys.summary(docId), status],
    queryFn: () => getJobSummary(docId),
    enabled,
  });
}

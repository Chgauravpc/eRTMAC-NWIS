import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDocumentPages,
  getFieldsForDocument,
  getFormations,
  getPageImageUrl,
  getReviewQueue,
  reviewField,
} from '../data/review';
import { documentKeys } from './documents';

export const reviewKeys = {
  queue: ['review', 'queue'],
  fields: (docId) => ['review', 'fields', docId],
  pages: (docId) => ['review', 'pages', docId],
  formations: ['review', 'formations'],
  image: (docId, page, imagePath) => ['review', 'image', docId, page, imagePath || null],
};

export function useReviewQueue() {
  return useQuery({ queryKey: reviewKeys.queue, queryFn: getReviewQueue });
}

/**
 * Pending fields of a document. The list is a snapshot for the review session (it never refetches on its
 * own) so the field under the cursor does not disappear while reviewing; see `applyReviewResult`.
 */
export function useReviewFields(docId) {
  return useQuery({
    queryKey: reviewKeys.fields(docId),
    queryFn: () => getFieldsForDocument(docId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useDocumentPages(docId) {
  return useQuery({ queryKey: reviewKeys.pages(docId), queryFn: () => getDocumentPages(docId), staleTime: 60_000 });
}

export function useFormations() {
  return useQuery({ queryKey: reviewKeys.formations, queryFn: getFormations, staleTime: 5 * 60_000 });
}

export function usePageImageUrl(docId, page, imagePath) {
  return useQuery({
    queryKey: reviewKeys.image(docId, page, imagePath),
    queryFn: () => getPageImageUrl(docId, page, imagePath),
    enabled: !!docId && !!page,
    staleTime: 30 * 60_000, // signed for 1 h
  });
}

/**
 * Runs review_field and reflects it in the cached snapshot (status + edited value), then refreshes the
 * queue and the FE-10 document list (the job may have become 'done').
 */
export function useReviewAction(docId) {
  const qc = useQueryClient();
  return async function review(field, action, value = null) {
    const result = await reviewField(field.id, action, value);
    const status = action === 'approve' ? 'approved' : action === 'edit' ? 'edited' : 'rejected';
    qc.setQueryData(reviewKeys.fields(docId), (rows) =>
      (rows || []).map((r) =>
        r.id === field.id ? { ...r, review_status: status, value: action === 'edit' ? value : r.value } : r
      )
    );
    qc.invalidateQueries({ queryKey: reviewKeys.queue });
    qc.invalidateQueries({ queryKey: documentKeys.list });
    return result;
  };
}

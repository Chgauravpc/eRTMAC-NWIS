// Data access for FE-11 (review queue). Contract §6 (extracted_fields, v_review_queue), §7 (review_field), §8 (page-images bucket).
import { supabase } from '../supabase';

const ERROR_TEXT = {
  NWIS_FORBIDDEN: 'You do not have permission to review fields. Only reviewers and admins can approve, edit or reject.',
  NWIS_UNAUTHORIZED: 'Your session has expired. Sign in again to continue reviewing.',
  NWIS_NOT_FOUND: 'This field no longer exists. The document may have been re-processed; reload the page.',
  NWIS_BAD_STATE: 'This field was already reviewed or changed by someone else. Reload to see the latest state.',
};

/** Error thrown by review actions: `code` is the NWIS_* code, `message` is safe to show to the user. */
export class ReviewError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Turns a PostgREST error (message starts with "NWIS_X: text", contract §4) or a NwisApiError into a ReviewError.
 * NWIS_BAD_REQUEST surfaces the server's own text (e.g. "column id is protected and cannot be reviewed").
 */
export function mapReviewError(err) {
  const raw = String(err?.message || '');
  const m = raw.match(/(NWIS_[A-Z_]+)\s*:?\s*([\s\S]*)/);
  let code = m ? m[1] : /^NWIS_/.test(err?.code || '') ? err.code : null;
  const detail = (m ? m[2] : raw).trim();
  if (!code) {
    if (err?.code === '42501' || err?.status === 403) code = 'NWIS_FORBIDDEN';
    else if (err?.code === 'PGRST301' || err?.status === 401) code = 'NWIS_UNAUTHORIZED';
  }
  if (code === 'NWIS_BAD_REQUEST') {
    return new ReviewError(code, detail ? `This change was rejected: ${detail}` : 'This change was rejected by the server.', detail);
  }
  if (code && ERROR_TEXT[code]) return new ReviewError(code, ERROR_TEXT[code], detail);
  return new ReviewError(code || 'NWIS_INTERNAL', detail || 'Something went wrong while saving. Try again.', detail);
}

/**
 * One row per document with pending fields, oldest first.
 * v_review_queue rows are extracted_fields + doc_title + doc_type + image_path (no timestamps), so the
 * "oldest pending" age comes from the job that produced the fields.
 */
export async function getReviewQueue() {
  const { data, error } = await supabase.from('v_review_queue').select('*');
  if (error) throw error;
  const rows = data || [];
  const byDoc = new Map();
  for (const r of rows) {
    if (!byDoc.has(r.doc_id)) {
      byDoc.set(r.doc_id, { doc_id: r.doc_id, doc_title: r.doc_title || 'Untitled document', doc_type: r.doc_type || 'other', pending_count: 0, job_ids: new Set() });
    }
    const g = byDoc.get(r.doc_id);
    g.pending_count += 1;
    if (r.job_id) g.job_ids.add(r.job_id);
  }
  const docIds = [...byDoc.keys()];
  if (docIds.length === 0) return [];

  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
  const [jobsRes, docsRes] = await Promise.all([
    jobIds.length ? supabase.from('jobs').select('id, created_at').in('id', jobIds) : Promise.resolve({ data: [] }),
    supabase.from('documents').select('id, wells(name)').in('id', docIds),
  ]);
  const jobCreated = Object.fromEntries((jobsRes.data || []).map((j) => [j.id, j.created_at]));
  const wellName = Object.fromEntries((docsRes.data || []).map((d) => [d.id, d.wells?.name ?? null]));

  return docIds
    .map((id) => {
      const g = byDoc.get(id);
      const times = [...g.job_ids].map((j) => jobCreated[j]).filter(Boolean).sort();
      return {
        doc_id: id,
        doc_title: g.doc_title,
        doc_type: g.doc_type,
        well_name: wellName[id] ?? null,
        pending_count: g.pending_count,
        oldest_at: times[0] || null,
      };
    })
    .sort((a, b) => String(a.oldest_at || '9').localeCompare(String(b.oldest_at || '9')));
}

/** Pending fields of one document (v_review_queue only holds review_status = 'pending'). */
export async function getFieldsForDocument(docId) {
  const { data, error } = await supabase
    .from('v_review_queue')
    .select('*')
    .eq('doc_id', docId)
    .order('page', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Pages that have an image (document_pages), 1-based page_no. */
export async function getDocumentPages(docId) {
  const { data, error } = await supabase
    .from('document_pages')
    .select('page_no, image_path')
    .eq('doc_id', docId)
    .order('page_no', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Canonical formation names for the edit select. */
export async function getFormations() {
  const { data, error } = await supabase.from('formations').select('name, strat_order').order('strat_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Signed URL for a page image. Contract §8: separate private bucket `page-images`, object path `{doc_id}/{page_no}.png`
 * (the path is relative to the bucket, it does not include the bucket name).
 */
export async function getPageImageUrl(docId, page, imagePath) {
  const path = imagePath || `${docId}/${page}.png`;
  const { data, error } = await supabase.storage.from('page-images').createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

/** Calls review_field (contract §7). action: 'approve' | 'edit' | 'reject'. Throws ReviewError. */
export async function reviewField(fieldId, action, value = null) {
  const { data, error } = await supabase.rpc('review_field', { p_field: fieldId, p_action: action, p_value: value });
  if (error) throw mapReviewError(error);
  return data;
}

// Data access for FE-10 (documents + job progress). Components never call supabase/fetch directly.
import { supabase } from '../supabase';
import { api } from '../api';

import { SUPABASE_URL } from '../supabaseUrl';

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  txt: 'text/plain',
  las: 'application/octet-stream', // the bucket allows octet-stream for LAS
};

/** mime type sent to /api/documents/upload-url; falls back to the extension when the browser gives none. */
export function mimeForFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type || MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Step 1 (contract §9.2, Node only): ask for a signed upload URL. Returns { upload_id, storage_path, signed_url, token }. */
export function getUploadUrl(file) {
  return api.post('/documents/upload-url', {
    filename: file.name,
    size_bytes: file.size,
    mime_type: mimeForFile(file),
  });
}

function storageAuthHeaders(session) {
  const key =
    supabase.supabaseKey ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    'fake-anon-key';
  return { apikey: key, Authorization: `Bearer ${session?.access_token || key}` };
}

/**
 * Step 2: send the bytes straight to Supabase Storage (never through a Vercel function).
 * Same wire format as supabase-js `uploadToSignedUrl` (PUT multipart to /object/upload/sign/...?token=),
 * but over XMLHttpRequest so `upload.onprogress` gives REAL byte progress.
 * @param {(pct: number) => void} [onProgress] called with 0..100
 * @param {string} [signedUrl] the `signed_url` returned by step 1 (built from the token when absent)
 */
export async function uploadToStorage(storagePath, token, file, onProgress, signedUrl) {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const url =
    signedUrl ||
    `${SUPABASE_URL}/storage/v1/object/upload/sign/documents/${encodedPath}?token=${encodeURIComponent(token)}`;
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    const headers = { ...storageAuthHeaders(session), 'x-upsert': 'false' };
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve({ path: storagePath });
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).message || msg;
        } catch {
          /* keep default message */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed: network error'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(form);
  });
}

/** Step 3 (contract §9.2, Space via Node): register the uploaded object. 202 {document_id, job_id, duplicate:false} | 200 {duplicate:true}. */
export function submitDocumentRecord(payload) {
  return api.post('/documents', payload);
}

const DOC_COLUMNS = 'id, well_id, wellbore_id, doc_type, title, pages, ocr_engine, provenance, uploaded_by, created_at';

/** Documents with their latest job (status lives on jobs) and well name (wells.name). */
export async function listDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select(`${DOC_COLUMNS}, wells(name), jobs(id, status, stage, progress, error, created_at, updated_at)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const docs = (data || []).map((d) => {
    const jobs = [...(d.jobs || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { ...d, well_name: d.wells?.name ?? null, job: jobs[0] || null };
  });

  // documents.uploaded_by references auth.users (no FK to profiles), so join by hand.
  // RLS lets non-admins read only their own profile: names are best-effort.
  const userIds = [...new Set(docs.map((d) => d.uploaded_by).filter(Boolean))];
  let names = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    names = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }
  return docs.map((d) => ({ ...d, uploaded_by_name: names[d.uploaded_by] || null }));
}

/** Current state of one job (initial value before Realtime events arrive). */
export async function getJob(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, doc_id, status, stage, progress, error, updated_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function countRows(table, filters) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [col, op, val] of filters) q = q[op](col, val);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Numbers for the final states: events extracted (not rejected) and fields still pending review. */
export async function getJobSummary(docId) {
  const [events, pending] = await Promise.all([
    countRows('events', [['doc_id', 'eq', docId], ['review_status', 'neq', 'rejected']]),
    countRows('extracted_fields', [['doc_id', 'eq', docId], ['review_status', 'eq', 'pending']]),
  ]);
  return { events, pending };
}

/** Well choices for the dropzone (v_well_summary). */
export async function getWellOptions() {
  const { data, error } = await supabase.from('v_well_summary').select('well_id, wellbore_id, well_name').order('well_name');
  if (error) throw error;
  return data || [];
}

/** POST /api/documents/{id}/reprocess (contract 9.2): read the stored file again with the document's current well. */
export function reprocessDocument(docId) {
  return api.post(`/documents/${docId}/reprocess`);
}

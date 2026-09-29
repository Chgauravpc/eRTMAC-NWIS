// The three-step upload state machine (contract §9.1/§9.2), independent of React so it can be tested directly.
//   1. POST /api/documents/upload-url  -> signed URL (Node)
//   2. PUT bytes to Supabase Storage    -> real progress, never through a Vercel function
//   3. POST /api/documents              -> document_id + job_id (or duplicate)
// Status values: 'uploading' | 'registering' | 'processing' | 'duplicate' | 'error'.
import { getUploadUrl, uploadToStorage, submitDocumentRecord } from '../../lib/data/documents';

export function registrationPayload(entry) {
  return {
    storage_path: entry.storagePath,
    filename: entry.file.name,
    well_id: entry.wellId ?? null,
    wellbore_id: entry.wellboreId ?? null,
    doc_type: entry.docType ?? null,
    provenance: entry.provenance || 'direct',
  };
}

/** Step 3 only. Also used by "retry" when the file is already in storage. */
export async function registerDocument(entry, update) {
  update({ status: 'registering', errorMsg: null, progress: 100 });
  try {
    const res = await submitDocumentRecord(registrationPayload(entry));
    if (res.duplicate) {
      update({ status: 'duplicate', docId: res.document_id, jobId: null });
    } else {
      update({ status: 'processing', docId: res.document_id, jobId: res.job_id });
    }
  } catch (err) {
    update({ status: 'error', errorMsg: err.message || 'Could not register the document' });
  }
}

/**
 * Runs (or resumes) an upload. If the bytes are already in storage (entry.uploaded) only step 3 runs,
 * so a retry never uploads the file twice.
 */
export async function runUpload(entry, update) {
  if (entry.uploaded && entry.storagePath) {
    return registerDocument(entry, update);
  }
  update({ status: 'uploading', progress: 0, errorMsg: null });
  let storagePath;
  try {
    const up = await getUploadUrl(entry.file);
    storagePath = up.storage_path;
    await uploadToStorage(up.storage_path, up.token, entry.file, (pct) => update({ progress: pct }), up.signed_url);
  } catch (err) {
    update({ status: 'error', errorMsg: err.message || 'Upload failed' });
    return undefined;
  }
  update({ uploaded: true, storagePath, progress: 100 });
  return registerDocument({ ...entry, storagePath, uploaded: true }, update);
}

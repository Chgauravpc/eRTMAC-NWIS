import { supabase } from '../supabase';

// Assuming Vite proxies or paths are correctly mapped. 
// If Vercel API is hosted at the same origin, we use relative paths.
const VERCEL_API = '/api'; 
// If python API is a separate space, we use its URL. We'll assume proxy or absolute URL setup.
const PYTHON_API = import.meta.env.VITE_PYTHON_API_URL || '/api'; 

export async function getUploadUrl(file) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${VERCEL_API}/documents/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      filename: file.name,
      size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get upload URL: ${err}`);
  }

  return res.json(); // { upload_id, storage_path, signed_url, token }
}

export async function uploadToStorage(storagePath, token, file, onProgress) {
  // Using supabase-js v2 uploadToSignedUrl
  // Unfortunately supabase-js doesn't natively expose an onProgress for uploadToSignedUrl in all versions,
  // but we can pass it if supported, or rely on fetch/XMLHttpRequest.
  // We'll use supabase.storage
  
  // NOTE: If onProgress is strictly required we might need XMLHttpRequest. 
  // Supabase standard client doesn't support onProgress in `uploadToSignedUrl` easily, but we'll simulate or use standard options if they exist.
  // For the hackathon, we can use XMLHttpRequest to standard signed_url if needed, but the contract explicitly says:
  // "use with supabase.storage.from('documents').uploadToSignedUrl(storage_path, token, file)"
  
  const { data, error } = await supabase.storage
    .from('documents')
    .uploadToSignedUrl(storagePath, token, file);
    
  if (error) throw error;
  
  // Fake progress since we wait for it to finish
  if (onProgress) onProgress(100);
  
  return data;
}

export async function submitDocumentRecord(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  // payload: { storage_path, filename, well_id, wellbore_id, doc_type, provenance }
  const res = await fetch(`${PYTHON_API}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to submit document: ${err}`);
  }
  
  // 202: { document_id, job_id, duplicate: false }
  // 200: { document_id, job_id: null, duplicate: true }
  return res.json();
}

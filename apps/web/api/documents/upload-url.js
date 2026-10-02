// POST /api/documents/upload-url: reviewer, office_engineer, admin. Node only (contract §9.2, §8).
// Hands out a signed upload URL for incoming/<upload_id>/<filename>; the file goes straight to Supabase Storage
// (a Vercel function body is limited to about 4.5 MB), then the browser calls POST /api/documents.
import { randomUUID } from 'node:crypto';
import { requireUser, supabaseAdmin, UPLOAD_ROLES } from '../_lib/auth.js';
import { assertMethod, badRequest, sendError, upstream } from '../_lib/errors.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_FILENAME_CHARS = 120;
// the `documents` bucket's allowed types (migration 0010_storage.sql, DB-06)
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/octet-stream', // LAS files
];

/** Anything outside [a-zA-Z0-9._-] becomes "_"; at most 120 characters, keeping the extension. */
export function sanitiseFilename(name) {
  const cleaned = String(name ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const base = cleaned.replace(/^[._]+$/, '');
  if (!base) return 'file';
  if (base.length <= MAX_FILENAME_CHARS) return base;
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 && base.length - dot <= 16 ? base.slice(dot) : '';
  return base.slice(0, MAX_FILENAME_CHARS - extension.length) + extension;
}

export function validateUploadRequest(body) {
  const { filename, size_bytes: size, mime_type: mime } = body ?? {};
  if (typeof filename !== 'string' || !filename.trim()) throw badRequest('filename is required');
  if (!Number.isInteger(size) || size <= 0) throw badRequest('size_bytes must be a positive integer');
  if (size > MAX_UPLOAD_BYTES) throw badRequest('The file is larger than 25 MB', { max_bytes: MAX_UPLOAD_BYTES, size_bytes: size });
  const type = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  if (!ALLOWED_MIME_TYPES.includes(type)) throw badRequest('This file type is not accepted', { mime_type: mime, allowed: ALLOWED_MIME_TYPES });
  return { filename: filename.trim(), size, type };
}

export default async function handler(req, res) {
  try {
    if (!assertMethod(req, res, 'POST')) return undefined;
    await requireUser(req, UPLOAD_ROLES);
    const { filename } = validateUploadRequest(req.body);

    const uploadId = randomUUID();
    const storagePath = `incoming/${uploadId}/${sanitiseFilename(filename)}`;
    const { data, error } = await supabaseAdmin().storage.from('documents').createSignedUploadUrl(storagePath);
    if (error || !data) throw upstream('Could not create an upload URL', { reason: error?.message });

    return res.status(200).json({ upload_id: uploadId, storage_path: storagePath, signed_url: data.signedUrl, token: data.token });
  } catch (err) {
    return sendError(res, err);
  }
}

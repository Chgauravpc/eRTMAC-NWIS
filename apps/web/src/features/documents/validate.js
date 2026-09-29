// Client-side upload checks (PRD FE-10, contract §9.2 and DB-06 bucket limits).
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_EXTENSIONS = Object.freeze([
  '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.csv', '.xlsx', '.xml', '.las', '.txt',
]);

export function extensionOf(name = '') {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** @returns {{ok: true} | {ok: false, code: 'type'|'size', message: string}} */
export function validateFile(file) {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      code: 'type',
      message: `${file.name}: unsupported file type${ext ? ` (${ext})` : ''}. Allowed: PDF, PNG, JPG, TIFF, CSV, XLSX, XML, LAS, TXT.`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'size',
      message: `${file.name}: file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is 25 MB.`,
    };
  }
  return { ok: true };
}

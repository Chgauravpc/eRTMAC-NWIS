// Mock handlers: documents domain (FE-10 upload + job progress, FE-11 review queue). See handlers/index.js.
//
// Emulates, over real HTTP (MSW):
//   PostgREST  GET/HEAD /rest/v1/{documents,jobs,extracted_fields,document_pages,v_review_queue}, HEAD .../events
//              POST /rest/v1/rpc/review_field  (contract §7 semantics, incl. NWIS_* errors of migration 0009)
//   Storage    PUT|POST /storage/v1/object/upload/sign/:bucket/*   (signed upload, called by the XHR uploader)
//              POST /storage/v1/object/sign/:bucket/*  -> { signedURL }   and GET of that URL -> generated page image
//   Node       POST /api/documents/upload-url, POST /api/documents  (duplicate by filename, simulated pipeline)
// State lives in the shared mock db (tables documents, jobs, extracted_fields, document_pages, doc_events) so
// every change goes through the Realtime bus: db.update('jobs', ...) reaches JobProgress and the document list.
import { http, HttpResponse } from 'msw';
import { db } from '../db';
import { MOCK_USER_ID } from '../ids';
import documentsSeed from '../fixtures/documents.json';
import jobsSeed from '../fixtures/jobs.json';
import fieldsSeed from '../fixtures/review_fields.json';
import pagesSeed from '../fixtures/document_pages.json';
import wellsSeed from '../fixtures/wells.json';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const REST = `${SUPABASE_URL}/rest/v1`;
const STORAGE = `${SUPABASE_URL}/storage/v1`;
const MAX_BYTES = 25 * 1024 * 1024;
export const PAGE_W = 850;
export const PAGE_H = 1100;
const STAGES = [
  { stage: 'classify', progress: 10 },
  { stage: 'ocr', progress: 40 },
  { stage: 'extract', progress: 70 },
  { stage: 'validate', progress: 90 },
  { stage: 'index', progress: 100 },
];
const PROTECTED_COLUMNS = ['id', 'wellbore_id', 'well_id', 'doc_id', 'job_id', 'provenance', 'review_status', 'created_at', 'updated_at'];
const WELL_HEADER_FIELDS = ['field', 'kb_elev_m', 'spud_date', 'td_md_m', 'td_tvd_m'];

/** Tunables for tests/demo. stepMs = delay between simulated pipeline stages. */
export const mockConfig = { stepMs: 900 };

/* ---------------------------------------------------------------- seed + state */

const pad = (n) => String(n).padStart(12, '0');
function seedEvents() {
  const rows = [{ id: `40000000-0000-4000-a000-${pad(1)}`, doc_id: '10000000-0000-4000-a000-000000000002', review_status: 'pending' }];
  for (let i = 1; i <= 4; i += 1) {
    rows.push({ id: `40000000-0000-4000-a000-${pad(100 + i)}`, doc_id: '10000000-0000-4000-a000-000000000001', review_status: 'auto_approved' });
  }
  return rows;
}

const timers = new Set();
const uploadedPaths = new Set();

function registerAll() {
  db.registerTable('documents', documentsSeed);
  db.registerTable('jobs', jobsSeed);
  db.registerTable('extracted_fields', fieldsSeed);
  db.registerTable('document_pages', pagesSeed);
  db.registerTable('doc_events', seedEvents());
}
registerAll();

/** Test helper: back to the fixture state, cancel simulated pipelines. */
export function resetDocumentsMock() {
  timers.forEach(clearTimeout);
  timers.clear();
  uploadedPaths.clear();
  registerAll();
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const wellById = (id) => wellsSeed.find((w) => w.well_id === id);

/* ---------------------------------------------------------------- PostgREST helpers */

const parseList = (raw) => {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  return inner === '' ? [] : inner.split(',').map((s) => s.replace(/^"|"$/g, ''));
};

function matches(value, op, operand) {
  const num = (v) => (typeof v === 'number' ? v : Number(v));
  switch (op) {
    case 'eq': return String(value) === operand;
    case 'neq': return String(value) !== operand;
    case 'gt': return num(value) > num(operand);
    case 'gte': return num(value) >= num(operand);
    case 'lt': return num(value) < num(operand);
    case 'lte': return num(value) <= num(operand);
    case 'is': return operand === 'null' ? value == null : String(value) === operand;
    case 'in': return parseList(operand).includes(String(value));
    default: return true;
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns']);

function filterRows(rows, url) {
  const params = new URL(url).searchParams;
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    const dot = raw.indexOf('.');
    if (dot < 0) continue;
    out = out.filter((r) => matches(r[key], raw.slice(0, dot), raw.slice(dot + 1)));
  }
  return out;
}

function sortLimit(rows, url) {
  const params = new URL(url).searchParams;
  let out = rows;
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((s) => {
      const [col, dir = 'asc'] = s.split('.');
      return { col, sign: dir === 'desc' ? -1 : 1 };
    });
    out = [...out].sort((a, b) => {
      for (const { col, sign } of keys) {
        const x = a[col];
        const y = b[col];
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : 1) * sign;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') || 0);
  const limit = params.get('limit');
  if (offset || limit) out = out.slice(offset, limit ? offset + Number(limit) : undefined);
  return out;
}

/** Plain-column select only (embeds are added by the table-specific getters). */
function project(rows, url) {
  const select = new URL(url).searchParams.get('select');
  if (!select || select === '*' || select.includes('(')) return rows;
  const cols = select.split(',').map((c) => c.trim());
  if (cols.includes('*')) return rows;
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

function respond(request, rows) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('vnd.pgrst.object')) {
    if (rows.length === 1) return HttpResponse.json(rows[0]);
    return HttpResponse.json(
      { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' },
      { status: 406 }
    );
  }
  return HttpResponse.json(rows);
}

/** PostgREST error body for a `raise exception ... errcode P0001` (HTTP 400). */
const pgError = (message, status = 400) => HttpResponse.json({ code: 'P0001', details: null, hint: null, message }, { status });
const nodeError = (code, message, status) => HttpResponse.json({ error: { code, message, details: {} } }, { status });

/* ---------------------------------------------------------------- table getters */

function documentRows(url) {
  const select = new URL(url).searchParams.get('select') || '';
  return db.select('documents').map((d) => {
    const row = { ...d };
    if (select.includes('wells(')) {
      const w = wellById(d.well_id);
      row.wells = w ? { name: w.well_name } : null;
    }
    if (select.includes('jobs(')) row.jobs = db.select('jobs', (j) => j.doc_id === d.id);
    return row;
  });
}

const pageRows = () => db.select('document_pages').map(({ lines: _, ...row }) => row);

function queueRows() {
  const docs = Object.fromEntries(db.select('documents').map((d) => [d.id, d]));
  const pages = db.select('document_pages');
  return db
    .select('extracted_fields', (f) => f.review_status === 'pending')
    .map((f) => ({
      ...f,
      doc_title: docs[f.doc_id]?.title ?? null,
      doc_type: docs[f.doc_id]?.doc_type ?? null,
      image_path: pages.find((p) => p.doc_id === f.doc_id && p.page_no === (f.page || 1))?.image_path ?? null,
    }));
}

const eventRows = () => db.select('doc_events');

const tables = {
  documents: documentRows,
  jobs: () => db.select('jobs'),
  extracted_fields: () => db.select('extracted_fields'),
  document_pages: pageRows,
  v_review_queue: queueRows,
};

const tableHandlers = Object.entries(tables).map(([name, getRows]) =>
  http.get(`${REST}/${name}`, ({ request }) => {
    const rows = project(sortLimit(filterRows(getRows(request.url), request.url), request.url), request.url);
    return respond(request, rows);
  })
);

// supabase-js `select('id', { count: 'exact', head: true })` sends HEAD and reads Content-Range.
const headHandlers = Object.entries({ ...tables, events: eventRows }).map(([name, getRows]) =>
  http.head(`${REST}/${name}`, ({ request }) => {
    const n = filterRows(getRows(request.url), request.url).length;
    return new HttpResponse(null, { status: 200, headers: { 'Content-Range': `*/${n}` } });
  })
);

/* ---------------------------------------------------------------- role */

/** Role of the caller: mock token (`mock-token.<profile id>`), else localStorage 'nwis_mock_role', else reviewer. */
function callerRole(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token.startsWith('mock-token.')) {
    const p = db.getProfile(token.slice('mock-token.'.length));
    if (p) return p.role;
  }
  try {
    return localStorage.getItem('nwis_mock_role') || 'reviewer';
  } catch {
    return 'reviewer';
  }
}
const callerId = (request) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return token.startsWith('mock-token.') ? token.slice('mock-token.'.length) : MOCK_USER_ID;
};

/* ---------------------------------------------------------------- review_field (contract §7, migration 0009) */

function reviewFieldRpc(body, request) {
  const { p_field: id, p_action: action, p_value: value = null } = body || {};
  const role = callerRole(request);
  if (!['reviewer', 'admin'].includes(role)) return pgError('NWIS_FORBIDDEN: only reviewer or admin can review fields');
  if (!['approve', 'edit', 'reject'].includes(action)) return pgError(`NWIS_BAD_REQUEST: invalid review action ${action ?? 'null'}`);
  const rec = db.get('extracted_fields', id);
  if (!rec) return pgError('NWIS_NOT_FOUND: extracted field not found');
  if (rec.entity === 'well_header' && !WELL_HEADER_FIELDS.includes(rec.field)) {
    return pgError(`NWIS_BAD_REQUEST: field ${rec.field} not allowed for well_header`);
  }
  if (PROTECTED_COLUMNS.includes(rec.field)) {
    return pgError(`NWIS_BAD_REQUEST: column ${rec.field} is protected and cannot be reviewed`);
  }
  if (action !== 'reject' && rec.entity !== 'survey_station' && !rec.entity_id && rec.entity !== 'well_header') {
    return pgError('NWIS_BAD_REQUEST: extracted field has no target row to update');
  }
  if (action === 'edit' && value === null) return pgError('NWIS_BAD_REQUEST: value is required for edit action');

  const patch = {
    review_status: action === 'approve' ? 'approved' : action === 'edit' ? 'edited' : 'rejected',
    reviewed_by: callerId(request),
    reviewed_at: now(),
  };
  if (action === 'edit') patch.value = value;
  const updated = db.update('extracted_fields', id, patch);

  // events: reject marks the event rejected; otherwise, once every field of the event is reviewed, set its status.
  if (updated.entity === 'event' && updated.entity_id) {
    const ev = db.get('doc_events', updated.entity_id);
    if (ev) {
      if (action === 'reject') {
        db.update('doc_events', ev.id, { review_status: 'rejected' });
      } else {
        const siblings = db.select('extracted_fields', (f) => f.entity === 'event' && f.entity_id === ev.id);
        if (!siblings.some((f) => f.review_status === 'pending') && ev.review_status !== 'rejected') {
          db.update('doc_events', ev.id, { review_status: siblings.some((f) => f.review_status === 'edited') ? 'edited' : 'approved' });
        }
      }
    }
  }

  // job: when the last pending field of the job is reviewed the job is done (100%), announced on the bus.
  if (updated.job_id && !db.select('extracted_fields', (f) => f.job_id === updated.job_id && f.review_status === 'pending').length) {
    db.update('jobs', updated.job_id, { status: 'done', stage: 'done', progress: 100, updated_at: now() });
  }
  return HttpResponse.json(updated);
}

/* ---------------------------------------------------------------- simulated ingestion pipeline */

const later = (fn, ms) => {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
};

const guessDocType = (name) => {
  const n = name.toLowerCase();
  if (n.includes('ddr')) return 'ddr';
  if (n.includes('wcr') || n.includes('completion')) return 'wcr';
  if (n.includes('mud')) return 'mud_log';
  if (n.includes('cement')) return 'cement_report';
  if (n.endsWith('.las')) return 'las';
  return 'other';
};

/** Extracted fields for a new document: three uncertain event fields on page 1, bboxes taken from the sample DDR page. */
function createExtraction(doc, job) {
  const src = pagesSeed.find((p) => p.doc_id === '10000000-0000-4000-a000-000000000002' && p.page_no === 1);
  db.insert('document_pages', { ...src, doc_id: doc.id, image_path: `${doc.id}/1.png` });
  const eventId = uuid();
  db.insert('doc_events', { id: eventId, doc_id: doc.id, review_status: 'pending' });
  const line = (i) => ({ x: src.lines[i].x, y: src.lines[i].y, w: src.lines[i].w, h: src.lines[i].h });
  const base = { job_id: job.id, doc_id: doc.id, page: 1, entity: 'event', entity_id: eventId, review_status: 'pending', reviewed_by: null, reviewed_at: null, reason: null };
  db.insert('extracted_fields', { ...base, id: uuid(), field: 'event_type', value: { raw: 'Partial losses', value: 'loss_partial', unit: null }, confidence: 0.82, bbox: line(2) });
  db.insert('extracted_fields', { ...base, id: uuid(), field: 'md_from_m', value: { raw: '2395 m', value: 2395, unit: 'm' }, confidence: 0.7, reason: 'low_ocr_confidence', bbox: line(3) });
  db.insert('extracted_fields', { ...base, id: uuid(), field: 'formation', value: null, confidence: 0.5, reason: 'unknown_formation', bbox: line(5) });
}

function runPipeline(doc, job, filename) {
  const step = (i) => {
    if (i >= STAGES.length) {
      db.update('documents', doc.id, { pages: 1, ocr_engine: 'rapidocr' });
      if (/clean/i.test(filename)) {
        db.insert('doc_events', { id: uuid(), doc_id: doc.id, review_status: 'auto_approved' });
        db.update('jobs', job.id, { status: 'done', stage: 'done', progress: 100, updated_at: now() });
      } else {
        createExtraction(doc, job);
        db.update('jobs', job.id, { status: 'needs_review', stage: 'index', progress: 100, updated_at: now() });
      }
      return;
    }
    db.update('jobs', job.id, { status: 'running', ...STAGES[i], updated_at: now() });
    if (/fail/i.test(filename) && STAGES[i].stage === 'validate') {
      db.update('jobs', job.id, { status: 'failed', error: 'OCR engine timed out on page 1', updated_at: now() });
      return;
    }
    later(() => step(i + 1), mockConfig.stepMs);
  };
  later(() => step(0), mockConfig.stepMs);
}

/* ---------------------------------------------------------------- page images */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** SVG "scan": every line is drawn inside exactly its {x,y,w,h} fraction box (textLength pins the width). */
export function renderPageSvg(lines = [], label = '') {
  const texts = lines
    .map((l) => {
      const size = +(l.h * PAGE_H * 0.72).toFixed(2);
      return `<text x="${+(l.x * PAGE_W).toFixed(2)}" y="${+((l.y + l.h * 0.8) * PAGE_H).toFixed(2)}" font-size="${size}" textLength="${+(l.w * PAGE_W).toFixed(2)}" lengthAdjust="spacingAndGlyphs" font-family="Courier New, monospace" fill="#1f2937">${esc(l.text)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="100%" height="100%" fill="#fdfdf8"/><rect x="0.5" y="0.5" width="${PAGE_W - 1}" height="${PAGE_H - 1}" fill="none" stroke="#d4d4d8"/>${texts}<text x="${PAGE_W - 12}" y="${PAGE_H - 10}" font-size="10" text-anchor="end" fill="#9ca3af">SYNTHETIC ${esc(label)}</text></svg>`;
}

const objectPath = (request, marker) => {
  const p = decodeURIComponent(new URL(request.url).pathname);
  return p.slice(p.indexOf(marker) + marker.length);
};

/* ---------------------------------------------------------------- handlers */

export const handlers = [
  ...tableHandlers,
  ...headHandlers,

  http.post(`${REST}/rpc/review_field`, async ({ request }) => reviewFieldRpc(await request.json().catch(() => ({})), request)),

  // Storage: signed download of page images, signed upload of documents
  http.post(`${STORAGE}/object/sign/:bucket/*`, ({ request }) => {
    const rest = objectPath(request, '/object/sign/');
    return HttpResponse.json({ signedURL: `/object/sign/${rest}?token=mock-signed` });
  }),
  http.get(`${STORAGE}/object/sign/:bucket/*`, ({ request }) => {
    const rest = objectPath(request, '/object/sign/'); // page-images/<doc>/<page>.png
    const m = rest.match(/^page-images\/([^/]+)\/(\d+)\.png$/);
    const page = m ? db.select('document_pages', (p) => p.doc_id === m[1] && p.page_no === Number(m[2]))[0] : null;
    if (!page) return HttpResponse.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 });
    return new HttpResponse(renderPageSvg(page.lines, `page ${page.page_no}`), { headers: { 'Content-Type': 'image/svg+xml' } });
  }),
  http.put(`${STORAGE}/object/upload/sign/:bucket/*`, ({ request }) => {
    const path = objectPath(request, '/object/upload/sign/documents/');
    uploadedPaths.add(path);
    return HttpResponse.json({ Key: `documents/${path}` });
  }),
  http.post(`${STORAGE}/object/upload/sign/:bucket/*`, ({ request }) => {
    const path = objectPath(request, '/object/upload/sign/documents/');
    uploadedPaths.add(path);
    return HttpResponse.json({ Key: `documents/${path}` });
  }),

  // Node routes (contract §9.2)
  http.post('/api/documents/upload-url', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    if (!body.filename) return nodeError('NWIS_BAD_REQUEST', 'filename is required', 400);
    if (!(body.size_bytes > 0) && body.size_bytes !== 0) return nodeError('NWIS_BAD_REQUEST', 'size_bytes is required', 400);
    if (body.size_bytes > MAX_BYTES) return nodeError('NWIS_BAD_REQUEST', 'File is larger than 25 MB', 400);
    const uploadId = uuid();
    const storagePath = `incoming/${uploadId}/${body.filename}`;
    const token = `mock-upload-token-${uploadId.slice(0, 8)}`;
    return HttpResponse.json({
      upload_id: uploadId,
      storage_path: storagePath,
      signed_url: `${STORAGE}/object/upload/sign/documents/${storagePath.split('/').map(encodeURIComponent).join('/')}?token=${token}`,
      token,
    });
  }),

  http.post('/api/documents', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const role = callerRole(request);
    if (!['reviewer', 'office_engineer', 'admin'].includes(role)) return nodeError('NWIS_FORBIDDEN', 'Your role cannot upload documents', 403);
    if (!body.storage_path || !body.filename) return nodeError('NWIS_BAD_REQUEST', 'storage_path and filename are required', 400);
    if (!uploadedPaths.has(body.storage_path)) return nodeError('NWIS_BAD_REQUEST', `Uploaded object not found: ${body.storage_path}`, 400);

    // Same "content" (mock: same filename) already in the library -> 200 duplicate, nothing created.
    const dup = db.select('documents', (d) => d.title.toLowerCase() === String(body.filename).toLowerCase())[0];
    if (dup) return HttpResponse.json({ document_id: dup.id, job_id: null, duplicate: true }, { status: 200 });

    const wellbore = body.wellbore_id ? wellsSeed.find((w) => w.wellbore_id === body.wellbore_id) : null;
    const doc = db.insert('documents', {
      id: uuid(),
      well_id: body.well_id ?? wellbore?.well_id ?? null,
      wellbore_id: body.wellbore_id ?? null,
      doc_type: body.doc_type || guessDocType(body.filename),
      title: body.filename,
      file_path: body.storage_path,
      sha256: uuid().replace(/-/g, '').padEnd(64, '0'),
      pages: null,
      has_text_layer: null,
      ocr_engine: null,
      provenance: body.provenance || 'direct',
      uploaded_by: callerId(request),
      created_at: now(),
    });
    const job = db.insert('jobs', {
      id: uuid(),
      doc_id: doc.id,
      status: 'queued',
      stage: null,
      progress: 0,
      error: null,
      created_by: callerId(request),
      created_at: now(),
      updated_at: now(),
    });
    runPipeline(doc, job, body.filename);
    return HttpResponse.json({ document_id: doc.id, job_id: job.id, duplicate: false }, { status: 202 });
  }),
];

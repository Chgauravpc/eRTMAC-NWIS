/**
 * Dev-time contract guards (PRD 3). Each assertX(payload) returns the list of problems and, in
 * development / test builds, console.warn()s when a payload deviates from the contract
 * (docs/team/00_SHARED_CONTRACTS.md). They never throw and never mutate: production is silent.
 *
 * Spec mini-language (per field):
 *   'string' | 'number' | 'int' | 'boolean' | 'object' | 'array' | 'uuid' | 'iso'   required
 *   'string?' ...                                                                   optional / nullable
 *   ['a', 'b']  (frozen enum array)                                                 required enum
 *   ['a', 'b', null]                                                                nullable enum
 */
import {
  ALERT_KINDS,
  ALERT_SEVERITIES,
  ALERT_STATES,
  CONFIDENCE_LEVELS,
  DOC_TYPES,
  EXTRACTED_ENTITIES,
  JOB_STATUSES,
  PROVENANCES,
  REVIEW_STATUSES,
  RISK_BANDS,
  RISK_TYPES,
  STREAM_STATUSES,
  WELL_STATUSES,
  USER_ROLES,
  EVENT_TYPES,
  TOP_SOURCES,
} from './constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const isDev = () => {
  try {
    return Boolean(import.meta.env.DEV) || import.meta.env.MODE === 'test';
  } catch {
    return false;
  }
};

function checkType(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'int':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'uuid':
      return typeof value === 'string' && UUID_RE.test(value);
    case 'iso':
      return typeof value === 'string' && ISO_RE.test(value);
    default:
      return true;
  }
}

/**
 * Check `payload` against `spec`; returns an array of human-readable problems (empty = ok).
 * @param {Object} payload
 * @param {Object} spec field -> type string or enum array
 * @returns {string[]}
 */
export function checkShape(payload, spec) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['payload is not an object'];
  }
  const problems = [];
  for (const [field, rule] of Object.entries(spec)) {
    const value = payload[field];
    const missing = value === undefined || value === null;
    if (Array.isArray(rule)) {
      const nullable = rule.includes(null);
      if (missing) {
        if (!nullable) problems.push(`${field}: missing (expected one of ${rule.join('|')})`);
      } else if (!rule.includes(value)) {
        problems.push(`${field}: "${value}" is not one of ${rule.filter((r) => r !== null).join('|')}`);
      }
      continue;
    }
    const optional = rule.endsWith('?');
    const type = optional ? rule.slice(0, -1) : rule;
    if (missing) {
      if (!optional) problems.push(`${field}: missing (${type})`);
    } else if (!checkType(type, value)) {
      problems.push(`${field}: expected ${type}, got ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  }
  return problems;
}

function guard(name, payload, spec, extra) {
  const problems = checkShape(payload, spec);
  if (problems.length === 0 && extra && payload && typeof payload === 'object') problems.push(...extra(payload));
  if (problems.length > 0 && isDev()) {
    console.warn(`[contract] ${name} deviates from the contract: ${problems.join('; ')}`, payload);
  }
  return problems;
}

/** Table alerts / view v_open_alerts (contract 6, 11.6). */
export function assertAlert(a) {
  return guard(
    'alert',
    a,
    {
      id: 'uuid',
      wellbore_id: 'uuid',
      kind: ALERT_KINDS,
      risk_type: [...RISK_TYPES, null],
      severity: ALERT_SEVERITIES,
      state: ALERT_STATES,
      dedup_key: 'string',
      title: 'string',
      message: 'string',
      evidence: 'object',
      created_at: 'iso',
      zone_md_from_m: 'number?',
      zone_md_to_m: 'number?',
      score: 'number?',
      confidence: [...CONFIDENCE_LEVELS, null],
    },
    (x) => (x.kind !== 'system' && !x.risk_type ? ['risk_type: required unless kind is system'] : []),
  );
}

/** Table risk_scores (contract 6). */
export function assertRiskScore(r) {
  return guard(
    'risk_score',
    r,
    {
      wellbore_id: 'uuid',
      md_from_m: 'number',
      md_to_m: 'number',
      risk_type: RISK_TYPES,
      fused: 'number',
      band: RISK_BANDS,
      confidence: CONFIDENCE_LEVELS,
      reasons: 'array',
      l1: 'number?',
      l2: 'number?',
      l3: 'number?',
    },
    (x) => {
      const p = [];
      if (x.fused < 0 || x.fused > 100) p.push('fused: outside 0..100');
      if (x.md_to_m <= x.md_from_m) p.push('md_to_m: must be greater than md_from_m');
      for (const k of ['l1', 'l2', 'l3']) if (typeof x[k] === 'number' && (x[k] < 0 || x[k] > 1)) p.push(`${k}: outside 0..1`);
      return p;
    },
  );
}

/** Table stream_state (contract 6). */
export function assertStreamState(s) {
  return guard('stream_state', s, {
    wellbore_id: 'uuid',
    status: STREAM_STATUSES,
    speed: 'int',
    bit_md_m: 'number?',
    hole_md_m: 'number?',
    last_sample_at: 'iso?',
    latest: 'object?',
    source: 'string?',
  });
}

/** Table events (contract 6). */
export function assertEvent(e) {
  return guard('event', e, {
    id: 'uuid',
    wellbore_id: 'uuid',
    event_type: EVENT_TYPES,
    risk_type: [...RISK_TYPES, null],
    md_from_m: 'number',
    description: 'string',
    provenance: PROVENANCES,
    review_status: REVIEW_STATUSES,
    severity: 'int?',
    npt_h: 'number?',
  });
}

/** Table documents (contract 6). */
export function assertDocument(d) {
  return guard('document', d, {
    id: 'uuid',
    doc_type: DOC_TYPES,
    title: 'string',
    file_path: 'string',
    sha256: 'string',
    provenance: PROVENANCES,
    pages: 'int?',
  });
}

/** Table jobs (contract 6). */
export function assertJob(j) {
  return guard(
    'job',
    j,
    { id: 'uuid', doc_id: 'uuid', status: JOB_STATUSES, progress: 'int', stage: 'string?', error: 'string?' },
    (x) => (x.progress < 0 || x.progress > 100 ? ['progress: outside 0..100'] : []),
  );
}

/** Table extracted_fields / view v_review_queue (contract 6). */
export function assertExtractedField(f) {
  return guard('extracted_field', f, {
    id: 'uuid',
    doc_id: 'uuid',
    entity: EXTRACTED_ENTITIES,
    field: 'string',
    confidence: 'number',
    review_status: REVIEW_STATUSES,
    page: 'int?',
    reason: 'string?',
    bbox: 'object?',
  });
}

/** Row of RPC offsets_within (contract 7). */
export function assertOffsetRow(o) {
  return guard('offsets_within row', o, {
    wellbore_id: 'uuid',
    well_id: 'uuid',
    well_name: 'string',
    field: 'string',
    provenance: PROVENANCES,
    lon: 'number',
    lat: 'number',
    surface_distance_m: 'number',
    event_count: 'int',
    depth_distance_m: 'number?',
  });
}

/** View v_well_summary (contract 6). */
export function assertWellSummary(w) {
  return guard('v_well_summary row', w, {
    wellbore_id: 'uuid',
    well_id: 'uuid',
    well_name: 'string',
    field: 'string',
    basin: 'string',
    status: WELL_STATUSES,
    provenance: PROVENANCES,
    lon: 'number',
    lat: 'number',
    td_md_m: 'number?',
    event_count: 'int',
    npt_h_total: 'number',
    top_risk_type: [...RISK_TYPES, null],
  });
}

/** Table profiles (contract 6). */
export function assertProfile(p) {
  return guard('profile', p, {
    id: 'uuid',
    email: 'string?',
    full_name: 'string?',
    role: USER_ROLES,
    assigned_wellbore_ids: 'array',
  });
}

/** GET /api/wells/{id}/correlation (contract 9.3). */
export function assertCorrelation(c) {
  return guard('correlation response', c, { flatten_formation: 'string', wells: 'array' }, (x) => {
    const p = [];
    x.wells.forEach((w, i) => {
      p.push(
        ...checkShape(w, { wellbore_id: 'uuid', name: 'string', is_active: 'boolean', shift_m: 'number', tops: 'array', casing: 'array', events: 'array', tracks: 'object' }).map(
          (m) => `wells[${i}].${m}`,
        ),
      );
      (w.tops || []).forEach((t, j) =>
        p.push(...checkShape(t, { formation: 'string', top_md_m: 'number', source: TOP_SOURCES }).map((m) => `wells[${i}].tops[${j}].${m}`)),
      );
      if (w.tracks && !Array.isArray(w.tracks.md_m)) p.push(`wells[${i}].tracks.md_m: missing array`);
    });
    if (x.wells.length && x.wells.filter((w) => w.is_active).length !== 1) p.push('wells: exactly one well must be is_active');
    return p;
  });
}

/** POST /api/search (contract 9.2). */
export function assertSearchResponse(r) {
  return guard('search response', r, { results: 'array' }, (x) =>
    x.results.flatMap((row, i) =>
      checkShape(row, { chunk_id: 'uuid', doc_id: 'uuid', doc_title: 'string', page: 'int', snippet: 'string', score: 'number' }).map((m) => `results[${i}].${m}`),
    ),
  );
}

/** POST /api/ask (contract 9.2). */
export function assertAskResponse(r) {
  return guard(
    'ask response',
    r,
    { answer_md: 'string', evidence: ['sufficient', 'insufficient'], citations: 'array', provider: 'string?', model: 'string?', cached: 'boolean?' },
    (x) =>
      x.citations.flatMap((c, i) =>
        checkShape(c, { n: 'int', chunk_id: 'uuid', doc_id: 'uuid', doc_title: 'string', page: 'int', snippet: 'string' }).map((m) => `citations[${i}].${m}`),
      ),
  );
}

/** Row of RPC formation_at_md (contract 7). */
export function assertFormationAtMd(f) {
  return guard('formation_at_md row', f, {
    formation: 'string',
    top_md_m: 'number',
    next_formation: 'string?',
    next_top_md_m: 'number?',
    relative_depth: 'number',
    source: TOP_SOURCES,
  });
}

/** Convenience: run a guard over each element of an array payload. */
export function assertEach(assertFn, rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((r) => assertFn(r));
}

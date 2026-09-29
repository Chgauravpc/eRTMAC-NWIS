import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkShape,
  assertAlert,
  assertRiskScore,
  assertStreamState,
  assertEvent,
  assertJob,
  assertOffsetRow,
  assertCorrelation,
  assertAskResponse,
  assertSearchResponse,
  assertProfile,
  assertEach,
} from './validate';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

const alert = () => ({
  id: U1,
  wellbore_id: U2,
  kind: 'lookahead',
  risk_type: 'losses',
  severity: 'warning',
  state: 'sent',
  dedup_key: `${U2}:losses:2400`,
  title: 'Losses ahead',
  message: 'm',
  evidence: {},
  created_at: '2026-09-28T10:15:00Z',
  zone_md_from_m: 2400,
  confidence: 'high',
});

const risk = () => ({
  wellbore_id: U1,
  md_from_m: 2400,
  md_to_m: 2425,
  risk_type: 'losses',
  fused: 62.5,
  band: 'elevated',
  confidence: 'medium',
  reasons: [],
  l1: 0.6,
  l2: null,
  l3: null,
});

let warn;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('checkShape', () => {
  it('reports missing, wrongly typed and out-of-enum fields', () => {
    const p = checkShape({ a: 1, c: 'x' }, { a: 'string', b: 'number', c: ['x', 'y'], d: 'int?' });
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/^a: expected string/);
    expect(p[1]).toMatch(/^b: missing/);
  });
  it('accepts nullable enums and optional fields', () => {
    expect(checkShape({ a: null }, { a: ['x', null], b: 'string?' })).toEqual([]);
  });
  it('rejects non-objects', () => {
    expect(checkShape(null, {})).toEqual(['payload is not an object']);
  });
});

describe('assertAlert', () => {
  it('accepts a contract alert without warning', () => {
    expect(assertAlert(alert())).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
  it('warns on a bad enum and a non-uuid id', () => {
    const p = assertAlert({ ...alert(), state: 'open', id: 'mock-alert-uuid' });
    expect(p.join(' ')).toMatch(/state/);
    expect(p.join(' ')).toMatch(/id: expected uuid/);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('requires risk_type unless kind is system', () => {
    expect(assertAlert({ ...alert(), risk_type: null })).toHaveLength(1);
    expect(assertAlert({ ...alert(), kind: 'system', risk_type: null })).toEqual([]);
  });
});

describe('assertRiskScore', () => {
  it('accepts a valid row', () => {
    expect(assertRiskScore(risk())).toEqual([]);
  });
  it('flags band names outside the contract and out-of-range values', () => {
    expect(assertRiskScore({ ...risk(), band: 'yellow' }).join()).toMatch(/band/);
    expect(assertRiskScore({ ...risk(), fused: 140 }).join()).toMatch(/0\.\.100/);
    expect(assertRiskScore({ ...risk(), l2: 1.4 }).join()).toMatch(/l2/);
    expect(assertRiskScore({ ...risk(), md_to_m: 2300 }).join()).toMatch(/md_to_m/);
  });
});

describe('assertStreamState', () => {
  const s = { wellbore_id: U1, status: 'live', speed: 1, bit_md_m: 2400, last_sample_at: '2026-09-28T10:15:00Z' };
  it('accepts a valid row', () => expect(assertStreamState(s)).toEqual([]));
  it('flags an unknown status', () => expect(assertStreamState({ ...s, status: 'running' })).toHaveLength(1));
});

describe('other guards', () => {
  it('assertEvent', () => {
    const e = { id: U1, wellbore_id: U2, event_type: 'kick', risk_type: 'kick', md_from_m: 3000, description: 'd', provenance: 'synthetic', review_status: 'approved' };
    expect(assertEvent(e)).toEqual([]);
    expect(assertEvent({ ...e, event_type: 'blowout' })).toHaveLength(1);
  });
  it('assertJob checks progress bounds', () => {
    expect(assertJob({ id: U1, doc_id: U2, status: 'running', progress: 50 })).toEqual([]);
    expect(assertJob({ id: U1, doc_id: U2, status: 'running', progress: 120 })).toHaveLength(1);
  });
  it('assertOffsetRow', () => {
    const o = { wellbore_id: U1, well_id: U2, well_name: 'SYN-A', field: 'F', provenance: 'analog', lon: 95, lat: 27, surface_distance_m: 900, event_count: 2 };
    expect(assertOffsetRow(o)).toEqual([]);
    expect(assertOffsetRow({ ...o, surface_distance_m: undefined })).toHaveLength(1);
  });
  it('assertProfile', () => {
    expect(assertProfile({ id: U1, email: 'a@b.in', full_name: 'A', role: 'admin', assigned_wellbore_ids: [] })).toEqual([]);
    expect(assertProfile({ id: U1, role: 'boss', assigned_wellbore_ids: [] })).toHaveLength(1);
  });
  it('assertCorrelation requires exactly one active well and md_m track', () => {
    const w = (active) => ({ wellbore_id: U1, name: 'SYN', is_active: active, shift_m: 0, tops: [{ formation: 'Tipam', top_md_m: 1, source: 'actual' }], casing: [], events: [], tracks: { md_m: [1] } });
    expect(assertCorrelation({ flatten_formation: 'Barail', wells: [w(true), w(false)] })).toEqual([]);
    expect(assertCorrelation({ flatten_formation: 'Barail', wells: [w(false)] }).join()).toMatch(/is_active/);
  });
  it('assertAskResponse and assertSearchResponse', () => {
    const cit = { n: 1, chunk_id: U1, doc_id: U2, doc_title: 't', page: 4, snippet: 's' };
    expect(assertAskResponse({ answer_md: 'x [1]', evidence: 'sufficient', citations: [cit] })).toEqual([]);
    expect(assertAskResponse({ answer_md: 'x', evidence: 'maybe', citations: [] })).toHaveLength(1);
    expect(assertSearchResponse({ results: [{ chunk_id: U1, doc_id: U2, doc_title: 't', page: 1, snippet: 's', score: 0.03 }] })).toEqual([]);
    expect(assertSearchResponse({ results: [{ chunk_id: U1 }] }).length).toBeGreaterThan(1);
  });
  it('assertEach aggregates', () => {
    expect(assertEach(assertRiskScore, [risk(), { ...risk(), band: 'x' }])).toHaveLength(1);
    expect(assertEach(assertRiskScore, null)).toEqual([]);
  });
});

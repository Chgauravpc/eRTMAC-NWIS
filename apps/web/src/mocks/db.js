// Mutable in-memory mock database + realtime bus (FE-02).
//
// - The seeded arrays are exposed as db.wells / db.stream_state / db.alerts / db.risk_scores /
//   db.profiles and are mutated IN PLACE (also by reset()), so any module that grabbed a reference
//   keeps seeing live data.
// - Generic access: db.table(name), db.select, db.insert, db.update, db.remove, db.registerTable.
// - Realtime: every write calls emit(); realtime.js listens on db.emitter for `change:<table>`
//   (detail = the new record). `event:<table>` carries {eventType, new, old} for richer consumers.
// - Test/dev helpers: db.reset(), db.advanceBit(), db.emitAlert(), db.setStreamStatus().
import wellsData from './fixtures/wells.json';
import streamStateData from './fixtures/stream_state.json';
import alertsData from './fixtures/alerts.json';
import riskScoresData from './fixtures/risk_scores.json';
import profilesData from './fixtures/profiles.json';
import { ACTIVE_WELLBORE_ID } from './ids';

// Older fixtures use this literal; normalise it to the real active wellbore id so every screen agrees.
const LEGACY_WELLBORE = 'mock-wellbore-id';
const ACTIVE_SENTINEL = '@ACTIVE_WELLBORE_ID';

const clone = (v) => JSON.parse(JSON.stringify(v));
const seed = (rows) =>
  JSON.parse(JSON.stringify(rows).split(LEGACY_WELLBORE).join(ACTIVE_WELLBORE_ID).split(ACTIVE_SENTINEL).join(ACTIVE_WELLBORE_ID));

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));

/** Primary key column(s) per table. A string[] means a composite key. */
const DEFAULT_KEYS = {
  wells: 'wellbore_id',
  stream_state: 'wellbore_id',
  alerts: 'id',
  risk_scores: ['wellbore_id', 'md_from_m', 'risk_type'],
  profiles: 'id',
};

const SEEDS = {
  wells: wellsData,
  stream_state: streamStateData,
  alerts: alertsData,
  risk_scores: riskScoresData,
  profiles: profilesData,
};

class MockDatabase {
  constructor() {
    this.emitter = new EventTarget();
    /** @type {Object<string, Array<Object>>} */
    this.tables = {};
    this.keys = { ...DEFAULT_KEYS };
    this.seeds = { ...SEEDS };
    for (const name of Object.keys(SEEDS)) {
      this.tables[name] = seed(SEEDS[name]);
    }
    // Stable named references other modules rely on.
    this.wells = this.tables.wells;
    this.stream_state = this.tables.stream_state;
    this.alerts = this.tables.alerts;
    this.risk_scores = this.tables.risk_scores;
    this.profiles = this.tables.profiles;
  }

  // ---- realtime -----------------------------------------------------------------------------

  /** Legacy signature: dispatches `change:<table>` with the record as detail. */
  emitChange(table, record) {
    this.emitter.dispatchEvent(new CustomEvent(`change:${table}`, { detail: record }));
  }

  /** Dispatch both the legacy event and a Supabase-like `event:<table>` payload. */
  emit(table, eventType, record, old = null) {
    this.emitChange(table, record);
    this.emitter.dispatchEvent(new CustomEvent(`event:${table}`, { detail: { eventType, new: record, old, table } }));
  }

  // ---- generic table API --------------------------------------------------------------------

  /** Register (or replace) a table so other mock domains can share the bus. */
  registerTable(name, rows = [], key = 'id') {
    this.keys[name] = key;
    this.seeds[name] = rows;
    if (!this.tables[name]) this.tables[name] = [];
    this.tables[name].length = 0;
    this.tables[name].push(...seed(rows));
    return this.tables[name];
  }

  table(name) {
    if (!this.tables[name]) throw new Error(`mock db: unknown table "${name}"`);
    return this.tables[name];
  }

  _matches(name, row, key) {
    const pk = this.keys[name] ?? 'id';
    if (Array.isArray(pk)) return key && typeof key === 'object' && pk.every((k) => row[k] === key[k]);
    return row[pk] === key;
  }

  /** Rows for which `where` (function or {field: value} object) is true. */
  select(name, where) {
    const rows = this.table(name);
    if (!where) return rows.slice();
    const fn = typeof where === 'function' ? where : (r) => Object.entries(where).every(([k, v]) => r[k] === v);
    return rows.filter(fn);
  }

  /** Row by primary key (composite keys take an object). */
  get(name, key) {
    return this.table(name).find((r) => this._matches(name, r, key)) || null;
  }

  insert(name, row) {
    const pk = this.keys[name] ?? 'id';
    const rec = { ...row };
    if (pk === 'id' && !rec.id) rec.id = uuid();
    this.table(name).push(rec);
    this.emit(name, 'INSERT', rec, null);
    return rec;
  }

  /** Merge `patch` into the row with primary key `key`; returns the new row or null. */
  update(name, key, patch) {
    const rows = this.table(name);
    const idx = rows.findIndex((r) => this._matches(name, r, key));
    if (idx < 0) return null;
    const old = rows[idx];
    rows[idx] = { ...old, ...patch };
    this.emit(name, 'UPDATE', rows[idx], old);
    return rows[idx];
  }

  remove(name, key) {
    const rows = this.table(name);
    const idx = rows.findIndex((r) => this._matches(name, r, key));
    if (idx < 0) return null;
    const [old] = rows.splice(idx, 1);
    this.emit(name, 'DELETE', null, old);
    return old;
  }

  // ---- named helpers (existing API) ---------------------------------------------------------

  getWell(id) {
    return this.wells.find((w) => w.wellbore_id === id);
  }

  getAlert(id) {
    return this.alerts.find((a) => a.id === id);
  }

  getProfile(id) {
    return this.profiles.find((p) => p.id === id) || null;
  }

  getProfileByEmail(email) {
    const e = String(email || '').toLowerCase();
    return this.profiles.find((p) => (p.email || '').toLowerCase() === e) || null;
  }

  updateAlert(id, updates) {
    return this.update('alerts', id, updates);
  }

  // ---- dev / demo helpers (used by DevPanel and tests) --------------------------------------

  /** Move the bit (and hole depth) down by `meters` and mark the stream live. */
  advanceBit(wellboreId = ACTIVE_WELLBORE_ID, meters = 5) {
    const s = this.get('stream_state', wellboreId);
    if (!s) return null;
    const bit = (s.bit_md_m ?? 0) + meters;
    return this.update('stream_state', wellboreId, {
      bit_md_m: bit,
      hole_md_m: Math.max(s.hole_md_m ?? 0, bit),
      status: 'live',
      last_sample_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  setStreamStatus(wellboreId = ACTIVE_WELLBORE_ID, status = 'live') {
    return this.update('stream_state', wellboreId, { status, updated_at: new Date().toISOString() });
  }

  /** Insert a contract-shaped alert in state `sent` (so banner and sound fire) and broadcast it. */
  emitAlert({ wellbore_id = ACTIVE_WELLBORE_ID, kind = 'detector', risk_type = 'stuck_pipe', severity = 'critical', ...rest } = {}) {
    const now = new Date().toISOString();
    const bit = this.get('stream_state', wellbore_id)?.bit_md_m ?? 2400;
    const zoneStart = Math.floor(bit / 50) * 50;
    return this.insert('alerts', {
      wellbore_id,
      kind,
      risk_type: kind === 'system' ? null : risk_type,
      severity,
      state: 'sent',
      dedup_key: `${wellbore_id}:${kind === 'system' ? 'system:demo' : `${risk_type}:${zoneStart}`}:${Date.now()}`,
      zone_md_from_m: bit + 20,
      zone_md_to_m: bit + 70,
      expected_md_m: bit + 45,
      score: severity === 'critical' ? 85 : 65,
      confidence: 'medium',
      title: `Demo ${severity} alert`,
      message: 'Generated from the dev panel.',
      recommendation: 'Review the offsets evidence before continuing.',
      evidence: {},
      created_at: now,
      sent_at: now,
      ...rest,
    });
  }

  /** Restore every table to its seed state (tests). Arrays are refilled in place. */
  reset() {
    for (const name of Object.keys(this.tables)) {
      const arr = this.tables[name];
      arr.length = 0;
      arr.push(...seed(clone(this.seeds[name] || [])));
    }
  }
}

export const db = new MockDatabase();

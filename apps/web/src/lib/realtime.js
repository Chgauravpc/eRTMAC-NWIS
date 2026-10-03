import { supabase } from './supabase';
import { db } from '../mocks/db';
import { isDemoActive } from './demoMode';

/** Read at call time so tests can stub the env. True on the mocks: built that way, or demo mode is on (lib/demoMode.js). */
export const isMockMode = () => isDemoActive();

// ---------- filter matching (mock bus) ----------
// Supports the PostgREST-style filters Supabase Realtime accepts: col=eq.x, col=neq.x, col=in.(a,b),
// col=gt.n, col=gte.n, col=lt.n, col=lte.n
const FILTER_RE = /^([A-Za-z0-9_]+)=(eq|neq|in|gt|gte|lt|lte)\.(.*)$/;

export function parseFilter(filter) {
  if (!filter) return null;
  const m = FILTER_RE.exec(filter);
  if (!m) return null;
  const [, field, op, raw] = m;
  let value = raw;
  if (op === 'in') {
    const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
    value = inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s !== '');
  }
  return { field, op, value };
}

export function matchesFilter(filter, row) {
  const f = parseFilter(filter);
  if (!filter) return true;
  if (!f) return true; // unknown filter syntax: do not silently drop events
  if (!row) return false;
  const actual = row[f.field];
  if (actual == null) return false;
  const a = String(actual);
  switch (f.op) {
    case 'eq':
      return a === f.value;
    case 'neq':
      return a !== f.value;
    case 'in':
      return f.value.includes(a);
    case 'gt':
      return Number(actual) > Number(f.value);
    case 'gte':
      return Number(actual) >= Number(f.value);
    case 'lt':
      return Number(actual) < Number(f.value);
    case 'lte':
      return Number(actual) <= Number(f.value);
    default:
      return true;
  }
}

// ---------- connection status ("Reconnecting…" indicator + refetch on reconnect) ----------
let connected = true;
const statusListeners = new Set();
const reconnectListeners = new Set();
const channelStates = new Map(); // channel id -> boolean (real mode)

function setConnected(next) {
  if (next === connected) return;
  const wasDown = !connected;
  connected = next;
  statusListeners.forEach((fn) => fn());
  if (wasDown && next) reconnectListeners.forEach((fn) => fn());
}

export function getRealtimeConnected() {
  return connected;
}

/** For useSyncExternalStore. */
export function subscribeRealtimeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Called after the connection comes back; consumers refetch what they may have missed. */
export function onRealtimeReconnect(fn) {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

/** Mock/dev only: simulate a dropped and restored Realtime connection. */
export function setMockConnection(isUp) {
  setConnected(!!isUp);
}

function recomputeRealChannelState() {
  const states = [...channelStates.values()];
  setConnected(states.length === 0 ? true : states.every(Boolean));
}

let channelSeq = 0;

/**
 * subscribe(table, filter, onChange) -> unsubscribe
 * onChange receives a Supabase-shaped payload: { eventType, new, old }.
 */
export function subscribe(table, filter, onChange) {
  if (isMockMode()) {
    const deliver = (payload) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row || !matchesFilter(filter, row)) return;
      onChange({ schema: 'public', table, ...payload });
    };
    // `change:<table>` carries the written record (inserts and updates)...
    const onChangeEvent = (e) => {
      const detail = e.detail;
      if (detail == null) return; // a delete announces itself on `event:<table>` instead
      const payload =
        typeof detail === 'object' && 'eventType' in detail && 'new' in detail ? detail : { eventType: 'UPDATE', new: detail, old: null };
      deliver(payload);
    };
    // ...`event:<table>` is the richer {eventType,new,old} form; only deletes need it.
    const onRichEvent = (e) => {
      if (e.detail?.eventType === 'DELETE') deliver(e.detail);
    };
    db.emitter.addEventListener(`change:${table}`, onChangeEvent);
    db.emitter.addEventListener(`event:${table}`, onRichEvent);
    return () => {
      db.emitter.removeEventListener(`change:${table}`, onChangeEvent);
      db.emitter.removeEventListener(`event:${table}`, onRichEvent);
    };
  }

  channelSeq += 1;
  const id = `${table}:${filter || 'all'}:${channelSeq}`;
  const opts = { event: '*', schema: 'public', table };
  if (filter) opts.filter = filter;
  let alive = true;
  const channel = supabase
    .channel(`public:${id}`)
    .on('postgres_changes', opts, (payload) => onChange(payload))
    .subscribe((status) => {
      if (!alive) return; // ignore the CLOSED that follows our own unsubscribe
      if (status === 'SUBSCRIBED') channelStates.set(id, true);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') channelStates.set(id, false);
      recomputeRealChannelState();
    });

  return () => {
    alive = false;
    channelStates.delete(id);
    recomputeRealChannelState();
    supabase.removeChannel(channel);
  };
}

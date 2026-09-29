import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../mocks/db';
import { getRealtimeConnected, matchesFilter, onRealtimeReconnect, parseFilter, setMockConnection, subscribe, subscribeRealtimeStatus } from './realtime';

beforeAll(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
afterAll(() => vi.unstubAllEnvs());
afterEach(() => setMockConnection(true));

describe('filter matching', () => {
  it('parses eq / in filters', () => {
    expect(parseFilter('wellbore_id=eq.abc')).toEqual({ field: 'wellbore_id', op: 'eq', value: 'abc' });
    expect(parseFilter('wellbore_id=in.(a,b,c)')).toEqual({ field: 'wellbore_id', op: 'in', value: ['a', 'b', 'c'] });
    expect(parseFilter(undefined)).toBeNull();
  });

  it('matches eq, neq, in, gt/gte/lt/lte', () => {
    expect(matchesFilter('wellbore_id=eq.a', { wellbore_id: 'a' })).toBe(true);
    expect(matchesFilter('wellbore_id=eq.a', { wellbore_id: 'b' })).toBe(false);
    expect(matchesFilter('wellbore_id=neq.a', { wellbore_id: 'b' })).toBe(true);
    expect(matchesFilter('wellbore_id=in.(a,b)', { wellbore_id: 'b' })).toBe(true);
    expect(matchesFilter('wellbore_id=in.(a,b)', { wellbore_id: 'c' })).toBe(false);
    expect(matchesFilter('md=gt.10', { md: 11 })).toBe(true);
    expect(matchesFilter('md=gte.10', { md: 10 })).toBe(true);
    expect(matchesFilter('md=lt.10', { md: 10 })).toBe(false);
    expect(matchesFilter('md=lte.10', { md: 10 })).toBe(true);
    expect(matchesFilter(undefined, { anything: 1 })).toBe(true);
    expect(matchesFilter('wellbore_id=eq.a', { other: 1 })).toBe(false);
  });
});

describe('mock bus subscribe', () => {
  it('delivers only rows matching an in.(…) filter', () => {
    const got = [];
    const off = subscribe('alerts', 'wellbore_id=in.(w1,w2)', (p) => got.push(p.new.id));
    db.emitChange('alerts', { id: 'x1', wellbore_id: 'w1' });
    db.emitChange('alerts', { id: 'x2', wellbore_id: 'w3' });
    db.emitChange('alerts', { id: 'x3', wellbore_id: 'w2' });
    off();
    db.emitChange('alerts', { id: 'x4', wellbore_id: 'w1' });
    expect(got).toEqual(['x1', 'x3']);
  });

  it('delivers Supabase-shaped payloads and honours eq filters', () => {
    const got = [];
    const off = subscribe('stream_state', 'wellbore_id=eq.a', (p) => got.push(p));
    db.emitChange('stream_state', { wellbore_id: 'a', bit_md_m: 1 });
    db.emitChange('stream_state', { wellbore_id: 'b', bit_md_m: 2 });
    off();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ eventType: 'UPDATE', new: { bit_md_m: 1 } });
  });

  it('forwards deletes announced on event:<table>', () => {
    const got = [];
    const off = subscribe('alerts', 'wellbore_id=eq.w1', (p) => got.push([p.eventType, p.old?.id]));
    db.emit('alerts', 'DELETE', null, { id: 'gone', wellbore_id: 'w1' });
    off();
    expect(got).toEqual([['DELETE', 'gone']]);
  });
});

describe('connection status', () => {
  it('reports Reconnecting… state changes and fires reconnect callbacks only when the link returns', () => {
    const status = vi.fn();
    const back = vi.fn();
    const offS = subscribeRealtimeStatus(status);
    const offR = onRealtimeReconnect(back);
    expect(getRealtimeConnected()).toBe(true);
    setMockConnection(false);
    expect(getRealtimeConnected()).toBe(false);
    expect(back).not.toHaveBeenCalled();
    setMockConnection(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(2);
    setMockConnection(true); // no change, no extra callbacks
    expect(back).toHaveBeenCalledTimes(1);
    offS();
    offR();
  });
});

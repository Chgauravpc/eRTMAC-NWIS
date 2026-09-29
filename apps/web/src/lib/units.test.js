import { describe, it, expect, vi, afterEach } from 'vitest';
import { fmtDepth, fmtSG, fmtVolume, fmtDistance, fmtTorque, fmtDuration, fmtTimeAgo } from './units';

describe('Units formatters', () => {
  it('formats depth', () => {
    expect(fmtDepth(2395)).toBe('2395.0 m');
    expect(fmtDepth(0)).toBe('0.0 m');
    expect(fmtDepth(null)).toBe('-');
    expect(fmtDepth(undefined)).toBe('-');
    expect(fmtDepth(NaN)).toBe('-');
  });
  it('formats SG', () => {
    expect(fmtSG(1.185)).toBe('1.19 SG');
    expect(fmtSG(1.18)).toBe('1.18 SG');
    expect(fmtSG(null)).toBe('-');
  });
  it('formats volume', () => {
    expect(fmtVolume(42)).toBe('42.0 m³');
    expect(fmtVolume(undefined)).toBe('-');
  });
  it('formats distance with the km switch at 1,000 m', () => {
    expect(fmtDistance(500)).toBe('500 m');
    expect(fmtDistance(999)).toBe('999 m');
    expect(fmtDistance(1000)).toBe('1.0 km');
    expect(fmtDistance(1500)).toBe('1.5 km');
    expect(fmtDistance(null)).toBe('-');
  });
  it('formats torque', () => {
    expect(fmtTorque(15)).toBe('15.0 kN·m');
    expect(fmtTorque(null)).toBe('-');
  });
  it('formats duration', () => {
    expect(fmtDuration(3.5)).toBe('3.5 h');
    expect(fmtDuration(null)).toBe('-');
  });
});

describe('fmtTimeAgo', () => {
  afterEach(() => vi.useRealTimers());
  it('formats relative time and tolerates bad input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T10:15:00Z'));
    expect(fmtTimeAgo('2026-09-28T10:10:00Z')).toBe('5 minutes ago');
    expect(fmtTimeAgo(null)).toBe('-');
    expect(fmtTimeAgo('not a date')).toBe('-');
  });
});

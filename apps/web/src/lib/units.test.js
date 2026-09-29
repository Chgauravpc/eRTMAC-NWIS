import { describe, it, expect } from 'vitest';
import { fmtDepth, fmtSG, fmtVolume, fmtDistance, fmtTorque, fmtDuration } from './units';

describe('Units formatters', () => {
  it('formats depth', () => {
    expect(fmtDepth(2395)).toBe('2395.0 m');
    expect(fmtDepth(null)).toBe('-');
  });
  it('formats SG', () => {
    expect(fmtSG(1.185)).toBe('1.19 SG');
  });
  it('formats volume', () => {
    expect(fmtVolume(42)).toBe('42.0 m³');
  });
  it('formats distance', () => {
    expect(fmtDistance(500)).toBe('500 m');
    expect(fmtDistance(1500)).toBe('1.5 km');
  });
  it('formats torque', () => {
    expect(fmtTorque(15)).toBe('15.0 kN·m');
  });
  it('formats duration', () => {
    expect(fmtDuration(3.5)).toBe('3.5 h');
  });
});

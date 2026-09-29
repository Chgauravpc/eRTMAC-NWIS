import { describe, it, expect } from 'vitest';
import { bandFor, severityFor } from './risk';

describe('bandFor', () => {
  it('assigns boundaries correctly', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(20)).toBe('low');
    expect(bandFor(20.01)).toBe('moderate');
    expect(bandFor(40)).toBe('moderate');
    expect(bandFor(40.01)).toBe('elevated');
    expect(bandFor(60)).toBe('elevated');
    expect(bandFor(60.01)).toBe('high');
    expect(bandFor(80)).toBe('high');
    expect(bandFor(80.01)).toBe('critical');
    expect(bandFor(100)).toBe('critical');
  });
});

describe('severityFor', () => {
  it('returns severity based on band', () => {
    expect(severityFor('high')).toBe('warning');
    expect(severityFor('low')).toBe('none');
  });
});

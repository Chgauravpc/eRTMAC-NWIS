// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDemoActive } from './demoMode';

describe('demo mode switch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/login');
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    vi.stubEnv('VITE_DEMO_DEFAULT', '');
    vi.stubEnv('VITE_DEMO_MODE', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default and on after ?demo=1, which is remembered', () => {
    expect(isDemoActive()).toBe(false);
    window.history.pushState({}, '', '/login?demo=1');
    expect(isDemoActive()).toBe(true);
    window.history.pushState({}, '', '/wells');
    expect(isDemoActive()).toBe(true);
  });

  it('?demo=0 turns it off and remembers that', () => {
    window.localStorage.setItem('nwis.demo', '1');
    window.history.pushState({}, '', '/login?demo=0');
    expect(isDemoActive()).toBe(false);
    window.history.pushState({}, '', '/wells');
    expect(isDemoActive()).toBe(false);
  });

  it('VITE_DEMO_DEFAULT=on starts a new visitor in demo mode, and a remembered choice wins', () => {
    vi.stubEnv('VITE_DEMO_DEFAULT', 'on');
    expect(isDemoActive()).toBe(true);
    window.localStorage.setItem('nwis.demo', '0');
    expect(isDemoActive()).toBe(false);
  });

  it('VITE_DEMO_MODE=off removes the option, VITE_USE_MOCKS=true forces mocks', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'off');
    window.history.pushState({}, '', '/login?demo=1');
    expect(isDemoActive()).toBe(false);
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    expect(isDemoActive()).toBe(true);
  });
});

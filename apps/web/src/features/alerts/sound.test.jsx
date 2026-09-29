import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EnableSoundButton } from './EnableSoundButton';
import { SOUND_CADENCE, disableSound, enableSound, getActiveSoundLevel, isSoundEnabled, resetSoundForTests, soundLevelFor, updateAlertSound } from './sound';

let beeps;

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  createGain() {
    return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
  }

  createOscillator() {
    return {
      connect() {},
      frequency: {},
      start: () => beeps.push(Date.now()),
      stop() {},
    };
  }
}

const alert = (severity, state = 'sent', id = severity) => ({ id, severity, state });

beforeEach(() => {
  vi.useFakeTimers();
  beeps = [];
  window.AudioContext = FakeAudioContext;
  localStorage.clear();
  resetSoundForTests();
});
afterEach(() => {
  disableSound();
  vi.useRealTimers();
  delete window.AudioContext;
});

describe('soundLevelFor', () => {
  it('only unacknowledged warning/critical alerts make noise; critical wins', () => {
    expect(soundLevelFor([alert('info'), alert('watch')])).toBeNull();
    expect(soundLevelFor([alert('warning')])).toBe('warning');
    expect(soundLevelFor([alert('warning'), alert('critical')])).toBe('critical');
    expect(soundLevelFor([alert('critical', 'acknowledged')])).toBeNull();
    expect(soundLevelFor([alert('warning', 'generated')])).toBe('warning');
    expect(soundLevelFor([alert('warning', 'escalated')])).toBe('warning');
    expect(soundLevelFor([alert('warning', 'resolved')])).toBeNull();
  });
});

describe('alert sound cadence', () => {
  it('warning: 2 beeps every 20 s', () => {
    enableSound();
    beeps.length = 0; // confirmation beep
    updateAlertSound([alert('warning')]);
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(SOUND_CADENCE.warning.beeps); // 2
    beeps.length = 0;
    vi.advanceTimersByTime(19000); // t = 20 s
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(2);
    beeps.length = 0;
    vi.advanceTimersByTime(20000);
    expect(beeps).toHaveLength(2);
  });

  it('critical: 3 beeps every 8 s', () => {
    enableSound();
    beeps.length = 0;
    updateAlertSound([alert('critical')]);
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(3);
    beeps.length = 0;
    vi.advanceTimersByTime(8000);
    expect(beeps).toHaveLength(3);
    expect(getActiveSoundLevel()).toBe('critical');
  });

  it('info and watch never make sound', () => {
    enableSound();
    beeps.length = 0;
    updateAlertSound([alert('info'), alert('watch')]);
    vi.advanceTimersByTime(60000);
    expect(beeps).toHaveLength(0);
    expect(getActiveSoundLevel()).toBeNull();
  });

  it('stops for everyone when the state changes (acknowledged arrives through Realtime)', () => {
    enableSound();
    updateAlertSound([alert('critical')]);
    vi.advanceTimersByTime(9000);
    beeps.length = 0;
    updateAlertSound([alert('critical', 'acknowledged')]);
    expect(getActiveSoundLevel()).toBeNull();
    vi.advanceTimersByTime(60000);
    expect(beeps).toHaveLength(0);
  });

  it('does not restart the interval on unrelated list changes', () => {
    enableSound();
    beeps.length = 0;
    updateAlertSound([alert('warning')]);
    vi.advanceTimersByTime(1000); // first pattern played
    beeps.length = 0;
    vi.advanceTimersByTime(10000);
    // unrelated changes: an info alert appears, a new list object with the same warning
    updateAlertSound([alert('warning'), alert('info', 'sent', 'i1')]);
    updateAlertSound([alert('warning'), alert('info', 'sent', 'i1'), alert('watch', 'sent', 'w1')]);
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(0); // no extra immediate pattern, cadence intact
    vi.advanceTimersByTime(9000); // 20 s after the first pattern
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(2);
  });

  it('escalating from warning to critical switches cadence immediately', () => {
    enableSound();
    beeps.length = 0;
    updateAlertSound([alert('warning')]);
    vi.advanceTimersByTime(1000);
    beeps.length = 0;
    updateAlertSound([alert('warning'), alert('critical', 'sent', 'c')]);
    vi.advanceTimersByTime(1000);
    expect(beeps).toHaveLength(3);
  });

  it('is silent until the user enables sound, then starts for alerts already open', () => {
    updateAlertSound([alert('critical')]);
    vi.advanceTimersByTime(20000);
    expect(beeps).toHaveLength(0);
    enableSound();
    vi.advanceTimersByTime(1000);
    expect(getActiveSoundLevel()).toBe('critical');
    expect(beeps.length).toBeGreaterThanOrEqual(3);
  });
});

describe('EnableSoundButton', () => {
  it('unlocks audio on click, shows the enabled state and persists the choice', () => {
    render(<EnableSoundButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sound' }));
    expect(isSoundEnabled()).toBe(true);
    expect(localStorage.getItem('alert_sound_enabled')).toBe('true');
    expect(screen.getByRole('button', { name: /Alert sound on/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers the choice after a reload', () => {
    localStorage.setItem('alert_sound_enabled', 'true');
    resetSoundForTests();
    render(<EnableSoundButton />);
    expect(screen.getByRole('button', { name: /Alert sound on/ })).toBeInTheDocument();
  });

  it('survives blocked localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<EnableSoundButton />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Enable alert sound' }))).not.toThrow();
    expect(isSoundEnabled()).toBe(true);
    spy.mockRestore();
  });

  it('can be muted again', () => {
    render(<EnableSoundButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable alert sound' }));
    fireEvent.click(screen.getByRole('button', { name: /Alert sound on/ }));
    expect(isSoundEnabled()).toBe(false);
    expect(localStorage.getItem('alert_sound_enabled')).toBe('false');
  });
});

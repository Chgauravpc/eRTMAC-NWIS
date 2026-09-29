// Alert sound (contract/PRD FE-09): Web Audio beeps.
//   warning  = 2 beeps every 20 s      critical = 3 beeps every 8 s      info/watch = silent
// The sound follows the *list of unacknowledged alerts* and nothing else, so when any client
// acknowledges (state change arrives through Realtime) every other client's list changes and its
// sound stops. The interval is only touched when the desired level changes.
const STORAGE_KEY = 'alert_sound_enabled';

export const SOUND_CADENCE = Object.freeze({
  warning: Object.freeze({ beeps: 2, everyMs: 20000, freq: 440, gapMs: 300 }),
  critical: Object.freeze({ beeps: 3, everyMs: 8000, freq: 660, gapMs: 250 }),
});

/** States in which an alert is still "unacknowledged" and therefore keeps making noise. */
export const UNACKED_STATES = Object.freeze(['generated', 'sent', 'viewed', 'escalated']);

let enabled = readStored();
let audioCtx = null;
let activeLevel = null; // 'warning' | 'critical' | null
let desiredLevel = null;
let intervalId = null;
let beepTimers = [];
let unlockArmed = false;
const listeners = new Set();

function readStored() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persist(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    /* storage blocked: the choice simply lasts for this page view */
  }
}

function emit() {
  listeners.forEach((fn) => fn());
}

function getContext() {
  if (audioCtx) return audioCtx;
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function resumeContext() {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

/** Browsers block audio until a gesture; after a reload with the choice remembered, unlock on the first tap. */
function armUnlock() {
  if (unlockArmed || typeof document === 'undefined') return;
  unlockArmed = true;
  const unlock = () => {
    resumeContext();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    unlockArmed = false;
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
}

function beep(freq, durationS = 0.2) {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') resumeContext();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationS);
    osc.start();
    osc.stop(ctx.currentTime + durationS);
  } catch {
    /* audio unavailable: the visual banner never depends on sound */
  }
}

function playPattern(level) {
  const { beeps, freq, gapMs } = SOUND_CADENCE[level];
  for (let i = 0; i < beeps; i += 1) {
    beepTimers.push(setTimeout(() => beep(freq), i * gapMs));
  }
}

function clearBeepTimers() {
  beepTimers.forEach(clearTimeout);
  beepTimers = [];
}

function stop() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  clearBeepTimers();
  activeLevel = null;
}

function apply() {
  if (!enabled || !desiredLevel) {
    if (activeLevel) stop();
    return;
  }
  if (desiredLevel === activeLevel) return; // unrelated list changes must not restart the cadence
  stop();
  activeLevel = desiredLevel;
  const level = desiredLevel;
  playPattern(level);
  intervalId = setInterval(() => playPattern(level), SOUND_CADENCE[level].everyMs);
}

export function isSoundEnabled() {
  return enabled;
}

export function subscribeSound(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call from a click handler: unlocks audio, remembers the choice, plays a short confirmation. */
export function enableSound() {
  enabled = true;
  persist(true);
  resumeContext();
  beep(880, 0.12);
  emit();
  apply();
}

export function disableSound() {
  enabled = false;
  persist(false);
  stop();
  emit();
}

export function setSoundEnabled(value) {
  if (value) enableSound();
  else disableSound();
}

/** 'critical' | 'warning' | null for a list of alerts (only unacknowledged warning/critical count). */
export function soundLevelFor(alerts) {
  let level = null;
  for (const a of alerts || []) {
    if (!UNACKED_STATES.includes(a.state)) continue;
    if (a.severity === 'critical') return 'critical';
    if (a.severity === 'warning') level = 'warning';
  }
  return level;
}

export function updateAlertSound(alerts) {
  desiredLevel = soundLevelFor(alerts);
  if (enabled) armUnlock();
  apply();
}

export function getActiveSoundLevel() {
  return activeLevel;
}

/** Test helper: forget all state. */
export function resetSoundForTests() {
  stop();
  desiredLevel = null;
  enabled = readStored();
  audioCtx = null;
  listeners.clear();
}

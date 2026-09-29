let audioCtx = null;
let soundInterval = null;
let enabled = false;

// We delay reading localStorage until we are in the browser
if (typeof window !== 'undefined') {
  enabled = localStorage.getItem('alert_sound_enabled') === 'true';
}

export function isSoundEnabled() { return enabled; }

export function setSoundEnabled(val) {
  enabled = !!val;
  if (typeof window !== 'undefined') {
    localStorage.setItem('alert_sound_enabled', enabled ? 'true' : 'false');
  }
  
  if (enabled) {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } else {
    stopSound();
  }
}

function beep(freq, duration) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playWarning() {
  beep(400, 0.2);
  setTimeout(() => beep(400, 0.2), 300);
}

function playCritical() {
  beep(600, 0.2);
  setTimeout(() => beep(600, 0.2), 250);
  setTimeout(() => beep(600, 0.2), 500);
}

export function updateAlertSound(unacknowledgedAlerts) {
  if (!enabled) {
    stopSound();
    return;
  }
  
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  
  const hasCritical = unacknowledgedAlerts.some(a => a.severity === 'critical');
  const hasWarning = unacknowledgedAlerts.some(a => a.severity === 'warning');

  if (!hasCritical && !hasWarning) {
    stopSound();
    return;
  }

  if (soundInterval) clearInterval(soundInterval);

  if (hasCritical) {
    playCritical();
    soundInterval = setInterval(playCritical, 8000);
  } else if (hasWarning) {
    playWarning();
    soundInterval = setInterval(playWarning, 20000);
  }
}

function stopSound() {
  if (soundInterval) {
    clearInterval(soundInterval);
    soundInterval = null;
  }
}

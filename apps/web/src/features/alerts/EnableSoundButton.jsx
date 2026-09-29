import React, { useSyncExternalStore } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { disableSound, enableSound, isSoundEnabled, subscribeSound } from './sound';

/**
 * Top-bar gate for alert sound. Browsers block audio until the user interacts, so the first click
 * unlocks it; the choice is remembered in localStorage (see sound.js).
 */
export function EnableSoundButton({ variant = 'light', className = '' }) {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => false);

  const rig = variant === 'rig';
  const size = rig ? 'min-h-[48px] min-w-[48px] text-lg' : 'min-h-[44px] text-sm';
  const onTone = rig ? 'border-white bg-transparent text-white' : 'border-green-700 bg-green-50 text-green-900';
  const offTone = rig ? 'border-white bg-transparent text-white' : 'border-gray-400 bg-white text-gray-900 hover:bg-gray-50';

  return enabled ? (
    <button
      type="button"
      onClick={disableSound}
      aria-pressed="true"
      title="Alert sound is on. Click to mute."
      className={`inline-flex items-center gap-2 rounded border-2 px-3 py-1 font-medium ${size} ${onTone} ${className}`}
    >
      <Volume2 size={16} aria-hidden="true" /> Alert sound on
    </button>
  ) : (
    <button
      type="button"
      onClick={enableSound}
      aria-pressed="false"
      className={`inline-flex items-center gap-2 rounded border-2 px-3 py-1 font-medium ${size} ${offTone} ${className}`}
    >
      <VolumeX size={16} aria-hidden="true" /> Enable alert sound
    </button>
  );
}

export default EnableSoundButton;

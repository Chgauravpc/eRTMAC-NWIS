import { useEffect, useState } from 'react';

/**
 * Keep the tablet screen on while the rig view is open (navigator.wakeLock when available).
 * Re-acquires the lock when the tab becomes visible again (the browser releases it when hidden).
 * Returns 'unsupported' | 'pending' | 'active' | 'denied'.
 */
export function useWakeLock() {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [status, setStatus] = useState(supported ? 'pending' : 'unsupported');

  useEffect(() => {
    if (!supported) return undefined;
    let sentinel = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) {
          s.release?.().catch?.(() => {});
          return;
        }
        sentinel = s;
        setStatus('active');
        s.addEventListener?.('release', () => {
          if (sentinel === s) setStatus('pending');
        });
      } catch {
        if (!cancelled) setStatus('denied');
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) {
        const s = sentinel;
        sentinel = null;
        Promise.resolve(s.release?.()).catch(() => {});
      }
    };
  }, [supported]);

  return status;
}

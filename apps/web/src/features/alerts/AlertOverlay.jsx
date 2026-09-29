import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAlert } from '../../lib/hooks/alerts';
import { AlertCard } from './AlertCard';

/**
 * Full-screen alert card (banner "View", notification click, list rows). It reads the alert through
 * useAlert so it keeps updating after the alert leaves the open list (resolved, feedback).
 * On the rig route it uses the `.rig` theme and >= 18 px text.
 */
export function AlertOverlay({ alertId, seed, user, onClose }) {
  const { pathname } = useLocation();
  const isRig = pathname.startsWith('/rig');
  const { data: alert, isError } = useAlert(alertId, seed);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alert details"
      className={`${isRig ? 'rig' : 'bg-gray-100 text-gray-900'} fixed inset-0 z-50 overflow-y-auto`}
    >
      <div className="mx-auto max-w-5xl p-3">
        <div className="mb-3 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={`inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg border-2 px-4 text-lg font-semibold ${isRig ? 'border-white text-white' : 'border-gray-700 bg-white text-gray-900'}`}
          >
            <X size={22} aria-hidden="true" /> Close
          </button>
        </div>
        {alert ? (
          <div className={isRig ? '[&_.text-sm]:!text-lg [&_.text-xs]:!text-lg' : ''}>
            <AlertCard alert={alert} user={user} large={isRig} />
          </div>
        ) : (
          <p role={isError ? 'alert' : 'status'} className="rounded bg-white p-6 text-lg text-gray-900">
            {isError ? 'Could not load this alert.' : 'Loading alert…'}
          </p>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useAlertActions } from '../../lib/hooks/alerts';
import { canAcknowledge, canDismiss, canResolve } from './permissions';
import { ResolveDialog } from './ResolveDialog';
import { DismissDialog } from './DismissDialog';

const BTN = 'min-h-[48px] min-w-[48px] rounded-lg border-2 px-4 font-semibold disabled:opacity-60';

/** Acknowledge (optional note), Resolve, Dismiss. Only what contract §12 allows for this user is shown. */
export function AlertActions({ alert, user }) {
  const actions = useAlertActions();
  const [note, setNote] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  const showAck = canAcknowledge(user, alert);
  const showResolve = canResolve(user, alert);
  const showDismiss = canDismiss(user, alert);
  if (!showAck && !showResolve && !showDismiss) return null;

  return (
    <div className="mt-2 border-t border-gray-300 pt-4">
      {showAck && (
        <div className="mb-3">
          <label htmlFor={`ack-note-${alert.id}`} className="mb-1 block text-sm font-semibold">
            Acknowledge note (optional)
          </label>
          <input
            id={`ack-note-${alert.id}`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. reduced pump rate, LCM pill ready"
            className="min-h-[48px] w-full rounded-lg border-2 border-gray-500 px-3"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {showAck && (
          <button
            type="button"
            disabled={actions.pending}
            onClick={() => actions.ack(alert.id, note.trim() || null)}
            className={`${BTN} border-blue-900 bg-blue-800 text-white`}
          >
            Acknowledge
          </button>
        )}
        {showResolve && (
          <button type="button" onClick={() => setResolveOpen(true)} className={`${BTN} border-gray-800 bg-white text-gray-900`}>
            Resolve
          </button>
        )}
        {showDismiss && (
          <button type="button" onClick={() => setDismissOpen(true)} className={`${BTN} border-red-800 bg-white text-red-900`}>
            Dismiss
          </button>
        )}
      </div>
      {actions.error && (
        <p role="alert" className="mt-3 rounded border border-red-800 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {actions.error.message}
        </p>
      )}
      {resolveOpen && <ResolveDialog alert={alert} onClose={() => setResolveOpen(false)} />}
      {dismissOpen && <DismissDialog alert={alert} onClose={() => setDismissOpen(false)} />}
    </div>
  );
}

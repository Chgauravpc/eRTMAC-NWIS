import React, { useEffect, useState } from 'react';
import { useAlertActions } from '../../lib/hooks/alerts';

export const MIN_REASON_CHARS = 5;

/** Dismiss is only for info/watch alerts; the reason (>= 5 characters) is required and audited. */
export function DismissDialog({ alert, onClose }) {
  const actions = useAlertActions();
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (reason.trim().length < MIN_REASON_CHARS) {
      setLocalError(`Reason must be at least ${MIN_REASON_CHARS} characters.`);
      return;
    }
    const row = await actions.dismiss(alert.id, reason.trim());
    if (row) onClose();
  };

  const error = localError || actions.error?.message;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="dismiss-title" className="w-full max-w-md rounded-xl bg-white p-6 text-gray-900 shadow-2xl">
        <h2 id="dismiss-title" className="mb-4 border-b pb-2 text-xl font-bold text-red-900">
          Dismiss this alert
        </h2>
        <p className="mb-4 text-sm">Only info and watch alerts can be dismissed. Your reason is kept in the audit log.</p>
        <label htmlFor="dismiss-reason" className="mb-1 block text-sm font-semibold">
          Reason for dismissal (required)
        </label>
        <textarea
          id="dismiss-reason"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setLocalError('');
          }}
          className="mb-4 w-full rounded-lg border-2 border-gray-500 p-3"
        />
        {error && (
          <p role="alert" className="mb-4 rounded border border-red-800 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={actions.pending} className="min-h-[48px] rounded-lg border-2 border-gray-700 px-4 font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={actions.pending}
            className="min-h-[48px] rounded-lg border-2 border-red-900 bg-red-800 px-4 font-semibold text-white disabled:opacity-60"
          >
            Confirm dismissal
          </button>
        </div>
      </div>
    </div>
  );
}

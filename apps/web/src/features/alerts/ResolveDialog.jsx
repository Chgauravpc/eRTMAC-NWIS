import React, { useEffect, useState } from 'react';
import { useAlertActions } from '../../lib/hooks/alerts';

const OUTCOMES = [
  ['event_occurred', 'Event occurred'],
  ['avoided', 'Avoided (mitigated)'],
  ['false_alarm', 'False alarm'],
];

export function ResolveDialog({ alert, onClose }) {
  const actions = useAlertActions();
  const [outcome, setOutcome] = useState('avoided');
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const row = await actions.resolve(alert.id, outcome, note.trim() || null);
    if (row) onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="resolve-title" className="w-full max-w-md rounded-xl bg-white p-6 text-gray-900 shadow-2xl">
        <h2 id="resolve-title" className="mb-4 border-b pb-2 text-xl font-bold">
          Resolve this alert
        </h2>
        <label htmlFor="resolve-outcome" className="mb-1 block text-sm font-semibold">
          Outcome
        </label>
        <select
          id="resolve-outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="mb-4 min-h-[48px] w-full rounded-lg border-2 border-gray-500 px-3"
        >
          {OUTCOMES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="resolve-note" className="mb-1 block text-sm font-semibold">
          Note (optional)
        </label>
        <textarea
          id="resolve-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mb-4 w-full rounded-lg border-2 border-gray-500 p-3"
        />
        {actions.error && (
          <p role="alert" className="mb-4 rounded border border-red-800 bg-red-50 p-3 text-sm text-red-900">
            {actions.error.message}
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
            className="min-h-[48px] rounded-lg border-2 border-blue-900 bg-blue-800 px-4 font-semibold text-white disabled:opacity-60"
          >
            Confirm resolution
          </button>
        </div>
      </div>
    </div>
  );
}

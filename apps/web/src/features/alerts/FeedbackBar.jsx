import React from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useAlertActions } from '../../lib/hooks/alerts';
import { canRate } from './permissions';

/**
 * "Was this alert useful?" only once the alert is resolved (contract §12); afterwards (state
 * 'feedback') the answer is shown read-only.
 */
export function FeedbackBar({ alert, user }) {
  const actions = useAlertActions();

  if (alert.state === 'feedback') {
    return (
      <p className="mt-4 rounded border border-gray-400 bg-gray-50 p-3 text-sm" data-testid="feedback-summary">
        Feedback recorded: {alert.useful ? 'this alert was useful' : 'this alert was not useful'}.
      </p>
    );
  }
  if (!canRate(user, alert)) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-900 bg-blue-50 p-4">
      <span className="font-semibold text-blue-950">Was this alert useful?</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={actions.pending}
          onClick={() => actions.rate(alert.id, true)}
          className="inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-lg border-2 border-green-900 bg-white px-4 font-semibold text-green-950 disabled:opacity-60"
        >
          <ThumbsUp size={18} aria-hidden="true" /> Yes
        </button>
        <button
          type="button"
          disabled={actions.pending}
          onClick={() => actions.rate(alert.id, false)}
          className="inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-lg border-2 border-red-900 bg-white px-4 font-semibold text-red-950 disabled:opacity-60"
        >
          <ThumbsDown size={18} aria-hidden="true" /> No
        </button>
      </div>
      {actions.error && (
        <p role="alert" className="w-full text-sm font-medium text-red-900">
          {actions.error.message}
        </p>
      )}
    </div>
  );
}

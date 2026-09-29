import React, { useState } from 'react';
import { ACTIVE_WELLBORE_ID } from '../mocks/ids';
import { dropStream } from '../lib/data/stream';
import { getRealtimeConnected, setMockConnection } from '../lib/realtime';

/** Only in mock mode, never in a production build, and only when the URL has ?demo=1. */
export function isDevPanelEnabled() {
  if (import.meta.env.PROD) return false;
  if (import.meta.env.VITE_USE_MOCKS !== 'true') return false;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

/** Complete the first queued/running mock job (jobs live in the documents mock domain, same Realtime bus). */
async function completeJob() {
  const { db } = await import('../mocks/db');
  let job = null;
  try {
    job = db.select('jobs', (j) => j.status === 'running' || j.status === 'queued')[0] ?? null;
  } catch {
    return 'The mock database has no jobs table yet.';
  }
  if (!job) return 'No queued or running job to complete.';
  db.update('jobs', job.id, { status: 'done', stage: 'done', progress: 100, updated_at: new Date().toISOString() });
  return `Job ${job.id.slice(0, 8)} completed.`;
}

export function DevPanel() {
  const [message, setMessage] = useState('');
  const [linkUp, setLinkUp] = useState(getRealtimeConnected());
  if (!isDevPanelEnabled()) return null;

  // Mock helpers are loaded on demand so they never weigh on a normal page load.
  const createAlert = async (partial) => {
    const { mockCreateAlert } = await import('../mocks/handlers/alerts');
    mockCreateAlert(partial);
  };
  const advanceBit = async () => {
    const { mockAdvanceBit } = await import('../mocks/handlers/risk');
    mockAdvanceBit(ACTIVE_WELLBORE_ID, 5);
  };

  const run = (fn) => async () => {
    try {
      const out = await fn();
      setMessage(typeof out === 'string' ? out : '');
    } catch (e) {
      setMessage(`Failed: ${e.message}`);
    }
  };

  const btn = 'min-h-[44px] rounded px-3 py-1 text-left font-medium text-white';

  return (
    <aside aria-label="Demo controls" className="fixed bottom-4 right-4 z-[70] w-60 rounded-lg bg-gray-900 p-3 text-sm text-white shadow-xl">
      <h3 className="mb-2 font-bold">Demo controls (mock)</h3>
      <div className="flex flex-col gap-2">
        <button type="button" className={`${btn} bg-orange-700`} onClick={run(() => createAlert({ kind: 'detector', severity: 'warning', title: 'Warning: flow-out below flow-in', risk_type: 'losses' }))}>
          Warning alert
        </button>
        <button type="button" className={`${btn} bg-red-700`} onClick={run(() => createAlert({ kind: 'detector', severity: 'critical', title: 'Critical: pit gain detected', risk_type: 'kick' }))}>
          Critical alert
        </button>
        <button type="button" className={`${btn} bg-sky-700`} onClick={run(() => createAlert({ kind: 'lookahead', severity: 'warning', title: 'Look-ahead: stuck pipe risk ahead', risk_type: 'stuck_pipe' }))}>
          Look-ahead alert
        </button>
        <button type="button" className={`${btn} bg-blue-700`} onClick={run(advanceBit)}>
          Advance bit 5 m
        </button>
        <button type="button" className={`${btn} bg-gray-700`} onClick={run(async () => { await dropStream(ACTIVE_WELLBORE_ID, 45); return 'Stream dropped for 45 s.'; })}>
          Drop stream 45 s
        </button>
        <button type="button" className={`${btn} bg-green-800`} onClick={run(completeJob)}>
          Complete job
        </button>
        <button
          type="button"
          className={`${btn} bg-gray-700`}
          onClick={() => {
            setMockConnection(!linkUp);
            setLinkUp(!linkUp);
          }}
        >
          {linkUp ? 'Drop Realtime link' : 'Restore Realtime link'}
        </button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </aside>
  );
}

export default DevPanel;

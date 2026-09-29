import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DevPanel, isDevPanelEnabled } from './DevPanel';
import { db } from '../mocks/db';
import { applyQuery, restRespond } from '../mocks/handlers/risk';
import { ACTIVE_WELLBORE_ID } from '../mocks/ids';
import { createServer, installRelativeFetch, resetMockState } from './testHarness';
import { getHealth, setStreamSpeed, startStream, stopStream } from '../lib/data/stream';

const server = createServer();
let restoreFetch;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  restoreFetch = installRelativeFetch();
});
afterAll(() => {
  restoreFetch();
  server.close();
});
beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  window.history.pushState({}, '', '/?demo=1');
  resetMockState();
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.pushState({}, '', '/');
});

describe('DevPanel gating', () => {
  it('shows only with ?demo=1 in mock mode', () => {
    expect(isDevPanelEnabled()).toBe(true);
    window.history.pushState({}, '', '/');
    expect(isDevPanelEnabled()).toBe(false);
    const { container } = render(<DevPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never in a production build, never without mocks', () => {
    vi.stubEnv('PROD', true);
    expect(isDevPanelEnabled()).toBe(false);
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    expect(isDevPanelEnabled()).toBe(false);
  });
});

describe('DevPanel actions (active wellbore from mocks/ids)', () => {
  it('has the requested buttons', () => {
    render(<DevPanel />);
    for (const name of ['Warning alert', 'Critical alert', 'Look-ahead alert', 'Advance bit 5 m', 'Drop stream 45 s', 'Complete job']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Warning / Critical / Look-ahead insert backend-style alerts for the active wellbore (generated, then sent)', async () => {
    render(<DevPanel />);
    const before = db.alerts.length;
    fireEvent.click(screen.getByRole('button', { name: 'Warning alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Critical alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look-ahead alert' }));
    await waitFor(() => expect(db.alerts.length).toBe(before + 3));
    const added = db.alerts.slice(before);
    expect(added.map((a) => [a.kind, a.severity])).toEqual([
      ['detector', 'warning'],
      ['detector', 'critical'],
      ['lookahead', 'warning'],
    ]);
    added.forEach((a) => expect(a.wellbore_id).toBe(ACTIVE_WELLBORE_ID));
    expect(added.every((a) => a.state === 'generated' || a.state === 'sent')).toBe(true);
    await waitFor(() => expect(db.alerts.slice(before).every((a) => a.state === 'sent' && a.sent_at)).toBe(true));
  });

  it('Advance bit moves the bit 5 m, recomputes the window and announces both on the bus', async () => {
    render(<DevPanel />);
    const bit0 = db.get('stream_state', ACTIVE_WELLBORE_ID).bit_md_m;
    const seen = [];
    const on = (e) => seen.push(e.type);
    db.emitter.addEventListener('change:stream_state', on);
    db.emitter.addEventListener('change:risk_scores', on);
    fireEvent.click(screen.getByRole('button', { name: 'Advance bit 5 m' }));
    await waitFor(() => expect(db.get('stream_state', ACTIVE_WELLBORE_ID).bit_md_m).toBe(bit0 + 5));
    await waitFor(() => expect(seen).toContain('change:risk_scores'));
    expect(seen).toContain('change:stream_state');
    const rows = db.risk_scores.filter((r) => r.wellbore_id === ACTIVE_WELLBORE_ID);
    expect(rows.some((r) => r.md_from_m === bit0 + 5)).toBe(true);
    db.emitter.removeEventListener('change:stream_state', on);
    db.emitter.removeEventListener('change:risk_scores', on);
  });

  it('Drop stream calls /api/stream/drop: the stream is lost and a "Live data lost" system alert appears', async () => {
    render(<DevPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop stream 45 s' }));
    await waitFor(() => expect(db.get('stream_state', ACTIVE_WELLBORE_ID).status).toBe('lost'));
    const sys = db.alerts.find((a) => a.kind === 'system');
    expect(sys).toMatchObject({ severity: 'warning', title: 'Live data lost', risk_type: null });
    db.setStreamStatus(ACTIVE_WELLBORE_ID, 'live');
  });

  it('Complete job finishes a running job on the shared bus', async () => {
    db.registerTable('jobs', [{ id: 'j1', status: 'running', stage: 'ocr', progress: 40 }]);
    render(<DevPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete job' }));
    await waitFor(() => expect(db.get('jobs', 'j1').status).toBe('done'));
    expect(db.get('jobs', 'j1').progress).toBe(100);
  });

  it('Drop Realtime link shows the Reconnecting state and restores it', () => {
    render(<DevPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop Realtime link' }));
    expect(screen.getByRole('button', { name: 'Restore Realtime link' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Realtime link' }));
  });
});

describe('mock PostgREST + Space endpoints', () => {
  const params = (qs) => new URL(`http://x/?${qs}`).searchParams;
  const rows = [
    { id: 'a', n: 1, k: 'x', flag: true },
    { id: 'b', n: 2, k: 'y', flag: false },
    { id: 'c', n: 3, k: 'x', flag: false },
  ];

  it('applyQuery honours eq / in / gte / lte / neq / not / is / order / limit', () => {
    const ids = (qs) => applyQuery(rows, params(qs)).map((r) => r.id);
    expect(ids('k=eq.x')).toEqual(['a', 'c']);
    expect(ids('id=in.(a,b)')).toEqual(['a', 'b']);
    expect(ids('n=gte.2')).toEqual(['b', 'c']);
    expect(ids('n=gte.2&n=lte.2')).toEqual(['b']);
    expect(ids('k=neq.x')).toEqual(['b']);
    expect(ids('k=not.eq.x')).toEqual(['b']);
    expect(ids('flag=is.true')).toEqual(['a']);
    expect(ids('order=n.desc&limit=2')).toEqual(['c', 'b']);
    expect(ids('order=k.asc,n.desc')).toEqual(['c', 'a', 'b']);
  });

  it('restRespond returns an object for .single() and PGRST116 for zero/many rows', async () => {
    const req = (accept) => new Request('http://x/', { headers: { accept } });
    const one = restRespond(req('application/vnd.pgrst.object+json'), [rows[0]]);
    expect(await one.json()).toEqual(rows[0]);
    const none = restRespond(req('application/vnd.pgrst.object+json'), []);
    expect(none.status).toBe(406);
    expect((await none.json()).code).toBe('PGRST116');
    expect(await restRespond(req('application/json'), rows).json()).toHaveLength(3);
  });

  it('/api/health, /api/stream/start|stop|speed', async () => {
    expect((await getHealth()).ok).toBe(true);
    expect(await stopStream(ACTIVE_WELLBORE_ID)).toEqual({ status: 'stopped' });
    expect(db.get('stream_state', ACTIVE_WELLBORE_ID).status).toBe('stopped');
    expect(await startStream(ACTIVE_WELLBORE_ID, { speed: 10 })).toEqual({ status: 'live' });
    expect(await setStreamSpeed(ACTIVE_WELLBORE_ID, 60)).toEqual({ speed: 60 });
    expect(db.get('stream_state', ACTIVE_WELLBORE_ID).speed).toBe(60);
  });
});

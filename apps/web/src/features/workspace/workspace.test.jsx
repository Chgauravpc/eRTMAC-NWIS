import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React from 'react';
import { screen, within, waitFor, act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { StreamStatusPill } from './StreamStatusPill';
import WorkspaceLayout, { WORKSPACE_TABS } from './WorkspaceLayout';
import { createServer, renderApp, renderRoute } from '../wells/testHarness';
import { db } from '../../mocks/db';
import { ACTIVE_WELLBORE_ID, ACTIVE_WELL } from '../../mocks/ids';
import { useProfile } from '../auth/useProfile';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('../wells/testHarness')).createTestSupabase() }));
vi.mock('../auth/useProfile', () => ({ useProfile: vi.fn(() => ({ profile: { role: 'office_engineer' } })) }));

const server = createServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('StreamStatusPill', () => {
  it('live: green, icon + the word', () => {
    renderRoute(<StreamStatusPill status="live" lastSampleAt={new Date().toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toBe('live');
    expect(el.className).toMatch(/bg-green-100/);
    expect(el.querySelector('svg')).toBeTruthy(); // not colour alone
  });

  it('stale: amber, the word and "last data" time ago', () => {
    renderRoute(<StreamStatusPill status="stale" lastSampleAt={new Date(Date.now() - 60000).toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toMatch(/^stale/);
    expect(el.textContent).toMatch(/last data 1 minute ago/i);
    expect(el.className).toMatch(/bg-amber-100/);
    expect(el.querySelector('svg')).toBeTruthy();
  });

  it('lost: red, the word and "last data" time ago', () => {
    renderRoute(<StreamStatusPill status="lost" lastSampleAt={new Date(Date.now() - 3600000).toISOString()} />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toMatch(/^lost/);
    expect(el.textContent).toMatch(/last data about 1 hour ago/i);
    expect(el.className).toMatch(/bg-red-100/);
    expect(el.querySelector('svg')).toBeTruthy();
  });

  it('stopped: grey, the word only', () => {
    renderRoute(<StreamStatusPill status="stopped" />);
    const el = screen.getByTestId('stream-status');
    expect(el.textContent).toBe('stopped');
    expect(el.className).toMatch(/bg-gray-100/);
    expect(el.querySelector('svg')).toBeTruthy();
  });
});

function renderWorkspace() {
  return renderApp(
    <Routes>
      <Route path="/wells/:wellboreId" element={<WorkspaceLayout />}>
        <Route path="map" element={<div>map tab body</div>} />
        <Route path="formation" element={<div>formation tab body</div>} />
      </Route>
    </Routes>,
    { route: `/wells/${ACTIVE_WELLBORE_ID}/map` },
  );
}

describe('WorkspaceLayout', () => {
  it('shows the well header (name, field, provenance) and the tabs in journey order', async () => {
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: ACTIVE_WELL.well_name })).toBeTruthy();
    expect(screen.getByText(`Field: ${ACTIVE_WELL.field}`)).toBeTruthy();
    expect(screen.getByTestId('provenance-badge').textContent).toBe(ACTIVE_WELL.provenance.toUpperCase());
    const tabs = within(screen.getByRole('navigation', { name: 'Well workspace' })).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual(['Map', 'Formation & events', 'Correlation', 'Risk ahead', 'Alerts']);
    expect(WORKSPACE_TABS.map((t) => t.path)).toEqual(['map', 'formation', 'correlation', 'risk', 'alerts']);
    expect(screen.getByText('map tab body')).toBeTruthy();
  });

  it('header shows bit depth and formation from RPC formation_at_md, and follows stream_state Realtime updates', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('header-bit').textContent).toMatch(/Bit: \d+\.\d m/));
    await waitFor(() => expect(screen.getByTestId('header-formation').textContent).toBe('Formation: Barail'));
    const initialBit = screen.getByTestId('header-bit').textContent;

    // exactly what DevPanel "Advance bit 5 m" does: mutate the row and re-emit the same object
    const row = { wellbore_id: ACTIVE_WELLBORE_ID, status: 'live', bit_md_m: 2405, last_sample_at: new Date().toISOString() };
    act(() => db.emitChange('stream_state', row));
    await waitFor(() => expect(screen.getByTestId('header-bit').textContent).toBe('Bit: 2405.0 m'));
    row.bit_md_m += 5;
    act(() => db.emitChange('stream_state', row));
    await waitFor(() => expect(screen.getByTestId('header-bit').textContent).toBe('Bit: 2410.0 m'));
    expect(initialBit).toBeTruthy();

    // bit crosses into the next formation: the RPC is re-run and the header changes
    row.bit_md_m = 2950;
    act(() => db.emitChange('stream_state', row));
    await waitFor(() => expect(screen.getByTestId('header-formation').textContent).toBe('Formation: Kopili'));

    // status change updates the pill
    act(() => db.emitChange('stream_state', { ...row, status: 'lost', last_sample_at: new Date(Date.now() - 300000).toISOString() }));
    await waitFor(() => expect(screen.getByTestId('stream-status').dataset.status).toBe('lost'));
    expect(screen.getByTestId('stream-status').textContent).toMatch(/last data 5 minutes ago/);
  });

  it('ignores stream_state changes of other wellbores', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('header-bit').textContent).toMatch(/Bit: \d/));
    const before = screen.getByTestId('header-bit').textContent;
    act(() => db.emitChange('stream_state', { wellbore_id: 'some-other-wellbore', status: 'live', bit_md_m: 1 }));
    expect(screen.getByTestId('header-bit').textContent).toBe(before);
  });

  it('Open rig view is offered to rig/rtoc/admin only', async () => {
    useProfile.mockReturnValue({ profile: { role: 'rtoc_engineer' } });
    const { unmount } = renderWorkspace();
    const link = await screen.findByRole('link', { name: 'Open rig view' });
    expect(link.getAttribute('href')).toBe(`/rig/${ACTIVE_WELLBORE_ID}`);
    unmount();
    useProfile.mockReturnValue({ profile: { role: 'office_engineer' } });
    renderWorkspace();
    await screen.findByRole('heading', { name: ACTIVE_WELL.well_name });
    expect(screen.queryByRole('link', { name: 'Open rig view' })).toBeNull();
  });
});

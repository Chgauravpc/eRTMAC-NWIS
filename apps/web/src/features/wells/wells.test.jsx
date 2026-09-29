import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React from 'react';
import { screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { WellsPage } from './WellsPage';
import { ProvenanceBadge } from './ProvenanceBadge';
import { sortDrillingFirst } from '../../lib/data/wells';
import { createServer, renderRoute, alertsHandler, REST } from './testHarness';
import { db } from '../../mocks/db';
import { ACTIVE_WELLBORE_ID, ACTIVE_WELL } from '../../mocks/ids';
import wellsFixture from '../../mocks/fixtures/wells.json';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('./testHarness')).createTestSupabase() }));

const server = createServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const renderPage = () => renderRoute(<WellsPage />, { path: '/wells', route: '/wells' });

describe('sortDrillingFirst', () => {
  it('puts drilling wells first, then planned, then completed, alphabetical inside a group', () => {
    const sorted = sortDrillingFirst([
      { well_name: 'B', status: 'completed' },
      { well_name: 'A', status: 'completed' },
      { well_name: 'D', status: 'planned' },
      { well_name: 'C', status: 'drilling' },
    ]);
    expect(sorted.map((w) => w.well_name)).toEqual(['C', 'D', 'A', 'B']);
  });
});

describe('WellsPage', () => {
  it('shows drilling wells first as cards, and the table lists drilling wells before completed ones', async () => {
    renderPage();
    const cards = await screen.findAllByTestId('drilling-well-card');
    const drilling = wellsFixture.filter((w) => w.status === 'drilling');
    expect(cards).toHaveLength(drilling.length);
    expect(within(cards[0]).getByText(drilling[0].well_name)).toBeTruthy();

    const rows = within(screen.getByTestId('wells-table-body')).getAllByRole('row');
    expect(rows).toHaveLength(wellsFixture.length);
    expect(within(rows[0]).getByText(drilling[0].well_name)).toBeTruthy();
    // every completed well comes after the drilling one
    const statuses = rows.map((r) => within(r).getAllByRole('cell')[2].textContent.toLowerCase());
    expect(statuses[0]).toBe('drilling');
    expect(statuses.slice(1).every((s) => s !== 'drilling')).toBe(true);
  });

  it('card shows bit depth and stream status from stream_state (not hardcoded), and open alerts by severity', async () => {
    server.use(
      alertsHandler([
        { id: 'a1', wellbore_id: ACTIVE_WELLBORE_ID, severity: 'critical', state: 'sent' },
        { id: 'a2', wellbore_id: ACTIVE_WELLBORE_ID, severity: 'watch', state: 'viewed' },
        { id: 'a3', wellbore_id: ACTIVE_WELLBORE_ID, severity: 'watch', state: 'generated' },
        { id: 'a4', wellbore_id: ACTIVE_WELLBORE_ID, severity: 'warning', state: 'resolved' }, // not open
      ]),
      http.get(`${REST}/stream_state`, () =>
        HttpResponse.json([{ wellbore_id: ACTIVE_WELLBORE_ID, status: 'stale', bit_md_m: 1234.5, last_sample_at: new Date(Date.now() - 120000).toISOString() }]),
      ),
    );
    renderPage();
    const card = (await screen.findAllByTestId('drilling-well-card'))[0];
    await waitFor(() => expect(within(card).getByTestId('bit-depth').textContent).toBe('1234.5 m'));
    const pill = within(card).getByTestId('stream-status');
    expect(pill.dataset.status).toBe('stale');
    expect(pill.textContent).toMatch(/stale/);
    expect(pill.textContent).toMatch(/last data 2 minutes ago/);

    const chips = await within(card).findByTestId('alert-counts');
    expect(within(chips).getByText('1 Critical')).toBeTruthy();
    expect(within(chips).getByText('2 Watch')).toBeTruthy();
    expect(within(chips).queryByText(/Warning/)).toBeNull(); // the resolved one is not counted
    expect(card.textContent).toContain(ACTIVE_WELL.top_risk_type === 'losses' ? 'Mud losses' : '');
  });

  it('table has an NPT total column and provenance badges', async () => {
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'NPT total' })).toBeTruthy();
    const first = wellsFixture.find((w) => w.status === 'drilling');
    const row = within(screen.getByTestId('wells-table-body')).getByText(first.well_name).closest('tr');
    expect(within(row).getByText(`${first.npt_h_total.toFixed(1)} h`)).toBeTruthy();
    expect(within(row).getByTestId('provenance-badge').textContent).toBe(first.provenance.toUpperCase());
  });

  it('search filters the table', async () => {
    renderPage();
    await screen.findAllByTestId('drilling-well-card');
    const target = wellsFixture.find((w) => w.status !== 'drilling');
    fireEvent.change(screen.getByLabelText('Search wells'), { target: { value: target.well_name.toLowerCase() } });
    const rows = within(screen.getByTestId('wells-table-body')).getAllByRole('row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText(target.well_name)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search wells'), { target: { value: 'zzz-no-such-well' } });
    expect(screen.getByText(/No wells match/)).toBeTruthy();
  });

  it('stream_state changes over Realtime update the card', async () => {
    renderPage();
    const card = (await screen.findAllByTestId('drilling-well-card'))[0];
    await waitFor(() => expect(within(card).getByTestId('stream-status').dataset.status).toBe('live'));
    act(() => {
      db.emitChange('stream_state', { wellbore_id: ACTIVE_WELLBORE_ID, status: 'lost', bit_md_m: 2500, last_sample_at: new Date(Date.now() - 3600000).toISOString() });
    });
    await waitFor(() => expect(within(card).getByTestId('stream-status').dataset.status).toBe('lost'));
    expect(within(card).getByTestId('bit-depth').textContent).toBe('2500.0 m');
  });

  it('shows an error state with a retry button, and recovers', async () => {
    let fail = true;
    server.use(
      http.get(`${REST}/v_well_summary`, () => {
        if (fail) return HttpResponse.json({ message: 'boom' }, { status: 500 });
        return HttpResponse.json(wellsFixture);
      }),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findAllByTestId('drilling-well-card')).length).toBeGreaterThan(0);
  });

  it('shows empty states when nothing is drilling / no wells', async () => {
    server.use(http.get(`${REST}/v_well_summary`, () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/No wells are drilling right now/)).toBeTruthy();
    expect(screen.getByText('No wells yet.')).toBeTruthy();
  });
});

describe('ProvenanceBadge', () => {
  it('renders the word in caps for each provenance and nothing when missing', () => {
    const { container, rerender } = renderRoute(<ProvenanceBadge provenance="synthetic" />);
    expect(container.textContent).toBe('SYNTHETIC');
    expect(screen.getByTestId('provenance-badge').className).toMatch(/border-purple/);
    rerender(<ProvenanceBadge provenance="analog" />);
    expect(screen.getByTestId('provenance-badge').textContent).toBe('ANALOG');
    rerender(<ProvenanceBadge provenance="direct" />);
    expect(screen.getByTestId('provenance-badge').textContent).toBe('DIRECT');
    rerender(<ProvenanceBadge provenance={null} />);
    expect(screen.queryByTestId('provenance-badge')).toBeNull();
  });
});

describe('fixtures', () => {
  it('use enum-valid statuses and provenances', () => {
    wellsFixture.forEach((w) => {
      expect(['planned', 'drilling', 'completed']).toContain(w.status);
      expect(['direct', 'analog', 'synthetic']).toContain(w.provenance);
    });
  });
});

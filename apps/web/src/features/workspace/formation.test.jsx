import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { FormationTab } from './FormationTab';
import { createServer, renderRoute, allowRelativeFetch, resetMocks, REST } from '../wells/testHarness';
import { ACTIVE_WELLBORE_ID } from '../../mocks/ids';
import lessons from '../../mocks/fixtures/lessons.json';
import { useProfile } from '../auth/useProfile';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('../wells/testHarness')).createTestSupabase() }));
vi.mock('../auth/useProfile', () => ({ useProfile: vi.fn(() => ({ profile: { role: 'rtoc_engineer' } })) }));

const server = createServer();
let restoreFetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  restoreFetch = allowRelativeFetch();
});
beforeEach(() => resetMocks());
afterEach(() => server.resetHandlers());
afterAll(() => {
  restoreFetch();
  server.close();
});

const renderTab = () => renderRoute(<FormationTab />, { path: '/wells/:wellboreId/formation', route: `/wells/${ACTIVE_WELLBORE_ID}/formation` });

describe('FormationTab', () => {
  it('shows the current and next formation at the bit depth (RPC formation_at_md)', async () => {
    renderTab();
    const cur = await screen.findByTestId('formation-current');
    expect(within(cur).getByText('Barail')).toBeTruthy();
    expect(within(cur).getByText('Kopili')).toBeTruthy();
    expect(cur.textContent).toMatch(/\d+\.\d m ahead/);
    expect(screen.getByText('Using the current bit depth.')).toBeTruthy();
    // typing another depth re-runs the lookup
    fireEvent.change(screen.getByLabelText('Depth (MD, m)'), { target: { value: '3300' } });
    await waitFor(() => expect(within(screen.getByTestId('formation-current')).getByText('Langpar')).toBeTruthy());
  });

  it('lists tops with their source and uncertainty (actual, prognosis, predicted)', async () => {
    renderTab();
    const table = await screen.findByTestId('tops-table');
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(5));
    const sources = new Set(within(table).getAllByRole('row').slice(1).map((r) => r.dataset.source));
    expect([...sources].sort()).toEqual(['actual', 'predicted', 'prognosis']);
    const predicted = within(table).getAllByRole('row').find((r) => r.dataset.source === 'predicted');
    expect(predicted.textContent).toMatch(/±/);
  });

  it('offset events are limited to the current and next formation and come from events_for_offsets', async () => {
    let body;
    server.use(
      http.post(`${REST}/rpc/events_for_offsets`, async ({ request }) => {
        body = await request.clone().json();
        return undefined; // fall through to the mock handler
      }),
    );
    renderTab();
    const table = await screen.findByTestId('events-table');
    expect(body.p_formations).toEqual(['Barail', 'Kopili']);
    expect(body.p_wellbore).toBe(ACTIVE_WELLBORE_ID);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(['Barail', 'Kopili']).toContain(within(r).getAllByRole('cell')[1].textContent));
    // radius select re-queries
    fireEvent.change(screen.getByLabelText('Offset radius'), { target: { value: '5000' } });
    await waitFor(() => expect(body.p_radius_m).toBe(5000));
  });

  it('shows lessons for the current and next formation', async () => {
    renderTab();
    const box = await screen.findByTestId('lessons');
    const expected = lessons.filter((l) => ['Barail', 'Kopili'].includes(l.formation));
    expect(within(box).getAllByRole('article')).toHaveLength(expected.length);
    expected.forEach((l) => expect(within(box).getByText(l.title)).toBeTruthy());
  });

  it('Predict tops posts to /api/wells/{id}/predict-tops and reports the result (rtoc/office/admin only)', async () => {
    let called = 0;
    server.use(
      http.post('/api/wells/:id/predict-tops', async ({ params, request }) => {
        called += 1;
        expect(params.id).toBe(ACTIVE_WELLBORE_ID);
        expect(await request.json()).toEqual({ radius_m: 10000 });
        return HttpResponse.json({ tops: [{ formation: 'Kopili', top_md_m: 2900, uncertainty_m: 20, n_offsets: 5 }] });
      }),
    );
    renderTab();
    const btn = await screen.findByRole('button', { name: /Predict tops/ });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText(/Predicted 1 tops from the offsets within 10 km/)).toBeTruthy();
    expect(called).toBe(1);
  });

  it('Predict tops is disabled for roles that may not call it', async () => {
    useProfile.mockReturnValue({ profile: { role: 'rig_engineer' } });
    renderTab();
    const btn = await screen.findByRole('button', { name: /Predict tops/ });
    expect(btn.disabled).toBe(true);
    useProfile.mockReturnValue({ profile: { role: 'rtoc_engineer' } });
  });

  it('shows an empty state when the well has no tops at the depth', async () => {
    server.use(http.post(`${REST}/rpc/formation_at_md`, () => HttpResponse.json([])));
    renderTab();
    expect(await screen.findByText(/No formation tops known at/)).toBeTruthy();
    expect(screen.getByText(/Choose a depth with known formation tops/)).toBeTruthy();
  });
});

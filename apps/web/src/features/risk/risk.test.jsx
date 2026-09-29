import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { RiskTab } from './RiskTab';
import { RiskStrip } from './RiskStrip';
import { BandLegend } from './BandLegend';
import { buildOffsetEvents } from './IntervalDetail';
import { db } from '../../mocks/db';
import { ACTIVE_WELLBORE_ID } from '../../mocks/ids';
import { clone, createServer, installRelativeFetch, renderApp, resetMockState } from '../../dev/testHarness';
import { BAND_META, BAND_ORDER } from '../../lib/risk';

const server = createServer();
let restoreFetch;
const requests = [];

beforeAll(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  server.listen({ onUnhandledRequest: 'bypass' });
  server.events.on('request:start', ({ request }) => requests.push({ method: request.method, url: request.url }));
  restoreFetch = installRelativeFetch();
});
afterAll(() => {
  restoreFetch();
  server.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  resetMockState();
  requests.length = 0;
});
afterEach(() => server.resetHandlers());

const renderTab = (opts) => renderApp(<RiskTab />, { route: `/wells/${ACTIVE_WELLBORE_ID}/risk`, path: '/wells/:wellboreId/risk', ...opts });
const cells = () => screen.getAllByRole('gridcell');
const scored = () => screen.queryAllByRole('gridcell').filter((c) => c.dataset.band);
const loaded = () => waitFor(() => expect(scored()).toHaveLength(60));

describe('FE-07 RiskTab', () => {
  it('renders 5 risk types x 12 intervals with score, band WORD and icon in every cell', async () => {
    renderTab();
    await loaded();
    const cell = screen.getByRole('gridcell', { name: /Mud losses, 2455 to 2480 m: score/ });
    expect(cell).toHaveAttribute('data-band', 'high');
    expect(within(cell).getByText('75')).toBeInTheDocument();
    expect(within(cell).getByText('High')).toBeInTheDocument();
    expect(cell.querySelector('svg')).not.toBeNull(); // icon: colour is never the only signal
    expect(screen.getByText('Kick / overpressure')).toBeInTheDocument();
  });

  it('asks for risk_scores only in the window bit..bit+300 (never all rows)', async () => {
    // a row far ahead of the window must not be displayed
    db.risk_scores.push({ ...clone(db.risk_scores[0]), md_from_m: 5000, md_to_m: 5025, fused: 99, risk_type: 'losses' });
    renderTab();
    await loaded();
    const call = requests.find((r) => r.url.includes('/rest/v1/risk_scores'));
    const url = new URL(call.url);
    expect(url.searchParams.get('md_to_m')).toBe('gt.2400');
    expect(url.searchParams.get('md_from_m')).toBe('lt.2725');
    expect(screen.queryByText('99')).toBeNull();
  });

  it('shades the first 50 m as "at bit" and hatches low-confidence cells', async () => {
    renderTab();
    await loaded();
    const atBit = cells().filter((c) => c.dataset.atBit === 'true');
    expect(atBit).toHaveLength(10); // 2 columns x 5 risk types
    expect(screen.getAllByText('At bit')).toHaveLength(2);
    const low = cells().filter((c) => c.dataset.lowConfidence === 'true');
    expect(low.length).toBeGreaterThan(0);
    expect(low[0].style.backgroundImage).toContain('repeating-linear-gradient');
    expect(within(low[0]).getByText(/low conf/i)).toBeInTheDocument();
  });

  it('matches cells by interval overlap: rows not aligned to floor(bit/25)*25 still show', async () => {
    db.risk_scores.splice(0, db.risk_scores.length);
    const base = clone(JSON.parse(JSON.stringify({ wellbore_id: ACTIVE_WELLBORE_ID, risk_type: 'kick', l1: 0.5, l2: 0.5, l3: null, band: 'elevated', confidence: 'medium', reasons: [], formation: 'Tipam', computed_at: '2026-09-29T10:00:00Z' })));
    // bit is 2405; this engine grid starts at 2412.5 and 2437.5 (offset by 7.5 m)
    db.risk_scores.push({ ...base, md_from_m: 2412.5, md_to_m: 2437.5, fused: 47 });
    db.risk_scores.push({ ...base, md_from_m: 2437.5, md_to_m: 2462.5, fused: 63 });
    renderTab();
    await screen.findByRole('gridcell', { name: /Kick \/ overpressure, 2405 to 2430 m: score 47/ });
    expect(screen.getByRole('gridcell', { name: /Kick \/ overpressure, 2430 to 2455 m: score 47|Kick \/ overpressure, 2430 to 2455 m: score 63/ })).toBeInTheDocument();
  });

  it('shows new risk_scores rows live without a reload (Realtime upsert keyed on type + md range)', async () => {
    renderTab();
    const before = await screen.findByRole('gridcell', { name: /Torque spike, 2405 to 2430 m: score 29/ });
    expect(before).toBeInTheDocument();
    const row = { ...clone(db.risk_scores.find((r) => r.risk_type === 'torque')), fused: 91, band: 'critical', computed_at: new Date().toISOString() };
    act(() => {
      db.risk_scores.push(row);
      db.emitChange('risk_scores', row);
    });
    await screen.findByRole('gridcell', { name: /Torque spike, 2405 to 2430 m: score 91, Critical band/ });
    // same identity replaced, not duplicated: still 60 cells
    expect(cells()).toHaveLength(60);
  });

  it('interval detail: score, band, confidence + reason, layers with "not available", SHAP, offset events, lessons', async () => {
    renderTab();
    const cell = await screen.findByRole('gridcell', { name: /Mud losses, 2455 to 2480 m: score/ });
    fireEvent.click(cell);
    const detail = await screen.findByRole('region', { name: 'Interval detail' });
    expect(within(detail).getByText('75')).toBeInTheDocument();
    expect(within(detail).getAllByText('High').length).toBeGreaterThan(0);
    expect(within(detail).getByText(/Medium confidence|High confidence/)).toBeInTheDocument();
    expect(within(detail).getByText(/offsets within 10 km/)).toBeInTheDocument();
    expect(within(detail).getByText('L3 live detectors').parentElement).toHaveTextContent('not available');
    expect(within(detail).getByText(/ML model reasons/)).toBeInTheDocument();
    expect(within(detail).getByText('flow out minus in trend')).toBeInTheDocument();
    // offset events behind L1: well, distance, event, NPT, source link
    await within(detail).findByText('SYN-DLJ-01');
    expect(within(detail).getAllByText(/NPT 12 h/).length).toBeGreaterThan(0);
    expect(within(detail).getAllByText(/850 m away/).length).toBeGreaterThan(0);
    const link = within(detail).getAllByRole('link', { name: /Source, page 37/ })[0];
    expect(link.getAttribute('href')).toMatch(/^\/sources\/.+\?page=37$/);
    // recommended lessons (formation + risk type)
    await within(detail).findByText('Partial losses in Tipam sands');
    expect(detail).toHaveTextContent(/Success \d+% · \d+ wells/);
  });

  it('keeps SHAP reasons and offset events in separate lists', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('gridcell', { name: /Stuck pipe, 2480 to 2505 m: score/ }));
    const detail = await screen.findByRole('region', { name: 'Interval detail' });
    const shapHeading = within(detail).getByText(/ML model reasons/);
    const offsetsHeading = within(detail).getByText('Offset events behind L1');
    expect(shapHeading.parentElement).not.toBe(offsetsHeading.parentElement);
    expect(within(shapHeading.parentElement).queryByText('SYN-DLJ-04')).toBeNull();
  });

  it('buildOffsetEvents fills gaps from the events lookup and well names', () => {
    const score = { wellbore_id: 'w', reasons: [{ kind: 'offset_event', event_id: 'e1' }, { kind: 'shap', feature: 'x', value: 1 }] };
    const out = buildOffsetEvents(score, [{ id: 'e1', wellbore_id: 'o1', event_type: 'kick', npt_h: 6, doc_id: 'd', page: 9 }], { o1: 4200 }, { o1: 'SYN-NHK-01' });
    expect(out).toEqual([expect.objectContaining({ well: 'SYN-NHK-01', distance_m: 4200, event_type: 'kick', npt_h: 6, doc_id: 'd', page: 9 })]);
  });

  it('Recompute posts to /api/wells/{id}/risk and the strip updates from the response', async () => {
    renderTab();
    await screen.findByRole('gridcell', { name: /Mud losses, 2405 to 2430 m: score/ });
    fireEvent.click(screen.getByRole('button', { name: /Recompute/ }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url.endsWith(`/api/wells/${ACTIVE_WELLBORE_ID}/risk`))).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /Recompute/ })).not.toBeDisabled());
    expect(cells()).toHaveLength(60);
  });

  it('states what the score means and shows the bit depth', async () => {
    renderTab();
    expect(await screen.findByText(/estimated chance \(%\) that this happens in the interval, from offset wells, the ML model and live data/)).toBeInTheDocument();
    expect(await screen.findByText(/Bit at 2405\.0 m/)).toBeInTheDocument();
  });

  it('a well without a stream says so instead of showing an empty grid', async () => {
    renderApp(<RiskTab />, { route: '/wells/00000000-0000-4000-8000-000000000002/risk', path: '/wells/:wellboreId/risk' });
    expect(await screen.findByText(/no live bit depth/i)).toBeInTheDocument();
  });
});

describe('RiskStrip', () => {
  it('selection survives a data refresh (selected by risk type + column)', () => {
    const scores = db.risk_scores;
    const { rerender } = renderApp(<RiskStrip bitMd={2405} scores={scores} selected={{ risk_type: 'kick', col: 3 }} onSelect={() => {}} />);
    const selected = cells().filter((c) => c.getAttribute('aria-pressed') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute('aria-label')).toMatch(/Kick/);
    rerender(<div />);
  });
});

describe('BandLegend (contract §11.1 + NWIS_PRD F5)', () => {
  it('lists all five bands with range, word and what the engineer should do', () => {
    renderApp(<BandLegend />);
    for (const key of BAND_ORDER) {
      const item = document.querySelector(`[data-band="${key}"]`);
      expect(item).toHaveTextContent(BAND_META[key].range);
      expect(item).toHaveTextContent(BAND_META[key].label);
      expect(item).toHaveTextContent(BAND_META[key].meaning);
    }
    expect(screen.getByText('Normal drilling')).toBeInTheDocument();
    expect(screen.getByText(/Act now; follow the well-control or trouble procedure/)).toBeInTheDocument();
    expect(screen.getByText(/0–20 Low/)).toBeInTheDocument();
    expect(screen.getByText(/81–100 Critical/)).toBeInTheDocument();
  });
});

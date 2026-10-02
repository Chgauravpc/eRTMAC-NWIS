import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import { BriefView, groupLessonsByFormation, provenanceSummary } from './BriefView';
import { createServer, renderRoute } from '../wells/testHarness';
import wellsFixture from '../../mocks/fixtures/wells.json';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('../wells/testHarness')).createTestSupabase() }));
// Leaflet needs a real layout engine; the brief's tables and notes are what is under test here.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Circle: () => null,
  Marker: ({ children }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }) => <span>{children}</span>,
}));

const server = createServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const A = wellsFixture[0];
const B = wellsFixture[1];
const DATA = {
  location: { lat: 27.35, lon: 95.3 },
  offsets: [
    { wellbore_id: A.wellbore_id, well_name: A.well_name, surface_distance_m: 2140 },
    { wellbore_id: B.wellbore_id, well_name: B.well_name, surface_distance_m: 800 },
  ],
  predicted_tops: [{ formation: 'Tipam', top_md_m: 2300.4, uncertainty_m: 35, n_offsets: 4 }],
  risk_profile: [],
  lessons: [
    { id: 'l1', formation: 'Tipam', title: 'Pre-treat with LCM', mitigation: 'Pump a pill', well_count: 4 },
    { id: 'l2', formation: 'Barail', title: 'Keep rotating', mitigation: 'Circulate before connections', well_count: 1 },
    { id: 'l3', formation: 'Tipam', title: 'Limit pump rate', mitigation: 'Cut the rate', well_count: 2 },
  ],
};

describe('brief helpers', () => {
  it('groups lessons by formation in order of first appearance', () => {
    expect(groupLessonsByFormation(DATA.lessons).map(([f, l]) => [f, l.length])).toEqual([['Tipam', 2], ['Barail', 1]]);
    expect(groupLessonsByFormation(null)).toEqual([]);
  });

  it('counts offsets by provenance and ignores unknown wells', () => {
    const prov = { a: 'synthetic', b: 'synthetic', c: 'direct' };
    expect(provenanceSummary([{ wellbore_id: 'a' }, { wellbore_id: 'b' }, { wellbore_id: 'c' }, { wellbore_id: 'zz' }], prov)).toEqual({
      text: '2 synthetic, 1 direct',
      kinds: ['synthetic', 'direct'],
    });
    expect(provenanceSummary([], prov).text).toBeNull();
  });
});

describe('BriefView', () => {
  const render = () => renderRoute(<BriefView data={DATA} requestParams={{ planned_td_m: 3600, radius_m: 10000 }} />);

  it('has the print header, the location, the date and a provenance note', async () => {
    render();
    expect(screen.getByRole('heading', { name: 'NWIS Offset Risk Brief' })).toBeInTheDocument();
    expect(screen.getByText(/27\.3500°, 95\.3000°/)).toBeInTheDocument();
    expect(screen.getByText(/Planned TD 3600 m/)).toBeInTheDocument();
    const note = screen.getByTestId('provenance-note');
    await waitFor(() => expect(note.textContent).toMatch(/Based on 2 offset wells \(/));
    expect(note.textContent).toMatch(/decision support/);
  });

  it('lists the offsets in a table and the predicted tops with the number of offsets behind each', () => {
    render();
    const offsets = within(screen.getByTestId('offsets-table'));
    expect(offsets.getByText(A.well_name)).toBeInTheDocument();
    expect(offsets.getByText('2.1 km')).toBeInTheDocument();
    expect(offsets.getByText('800 m')).toBeInTheDocument();
    const tops = within(screen.getByTestId('tops-table'));
    expect(tops.getByRole('columnheader', { name: 'Offsets' })).toBeInTheDocument();
    expect(tops.getByText('2300')).toBeInTheDocument();
    expect(tops.getByText('35 m')).toBeInTheDocument();
    expect(tops.getByText('4')).toBeInTheDocument();
  });

  it('shows lessons under their formation, with the number of wells (not events)', () => {
    render();
    const tipam = within(screen.getByTestId('lessons-Tipam'));
    expect(tipam.getByText('Pre-treat with LCM')).toBeInTheDocument();
    expect(tipam.getByText('Limit pump rate')).toBeInTheDocument();
    expect(tipam.getByText('Seen in 4 offset wells')).toBeInTheDocument();
    expect(within(screen.getByTestId('lessons-Barail')).getByText('Seen in 1 offset well')).toBeInTheDocument();
  });

  it('says what to do when there are no offsets', () => {
    renderRoute(<BriefView data={{ ...DATA, offsets: [], predicted_tops: [], lessons: [] }} requestParams={{ planned_td_m: 3000, radius_m: 5000 }} />);
    expect(screen.getByText(/No offset wells within 5\.0 km\. Widen the radius\./)).toBeInTheDocument();
    expect(screen.getByText(/Not enough offset wells/)).toBeInTheDocument();
    expect(screen.getByText(/No lessons are recorded/)).toBeInTheDocument();
  });
});

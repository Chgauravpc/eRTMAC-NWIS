import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { AnalyticsPage } from './AnalyticsPage';

const h = vi.hoisted(() => ({ views: {}, charts: [] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (name) => ({
      select: () => Promise.resolve(h.views[name] ?? { data: [], error: null }),
    }),
  },
}));
// Plotly needs a real canvas; what is under test is the data handed to each chart.
vi.mock('../correlation/PlotlyChart', () => ({
  default: (props) => {
    h.charts.push(props);
    return <div data-testid="chart" data-traces={props.data.length} />;
  },
}));

const WELLS = [
  { wellbore_id: 'a', field: 'Field A', provenance: 'synthetic', event_count: 4, npt_h_total: 30 },
  { wellbore_id: 'b', field: 'Field A', provenance: 'direct', event_count: 1, npt_h_total: 5 },
  { wellbore_id: 'c', field: 'Field B', provenance: 'direct', event_count: 2, npt_h_total: 12 },
];
const NPT = [
  { formation: 'Tipam', risk_type: 'losses', event_count: 3, npt_h_total: 20 },
  { formation: 'Tipam', risk_type: 'cementing', event_count: 1, npt_h_total: 5 },
  { formation: 'Barail', risk_type: 'stuck_pipe', event_count: 3, npt_h_total: 22 },
];

beforeEach(() => {
  h.charts.length = 0;
  h.views = { v_well_summary: { data: WELLS, error: null }, v_npt_by_formation: { data: NPT, error: null } };
});

describe('AnalyticsPage', () => {
  it('shows the totals, both tables and both charts', async () => {
    render(<AnalyticsPage />);
    expect(await screen.findAllByTestId('chart')).toHaveLength(2);
    expect(screen.getByText('Total NPT (hours)').nextSibling).toHaveTextContent('47');
    const field = within(screen.getByTestId('field-table'));
    expect(field.getByText('Field A')).toBeInTheDocument();
    const formation = within(screen.getByTestId('formation-table'));
    // largest NPT first: Barail 22 h, Tipam 25 h -> Tipam first
    const rows = formation.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Tipam')).toBeInTheDocument();
    expect(within(rows[0]).getByText('25')).toBeInTheDocument();
  });

  it('chart 2 plots the number of events per field (PRD), not NPT', async () => {
    render(<AnalyticsPage />);
    await screen.findAllByTestId('chart');
    const events = h.charts.find((c) => c.data[0].name === 'Events');
    expect(events.data[0].x).toEqual(['Field A', 'Field B']);
    expect(events.data[0].y).toEqual([5, 2]);
  });

  it('chart 1 is stacked by risk type with one trace per type', async () => {
    render(<AnalyticsPage />);
    await screen.findAllByTestId('chart');
    const stacked = h.charts.find((c) => c.layout.barmode === 'stack');
    expect(stacked.data).toHaveLength(5);
    expect(stacked.data[0].x).toEqual(['Tipam', 'Barail']);
    expect(stacked.data.find((t) => t.name === 'Mud losses').y).toEqual([20, 0]);
  });

  it('filters the field data by provenance and says that chart 1 is not filtered', async () => {
    render(<AnalyticsPage />);
    await screen.findAllByTestId('chart');
    fireEvent.change(screen.getByLabelText('Provenance'), { target: { value: 'direct' } });
    expect(screen.getByText('Total NPT (hours)').nextSibling).toHaveTextContent('17');
    const field = within(screen.getByTestId('field-table'));
    expect(field.getByText('Field B')).toBeInTheDocument();
    expect(screen.getByText('Direct wells only.')).toBeInTheDocument();
    expect(screen.getByTestId('formation-note')).toHaveTextContent(/does not apply to it/);
  });

  it('shows empty states instead of empty charts', async () => {
    h.views = { v_well_summary: { data: [], error: null }, v_npt_by_formation: { data: [], error: null } };
    render(<AnalyticsPage />);
    expect(await screen.findByText(/No events with NPT are recorded yet/)).toBeInTheDocument();
    expect(screen.getByText('No data for the selected filter.')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).toBeNull();
  });

  it('shows an error with a retry that loads the data', async () => {
    h.views = { v_well_summary: { data: null, error: { message: 'relation "v_well_summary" does not exist' } }, v_npt_by_formation: { data: [], error: null } };
    render(<AnalyticsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('v_well_summary');
    h.views = { v_well_summary: { data: WELLS, error: null }, v_npt_by_formation: { data: NPT, error: null } };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('chart')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { buildCorrelationFigure, buildTraces, xRef, yRef } from './traceBuilder';
import { CorrelationControls } from './CorrelationControls';
import { CorrelationTab } from './CorrelationTab';
import {
  ALL_CHANNELS,
  DEFAULT_CHANNELS,
  defaultFlattenFormation,
  defaultOffsetIds,
  flattenWarning,
  formationsFromTops,
} from './correlationModel';
import { riskColor } from '../workspace/mapGeo';
import { createServer, renderRoute, allowRelativeFetch, resetMocks } from '../wells/testHarness';
import { ACTIVE_WELLBORE_ID, MOCK_WELLS } from '../../mocks/ids';
import { buildCorrelation } from '../../mocks/handlers/wells';
import { offsetsWithin } from '../../mocks/handlers/geo';

vi.hoisted(() => vi.stubEnv('VITE_USE_MOCKS', 'true'));
const plot = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../lib/supabase', async () => ({ supabase: await (await import('../wells/testHarness')).createTestSupabase() }));
vi.mock('./PlotlyChart', () => ({
  default: (props) => {
    plot.calls.push(props);
    return <div data-testid="plotly-stub" data-traces={props.data.length} />;
  },
}));

const server = createServer();
let restoreFetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  restoreFetch = allowRelativeFetch();
});
beforeEach(() => {
  resetMocks();
  plot.calls.length = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  restoreFetch();
  server.close();
});

/* ------------------------------------------------------------------ pure trace transformation */

const activeWell = {
  wellbore_id: 'w-active',
  name: 'Active',
  is_active: true,
  shift_m: 0,
  tops: [
    { formation: 'Tipam', top_md_m: 1700, source: 'actual', uncertainty_m: null },
    { formation: 'Kopili', top_md_m: 2870, source: 'predicted', uncertainty_m: 25 },
  ],
  casing: [{ casing_od_in: 9.625, shoe_md_m: 2280 }],
  events: [
    { id: 'e1', event_type: 'loss_partial', md_from_m: 2100, severity: 3, description: 'Partial losses', provenance: 'synthetic' },
    { id: 'e2', event_type: 'kick', md_from_m: 2390, severity: 4, description: 'Gas kick', source: 'DDR 12' },
    { id: 'e3', event_type: 'fishing', md_from_m: 2000, severity: 2, description: 'Fish' },
    { id: 'e4', event_type: 'loss_total', md_from_m: 2600, severity: 5, description: 'Below the bit' },
  ],
  tracks: { md_m: [2300, 2350, 2400, 2450, 2500], gr_api: [60, 70, 80, 90, 100], rop_m_h: [10, 11, 12, 13, 14] },
};
const offsetWell = {
  wellbore_id: 'w-off',
  name: 'Offset',
  is_active: false,
  shift_m: -42,
  flatten_missing: false,
  tops: [
    { formation: 'Kopili', top_md_m: 2912, source: 'actual', uncertainty_m: null },
    { formation: 'Sylhet', top_md_m: 3200, source: 'prognosis', uncertainty_m: null },
  ],
  casing: [{ casing_od_in: 13.375, shoe_md_m: 700 }],
  events: [{ id: 'e5', event_type: 'stuck_pipe_mech', md_from_m: 2500, severity: 3, description: 'Stuck', provenance: 'direct' }],
  tracks: { md_m: [2500, 2600], gr_api: [50, 55], rop_m_h: [8, 9] },
};
const missingWell = { ...offsetWell, wellbore_id: 'w-miss', name: 'Missing', shift_m: 0, flatten_missing: true };
const response = (wells, flatten = 'Kopili') => ({ flatten_formation: flatten, wells });

describe('buildCorrelationFigure', () => {
  const figure = buildCorrelationFigure(response([activeWell, offsetWell]), ['gr_api', 'rop_m_h'], { bitMd: 2405 });
  const { traces, layout, meta } = figure;
  const byName = (n) => traces.find((t) => t.name === n);

  it('uses valid Plotly axis names (x / xaxis for the first axis, no "1"), no grid and no deprecated titlefont', () => {
    expect(xRef(1)).toBe('x');
    expect(yRef(1)).toBe('y');
    expect(xRef(2)).toBe('x2');
    expect(layout.xaxis).toBeTruthy();
    expect(layout.yaxis).toBeTruthy();
    expect(layout.xaxis2).toBeTruthy();
    expect(Object.keys(layout).filter((k) => /axis1$/.test(k))).toEqual([]);
    expect(layout.grid).toBeUndefined();
    expect(JSON.stringify(layout)).not.toMatch(/titlefont/);
    expect(byName('Active gr_api').xaxis).toBe('x2');
    expect(byName('Active gr_api').yaxis).toBe('y2');
    // 2 wells x (1 marker track + 2 channels) = 6 axes, all sharing the reversed depth axis
    for (let n = 1; n <= 6; n++) {
      const y = layout[`yaxis${n === 1 ? '' : n}`];
      expect(y).toBeTruthy();
      expect(y.autorange).toBe('reversed');
      if (n > 1) expect(y.matches).toBe('y');
    }
    // domains stay inside [0,1] and do not overlap between tracks
    const domains = Object.entries(layout).filter(([k]) => k.startsWith('xaxis')).map(([, v]) => v.domain).sort((a, b) => a[0] - b[0]);
    domains.forEach(([a, b]) => { expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1.0001); });
    domains.slice(1).forEach(([a], i) => expect(a).toBeGreaterThanOrEqual(domains[i][1] - 1e-9));
    expect(typeof layout.xaxis2.title.text).toBe('string');
  });

  it('plots the shifted depth (MD + shift_m) on y and keeps the true MD in customdata and the hover text', () => {
    const t = byName('Offset gr_api');
    expect(t.x).toEqual([50, 55]);
    expect(t.y).toEqual([2458, 2558]);
    expect(t.customdata).toEqual([2500, 2600]);
    expect(t.hovertemplate).toContain('True MD %{customdata:.1f} m');
    expect(t.hovertemplate).toContain('Shifted depth %{y:.1f} m');
    expect(buildTraces).toBe(buildCorrelationFigure);
  });

  it('draws formation tops as lines with labels on each well own y axis; predicted are dashed with an uncertainty band', () => {
    const lines = layout.shapes.filter((s) => s.type === 'line' && s.name.endsWith(' top'));
    const kopiliActive = lines.find((s) => s.name === 'Active Kopili top');
    const tipamActive = lines.find((s) => s.name === 'Active Tipam top');
    expect(kopiliActive.line.dash).toBe('dash');
    expect(tipamActive.line.dash).toBe('solid');
    expect(kopiliActive.y0).toBe(2870);
    expect(kopiliActive.yref).toBe('y'); // active well marker track = first axis
    const kopiliOffset = lines.find((s) => s.name === 'Offset Kopili top');
    expect(kopiliOffset.y0).toBe(2912 - 42); // shifted so that it lines up with the active well
    expect(kopiliOffset.y0).toBe(kopiliActive.y0);
    expect(kopiliOffset.yref).toBe('y4'); // per-well axis, not 'y' for everybody
    expect(kopiliOffset.line.dash).toBe('solid');
    expect(lines.find((s) => s.name === 'Offset Sylhet top').line.dash).toBe('dot'); // prognosis
    const band = layout.shapes.find((s) => s.type === 'rect');
    expect([band.y0, band.y1]).toEqual([2870 - 25, 2870 + 25]);
    expect(layout.shapes.filter((s) => s.type === 'rect')).toHaveLength(1); // only predicted tops get bands
    const labels = layout.annotations.map((a) => a.text);
    expect(labels).toContain('Tipam');
    expect(labels).toContain('Kopili (pred ±25)');
    expect(labels).toContain('Sylhet (prog)');
  });

  it('colours events by risk type via EVENT_TO_RISK, hover has type, true MD, description and source', () => {
    const ev = byName('Active events');
    // loss_partial -> losses, kick -> kick, fishing -> not scored (grey); the event below the bit is dropped
    expect(ev.marker.color).toHaveLength(3);
    const colours = Object.fromEntries(ev.text.map((t, i) => [t.match(/<b>(.*?)<\/b>/)[1], ev.marker.color[i]]));
    expect(colours['loss partial']).toBe(riskColor('losses'));
    expect(colours.kick).toBe(riskColor('kick'));
    expect(colours.fishing).toBe('#6b7280');
    expect(colours['loss partial']).not.toBe('#6b7280');
    expect(ev.customdata).not.toContain(2600);
    const i = ev.customdata.indexOf(2390);
    expect(ev.text[i]).toContain('True MD 2390 m');
    expect(ev.text[i]).toContain('Gas kick');
    expect(ev.text[i]).toContain('Source: DDR 12');
    expect(ev.text[ev.customdata.indexOf(2100)]).toContain('Source: synthetic');
    const off = byName('Offset events');
    expect(off.y).toEqual([2500 - 42]);
    expect(off.marker.color).toEqual([riskColor('stuck_pipe')]);
  });

  it('draws casing shoes as triangles at the shifted depth with the true MD in the hover', () => {
    const c = byName('Offset casing');
    expect(c.marker.symbol).toBe('triangle-down');
    expect(c.y).toEqual([700 - 42]);
    expect(c.text[0]).toContain('True MD 700 m');
    expect(byName('Active casing').y).toEqual([2280]);
  });

  it('active well: tracks never go below the bit, and a labelled bit line is drawn', () => {
    const t = byName('Active gr_api');
    expect(Math.max(...t.customdata)).toBeLessThanOrEqual(2405);
    expect(t.customdata).toEqual([2300, 2350, 2400]);
    expect(t.y).toEqual([2300, 2350, 2400]);
    const bit = layout.shapes.find((s) => s.name === 'bit');
    expect(bit.y0).toBe(2405);
    expect(bit.line.color).toBe('#b91c1c');
    expect(layout.annotations.some((a) => a.text === 'Bit 2405 m')).toBe(true);
    // without a bit nothing is clipped and there is no bit line
    const free = buildCorrelationFigure(response([activeWell]), ['gr_api']);
    expect(free.traces.find((x) => x.name === 'Active gr_api').y).toHaveLength(5);
    expect(free.layout.shapes.some((s) => s.name === 'bit')).toBe(false);
  });

  it('flags wells without the flatten formation (flatten_missing) and leaves them unshifted', () => {
    const f = buildCorrelationFigure(response([activeWell, missingWell]), ['gr_api']);
    expect(f.meta.flattenMissing).toEqual(['Missing']);
    expect(f.traces.find((t) => t.name === 'Missing gr_api').y).toEqual([2500, 2600]);
    expect(f.layout.annotations.some((a) => a.text.includes('⚠ no Kopili'))).toBe(true);
    // shift_m === null alone does not matter; the API flag drives the warning
    expect(buildCorrelationFigure(response([activeWell, { ...offsetWell, shift_m: null }]), ['gr_api']).meta.flattenMissing).toEqual([]);
    expect(meta.flattenMissing).toEqual([]);
  });

  it('handles an empty response and unknown channels without throwing', () => {
    expect(buildCorrelationFigure({ wells: [] }, ['gr_api']).traces).toEqual([]);
    expect(() => buildCorrelationFigure(response([offsetWell]), ['made_up'])).not.toThrow();
  });
});

describe('correlation defaults', () => {
  const tops = [
    { formation: 'Tipam', top_md_m: 1700 },
    { formation: 'Barail', top_md_m: 2330 },
    { formation: 'Kopili', top_md_m: 2870 },
    { formation: 'Sylhet', top_md_m: 3190 },
  ];
  it('flatten defaults to the next formation below the bit', () => {
    expect(defaultFlattenFormation({ tops, bitMd: 2405, next: 'Kopili' })).toBe('Kopili');
    expect(defaultFlattenFormation({ tops, bitMd: 2405, next: null })).toBe('Kopili');
    expect(defaultFlattenFormation({ tops, bitMd: 2405, next: 'NotInTops' })).toBe('Kopili');
    expect(defaultFlattenFormation({ tops, bitMd: null, next: null })).toBe('');
    expect(defaultFlattenFormation({ tops, bitMd: 9999, next: null })).toBe('');
  });
  it('lists the formations of the active well, shallowest first', () => {
    expect(formationsFromTops([...tops].reverse().concat({ formation: 'Kopili', top_md_m: 2900 }))).toEqual(['Tipam', 'Barail', 'Kopili', 'Sylhet']);
  });
  it('picks the 4 nearest offsets and defaults to gr_api, rop_m_h, mw_sg', () => {
    const offs = [5, 1, 3, 2, 4, 6].map((d) => ({ wellbore_id: `w${d}`, surface_distance_m: d * 1000 }));
    expect(defaultOffsetIds(offs)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect([...DEFAULT_CHANNELS]).toEqual(['gr_api', 'rop_m_h', 'mw_sg']);
    expect([...ALL_CHANNELS]).toEqual(['gr_api', 'rop_m_h', 'torque_knm', 'mw_sg', 'ecd_sg']);
  });
  it('warning text lists wells lacking the formation', () => {
    expect(flattenWarning([{ name: 'A', flatten_missing: true }, { name: 'B' }], 'Kopili')).toBe('A has no Kopili top and is shown unshifted.');
    expect(flattenWarning([{ name: 'A', flatten_missing: true }, { name: 'B', flatten_missing: true }], 'Kopili')).toMatch(/A, B have no Kopili top and are shown unshifted/);
    expect(flattenWarning([{ name: 'A', flatten_missing: true }], '')).toBeNull();
  });
});

describe('CorrelationControls', () => {
  const offsets = Array.from({ length: 8 }, (_, i) => ({ wellbore_id: `o${i}`, well_name: `Off ${i}`, surface_distance_m: 1000 * (i + 1) }));
  it('allows at most 6 offsets and keeps at least one channel', () => {
    const onOffsetsChange = vi.fn();
    const onChannelsChange = vi.fn();
    render(
      <CorrelationControls
        offsets={offsets}
        selectedOffsets={['o0', 'o1', 'o2', 'o3', 'o4', 'o5']}
        onOffsetsChange={onOffsetsChange}
        formations={['Tipam', 'Kopili']}
        flatten="Kopili"
        onFlattenChange={() => {}}
        channels={['gr_api']}
        onChannelsChange={onChannelsChange}
      />,
    );
    expect(screen.getByLabelText(/Off 6/).disabled).toBe(true);
    expect(screen.getByLabelText(/Off 0/).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/Off 0/));
    expect(onOffsetsChange).toHaveBeenCalledWith(['o1', 'o2', 'o3', 'o4', 'o5']);
    fireEvent.click(screen.getByLabelText(/GR/)); // the last channel cannot be removed
    expect(onChannelsChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/ROP/));
    expect(onChannelsChange).toHaveBeenCalledWith(['gr_api', 'rop_m_h']);
    expect(screen.getByLabelText('Flatten on formation').value).toBe('Kopili');
  });
});

/* ------------------------------------------------------------------ the tab, against the mock API */

const renderTab = () => renderRoute(<CorrelationTab />, { path: '/wells/:wellboreId/correlation', route: `/wells/${ACTIVE_WELLBORE_ID}/correlation` });
const lastPlot = () => plot.calls.at(-1);

describe('CorrelationTab', () => {
  it('defaults: next formation below the bit is selected for flattening, 4 nearest offsets, gr_api/rop_m_h/mw_sg', async () => {
    const requests = [];
    server.use(
      http.get('/api/wells/:id/correlation', ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return undefined;
      }),
    );
    renderTab();
    await waitFor(() => expect(screen.getByTestId('plotly-stub')).toBeTruthy());
    expect(screen.getByLabelText('Flatten on formation').value).toBe('Kopili');
    const q = requests.at(-1);
    expect(q.get('flatten')).toBe('Kopili');
    expect(q.get('channels')).toBe('gr_api,rop_m_h,mw_sg');
    const offs = q.get('offsets').split(',');
    expect(offs).toHaveLength(4);
    const nearest = offsetsWithin(ACTIVE_WELLBORE_ID, 25000, null, 'surface').slice(0, 4).map((o) => o.wellbore_id);
    expect(offs).toEqual(nearest); // ordered by distance, nearest first
    expect(screen.getByTestId('correlation-note').textContent).toContain('Wells are aligned on the top of Kopili. Shifted depths are shown; hover shows true MD.');
  });

  it('changing the flatten formation re-aligns the wells (shift_m changes) and the plot shows shifted depths with true MD in hover', async () => {
    renderTab();
    await waitFor(() => expect(lastPlot()).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('Flatten on formation').value).toBe('Kopili'));
    const kopili = lastPlot();
    const firstOffsetTrace = kopili.data.find((t) => t.name.includes('gr_api') && !t.name.startsWith('SYN-DLJ-03'));
    const shiftKopili = firstOffsetTrace.y[0] - firstOffsetTrace.customdata[0];

    fireEvent.change(screen.getByLabelText('Flatten on formation'), { target: { value: 'Tipam' } });
    await waitFor(() => expect(screen.getByTestId('correlation-note').textContent).toContain('top of Tipam'), { timeout: 3000 });
    await waitFor(() => {
      const t = lastPlot().data.find((x) => x.name === firstOffsetTrace.name);
      expect(t.y[0] - t.customdata[0]).not.toBe(shiftKopili);
    });
    const tipam = lastPlot();
    // true MD is unchanged, only the plotted depth moved
    const t2 = tipam.data.find((x) => x.name === firstOffsetTrace.name);
    expect(t2.customdata).toEqual(firstOffsetTrace.customdata);
    // the active well is the reference: never shifted
    const act = tipam.data.find((x) => x.name === 'SYN-DLJ-03 gr_api');
    expect(act.y).toEqual(act.customdata);
    // predicted tops of the active well are drawn dashed with a band
    expect(tipam.layout.shapes.some((s) => s.type === 'rect')).toBe(true);
    expect(tipam.layout.shapes.some((s) => s.name?.endsWith('top') && s.line.dash === 'dash')).toBe(true);
  });

  it('active well tracks stop at the bit depth and a bit line is drawn', async () => {
    renderTab();
    await waitFor(() => expect(lastPlot()).toBeTruthy());
    const act = lastPlot().data.filter((t) => t.name.startsWith('SYN-DLJ-03') && t.name.includes('gr_api'));
    expect(act).toHaveLength(1);
    expect(Math.max(...act[0].y)).toBeLessThanOrEqual(2405);
    expect(lastPlot().layout.shapes.some((s) => s.name === 'bit' && s.y0 === 2405)).toBe(true);
    // formation tops of the active well below the bit are still drawn (predicted)
    expect(lastPlot().layout.shapes.some((s) => s.name === 'SYN-DLJ-03 Kopili top' && s.y0 > 2405)).toBe(true);
  });

  it('shows the unshifted-well warning using the API flatten_missing flag', async () => {
    const shallow = MOCK_WELLS.find((w) => w.td_md_m < 3400 && w.basin === 'Upper Assam'); // TD above the Langpar top
    renderTab();
    await waitFor(() => expect(lastPlot()).toBeTruthy());
    expect(screen.queryByTestId('flatten-warning')).toBeNull();
    fireEvent.click(screen.getByLabelText(new RegExp(shallow.well_name)));
    fireEvent.change(screen.getByLabelText('Flatten on formation'), { target: { value: 'Langpar' } });
    const warn = await screen.findByTestId('flatten-warning', {}, { timeout: 3000 });
    expect(warn.textContent).toContain(shallow.well_name);
    expect(warn.textContent).toMatch(/has no Langpar top and is shown unshifted/);
    // the plot draws that well unshifted and flags it in its heading
    await waitFor(() => {
      const t = lastPlot().data.find((x) => x.name === `${shallow.well_name} gr_api`);
      expect(t.y).toEqual(t.customdata);
    });
    expect(lastPlot().layout.annotations.some((a) => a.text.includes(`⚠ no Langpar`))).toBe(true);
  });

  it('shows an error state with retry when the API fails', async () => {
    server.use(http.get('/api/wells/:id/correlation', () => HttpResponse.json({ error: { code: 'NWIS_INTERNAL', message: 'boom' } }, { status: 500 })));
    renderTab();
    expect(await screen.findByText('Failed to load correlation data.', {}, { timeout: 3000 })).toBeTruthy();
    expect(within(screen.getByText('Failed to load correlation data.').parentElement).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('mock correlation API contract (§9.3)', () => {
  it('returns wells with shift_m, tops, casing, events and tracks; the active well first and never below the bit', () => {
    const others = MOCK_WELLS.filter((w) => w.wellbore_id !== ACTIVE_WELLBORE_ID).slice(0, 2).map((w) => w.wellbore_id);
    const r = buildCorrelation(ACTIVE_WELLBORE_ID, others, 'Barail', ['gr_api', 'mw_sg']);
    expect(r.flatten_formation).toBe('Barail');
    expect(r.wells[0]).toMatchObject({ wellbore_id: ACTIVE_WELLBORE_ID, is_active: true, shift_m: 0 });
    expect(Math.max(...r.wells[0].tracks.md_m)).toBeLessThanOrEqual(2405);
    expect(r.wells[1].is_active).toBe(false);
    expect(r.wells[1].shift_m).not.toBe(0);
    r.wells.forEach((w) => {
      expect(Object.keys(w.tracks)).toEqual(['md_m', 'gr_api', 'mw_sg']);
      expect(w.tracks.gr_api).toHaveLength(w.tracks.md_m.length);
      expect(w.tracks.md_m.length).toBeLessThanOrEqual(2000);
    });
    expect(r.wells[0].events.every((e) => e.md_from_m <= 2405)).toBe(true);
  });
});

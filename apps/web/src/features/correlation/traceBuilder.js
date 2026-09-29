// Pure transformation: correlation API response (contract §9.3) -> Plotly traces + layout.
// No Plotly import here, so it is unit-testable without a DOM.
import { EVENT_TO_RISK, RISK_LABELS } from '../../lib/constants';
import { riskColor } from '../workspace/mapGeo';

export const CHANNEL_META = Object.freeze({
  gr_api: { label: 'GR', unit: 'API' },
  rop_m_h: { label: 'ROP', unit: 'm/h' },
  torque_knm: { label: 'Torque', unit: 'kN·m' },
  mw_sg: { label: 'MW', unit: 'SG' },
  ecd_sg: { label: 'ECD', unit: 'SG' },
});

const ACTIVE_COLOR = '#1d4ed8';
const OFFSET_COLORS = ['#374151', '#0f766e', '#b45309', '#7c3aed', '#be185d', '#4d7c0f'];
const TOP_COLORS = { actual: '#0f766e', prognosis: '#6b7280', predicted: '#2563eb' };
const TOP_DASH = { actual: 'solid', prognosis: 'dot', predicted: 'dash' };
const GAP = 0.03;
const MARKER_TRACK_SHARE = 0.14;

/** Plotly names the first axis `x`/`xaxis` (no "1"); later ones are `x2`/`xaxis2`, ... */
const suffix = (n) => (n === 1 ? '' : String(n));
export const xRef = (n) => `x${suffix(n)}`;
export const yRef = (n) => `y${suffix(n)}`;
const xKey = (n) => `xaxis${suffix(n)}`;
const yKey = (n) => `yaxis${suffix(n)}`;

const pretty = (s) => String(s).replace(/_/g, ' ');
const r1 = (v) => Math.round(v * 10) / 10;

export function eventRisk(e) {
  return EVENT_TO_RISK[e.event_type] ?? e.risk_type ?? null;
}

/**
 * @param {object} data   response of GET /api/wells/{id}/correlation
 * @param {string[]} channels  depth_series columns to draw (one sub-track each)
 * @param {{bitMd?: number|null}} [opts]  active well's bit depth: its tracks/events never go below it and a "bit" line is drawn
 * @returns {{traces: object[], layout: object, meta: {flattenMissing: string[], flatten: string|null, groups: object[]}}}
 */
export function buildCorrelationFigure(data, channels, opts = {}) {
  const wells = data?.wells || [];
  const flatten = data?.flatten_formation || null;
  const bitMd = opts.bitMd ?? null;
  const nW = Math.max(wells.length, 1);
  const perWell = channels.length + 1; // one narrow marker track (events, casing) + one track per channel
  const groupW = (1 - GAP * (nW - 1)) / nW;
  const markerW = groupW * MARKER_TRACK_SHARE;
  const chanW = channels.length ? (groupW - markerW) / channels.length : 0;

  const traces = [];
  const shapes = [];
  const annotations = [];
  const layout = {
    margin: { t: 80, b: 30, l: 64, r: 12 },
    showlegend: false,
    hovermode: 'closest',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    shapes,
    annotations,
  };
  const groups = [];
  const flattenMissing = [];

  wells.forEach((well, wi) => {
    const shift = well.shift_m || 0;
    const clipToBit = Boolean(well.is_active) && bitMd != null;
    const gStart = wi * (groupW + GAP);
    const gEnd = gStart + groupW;
    const markerAxis = wi * perWell + 1;
    const color = well.is_active ? ACTIVE_COLOR : OFFSET_COLORS[(wi - 1 + OFFSET_COLORS.length) % OFFSET_COLORS.length];
    if (well.flatten_missing) flattenMissing.push(well.name);
    groups.push({ wellbore_id: well.wellbore_id, name: well.name, start: gStart, end: gEnd, markerAxis, shift });

    // --- marker track (events + casing shoes), fixed x range so markers sit at known positions
    layout[xKey(markerAxis)] = { domain: [gStart, gStart + markerW], anchor: yRef(markerAxis), range: [0, 1], showticklabels: false, showgrid: false, zeroline: false, fixedrange: true };
    layout[yKey(markerAxis)] = {
      domain: [0, 1],
      anchor: xRef(markerAxis),
      autorange: 'reversed',
      ...(markerAxis === 1 ? { title: { text: flatten ? `Depth (m) flattened on ${flatten}` : 'MD (m)', font: { size: 11 } }, showticklabels: true } : { matches: 'y', showticklabels: false }),
      gridcolor: '#eee',
      zeroline: false,
    };

    // --- channel tracks
    channels.forEach((ch, ci) => {
      const n = wi * perWell + 2 + ci;
      const meta = CHANNEL_META[ch] || { label: ch, unit: '' };
      const start = gStart + markerW + ci * chanW;
      layout[xKey(n)] = {
        domain: [start + 0.002, start + chanW - 0.002],
        anchor: yRef(n),
        side: 'top',
        title: { text: `${meta.label}${meta.unit ? ` (${meta.unit})` : ''}`, font: { size: 10 } },
        tickfont: { size: 9 },
        nticks: 3,
        showgrid: true,
        gridcolor: '#eee',
        zeroline: false,
      };
      layout[yKey(n)] = { domain: [0, 1], anchor: xRef(n), autorange: 'reversed', matches: 'y', showticklabels: false, gridcolor: '#eee', zeroline: false };

      const md = well.tracks?.md_m || [];
      const vals = well.tracks?.[ch] || [];
      const keep = md.map((m, i) => i).filter((i) => !clipToBit || md[i] <= bitMd);
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: `${well.name} ${ch}`,
        x: keep.map((i) => vals[i]),
        y: keep.map((i) => md[i] + shift),
        customdata: keep.map((i) => md[i]),
        xaxis: xRef(n),
        yaxis: yRef(n),
        line: { width: 1, color },
        hovertemplate: `${well.name}<br>True MD %{customdata:.1f} m<br>Shifted depth %{y:.1f} m<br>${meta.label}: %{x:.2f} ${meta.unit}<extra></extra>`,
        showlegend: false,
      });
    });

    // --- events, coloured by risk type
    const events = (well.events || []).filter((e) => !clipToBit || e.md_from_m <= bitMd);
    if (events.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${well.name} events`,
        x: events.map(() => 0.72),
        y: events.map((e) => e.md_from_m + shift),
        customdata: events.map((e) => e.md_from_m),
        xaxis: xRef(markerAxis),
        yaxis: yRef(markerAxis),
        marker: { symbol: 'diamond', size: events.map((e) => 8 + 2 * (e.severity || 1)), color: events.map((e) => riskColor(eventRisk(e))), line: { width: 1, color: '#111827' } },
        text: events.map((e) => {
          const risk = eventRisk(e);
          return `<b>${pretty(e.event_type)}</b> (${risk ? RISK_LABELS[risk] : 'not scored'})<br>True MD ${e.md_from_m} m<br>Severity ${e.severity ?? '-'}<br>${e.description || ''}<br>Source: ${e.source || e.provenance || 'n/a'}`;
        }),
        hovertemplate: `%{text}<extra>${well.name}</extra>`,
        showlegend: false,
      });
    }

    // --- casing shoes
    const casing = (well.casing || []).filter((c) => !clipToBit || c.shoe_md_m <= bitMd);
    if (casing.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${well.name} casing`,
        x: casing.map(() => 0.28),
        y: casing.map((c) => c.shoe_md_m + shift),
        customdata: casing.map((c) => c.shoe_md_m),
        xaxis: xRef(markerAxis),
        yaxis: yRef(markerAxis),
        marker: { symbol: 'triangle-down', size: 12, color: '#111827' },
        text: casing.map((c) => `Casing ${c.casing_od_in}" shoe<br>True MD ${c.shoe_md_m} m`),
        hovertemplate: `%{text}<extra>${well.name}</extra>`,
        showlegend: false,
      });
    }

    // --- formation tops: line per top on this well's own y axis; predicted = dashed + uncertainty band
    (well.tops || []).forEach((top) => {
      const y = top.top_md_m + shift;
      const c = TOP_COLORS[top.source] || TOP_COLORS.actual;
      if (top.source === 'predicted' && top.uncertainty_m) {
        shapes.push({ type: 'rect', name: `${well.name} ${top.formation} uncertainty`, xref: 'paper', yref: yRef(markerAxis), x0: gStart, x1: gEnd, y0: y - top.uncertainty_m, y1: y + top.uncertainty_m, fillcolor: 'rgba(37,99,235,0.14)', line: { width: 0 }, layer: 'below' });
      }
      shapes.push({ type: 'line', name: `${well.name} ${top.formation} top`, xref: 'paper', yref: yRef(markerAxis), x0: gStart, x1: gEnd, y0: y, y1: y, line: { color: c, width: 1.2, dash: TOP_DASH[top.source] || 'solid' } });
      annotations.push({
        xref: 'paper', yref: yRef(markerAxis), x: gStart, y, xanchor: 'left', yanchor: 'bottom', showarrow: false,
        text: `${top.formation}${top.source === 'predicted' ? ` (pred${top.uncertainty_m ? ` ±${r1(top.uncertainty_m)}` : ''})` : top.source === 'prognosis' ? ' (prog)' : ''}`,
        font: { size: 9, color: c },
      });
    });

    // --- bit line on the active well
    if (clipToBit) {
      const y = bitMd + shift;
      shapes.push({ type: 'line', name: 'bit', xref: 'paper', yref: yRef(markerAxis), x0: gStart, x1: gEnd, y0: y, y1: y, line: { color: '#b91c1c', width: 2 } });
      annotations.push({ xref: 'paper', yref: yRef(markerAxis), x: gEnd, y, xanchor: 'right', yanchor: 'top', showarrow: false, text: `Bit ${r1(bitMd)} m`, font: { size: 10, color: '#b91c1c' } });
    }

    // --- group heading
    annotations.push({
      xref: 'paper', yref: 'paper', x: (gStart + gEnd) / 2, y: 1.0, yshift: 46, xanchor: 'center', yanchor: 'bottom', showarrow: false,
      text: `<b>${well.name}</b>${well.is_active ? ' (active)' : ''}${flatten ? `<br>shift ${shift > 0 ? '+' : ''}${r1(shift)} m${well.flatten_missing ? ' ⚠ no ' + flatten : ''}` : ''}`,
      font: { size: 11, color },
    });
  });

  return { traces, layout, meta: { flattenMissing, flatten, groups } };
}

/** Back-compat name used by the first version of the tab. */
export const buildTraces = buildCorrelationFigure;

import React, { Suspense, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { buildCorrelationFigure } from './traceBuilder';
import { flattenWarning } from './correlationModel';
import { RISK_COLORS } from '../workspace/mapGeo';
import { RISK_LABELS } from '../../lib/constants';

const PlotlyChart = React.lazy(() => import('./PlotlyChart'));

export function CorrelationPlot({ data, channels, flatten, bitMd }) {
  const { traces, layout } = useMemo(() => buildCorrelationFigure(data, channels, { bitMd }), [data, channels, bitMd]);
  const warning = flattenWarning(data.wells, flatten);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-[560px] flex-1" data-testid="correlation-plot">
        <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-gray-500">Loading chart…</div>}>
          <PlotlyChart
            data={traces}
            layout={{ ...layout, autosize: true }}
            useResizeHandler
            style={{ width: '100%', height: '100%', minHeight: 560 }}
            config={{ displayModeBar: true, displaylogo: false, responsive: true }}
          />
        </Suspense>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 px-3 pt-2 text-xs text-gray-700" aria-label="Event legend">
        {Object.entries(RISK_COLORS).map(([risk, color]) => (
          <li key={risk} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-3 w-3 rotate-45 border border-gray-900" style={{ background: color }} />
            {RISK_LABELS[risk]}
          </li>
        ))}
        <li>Triangle: casing shoe</li>
        <li>Solid line: actual top. Dashed line with band: predicted top. Dotted: prognosis. Red line: bit.</li>
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-gray-50 p-2 text-sm text-gray-600" data-testid="correlation-note">
        {flatten ? (
          <span>
            Wells are aligned on the top of <strong>{flatten}</strong>. Shifted depths are shown; hover shows true MD.
          </span>
        ) : (
          <span>Showing true measured depth (no alignment). Hover shows true MD.</span>
        )}
        {warning && (
          <span role="alert" className="flex items-center gap-1 font-medium text-amber-700" data-testid="flatten-warning">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {warning}
          </span>
        )}
      </div>
    </div>
  );
}

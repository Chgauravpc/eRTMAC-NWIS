import React, { Suspense, useMemo } from 'react';
import { buildTraces } from './traceBuilder';

const Plot = React.lazy(() => import('react-plotly.js'));

export function CorrelationPlot({ data, channels, flatten }) {
  const { traces, layout } = useMemo(() => buildTraces(data, channels), [data, channels]);

  const hasMissingFlatten = data.wells.some(w => w.shift_m === null && flatten);

  return (
    <div className="h-full w-full flex flex-col">
      <Suspense fallback={<div className="h-full flex items-center justify-center text-gray-500">Loading Plotly...</div>}>
        <Plot
          data={traces}
          layout={{ ...layout, autosize: true }}
          useResizeHandler={true}
          style={{ width: '100%', height: '100%' }}
          config={{ displayModeBar: true, responsive: true }}
        />
      </Suspense>
      
      {flatten && (
        <div className="p-2 text-sm text-gray-600 bg-gray-50 flex items-center gap-2 border-t border-gray-200">
          <span>Wells are aligned on the top of <strong>{flatten}</strong>. Shifted depths are shown; hover shows true MD.</span>
          {hasMissingFlatten && (
            <span className="text-amber-600 font-medium ml-4">
              ⚠️ Some wells lack this formation and are shown unshifted.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

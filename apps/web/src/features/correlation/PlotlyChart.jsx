import React, { Suspense } from 'react';

// Plotly is large: load react-plotly.js (factory build) and plotly.js-dist-min only when a chart is shown.
const Plot = React.lazy(async () => {
  const [{ default: createPlotlyComponent }, plotly] = await Promise.all([import('react-plotly.js/factory'), import('plotly.js-dist-min')]);
  return { default: createPlotlyComponent(plotly.default ?? plotly) };
});

export default function PlotlyChart(props) {
  return (
    <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-gray-500">Loading chart…</div>}>
      <Plot {...props} />
    </Suspense>
  );
}

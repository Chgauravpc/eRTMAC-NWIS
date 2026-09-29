export function buildTraces(data, channels) {
  const traces = [];
  const layout = {
    grid: { rows: 1, columns: data.wells.length * channels.length, pattern: 'independent' },
    margin: { t: 40, b: 40, l: 40, r: 20 },
    showlegend: false,
    hovermode: 'closest'
  };

  const getRiskColor = (risk) => {
    const map = { losses: 'blue', stuck_pipe: 'orange', kick: 'red', torque: 'purple', cementing: 'brown' };
    return map[risk] || 'gray';
  };

  data.wells.forEach((well, wellIdx) => {
    const shift = well.shift_m || 0;
    
    // Tracks
    channels.forEach((ch, chIdx) => {
      const xaxis = `x${wellIdx * channels.length + chIdx + 1}`;
      const yaxis = `y${wellIdx * channels.length + chIdx + 1}`;

      const xData = well.tracks[ch] || [];
      const yData = (well.tracks.md_m || []).map(md => md + shift);

      traces.push({
        x: xData,
        y: yData,
        type: 'scatter',
        mode: 'lines',
        name: `${well.name} ${ch}`,
        xaxis,
        yaxis,
        line: { width: 1, color: well.is_active ? 'blue' : '#555' },
        hovertemplate: `MD: %{text}m<br>${ch}: %{x}<extra></extra>`,
        text: well.tracks.md_m || []
      });

      layout[`xaxis${wellIdx * channels.length + chIdx + 1}`] = {
        title: ch,
        titlefont: { size: 10 },
        tickfont: { size: 9 },
      };

      layout[`yaxis${wellIdx * channels.length + chIdx + 1}`] = {
        autorange: 'reversed',
        title: chIdx === 0 ? well.name : '',
        showticklabels: chIdx === 0,
        matches: `y1`, // link y-axes
      };
    });

    // Events
    if (well.events && well.events.length > 0) {
      const firstXaxis = `x${wellIdx * channels.length + 1}`;
      const firstYaxis = `y${wellIdx * channels.length + 1}`;
      traces.push({
        x: well.events.map(() => 0), 
        y: well.events.map(e => e.md_from_m + shift),
        type: 'scatter',
        mode: 'markers',
        xaxis: firstXaxis,
        yaxis: firstYaxis,
        marker: { 
          color: well.events.map(e => getRiskColor(e.risk_type || e.event_type)),
          symbol: 'diamond',
          size: 10
        },
        text: well.events.map(e => `Event: ${e.event_type}<br>MD: ${e.md_from_m}m<br>${e.description || ''}`),
        hovertemplate: '%{text}<extra></extra>'
      });
    }

    // Casing
    if (well.casing && well.casing.length > 0) {
      const firstXaxis = `x${wellIdx * channels.length + 1}`;
      const firstYaxis = `y${wellIdx * channels.length + 1}`;
      traces.push({
        x: well.casing.map(() => 0),
        y: well.casing.map(c => c.shoe_md_m + shift),
        type: 'scatter',
        mode: 'markers',
        xaxis: firstXaxis,
        yaxis: firstYaxis,
        marker: { symbol: 'triangle-down', size: 12, color: 'black' },
        text: well.casing.map(c => `Casing ${c.casing_od_in}" at ${c.shoe_md_m}m`),
        hovertemplate: '%{text}<extra></extra>'
      });
    }
  });

  // Shapes for tops
  layout.shapes = [];
  data.wells.forEach((well, wellIdx) => {
    const shift = well.shift_m || 0;
    const firstXaxis = `x${wellIdx * channels.length + 1}`;
    
    if (well.tops) {
      well.tops.forEach(top => {
        const y = top.top_md_m + shift;
        layout.shapes.push({
          type: 'line',
          xref: `${firstXaxis} domain`,
          yref: 'y',
          x0: 0,
          x1: 1,
          y0: y,
          y1: y,
          line: { color: 'rgba(0,100,200,0.5)', width: 1, dash: top.source === 'predicted' ? 'dash' : 'solid' }
        });
        
        if (top.source === 'predicted' && top.uncertainty_m) {
          layout.shapes.push({
            type: 'rect',
            xref: `${firstXaxis} domain`,
            yref: 'y',
            x0: 0,
            x1: 1,
            y0: y - top.uncertainty_m,
            y1: y + top.uncertainty_m,
            fillcolor: 'rgba(0,100,200,0.1)',
            line: { width: 0 }
          });
        }
      });
    }
  });

  return { traces, layout };
}

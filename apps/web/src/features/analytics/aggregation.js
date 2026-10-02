export function aggregateWellMetrics(wells, provenanceFilter = 'all') {
  if (!wells || !Array.isArray(wells)) {
    return { totalWells: 0, totalNpt: 0, totalEvents: 0, byField: [] };
  }

  const filtered = provenanceFilter === 'all' 
    ? wells 
    : wells.filter(w => w.provenance === provenanceFilter);

  let totalNpt = 0;
  let totalEvents = 0;
  const fieldMap = {};

  filtered.forEach(w => {
    const npt = w.npt_h_total || 0;
    const evts = w.event_count || 0;
    totalNpt += npt;
    totalEvents += evts;
    
    const field = w.field || 'Unknown';
    if (!fieldMap[field]) {
      fieldMap[field] = { field, well_count: 0, npt_h_total: 0, event_count: 0 };
    }
    fieldMap[field].well_count += 1;
    fieldMap[field].npt_h_total += npt;
    fieldMap[field].event_count += evts;
  });

  return {
    totalWells: filtered.length,
    totalNpt,
    totalEvents,
    byField: Object.values(fieldMap).sort((a, b) => b.npt_h_total - a.npt_h_total)
  };
}

/**
 * v_npt_by_formation rows (formation x risk_type) -> one row per formation, largest NPT first,
 * with the NPT per risk type kept for the stacked bar.
 */
export function aggregateByFormation(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r?.formation) continue;
    if (!map.has(r.formation)) map.set(r.formation, { formation: r.formation, event_count: 0, npt_h_total: 0, byRisk: {} });
    const f = map.get(r.formation);
    const npt = Number(r.npt_h_total) || 0;
    f.event_count += Number(r.event_count) || 0;
    f.npt_h_total += npt;
    if (r.risk_type) f.byRisk[r.risk_type] = (f.byRisk[r.risk_type] || 0) + npt;
  }
  return [...map.values()].sort((a, b) => b.npt_h_total - a.npt_h_total || a.formation.localeCompare(b.formation));
}

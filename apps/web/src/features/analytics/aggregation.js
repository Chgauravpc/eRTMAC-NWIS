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

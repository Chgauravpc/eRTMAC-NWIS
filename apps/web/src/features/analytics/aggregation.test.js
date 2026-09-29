import { describe, it, expect } from 'vitest';
import { aggregateWellMetrics } from './aggregation';

describe('aggregateWellMetrics', () => {
  it('returns zeros for empty or null input', () => {
    const res1 = aggregateWellMetrics(null);
    expect(res1.totalWells).toBe(0);
    expect(res1.totalNpt).toBe(0);

    const res2 = aggregateWellMetrics([]);
    expect(res2.totalWells).toBe(0);
    expect(res2.totalEvents).toBe(0);
  });

  it('aggregates correctly without filter', () => {
    const wells = [
      { field: 'F1', npt_h_total: 10, event_count: 2, provenance: 'direct' },
      { field: 'F1', npt_h_total: 5, event_count: 1, provenance: 'analog' },
      { field: 'F2', npt_h_total: 20, event_count: 3, provenance: 'synthetic' }
    ];

    const res = aggregateWellMetrics(wells);
    expect(res.totalWells).toBe(3);
    expect(res.totalNpt).toBe(35);
    expect(res.totalEvents).toBe(6);
    expect(res.byField).toHaveLength(2);
    
    // F2 should be first because it has more NPT (20 vs 15)
    expect(res.byField[0].field).toBe('F2');
    expect(res.byField[0].npt_h_total).toBe(20);
    
    expect(res.byField[1].field).toBe('F1');
    expect(res.byField[1].npt_h_total).toBe(15);
  });

  it('filters by provenance correctly', () => {
    const wells = [
      { field: 'F1', npt_h_total: 10, event_count: 2, provenance: 'direct' },
      { field: 'F1', npt_h_total: 5, event_count: 1, provenance: 'analog' },
      { field: 'F2', npt_h_total: 20, event_count: 3, provenance: 'synthetic' }
    ];

    const res = aggregateWellMetrics(wells, 'analog');
    expect(res.totalWells).toBe(1);
    expect(res.totalNpt).toBe(5);
    expect(res.byField).toHaveLength(1);
    expect(res.byField[0].field).toBe('F1');
  });
});

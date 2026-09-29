import { describe, it, expect } from 'vitest';
import { buildTraces } from './traceBuilder';

describe('Correlation traceBuilder', () => {
  it('builds traces correctly for one well and one channel', () => {
    const data = {
      flatten_formation: null,
      wells: [
        {
          name: 'Well A',
          is_active: true,
          shift_m: 0,
          tracks: { md_m: [100, 200], gr_api: [50, 60] },
          events: [],
          tops: []
        }
      ]
    };

    const { traces, layout } = buildTraces(data, ['gr_api']);
    expect(traces.length).toBe(1);
    expect(traces[0].x).toEqual([50, 60]);
    expect(traces[0].y).toEqual([100, 200]);
    expect(traces[0].name).toBe('Well A gr_api');
  });

  it('applies shift_m to y data', () => {
    const data = {
      flatten_formation: 'Tipam',
      wells: [
        {
          name: 'Well B',
          shift_m: -50,
          tracks: { md_m: [100, 200], rop_m_h: [10, 12] },
          events: [],
          tops: []
        }
      ]
    };

    const { traces } = buildTraces(data, ['rop_m_h']);
    expect(traces[0].y).toEqual([50, 150]);
    expect(traces[0].text).toEqual([100, 200]); // true MD for hover
  });
});

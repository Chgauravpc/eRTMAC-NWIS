import { describe, it, expect } from 'vitest';
import { bandFor, bandLabel, severityFor, severityRank, BAND_META, BAND_ORDER } from './risk';

describe('bandFor (contract §11.1 boundaries)', () => {
  it.each([
    [0, 'low', 'Low'],
    [20, 'low', 'Low'],
    [20.01, 'moderate', 'Moderate'],
    [40, 'moderate', 'Moderate'],
    [40.01, 'elevated', 'Elevated'],
    [60, 'elevated', 'Elevated'],
    [60.01, 'high', 'High'],
    [80, 'high', 'High'],
    [80.01, 'critical', 'Critical'],
    [100, 'critical', 'Critical'],
  ])('score %s -> %s (%s)', (score, band, label) => {
    expect(bandFor(score)).toBe(band);
    expect(bandLabel(bandFor(score))).toBe(label);
  });

  it('returns null for missing scores', () => {
    expect(bandFor(null)).toBeNull();
    expect(bandFor(undefined)).toBeNull();
  });
});

describe('severityFor', () => {
  it('maps each band to the contract alert severity', () => {
    expect(BAND_ORDER.map(severityFor)).toEqual(['none', 'info', 'watch', 'warning', 'critical']);
    expect(severityRank('critical')).toBeGreaterThan(severityRank('warning'));
  });
});

describe('BAND_META', () => {
  it('uses sky for moderate (PRD §3 colour table) and the NWIS_PRD F5 meaning text', () => {
    expect(BAND_META.moderate.color).toMatch(/sky/);
    expect(BAND_META.moderate.token).toBe('risk-moderate');
    expect(BAND_META.low.meaning).toBe('Normal drilling');
    expect(BAND_META.high.alertRaised).toMatch(/Warning/);
  });
});

import { overlapM, scoresInWindow, riskColumns, pickCell, riskKey, upsertScore, maxFusedByType } from './risk';

const row = (o) => ({ wellbore_id: 'w', risk_type: 'losses', md_from_m: 1000, md_to_m: 1025, fused: 10, computed_at: '2026-01-01T00:00:00Z', ...o });

describe('look-ahead grid helpers', () => {
  it('riskColumns: 12 columns of 25 m from the bit, first two at bit', () => {
    const cols = riskColumns(2405);
    expect(cols).toHaveLength(12);
    expect(cols[0]).toMatchObject({ from: 2405, to: 2430, atBit: true });
    expect(cols[1].atBit).toBe(true);
    expect(cols[2].atBit).toBe(false);
    expect(cols[11].to).toBe(2705);
  });

  it('scoresInWindow keeps rows overlapping [bit, bit+300] regardless of grid alignment', () => {
    const rows = [row({ md_from_m: 990, md_to_m: 1015 }), row({ md_from_m: 1300, md_to_m: 1325 }), row({ md_from_m: 1290, md_to_m: 1315 }), row({ md_from_m: 900, md_to_m: 1000 })];
    expect(scoresInWindow(rows, 1000).map((r) => r.md_from_m)).toEqual([990, 1290]);
    expect(overlapM(rows[0], 1000, 1025)).toBe(15);
  });

  it('pickCell prefers the largest overlap over a newer partial one', () => {
    const exact = row({ md_from_m: 2405, md_to_m: 2430, fused: 30, computed_at: '2026-01-01T00:00:00Z' });
    const shifted = row({ md_from_m: 2415, md_to_m: 2440, fused: 40, computed_at: '2026-01-02T00:00:00Z' });
    expect(pickCell([exact, shifted], 'losses', 2405, 2430)).toBe(exact);
  });

  it('pickCell tie-break: newest computed_at wins', () => {
    const a = row({ md_from_m: 2400, md_to_m: 2425, fused: 30, computed_at: '2026-01-01T00:00:00Z' });
    const b = row({ md_from_m: 2410, md_to_m: 2435, fused: 40, computed_at: '2026-01-02T00:00:00Z' });
    expect(pickCell([a, b], 'losses', 2405, 2430)).toBe(b);
    expect(pickCell([b, a], 'losses', 2405, 2430)).toBe(b);
    expect(pickCell([a, b], 'kick', 2405, 2430)).toBeNull();
    expect(pickCell([a], 'losses', 2500, 2525)).toBeNull();
  });

  it('upsertScore keys on wellbore + risk_type + md range', () => {
    const a = row({});
    const list = upsertScore([a], row({ fused: 99 }));
    expect(list).toHaveLength(1);
    expect(list[0].fused).toBe(99);
    expect(upsertScore(list, row({ risk_type: 'kick' }))).toHaveLength(2);
    expect(upsertScore(list, row({ md_to_m: 1050 }))).toHaveLength(2);
    expect(riskKey(a)).toContain('losses');
  });

  it('maxFusedByType ignores rows outside the next 300 m and ties go shallower', () => {
    const rows = [
      row({ md_from_m: 1000, fused: 30 }),
      row({ md_from_m: 1100, md_to_m: 1125, fused: 85 }),
      row({ md_from_m: 1400, md_to_m: 1425, fused: 99 }), // beyond bit + 300
      row({ md_from_m: 800, md_to_m: 825, fused: 95 }), // behind the bit
      row({ risk_type: 'kick', md_from_m: 1050, md_to_m: 1075, fused: 50 }),
      row({ risk_type: 'kick', md_from_m: 1150, md_to_m: 1175, fused: 50 }),
    ];
    const m = maxFusedByType(rows, 1000, ['losses', 'kick', 'torque']);
    expect(m.losses.fused).toBe(85);
    expect(m.kick.md_from_m).toBe(1050);
    expect(m.torque).toBeNull();
  });
});

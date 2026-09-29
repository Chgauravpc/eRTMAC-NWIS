import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { computeMaxGauges } from './RiskGauges';
import { DepthPanel } from './DepthPanel';

describe('computeMaxGauges', () => {
  it('finds the maximum fused score for each risk type', () => {
    const scores = [
      { risk_type: 'losses', fused: 30, md_from_m: 1000, confidence: 'high' },
      { risk_type: 'losses', fused: 85, md_from_m: 1025, confidence: 'medium' },
      { risk_type: 'stuck_pipe', fused: 50, md_from_m: 1000, confidence: 'low' }
    ];
    
    const maxes = computeMaxGauges(scores);
    
    expect(maxes.losses.fused).toBe(85);
    expect(maxes.losses.md_from_m).toBe(1025);
    expect(maxes.stuck_pipe.fused).toBe(50);
    expect(maxes.kick).toBeNull();
  });
});

describe('DepthPanel lost stream', () => {
  it('renders the lost stream warning bar', () => {
    const streamState = {
      bit_md_m: 1200,
      status: 'lost',
      last_sample_at: '2026-10-04T10:15:00Z',
      latest: {}
    };
    
    render(<DepthPanel streamState={streamState} />);
    expect(screen.getByText(/Live data lost at/i)).toBeTruthy();
    expect(screen.getByText(/live detectors paused/i)).toBeTruthy();
  });
});

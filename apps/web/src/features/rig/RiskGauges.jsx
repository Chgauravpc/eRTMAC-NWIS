import React from 'react';
import { RISK_TYPES, RISK_LABELS } from '../../lib/constants';
import { BAND_META, LOOKAHEAD_MAX_M, bandFor, maxFusedByType } from '../../lib/risk';
import { BandBadge, ConfidenceChip } from '../risk/BandBadge';

/** Max fused score per risk type within the NEXT 300 m of the bit (rows behind/beyond are ignored). */
export function computeMaxGauges(scores, bitMd) {
  return maxFusedByType(scores, bitMd, RISK_TYPES);
}

const TOP_BORDER = {
  low: 'border-t-risk-low',
  moderate: 'border-t-risk-moderate',
  elevated: 'border-t-risk-elevated',
  high: 'border-t-risk-high',
  critical: 'border-t-risk-critical',
};

export function RiskGauges({ scores, bitMd }) {
  const maxes = computeMaxGauges(scores, bitMd);

  return (
    <section aria-label="Look-ahead risk" className="rounded-lg border border-white/30 p-4">
      <h2 className="mb-3 text-xl font-bold uppercase tracking-wide">Risk in the next {LOOKAHEAD_MAX_M} m</h2>
      <div className="grid grid-cols-5 gap-3">
        {RISK_TYPES.map((rt) => {
          const max = maxes[rt];
          if (!max) {
            return (
              <div key={rt} data-testid={`gauge-${rt}`} className="min-h-[190px] rounded border border-white/30 p-3">
                <h3 className="mb-2 text-lg font-semibold">{RISK_LABELS[rt]}</h3>
                <div className="text-lg text-gray-300">No score yet</div>
              </div>
            );
          }
          const band = bandFor(max.fused);
          return (
            <div
              key={rt}
              data-testid={`gauge-${rt}`}
              data-band={band}
              className={`min-h-[190px] rounded border border-white/30 border-t-8 p-3 ${TOP_BORDER[band]}`}
            >
              <h3 className="mb-1 text-lg font-semibold leading-tight">{RISK_LABELS[rt]}</h3>
              <div className="text-5xl font-black tabular-nums">{Math.round(max.fused)}</div>
              <div className="mt-1">
                <BandBadge band={band} variant="rig" />
              </div>
              <div className="mt-2">
                <ConfidenceChip level={max.confidence} reason={max.confidence_reason} variant="rig" />
              </div>
              <div className="mt-2 text-lg text-gray-300">
                Peak at {max.md_from_m}–{max.md_to_m} m
              </div>
              <span className="sr-only">{BAND_META[band].meaning}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

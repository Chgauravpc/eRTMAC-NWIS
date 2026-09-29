import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Primitives';
import { pickCell, riskColumns, scoresInWindow } from '../../lib/risk';
import { useRecomputeRisk, useRiskScores, useStreamState } from '../../lib/hooks/risk';
import { RiskStrip } from './RiskStrip';
import { IntervalDetail } from './IntervalDetail';
import { BandLegend } from './BandLegend';

export function RiskTab() {
  const { wellboreId } = useParams();
  const streamQ = useStreamState(wellboreId);
  const bitMd = streamQ.data?.bit_md_m ?? null;
  const scoresQ = useRiskScores(wellboreId, bitMd);
  const recompute = useRecomputeRisk(wellboreId);
  const [selected, setSelected] = useState(null);

  const scores = useMemo(() => scoresInWindow(scoresQ.data, bitMd), [scoresQ.data, bitMd]);

  // The selection is (risk type, column); the row shown always comes from the live data.
  const selectedRow = useMemo(() => {
    if (!selected || bitMd == null) return null;
    const col = riskColumns(bitMd)[selected.col];
    return col ? pickCell(scores, selected.risk_type, col.from, col.to) : null;
  }, [selected, scores, bitMd]);

  const noStream = !streamQ.isLoading && !streamQ.isError && bitMd == null;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white p-4">
        <p className="max-w-3xl text-sm text-gray-900">
          <strong>Score =</strong> estimated chance (%) that this happens in the interval, from offset wells, the ML model and live data.
        </p>
        <div className="flex items-center gap-3">
          {bitMd != null && <span className="text-sm text-gray-800">Bit at {bitMd.toFixed(1)} m</span>}
          <Button onClick={() => recompute.mutate()} disabled={recompute.isPending || bitMd == null} className="inline-flex items-center gap-2">
            <RefreshCw size={16} aria-hidden="true" className={recompute.isPending ? 'animate-spin' : ''} />
            Recompute
          </Button>
        </div>
      </div>
      {recompute.isError && (
        <div role="alert" className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-900">
          Could not recompute: {recompute.error?.message || 'unknown error'}
        </div>
      )}

      {streamQ.isError && (
        <div role="alert" className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-900">
          Could not load the bit depth for this well.
        </div>
      )}

      {bitMd != null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-300 bg-white p-4">
          {scoresQ.isError && (
            <div role="alert" className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-900">
              Could not load risk scores.
            </div>
          )}
          <RiskStrip bitMd={bitMd} scores={scores} selected={selected} onSelect={setSelected} />
          <BandLegend />
        </div>
      ) : (
        <div className="rounded-lg border border-gray-300 bg-white p-10 text-center text-gray-800">
          {noStream ? 'This well has no live bit depth, so there is no look-ahead to show.' : 'Loading the current bit depth…'}
        </div>
      )}

      <IntervalDetail score={selectedRow} />
    </div>
  );
}

export default RiskTab;

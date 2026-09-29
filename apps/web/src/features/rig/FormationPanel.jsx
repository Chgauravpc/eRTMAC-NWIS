import React from 'react';
import { useFormation } from '../../lib/hooks/risk';
import { fmtDepth } from '../../lib/units';

const SOURCE_WORD = { actual: 'picked', predicted: 'predicted', prognosis: 'prognosis' };

/** Current formation, next formation and the distance to its top, with the predicted-top uncertainty. */
export function FormationPanel({ wellboreId, bitMd }) {
  const { data, isLoading, nextUncertaintyM } = useFormation(wellboreId, bitMd);

  if (isLoading || !data) {
    return (
      <section aria-label="Formation" className="h-full rounded-lg border border-white/30 p-4 text-lg font-semibold">
        {bitMd == null ? 'Waiting for bit depth…' : 'Determining formation…'}
      </section>
    );
  }

  const distance = data.next_top_md_m != null && bitMd != null ? Math.max(0, Math.round(data.next_top_md_m - bitMd)) : null;

  return (
    <section aria-label="Formation" className="h-full rounded-lg border border-white/30 p-4">
      <h2 className="mb-2 text-lg font-semibold uppercase tracking-wide text-gray-300">Formation</h2>
      <div className="text-4xl font-black">{data.formation || 'Unknown'}</div>
      <div className="mt-1 text-lg text-gray-300">
        Top at {fmtDepth(data.top_md_m)}
        {data.source ? ` (${SOURCE_WORD[data.source] || data.source})` : ''}
      </div>
      <div className="mt-4 border-t border-white/30 pt-3 text-xl">
        {data.next_formation && distance != null ? (
          <p data-testid="next-formation">
            <strong>{data.next_formation}</strong> in ~{distance} m
            {nextUncertaintyM != null ? ` ± ${Math.round(nextUncertaintyM)} m` : ''}
          </p>
        ) : (
          <p>No formation top expected ahead.</p>
        )}
      </div>
    </section>
  );
}

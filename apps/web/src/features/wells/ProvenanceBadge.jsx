import React from 'react';
import { cn } from '../../components/ui/Primitives';

const STYLES = {
  synthetic: { label: 'SYNTHETIC', cls: 'border-purple-600 text-purple-700 bg-white', hint: 'Synthetic data generated for this demo, not a real well.' },
  analog: { label: 'ANALOG', cls: 'border-sky-600 text-sky-800 bg-sky-50', hint: 'Analog data from a comparable field or basin.' },
  direct: { label: 'DIRECT', cls: 'border-emerald-700 text-emerald-800 bg-emerald-50', hint: 'Direct data from the operator or a public dataset.' },
};

/** Provenance badge (contract enum `provenance`): purple outline SYNTHETIC, ANALOG, DIRECT. Word always shown. */
export function ProvenanceBadge({ provenance, className }) {
  if (!provenance) return null;
  const s = STYLES[provenance] || { label: String(provenance).toUpperCase(), cls: 'border-gray-500 text-gray-700 bg-white', hint: 'Data provenance' };
  return (
    <span
      data-testid="provenance-badge"
      title={s.hint}
      className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', s.cls, className)}
    >
      {s.label}
    </span>
  );
}

export default ProvenanceBadge;

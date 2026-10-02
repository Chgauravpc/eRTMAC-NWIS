import React from 'react';
import { cn } from '../../components/ui/Primitives';

const LIGHT = {
  synthetic: 'border-purple-400 text-purple-800 bg-purple-50',
  analog: 'border-sky-400 text-sky-800 bg-sky-50',
  direct: 'border-emerald-400 text-emerald-800 bg-emerald-50',
};

const STYLES = {
  synthetic: { label: 'SYNTHETIC', cls: 'border-purple-500/50 text-purple-400 bg-purple-500/10', hint: 'Synthetic data generated for this demo, not a real well.' },
  analog: { label: 'ANALOG', cls: 'border-sky-500/50 text-sky-400 bg-sky-500/10', hint: 'Analog data from a comparable field or basin.' },
  direct: { label: 'DIRECT', cls: 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10', hint: 'Direct data from the operator or a public dataset.' },
};

/** Provenance badge (contract enum `provenance`): purple outline SYNTHETIC, ANALOG, DIRECT. Word always shown. */
export function ProvenanceBadge({ provenance, className, light = false }) {
  if (!provenance) return null;
  const s = STYLES[provenance] || { label: String(provenance).toUpperCase(), cls: 'border-gray-500 text-gray-400 bg-gray-800/50', hint: 'Data provenance' };
  return (
    <span
      data-testid="provenance-badge"
      title={s.hint}
      className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', light ? LIGHT[provenance] || 'border-gray-400 text-gray-700 bg-gray-100' : s.cls, className)}
    >
      {s.label}
    </span>
  );
}

export default ProvenanceBadge;

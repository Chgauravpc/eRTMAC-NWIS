import React from 'react';
import { RISK_TYPES, RISK_LABELS } from '../../lib/constants';
import { BAND_META, bandFor, pickCell, riskColumns, INTERVAL_M } from '../../lib/risk';
import { BandIcon } from './BandBadge';

const HATCH =
  'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 4px, rgba(255,255,255,0) 4px 8px)';
const AT_BIT_SHADE = 'linear-gradient(rgba(37,99,235,0.16), rgba(37,99,235,0.16))';

/**
 * 5 risk types x 12 columns of 25 m from the bit. Each cell is coloured by band AND shows the score,
 * an icon and the band word; low-confidence cells are hatched; the first 50 m are shaded "at bit".
 * Cells are matched to rows by interval overlap, so the engine grid need not be aligned to ours.
 */
export function RiskStrip({ bitMd, scores, selected, onSelect }) {
  const columns = riskColumns(bitMd);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-300 bg-white">
      <div role="grid" aria-label="Risk ahead by type and depth" className="grid" style={{ gridTemplateColumns: `140px repeat(${columns.length}, minmax(88px, 1fr))` }}>
        <div role="columnheader" className="sticky left-0 z-10 flex items-center border-b border-r bg-gray-50 p-2 text-sm font-semibold">
          Risk type
        </div>
        {columns.map((c) => (
          <div
            key={c.from}
            role="columnheader"
            data-at-bit={c.atBit ? 'true' : undefined}
            className={`flex flex-col items-center justify-center border-b border-r p-1 text-center text-xs font-medium ${c.atBit ? 'bg-blue-100 text-blue-900' : 'bg-gray-50'}`}
          >
            <span>
              {c.from}–{c.to} m
            </span>
            {c.atBit && <span className="text-[11px] font-bold uppercase tracking-wide">At bit</span>}
          </div>
        ))}

        {RISK_TYPES.map((rt) => (
          <React.Fragment key={rt}>
            <div role="rowheader" className="sticky left-0 z-10 flex items-center border-b border-r bg-white p-2 text-sm font-medium text-gray-800">
              {RISK_LABELS[rt]}
            </div>
            {columns.map((c, i) => {
              const cell = pickCell(scores, rt, c.from, c.to);
              const band = cell ? bandFor(cell.fused) : null;
              const meta = band ? BAND_META[band] : null;
              const lowConf = cell?.confidence === 'low';
              const isSelected = selected && selected.risk_type === rt && selected.col === i;
              const backgrounds = [lowConf ? HATCH : null, c.atBit ? AT_BIT_SHADE : null].filter(Boolean).join(', ');
              const label = cell
                ? `${RISK_LABELS[rt]}, ${c.from} to ${c.to} m: score ${Math.round(cell.fused)}, ${meta.label} band, ${cell.confidence} confidence${c.atBit ? ', at bit' : ''}`
                : `${RISK_LABELS[rt]}, ${c.from} to ${c.to} m: no score`;
              return (
                <button
                  key={c.from}
                  type="button"
                  role="gridcell"
                  disabled={!cell}
                  data-band={band ?? undefined}
                  data-low-confidence={lowConf ? 'true' : undefined}
                  data-at-bit={c.atBit ? 'true' : undefined}
                  aria-label={label}
                  aria-pressed={isSelected ? 'true' : 'false'}
                  onClick={() => cell && onSelect({ risk_type: rt, col: i })}
                  style={backgrounds ? { backgroundImage: backgrounds } : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center border-b border-r p-1 text-sm transition-shadow ${meta ? meta.color : 'bg-white text-gray-500'} ${isSelected ? 'ring-4 ring-inset ring-blue-600' : 'hover:ring-2 hover:ring-inset hover:ring-gray-500'} disabled:cursor-default`}
                >
                  {cell ? (
                    <>
                      <span className="text-base font-bold tabular-nums">{Math.round(cell.fused)}</span>
                      <span className="flex items-center gap-1 text-xs font-semibold">
                        <BandIcon band={band} size={12} />
                        {meta.label}
                      </span>
                      {lowConf && <span className="text-[10px] font-semibold uppercase">low conf.</span>}
                    </>
                  ) : (
                    <span aria-hidden="true">–</span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="border-t bg-gray-50 px-2 py-1 text-xs text-gray-700">
        Columns are {INTERVAL_M} m intervals from the bit. Hatched cells have low confidence. Blue columns are the first 50 m (at bit, live detectors only).
      </p>
    </div>
  );
}

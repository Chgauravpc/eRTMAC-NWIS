import React from 'react';
import { BAND_META, BAND_ORDER } from '../../lib/risk';
import { BandIcon } from './BandBadge';

/** Contract §11.1 bands with what each means for the engineer (NWIS_PRD F5 table). */
export function BandLegend() {
  return (
    <section aria-label="Risk band legend" className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">What the bands mean</h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {BAND_ORDER.map((key) => {
          const m = BAND_META[key];
          return (
            <li key={key} data-band={key} className={`rounded border-l-4 border p-2 text-sm ${m.color}`}>
              <div className="flex items-center gap-2 font-semibold">
                <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm ${m.swatch}`} />
                <BandIcon band={key} />
                <span>
                  {m.range} {m.label}
                </span>
              </div>
              <div className="mt-1 text-xs">Alert: {m.alertRaised}</div>
              <div className="mt-1">{m.meaning}</div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

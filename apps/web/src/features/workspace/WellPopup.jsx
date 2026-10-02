import React from 'react';
import { Link } from 'react-router-dom';
import { useHoleSections, useWellEvents } from '../../lib/hooks/wells';
import { fmtDepth } from '../../lib/units';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';
import { countByRisk, riskLabel } from './mapGeo';

/** Popup body: name, field, TD, status, casing (hole_sections), event counts by risk type, workspace link. */
// @surface light (a Leaflet popup is white)
export function WellPopup({ well }) {
  const { data: sections, isLoading: loadingCasing } = useHoleSections(well.wellbore_id);
  const { data: events, isLoading: loadingEvents } = useWellEvents(well.wellbore_id);
  const casing = (sections || []).filter((s) => s.casing_od_in != null && s.shoe_md_m != null);
  const counts = countByRisk(events);

  return (
    <div className="min-w-[220px] p-1" data-testid="well-popup">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-base font-bold">{well.well_name}</h4>
        <ProvenanceBadge provenance={well.provenance} />
      </div>
      <div className="mb-2 space-y-0.5 text-xs text-gray-600">
        <div>Field: {well.field || '-'}</div>
        <div>Status: <span className="capitalize">{well.status}</span></div>
        <div>TD: {fmtDepth(well.td_md_m)}</div>
      </div>

      <div className="mb-2 text-xs">
        <strong>Casing</strong>
        {loadingCasing ? (
          <div className="text-gray-500">Loading…</div>
        ) : casing.length === 0 ? (
          <div className="text-gray-500">No casing recorded.</div>
        ) : (
          <ul className="mt-1 list-inside list-disc" data-testid="popup-casing">
            {casing.map((c) => (
              <li key={c.id}>{c.casing_od_in}&quot; shoe at {fmtDepth(c.shoe_md_m)}{c.planned ? ' (planned)' : ''}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-2 text-xs">
        <strong>Events by risk type</strong>
        {loadingEvents ? (
          <div className="text-gray-500">Loading…</div>
        ) : Object.keys(counts).length === 0 ? (
          <div className="text-gray-500">No events recorded.</div>
        ) : (
          <ul className="mt-1" data-testid="popup-events">
            {Object.entries(counts).map(([risk, n]) => (
              <li key={risk} data-risk={risk}>{riskLabel(risk)}: {n}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 border-t pt-2">
        <Link to={`/wells/${well.wellbore_id}/map`} className="block text-sm font-medium text-blue-700 hover:underline">
          Open workspace →
        </Link>
      </div>
    </div>
  );
}

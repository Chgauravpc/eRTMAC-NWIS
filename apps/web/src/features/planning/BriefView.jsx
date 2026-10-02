import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { RiskStrip } from '../risk/RiskStrip';
import { Printer } from 'lucide-react';
import { useWells } from '../../lib/hooks/wells';
import { fmtDistance } from '../../lib/units';

const createOffsetIcon = () =>
  L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: #4b5563; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 2px rgba(0,0,0,0.5)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

const createTargetIcon = () =>
  L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: #1d4ed8; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 2px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const PROVENANCE_NOTE = {
  synthetic: 'synthetic (generated for this demo, not a real well)',
  analog: 'analog (a comparable field or basin)',
  direct: 'direct (operator or public data)',
};

/** "2 synthetic, 1 direct" for the offsets that are known in the wells list; null when none are. */
export function provenanceSummary(offsets, provenanceByWellbore) {
  const counts = {};
  for (const o of offsets || []) {
    const p = provenanceByWellbore[o.wellbore_id];
    if (p) counts[p] = (counts[p] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([p, n]) => `${n} ${p}`);
  return { text: parts.join(', ') || null, kinds: Object.keys(counts) };
}

/** Lessons keyed by formation, in the order the formations first appear. */
export function groupLessonsByFormation(lessons) {
  const groups = new Map();
  for (const l of lessons || []) {
    const key = l.formation || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return [...groups.entries()];
}

export function BriefView({ data, requestParams }) {
  // The brief lists offsets with a distance only; their coordinates and provenance come from the wells list.
  const { data: wells } = useWells();
  const byWellbore = useMemo(() => Object.fromEntries((wells || []).map((w) => [w.wellbore_id, w])), [wells]);
  const coords = (o) => {
    const w = byWellbore[o.wellbore_id];
    return w && w.lat != null && w.lon != null ? [w.lat, w.lon] : null;
  };
  const provenanceByWellbore = useMemo(
    () => Object.fromEntries((wells || []).map((w) => [w.wellbore_id, w.provenance])),
    [wells],
  );
  if (!data) return null;

  const { location, offsets = [], predicted_tops: tops = [], risk_profile: profile = [], lessons = [] } = data;
  const td = requestParams?.planned_td_m || 3600;
  const radius = requestParams?.radius_m;
  const provenance = provenanceSummary(offsets, provenanceByWellbore);

  // 25 m rows from the surface to the planned TD for the vertical risk strip
  const intervals = Array.from({ length: Math.ceil(td / 25) }, (_, i) => ({ from: i * 25, to: (i + 1) * 25, isAtBit: false }));

  return (
    <div className="brief-container mt-8 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-8 flex items-start justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">NWIS Offset Risk Brief</h1>
          <p className="mt-1 text-sm text-gray-700">
            Location {location.lat.toFixed(4)}°, {location.lon.toFixed(4)}° · Planned TD {td} m · Radius {radius != null ? fmtDistance(radius) : '-'} ·
            Generated {new Date().toLocaleDateString()}
          </p>
          <p data-testid="provenance-note" className="mt-1 text-sm text-gray-700">
            Based on {offsets.length} offset well{offsets.length === 1 ? '' : 's'}
            {provenance.text ? ` (${provenance.text})` : ''}.
            {provenance.kinds.length > 0 && ` Data is ${provenance.kinds.map((k) => PROVENANCE_NOTE[k] || k).join('; ')}.`}{' '}
            Scores are decision support, not a prediction of certainty.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 font-medium text-gray-800 transition-colors hover:bg-gray-200"
        >
          <Printer aria-hidden="true" className="h-4 w-4" /> Print / save as PDF
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left: map, offsets, predicted tops */}
        <div className="space-y-6 lg:col-span-1">
          <section className="avoid-break">
            <h2 className="mb-3 border-b pb-1 text-lg font-bold text-gray-800">Location map</h2>
            <div className="relative z-0 h-64 overflow-hidden rounded-lg border border-gray-300">
              <MapContainer center={[location.lat, location.lon]} zoom={11} className="h-full w-full" zoomControl={false}>
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[location.lat, location.lon]} icon={createTargetIcon()}>
                  <Popup>Planned location</Popup>
                </Marker>
                {radius != null && <Circle center={[location.lat, location.lon]} radius={radius} pathOptions={{ color: '#1d4ed8', fillOpacity: 0.05 }} />}
                {offsets.filter(coords).map((o) => (
                  <Marker key={o.wellbore_id} position={coords(o)} icon={createOffsetIcon()}>
                    <Popup>
                      {o.well_name} ({fmtDistance(o.surface_distance_m)} away)
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </section>

          <section className="avoid-break">
            <h2 className="mb-3 border-b pb-1 text-lg font-bold text-gray-800">Offset wells ({offsets.length})</h2>
            {offsets.length > 0 ? (
              <table className="w-full text-sm" data-testid="offsets-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Well</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Distance</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {offsets.map((o) => (
                    <tr key={o.wellbore_id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-900">{o.well_name}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmtDistance(o.surface_distance_m)}</td>
                      <td className="px-3 py-2 capitalize text-gray-700">{provenanceByWellbore[o.wellbore_id] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-700">No offset wells within {radius != null ? fmtDistance(radius) : 'the radius'}. Widen the radius.</p>
            )}
          </section>

          <section className="avoid-break">
            <h2 className="mb-3 border-b pb-1 text-lg font-bold text-gray-800">Predicted tops</h2>
            {tops.length > 0 ? (
              <table className="w-full text-sm" data-testid="tops-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Formation</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">MD (m)</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">±</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Offsets</th>
                  </tr>
                </thead>
                <tbody>
                  {tops.map((t) => (
                    <tr key={t.formation} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-900">{t.formation}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{Math.round(t.top_md_m)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{t.uncertainty_m != null ? `${Math.round(t.uncertainty_m)} m` : '-'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{t.n_offsets ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-700">Not enough offset wells with this formation to predict a top.</p>
            )}
          </section>
        </div>

        {/* Middle: risk profile (scrolls on screen, flows in print) */}
        <div className="flex flex-col lg:col-span-1">
          <h2 className="mb-3 shrink-0 border-b pb-1 text-lg font-bold text-gray-800">Risk profile (0 – {td} m)</h2>
          <div className="print-scroll max-h-[800px] overflow-y-auto" tabIndex={0} aria-label="Risk profile, scrollable">
            <RiskStrip scores={profile} orientation="vertical" customIntervals={intervals} />
          </div>
        </div>

        {/* Right: lessons per formation */}
        <div className="space-y-6 lg:col-span-1">
          <section>
            <h2 className="mb-3 border-b pb-1 text-lg font-bold text-gray-800">Key lessons learned</h2>
            {lessons.length > 0 ? (
              <div className="space-y-5">
                {groupLessonsByFormation(lessons).map(([formation, list]) => (
                  <div key={formation} className="avoid-break" data-testid={`lessons-${formation}`}>
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-orange-900">{formation}</h3>
                    <div className="space-y-3">
                      {list.map((l) => (
                        <div key={l.id} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                          <p className="mb-1 text-sm font-semibold text-gray-900">{l.title}</p>
                          <p className="mb-2 text-sm text-gray-800">{l.mitigation}</p>
                          <p className="text-xs font-medium text-gray-700">
                            Seen in {l.well_count} offset well{l.well_count === 1 ? '' : 's'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-700">No lessons are recorded for the risky formations of this profile.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

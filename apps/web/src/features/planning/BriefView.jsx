import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { RiskStrip } from '../risk/RiskStrip';
import { Printer } from 'lucide-react';

const createOffsetIcon = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: gray; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 2px rgba(0,0,0,0.5)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

const createTargetIcon = () => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: blue; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 2px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
};

export function BriefView({ data, requestParams }) {
  if (!data) return null;

  const { location, offsets, predicted_tops, risk_profile, lessons } = data;
  const td = requestParams?.planned_td_m || 3600;

  // Generate intervals of 25m from 0 to TD for the vertical risk strip
  const intervals = Array.from({ length: Math.ceil(td / 25) }, (_, i) => {
    return { from: i * 25, to: (i + 1) * 25, isAtBit: false };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-8 p-8 brief-container">
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Well Planning Brief</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generated on {new Date().toLocaleDateString()} • Target TD: {td}m • Radius: {requestParams?.radius_m}m
          </p>
        </div>
        <button 
          onClick={() => window.print()} 
          className="no-print flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Printer className="w-4 h-4" /> Print A4
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Overview & Map */}
        <div className="lg:col-span-1 space-y-6">
          <section className="avoid-break">
            <h3 className="text-lg font-bold text-gray-800 mb-3 border-b pb-1">Location Map</h3>
            <div className="h-64 rounded-lg overflow-hidden border border-gray-300 relative z-0">
              <MapContainer center={[location.lat, location.lon]} zoom={11} className="w-full h-full" zoomControl={false}>
                <TileLayer
                  attribution='&copy; OSM'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={[location.lat, location.lon]} icon={createTargetIcon()}>
                  <Popup>Target Location</Popup>
                </Marker>
                <Circle center={[location.lat, location.lon]} radius={requestParams?.radius_m} pathOptions={{ color: 'blue', fillOpacity: 0.05 }} />
                
                {offsets?.map(o => (
                  <Marker key={o.wellbore_id} position={[location.lat + (Math.random()-0.5)*0.05, location.lon + (Math.random()-0.5)*0.05]} icon={createOffsetIcon()}>
                     {/* Mocking offset lat/lon since the API only returns surface_distance_m according to the contract, unless we had exact coords */}
                    <Popup>{o.well_name} ({Math.round(o.surface_distance_m)}m away)</Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            <div className="text-sm text-gray-600 mt-2">
              Found <strong>{offsets?.length || 0}</strong> offset wells within {requestParams?.radius_m}m.
            </div>
          </section>

          <section className="avoid-break">
            <h3 className="text-lg font-bold text-gray-800 mb-3 border-b pb-1">Predicted Tops</h3>
            {predicted_tops?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-semibold">Formation</th>
                    <th className="py-2 px-3 text-right font-semibold">MD (m)</th>
                    <th className="py-2 px-3 text-right font-semibold">Uncertainty</th>
                  </tr>
                </thead>
                <tbody>
                  {predicted_tops.map(t => (
                    <tr key={t.formation} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 px-3 font-medium text-gray-800">{t.formation}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{t.top_md_m}</td>
                      <td className="py-2 px-3 text-right text-gray-500">±{t.uncertainty_m}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-500">No predictions available.</p>
            )}
          </section>
        </div>

        {/* Middle Col: Risk Profile */}
        <div className="lg:col-span-1 h-[800px] flex flex-col avoid-break">
          <h3 className="text-lg font-bold text-gray-800 mb-3 border-b pb-1 shrink-0">Risk Profile (0 - {td}m)</h3>
          <div className="flex-1 overflow-hidden">
            <RiskStrip 
              scores={risk_profile || []} 
              orientation="vertical"
              customIntervals={intervals}
            />
          </div>
        </div>

        {/* Right Col: Lessons Learned */}
        <div className="lg:col-span-1 space-y-6">
          <section>
            <h3 className="text-lg font-bold text-gray-800 mb-3 border-b pb-1">Key Lessons Learned</h3>
            {lessons?.length > 0 ? (
              <div className="space-y-4">
                {lessons.map(l => (
                  <div key={l.id} className="bg-orange-50 border border-orange-100 p-4 rounded-lg avoid-break">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-orange-700 bg-orange-200 px-2 py-0.5 rounded uppercase">{l.formation}</span>
                      <span className="text-sm font-semibold text-gray-800">{l.title}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{l.mitigation}</p>
                    <p className="text-xs text-gray-500 font-medium">Derived from {l.well_count} offset events</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No specific lessons found for this profile.</p>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}

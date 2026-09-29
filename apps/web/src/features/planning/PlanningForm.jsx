import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function MapClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export function PlanningForm({ onSubmit, loading }) {
  const [lat, setLat] = useState('27.35');
  const [lon, setLon] = useState('95.30');
  const [td, setTd] = useState('3600');
  const [radius, setRadius] = useState('10000');
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!lat || isNaN(lat) || lat < -90 || lat > 90) errs.lat = 'Invalid Latitude';
    if (!lon || isNaN(lon) || lon < -180 || lon > 180) errs.lon = 'Invalid Longitude';
    if (!td || isNaN(td) || td <= 0) errs.td = 'TD must be > 0';
    if (!radius || isNaN(radius) || radius <= 0) errs.radius = 'Radius must be > 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({
        lat: Number(lat),
        lon: Number(lon),
        planned_td_m: Number(td),
        radius_m: Number(radius)
      });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 no-print">
      <h2 className="text-xl font-bold text-gray-800 mb-6">New Well Planning</h2>
      
      <div className="flex flex-col md:flex-row gap-8">
        <form onSubmit={handleSubmit} className="w-full md:w-1/3 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Location (Lat / Lon)</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                className={`w-full border rounded-md p-2 text-sm ${errors.lat ? 'border-red-500' : 'border-gray-300'}`}
                placeholder="Lat"
                value={lat}
                onChange={e => setLat(e.target.value)}
                data-testid="lat-input"
              />
              <input
                type="number"
                step="any"
                className={`w-full border rounded-md p-2 text-sm ${errors.lon ? 'border-red-500' : 'border-gray-300'}`}
                placeholder="Lon"
                value={lon}
                onChange={e => setLon(e.target.value)}
                data-testid="lon-input"
              />
            </div>
            {(errors.lat || errors.lon) && <p className="text-red-500 text-xs mt-1">{errors.lat || errors.lon}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Planned TD (m)</label>
            <input
              type="number"
              className={`w-full border rounded-md p-2 text-sm ${errors.td ? 'border-red-500' : 'border-gray-300'}`}
              value={td}
              onChange={e => setTd(e.target.value)}
              data-testid="td-input"
            />
            {errors.td && <p className="text-red-500 text-xs mt-1">{errors.td}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Radius (m)</label>
            <input
              type="number"
              className={`w-full border rounded-md p-2 text-sm ${errors.radius ? 'border-red-500' : 'border-gray-300'}`}
              value={radius}
              onChange={e => setRadius(e.target.value)}
              data-testid="radius-input"
            />
            {errors.radius && <p className="text-red-500 text-xs mt-1">{errors.radius}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? 'Generating Brief...' : 'Generate Planning Brief'}
          </button>
        </form>

        <div className="w-full md:w-2/3 h-64 md:h-auto min-h-[300px] border border-gray-300 rounded-lg overflow-hidden relative">
          <MapContainer center={[27.35, 95.30]} zoom={10} className="w-full h-full z-0">
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler onClick={(lat, lon) => {
              setLat(lat.toFixed(5));
              setLon(lon.toFixed(5));
            }} />
            {lat && lon && !isNaN(lat) && !isNaN(lon) && (
              <Marker position={[Number(lat), Number(lon)]} />
            )}
          </MapContainer>
          <div className="absolute top-2 right-2 bg-white/90 px-3 py-1 text-xs font-medium rounded shadow-sm z-[400] pointer-events-none text-gray-600">
            Click map to pick location
          </div>
        </div>
      </div>
    </div>
  );
}

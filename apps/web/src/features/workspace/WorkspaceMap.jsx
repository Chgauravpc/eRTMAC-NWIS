import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { RadiusControl } from './RadiusControl';
import { OffsetList } from './OffsetList';
import { WellPopup } from './WellPopup';
import { useMapData } from './useMapData';
import { useParams } from 'react-router-dom';

// Fix leafet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const getRiskColor = (risk) => {
  switch (risk) {
    case 'losses': return 'blue';
    case 'stuck_pipe': return 'orange';
    case 'kick': return 'red';
    case 'torque': return 'purple';
    case 'cementing': return 'brown';
    default: return 'gray';
  }
};

const createMarkerIcon = (color, isActive = false) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: ${isActive ? '20px' : '12px'}; height: ${isActive ? '20px' : '12px'}; border-radius: 50%; border: 2px solid ${isActive ? 'white' : 'black'}; ${isActive ? 'box-shadow: 0 0 0 2px ' + color : ''}"></div>`,
    iconSize: isActive ? [24, 24] : [12, 12],
    iconAnchor: isActive ? [12, 12] : [6, 6]
  });
};

export default function WorkspaceMap() {
  const { wellboreId } = useParams();
  const [params, setParams] = useState({
    radius: 10000,
    depth: null,
    mode: 'surface',
    formation: '',
    eventType: '',
    provenance: ''
  });

  const { activeWell, offsets, trajectories, activeTrajectory, isLoading } = useMapData(wellboreId, params);

  const position = activeWell ? [activeWell.lat, activeWell.lon] : [27.35, 95.30];

  return (
    <div className="flex h-full gap-4">
      <div className="w-2/3 h-full relative rounded-xl overflow-hidden border border-gray-200">
        <MapContainer center={position} zoom={11} className="w-full h-full">
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {activeWell && (
            <>
              <Circle center={[activeWell.lat, activeWell.lon]} radius={params.radius} pathOptions={{ color: 'blue', fillOpacity: 0.05 }} />
              <Marker position={[activeWell.lat, activeWell.lon]} icon={createMarkerIcon(getRiskColor(activeWell.top_risk_type), true)}>
                <Popup>
                  <WellPopup well={activeWell} />
                </Popup>
              </Marker>
            </>
          )}

          {offsets?.map(offset => (
            <React.Fragment key={offset.wellbore_id}>
              {params.mode === 'depth' && offset.depth_lat && offset.depth_lon && (
                <Marker position={[offset.depth_lat, offset.depth_lon]} icon={createMarkerIcon('black', false)}>
                  <Popup>At depth: {params.depth}m</Popup>
                </Marker>
              )}
              <Marker position={[offset.lat, offset.lon]} icon={createMarkerIcon(getRiskColor(offset.top_risk_type), false)}>
                <Popup>
                  <WellPopup well={offset} />
                </Popup>
              </Marker>
            </React.Fragment>
          ))}

          {activeTrajectory && <GeoJSON data={activeTrajectory.geojson} style={{ color: 'blue', weight: 3 }} />}
          {trajectories?.map(t => (
            <GeoJSON key={t.wellbore_id} data={t.geojson} style={{ color: 'gray', weight: 1, opacity: 0.5 }} />
          ))}
        </MapContainer>
        <RadiusControl params={params} onChange={setParams} />
      </div>
      
      <div className="w-1/3 bg-white p-4 rounded-xl border border-gray-200 overflow-y-auto">
        <OffsetList offsets={offsets} mode={params.mode} isLoading={isLoading} />
      </div>
    </div>
  );
}

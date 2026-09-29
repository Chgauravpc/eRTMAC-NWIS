import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, GeoJSON, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  useEventsForOffsets,
  useFormations,
  useOffsets,
  useStreamState,
  useSurveyStations,
  useTrajectories,
  useWellPositionAtMd,
  useWells,
  useWellSummary,
} from '../../lib/hooks/wells';
import { RadiusControl } from './RadiusControl';
import { OffsetList } from './OffsetList';
import { WellPopup } from './WellPopup';
import { ErrorBlock, LoadingBlock } from '../wells/StateBlocks';
import { RISK_LABELS } from '../../lib/constants';
import {
  DEFAULT_MAP_PARAMS,
  NO_RISK_COLOR,
  RISK_COLORS,
  circleBounds,
  countMatchingEvents,
  effectiveDepth,
  filterOffsets,
  positionAtTvd,
  riskColor,
  sortOffsets,
} from './mapGeo';

const ACCENT = '#3b82f6';

function activeIcon(color) {
  return L.divIcon({
    className: 'active-well-marker',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #1e293b;box-shadow:0 0 0 3px ${ACCENT},0 1px 4px rgba(0,0,0,.5)"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

const depthIcon = L.divIcon({
  className: 'active-depth-marker',
  html: `<div style="width:12px;height:12px;transform:rotate(45deg);background:${ACCENT};border:2px solid #1e293b"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Debounced copy of `value` (PRD FE-05: 300 ms). Until `ready` it holds nothing; on the first ready render it
 * adopts the current value at once (no request with a stale placeholder), afterwards it trails by `delay`.
 */
function useDebouncedAfter(value, ready, delay = 300) {
  const [state, setState] = useState({ v: value, synced: false });
  if (ready && !state.synced) setState({ v: value, synced: true });
  useEffect(() => {
    if (!state.synced) return undefined;
    const t = setTimeout(() => setState((s) => ({ ...s, v: value })), delay);
    return () => clearTimeout(t);
  }, [value, delay, state.synced]);
  return state.v;
}

/** Fits the radius circle on well/radius change and pans to a selected offset. */
function MapController({ center, radiusM, target }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    try {
      map.fitBounds(circleBounds(center, radiusM), { padding: [16, 16], animate: false });
    } catch {
      /* zero-size container (tests) */
    }
  }, [map, center, radiusM]);
  useEffect(() => {
    if (!target) return;
    try {
      map.setView([target.lat, target.lon], Math.max(map.getZoom(), 12), { animate: true });
    } catch {
      /* zero-size container (tests) */
    }
  }, [map, target]);
  return null;
}

const WellDot = memo(function WellDot({ well, dimmed, selected, isOpen, setRef, onOpen, onClose }) {
  const handlers = useMemo(
    () => ({ popupopen: () => onOpen(well.wellbore_id), popupclose: () => onClose(well.wellbore_id) }),
    [onOpen, onClose, well.wellbore_id],
  );
  return (
    <CircleMarker
      ref={(el) => setRef(well.wellbore_id, el)}
      center={[well.lat, well.lon]}
      radius={selected ? 9 : 6}
      pathOptions={{
        color: selected ? ACCENT : '#1e293b',
        weight: selected ? 3 : 1,
        fillColor: riskColor(well.top_risk_type),
        fillOpacity: dimmed ? 0.25 : 0.95,
        opacity: dimmed ? 0.4 : 1,
      }}
      eventHandlers={handlers}
    >
      <Popup>{isOpen ? <WellPopup well={well} /> : null}</Popup>
    </CircleMarker>
  );
});

export function MapLegend() {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500" aria-label="Map legend">
      {Object.entries(RISK_COLORS).map(([risk, color]) => (
        <li key={risk} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-gray-700/50" style={{ background: color }} />
          {RISK_LABELS[risk]}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-gray-700/50" style={{ background: NO_RISK_COLOR }} />
        No risk recorded
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3.5 w-3.5 rounded-full border-2 border-gray-900 bg-gray-500 ring-2 ring-blue-500" />
        Active well
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rotate-45 bg-blue-500" />
        Depth position
      </li>
    </ul>
  );
}

export default function WorkspaceMap() {
  const { wellboreId } = useParams();
  const [params, setParams] = useState(DEFAULT_MAP_PARAMS);
  const [selectedId, setSelectedId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const markerRefs = useRef({});

  const { data: activeWell, error: wellError, refetch: refetchWell } = useWellSummary(wellboreId);
  const { data: stream, isLoading: streamLoading } = useStreamState(wellboreId, { live: false });
  const { data: allWells } = useWells();
  const { data: formationRows } = useFormations();
  const { data: trajectories } = useTrajectories();

  const td = activeWell?.td_md_m ?? 0;
  const bitMd = stream?.bit_md_m ?? null;
  // Default = current bit depth; wells without a live bit fall back to TD. Always inside 0..TD.
  const depth = effectiveDepth(params.depth, bitMd ?? (activeWell ? td : null), td);
  const ready = Boolean(activeWell) && !streamLoading;

  // Query parameters are debounced 300 ms (PRD FE-05); the circle follows the slider immediately.
  const liveQuery = useMemo(() => ({ radius: params.radius, md: depth, mode: params.mode }), [params.radius, depth, params.mode]);
  const { radius: qRadius, md: qDepth, mode: qMode } = useDebouncedAfter(liveQuery, ready); // one request per burst of changes

  const offsetsQ = useOffsets(ready ? wellboreId : null, qRadius, qDepth, qMode);

  const filtersActive = Boolean(params.formation || params.eventType);
  const eventsQ = useEventsForOffsets(ready ? wellboreId : null, qRadius, params.formation ? [params.formation] : null, {
    limit: 1000,
    enabled: filtersActive,
  });
  const matchCounts = useMemo(
    () => (filtersActive && eventsQ.data ? countMatchingEvents(eventsQ.data, params.eventType) : null),
    [filtersActive, eventsQ.data, params.eventType],
  );
  const visible = useMemo(
    () => sortOffsets(filterOffsets(offsetsQ.data, { provenance: params.provenance, matchCounts }), qMode),
    [offsetsQ.data, params.provenance, matchCounts, qMode],
  );
  const visibleIds = useMemo(() => new Set(visible.map((o) => o.wellbore_id)), [visible]);

  const basinFormations = useMemo(
    () => (formationRows || []).filter((f) => !activeWell?.basin || f.basin === activeWell.basin).map((f) => f.name),
    [formationRows, activeWell],
  );

  // Depth mode: where each offset is at the TVD the active well has at the chosen MD.
  const depthMode = qMode === 'depth';
  const { data: activePos } = useWellPositionAtMd(wellboreId, qDepth, depthMode && ready);
  const { data: stations } = useSurveyStations(visible.map((o) => o.wellbore_id), depthMode && ready);
  const depthPoints = useMemo(() => {
    if (!depthMode || !activePos) return [];
    const byWell = {};
    (stations || []).forEach((s) => (byWell[s.wellbore_id] ||= []).push(s));
    return visible
      .map((o) => {
        const p = positionAtTvd(byWell[o.wellbore_id], activePos.tvd_m, { lat: o.lat, lon: o.lon });
        return p && { id: o.wellbore_id, name: o.well_name, from: [o.lat, o.lon], to: [p.lat, p.lon], md: p.md_m };
      })
      .filter(Boolean);
  }, [depthMode, activePos, stations, visible]);

  const activeTraj = useMemo(() => trajectories?.find((t) => t.wellbore_id === wellboreId), [trajectories, wellboreId]);
  const otherTrajs = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (trajectories || [])
        .filter((t) => t.wellbore_id !== wellboreId)
        .map((t) => ({ type: 'Feature', properties: { well_name: t.well_name }, geometry: t.geojson })),
    }),
    [trajectories, wellboreId],
  );

  const setRef = useCallback((id, el) => {
    if (el) markerRefs.current[id] = el;
    else delete markerRefs.current[id];
  }, []);
  const onOpen = useCallback((id) => setOpenId(id), []);
  const onClose = useCallback((id) => setOpenId((cur) => (cur === id ? null : cur)), []);

  const activeHandlers = useMemo(
    () => ({ popupopen: () => onOpen(wellboreId), popupclose: () => onClose(wellboreId) }),
    [onOpen, onClose, wellboreId],
  );

  const [target, setTarget] = useState(null);
  const onSelect = useCallback(
    (id) => {
      setSelectedId(id);
      const o = (offsetsQ.data || []).find((x) => x.wellbore_id === id);
      if (o) setTarget({ lat: o.lat, lon: o.lon, id, n: Date.now() });
      // the popup opens once the marker exists; refs are set for every well drawn
      setOpenId(id);
      setTimeout(() => markerRefs.current[id]?.openPopup?.(), 0);
    },
    [offsetsQ.data],
  );

  if (wellError) return <ErrorBlock message="Could not load this well." onRetry={() => refetchWell()} />;
  if (!activeWell) return <LoadingBlock label="Loading map…" />;

  const center = { lat: activeWell.lat, lon: activeWell.lon };
  const listLoading = offsetsQ.isLoading || (filtersActive && eventsQ.isLoading);

  return (
    <div className="grid h-full min-h-[560px] gap-6 lg:grid-cols-3" data-testid="map-panel">
      <div className="flex min-h-[480px] flex-col gap-4 lg:col-span-2">
        <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-800/60 shadow-lg shadow-black/20">
          <MapContainer center={[center.lat, center.lon]} zoom={11} preferCanvas className="h-full min-h-[440px] w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <MapController center={center} radiusM={qRadius} target={target} />

            <Circle center={[center.lat, center.lon]} radius={params.radius} pathOptions={{ color: ACCENT, weight: 2, dashArray: '6 4', fillOpacity: 0.1 }} />

            {otherTrajs.features.length > 0 && (
              <GeoJSON key={`others-${otherTrajs.features.length}-${wellboreId}`} data={otherTrajs} style={{ color: '#4b5563', weight: 1, opacity: 0.6 }} />
            )}
            {activeTraj && <GeoJSON key={`active-${wellboreId}`} data={activeTraj.geojson} style={{ color: ACCENT, weight: 3 }} />}

            {(allWells || [])
              .filter((w) => w.wellbore_id !== wellboreId && w.lat != null && w.lon != null)
              .map((w) => (
                <WellDot
                  key={w.wellbore_id}
                  well={w}
                  dimmed={!visibleIds.has(w.wellbore_id)}
                  selected={selectedId === w.wellbore_id}
                  isOpen={openId === w.wellbore_id}
                  setRef={setRef}
                  onOpen={onOpen}
                  onClose={onClose}
                />
              ))}

            {depthPoints.map((p) => (
              <React.Fragment key={p.id}>
                <Polyline positions={[p.from, p.to]} pathOptions={{ color: '#cbd5e1', weight: 1, dashArray: '3 4', opacity: 0.5 }} />
                <CircleMarker center={p.to} radius={4} pathOptions={{ color: '#94a3b8', weight: 2, fillColor: '#1e293b', fillOpacity: 1 }}>
                  <Popup>{p.name} at the same TVD (MD {Math.round(p.md)} m)</Popup>
                </CircleMarker>
              </React.Fragment>
            ))}
            {depthMode && activePos && <Marker position={[activePos.lat, activePos.lon]} icon={depthIcon} title="Active well at chosen depth" />}

            <Marker
              position={[center.lat, center.lon]}
              icon={activeIcon(riskColor(activeWell.top_risk_type))}
              title={activeWell.well_name}
              eventHandlers={activeHandlers}
            >
              <Popup>{openId === wellboreId ? <WellPopup well={activeWell} /> : null}</Popup>
            </Marker>
          </MapContainer>
        </div>
        <MapLegend />
      </div>

      <div className="flex flex-col gap-6 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-800">
        <RadiusControl
          params={params}
          onChange={setParams}
          maxDepth={td}
          depth={depth ?? 0}
          bitMd={bitMd}
          formations={basinFormations}
        />
        <div className="rounded-xl border border-gray-800/60 bg-[#111827] shadow-lg shadow-black/20 p-5">
          <OffsetList
            offsets={visible}
            mode={qMode}
            isLoading={listLoading}
            error={offsetsQ.error}
            onRetry={() => offsetsQ.refetch()}
            radiusM={qRadius}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

export { WorkspaceMap };

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Popup,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ShieldAlert,
  Activity,
  Compass,
  Layers,
  Radio,
  Database,
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  Sliders,
  Zap,
  AlertTriangle,
  Gauge,
  Cpu,
  Monitor,
  Tablet,
  Search,
  FileCheck2,
  HardHat,
  ChevronDown,
  MapPin,
  Crosshair,
  ExternalLink,
  Navigation,
} from 'lucide-react';
import { useProfile } from '../auth/useProfile';
import { roleHome } from '../auth/roleHome';

// Regional offset wells in Upper Assam Basin (Duliajan Field Block)
const REGIONAL_WELLS = [
  {
    id: 'SYN-DLJ-03',
    name: 'SYN-DLJ-03',
    role: 'Active Drilling Bit',
    isActive: true,
    lat: 27.3600,
    lon: 95.3100,
    md: 2845,
    tvd: 2780,
    formation: 'Barail Coal-Shale',
    hazardType: 'Active Telemetry Stream',
    riskLevel: 'Active',
    riskScore: 76.5,
    riskColor: '#10b981',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    distanceKm: 0,
    historicalSummary:
      'Primary operational wellbore. Bit currently in Barail formation at 2,845 m MD with real-time gamma ray, ROP, and torque streaming.',
    mitigation:
      'Monitor for differential sticking and coal sloughing ahead of upcoming connection. Keep string rotating continuously.',
  },
  {
    id: 'SYN-DLJ-05',
    name: 'SYN-DLJ-05',
    role: 'Historical Offset',
    isActive: false,
    lat: 27.3685,
    lon: 95.2950,
    md: 3120,
    tvd: 3050,
    formation: 'Tipam Sandstone / Barail',
    hazardType: 'High Mud Losses',
    riskLevel: 'Elevated',
    riskScore: 58.2,
    riskColor: '#f59e0b',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-300',
    distanceKm: 1.85,
    historicalSummary:
      'Encountered 15 m³/h partial mud losses at 2,425 m in porous Tipam interval during drilling in 2023.',
    mitigation:
      'Pre-treat active mud system with 30 m³ high-fluid LCM pill before bit passes 2,420 m.',
  },
  {
    id: 'SYN-DLJ-02',
    name: 'SYN-DLJ-02',
    role: 'Historical Offset',
    isActive: false,
    lat: 27.3510,
    lon: 95.3320,
    md: 2980,
    tvd: 2920,
    formation: 'Barail Coal-Shale',
    hazardType: 'Differential Sticking',
    riskLevel: 'High',
    riskScore: 78.4,
    riskColor: '#ea580c',
    badgeColor: 'bg-orange-50 text-orange-800 border-orange-300',
    distanceKm: 2.42,
    historicalSummary:
      'String seized for 18 hours NPT at 2,892 m due to coal sloughing and overbalanced mud hydrostatic pressure.',
    mitigation:
      'Maintain drill string in continuous rotation; circulate bottoms up thoroughly before connections.',
  },
  {
    id: 'SYN-DLJ-01',
    name: 'SYN-DLJ-01',
    role: 'Historical Offset',
    isActive: false,
    lat: 27.3390,
    lon: 95.2920,
    md: 2450,
    tvd: 2410,
    formation: 'Girujan Clay',
    hazardType: 'Reactive Clay Swelling',
    riskLevel: 'Low',
    riskScore: 22.0,
    riskColor: '#10b981',
    badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    distanceKm: 2.95,
    historicalSummary:
      'Minor reactive clay swelling observed in upper Girujan section. Successfully drilled without stuck pipe incident.',
    mitigation:
      'Maintain mud weight at 1.12 SG; monitor shaker screen cuttings integrity.',
  },
  {
    id: 'SYN-DLJ-04',
    name: 'SYN-DLJ-04',
    role: 'Historical Offset',
    isActive: false,
    lat: 27.3820,
    lon: 95.3340,
    md: 3600,
    tvd: 3510,
    formation: 'Kopili Formation',
    hazardType: 'Gas Kick Influx',
    riskLevel: 'Moderate',
    riskScore: 44.5,
    riskColor: '#0284c7',
    badgeColor: 'bg-sky-50 text-sky-800 border-sky-300',
    distanceKm: 3.40,
    historicalSummary:
      'Overpressured gas pocket (+0.08 SG EMW) encountered at 3,450 m; 4 bbl kick promptly shut in at choke manifold.',
    mitigation:
      'Execute flow check before penetrating Kopili top. Ensure trip tank audio float alarm is armed.',
  },
  {
    id: 'SYN-NHK-01',
    name: 'SYN-NHK-01',
    role: 'Regional Exploration',
    isActive: false,
    lat: 27.3320,
    lon: 95.2610,
    md: 3750,
    tvd: 3640,
    formation: 'Nahorkatiya Barail Deep',
    hazardType: 'Torque & Drag Spikes',
    riskLevel: 'High',
    riskScore: 71.8,
    riskColor: '#ea580c',
    badgeColor: 'bg-orange-50 text-orange-800 border-orange-300',
    distanceKm: 4.80,
    historicalSummary:
      'Excessive mechanical torque (>28 kNm) recorded through deep interbedded coal streaks.',
    mitigation:
      'Add lubricity copolymer beads to active mud system; perform wiper trip every 150 metres.',
  },
];

// Formation horizons with Assam basin geological depth ranges and known offset hazards
const FORMATION_PRESETS = [
  {
    name: 'Girujan Clay',
    depth: 1850,
    lithology: 'Claystone & Silt',
    hazard: {
      type: 'Borehole Stability',
      risk: 22.4,
      band: 'Low',
      bandColor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      evidence: 'Stable formation. Minor reactive clay swelling noted in offset SYN-DLJ-01 at 1,840 m.',
      mitigation: 'Maintain mud weight at 1.12 SG; monitor shale shaker cuttings integrity.',
    },
    telemetry: { rop: 18.2, wob: 10.5, rpm: 120, spp: 2450 },
  },
  {
    name: 'Tipam Sandstone',
    depth: 2395,
    lithology: 'Porous Sandstone',
    hazard: {
      type: 'High Mud Losses',
      risk: 58.2,
      band: 'Elevated',
      bandColor: 'text-amber-800 bg-amber-50 border-amber-300',
      evidence: 'Offset SYN-DLJ-05 (1.85 km away) encountered 15 m³/h partial losses at relative depth 0.62.',
      mitigation: 'Pre-mix 30 m³ high-fluid LCM pill before bit reaches 2,425 m. Restrict pump rate to 2,400 L/min.',
    },
    telemetry: { rop: 14.8, wob: 12.8, rpm: 110, spp: 2680 },
  },
  {
    name: 'Barail Coal-Shale',
    depth: 2880,
    lithology: 'Interbedded Coal & Shale',
    hazard: {
      type: 'Differential Sticking',
      risk: 76.5,
      band: 'High',
      bandColor: 'text-orange-800 bg-orange-50 border-orange-300',
      evidence: 'Offset BRL-04 suffered stuck pipe incident (18 hrs NPT) due to coal sloughing at 2,892 m.',
      mitigation: 'Keep drill string in continuous rotation; circulate bottoms up before connections.',
    },
    telemetry: { rop: 8.4, wob: 16.2, rpm: 85, spp: 3100 },
  },
  {
    name: 'Kopili Formation',
    depth: 3450,
    lithology: 'Carbonaceous Marl',
    hazard: {
      type: 'Gas Kick Influx',
      risk: 44.0,
      band: 'Moderate',
      bandColor: 'text-sky-800 bg-sky-50 border-sky-300',
      evidence: 'Overpressured gas pocket detected in offset KPL-02 (+0.08 SG equivalent mud weight).',
      mitigation: 'Perform flow check prior to penetrating Kopili top. Have trip tank aligned with float sensor.',
    },
    telemetry: { rop: 6.1, wob: 18.0, rpm: 75, spp: 3350 },
  },
];

function MapViewController({ targetWell, resetSignal }) {
  const map = useMap();

  useEffect(() => {
    if (targetWell) {
      map.flyTo([targetWell.lat, targetWell.lon], Math.max(map.getZoom(), 12.8), {
        duration: 0.8,
      });
    }
  }, [map, targetWell]);

  useEffect(() => {
    if (resetSignal) {
      map.flyTo([27.3600, 95.3100], 12.4, { duration: 0.8 });
    }
  }, [map, resetSignal]);

  return null;
}

// Real Map Layer Providers (100% Free, Zero Watermark, No API Key Required)
const MAP_LAYERS = {
  street: {
    name: 'Real Map (OSM)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    maxZoom: 18,
  },
};

export function LandingPage() {
  const { session, profile } = useProfile();
  const loggedIn = !!(session && profile);
  const homePath = profile ? roleHome(profile) : '/wells';

  // Interactive Map State
  const [mapLayerType, setMapLayerType] = useState('street'); // 'street' (real OSM) or 'satellite' (real Esri)
  const [selectedRadius, setSelectedRadius] = useState(3000); // 3.0 km default buffer
  const [selectedWell, setSelectedWell] = useState(REGIONAL_WELLS[0]); // Default to SYN-DLJ-03
  const [mapTargetWell, setMapTargetWell] = useState(null);
  const [resetSignal, setResetSignal] = useState(0);

  const wellsWithinRadius = REGIONAL_WELLS.filter(
    (w) => w.distanceKm * 1000 <= selectedRadius
  );

  const handleSelectWell = (well) => {
    setSelectedWell(well);
    setMapTargetWell(well);
  };

  const handleResetMap = () => {
    setSelectedWell(REGIONAL_WELLS[0]);
    setMapTargetWell(null);
    setResetSignal((prev) => prev + 1);
  };

  // Interactive Simulator State
  const [selectedFormationIndex, setSelectedFormationIndex] = useState(1);
  const currentScenario = FORMATION_PRESETS[selectedFormationIndex];
  const [interactiveDepth, setInteractiveDepth] = useState(currentScenario.depth);

  // Handle Preset Selection
  const handleSelectPreset = (index) => {
    setSelectedFormationIndex(index);
    setInteractiveDepth(FORMATION_PRESETS[index].depth);
  };

  // Dynamic role workspace preview switcher
  const [activeRoleTab, setActiveRoleTab] = useState('rig');

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-900 selection:text-white">

      {/* 2. Top Header / Navbar */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-neutral-950 flex items-center justify-center text-white font-bold font-display text-base shadow-sm">
              N
            </div>
            <div>
              <span className="font-display font-bold text-lg tracking-tight text-neutral-950 block leading-tight">
                eRTMAC-NWIS
              </span>
              <span className="text-[11px] text-neutral-500 font-medium block leading-none">
                Nearby Wells Intelligence System
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600">
            <a href="#map" className="hover:text-neutral-950 transition-colors">
              Field Map
            </a>
            <a href="#simulator" className="hover:text-neutral-950 transition-colors">
              Lookahead Simulator
            </a>
            <a href="#capabilities" className="hover:text-neutral-950 transition-colors">
              Capabilities
            </a>
            <a href="#workspaces" className="hover:text-neutral-950 transition-colors">
              Role Workspaces
            </a>
            <a href="#architecture" className="hover:text-neutral-950 transition-colors">
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {loggedIn ? (
              <Link
                to={homePath}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-all shadow-sm"
              >
                <span>Console ({profile.full_name?.split(' ')[0] || 'Dashboard'})</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 transition-all shadow-sm hover:shadow"
              >
                <span>Sign In</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 3. Hero Section: Clean, Authoritative & Architectural */}
      <section className="relative pt-12 pb-16 md:pt-16 md:pb-20 overflow-hidden bg-white">
        {/* Subtle Architectural Blueprint Grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{
            backgroundImage: `radial-gradient(#000 1.2px, transparent 1.2px)`,
            backgroundSize: '28px 28px',
          }}
        />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-950 leading-[1.12] mb-6">
            Predict drilling hazards{' '}
            <span className="block text-neutral-500 font-normal mt-2">
              before the bit reaches them.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-neutral-600 leading-relaxed mb-8 max-w-2xl mx-auto">
            eRTMAC-NWIS fuses offset well drilling logs, 3D formation picks, and real-time surface telemetry
            to forecast mud losses, stuck pipe, kicks, and high torque <strong>50 to 300 metres ahead of the bit</strong>.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link
              to={loggedIn ? homePath : '/login'}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl bg-neutral-950 text-white font-semibold text-base hover:bg-neutral-800 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <span>{loggedIn ? 'Enter Operations Workspace' : 'Sign In to Platform'}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>

            <a
              href="#map"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-neutral-50 hover:bg-neutral-100 text-neutral-900 font-semibold text-base border border-neutral-300 shadow-sm transition-all"
            >
              <MapPin className="h-4 w-4 text-neutral-700" />
              <span>Explore Field Map</span>
              <ChevronDown className="h-4 w-4 text-neutral-400" />
            </a>
          </div>

          {/* Verified Domain Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto pt-6 border-t border-neutral-200">
            <div>
              <div className="font-display text-2xl font-bold text-neutral-950">30+ Wells</div>
              <div className="text-xs text-neutral-500 mt-0.5">Assam Basin & Volve</div>
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-neutral-950">100% PostGIS</div>
              <div className="text-xs text-neutral-500 mt-0.5">3D Spatial Offsets</div>
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-neutral-950">&lt; 2s Latency</div>
              <div className="text-xs text-neutral-500 mt-0.5">Realtime CDC WebSockets</div>
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-neutral-950">5 Models</div>
              <div className="text-xs text-neutral-500 mt-0.5">Calibrated Hazard Engines</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. UNIQUE FEATURE: Interactive Regional Geospatial Offset Map Section */}
      <section id="map" className="py-16 md:py-20 bg-neutral-50 border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white text-neutral-800 border border-neutral-300 shadow-sm mb-3">
                <MapPin className="h-3.5 w-3.5 text-neutral-900" />
                <span>Geospatial 3D Offset Intelligence</span>
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
                Upper Assam Basin Offset Wellbore Network
              </h2>
              <p className="text-neutral-600 mt-2 text-base max-w-2xl">
                True 3D spatial correlation across active and historical boreholes in the Duliajan oilfield.
                Select search radii or click any offset well to inspect geological hazard history and preventative protocols.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to={loggedIn ? '/wells/00000000-0000-4000-8000-000000000001/map' : '/login'}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 shadow-sm transition-all"
              >
                <span>Launch Full GIS Workspace</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Interactive Map & Inspector Console */}
          <div className="rounded-2xl border-2 border-neutral-300 bg-white shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left Controls & Well Inspector (5 cols) */}
            <div className="lg:col-span-5 p-6 lg:p-7 border-b lg:border-b-0 lg:border-r border-neutral-200 flex flex-col justify-between space-y-6 bg-white">
              <div className="space-y-6">
                {/* Field Header & Search Radius Selector */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                      Lookahead Search Buffer
                    </span>
                    <span className="text-xs font-mono font-semibold text-neutral-500">
                      {wellsWithinRadius.length} wells in buffer
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '1.5 km', val: 1500 },
                      { label: '3.0 km', val: 3000 },
                      { label: '5.0 km', val: 5000 },
                      { label: '10 km', val: 10000 },
                    ].map((btn) => (
                      <button
                        key={btn.val}
                        onClick={() => setSelectedRadius(btn.val)}
                        className={`py-2 px-2 rounded-lg text-xs font-bold transition-all text-center border ${
                          selectedRadius === btn.val
                            ? 'bg-neutral-950 text-white border-neutral-950 shadow-sm'
                            : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300'
                        }`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inspected Well Details Card */}
                <div className="p-5 rounded-xl border-2 border-neutral-300 bg-neutral-50/60 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full border border-neutral-900"
                        style={{ backgroundColor: selectedWell.riskColor }}
                      />
                      <h3 className="font-display font-bold text-lg text-neutral-950">
                        {selectedWell.name}
                      </h3>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${selectedWell.badgeColor}`}
                    >
                      {selectedWell.isActive ? 'ACTIVE BIT' : `${selectedWell.riskLevel.toUpperCase()}`}
                    </span>
                  </div>

                  {/* Well Coordinates & Distance */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                      <div className="text-[10px] text-neutral-400 font-medium">FORMATION & DEPTH</div>
                      <div className="font-bold text-neutral-900 truncate mt-0.5">
                        {selectedWell.formation}
                      </div>
                      <div className="text-[11px] font-mono text-neutral-500">
                        {selectedWell.md.toLocaleString()} m MD
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                      <div className="text-[10px] text-neutral-400 font-medium">3D SPATIAL OFFSET</div>
                      <div className="font-bold text-neutral-900 mt-0.5">
                        {selectedWell.isActive ? 'Active Center' : `${selectedWell.distanceKm} km`}
                      </div>
                      <div className="text-[11px] font-mono text-neutral-500 truncate">
                        {selectedWell.isActive ? 'Lat 27.36° Lon 95.31°' : 'MCM 3D Distance'}
                      </div>
                    </div>
                  </div>

                  {/* Hazard Flag */}
                  <div className="p-3 rounded-lg bg-white border border-neutral-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-neutral-600" />
                        <span>Offset Hazard Record:</span>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-neutral-700">
                        Score {selectedWell.riskScore.toFixed(1)}/100
                      </span>
                    </div>
                    <p className="text-neutral-600 leading-relaxed text-[11px]">
                      {selectedWell.historicalSummary}
                    </p>
                  </div>

                  {/* Preventative Mitigation Recommendation */}
                  <div className="p-3 rounded-lg bg-neutral-950 text-white text-xs space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Mitigation Protocol:</span>
                    </div>
                    <p className="text-neutral-300 leading-relaxed text-[11px]">
                      {selectedWell.mitigation}
                    </p>
                  </div>
                </div>

                {/* Quick Select Well List */}
                <div>
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
                    <span>Field Wells List</span>
                    <span className="text-[10px] font-normal text-neutral-400">Click to focus</span>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {REGIONAL_WELLS.map((w) => {
                      const isSelected = selectedWell.id === w.id;
                      const inRange = w.distanceKm * 1000 <= selectedRadius;
                      return (
                        <button
                          key={w.id}
                          onClick={() => handleSelectWell(w)}
                          className={`w-full text-left p-2 rounded-lg border text-xs transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-neutral-900 text-white border-neutral-950 font-semibold shadow-sm'
                              : inRange
                              ? 'bg-white text-neutral-800 border-neutral-200 hover:border-neutral-400'
                              : 'bg-neutral-50 text-neutral-400 border-neutral-200 opacity-60 hover:opacity-100'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: w.riskColor }}
                            />
                            <span className="font-medium truncate">{w.name}</span>
                            <span className="text-[10px] opacity-75 truncate">
                              ({w.formation.split(' ')[0]})
                            </span>
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                            <span>{w.isActive ? 'Active' : `${w.distanceKm} km`}</span>
                            <ChevronRight className="h-3 w-3 opacity-60" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Reset to Active Well Button */}
              <button
                onClick={handleResetMap}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-neutral-200"
              >
                <Crosshair className="h-4 w-4 text-neutral-700" />
                <span>Refocus Active Well (SYN-DLJ-03)</span>
              </button>
            </div>

            {/* Right Map Canvas (7 cols) */}
            <div className="lg:col-span-7 relative h-[520px] lg:h-[640px] w-full isolate z-0 bg-neutral-100">
              <MapContainer
                center={[27.3600, 95.3100]}
                zoom={12.4}
                scrollWheelZoom={false}
                preferCanvas={true}
                className="h-full w-full"
              >
                <TileLayer
                  key={mapLayerType}
                  attribution={MAP_LAYERS[mapLayerType].attribution}
                  url={MAP_LAYERS[mapLayerType].url}
                  maxZoom={MAP_LAYERS[mapLayerType].maxZoom}
                />

                <MapViewController targetWell={mapTargetWell} resetSignal={resetSignal} />

                {/* Radius buffer circle centered on active well */}
                <Circle
                  center={[27.3600, 95.3100]}
                  radius={selectedRadius}
                  pathOptions={{
                    color: '#0f172a',
                    fillColor: '#3b82f6',
                    fillOpacity: 0.08,
                    weight: 1.5,
                    dashArray: '5, 5',
                  }}
                />

                {/* Active well pulse ring */}
                <Circle
                  center={[27.3600, 95.3100]}
                  radius={450}
                  pathOptions={{
                    color: '#10b981',
                    fillColor: '#10b981',
                    fillOpacity: 0.22,
                    weight: 1,
                  }}
                />

                {/* Render All Wells */}
                {REGIONAL_WELLS.map((w) => {
                  const isSelected = selectedWell.id === w.id;
                  const inRange = w.distanceKm * 1000 <= selectedRadius;

                  return (
                    <CircleMarker
                      key={w.id}
                      center={[w.lat, w.lon]}
                      radius={w.isActive ? 9 : isSelected ? 9 : 6.5}
                      pathOptions={{
                        color: isSelected ? '#0f172a' : w.isActive ? '#064e3b' : '#334155',
                        weight: isSelected ? 3 : w.isActive ? 2.5 : 1.5,
                        fillColor: w.riskColor,
                        fillOpacity: inRange ? 0.95 : 0.35,
                      }}
                      eventHandlers={{
                        click: () => handleSelectWell(w),
                      }}
                    >
                      <Popup>
                        <div className="p-2 space-y-1 text-xs min-w-[200px]">
                          <div className="font-bold text-neutral-950 font-display flex items-center justify-between">
                            <span>{w.name}</span>
                            <span className="text-[10px] font-mono text-neutral-500">
                              {w.isActive ? 'ACTIVE' : `${w.distanceKm} km`}
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-600">
                            <strong>Formation:</strong> {w.formation}
                          </div>
                          <div className="text-[11px] text-neutral-600">
                            <strong>Hazard:</strong> {w.hazardType}
                          </div>
                          <div className="text-[11px] text-neutral-600">
                            <strong>Depth:</strong> {w.md} m MD
                          </div>
                          <button
                            onClick={() => handleSelectWell(w)}
                            className="mt-2 w-full py-1 px-2 rounded bg-neutral-900 text-white text-[10px] font-semibold"
                          >
                            Inspect Offset Log
                          </button>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>

              {/* Floating Header Controls: Real Map / Satellite Switcher & Coordinates */}
              <div className="absolute top-4 left-4 right-4 z-[400] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
                {/* Real Map Layer Switcher */}
                <div className="pointer-events-auto flex items-center p-1 bg-white/95 backdrop-blur-md rounded-xl border border-neutral-300 shadow-md">
                  <button
                    type="button"
                    onClick={() => setMapLayerType('street')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      mapLayerType === 'street'
                        ? 'bg-neutral-950 text-white shadow-sm'
                        : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100'
                    }`}
                  >
                    <Compass className="h-3.5 w-3.5" />
                    <span>Real Map</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapLayerType('satellite')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      mapLayerType === 'satellite'
                        ? 'bg-neutral-950 text-white shadow-sm'
                        : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Satellite</span>
                  </button>
                </div>

                {/* Real-time Location Coordinates Badge */}
                <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-neutral-300 shadow-md text-xs font-mono font-medium text-neutral-800 pointer-events-auto flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-neutral-950" />
                  <span>Duliajan, Assam (27.3600°N, 95.3100°E)</span>
                </div>
              </div>

              {/* Floating Legend */}
              <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-md p-3 rounded-xl border border-neutral-200 shadow-md text-xs">
                <div className="font-bold text-neutral-900 text-[10px] uppercase tracking-wider mb-2">
                  Hazard Classification
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-neutral-600">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
                    <span>Active / Stable</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                    <span>Mud Losses</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ea580c]" />
                    <span>Stuck Pipe</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#0284c7]" />
                    <span>Gas Influx</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. UNIQUE FEATURE: Interactive Subsurface Lookahead Radar Simulator */}
      <section id="simulator" className="py-20 bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-200 text-neutral-800 mb-3">
              <Sliders className="h-3.5 w-3.5" />
              <span>Interactive Operations Simulator</span>
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
              Test Lookahead Hazard Forecasts in Real Time
            </h2>
            <p className="text-neutral-600 mt-3 text-base">
              Select an Assam Basin geological formation or adjust the depth slider to observe how eRTMAC-NWIS
              correlates offset logs to predict drilling risks ahead of the drill bit.
            </p>
          </div>

          {/* Simulator Console Container */}
          <div className="rounded-2xl border-2 border-neutral-300 bg-white shadow-xl overflow-hidden">
            {/* Formation Selector Tabs */}
            <div className="grid grid-cols-2 md:grid-cols-4 border-b border-neutral-200 bg-neutral-100 text-xs">
              {FORMATION_PRESETS.map((item, idx) => (
                <button
                  key={item.name}
                  onClick={() => handleSelectPreset(idx)}
                  className={`py-3.5 px-4 text-left transition-all border-r border-neutral-200 last:border-r-0 ${
                    selectedFormationIndex === idx
                      ? 'bg-white font-bold text-neutral-950 shadow-sm border-b-2 border-b-neutral-950'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                  }`}
                >
                  <div className="text-[10px] font-mono text-neutral-500 uppercase">{item.depth} m</div>
                  <div className="font-display font-semibold text-sm truncate">{item.name}</div>
                </button>
              ))}
            </div>

            {/* Simulator Body */}
            <div className="p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Depth Slider & Subsurface Trajectory Rail (5 cols) */}
              <div className="lg:col-span-5 space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                      Simulated Bit Depth (MD)
                    </label>
                    <span className="font-mono text-base font-bold text-neutral-950 bg-neutral-100 px-3 py-1 rounded-lg border border-neutral-200">
                      {interactiveDepth.toLocaleString()} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1500"
                    max="3800"
                    step="5"
                    value={interactiveDepth}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setInteractiveDepth(val);
                      // Auto pick closest preset
                      let closestIdx = 0;
                      let minDiff = Math.abs(val - FORMATION_PRESETS[0].depth);
                      FORMATION_PRESETS.forEach((p, idx) => {
                        const diff = Math.abs(val - p.depth);
                        if (diff < minDiff) {
                          minDiff = diff;
                          closestIdx = idx;
                        }
                      });
                      setSelectedFormationIndex(closestIdx);
                    }}
                    className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-neutral-950"
                  />
                  <div className="flex justify-between text-[11px] text-neutral-400 mt-1 font-mono">
                    <span>1,500 m</span>
                    <span>2,500 m</span>
                    <span>3,800 m</span>
                  </div>
                </div>

                {/* Subsurface Stratigraphic Column Visualization */}
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
                  <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3 flex items-center justify-between">
                    <span>Assam Basin Stratigraphy</span>
                    <span className="text-[10px] font-mono text-neutral-400">PostGIS 3D Layer</span>
                  </div>

                  <div className="space-y-2">
                    {FORMATION_PRESETS.map((f, i) => {
                      const isActive = selectedFormationIndex === i;
                      return (
                        <div
                          key={f.name}
                          onClick={() => handleSelectPreset(i)}
                          className={`p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between text-xs ${
                            isActive
                              ? 'bg-neutral-900 text-white border-neutral-950 shadow-md font-semibold'
                              : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isActive ? 'bg-emerald-400 animate-ping' : 'bg-neutral-300'
                              }`}
                            />
                            <span>{f.name}</span>
                            <span className="text-[10px] opacity-70 font-normal">({f.lithology})</span>
                          </div>
                          <span className="font-mono text-[11px]">{f.depth} m</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Realtime Telemetry Readout */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2.5 rounded-xl border border-neutral-200 bg-white">
                    <div className="text-[10px] text-neutral-500 font-medium">ROP (m/h)</div>
                    <div className="font-mono text-sm font-bold text-neutral-950 mt-0.5">
                      {currentScenario.telemetry.rop}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-neutral-200 bg-white">
                    <div className="text-[10px] text-neutral-500 font-medium">WOB (klbf)</div>
                    <div className="font-mono text-sm font-bold text-neutral-950 mt-0.5">
                      {currentScenario.telemetry.wob}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-neutral-200 bg-white">
                    <div className="text-[10px] text-neutral-500 font-medium">RPM</div>
                    <div className="font-mono text-sm font-bold text-neutral-950 mt-0.5">
                      {currentScenario.telemetry.rpm}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-neutral-200 bg-white">
                    <div className="text-[10px] text-neutral-500 font-medium">SPP (psi)</div>
                    <div className="font-mono text-sm font-bold text-neutral-950 mt-0.5">
                      {currentScenario.telemetry.spp}
                    </div>
                  </div>
                </div>
              </div>

              {/* Lookahead Risk Warning & Offset Evidence Details (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                {/* Active Risk Score Banner */}
                <div className="p-5 rounded-xl border-2 border-neutral-300 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5 text-neutral-900" />
                      <span className="font-display font-bold text-lg text-neutral-950">
                        {currentScenario.hazard.type} Ahead
                      </span>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${currentScenario.hazard.bandColor}`}
                    >
                      {currentScenario.hazard.band.toUpperCase()} RISK · {currentScenario.hazard.risk.toFixed(1)}
                    </span>
                  </div>

                  {/* Lookahead Depth Horizon Indicator */}
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-neutral-500 mb-1.5">
                      <span>Lookahead Warning Horizon</span>
                      <span className="font-mono font-bold text-neutral-800">
                        {interactiveDepth} m &rarr; {(interactiveDepth + 150).toLocaleString()} m (150m Lookahead)
                      </span>
                    </div>
                    <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden border border-neutral-200">
                      <div
                        className="bg-neutral-950 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(currentScenario.hazard.risk, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Historical Offset Evidence */}
                  <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 text-xs text-neutral-800 space-y-1 mb-4">
                    <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                      <Compass className="h-4 w-4 text-neutral-600" />
                      <span>Offset Well Correlation Evidence:</span>
                    </div>
                    <p className="text-neutral-600 leading-relaxed pl-5">
                      {currentScenario.hazard.evidence}
                    </p>
                  </div>

                  {/* Recommended Preventative Mitigation */}
                  <div className="p-3.5 rounded-lg bg-neutral-950 text-white text-xs space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Actionable Mitigation Protocol:</span>
                    </div>
                    <p className="text-neutral-300 leading-relaxed pl-5">
                      {currentScenario.hazard.mitigation}
                    </p>
                  </div>
                </div>

                {/* Technical Workflow Callout */}
                <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-white border border-neutral-200 text-neutral-900">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                      Three-Layer Risk Fusion Engine
                    </h4>
                    <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                      L1 retrieves geological offset records via PostGIS 3D spatial queries; L2 evaluates calibrated
                      logistic risk curves; L3 analyzes surface telemetry delta drops in real time.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Core Capabilities Bento-Grid */}
      <section id="capabilities" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              Platform Architecture
            </h2>
            <h3 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
              Built for High-Stakes Drilling Environments
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              A comprehensive intelligence pipeline converting historical borehole records into proactive real-time safety barriers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Bento Card 1 */}
            <div className="p-8 rounded-2xl border-2 border-neutral-200 hover:border-neutral-400 transition-all bg-white flex flex-col justify-between shadow-sm hover:shadow-md">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-950 mb-6 border border-neutral-200">
                  <Compass className="h-6 w-6" />
                </div>
                <h4 className="font-display text-xl font-bold text-neutral-950 mb-3">
                  3D Spatial Offset Correlation
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed mb-6">
                  Uses Minimum Curvature Method (MCM) to interpolate exact 3D borehole trajectories. PostGIS calculates
                  true spatial distance at equivalent TVD depths rather than misleading surface coordinates.
                </p>
              </div>
              <ul className="space-y-2.5 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Configurable search radius (1 to 10 km)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>TVD sub-sea level normalization</span>
                </li>
              </ul>
            </div>

            {/* Bento Card 2 */}
            <div className="p-8 rounded-2xl border-2 border-neutral-200 hover:border-neutral-400 transition-all bg-white flex flex-col justify-between shadow-sm hover:shadow-md">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-950 mb-6 border border-neutral-200">
                  <Activity className="h-6 w-6" />
                </div>
                <h4 className="font-display text-xl font-bold text-neutral-950 mb-3">
                  5 Calibrated Hazard Models
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed mb-6">
                  Predicts mud loss severity, differential sticking, gas kick influx, borehole ballooning, and torque
                  anomalies using calibrated weights derived from 30+ regional offset wells.
                </p>
              </div>
              <ul className="space-y-2.5 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>50m to 300m lookahead projection</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Risk scores normalized 0 to 100</span>
                </li>
              </ul>
            </div>

            {/* Bento Card 3 */}
            <div className="p-8 rounded-2xl border-2 border-neutral-200 hover:border-neutral-400 transition-all bg-white flex flex-col justify-between shadow-sm hover:shadow-md">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-950 mb-6 border border-neutral-200">
                  <Radio className="h-6 w-6" />
                </div>
                <h4 className="font-display text-xl font-bold text-neutral-950 mb-3">
                  Realtime CDC WebSocket Alerts
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed mb-6">
                  Supabase Realtime publication streams alert events with full replica identity directly to rig floor
                  tablets and RTOC consoles with sub-2-second latency.
                </p>
              </div>
              <ul className="space-y-2.5 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Mandatory Acknowledge / Dismiss workflows</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>300s automated escalation timers</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Role-Based Workspaces Section */}
      <section id="workspaces" className="py-20 bg-neutral-50 border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              Purpose-Built Interfaces
            </h2>
            <h3 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
              Designed for Rig Floors and Command Centers
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              Every persona in the drilling organization receives an interface tuned to their exact workflow constraints.
            </p>
          </div>

          {/* Interactive Role Tabs */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex p-1.5 rounded-xl bg-white border border-neutral-200 shadow-sm">
              <button
                onClick={() => setActiveRoleTab('rig')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activeRoleTab === 'rig'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <Tablet className="h-4 w-4" />
                <span>Rig Floor Tablet</span>
              </button>
              <button
                onClick={() => setActiveRoleTab('rtoc')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activeRoleTab === 'rtoc'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <Monitor className="h-4 w-4" />
                <span>RTOC Multi-Well Console</span>
              </button>
              <button
                onClick={() => setActiveRoleTab('engineer')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activeRoleTab === 'engineer'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <HardHat className="h-4 w-4" />
                <span>Office Drilling Engineer</span>
              </button>
              <button
                onClick={() => setActiveRoleTab('reviewer')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activeRoleTab === 'reviewer'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <FileCheck2 className="h-4 w-4" />
                <span>Document OCR Reviewer</span>
              </button>
            </div>
          </div>

          {/* Role Preview Card */}
          <div className="max-w-4xl mx-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-xl">
            {activeRoleTab === 'rig' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-mono font-bold">
                      TOUCH FIRST
                    </span>
                    <h4 className="font-display text-lg font-bold text-neutral-950">
                      Rig Floor Tablet: High Contrast Dark Dial UI
                    </h4>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">PRD §4.1 Compliant</span>
                </div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Tailored for ruggedized tablets on the rig doghouse. Large 48px touch targets, high-contrast dark dials,
                  instant audio alarms on Critical alerts, and single-tap acknowledgement to minimize driller distraction.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Touch Sized Dials</div>
                    <div className="text-neutral-500 mt-1">48px minimum touch buttons</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Audible Alarm</div>
                    <div className="text-neutral-500 mt-1">Synthesized WebAudio warning</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Offline Cache</div>
                    <div className="text-neutral-500 mt-1">Local state caching on rig net drop</div>
                  </div>
                </div>
              </div>
            )}

            {activeRoleTab === 'rtoc' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-mono font-bold">
                      24/7 COMMAND
                    </span>
                    <h4 className="font-display text-lg font-bold text-neutral-950">
                      RTOC Multi-Well Operations Center
                    </h4>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">PRD §4.2 Compliant</span>
                </div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Engineered for video wall command centers monitoring 6+ concurrent drilling operations. Tracks real-time
                  telemetry stream health, unacknowledged alerts across all wells, and automated escalation timers.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Multi-Well Grid</div>
                    <div className="text-neutral-500 mt-1">Concurrent real-time well statuses</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Escalation Timer</div>
                    <div className="text-neutral-500 mt-1">Automated supervisor paging</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Shift Handover</div>
                    <div className="text-neutral-500 mt-1">Audited digital shift notes</div>
                  </div>
                </div>
              </div>
            )}

            {activeRoleTab === 'engineer' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-mono font-bold">
                      PLANNING & CORRELATION
                    </span>
                    <h4 className="font-display text-lg font-bold text-neutral-950">
                      Office Drilling Engineer Workspace
                    </h4>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">PRD §4.3 Compliant</span>
                </div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Interactive Plotly stratigraphic correlation panels, cross-sections across historical offset wells,
                  pre-spud risk briefing exports, and hybrid semantic search across historical well completion reports.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Log Correlation</div>
                    <div className="text-neutral-500 mt-1">Interactive Gamma Ray & Resistivity</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Hybrid Search</div>
                    <div className="text-neutral-500 mt-1">pgvector + bm25 historical recall</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Pre-Spud Briefs</div>
                    <div className="text-neutral-500 mt-1">One-click hazard summary report</div>
                  </div>
                </div>
              </div>
            )}

            {activeRoleTab === 'reviewer' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-mono font-bold">
                      HUMAN-IN-THE-LOOP
                    </span>
                    <h4 className="font-display text-lg font-bold text-neutral-950">
                      Document Ingestion & OCR Review Queue
                    </h4>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">PRD §4.4 Compliant</span>
                </div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Verification console for extracted Daily Drilling Reports (DDR) and Well Completion Reports (WCR).
                  Interactive canvas bounding boxes show source PDF snippets with audited approve/edit/reject workflows.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Bounding Box Canvas</div>
                    <div className="text-neutral-500 mt-1">Click any field to zoom to PDF page</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Audited Changes</div>
                    <div className="text-neutral-500 mt-1">Full audit_log trail per edit</div>
                  </div>
                  <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                    <div className="font-bold text-neutral-900">Quality Gates</div>
                    <div className="text-neutral-500 mt-1">Prevent ingestion of unverified logs</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. Technical Foundation Stack */}
      <section id="architecture" className="py-20 bg-white border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              Engineering Stack
            </h2>
            <h3 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
              Enterprise PostgreSQL & Realtime Core
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              Built on battle-tested open standards ensuring sub-second performance, high geospatial precision, and zero vendor lock-in.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-center">
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <Database className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">PostgreSQL 15+</div>
              <div className="text-[11px] text-neutral-500 mt-1">Relational Backbone</div>
            </div>
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <Compass className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">PostGIS 3.3+</div>
              <div className="text-[11px] text-neutral-500 mt-1">3D Spatial Queries</div>
            </div>
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <Layers className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">pgvector</div>
              <div className="text-[11px] text-neutral-500 mt-1">Semantic Embeddings</div>
            </div>
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <Radio className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">Realtime CDC</div>
              <div className="text-[11px] text-neutral-500 mt-1">WebSocket Broadcasts</div>
            </div>
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <Cpu className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">React 18 & Vite</div>
              <div className="text-[11px] text-neutral-500 mt-1">Ultra-fast Client</div>
            </div>
            <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50">
              <ShieldAlert className="h-6 w-6 text-neutral-950 mx-auto mb-2" />
              <div className="font-bold text-sm text-neutral-950">RLS Policies</div>
              <div className="text-[11px] text-neutral-500 mt-1">Role-Based Security</div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Call to Action Banner */}
      <section className="py-20 bg-neutral-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="h-12 w-12 rounded-2xl bg-neutral-800 flex items-center justify-center text-white mx-auto mb-6">
            <Zap className="h-6 w-6 text-emerald-400" />
          </div>

          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight mb-6">
            Ready to enhance drilling safety ahead of the bit?
          </h2>

          <p className="text-base sm:text-lg text-neutral-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Access the complete Nearby Wells Intelligence System platform. Connect your telemetry streams,
            correlate offset wells, and prevent costly drilling NPT.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to={loggedIn ? homePath : '/login'}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-white text-neutral-950 font-bold text-base hover:bg-neutral-100 shadow-xl transition-all"
            >
              <span>{loggedIn ? 'Enter Operations Workspace' : 'Sign In to Platform'}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 9. Minimalist Footer */}
      <footer className="py-12 bg-white border-t border-neutral-200 text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold font-display text-sm text-neutral-900">eRTMAC-NWIS</span>
            <span>·</span>
            <span>Oil India Limited SIH26121</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#simulator" className="hover:text-neutral-900 transition-colors">
              Simulator
            </a>
            <a href="#capabilities" className="hover:text-neutral-900 transition-colors">
              Capabilities
            </a>
            <a href="#workspaces" className="hover:text-neutral-900 transition-colors">
              Workspaces
            </a>
            <Link to="/login" className="font-medium text-neutral-900 hover:text-black">
              Sign In
            </Link>
          </div>

          <div>
            &copy; 2026 eRTMAC-NWIS · Open Source MIT
          </div>
        </div>
      </footer>
    </div>
  );
}

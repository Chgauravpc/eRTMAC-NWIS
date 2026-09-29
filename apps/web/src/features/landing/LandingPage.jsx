import React from 'react';
import { Link } from 'react-router-dom';
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
  FileText,
  Sliders,
  MapPin,
  ExternalLink,
} from 'lucide-react';
import { useProfile } from '../auth/useProfile';
import { roleHome } from '../auth/roleHome';

export function LandingPage() {
  const { session, profile } = useProfile();
  const loggedIn = !!(session && profile);
  const homePath = profile ? roleHome(profile) : '/wells';

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-neutral-900 selection:text-white">
      {/* 1. Header / Navigation */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-neutral-900 flex items-center justify-center text-white font-bold text-base shadow-sm">
              N
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-neutral-950 block leading-tight">
                eRTMAC-NWIS
              </span>
              <span className="text-[11px] text-neutral-500 font-medium block leading-none">
                Oil India Limited · SIH26121
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-600">
            <a href="#lookahead" className="hover:text-neutral-950 transition-colors">
              Lookahead Risk
            </a>
            <a href="#offset" className="hover:text-neutral-950 transition-colors">
              Offset Intelligence
            </a>
            <a href="#rig-rtoc" className="hover:text-neutral-950 transition-colors">
              Rig & RTOC
            </a>
            <a href="#architecture" className="hover:text-neutral-950 transition-colors">
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {loggedIn ? (
              <Link
                to={homePath}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-black transition-all shadow-sm"
              >
                <span>Console ({profile.full_name?.split(' ')[0] || 'Dashboard'})</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-black transition-all shadow-sm hover:shadow"
              >
                <span>Sign In</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative pt-16 pb-20 md:pt-24 md:pb-28 overflow-hidden">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(#000 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-neutral-950 leading-[1.1] mb-6">
            Intelligent Lookahead Warning <br className="hidden sm:inline" />
            <span className="text-neutral-500">Ahead of the Drill Bit.</span>
          </h1>

          <p className="max-w-3xl mx-auto text-lg sm:text-xl text-neutral-600 leading-relaxed mb-10">
            eRTMAC-NWIS predicts drilling hazards—mud losses, stuck pipe, kicks, and torque spikes—50 to
            300 metres ahead of the bit by fusing offset well histories, 3D formation picks, and real-time
            telemetry.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to={loggedIn ? homePath : '/login'}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-neutral-950 text-white font-semibold text-base hover:bg-black shadow-md hover:shadow-lg transition-all"
            >
              <span>{loggedIn ? 'Enter Workspace' : 'Sign In to Platform'}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>

            <a
              href="#preview"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-neutral-100 text-neutral-800 font-semibold text-base hover:bg-neutral-200/80 border border-neutral-200 transition-all"
            >
              <span>Explore Live Preview</span>
              <ChevronRight className="h-4 w-4 text-neutral-500" />
            </a>
          </div>
        </div>
      </section>

      {/* 3. Interactive Platform Preview Card */}
      <section id="preview" className="py-12 bg-neutral-50/60 border-y border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-950">
              Live Operations Interface
            </h2>
            <p className="text-sm text-neutral-600 mt-1">
              Engineered for seamless situational awareness across drilling teams.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-300 bg-white shadow-xl overflow-hidden">
            {/* Mock Header */}
            <div className="bg-neutral-900 text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-semibold text-sm">SYN-DLJ-03 (Active Drilling Well)</span>
                <span className="text-neutral-400">|</span>
                <span className="text-neutral-300">Bit Depth: <strong>2,395.0 m</strong></span>
                <span className="text-neutral-400">|</span>
                <span className="text-neutral-300">Target Formation: <strong>Tipam Sandstone</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                  LIVE STREAM
                </span>
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                  Speed: 10x
                </span>
              </div>
            </div>

            {/* Mock Body */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Alert Card Mock */}
              <div className="p-5 rounded-xl border-2 border-amber-300 bg-amber-50/40 col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-amber-600" />
                    <span className="font-bold text-amber-950 text-base">
                      WATCH: High Mud Losses Expected Ahead (2,400 – 2,425 m)
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-900 border border-amber-300">
                    Elevated · 58.2
                  </span>
                </div>

                <p className="text-sm text-neutral-700 mt-2.5 leading-relaxed">
                  Offset well <strong>SYN-DLJ-05</strong> (1.85 km away) encountered <strong>15 m³/h partial losses</strong> at relative formation depth 0.62 in permeable Tipam sandstone.
                </p>

                <div className="mt-4 p-3 rounded-lg bg-white border border-amber-200/80 text-xs text-neutral-800">
                  <div className="font-semibold text-neutral-900 mb-1">Recommended Preventative Action:</div>
                  Pump 30 m³ high-fluid LCM pill before penetrating lower sand interval; verify mud weight does not exceed 1.20 SG.
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-neutral-500 pt-2 border-t border-amber-200/60">
                  <span>Confidence: <strong>High</strong> (4 offset events correlated)</span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded bg-neutral-900 text-white font-medium">Acknowledge</span>
                    <span className="px-2 py-1 rounded border border-neutral-300 bg-white text-neutral-700">Dismiss</span>
                  </div>
                </div>
              </div>

              {/* Status & Formation Rail */}
              <div className="p-5 rounded-xl border border-neutral-200 bg-neutral-50 flex flex-col justify-between">
                <div>
                  <div className="text-xs uppercase font-bold tracking-wider text-neutral-500 mb-3">
                    Formation Stratigraphy
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center p-2 rounded bg-neutral-200/60 text-neutral-600">
                      <span>Girujan Clay</span>
                      <span className="font-mono">1,300 m</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-neutral-900 text-white font-medium shadow-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Tipam Sandstone
                      </span>
                      <span className="font-mono">2,200 m (Current)</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-white border border-neutral-200 text-neutral-800">
                      <span>Barail Coal-Shale</span>
                      <span className="font-mono">2,850 m</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-white border border-neutral-200 text-neutral-500">
                      <span>Kopili Formation</span>
                      <span className="font-mono">3,500 m</span>
                    </div>
                  </div>
                </div>

                <Link
                  to="/login"
                  className="mt-4 block text-center py-2 px-3 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-black transition-all"
                >
                  Open Live Rig View
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Capabilities Section */}
      <section id="lookahead" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              System Capabilities
            </h2>
            <h3 className="text-3xl font-extrabold tracking-tight text-neutral-950 sm:text-4xl">
              Engineered for High-Stakes Drilling
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              A complete intelligence stack built to convert historical drilling records into proactive real-time safety barriers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-7 rounded-2xl border border-neutral-200 hover:border-neutral-400 hover:shadow-lg transition-all bg-white flex flex-col justify-between">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-900 mb-5">
                  <Activity className="h-6 w-6" />
                </div>
                <h4 className="text-xl font-bold text-neutral-950 mb-2">
                  Lookahead Risk Engine
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Fuses geological offset hits (L1), calibrated machine learning models (L2), and surface telemetry detectors (L3) to assign probabilistic risk bands (0–100) ahead of the bit.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>50m to 300m lookahead grid</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Losses, stuck pipe, kick, torque</span>
                </li>
              </ul>
            </div>

            {/* Feature 2 */}
            <div className="p-7 rounded-2xl border border-neutral-200 hover:border-neutral-400 hover:shadow-lg transition-all bg-white flex flex-col justify-between">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-900 mb-5">
                  <Compass className="h-6 w-6" />
                </div>
                <h4 className="text-xl font-bold text-neutral-950 mb-2">
                  3D Spatial Offset Correlation
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Calculates true 3D spatial distances at equivalent TVD depths rather than simple surface distances, identifying hazards that occur at corresponding geological horizons.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Minimum Curvature Trajectories</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Dynamic search radius (up to 10 km)</span>
                </li>
              </ul>
            </div>

            {/* Feature 3 */}
            <div className="p-7 rounded-2xl border border-neutral-200 hover:border-neutral-400 hover:shadow-lg transition-all bg-white flex flex-col justify-between">
              <div>
                <div className="h-12 w-12 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-900 mb-5">
                  <Radio className="h-6 w-6" />
                </div>
                <h4 className="text-xl font-bold text-neutral-950 mb-2">
                  Realtime CDC WebSocket Alerts
                </h4>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Pushes instantaneous updates with complete row payloads on state transitions. Mandatory acknowledgement workflows prevent alarm fatigue while enforcing accountability.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-neutral-700 border-t border-neutral-100 pt-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Full row replica identity</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Escalation timers (300s critical)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Role-Based Workspaces Section */}
      <section id="rig-rtoc" className="py-20 bg-neutral-50/70 border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              User Experiences
            </h2>
            <h3 className="text-3xl font-extrabold tracking-tight text-neutral-950 sm:text-4xl">
              Tailored for Every Operational Role
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              Each team member receives a purpose-built workspace designed for their specific mission.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
              <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider mb-2">
                Rig Floor
              </div>
              <div className="font-bold text-lg text-neutral-950 mb-2">Rig Engineer View</div>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                Optimized for touch tablets with high-contrast dark dials, large tap targets, and audible alarms for immediate driller action.
              </p>
              <div className="text-[11px] font-medium text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded inline-block">
                Touch-first · Dark mode
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
              <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider mb-2">
                Operations
              </div>
              <div className="font-bold text-lg text-neutral-950 mb-2">RTOC Monitoring</div>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                24/7 command center screen tracking all active rigs across Assam, monitoring real-time telemetry drops and open alerts.
              </p>
              <div className="text-[11px] font-medium text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded inline-block">
                Multi-well · Live alerts
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
              <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider mb-2">
                Engineering
              </div>
              <div className="font-bold text-lg text-neutral-950 mb-2">Office & Planning</div>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                Pre-spud planning briefs, offset log correlation tracks with Plotly, and stratigraphic cross-sections across historical wells.
              </p>
              <div className="text-[11px] font-medium text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded inline-block">
                Log correlation · Pre-spud
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
              <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider mb-2">
                Quality & QA
              </div>
              <div className="font-bold text-lg text-neutral-950 mb-2">Review Queue</div>
              <p className="text-xs text-neutral-600 leading-relaxed mb-4">
                Human-in-the-loop review interface for DDR & WCR extraction, featuring interactive PDF canvas bounding boxes and audit logs.
              </p>
              <div className="text-[11px] font-medium text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded inline-block">
                OCR verification · Audited
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Technical Stack Section */}
      <section id="architecture" className="py-20 bg-white border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
              Architecture & Stack
            </h2>
            <h3 className="text-3xl font-extrabold tracking-tight text-neutral-950 sm:text-4xl">
              Enterprise Data Foundation
            </h3>
            <p className="text-neutral-600 mt-3 text-base">
              Built on battle-tested open technologies designed for reliability and zero vendor lock-in.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">PostgreSQL 15+</div>
              <div className="text-[11px] text-neutral-500 mt-1">Core Relational Store</div>
            </div>
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">PostGIS</div>
              <div className="text-[11px] text-neutral-500 mt-1">3D Trajectories & Offsets</div>
            </div>
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">pgvector</div>
              <div className="text-[11px] text-neutral-500 mt-1">Document Embeddings</div>
            </div>
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">Realtime CDC</div>
              <div className="text-[11px] text-neutral-500 mt-1">WebSockets Subscription</div>
            </div>
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">React 18 & Vite</div>
              <div className="text-[11px] text-neutral-500 mt-1">Fast Client Framework</div>
            </div>
            <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="font-bold text-sm text-neutral-950">Row Level Security</div>
              <div className="text-[11px] text-neutral-500 mt-1">Granular Role Protection</div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Call To Action Banner */}
      <section className="py-20 bg-neutral-950 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
            Launch the eRTMAC-NWIS Console
          </h2>
          <p className="text-neutral-400 text-base sm:text-lg max-w-2xl mx-auto mb-8">
            Access active drilling wells, inspect offset hazard correlations, and monitor lookahead risk in real time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to={loggedIn ? homePath : '/login'}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-white text-neutral-950 font-bold text-base hover:bg-neutral-100 transition-all shadow-lg"
            >
              <span>{loggedIn ? 'Open Active Wells Dashboard' : 'Sign In / Demo Login'}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-neutral-200 py-10 bg-white text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="font-semibold text-neutral-900">eRTMAC-NWIS</span> · Nearby Wells Intelligence System
            <span className="block sm:inline sm:ml-2">Oil India Limited · SIH26121 Hackathon</span>
          </div>
          <div className="flex items-center gap-6 text-neutral-600">
            <Link to="/login" className="hover:text-neutral-950">
              Sign In
            </Link>
            <a href="#lookahead" className="hover:text-neutral-950">
              Risk Engine
            </a>
            <a href="#rig-rtoc" className="hover:text-neutral-950">
              Rig View
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default LandingPage;

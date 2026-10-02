import React, { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X, Bell, Search, ChevronRight } from 'lucide-react';
import { Badge, Spinner, cn, FOCUS_RING } from '../components/ui/Primitives';
import { ROLE_LABELS } from '../lib/constants';
import { useProfile } from '../features/auth/useProfile';
import { useWellSummary } from '../lib/hooks/wells';
import { AlertBanner } from '../features/alerts/AlertBanner';
import { useAlerts } from '../features/alerts/AlertProvider';
import { isUnacked } from '../features/alerts/alertUtils';
import { useRealtimeConnected } from '../lib/hooks/alerts';
import { navItemsFor } from './nav';
import { ErrorBoundary } from './ErrorBoundary';

const soundModules = import.meta.glob('../features/alerts/EnableSoundButton.jsx');
const soundLoader = soundModules['../features/alerts/EnableSoundButton.jsx'];
const EnableSoundButton = soundLoader ? lazy(() => soundLoader().then((m) => ({ default: m.EnableSoundButton || m.default }))) : null;

export function SoundMount() {
  if (!EnableSoundButton) return null;
  return (
    <Suspense fallback={null}>
      <EnableSoundButton />
    </Suspense>
  );
}

// @surface #11161d (the dark sidebar)
export function UserBar({ className }) {
  const { profile, signOut } = useProfile();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className={cn('flex items-center gap-4 text-sm', className)}>
      <SoundMount />
      
      {profile && (
        <Badge className="bg-[#1e293b] text-blue-300 border border-blue-900/50" data-testid="role-badge">
          {ROLE_LABELS[profile.role] || profile.role}
        </Badge>
      )}

      <div className="hidden sm:flex items-center gap-3 border-l border-gray-800 pl-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-xs font-bold text-white shadow-sm">
          {(profile?.full_name || profile?.email || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-medium text-gray-200" data-testid="user-name">
            {profile?.full_name || profile?.email?.split('@')[0]}
          </span>
        </div>
      </div>

      <button
        onClick={handleSignOut}
        disabled={busy}
        className="ml-2 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

// @surface #11161d (the dark sidebar)
export function SidebarProfile() {
  const { profile, signOut } = useProfile();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  if (!profile) return null;

  const initials = (profile.full_name || profile.email || 'U').charAt(0).toUpperCase();

  return (
    <div 
      className="mt-auto border-t border-gray-800/60 p-4 flex items-center justify-between cursor-pointer hover:bg-[#1e293b] transition-colors"
      onClick={handleSignOut}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSignOut()}
      role="button"
      tabIndex={0}
      aria-label="Sign out"
      title="Sign out"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-700 text-xs font-bold text-white shadow-sm">
          {initials}
        </div>
        <div className="flex flex-col leading-tight truncate">
          <span className="font-medium text-sm text-gray-200 truncate" data-testid="user-name">
            {profile.full_name || profile.email?.split('@')[0]}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-gray-400 truncate" data-testid="role-badge">
            {ROLE_LABELS[profile.role] || profile.role}
          </span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
    </div>
  );
}

// @surface light (the white top bar)
export function TopNav() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { alerts = [] } = useAlerts();
  const connected = useRealtimeConnected();
  const unacked = alerts.filter(isUnacked).length;
  const initials = profile ? (profile.full_name || profile.email || 'U').charAt(0).toUpperCase() : 'U';

  return (
    <div className="flex items-center gap-6">
      <div className="hidden lg:flex items-center bg-gray-50 border border-gray-200 rounded px-3 py-1.5 w-64">
        <Search className="h-4 w-4 text-gray-600 mr-2" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search')}
          aria-label="Search wells, events, documents"
          placeholder="Search wells, events, documents"
          className="bg-transparent border-none outline-none text-sm w-full text-gray-700 placeholder:text-gray-600" />
        <div className="border border-gray-200 rounded px-1.5 text-[10px] text-gray-600 ml-2">⌘ K</div>
      </div>
      
      <div className="hidden sm:flex items-center gap-2 text-sm" role="status" data-testid="realtime-status">
        <div className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <span className="text-gray-700">{connected ? 'Live updates on' : 'Reconnecting…'}</span>
      </div>
      
      <button className="relative text-gray-600 hover:text-gray-900 transition-colors" aria-label="Alerts" onClick={() => navigate('/alerts')}>
        <Bell className="h-5 w-5" />
        {unacked > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-700 text-[8px] font-bold text-white border-2 border-white">{unacked > 9 ? '9+' : unacked}</span>
        )}
      </button>
      
      <div className="h-8 w-8 rounded bg-amber-700 text-white flex items-center justify-center text-xs font-bold shadow-sm">
        {initials}
      </div>
    </div>
  );
}

// @surface light (the white top bar)
function WellContext({ wellboreId }) {
  const { data: well } = useWellSummary(wellboreId);
  if (!well) return null;
  return (
    <span className="hidden md:flex items-center gap-2 text-sm" data-testid="well-context">
      <span className="text-gray-600">/</span>
      <span className="font-medium text-gray-900">{well.well_name}</span>
    </span>
  );
}

// @surface #11161d (the dark sidebar)
function SideNav({ items, onNavigate }) {
  const groups = [...new Set(items.map((i) => i.group || ''))];
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-4 py-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-800">
      {groups.map((group) => (
        <div key={group || 'main'} className="space-y-1">
          {group && <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">{group}</div>}
          {items
            .filter((i) => (i.group || '') === group)
            .map(({ id, label, to, icon: Icon }) => (
              <NavLink
                key={id}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium transition-all duration-200',
                    FOCUS_RING,
                    isActive 
                      ? 'text-white' 
                      : 'text-gray-400 hover:text-gray-200',
                  )
                }
              >
                <Icon className={cn("h-4 w-4 shrink-0 transition-colors", "text-current")} />
                {label}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { profile } = useProfile();
  const location = useLocation();
  const wellMatch = useMatch('/wells/:wellboreId/*');
  const [open, setOpen] = useState(false);
  const items = navItemsFor(profile);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-[#f4f6f9] text-gray-900 font-sans selection:bg-blue-500/30">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-[#11161d] z-20 text-gray-300">
        <div className="flex h-16 shrink-0 items-center px-6">
          <div className="flex items-end gap-0.5 mr-2">
            <div className="h-2 w-1.5 rounded-sm bg-orange-400" />
            <div className="h-3 w-1.5 rounded-sm bg-orange-400" />
            <div className="h-4 w-1.5 rounded-sm bg-orange-400" />
          </div>
          <span className="text-sm font-bold tracking-wide text-white mr-2">NWIS</span>
          <span className="text-[10px] text-gray-400 font-medium tracking-widest uppercase">Well Intelligence</span>
        </div>
        <SideNav items={items} />
        
        {/* Bottom nav actions */}
        <SidebarProfile />
      </aside>

      {/* Phone drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setOpen(false)} />
          <aside id="mobile-nav" className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[#0B0F19] shadow-2xl transition-transform">
            <div className="flex h-16 items-center justify-between px-6 border-b border-gray-800/60">
              <div className="flex items-center gap-2">
                <div className="flex items-end gap-0.5">
                  <div className="h-2 w-1.5 rounded-sm bg-orange-400" />
                  <div className="h-3.5 w-1.5 rounded-sm bg-orange-400" />
                  <div className="h-5 w-1.5 rounded-sm bg-orange-400" />
                </div>
                <span className="text-lg font-bold text-white">NWIS</span>
              </div>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className={cn('rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-white', FOCUS_RING)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden relative">
        {/* Top header */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8 z-10 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-nav"
              className={cn('md:hidden rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900', FOCUS_RING)}
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center text-sm">
              <span className="text-gray-500">Operations</span>
              <span aria-hidden="true" className="mx-2 text-gray-500">›</span>
              <span className="font-medium text-gray-900">wells</span>
              {wellMatch?.params.wellboreId && <WellContext wellboreId={wellMatch.params.wellboreId} />}
            </div>
          </div>
          <TopNav />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12">
          <AlertBanner />
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-gray-600">
                  <Spinner className="h-8 w-8 text-blue-700" />
                  <span className="text-sm font-medium tracking-wide uppercase">Loading workspace</span>
                </div>
              </div>
            }>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { Badge, Button, Spinner, cn, FOCUS_RING } from '../components/ui/Primitives';
import { ROLE_LABELS } from '../lib/constants';
import { useProfile } from '../features/auth/useProfile';
import { useWellSummary } from '../lib/hooks/wells';
import { AlertBanner } from '../features/alerts/AlertBanner';
import { navItemsFor } from './nav';
import { ErrorBoundary } from './ErrorBoundary';

// The sound-enable button is built by the alerts feature. Load it if the file exists so this layout
// never breaks the build when it is missing (Vite resolves the glob at build time).
const soundModules = import.meta.glob('../features/alerts/EnableSoundButton.jsx');
const soundLoader = soundModules['../features/alerts/EnableSoundButton.jsx'];
const EnableSoundButton = soundLoader ? lazy(() => soundLoader().then((m) => ({ default: m.EnableSoundButton || m.default }))) : null;

/** Mount point for the "Enable alert sound" button (PRD FE-09: shown in the top bar). */
export function SoundMount() {
  if (!EnableSoundButton) return null;
  return (
    <Suspense fallback={null}>
      <EnableSoundButton />
    </Suspense>
  );
}

/** User name, role badge and sign-out. Shared by the office layout and the rig shell. */
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
    <div className={cn('flex items-center gap-3', className)}>
      <SoundMount />
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-sm font-medium" data-testid="user-name">{profile?.full_name || profile?.email}</span>
      </div>
      {profile && (
        <Badge className="bg-blue-100 text-blue-900" data-testid="role-badge">
          {ROLE_LABELS[profile.role] || profile.role}
        </Badge>
      )}
      <Button variant="outline" size="sm" onClick={handleSignOut} disabled={busy} aria-label="Sign out" className="flex items-center gap-1 bg-white">
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </div>
  );
}

/** Small breadcrumb of the well being viewed (only rendered inside /wells/:id/*). */
function WellContext({ wellboreId }) {
  const { data: well } = useWellSummary(wellboreId);
  if (!well) return null;
  return (
    <span className="hidden md:inline text-sm text-gray-500 truncate" data-testid="well-context">
      / {well.well_name}
    </span>
  );
}

function SideNav({ items, onNavigate }) {
  const groups = [...new Set(items.map((i) => i.group || ''))];
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto p-3 space-y-1">
      {groups.map((group) => (
        <div key={group || 'main'} className={group ? 'pt-3 mt-3 border-t border-gray-200' : undefined}>
          {group && <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{group}</div>}
          {items
            .filter((i) => (i.group || '') === group)
            .map(({ id, label, to, icon: Icon }) => (
              <NavLink
                key={id}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded px-2 py-2 text-sm hover:bg-gray-100',
                    FOCUS_RING,
                    isActive ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-gray-700',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Office layout: top bar (app name, well context, user, role badge, sign out, sound button),
 * role-filtered side nav (a slide-over drawer on phones), the alert banner and the page outlet.
 */
export default function Layout() {
  const { profile } = useProfile();
  const location = useLocation();
  const wellMatch = useMatch('/wells/:wellboreId/*');
  const [open, setOpen] = useState(false);
  const items = navItemsFor(profile);

  // Close the phone drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex w-56 lg:w-64 shrink-0 flex-col bg-white border-r border-gray-200">
        <div className="p-4 font-bold text-lg border-b border-gray-200">NWIS</div>
        <SideNav items={items} />
      </aside>

      {/* Phone drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside id="mobile-nav" className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <span className="font-bold text-lg">NWIS</span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className={cn('rounded p-1', FOCUS_RING)}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <SideNav items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className={cn('md:hidden rounded p-2 hover:bg-gray-100', FOCUS_RING)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <Link to="/" className={cn('font-bold rounded', FOCUS_RING)}>
              NWIS<span className="hidden sm:inline font-normal text-gray-500"> Offset Well Intelligence</span>
            </Link>
            {wellMatch?.params.wellboreId && <WellContext wellboreId={wellMatch.params.wellboreId} />}
          </div>
          <UserBar />
        </header>

        <AlertBanner />

        <main className="flex-1 overflow-y-auto p-3 sm:p-4">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<div className="flex justify-center p-10"><Spinner /></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

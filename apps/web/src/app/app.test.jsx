import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- hermetic feature stubs: the shell (routing, guards, layout, nav) is what is under test ----
const h = vi.hoisted(() => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }));
vi.mock('../lib/hooks/wells', () => ({ useWellSummary: () => ({ data: { well_name: 'SYN-TEST-01' } }) }));
vi.mock('../features/alerts/AlertProvider', () => ({ AlertProvider: ({ children }) => children }));
vi.mock('../features/alerts/AlertBanner', () => ({ AlertBanner: () => <div data-testid="alert-banner" /> }));
vi.mock('../features/wells/WellsPage', () => ({ WellsPage: () => 'WELLS PAGE' }));
vi.mock('../features/rig/RigView', () => ({ RigView: () => 'RIG VIEW' }));
vi.mock('../features/alerts/AlertsPage', () => ({ AlertsPage: () => 'ALERTS PAGE' }));
vi.mock('../features/alerts/WellAlertsTab', () => ({ WellAlertsTab: () => 'WELL ALERTS TAB' }));
vi.mock('../features/documents/DocumentsPage', () => ({ DocumentsPage: () => 'DOCUMENTS PAGE' }));
vi.mock('../features/review/ReviewQueue', () => ({ ReviewQueue: () => 'REVIEW QUEUE' }));
vi.mock('../features/review/ReviewDoc', () => ({ ReviewDoc: () => 'REVIEW DOC' }));
vi.mock('../features/correlation/CorrelationTab', () => ({ CorrelationTab: () => 'CORRELATION TAB' }));
vi.mock('../features/risk/RiskTab', () => ({ RiskTab: () => 'RISK TAB' }));
vi.mock('../features/workspace/WorkspaceMap', () => ({ default: () => 'MAP TAB' }));
vi.mock('../features/workspace/FormationTab', () => ({ FormationTab: () => 'FORMATION TAB', default: () => 'FORMATION TAB' }));
vi.mock('../features/alerts/EnableSoundButton', () => ({ EnableSoundButton: () => <button>Enable alert sound</button> }));
vi.mock('../features/workspace/WorkspaceLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    default: () => (
      <div>
        <span>WORKSPACE HEADER</span>
        <Outlet />
      </div>
    ),
  };
});

import { AppRoutes } from './routes';
import { AuthProvider } from '../features/auth/AuthProvider';
import { MOCK_SESSION_KEY } from '../features/auth/mockAuth';
import { db } from '../mocks/db';
import { ACTIVE_WELLBORE_ID } from '../mocks/ids';

const byRole = (role) => db.profiles.find((p) => p.role === role);

function Probe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderApp(path = '/', { as } = {}) {
  if (as) window.localStorage.setItem(MOCK_SESSION_KEY, byRole(as).id);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const navLabels = () =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('link')
    .map((a) => a.textContent.trim());

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  window.localStorage.clear();
  db.reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('role home pages via the mock role picker', () => {
  const cases = [
    ['rtoc_engineer', 'RTOC engineer', 'WELLS PAGE', '/wells'],
    ['rig_engineer', 'Rig engineer', 'RIG VIEW', `/rig/${ACTIVE_WELLBORE_ID}`],
    ['office_engineer', 'Office engineer', 'WELLS PAGE', '/wells'],
    ['reviewer', 'Reviewer', 'REVIEW QUEUE', '/review'],
    ['admin', 'Admin', 'WELLS PAGE', '/wells'],
  ];

  it.each(cases)('%s lands on its home page', async (_role, label, text, path) => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: new RegExp(`Log in as ${label}`) }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(path);
  });

  it('a rig engineer profile is assigned the active wellbore from mocks/ids.js', () => {
    expect(byRole('rig_engineer').assigned_wellbore_ids).toEqual([ACTIVE_WELLBORE_ID]);
  });

  it('the picker works without any Supabase session', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: /Log in as Admin/ }));
    await screen.findByText('WELLS PAGE');
    expect(h.supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('restores a mock session after reload', async () => {
    renderApp('/', { as: 'reviewer' });
    expect(await screen.findByText('REVIEW QUEUE')).toBeInTheDocument();
  });
});

describe('guards', () => {
  it('unauthenticated users are sent to /login', async () => {
    renderApp('/wells');
    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
  });

  it.each([
    ['office_engineer', '/admin/users'],
    ['rig_engineer', '/alerts'],
    ['rtoc_engineer', '/documents'],
    ['reviewer', '/planning'],
    ['rtoc_engineer', '/admin/models'],
  ])('%s gets a 403 on %s', async (role, path) => {
    renderApp(path, { as: role });
    expect(await screen.findByText('403 Forbidden')).toBeInTheDocument();
    expect(screen.queryByText('ALERTS PAGE')).toBeNull();
  });

  it('allows a permitted role', async () => {
    renderApp('/alerts', { as: 'rtoc_engineer' });
    expect(await screen.findByText('ALERTS PAGE')).toBeInTheDocument();
  });

  it('a rig engineer cannot open the rig view of a wellbore that is not assigned to them', async () => {
    renderApp('/rig/some-other-wellbore', { as: 'rig_engineer' });
    expect(await screen.findByText('403 Forbidden')).toBeInTheDocument();
  });

  it('a rig engineer can open the assigned rig view', async () => {
    renderApp(`/rig/${ACTIVE_WELLBORE_ID}`, { as: 'rig_engineer' });
    expect(await screen.findByText('RIG VIEW')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('unknown paths show a 404 inside the layout', async () => {
    renderApp('/nope', { as: 'admin' });
    expect(await screen.findByText(/404/)).toBeInTheDocument();
  });
});

describe('workspace routes', () => {
  it('/wells/:id redirects to the map tab', async () => {
    renderApp('/wells/abc', { as: 'rtoc_engineer' });
    expect(await screen.findByText('MAP TAB')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/wells/abc/map');
  });

  it.each([
    ['correlation', 'CORRELATION TAB'],
    ['risk', 'RISK TAB'],
    ['alerts', 'WELL ALERTS TAB'],
  ])('renders the real %s tab', async (tab, text) => {
    renderApp(`/wells/abc/${tab}`, { as: 'office_engineer' });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows the well in the top bar', async () => {
    renderApp('/wells/abc/map', { as: 'admin' });
    expect(await screen.findByTestId('well-context')).toHaveTextContent('SYN-TEST-01');
  });

  it('the formation tab is wired (auto-detected optional page)', async () => {
    renderApp('/wells/abc/formation', { as: 'admin' });
    expect(await screen.findByText('FORMATION TAB')).toBeInTheDocument();
    expect(screen.getByText('WORKSPACE HEADER')).toBeInTheDocument();
  });
});

describe('layout', () => {
  it('shows user name, role badge, banner and a working sign-out', async () => {
    const user = userEvent.setup();
    renderApp('/wells', { as: 'rtoc_engineer' });
    await screen.findByText('WELLS PAGE');
    expect(screen.getByTestId('user-name')).toHaveTextContent(byRole('rtoc_engineer').full_name);
    expect(screen.getByTestId('role-badge')).toHaveTextContent('RTOC engineer');
    expect(screen.getByTestId('alert-banner')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Enable alert sound' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
    expect(window.localStorage.getItem(MOCK_SESSION_KEY)).toBeNull();
    expect(h.supabase.auth.signOut).toHaveBeenCalled();
  });

  it('after sign-out protected pages redirect to login again', async () => {
    const user = userEvent.setup();
    renderApp('/wells', { as: 'admin' });
    await screen.findByText('WELLS PAGE');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: /Sign in/i });
    expect(screen.queryByText('WELLS PAGE')).toBeNull();
  });

  it('the phone drawer opens and closes', async () => {
    const user = userEvent.setup();
    renderApp('/wells', { as: 'admin' });
    await screen.findByText('WELLS PAGE');
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
  });
});

describe('side nav is filtered by role', () => {
  const expected = {
    rtoc_engineer: ['Wells', 'Alerts', 'Search & Ask', 'Analytics'],
    rig_engineer: ['Rig view', 'Wells', 'Search & Ask', 'Analytics'],
    office_engineer: ['Wells', 'Documents', 'Review', 'Search & Ask', 'Planning', 'Analytics'],
    reviewer: ['Wells', 'Documents', 'Review', 'Search & Ask', 'Analytics'],
    admin: ['Wells', 'Alerts', 'Documents', 'Review', 'Search & Ask', 'Planning', 'Analytics', 'Users', 'Models'],
  };

  it.each(Object.entries(expected))('%s sees only its links', async (role, labels) => {
    renderApp('/wells', { as: role });
    await screen.findByText('WELLS PAGE');
    expect(navLabels()).toEqual(labels);
  });

  it('every visible link is reachable (no link leads to a 403)', async () => {
    const user = userEvent.setup();
    renderApp('/wells', { as: 'office_engineer' });
    await screen.findByText('WELLS PAGE');
    for (const label of navLabels()) {
      await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: label }));
      await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull());
      expect(screen.queryByText('403 Forbidden')).toBeNull();
    }
  });

  it('the rig link points at the assigned wellbore', async () => {
    renderApp('/wells', { as: 'rig_engineer' });
    await screen.findByText('WELLS PAGE');
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Rig view' });
    expect(link).toHaveAttribute('href', `/rig/${ACTIVE_WELLBORE_ID}`);
  });
});

describe('ComingSoon placeholder', () => {
  it('looks intentional: heading, description and the task it is scheduled under', async () => {
    const { ComingSoon } = await import('./lazyPages');
    render(<ComingSoon title="Analytics" task="FE-15" description="NPT by formation." />);
    expect(screen.getByRole('heading', { name: 'Analytics is coming soon' })).toBeInTheDocument();
    expect(screen.getByText(/NPT by formation\. \(Scheduled as FE-15\.\)/)).toBeInTheDocument();
  });
});

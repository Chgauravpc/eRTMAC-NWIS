import React, { Suspense } from 'react';
import { Routes, Route, Navigate, Link, useParams } from 'react-router-dom';
import Layout from './Layout';
import { RigShell } from './RigShell';
import { ROUTE_ROLES } from './nav';
import { lazyExport, optionalPage } from './lazyPages';
import { RequireRole } from '../features/auth/RequireRole';
import { ForbiddenPage } from '../features/auth/ForbiddenPage';
import { LoginPage } from '../features/auth/LoginPage';
import { LandingPage } from '../features/landing/LandingPage';
import { useProfile } from '../features/auth/useProfile';
import { roleHome } from '../features/auth/roleHome';
import { AlertProvider } from '../features/alerts/AlertProvider';
import { EmptyState, Spinner, FOCUS_RING, cn } from '../components/ui/Primitives';

// Heavy pages (Leaflet, Plotly, PDF/page viewers) are code-split.
const WellsPage = lazyExport(() => import('../features/wells/WellsPage'), 'WellsPage');
const WorkspaceLayout = lazyExport(() => import('../features/workspace/WorkspaceLayout'), 'default');
const WorkspaceMap = lazyExport(() => import('../features/workspace/WorkspaceMap'), 'default');
const CorrelationTab = lazyExport(() => import('../features/correlation/CorrelationTab'), 'CorrelationTab');
const RiskTab = lazyExport(() => import('../features/risk/RiskTab'), 'RiskTab');
const WellAlertsTab = lazyExport(() => import('../features/alerts/WellAlertsTab'), 'WellAlertsTab');
const AlertsPage = lazyExport(() => import('../features/alerts/AlertsPage'), 'AlertsPage');
const RigView = lazyExport(() => import('../features/rig/RigView'), 'RigView');
const DocumentsPage = lazyExport(() => import('../features/documents/DocumentsPage'), 'DocumentsPage');
const ReviewQueue = lazyExport(() => import('../features/review/ReviewQueue'), 'ReviewQueue');
const ReviewDoc = lazyExport(() => import('../features/review/ReviewDoc'), 'ReviewDoc');

// Pages of later tasks: wired automatically once their file exists, otherwise an intentional "coming soon".
const FormationTab = optionalPage('features/workspace/FormationTab.jsx', 'FormationTab', {
  title: 'Formation & events',
  task: 'FE-04/FE-05',
  description: 'Current and next formation, historical events from offset wells, and lessons will appear here.',
});
const SearchAsk = optionalPage('features/search/SearchPage.jsx', 'SearchPage', {
  title: 'Search & Ask',
  task: 'FE-12',
  description: 'Ask questions of the document archive and search with cited sources.',
});
const Planning = optionalPage('features/planning/PlanningPage.jsx', 'PlanningPage', {
  title: 'Pre-spud planning',
  task: 'FE-13',
  description: 'Offset brief, predicted tops and risk profile for a planned location.',
});
const Analytics = optionalPage('features/analytics/AnalyticsPage.jsx', 'AnalyticsPage', {
  title: 'Analytics',
  task: 'FE-15',
  description: 'NPT by formation and event counts by field.',
});
const AdminUsers = optionalPage('features/admin/UsersPage.jsx', 'UsersPage', {
  title: 'User administration',
  task: 'FE-14',
  description: 'Invite users and assign roles and wellbores.',
});
const AdminModels = optionalPage('features/admin/ModelsPage.jsx', 'ModelsPage', {
  title: 'Models',
  task: 'FE-14',
  description: 'Model versions, metrics and retraining.',
});

const Fallback = () => (
  <div className="flex justify-center p-10">
    <Spinner />
  </div>
);
const Page = ({ children }) => <Suspense fallback={<Fallback />}>{children}</Suspense>;

/** "/" -> if authenticated, redirect to role home; otherwise show LandingPage. */
function RoleRedirect() {
  const { profile, session, isLoading } = useProfile();
  if (isLoading) return <Fallback />;
  if (session && profile) return <Navigate to={roleHome(profile)} replace />;
  return <LandingPage />;
}

/** A rig engineer may only open the rig view of a wellbore they are assigned to. */
function RigWellboreGuard({ children }) {
  const { wellboreId } = useParams();
  const { profile } = useProfile();
  if (profile?.role === 'rig_engineer' && !profile.assigned_wellbore_ids?.includes(wellboreId)) {
    return <ForbiddenPage role={profile.role} />;
  }
  return children;
}

function NotFound() {
  return (
    <EmptyState
      title="404: page not found"
      message="That address does not exist."
      action={
        <Link to="/" className={cn('rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700', FOCUS_RING)}>
          Go to my home page
        </Link>
      }
    />
  );
}

const guard = (roles, el) => (
  <RequireRole roles={roles}>
    <Page>{el}</Page>
  </RequireRole>
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/rig/:wellboreId"
        element={
          <RequireRole roles={ROUTE_ROLES.rig}>
            <RigWellboreGuard>
              <AlertProvider>
                <RigShell>
                  <RigView />
                </RigShell>
              </AlertProvider>
            </RigWellboreGuard>
          </RequireRole>
        }
      />

      <Route
        element={
          <RequireRole>
            <AlertProvider>
              <Layout />
            </AlertProvider>
          </RequireRole>
        }
      >
        <Route path="/wells" element={<Page><WellsPage /></Page>} />

        <Route path="/wells/:wellboreId" element={<Page><WorkspaceLayout /></Page>}>
          <Route index element={<Navigate to="map" replace />} />
          <Route path="map" element={<Page><WorkspaceMap /></Page>} />
          <Route path="formation" element={<Page><FormationTab /></Page>} />
          <Route path="correlation" element={<Page><CorrelationTab /></Page>} />
          <Route path="risk" element={<Page><RiskTab /></Page>} />
          <Route path="alerts" element={<Page><WellAlertsTab /></Page>} />
        </Route>

        <Route path="/alerts" element={guard(ROUTE_ROLES.alerts, <AlertsPage />)} />
        <Route path="/documents" element={guard(ROUTE_ROLES.documents, <DocumentsPage />)} />
        <Route path="/review" element={guard(ROUTE_ROLES.review, <ReviewQueue />)} />
        <Route path="/review/:docId" element={guard(ROUTE_ROLES.review, <ReviewDoc />)} />

        <Route path="/search" element={<Page><SearchAsk /></Page>} />
        <Route path="/planning" element={guard(ROUTE_ROLES.planning, <Planning />)} />
        <Route path="/analytics" element={<Page><Analytics /></Page>} />

        <Route path="/admin/users" element={guard(ROUTE_ROLES.adminUsers, <AdminUsers />)} />
        <Route path="/admin/models" element={guard(ROUTE_ROLES.adminModels, <AdminModels />)} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

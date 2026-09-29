import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import { RequireRole } from '../features/auth/RequireRole';
import { LoginPage } from '../features/auth/LoginPage';
import { useProfile } from '../features/auth/useProfile';
import { Spinner } from '../components/ui/Primitives';

const RoleRedirect = () => {
  const { profile, isLoading } = useProfile();
  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;
  if (!profile) return <Navigate to="/login" replace />;
  
  switch(profile.role) {
    case 'rig_engineer': return <Navigate to={`/rig/${profile.assigned_wellbore_ids?.[0] || 'mock-wellbore-id'}`} replace />;
    case 'reviewer': return <Navigate to="/review" replace />;
    default: return <Navigate to="/wells" replace />;
  }
};

import WorkspaceLayout from '../features/workspace/WorkspaceLayout';
import { WellsPage } from '../features/wells/WellsPage';
import { CorrelationTab } from '../features/correlation/CorrelationTab';

// Placeholder Pages
const WorkspaceMap = () => <div className="p-4">Workspace: Map</div>;
const WorkspaceFormation = () => <div className="p-4">Workspace: Formation</div>;
const WorkspaceRisk = () => <div className="p-4">Workspace: Risk Ahead</div>;
const WorkspaceAlerts = () => <div className="p-4">Workspace: Alerts</div>;
const RigView = () => <div className="p-4 rig h-screen">Rig View</div>;
const AlertsPage = () => <div className="p-4">All Open Alerts</div>;
const DocumentsPage = () => <div className="p-4">Documents</div>;
const ReviewQueue = () => <div className="p-4">Review Queue</div>;
const ReviewDoc = () => <div className="p-4">Review Doc</div>;
const SearchAsk = () => <div className="p-4">Search & Ask</div>;
const Planning = () => <div className="p-4">Planning</div>;
const Analytics = () => <div className="p-4">Analytics</div>;
const AdminUsers = () => <div className="p-4">Admin: Users</div>;
const AdminModels = () => <div className="p-4">Admin: Models</div>;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/rig/:wellboreId" element={<RequireRole roles={['rig_engineer', 'rtoc_engineer', 'admin']}><RigView /></RequireRole>} />
      
      <Route element={<RequireRole><Layout /></RequireRole>}>
        <Route path="/wells" element={<WellsPage />} />
        
        <Route path="/wells/:wellboreId" element={<WorkspaceLayout />}>
          <Route path="map" element={<WorkspaceMap />} />
          <Route path="formation" element={<WorkspaceFormation />} />
          <Route path="correlation" element={<CorrelationTab />} />
          <Route path="risk" element={<WorkspaceRisk />} />
          <Route path="alerts" element={<WorkspaceAlerts />} />
        </Route>
        
        <Route path="/alerts" element={<RequireRole roles={['rtoc_engineer', 'admin']}><AlertsPage /></RequireRole>} />
        <Route path="/documents" element={<RequireRole roles={['reviewer', 'office_engineer', 'admin']}><DocumentsPage /></RequireRole>} />
        
        <Route path="/review" element={<RequireRole roles={['reviewer', 'office_engineer', 'admin']}><ReviewQueue /></RequireRole>} />
        <Route path="/review/:docId" element={<RequireRole roles={['reviewer', 'office_engineer', 'admin']}><ReviewDoc /></RequireRole>} />
        
        <Route path="/search" element={<SearchAsk />} />
        
        <Route path="/planning" element={<RequireRole roles={['office_engineer', 'admin']}><Planning /></RequireRole>} />
        <Route path="/analytics" element={<Analytics />} />
        
        <Route path="/admin/users" element={<RequireRole roles={['admin']}><AdminUsers /></RequireRole>} />
        <Route path="/admin/models" element={<RequireRole roles={['admin']}><AdminModels /></RequireRole>} />
      </Route>
    </Routes>
  );
}

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './Layout';

// Placeholder Pages
const Login = () => <div className="p-4">Login Page</div>;
const RoleRedirect = () => <div className="p-4">Role Redirect...</div>;
const WellsPage = () => <div className="p-4">Active Wells</div>;
const WorkspaceMap = () => <div className="p-4">Workspace: Map</div>;
const WorkspaceFormation = () => <div className="p-4">Workspace: Formation</div>;
const WorkspaceCorrelation = () => <div className="p-4">Workspace: Correlation</div>;
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
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RoleRedirect />} />
      <Route path="/rig/:wellboreId" element={<RigView />} />
      <Route element={<Layout />}>
        <Route path="/wells" element={<WellsPage />} />
        <Route path="/wells/:wellboreId/map" element={<WorkspaceMap />} />
        <Route path="/wells/:wellboreId/formation" element={<WorkspaceFormation />} />
        <Route path="/wells/:wellboreId/correlation" element={<WorkspaceCorrelation />} />
        <Route path="/wells/:wellboreId/risk" element={<WorkspaceRisk />} />
        <Route path="/wells/:wellboreId/alerts" element={<WorkspaceAlerts />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/review/:docId" element={<ReviewDoc />} />
        <Route path="/search" element={<SearchAsk />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/models" element={<AdminModels />} />
      </Route>
    </Routes>
  );
}

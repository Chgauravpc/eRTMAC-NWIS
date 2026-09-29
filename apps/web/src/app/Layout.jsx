import React from 'react';
import { Outlet, Link } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 font-bold text-lg border-b border-gray-200">NWIS</div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          <Link to="/wells" className="block px-2 py-1 rounded hover:bg-gray-100">Wells</Link>
          <Link to="/alerts" className="block px-2 py-1 rounded hover:bg-gray-100">Alerts</Link>
          <Link to="/documents" className="block px-2 py-1 rounded hover:bg-gray-100">Documents</Link>
          <Link to="/review" className="block px-2 py-1 rounded hover:bg-gray-100">Review</Link>
          <Link to="/search" className="block px-2 py-1 rounded hover:bg-gray-100">Search</Link>
          <Link to="/planning" className="block px-2 py-1 rounded hover:bg-gray-100">Planning</Link>
          <Link to="/analytics" className="block px-2 py-1 rounded hover:bg-gray-100">Analytics</Link>
          <div className="pt-4 mt-4 border-t border-gray-200">
            <span className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Admin</span>
            <Link to="/admin/users" className="block px-2 py-1 mt-2 rounded hover:bg-gray-100">Users</Link>
            <Link to="/admin/models" className="block px-2 py-1 rounded hover:bg-gray-100">Models</Link>
          </div>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 justify-between">
          <div className="text-sm text-gray-500">Top Bar Navigation</div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">User Name (Role)</span>
          </div>
        </header>
        <div className="p-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

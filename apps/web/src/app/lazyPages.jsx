import React, { lazy } from 'react';
import { Hammer } from 'lucide-react';
import { EmptyState } from '../components/ui/Primitives';

/** Intentional "not built yet" page for routes that belong to later PRD tasks (FE-12 ... FE-16). */
export function ComingSoon({ title, task, description }) {
  return (
    <div className="py-6">
      <h1 className="sr-only">{title}</h1>
      <EmptyState
        icon={Hammer}
        title={`${title} is coming soon`}
        message={`${description || 'This screen is planned.'} (Scheduled as ${task}.)`}
      />
    </div>
  );
}

/** lazy() for a component exported by name (or default) from a dynamic import. */
export function lazyExport(load, exportName) {
  return lazy(() => load().then((m) => ({ default: m[exportName] || m.default })));
}

// Pages that are outside FE-01..FE-11. If a worker adds the file it is picked up automatically,
// otherwise the route renders a ComingSoon page. (Literal globs are required by Vite.)
const OPTIONAL = import.meta.glob([
  '../features/search/SearchPage.jsx',
  '../features/planning/PlanningPage.jsx',
  '../features/analytics/AnalyticsPage.jsx',
  '../features/admin/UsersPage.jsx',
  '../features/admin/ModelsPage.jsx',
  '../features/workspace/FormationTab.jsx',
]);

/**
 * @param {string} file path relative to src/, e.g. 'features/search/SearchPage.jsx'
 * @param {string} exportName named export to use (falls back to default)
 * @param {{title: string, task: string, description?: string}} fallback ComingSoon props
 */
export function optionalPage(file, exportName, fallback) {
  const loader = OPTIONAL[`../${file}`];
  if (loader) return lazyExport(loader, exportName);
  return lazy(() => Promise.resolve({ default: () => <ComingSoon {...fallback} /> }));
}

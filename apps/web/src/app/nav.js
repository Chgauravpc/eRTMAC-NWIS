import { AlertTriangle, BarChart3, ClipboardCheck, FileText, Gauge, Map, MapPinned, Search, Users, Cpu } from 'lucide-react';
import { roleHome } from '../features/auth/roleHome';

/**
 * Role lists per route (PRD section 4). routes.jsx and the side nav both read this table so the
 * nav can never offer a link the route guard would answer with a 403.
 */
export const ROUTE_ROLES = Object.freeze({
  rig: ['rig_engineer', 'rtoc_engineer', 'admin'],
  alerts: ['rtoc_engineer', 'admin'],
  documents: ['reviewer', 'office_engineer', 'admin'],
  review: ['reviewer', 'office_engineer', 'admin'], // office is read-only inside the page
  planning: ['office_engineer', 'admin'],
  adminUsers: ['admin'],
  adminModels: ['admin'],
});

const ALL = null; // any signed-in role

/** Side navigation. `roles: null` = every role. `to` may be a function of the profile. */
export const NAV_ITEMS = Object.freeze([
  { id: 'rig', label: 'Rig view', icon: Gauge, roles: ['rig_engineer'], to: (profile) => roleHome(profile) },
  { id: 'wells', label: 'Wells', icon: MapPinned, roles: ALL, to: '/wells', group: 'Workspace' },
  { id: 'search', label: 'Search & Ask', icon: Search, roles: ALL, to: '/search', group: 'Workspace' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, roles: ALL, to: '/analytics', group: 'Workspace' },
  
  { id: 'alerts', label: 'Alerts', icon: AlertTriangle, roles: ROUTE_ROLES.alerts, to: '/alerts', group: 'Operations' },
  { id: 'planning', label: 'Planning', icon: Map, roles: ROUTE_ROLES.planning, to: '/planning', group: 'Operations' },
  
  { id: 'documents', label: 'Documents', icon: FileText, roles: ROUTE_ROLES.documents, to: '/documents', group: 'Knowledge' },
  { id: 'review', label: 'Review queue', icon: ClipboardCheck, roles: ROUTE_ROLES.review, to: '/review', group: 'Knowledge' },
  
  { id: 'admin-users', label: 'Users', icon: Users, roles: ROUTE_ROLES.adminUsers, to: '/admin/users', group: 'Administration' },
  { id: 'admin-models', label: 'Models', icon: Cpu, roles: ROUTE_ROLES.adminModels, to: '/admin/models', group: 'Administration' },
]);

/** Nav entries visible to `profile`, with `to` resolved to a string. */
export function navItemsFor(profile) {
  if (!profile) return [];
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(profile.role))
    .map((i) => ({ ...i, to: typeof i.to === 'function' ? i.to(profile) : i.to }))
    .filter((i) => !(i.id === 'rig' && !i.to.startsWith('/rig/'))); // rig engineer without an assignment has no rig page
}

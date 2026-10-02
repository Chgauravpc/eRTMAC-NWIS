// POST /api/search: all roles -> Space POST /v1/search (contract §9.2)
import { ROLES } from './_lib/auth.js';
import { proxyRoute } from './_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ROLES, path: '/search' });

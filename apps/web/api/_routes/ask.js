// POST /api/ask: all roles -> Space POST /v1/ask (contract §9.2)
import { ROLES } from '../_lib/auth.js';
import { proxyRoute } from '../_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ROLES, path: '/ask' });

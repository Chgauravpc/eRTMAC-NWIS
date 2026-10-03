// POST /api/planning/brief: office_engineer, admin -> Space POST /v1/planning/brief (contract §9.2, §9.4)
import { proxyRoute } from '../../_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ['office_engineer', 'admin'], path: '/planning/brief' });

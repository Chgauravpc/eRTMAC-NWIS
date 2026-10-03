// POST /api/stream/start: rtoc_engineer, admin -> Space POST /v1/stream/start (contract §9.2)
import { proxyRoute } from '../../_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ['rtoc_engineer', 'admin'], path: '/stream/start' });

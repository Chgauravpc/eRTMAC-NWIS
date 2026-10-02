// POST /api/stream/speed: rtoc_engineer, admin -> Space POST /v1/stream/speed (contract §9.2)
import { proxyRoute } from '../_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ['rtoc_engineer', 'admin'], path: '/stream/speed' });

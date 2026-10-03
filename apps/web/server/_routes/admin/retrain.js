// POST /api/admin/retrain: admin -> Space POST /v1/admin/retrain (202 { model_run_ids }) (contract §9.2)
import { proxyRoute } from '../../_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: ['admin'], path: '/admin/retrain' });

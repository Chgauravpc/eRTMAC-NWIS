// POST /api/wells/{wellboreId}/predict-tops: rtoc_engineer, office_engineer, admin -> Space (contract §9.2)
import { requireUuid } from '../../_lib/errors.js';
import { proxyRoute } from '../../_lib/forward.js';

export default proxyRoute({
  methods: 'POST',
  roles: ['rtoc_engineer', 'office_engineer', 'admin'],
  prepare: (req) => void requireUuid(req.query?.wellboreId, 'wellboreId'),
  path: (req) => `/wells/${String(req.query.wellboreId).toLowerCase()}/predict-tops`,
});

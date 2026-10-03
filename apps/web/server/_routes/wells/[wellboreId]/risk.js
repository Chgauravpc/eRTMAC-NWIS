// POST /api/wells/{wellboreId}/risk: all roles -> Space (contract §9.2)
import { ROLES } from '../../../_lib/auth.js';
import { requireUuid } from '../../../_lib/errors.js';
import { proxyRoute } from '../../../_lib/forward.js';

export default proxyRoute({
  methods: 'POST',
  roles: ROLES,
  prepare: (req) => void requireUuid(req.query?.wellboreId, 'wellboreId'),
  path: (req) => `/wells/${String(req.query.wellboreId).toLowerCase()}/risk`,
});

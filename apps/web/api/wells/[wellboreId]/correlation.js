// GET /api/wells/{wellboreId}/correlation?offsets=&flatten=&channels=: all roles -> Space (contract §9.2, §9.3)
import { ROLES } from '../../_lib/auth.js';
import { requireUuid } from '../../_lib/errors.js';
import { proxyRoute } from '../../_lib/forward.js';

export default proxyRoute({
  methods: 'GET',
  roles: ROLES,
  prepare: (req) => {
    requireUuid(req.query?.wellboreId, 'wellboreId');
    const { offsets, flatten, channels } = req.query;
    return { query: { offsets, flatten, channels } }; // validated by the Space (400 for an unknown channel)
  },
  path: (req) => `/wells/${String(req.query.wellboreId).toLowerCase()}/correlation`,
});

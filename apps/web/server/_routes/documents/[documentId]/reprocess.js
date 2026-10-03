// POST /api/documents/{documentId}/reprocess: reviewer, office_engineer, admin -> Space (contract §9.2).
// No body is sent; the Space's 202 / 404 / 409 are returned unchanged.
import { UPLOAD_ROLES } from '../../../_lib/auth.js';
import { requireUuid } from '../../../_lib/errors.js';
import { proxyRoute } from '../../../_lib/forward.js';

export default proxyRoute({
  methods: 'POST',
  roles: UPLOAD_ROLES,
  prepare: (req) => {
    requireUuid(req.query?.documentId, 'documentId');
    return { body: null };
  },
  path: (req) => `/documents/${String(req.query.documentId).toLowerCase()}/reprocess`,
});

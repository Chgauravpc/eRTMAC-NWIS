// POST /api/documents: reviewer, office_engineer, admin -> Space POST /v1/documents (contract §9.2)
// The file itself never passes through here: the browser uploads to Supabase Storage with a signed URL first.
import { UPLOAD_ROLES } from './_lib/auth.js';
import { proxyRoute } from './_lib/forward.js';

export default proxyRoute({ methods: 'POST', roles: UPLOAD_ROLES, path: '/documents' });

// Contract §4: errors over HTTP are `{ "error": { "code": "NWIS_<UPPER_SNAKE>", "message": "...", "details": {} } }`.

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'NWIS_BAD_REQUEST', message, details);
export const unauthorized = (message = 'Missing or invalid access token') => new ApiError(401, 'NWIS_UNAUTHORIZED', message);
export const forbidden = (message = 'Your role may not call this endpoint') => new ApiError(403, 'NWIS_FORBIDDEN', message);
export const notFound = (message, details) => new ApiError(404, 'NWIS_NOT_FOUND', message, details);
export const upstream = (message, details, status = 502) => new ApiError(status, 'NWIS_UPSTREAM', message, details);
export const internal = (message = 'Internal server error') => new ApiError(500, 'NWIS_INTERNAL', message);

export function errorBody(code, message, details = {}) {
  return { error: { code, message, details } };
}

export function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  }
  console.error('unhandled_error', err);
  return res.status(500).json(errorBody('NWIS_INTERNAL', 'Internal server error'));
}

/** 405 for the wrong HTTP method (the contract has no 405 code, so it reuses NWIS_BAD_REQUEST). */
export function assertMethod(req, res, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  res.status(405).json(errorBody('NWIS_BAD_REQUEST', `Method ${req.method} not allowed`, { allowed: methods }));
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requireUuid(value, name) {
  if (!isUuid(value)) throw badRequest(`${name} must be a uuid`);
  return value.toLowerCase();
}

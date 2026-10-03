// Contract §9.1: forward the call to the Space at ${AI_SERVICE_URL}/v1<path> with the service token and the
// caller's identity, and return the Space's answer unchanged (status and JSON body).
import { randomUUID } from 'node:crypto';
import { assertMethod, internal, sendError, upstream } from './errors.js';
import { requireUser } from './auth.js';

const DEFAULT_TIMEOUT_MS = 50_000; // below maxDuration (60 s in vercel.json); slow Space work returns 202 instead

function timeoutMs(override) {
  return override ?? (Number(process.env.FORWARD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
}

/**
 * forwardToSpace(req, path, { method, body, query, user, timeoutMs, requestId }) -> { status, body, requestId }
 * Network error -> 502 NWIS_UPSTREAM; timeout -> 504 NWIS_UPSTREAM.
 */
export async function forwardToSpace(req, path, { method = 'POST', body, query, user, timeoutMs: override, requestId } = {}) {
  const { AI_SERVICE_URL, SERVICE_TOKEN } = process.env;
  if (!AI_SERVICE_URL || !SERVICE_TOKEN) throw internal('The AI service is not configured');

  const id = requestId ?? req?.headers?.['x-request-id'] ?? randomUUID();
  const url = new URL(`${AI_SERVICE_URL.replace(/\/+$/, '')}/v1${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const headers = { 'X-Service-Token': SERVICE_TOKEN, 'X-Request-Id': id, Accept: 'application/json' };
  if (user) {
    headers['X-User-Id'] = user.id;
    headers['X-User-Role'] = user.role;
  }
  const init = { method, headers };
  if (body !== undefined && body !== null && body !== '' && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(override));
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw upstream('The AI service did not answer in time', { path }, 504);
    throw upstream('The AI service could not be reached', { path });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw upstream('The AI service returned an unreadable answer', { path, status: response.status });
    }
  }
  return { status: response.status, body: parsed, requestId: id };
}

export function sendForwarded(res, forwarded) {
  res.setHeader('X-Request-Id', forwarded.requestId);
  if (forwarded.body === null) return res.status(forwarded.status).end();
  return res.status(forwarded.status).json(forwarded.body);
}

/**
 * A route that checks the method and role, validates, forwards to the Space and returns its answer.
 *   methods  allowed HTTP methods            roles    allowed roles (omit: any authenticated user)
 *   path     (req, ctx) -> Space path        prepare  optional (req, user) -> { body?, query? } (may throw ApiError)
 */
export function proxyRoute({ methods, roles, path, prepare }) {
  return async function handler(req, res) {
    try {
      if (!assertMethod(req, res, methods)) return undefined;
      const user = await requireUser(req, roles);
      const extra = (await prepare?.(req, user)) ?? {};
      const spacePath = typeof path === 'function' ? path(req, user) : path;
      const method = req.method;
      const forwarded = await forwardToSpace(req, spacePath, {
        method,
        user,
        body: method === 'GET' ? undefined : extra.body !== undefined ? extra.body : req.body,
        query: extra.query,
      });
      return sendForwarded(res, forwarded);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

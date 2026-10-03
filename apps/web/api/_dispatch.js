// One serverless function for every /api route (Vercel's Hobby plan allows 12 functions; we have 17 routes).
// api/[...path].js calls dispatch(); the handlers live in api/_routes/ (underscore: never deployed as functions of their own).
// The imports are static on purpose: Vercel bundles what it can trace, and a directory scan at run time would find nothing.
import adminRetrain from './_routes/admin/retrain.js';
import adminUsersInvite from './_routes/admin/users/invite.js';
import adminUsersId from './_routes/admin/users/[id].js';
import ask from './_routes/ask.js';
import documents from './_routes/documents.js';
import documentsUploadUrl from './_routes/documents/upload-url.js';
import documentsReprocess from './_routes/documents/[documentId]/reprocess.js';
import health from './_routes/health.js';
import planningBrief from './_routes/planning/brief.js';
import search from './_routes/search.js';
import streamDrop from './_routes/stream/drop.js';
import streamSpeed from './_routes/stream/speed.js';
import streamStart from './_routes/stream/start.js';
import streamStop from './_routes/stream/stop.js';
import wellsCorrelation from './_routes/wells/[wellboreId]/correlation.js';
import wellsPredictTops from './_routes/wells/[wellboreId]/predict-tops.js';
import wellsRisk from './_routes/wells/[wellboreId]/risk.js';

/** Contract §9.2 paths. `:name` segments become req.query.name. A literal segment is listed before a `:param` one. */
export const ROUTES = [
  ['admin/retrain', adminRetrain],
  ['admin/users/invite', adminUsersInvite],
  ['admin/users/:id', adminUsersId],
  ['ask', ask],
  ['documents', documents],
  ['documents/upload-url', documentsUploadUrl],
  ['documents/:documentId/reprocess', documentsReprocess],
  ['health', health],
  ['planning/brief', planningBrief],
  ['search', search],
  ['stream/drop', streamDrop],
  ['stream/speed', streamSpeed],
  ['stream/start', streamStart],
  ['stream/stop', streamStop],
  ['wells/:wellboreId/correlation', wellsCorrelation],
  ['wells/:wellboreId/predict-tops', wellsPredictTops],
  ['wells/:wellboreId/risk', wellsRisk],
].map(([pattern, handler]) => ({ segments: pattern.split('/'), handler }));

/** The route for the URL's path segments and its params, or null. */
export function resolve(segments) {
  for (const { segments: pattern, handler } of ROUTES) {
    if (pattern.length !== segments.length) continue;
    const params = {};
    const ok = pattern.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return part === segments[i];
    });
    if (ok) return { handler, params };
  }
  return null;
}

export default async function dispatch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const route = resolve(segments);
  if (!route) {
    return res.status(404).json({ error: { code: 'NWIS_NOT_FOUND', message: `No route ${url.pathname}`, details: {} } });
  }
  // the handlers read their path parameters from req.query, as they did when each was its own file
  const query = { ...Object.fromEntries(url.searchParams), ...route.params };
  try {
    req.query = query;
  } catch {
    Object.defineProperty(req, 'query', { value: query, configurable: true });
  }
  return route.handler(req, res);
}

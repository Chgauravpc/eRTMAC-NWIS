// The only serverless function. vercel.json rewrites every /api/* request to /api/dispatch?__path=<the original path>
// (Vercel's own `[...path]` file name only matches one path segment, and the SPA fallback rewrite would win over it).
// See server/_dispatch.js for the route table.
import dispatch from '../server/_dispatch.js';

export default function handler(req, res) {
  return dispatch(req, res);
}

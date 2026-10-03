// GET /api/health: public. Its own ok plus the Space's health (5 s timeout). Contract §9.2.
import { assertMethod, sendError } from '../_lib/errors.js';
import { forwardToSpace } from '../_lib/forward.js';

const SPACE_TIMEOUT_MS = 5000;

export default async function handler(req, res) {
  try {
    if (!assertMethod(req, res, 'GET')) return undefined;
    let space;
    try {
      const answer = await forwardToSpace(req, '/health', { method: 'GET', timeoutMs: SPACE_TIMEOUT_MS });
      space = answer.status === 200 && answer.body ? answer.body : { ok: false, status: answer.status };
    } catch (err) {
      space = { ok: false, error: err.message };
    }
    return res.status(200).json({ ok: true, space });
  } catch (err) {
    return sendError(res, err);
  }
}

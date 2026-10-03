// The only serverless function: every /api/* request lands here (see _dispatch.js for why and for the route table).
import dispatch from './_dispatch.js';

export default function handler(req, res) {
  return dispatch(req, res);
}

// Call the function exactly as `vercel build` bundled it (after `npx vercel build`): node e2e/bundled-function.mjs <AI_SERVICE_URL>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.AI_SERVICE_URL = process.argv[2];
process.env.SERVICE_TOKEN ||= 'unused-for-health';
const file = resolve('.vercel/output/functions/api/dispatch.func/api/dispatch.js');
const { default: handler } = await import(pathToFileURL(file).href);

const call = async (url) => {
  const out = {};
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, setHeader() {}, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; }, end(b) { out.body = b; } };
  await handler({ url, method: 'GET', headers: {} }, res);
  return { status: res.statusCode, body: JSON.stringify(out.body).slice(0, 160) };
};
console.log('health ->', await call('/api/dispatch?__path=health'));
console.log('unknown ->', await call('/api/dispatch?__path=nope'));

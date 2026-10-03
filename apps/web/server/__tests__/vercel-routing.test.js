import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dispatch from '../_dispatch.js';

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));

describe('vercel.json routing of /api (the first deploy returned the website HTML for every /api call)', () => {
  it('sends /api/* to the one function BEFORE the SPA fallback, carrying the original path', () => {
    const apiIndex = config.rewrites.findIndex((r) => r.source === '/api/(.*)');
    const spaIndex = config.rewrites.findIndex((r) => r.destination === '/index.html');
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(apiIndex).toBeLessThan(spaIndex); // the first matching rewrite wins: /(.*) would swallow /api/health
    expect(config.rewrites[apiIndex].destination).toBe('/api/dispatch?__path=$1');
    expect(Object.keys(config.functions)).toEqual(['api/dispatch.js']);
  });
});

describe('dispatch on Vercel (path in ?__path) and locally (path in the URL)', () => {
  const run = async (url) => {
    const out = {};
    const res = { status: (c) => ((out.status = c), res), json: (b) => ((out.body = b), res), setHeader() {}, end() {} };
    const req = { url, method: 'POST', headers: {} };
    await dispatch(req, res);
    return { req, out };
  };

  it('finds a nested route from __path, passes its params and the other query values, and hides __path', async () => {
    // /api/documents/d1/reprocess is POST-only and needs a login: it answers 401, which proves the route was found
    const { req, out } = await run('/api/dispatch?__path=documents/d1/reprocess&keep=1');
    expect(req.query).toEqual({ keep: '1', documentId: 'd1' });
    expect(out.status).not.toBe(404);
  });

  it('answers 404 for an unknown __path, and still reads a plain URL path (local dev server)', async () => {
    expect((await run('/api/dispatch?__path=nope/nothing')).out.status).toBe(404);
    expect((await run('/api/documents/d9/reprocess')).req.query).toEqual({ documentId: 'd9' });
  });
});

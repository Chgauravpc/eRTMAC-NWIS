// Local stand-in for `vercel dev`: serves apps/web/api/** (Vercel-style handlers) on a port, for `npm run dev`
// (Vite proxies /api to it). It does what the handlers need from Vercel: req.query (with [dynamic] segments),
// req.body (parsed JSON), res.status().json()/send(). Nothing here is used in production.
//
//   node scripts/dev-api.mjs            # port 3001; reads the repo-root .env
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../api');
const port = Number(process.env.DEV_API_PORT || 3001);

// the repo-root .env (git-ignored): KEY=value lines; real environment variables win
const envFile = resolve(here, '../../../.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/** Find the handler file for URL segments; [name] directories and files match any single segment. */
function resolveRoute(segments) {
  let dir = apiDir;
  const params = {};
  for (let i = 0; i < segments.length; i += 1) {
    const last = i === segments.length - 1;
    const names = readdirSync(dir).filter((n) => !n.startsWith('_') && n !== '__tests__');
    const exact = last ? `${segments[i]}.js` : segments[i];
    let hit = names.find((n) => n === exact);
    if (!hit) {
      hit = names.find((n) => n.startsWith('[') && (last ? n.endsWith('].js') : statSync(join(dir, n)).isDirectory()));
      if (hit) params[hit.replace(/^\[|\]\.js$|\]$/g, '')] = decodeURIComponent(segments[i]);
    }
    if (!hit) return null;
    dir = join(dir, hit);
  }
  return statSync(dir).isFile() ? { file: dir, params } : null;
}

function readBody(req) {
  return new Promise((done) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => done(Buffer.concat(chunks)));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const route = resolveRoute(segments);
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { code: 'NWIS_NOT_FOUND', message: `No route ${url.pathname}`, details: {} } }));
  }
  const raw = await readBody(req);
  req.query = { ...Object.fromEntries(url.searchParams), ...route.params };
  const type = req.headers['content-type'] || '';
  req.body = type.includes('json') && raw.length ? JSON.parse(raw.toString('utf8')) : raw.length ? raw : undefined;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    res.end(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
    return res;
  };
  try {
    const mod = await import(`${pathToFileURL(route.file).href}?t=${Date.now()}`); // fresh import: edits apply
    await mod.default(req, res);
  } catch (err) {
    console.error(`${req.method} ${url.pathname}:`, err);
    if (!res.writableEnded) res.status(500).json({ error: { code: 'NWIS_INTERNAL', message: 'Internal server error', details: {} } });
  }
}).listen(port, () => console.log(`dev api on http://localhost:${port}/api (AI_SERVICE_URL=${process.env.AI_SERVICE_URL || '(unset)'})`));

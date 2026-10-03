// Local stand-in for `vercel dev`: serves the /api routes (the same dispatcher the one deployed function uses) on a port, for
// `npm run dev` (Vite proxies /api to it). It adds what the handlers get from Vercel: req.body (parsed JSON) and
// res.status().json()/send(). Nothing here is used in production.
//
//   node scripts/dev-api.mjs            # port 3001; reads the repo-root .env
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DEV_API_PORT || 3001);

// the repo-root .env (git-ignored): KEY=value lines; real environment variables win
const envFile = resolve(here, '../../../.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { default: dispatch } = await import(pathToFileURL(resolve(here, '../server/_dispatch.js')).href);

function readBody(req) {
  return new Promise((done) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => done(Buffer.concat(chunks)));
  });
}

createServer(async (req, res) => {
  const raw = await readBody(req);
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
    await dispatch(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.url}:`, err);
    if (!res.writableEnded) res.status(500).json({ error: { code: 'NWIS_INTERNAL', message: 'Internal server error', details: {} } });
  }
}).listen(port, () => console.log(`dev api on http://localhost:${port}/api (AI_SERVICE_URL=${process.env.AI_SERVICE_URL || '(unset)'})`));

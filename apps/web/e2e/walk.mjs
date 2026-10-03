// Walk the demo path in a real browser and report what breaks: node e2e/walk.mjs [role] [outDir]
// Needs the dev servers running (backend :7860, node api :3001, vite :5173 with VITE_USE_MOCKS=false).
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const role = process.argv[2] || 'rtoc';
const out = process.argv[3] || 'e2e/shots';
const base = process.env.WEB_URL || 'http://127.0.0.1:5173';
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(
  readFileSync(resolve('../../.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const viewport = process.env.VIEWPORT === 'rig' ? { width: 1024, height: 768 } : { width: 1440, height: 900 };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport })).newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '').slice(0, 120)}`));

const shot = async (name) => {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name, '->', page.url().replace(base, ''));
};

await page.goto(`${base}/login`);
await page.fill('#login-email', `${role}@nwis.test`);
await page.fill('#login-password', env.DEMO_PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
await shot('01-after-login');

const paths = (process.env.PATHS || '/wells').split(',');
for (const [i, p] of paths.entries()) {
  await page.goto(`${base}${p}`);
  await shot(`${String(i + 2).padStart(2, '0')}-${p.replace(/\W+/g, '_')}`);
}
console.log('problems:', problems.length ? `\n  ${[...new Set(problems)].join('\n  ')}` : 'none');
await browser.close();

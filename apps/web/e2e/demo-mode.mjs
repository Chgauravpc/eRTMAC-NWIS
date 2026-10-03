// Demo mode in a real browser: node e2e/demo-mode.mjs [outDir]  (dev servers running, VITE_USE_MOCKS=false)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'e2e/shots';
const base = process.env.WEB_URL || 'http://127.0.0.1:5173';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.url().replace(/\?.*/, '').slice(0, 100)}`));

await page.goto(`${base}/login`);
await page.screenshot({ path: `${out}/d1-login-real.png` });
await page.getByRole('button', { name: 'Explore with sample data' }).click();
await page.waitForSelector('text=Demo mode (sample data)', { timeout: 30000 });
await page.screenshot({ path: `${out}/d2-login-demo.png` });
await page.getByRole('button', { name: /Log in as RTOC/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/d3-wells-demo.png` });
console.log('url', page.url().replace(base, ''), '| problems:', problems.length ? `\n  ${[...new Set(problems)].join('\n  ')}` : 'none');
await browser.close();

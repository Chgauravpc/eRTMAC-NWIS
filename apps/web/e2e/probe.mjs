// Ad-hoc probe: node e2e/probe.mjs <path> <waitMs> <outFile> [clickText]  (logged in as the RTOC demo account)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [path, waitMs = '20000', outFile = 'e2e/shots/probe.png', clickText] = process.argv.slice(2);
const base = process.env.WEB_URL || 'http://127.0.0.1:5173';
const env = Object.fromEntries(
  readFileSync(resolve('../../.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: process.env.VIEWPORT === 'rig' ? { width: 1024, height: 768 } : { width: 1440, height: 900 } })).newPage();
const log = [];
page.on('pageerror', (e) => log.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text().slice(0, 160)}`));
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/api/') || u.includes('/rest/v1/')) log.push(`${r.status()} ${r.request().method()} ${u.replace(/^.*?(\/api|\/rest\/v1)/, '$1').slice(0, 110)}`);
});
await page.goto(`${base}/login`);
await page.fill('#login-email', `${process.env.ROLE || 'rtoc'}@nwis.test`);
await page.fill('#login-password', env.DEMO_PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
log.length = 0;
await page.goto(`${base}${path}`);
if (clickText) {
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: new RegExp(clickText, 'i') }).first().click();
}
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: outFile });
console.log([...new Set(log)].slice(0, 40).join('\n'));
await browser.close();

// The scripted demo against the live stack: node e2e/demo-path.mjs [outDir]
// login (RTOC) -> well -> Start replay -> alert appears before the hidden hazard -> acknowledge -> evidence.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2] || 'e2e/shots';
const base = process.env.WEB_URL || 'http://127.0.0.1:5173';
const wellbore = process.env.WELLBORE || '1110c65e-3df1-5c6f-b1a4-cbbeefe8d58c'; // SYN-DLJ-03
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(
  readFileSync(resolve('../../.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '').slice(0, 110)}`));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

await page.goto(`${base}/login`);
await page.fill('#login-email', 'rtoc@nwis.test');
await page.fill('#login-password', env.DEMO_PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
step('signed in');

await page.goto(`${base}/wells/${wellbore}/map`);
await page.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
await shot('p1-before-start');
await page.getByRole('button', { name: 'Start', exact: true }).click();
step('replay started');

// the alert banner (or the bell) must show up while the bit is still above the hazard (3002.5 m)
const banner = page.getByRole('alert').filter({ hasText: /Mud loss|Mud losses/i }).first();
await banner.waitFor({ timeout: 120000 });
step('alert visible: ' + (await banner.innerText()).replace(/\s+/g, ' ').slice(0, 140));
const header = await page.locator('header, [data-testid=well-header]').first().innerText().catch(() => '');
step('header: ' + header.replace(/\s+/g, ' ').slice(0, 160));
await shot('p2-alert-banner');

await banner.getByRole('button', { name: /Acknowledge/i }).click();
step('acknowledge clicked');
await page.waitForTimeout(4000);
await shot('p3-acknowledged');

await page.goto(`${base}/wells/${wellbore}/alerts`);
await page.waitForTimeout(5000);
await shot('p4-well-alerts');
console.log('problems:', problems.length ? `\n  ${[...new Set(problems)].join('\n  ')}` : 'none');
await browser.close();

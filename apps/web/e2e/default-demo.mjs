// A new visitor of a build with VITE_DEMO_DEFAULT=on: demo mode from the first page, mock login, sample wells.
// node e2e/default-demo.mjs <baseUrl> [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base, out = 'e2e/shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.url().slice(0, 100)}`));

await page.goto(`${base}/login`);
await page.waitForSelector('text=Demo mode (sample data)', { timeout: 30000 });
console.log('login shows demo mode: yes');
await page.screenshot({ path: `${out}/dd1-login.png` });
await page.getByRole('button', { name: /Log in as RTOC/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
await page.waitForSelector('text=Active wells', { timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/dd2-wells.png` });
console.log('wells page after mock login: yes | url', page.url().replace(base, ''));
console.log('problems:', problems.length ? `\n  ${[...new Set(problems)].join('\n  ')}` : 'none');
await browser.close();

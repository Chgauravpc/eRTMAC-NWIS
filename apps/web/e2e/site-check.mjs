// Load a deployed site and report what the browser sees: node e2e/site-check.mjs <url> [outFile]
import { chromium } from '@playwright/test';

const [url, out = 'e2e/shots/site.png'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const log = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log.push(`console.${m.type()}: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => log.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on('response', (r) => r.status() >= 400 && log.push(`http ${r.status()} ${r.url().slice(0, 140)}`));
const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => ({ status: () => `goto failed: ${e.message}` }));
console.log('status', res.status());
await page.waitForTimeout(3000);
console.log('title:', await page.title());
console.log('body text:', (await page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ') || '(empty)');
await page.screenshot({ path: out });
console.log([...new Set(log)].join('\n') || 'no console errors');
await browser.close();

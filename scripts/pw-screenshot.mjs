import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3] || 'tests/visual/artifacts/deployed-public-url.png';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));

let status = 'n/a';
try {
  const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  status = resp ? resp.status() : 'null';
} catch (e) {
  console.log('GOTO_ERROR: ' + e.message);
}

let ready = false;
try {
  await page.waitForFunction(() => window.__DIORAMA__ && window.__DIORAMA__.ready === true, { timeout: 60000 });
  ready = true;
} catch (e) {
  console.log('READY_TIMEOUT');
}
const hasBridge = await page.evaluate(() => !!window.__DIORAMA__).catch(() => false);
const title = await page.title().catch(() => '');
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ url, status, ready, hasBridge, title, errors: errors.slice(0, 10), failed: failed.slice(0, 10) }, null, 2));
await browser.close();

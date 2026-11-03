import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const url = process.argv[2];
const out = process.argv[3];
// 全新 user-data-dir：无任何既有缓存/下载判定记录
const profile = mkdtempSync(join(tmpdir(), 'pw-clean-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1600, height: 1000 },
  args: ['--no-sandbox', '--disable-application-cache'],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
const errors = [], failed = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('requestfailed', r => failed.push(r.url()+' :: '+(r.failure()?.errorText||'')));
let downloadEvt = false;
page.on('download', () => { downloadEvt = true; });
const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(e => ({ err: e.message }));
let ready = false;
try { await page.waitForFunction(() => window.__DIORAMA__?.ready === true, { timeout: 60000 }); ready = true; } catch {}
await page.waitForTimeout(3000);
if (!downloadEvt) await page.screenshot({ path: out }).catch(()=>{});
const info = await page.evaluate(() => ({ title: document.title, has: !!window.__DIORAMA__, ready: window.__DIORAMA__?.ready })).catch(e => ({ evalError: e.message }));
console.log(JSON.stringify({ url, status: resp?.status?.() ?? null, downloadEvt, ready, info, consoleErrors: errors.slice(0,8), failed: failed.slice(0,8) }, null, 2));
await ctx.close();

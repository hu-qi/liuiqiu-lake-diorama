import { chromium } from 'playwright';
const url = process.argv[2];
const out = process.argv[3];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
// 全新上下文 + 禁用缓存，排除浏览器下载判定缓存
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, bypassCSP: true });
await ctx.route('**/*', async (route) => route.continue());
const page = await ctx.newPage();
// 用 CDP 检测是否被判定为下载
const cdp = await ctx.newCDPSession(page);
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const errors = [], failed = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('requestfailed', r => failed.push(r.url()+' :: '+(r.failure()?.errorText||'')));
const nav = await cdp.send('Page.navigate', { url }).catch(e => ({ error: e.message }));
const isDownload = nav.isDownload === true;
let ready=false;
try { await page.waitForFunction(() => window.__DIORAMA__?.ready===true, { timeout: 60000 }); ready=true; } catch {}
await page.waitForTimeout(3000);
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const d = window.__DIORAMA__;
  return {
    title: document.title,
    hasDiorama: !!d,
    ready: d?.ready,
    assets: d?.stats?.assets ?? null,
    errors: d?.stats?.errors ?? null,
  };
}).catch(e => ({ evalError: e.message }));
console.log(JSON.stringify({ url, isDownload, ready, info, consoleErrors: errors.slice(0,8), failed: failed.slice(0,8) }, null, 2));
await browser.close();

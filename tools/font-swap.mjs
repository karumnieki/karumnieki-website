// font-swap.mjs: how far the page jumps when the web fonts arrive late, on both pages, across phone to desktop widths.
// Usage: node font-swap.mjs <lvUrl> [widths=320,340,360,375,390,412,430,600,768,900,1024,1280,1440,1920] [--no-fallback]
// 2026-10-02: the hero facts line wrapped differently in the system font than in Source Sans 3, so the
// page jumped 21px on a phone when the font arrived (Lighthouse CLS 0.099 to 0.101). The size-matched fallback faces at
// the end of css/fonts.css fixed it; this test holds the woff2 files back 1.5s, as a slow phone connection would, and
// sums the layout shift (the CLS a visitor sees from the swap). A copy change can bring the jump back where a line now
// wraps differently, so run it after any text edit near the top of a page. --no-fallback strips the fallback faces to
// show the before. FAIL above 0.05 at any width (half of Google's 0.1 "good" line). Exit 1 on FAIL.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
if (!pos[0]) { console.error('usage: node font-swap.mjs <lvUrl> [widths] [--no-fallback]'); process.exit(2); }
const LV = pos[0].endsWith('/') ? pos[0] : pos[0] + '/';
const WIDTHS = (pos[1] || '320,340,360,375,390,412,430,600,768,900,1024,1280,1440,1920').split(',').map(Number);
const noFallback = args.includes('--no-fallback');
const LIMIT = 0.05;

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const results = [];
for (const [lang, url] of [['lv', LV], ['en', LV + 'en/']]) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 800 : 900 }, deviceScaleFactor: w < 768 ? 2 : 1, isMobile: w < 768, hasTouch: w < 768 });
    await answered(ctx);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.route('**/*.woff2', async r => { await new Promise(res => setTimeout(res, 1500)); r.continue(); });
    if (noFallback) {
      await page.route('**/fonts.css', async r => {
        const css = await (await r.fetch()).text();
        const cut = css.indexOf('/* Fallback faces sized');
        r.fulfill({ contentType: 'text/css', body: cut > 0 ? css.slice(0, cut) : css });
      });
    }
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const v = Math.round(await page.evaluate(() => window.__cls) * 1000) / 1000;
    results.push({ lang, w, v });
    await ctx.close();
  }
}
await browser.close();
for (const lang of ['lv', 'en']) console.log(lang + ': ' + results.filter(r => r.lang === lang).map(r => r.w + '=' + r.v).join(' '));
const worst = results.reduce((a, b) => (b.v > a.v ? b : a));
const bad = results.filter(r => r.v > LIMIT);
console.log(bad.length ? `FAIL: ${bad.map(r => r.lang + ' ' + r.w + 'px ' + r.v).join(', ')} over ${LIMIT}` : `PASS: worst swap shift ${worst.v} (${worst.lang} ${worst.w}px), limit ${LIMIT}${noFallback ? ' (fallback faces stripped)' : ''}`);
process.exit(bad.length ? 1 : 0);

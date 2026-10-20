// shot-element.mjs: scroll one element into view, wait for it to settle, screenshot just that element.
// Usage: node shot-element.mjs <url> <css selector> <out.png> [width=1440] [waitMs=4000]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [url, selector, out, widthArg = '1440', waitArg = '4000'] = process.argv.slice(2);
if (!url || !selector || !out) { console.error('usage: node shot-element.mjs <url> <selector> <out.png> [width] [waitMs]'); process.exit(2); }
const width = Number(widthArg);
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: width < 1440 ? 2 : 1, isMobile: width < 768, hasTouch: width < 768, locale: 'lv-LV' });
const page = await ctx.newPage();
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
const el = await page.waitForSelector(selector, { timeout: 15000 });
await el.scrollIntoViewIfNeeded();
await page.waitForTimeout(Number(waitArg));
await el.screenshot({ path: out });
const frames = page.frames().map(f => f.url()).filter(u => u && u !== url);
console.log(JSON.stringify({ out, frames, bad }, null, 1));
await browser.close();

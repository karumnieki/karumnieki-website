// shoot.mjs: screenshot a local page at 390 / 768 / 1440 and run the layout checks.
// Usage: node shoot.mjs <url> <outdir> <tag> [widths=390,768,1440] [--no-full] [--wait-attr=data-fonts-ready]
// Output per width: <tag>-<w>.png (first screen), <tag>-<w>-full.jpg (full page), <tag>-<w>-scrolled.png
// (mobile only, after scrolling 900px), plus <tag>-checks.json.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const pos = args.filter(a => !a.startsWith('--'));
const [url, outdirArg, tag = 'shot', widthsArg = '390,768,1440'] = pos;
if (!url || !outdirArg) { console.error('usage: node shoot.mjs <url> <outdir> <tag> [widths]'); process.exit(2); }
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });
const widths = widthsArg.split(',').map(Number);
const noFull = flags.includes('--no-full');
const waitAttrFlag = flags.find(a => a.startsWith('--wait-attr='));
const waitAttr = waitAttrFlag ? waitAttrFlag.split('=')[1] : null;
const HEIGHTS = { 390: 844, 768: 1024, 1440: 900, 1920: 1080 };
// the English page is shot as a British visitor sees it: the date fields follow the browser's locale
const locale = /\/en\//.test(url) ? 'en-GB' : 'lv-LV';

const CHECKS = () => {
  const de = document.documentElement;
  const vis = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return null;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), position: cs.position };
  };
  const tels = Array.from(document.querySelectorAll('a[href^="tel:"]')).map(vis).filter(Boolean)
    .filter(r => r.top >= 0 && r.bottom <= innerHeight);
  const cta = vis(document.querySelector('.js-cta-row'));
  const bar = vis(document.querySelector('.js-bar'));
  const wide = [];
  Array.from(document.querySelectorAll('body *')).forEach(el => {
    if (el.closest('.zoom') || el.closest('[hidden]')) return; /* zoom windows clip their image on purpose */
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 && r.width > 0) {
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      wide.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + ' right=' + Math.round(r.right));
    }
  });
  const fonts = [];
  document.fonts.forEach(f => { if (f.status === 'loaded') fonts.push(f.family.replace(/"/g, '') + ' ' + f.weight); });
  return {
    innerWidth, innerHeight,
    scrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth, docHeight: de.scrollHeight,
    noHorizontalScroll: de.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth,
    overflowing: wide.slice(0, 8),
    telAboveFold: tels.length, telRects: tels.slice(0, 3),
    ctaRow: cta, ctaAboveFold: !!(cta && cta.bottom <= innerHeight),
    barAtTop: bar,
    fontsLoaded: fonts, title: document.title, lang: de.lang,
  };
};

const BAR_AFTER_SCROLL = () => {
  const el = document.querySelector('.js-bar');
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const visible = r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0 && r.top < innerHeight && r.bottom <= innerHeight + 1;
  return { present: true, visible, position: cs.position, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), scrollY: Math.round(scrollY) };
};

// Unhinted text: on Linux, headless Chromium otherwise rounds every glyph width to a whole pixel, so lines wrap
// differently from Windows and the page heights drift (a test line of 18px Source Sans 3: 653px hinted, 647.3px
// unhinted, 647.5px on Windows). The flag changes nothing on Windows. Every tool launches with it.
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const results = { url, tag, capturedAt: new Date().toISOString(), widths: {} };
for (const w of widths) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: HEIGHTS[w] || 900 },
    deviceScaleFactor: w < 1440 ? 2 : 1,
    isMobile: w < 768, hasTouch: w < 768, locale,
  });
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [], bad = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  /* the reason travels with the url: the browser cancels (net::ERR_ABORTED) a small srcset file when the layout
     switches it to a larger one mid-load, which is not a defect; gate.mjs ignores only that reason */
  page.on('requestfailed', r => failed.push(r.url() + ' ' + ((r.failure() && r.failure().errorText) || 'unknown')));
  /* weight per breakpoint: content-length is always set by the static server, so no async sizes() race */
  const weight = { totalBytes: 0, items: [] };
  page.on('response', r => {
    if (r.status() >= 400) { bad.push(r.status() + ' ' + r.url()); return; }
    const len = parseInt(r.headers()['content-length'] || '0', 10) || 0;
    if (len) { weight.totalBytes += len; weight.items.push({ url: r.url().replace(url, ''), bytes: len }); }
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(async () => { await document.fonts.ready; return document.fonts.size; });
  if (waitAttr) { await page.waitForSelector('body[' + waitAttr + ']', { timeout: 15000 }).catch(() => {}); }
  await page.waitForTimeout(600);
  const top = await page.evaluate(CHECKS);
  await page.screenshot({ path: path.join(outdir, tag + '-' + w + '.png') });
  let bar = null, full = null;
  if (!noFull) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    // The scroll pass exists to trigger loading="lazy" images. It used to step 600px every
    // 120ms and cap at 14000px, which was fine for a 20-tile gallery and stopped being fine
    // when the sweep took it to 25: the files finished downloading but were not decoded and
    // painted by the time fullPage ran, so whole gallery groups came out as blank cream in
    // every composite from 2026-09-09 on. Step smaller, wait longer, no cap, and then wait
    // for every image to actually decode before the capture.
    for (let y = 0; y < h; y += 400) { await page.evaluate(yy => window.scrollTo(0, yy), y); await page.waitForTimeout(300); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => Promise.all(
      [...document.images].map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()))
    ));
    await page.waitForTimeout(1200);
    // The lightbox's <img> has no src until a tile is opened, so an empty src is not a finding.
    const unpainted = await page.evaluate(() =>
      [...document.images].filter(i => i.getAttribute('src') && !i.naturalWidth)
        .map(i => i.getAttribute('src')));
    if (unpainted.length) console.log('  WARNING unpainted images at ' + w + ':', unpainted.join(', '));
    results.widths_unpainted = results.widths_unpainted || {};
    results.widths_unpainted[w] = unpainted;
    full = tag + '-' + w + '-full.jpg';
    await page.screenshot({ path: path.join(outdir, full), fullPage: true, type: 'jpeg', quality: 82 });
  }
  if (w < 768) {
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(600);
    bar = await page.evaluate(BAR_AFTER_SCROLL);
    await page.screenshot({ path: path.join(outdir, tag + '-' + w + '-scrolled.png') });
  }
  weight.items.sort((a, b) => b.bytes - a.bytes);
  weight.largest = weight.items.slice(0, 8);
  results.widths[w] = { top, barAfterScroll: bar, fullPage: full, weight, consoleErrors, requestsFailed: failed, responses4xx5xx: bad };
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outdir, tag + '-checks.json'), JSON.stringify(results, null, 2));
for (const w of widths) {
  const r = results.widths[w];
  console.log([
    w + 'px:',
    'noHScroll=' + r.top.noHorizontalScroll,
    'docH=' + r.top.docHeight,
    'telAboveFold=' + r.top.telAboveFold,
    'ctaAboveFold=' + r.top.ctaAboveFold + (r.top.ctaRow ? '(bottom ' + r.top.ctaRow.bottom + ')' : ''),
    'barAtTop=' + (r.top.barAtTop ? 'VISIBLE' : 'hidden'),
    w < 768 ? 'barAfterScroll=' + (r.barAfterScroll && r.barAfterScroll.visible ? 'visible' : 'NOT visible') : '',
    'fonts=' + r.top.fontsLoaded.length,
    'weight=' + Math.round(r.weight.totalBytes / 1024) + 'KB',
    'biggest=' + (r.weight.largest[0] ? r.weight.largest[0].url + ' ' + Math.round(r.weight.largest[0].bytes / 1024) + 'KB' : 'none'),
    'errors=' + r.consoleErrors.length,
    'bad=' + r.responses4xx5xx.length,
    r.top.overflowing.length ? 'OVERFLOW: ' + r.top.overflowing.join(' | ') : '',
  ].filter(Boolean).join('  '));
}

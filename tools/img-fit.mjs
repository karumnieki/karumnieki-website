// img-fit.mjs: for every photo on both pages, on a set of devices, how many file pixels each screen pixel gets, and
// what the photos weigh. Written 2026-10-02 for the smaller phone files: the promise
// was "lighter, no visible change", and this is the check that holds it.
// Usage: node img-fit.mjs <lvUrl> <out.json> [--compare=<before.json>] [--profiles=412x915x2.625,820x1180x2,...]
// For each <img> on the page after a full scroll: the width the picture is actually drawn at (object-fit: cover draws a
// wide picture wider than its box, so the box alone understates it; a zoom tile's img is already the enlarged box),
// times the device pixel ratio, against the width of the file the browser chose (currentSrc). ratio 1.0 = one file
// pixel per screen pixel. With --compare, an image FAILS when its ratio fell below min(its old ratio, 1.0) by more than
// 2 percent: a smaller file may be chosen only where the old one was more than the screen could show. Exit 1 on FAIL.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const cmpArg = args.find(a => a.startsWith('--compare='));
if (!pos[1]) { console.error('usage: node img-fit.mjs <lvUrl> <out.json> [--compare=<before.json>]'); process.exit(2); }
const LV = pos[0].endsWith('/') ? pos[0] : pos[0] + '/';
const profArg = args.find(a => a.startsWith('--profiles='));
const PROFILES = profArg ? profArg.slice(11).split(',').map(s => { const [w, h, dpr] = s.split('x').map(Number); return { name: s, w, h, dpr }; }) : [
  { name: 'phone390x3', w: 390, h: 844, dpr: 3 },
  { name: 'phone390x2', w: 390, h: 844, dpr: 2 },
  { name: 'phone360x3', w: 360, h: 780, dpr: 3 },
  { name: 'tablet768x2', w: 768, h: 1024, dpr: 2 },
  { name: 'laptop1024x1', w: 1024, h: 768, dpr: 1 },
  { name: 'laptop1280x2', w: 1280, h: 800, dpr: 2 },
  { name: 'desktop1440x1', w: 1440, h: 900, dpr: 1 },
  { name: 'desktop1920x1', w: 1920, h: 1080, dpr: 1 },
];

const browser = await chromium.launch({ headless: true });
const out = {};
for (const [lang, url] of [['lv', LV], ['en', LV + 'en/']]) {
  for (const p of PROFILES) {
    const ctx = await browser.newContext({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: p.dpr, isMobile: p.w < 768, hasTouch: p.w < 768 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await page.evaluate(yy => window.scrollTo(0, yy), y); await page.waitForTimeout(150); }
    await page.evaluate(() => Promise.all([...document.images].filter(i => i.getAttribute('src')).map(i => i.decode().catch(() => {}))));
    await page.waitForTimeout(500);
    const rows = await page.evaluate(async (dpr) => {
      const bytes = {};
      for (const e of performance.getEntriesByType('resource')) bytes[e.name] = e.encodedBodySize || e.transferSize || 0;
      // naturalWidth of a srcset image is the file width divided by the density the browser picked, not the file's
      // pixels, so each chosen file is read once more on its own for its real size (it comes from the cache)
      const real = {};
      const imgs = [...document.querySelectorAll('main img, .hero img')];
      for (const img of imgs) {
        const src = img.currentSrc;
        if (!src || real[src]) continue;
        const im = new Image(); im.src = src;
        await im.decode().catch(() => {});
        real[src] = [im.naturalWidth, im.naturalHeight];
      }
      return imgs.map((img, i) => {
        const b = img.getBoundingClientRect();
        const src = img.currentSrc;
        if (!b.width || !b.height || !src || !real[src][0]) return null;
        const [fw, fh] = real[src];
        const fit = getComputedStyle(img).objectFit;
        const drawnW = fit === 'cover' ? Math.max(b.width, b.height * fw / fh) : b.width;
        return { key: i + ':' + (img.getAttribute('src') || '').split('/').pop(), file: src.split('/').pop(), fileW: fw,
          needW: Math.round(drawnW * dpr), ratio: Math.round(fw / (drawnW * dpr) * 100) / 100, kb: Math.round((bytes[src] || 0) / 1024) };
      }).filter(Boolean);
    }, p.dpr);
    // a file counted once per page load, however many img tags show it
    const seen = new Set();
    const kb = rows.reduce((s, r) => (seen.has(r.file) ? s : (seen.add(r.file), s + r.kb)), 0);
    out[lang + ' ' + p.name] = { kb, under1: rows.filter(r => r.ratio < 1).length, rows };
    console.log(`${lang} ${p.name.padEnd(13)} photos ${String(kb).padStart(5)}KB, ${rows.length} images, ${rows.filter(r => r.ratio < 1).length} under one file pixel per screen pixel`);
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(pos[1], JSON.stringify(out, null, 1));

if (cmpArg) {
  const before = JSON.parse(fs.readFileSync(cmpArg.slice(10), 'utf8'));
  const fails = [];
  for (const k of Object.keys(out)) {
    if (!before[k]) continue;
    const old = Object.fromEntries(before[k].rows.map(r => [r.key, r]));
    for (const r of out[k].rows) {
      const o = old[r.key];
      if (!o) { fails.push(`${k} ${r.key}: not in the before run`); continue; }
      if (r.ratio < Math.min(o.ratio, 1) - 0.02) fails.push(`${k} ${r.key}: ${o.file} ${o.ratio} -> ${r.file} ${r.ratio}`);
    }
    console.log(`${k.padEnd(17)} ${String(before[k].kb).padStart(5)}KB -> ${String(out[k].kb).padStart(5)}KB`);
  }
  console.log(fails.length ? 'FAIL: sharper before than after:\n  ' + fails.join('\n  ') : 'PASS: no photo lost sharpness it had; weight as listed');
  process.exit(fails.length ? 1 : 0);
}

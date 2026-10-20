// focus-pass.mjs: tab through every control and record what got focus and whether its ring is visible.
// Usage: node focus-pass.mjs <url> <outdir> [width=1440] [maxTabs=80]
// Since 2026-10-01 a ring must also stand out from what it is drawn on: an ink ring on the ink sticky
// bar counted as "has a ring" and was invisible. The ground is the element's own background for a ring drawn inside
// it (negative offset) and the background behind the element otherwise; under 3:1 (WCAG 1.4.11) is LOW CONTRAST.
// A link whose ::after widens its thumb target (the review attributions, the rating line) is sized by that target.
// Exit code 1 when any control has no ring or a low-contrast one.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [url, outdirArg, widthArg = '1440', maxArg = '80'] = process.argv.slice(2);
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });
const width = Number(widthArg);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width, height: width < 768 ? 844 : 900 },
  deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, locale: /\/en\//.test(url) ? 'en-GB' : 'lv-LV',
});
await answered(ctx);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => { await document.fonts.ready; });
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });

const DESCRIBE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'BODY' };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const ow = parseFloat(cs.outlineWidth) || 0;
  // the ground the ring is drawn on: inside the control for a negative offset, behind it otherwise
  const groundOf = (start) => {
    let p = start;
    while (p && p !== document.documentElement) {
      const c = getComputedStyle(p).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      p = p.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const bg = groundOf((parseFloat(cs.outlineOffset) || 0) < 0 ? el : el.parentElement);
  const lum = (c) => {
    const m = (c.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  };
  const contrast = ow > 0 ? (() => { const a = lum(cs.outlineColor), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); })() : 0;
  // a pseudo-element hit area (position absolute ::after) counts toward the target size
  const af = getComputedStyle(el, '::after');
  const hit = af.content !== 'none' && af.position === 'absolute'
    ? { w: Math.max(r.width, parseFloat(af.width) || 0), h: Math.max(r.height, parseFloat(af.height) || 0) } : { w: r.width, h: r.height };
  return {
    tag: el.tagName,
    label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 42),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
    ring: ow > 0 ? ow + 'px ' + cs.outlineColor : 'NONE',
    on: bg,
    ringContrast: Math.round(contrast * 10) / 10,
    size: Math.round(r.width) + 'x' + Math.round(r.height) + (hit.h !== r.height || hit.w !== r.width ? ' (target ' + Math.round(hit.w) + 'x' + Math.round(hit.h) + ')' : ''),
    tooSmall: (r.width > 0 && r.height > 0 && (hit.w < 24 || hit.h < 24)),
    offscreen: r.width === 0 && r.height === 0,
  };
};

// tab until focus leaves the document (activeElement falls back to BODY) or maxTabs is reached.
// Repeats are expected: the phone number and WhatsApp appear in the header, the bar and the footer.
const seq = [];
for (let i = 0; i < Number(maxArg); i++) {
  await page.keyboard.press('Tab');
  const d = await page.evaluate(DESCRIBE);
  seq.push(d);
  if (d.tag === 'BODY' && i > 5) break;
}

const noRing = seq.filter(d => d.ring === 'NONE' && d.tag !== 'BODY');
const lowRing = seq.filter(d => d.ring && d.ring !== 'NONE' && d.ringContrast < 3);
const small = seq.filter(d => d.tooSmall);
const hidden = seq.filter(d => d.offscreen);

// drawer: opens, closes on Escape, closes on a link click. Below 1280: the row of menu
// links only fits from there, so tablets and small laptops use the menu button too.
let drawer = null;
if (width < 1280) {
  drawer = await page.evaluate(() => document.querySelector('.nav-toggle') ? 'present' : 'missing');
  await page.click('.nav-toggle');
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => document.body.classList.contains('nav-open'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closedByEsc = await page.evaluate(() => !document.body.classList.contains('nav-open'));
  await page.click('.nav-toggle');
  await page.waitForTimeout(300);
  await page.click('#site-nav a[href="#pirts"]');
  await page.waitForTimeout(300);
  const closedByLink = await page.evaluate(() => !document.body.classList.contains('nav-open'));
  drawer = { opened, closedByEsc, closedByLink };
}

const out = { width, tabStops: seq.length, controlsWithoutRing: noRing, lowContrastRing: lowRing, under24px: small, zeroSize: hidden, drawer, sequence: seq };
fs.writeFileSync(path.join(outdir, 'focus-' + width + '.json'), JSON.stringify(out, null, 2));
console.log('width ' + width + ': ' + seq.length + ' tab stops, ' + noRing.length + ' without a focus ring, ' + lowRing.length + ' with a low-contrast ring, ' + small.length + ' under 24px, ' + hidden.length + ' zero-size');
if (drawer) console.log('drawer: ' + JSON.stringify(drawer));
noRing.forEach(d => console.log('  NO RING: ' + d.tag + ' ' + d.cls + ' "' + d.label + '"'));
lowRing.forEach(d => console.log('  LOW CONTRAST RING: ' + d.tag + ' ' + d.cls + ' "' + d.label + '" ' + d.ring + ' on ' + d.on + ' = ' + d.ringContrast + ':1'));
small.forEach(d => console.log('  SMALL: ' + d.tag + ' ' + d.cls + ' ' + d.size + ' "' + d.label + '"'));
hidden.forEach(d => console.log('  ZERO SIZE: ' + d.tag + ' ' + d.cls + ' "' + d.label + '"'));
await browser.close();
const drawerOk = !drawer || (drawer.opened && drawer.closedByEsc && drawer.closedByLink);
console.log(noRing.length || lowRing.length || !drawerOk ? 'FAIL' : 'PASS');
process.exit(noRing.length || lowRing.length || !drawerOk ? 1 : 0);

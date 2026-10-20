// lb-test.mjs: drive the gallery lightbox and assert its behaviour. Phase 3 gate.
// Usage: node lb-test.mjs <url> <outdir> [width=1440] [expectTiles]
// Exit code 0 only when every assertion holds (since 2026-09-15; before that it always exited 0 and a gate
// that piped it through grep could read green over a failure). The last line says PASS or FAIL and why.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [url, outdirArg, widthArg = '1440', expectArg = ''] = process.argv.slice(2);
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });
const width = Number(widthArg);
const expectTiles = expectArg ? Number(expectArg) : null;
const failures = [];
const fail = (why) => { failures.push(why); };

// the manifest's binding minimum crops, read from slots.json: photo id -> { top, right, bottom }. Keyed by id,
// not filename, because the tile opens a -lightbox- file of the same photograph since 2026-09-15. A floor baked
// into the file itself (K38) needs nothing on the tile and is skipped.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const slots = JSON.parse(fs.readFileSync(path.join(HERE, 'slots.json'), 'utf8'));
const binding = {};
for (const p of slots.photos) {
  if (p.min_crop && !p.min_crop.baked) binding[p.id] = p.min_crop;
}
const idOf = (href) => path.basename(href).replace(/-(hero|parmums|section|companion|gallery|lightbox)-\d+\.webp$/, '');

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const ctx = await browser.newContext({
  viewport: { width, height: width < 768 ? 844 : 900 },
  deviceScaleFactor: width < 1440 ? 2 : 1,
  isMobile: width < 768, hasTouch: width < 768, locale: /\/en\//.test(url) ? 'en-GB' : 'lv-LV',
});
await answered(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => { await document.fonts.ready; });
// smooth scrolling races the screenshots; the site keeps it, the test does not
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });

const out = { width, steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name + ': ' + JSON.stringify(data)); };

const readLb = () => page.evaluate(() => {
  const lb = document.querySelector('.lb');
  const frame = document.querySelector('.lb-frame');
  const img = document.querySelector('.lb-frame img');
  const fr = frame ? frame.getBoundingClientRect() : null;
  const ir = img ? img.getBoundingClientRect() : null;
  const r1 = (n) => Math.round(n * 10) / 10;
  // the frame is the visible window and the image is drawn larger under it, so what a guest cannot see is
  // the part of the image rectangle outside the frame rectangle, side by side, in percent of the image
  const clip = (fr && ir && ir.width > 0 && ir.height > 0) ? {
    top: r1((fr.top - ir.top) / ir.height * 100), right: r1((ir.right - fr.right) / ir.width * 100),
    bottom: r1((ir.bottom - fr.bottom) / ir.height * 100), left: r1((fr.left - ir.left) / ir.width * 100),
  } : null;
  return {
    open: !!(lb && lb.open),
    src: img ? (img.getAttribute('src') || '') : null,
    caption: (document.querySelector('.lb-caption') || {}).textContent || null,
    count: (document.querySelector('.lb-count') || {}).textContent || null,
    frame: fr ? Math.round(fr.width) + 'x' + Math.round(fr.height) : null,
    clip,
    // the drawn image keeps the file's own proportions, so nothing is stretched
    aspectErrPct: (img && ir && img.naturalWidth) ? r1(Math.abs((ir.width / ir.height) / (img.naturalWidth / img.naturalHeight) - 1) * 100) : null,
    frameFitsViewport: !!(fr && fr.height <= innerHeight + 1 && fr.width <= innerWidth + 1 && fr.top >= -1),
    bodyLocked: document.body.classList.contains('lb-open'),
    focusIn: !!(document.activeElement && document.activeElement.closest('.lb')),
    scrollY: Math.round(scrollY),
  };
});

/* after opening a tile, wait for its file to load (up to 8s) before reading it. Fixed delays raced the larger
   -lightbox- files in the 2026-09-15 gate: the crop geometry was right but the image was not decoded yet. */
const waitLoaded = () => page.waitForFunction(() => {
  const im = document.querySelector('.lb-frame img');
  return im && im.complete && im.naturalWidth > 0;
}, null, { timeout: 8000 }).catch(() => {});

const total = await page.evaluate(() => document.querySelectorAll('.tile').length);
// zale_10 carries the manifest floor data-crop-bottom="22"; the first tile with a bottom crop drives the walk
const cropIdx = await page.evaluate(() =>
  Array.prototype.findIndex.call(document.querySelectorAll('.tile'), t => t.hasAttribute('data-crop-bottom')));
step('tiles', { total, expectTiles, cropIdx });
if (expectTiles !== null && total !== expectTiles) fail(`tile count ${total}, expected ${expectTiles}`);

// every tile carrying a crop opens clipped by exactly that share on that side and by nothing elsewhere
const floors = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.tile'), (t, i) => ({
  i, href: t.getAttribute('href'),
  top: parseFloat(t.getAttribute('data-crop-top')) || 0,
  right: parseFloat(t.getAttribute('data-crop-right')) || 0,
  bottom: parseFloat(t.getAttribute('data-crop-bottom')) || 0,
})));
// a binding floor from the manifest must be on its tile, at least as deep as the manifest says
let bindingChecked = 0;
for (const f of floors) {
  const need = binding[idOf(f.href)];
  if (!need) continue;
  bindingChecked++;
  const short = ['top', 'right', 'bottom'].filter(k => (need[k] || 0) > f[k]);
  step('binding ' + idOf(f.href), { href: f.href, need, tile: { top: f.top, right: f.right, bottom: f.bottom }, ok: !short.length });
  if (short.length) fail(`binding floor ${idOf(f.href)} short on ${short.join(', ')}`);
}
let floorFails = 0, rightFloors = 0;
for (const f of floors.filter(x => x.top || x.right || x.bottom)) {
  await page.evaluate(i => document.querySelectorAll('.tile')[i].click(), f.i);
  await page.waitForTimeout(300);
  await waitLoaded();
  const r = await readLb();
  const want = { top: f.top, right: f.right, bottom: f.bottom, left: 0 };
  const ok = !!r.clip && ['top', 'right', 'bottom', 'left'].every(k => Math.abs(r.clip[k] - want[k]) <= 0.5)
    && r.aspectErrPct !== null && r.aspectErrPct <= 0.5 && r.frameFitsViewport;
  if (f.right) rightFloors++;
  if (!ok) { floorFails++; fail(`floor ${f.href} clipped ${JSON.stringify(r.clip)}, wanted ${JSON.stringify(want)}`); }
  step('floor ' + path.basename(f.href), { want, clip: r.clip, aspectErrPct: r.aspectErrPct, frame: r.frame, ok });
  if (f.right) await page.screenshot({ path: path.join(outdir, 'lb-rightcrop-' + width + '.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
step('floors', { checked: floors.filter(x => x.top || x.right || x.bottom).length, failed: floorFails, rightFloors, bindingChecked });
if (!rightFloors) fail('no tile carries a right-crop floor (K09 should: right 6, bottom 4)');

// resolution in the open lightbox: file pixels per screen pixel, for the file the tile used to
// open (its own src, whose size the img width attribute carries) and for the file it opens now (its href).
// Under 1.0 the photo is stretched on this screen; the phone context here is 2x, a 3x phone is two thirds of it.
const res = [];
for (let i = 0; i < floors.length; i++) {
  await page.evaluate(k => document.querySelectorAll('.tile')[k].click(), i);
  await waitLoaded();
  const r = await page.evaluate(() => {
    const img = document.querySelector('.lb-frame img');
    const tileImg = document.querySelectorAll('.tile')[Number(document.querySelector('.lb-count').textContent.split(' / ')[0]) - 1].querySelector('img');
    const drawn = img.getBoundingClientRect().width * devicePixelRatio;
    return {
      id: img.getAttribute('src').split('/').pop(), /* by file name: the English page's paths start ../img/ */
      before: Math.round(parseFloat(tileImg.getAttribute('width')) / drawn * 100) / 100,
      after: img.naturalWidth ? Math.round(img.naturalWidth / drawn * 100) / 100 : null,
    };
  });
  res.push(r);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
res.sort((a, b) => a.after - b.after);
step('resolution', { dpr: width < 1440 ? 2 : 1, K35: res.find(r => r.id.startsWith('K35')), dikisMezs: res.find(r => r.id.startsWith('dikis')), lowestAfter: res.slice(0, 6), gained: res.filter(r => r.after > r.before + 0.01).length, unloaded: res.filter(r => !r.after).length });
if (res.some(r => !r.after)) fail('a lightbox file did not load');

// an uncropped tile opens whole
const plainIdx = floors.findIndex(x => !x.top && !x.right && !x.bottom);
await page.evaluate(i => document.querySelectorAll('.tile')[i].click(), plainIdx);
await waitLoaded();
const plain = await readLb();
step('plain-tile-uncropped', { href: floors[plainIdx].href, clip: plain.clip, aspectErrPct: plain.aspectErrPct });
if (!plain.clip || Object.values(plain.clip).some(v => Math.abs(v) > 0.5)) fail('an uncropped tile opened clipped');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

const scrollBefore = await page.evaluate(() => { const t = document.querySelectorAll('.tile')[0]; t.scrollIntoView(); return Math.round(scrollY); });

await page.evaluate(i => document.querySelectorAll('.tile')[i].click(), cropIdx);
await waitLoaded();
const opened = await readLb();
step('open-on-cropped-tile', opened);
if (!opened.open || !opened.bodyLocked || !opened.focusIn) fail('lightbox did not open, lock the page and take focus');
await page.screenshot({ path: path.join(outdir, 'lb-cropped-' + width + '.png') });

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const next = await readLb();
step('after-arrow-right', next);
if (next.count !== `${cropIdx + 2} / ${total}`) fail(`ArrowRight gave ${next.count}`);
await page.screenshot({ path: path.join(outdir, 'lb-next-' + width + '.png') });

await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(400);
step('back-two', await readLb());

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const afterEsc = await readLb();
const focusBack = await page.evaluate(i =>
  document.activeElement === document.querySelectorAll('.tile')[i], cropIdx);
step('after-escape', { ...afterEsc, focusReturnedToTile: focusBack, scrollBefore, scrollUnchanged: afterEsc.scrollY === scrollBefore });
if (afterEsc.open || afterEsc.bodyLocked) fail('Escape did not close and unlock');
if (!focusBack) fail('focus did not return to the tile');
if (afterEsc.scrollY !== scrollBefore) fail(`scroll moved ${scrollBefore} to ${afterEsc.scrollY}`);

// close button. Scoped to the lightbox since 2026-09-11: the thank-you dialog reuses .lb-btn.lb-close for its
// own X, and an unscoped '.lb-close' matched two elements, which Playwright refuses in strict mode.
await page.evaluate(() => document.querySelectorAll('.tile')[0].click());
await page.waitForTimeout(500);
await page.click('.lb .lb-close');
await page.waitForTimeout(400);
const afterX = await readLb();
step('after-close-button', afterX);
if (afterX.open) fail('the X did not close');

// backdrop click
await page.evaluate(() => document.querySelectorAll('.tile')[0].click());
await page.waitForTimeout(500);
await page.click('.lb .lb-stage', { position: { x: 8, y: 8 } });
await page.waitForTimeout(400);
const afterBackdrop = await readLb();
step('after-backdrop-click', afterBackdrop);
if (afterBackdrop.open) fail('a backdrop click did not close');

// last tile, then next should wrap to 1
await page.evaluate(() => { const t = document.querySelectorAll('.tile'); t[t.length - 1].click(); });
await page.waitForTimeout(500);
await page.click('.lb .lb-next');
await page.waitForTimeout(400);
const wrapped = await readLb();
step('wrap-forwards', wrapped);
if (wrapped.count !== `1 / ${total}`) fail(`next from the last tile gave ${wrapped.count}`);
await page.screenshot({ path: path.join(outdir, 'lb-plain-' + width + '.png') });
await page.keyboard.press('Escape');

// real swipe, not just "the handler exists": synthetic Touch objects through the same path a finger takes
if (width < 768) {
  await page.evaluate(() => document.querySelectorAll('.tile')[4].click());
  await page.waitForTimeout(500);
  const before = await readLb();
  const swipe = (dx) => page.evaluate((d) => {
    const lb = document.querySelector('.lb');
    const mk = (type, x) => {
      const t = new Touch({ identifier: 1, target: lb, clientX: x, clientY: 400 });
      return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] });
    };
    lb.dispatchEvent(mk('touchstart', 200));
    lb.dispatchEvent(mk('touchend', 200 + d));
  }, dx);
  await swipe(-120);
  await page.waitForTimeout(400);
  const afterLeft = await readLb();
  await swipe(120);
  await page.waitForTimeout(400);
  const afterRight = await readLb();
  const sw = {
    start: before.count, swipeLeftGave: afterLeft.count, swipeRightGave: afterRight.count,
    advances: afterLeft.count !== before.count, returns: afterRight.count === before.count,
  };
  step('swipe', sw);
  if (!sw.advances || !sw.returns) fail('swipe did not advance and return');
  await page.keyboard.press('Escape');
}

out.consoleErrors = errors;
if (errors.length) fail(`${errors.length} console errors`);
out.failures = failures;
fs.writeFileSync(path.join(outdir, 'lb-checks-' + width + '.json'), JSON.stringify(out, null, 2));
console.log('consoleErrors: ' + errors.length);
console.log(failures.length ? `FAIL (${failures.length}): ${failures.join(' | ')}` : `PASS: ${total} tiles, ${floors.filter(x => x.top || x.right || x.bottom).length} crop floors incl. ${rightFloors} right, ${bindingChecked} binding floors on their tiles`);
await browser.close();
process.exitCode = failures.length ? 1 : 0;

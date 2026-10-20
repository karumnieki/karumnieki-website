// lang-test.mjs: the LV | EN switch and the header on both pages.
// Usage: node lang-test.mjs <lvUrl> <outdir>      e.g. node lang-test.mjs http://localhost:8477/site/ out/lang
// The English page is <lvUrl>en/. Checks, on both pages:
//   head     html lang, the self canonical and the hreflang trio as served;
//   header   at 320 to 1440: the logo keeps its proportions, nothing in the header overlaps or leaves the screen, the
//            menu links stay on one line where they show, no sideways scroll, and the switch shows as specified
//            (none below 360, the other language alone from 360 to 899, the LV | EN pair from 900);
//   switch   at 360, 390, 1024 and 1440: from the top the switch opens the other page at its top; from inside each
//            section it opens the other page at that section (the landing is compared with where the browser itself
//            puts the section), and back again; below 1280 once more through the menu; the page you are on does
//            nothing; every switch link works without js (its plain href answers 200).
// Since 2026-10-01: at the header widths, no button label anywhere on the page runs past its own
// border (SKATĪT GOOGLE MAPS did at 900); and a hash that is not valid percent-encoding (#%E0%A4%A) leaves the
// script running, so the thank-you still opens (it used to throw and let Nosūtīt post the form to the host).
// Exit code 0 only when every assertion holds; the last line says PASS or FAIL and why.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [lvArg, outdirArg] = process.argv.slice(2);
if (!lvArg || !outdirArg) { console.error('usage: node lang-test.mjs <lvUrl> <outdir>'); process.exit(2); }
const LV = lvArg.endsWith('/') ? lvArg : lvArg + '/';
const EN = LV + 'en/';
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });

const SECTIONS = ['par-mums', 'svinibas', 'naksnosana', 'pirts', 'teritorija', 'galerija', 'atsauksmes', 'ka-noklut', 'pieprasijums', 'kontakti'];
const HEADER_WIDTHS = [320, 360, 375, 390, 412, 480, 768, 900, 1024, 1280, 1440];
const SWITCH_WIDTHS = [360, 390, 1024, 1440];
const CANONICAL = { lv: 'https://karumnieki.lv/', en: 'https://karumnieki.lv/en/' };
const HREFLANG = { lv: 'https://karumnieki.lv/', en: 'https://karumnieki.lv/en/', 'x-default': 'https://karumnieki.lv/' };

const failures = [];
const fail = (why) => { failures.push(why); console.log('  FAIL ' + why); };
const report = { head: {}, header: {}, switch: {} };
const pages = [['lv', LV], ['en', EN]];
const other = { lv: 'en', en: 'lv' };
const base = { lv: LV, en: EN };

const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
const newPage = async (w, lang) => {
  const ctx = await browser.newContext({
    viewport: { width: w, height: w < 768 ? 844 : 900 }, deviceScaleFactor: 1,
    isMobile: w < 768, hasTouch: w < 768, locale: lang === 'en' ? 'en-GB' : 'lv-LV',
  });
  await answered(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // name the address behind a "Failed to load resource" line, so a Google Maps hiccup is told apart from the site
  page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
  return { ctx, page, errors };
};
const settle = async (page) => {
  await page.waitForLoadState('load');
  await page.evaluate(async () => { await document.fonts.ready; });
  // wait until the scroll position stops moving (a fragment landing may animate)
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => Math.round(scrollY));
    if (y === last) break;
    last = y;
    await page.waitForTimeout(150);
  }
};

// 1. head, as served
for (const [lang, url] of pages) {
  const { ctx, page } = await newPage(1440, lang);
  await page.goto(url, { waitUntil: 'load' });
  const h = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
    hreflang: Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')].map(l => [l.hreflang, l.href])),
    title: document.title,
  }));
  report.head[lang] = h;
  if (h.lang !== lang) fail(`${lang}: html lang is "${h.lang}"`);
  if (h.canonical !== CANONICAL[lang]) fail(`${lang}: canonical ${h.canonical}`);
  if (JSON.stringify(h.hreflang) !== JSON.stringify(HREFLANG)) fail(`${lang}: hreflang ${JSON.stringify(h.hreflang)}`);
  await ctx.close();
}
console.log('head: ' + JSON.stringify(report.head));

// 2. header fit
const HEADER = () => {
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
  };
  const mark = document.querySelector('.brand-mark');
  const mr = mark.getBoundingClientRect();
  const natural = mark.naturalWidth / mark.naturalHeight;
  const order = ['.brand', '.site-nav ul', '.header-inner > .lang-switch', '.nav-toggle', '.header-tel-square', '.header-tel-text', '.btn-header'];
  const boxes = order.map(s => [s, vis(document.querySelector(s))]).filter(x => x[1]);
  const overlaps = [];
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i][1].l < boxes[i - 1][1].r - 0.5) overlaps.push(boxes[i - 1][0] + ' / ' + boxes[i][0]);
  }
  const offscreen = boxes.filter(x => x[1].r > innerWidth + 0.5 || x[1].l < -0.5).map(x => x[0]);
  const navLinks = [...document.querySelectorAll('.site-nav li a')].map(vis).filter(Boolean).map(r => Math.round(r.b - r.t));
  const switchLinks = [...document.querySelectorAll('.header-inner > .lang-switch a')].filter(a => vis(a));
  return {
    markAspectErrPct: Math.round(Math.abs((mr.width / mr.height) / natural - 1) * 1000) / 10,
    overlaps, offscreen,
    tallestNavLink: navLinks.length ? Math.max(...navLinks) : null,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    switchVisible: switchLinks.map(a => a.getAttribute('hreflang') + (a.hasAttribute('aria-current') ? '*' : '')),
    headerBottom: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom),
    // the page's buttons, not only the header's: a label wider than its button (measured on the text itself)
    btnOverflow: [...document.querySelectorAll('.btn')].filter(b => b.offsetParent).filter(b => {
      const rg = document.createRange(); rg.selectNodeContents(b);
      const t = rg.getBoundingClientRect(), bb = b.getBoundingClientRect();
      return t.width > 0 && (t.left < bb.left - 0.5 || t.right > bb.right + 0.5);
    }).map(b => b.textContent.trim()),
  };
};
for (const [lang, url] of pages) {
  report.header[lang] = {};
  for (const w of HEADER_WIDTHS) {
    const { ctx, page } = await newPage(w, lang);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(async () => { await document.fonts.ready; });
    const r = await page.evaluate(HEADER);
    report.header[lang][w] = r;
    await page.screenshot({ path: path.join(outdir, `header-${lang}-${w}.png`), clip: { x: 0, y: 0, width: w, height: r.headerBottom + 1 } });
    const where = `${lang} ${w}px header`;
    if (r.markAspectErrPct > 2) fail(`${where}: logo off its proportions by ${r.markAspectErrPct}%`);
    if (r.overlaps.length) fail(`${where}: overlapping ${r.overlaps.join(', ')}`);
    if (r.offscreen.length) fail(`${where}: off screen ${r.offscreen.join(', ')}`);
    if (r.tallestNavLink !== null && w >= 1280 && r.tallestNavLink > 40) fail(`${where}: a menu link wraps (${r.tallestNavLink}px tall)`);
    if (r.hScroll) fail(`${where}: sideways scroll`);
    if (r.btnOverflow.length) fail(`${lang} ${w}px page: button label past its border: ${r.btnOverflow.join(', ')}`);
    const want = w < 360 ? [] : w < 900 ? [other[lang]] : ['lv' + (lang === 'lv' ? '*' : ''), 'en' + (lang === 'en' ? '*' : '')];
    if (JSON.stringify(r.switchVisible) !== JSON.stringify(want)) fail(`${where}: switch shows ${JSON.stringify(r.switchVisible)}, wants ${JSON.stringify(want)}`);
    await ctx.close();
  }
  console.log(`header ${lang}: ` + HEADER_WIDTHS.map(w => `${w}:${report.header[lang][w].switchVisible.join('|') || '-'}`).join(' '));
}

// 3. the switch itself
const landing = (id) => (async () => {
  const el = document.getElementById(ID);
  const landed = Math.round(scrollY);
  el.scrollIntoView({ block: 'start', behavior: 'instant' });
  const ref = Math.round(scrollY);
  window.scrollTo({ top: landed, behavior: 'instant' });
  return { hash: location.hash, landed, ref };
}).toString().replace('ID', JSON.stringify(id));

// Click where the element is on screen, the way a finger or a mouse does. Playwright's own click first scrolls its
// target "into view", and for a link in the sticky header that scrolled the page itself (767px up to 341px at 360,
// back into the hero), which moved the reading line and made the test, not the site, lose the section.
const tap = async (page, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error('not on screen: ' + sel);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const clickSwitch = async (page, lang, via, expectUrl) => {
  const sel = via === 'menu' ? '.nav-extra .lang-switch a:not([aria-current])' : '.header-inner > .lang-switch a:not([aria-current])';
  if (via === 'menu') { await tap(page, '.nav-toggle'); await page.waitForTimeout(250); }
  await Promise.all([page.waitForURL(u => u.href === expectUrl, { timeout: 15000 }), tap(page, sel)]);
  await settle(page);
};

for (const w of SWITCH_WIDTHS) {
  report.switch[w] = [];
  const { ctx, page, errors } = await newPage(w, 'lv');
  await page.goto(LV, { waitUntil: 'load' });
  await settle(page);
  let lang = 'lv';
  // from the top: the other page at its top
  await clickSwitch(page, lang, 'header', base[other[lang]]);
  lang = other[lang];
  const top = await page.evaluate(() => ({ url: location.href, y: Math.round(scrollY) }));
  report.switch[w].push({ from: 'top', ...top });
  if (top.url !== base[lang] || top.y !== 0) fail(`${w}px: from the top the switch gave ${top.url} at ${top.y}`);
  // every section, there and back
  for (const id of SECTIONS) {
    for (let leg = 0; leg < 2; leg++) {
      if (leg === 0) {
        await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
        await page.waitForTimeout(250);
      }
      const from = lang;
      await clickSwitch(page, from, 'header', base[other[from]] + '#' + id);
      lang = other[from];
      const r = await page.evaluate(`(${landing(id)})()`);
      const ok = r.hash === '#' + id && Math.abs(r.landed - r.ref) <= 60;
      report.switch[w].push({ id, from, to: lang, ...r, ok });
      if (!ok) fail(`${w}px: ${from} to ${lang} at #${id}: hash ${r.hash}, landed ${r.landed}, the section sits at ${r.ref}`);
    }
  }
  // through the menu, below 1280
  if (w < 1280) {
    await page.evaluate(() => document.getElementById('pirts').scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.waitForTimeout(250);
    const from = lang;
    await clickSwitch(page, from, 'menu', base[other[from]] + '#pirts');
    lang = other[from];
    const r = await page.evaluate(`(${landing('pirts')})()`);
    const ok = r.hash === '#pirts' && Math.abs(r.landed - r.ref) <= 60;
    report.switch[w].push({ via: 'menu', id: 'pirts', from, to: lang, ...r, ok });
    if (!ok) fail(`${w}px: the menu's switch ${from} to ${lang} at #pirts: hash ${r.hash}, landed ${r.landed}, section at ${r.ref}`);
  }
  // the page you are on does nothing (the pair shows from 900)
  if (w >= 900) {
    const before = await page.evaluate(() => ({ url: location.href, y: Math.round(scrollY) }));
    await tap(page, '.header-inner > .lang-switch a[aria-current]');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ url: location.href, y: Math.round(scrollY) }));
    if (after.url !== before.url || after.y !== before.y) fail(`${w}px: the current language link moved the page (${JSON.stringify(before)} to ${JSON.stringify(after)})`);
  }
  if (errors.length) fail(`${w}px: ${errors.length} console errors: ${errors.slice(0, 3).join(' | ')}`);
  const passed = report.switch[w].filter(s => s.ok).length;
  console.log(`switch ${w}px: ${passed} of ${report.switch[w].filter(s => 'ok' in s).length} section landings right, ${errors.length} console errors`);
  await ctx.close();
}

// 4. without js every switch link is a plain link that answers
for (const [lang, url] of pages) {
  const { ctx, page } = await newPage(1440, lang);
  await page.goto(url, { waitUntil: 'load' });
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.lang-switch a[hreflang]')].map(a => a.href));
  for (const h of hrefs) {
    const res = await page.request.get(h);
    if (res.status() !== 200) fail(`${lang}: switch link ${h} answers ${res.status()}`);
  }
  console.log(`plain links ${lang}: ${hrefs.length} checked`);
  await ctx.close();
}

// 5. a malformed hash: no script error, and the form still answers with the thank-you
for (const [lang, url] of pages) {
  const { ctx, page, errors } = await newPage(1440, lang);
  await page.goto(url + '#%E0%A4%A', { waitUntil: 'load' });
  await page.fill('#f-name', 'Testa Viesis'); await page.fill('#f-tel', '+371 20000000'); await page.fill('#f-email', 'viesis@example.com');
  await page.click('.btn-submit'); await page.waitForTimeout(300);
  const open = await page.evaluate(() => document.querySelector('.js-thanks').open).catch(() => false);
  const scriptErrors = errors.filter(e => !e.startsWith('HTTP ') && !e.startsWith('Failed to load resource'));
  if (scriptErrors.length || !open) fail(`${lang}: a malformed #hash ${scriptErrors.length ? 'throws ' + scriptErrors[0].slice(0, 80) : ''}${open ? '' : ' and the form does not open the thank-you'}`);
  else console.log(`malformed hash ${lang}: no error, the form still works`);
  await ctx.close();
}

await browser.close();
report.failures = failures;
fs.writeFileSync(path.join(outdir, 'lang-checks.json'), JSON.stringify(report, null, 2));
console.log(failures.length ? `FAIL (${failures.length}): ${failures.slice(0, 6).join(' | ')}` : `PASS: head, header at ${HEADER_WIDTHS.length} widths on both pages, the switch both ways at ${SWITCH_WIDTHS.join(', ')} with ${SECTIONS.length} sections each`);
process.exitCode = failures.length ? 1 : 0;

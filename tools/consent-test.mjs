// consent-test.mjs: the cookie banner, the click-to-load map and the policy pages, on one home page (LV or EN).
// Usage: node tools/consent-test.mjs <url of a home page>
// Everything Google would serve is answered here with a stub (gtm.js, the map), so the check runs offline.
//   first visit    the banner shows at 390x844, 768x1024 and 1440x900 with two buttons that look the same, a link to the cookie
//                  policy, the hero's call buttons and the header phone uncovered, and not one request to Google while
//                  the whole page is scrolled (the map is a button until it is pressed)
//   phone bar      once the sticky call bar shows on a phone, the banner and the bar do not overlap
//   no             hides the banner, stores the no, nothing loads, and the banner stays away after a reload
//   settings       Sīkdatņu iestatījumi brings the banner back with focus in it; a yes loads gtm.js once and focus
//                  returns to the settings button; a no after that denies analytics again and deletes _ga cookies
//   expired        a choice older than CONSENT_DAYS in site.js counts as none: the banner shows again
//   map            Rādīt karti puts the Google embed in place with its title, and only then is maps.google.com asked
//   policies       every policy link on the page opens a page in the same language with one h1, no console errors,
//                  no sideways scroll at 390 and 1440, a language switch to its twin, a working settings button
// Exit code 1 if any of that fails.
import { createRequire } from 'node:module';
import { CONSENT_KEY } from './visitor.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) { console.error('usage: node tools/consent-test.mjs <url>'); process.exit(2); }
const GOOGLE = /google\.com|googletagmanager\.com|google-analytics\.com|gstatic\.com|googleapis\.com|doubleclick\.net/;
const failures = [];
const notes = [];
const fail = m => failures.push(m);
const browser = await chromium.launch({ headless: true });

async function open(w, h, { choice, href = url } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1 });
  if (choice) await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); }, [CONSENT_KEY, choice]);
  const page = await ctx.newPage();
  const google = [];
  const errors = [];
  page.on('request', r => { if (GOOGLE.test(new URL(r.url()).hostname)) google.push(r.url()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await ctx.route(GOOGLE, route => {
    const u = route.request().url();
    if (/gtm\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__gtm = (window.__gtm || 0) + 1;' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map stub</title><p>map</p>' });
  });
  const res = await page.goto(href, { waitUntil: 'load' });
  return { ctx, page, google, errors, status: res ? res.status() : 0 };
}
const bannerShown = page => page.evaluate(() => { const b = document.querySelector('.js-consent'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0; });
const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), CONSENT_KEY);

// Is the element's middle (and its two lower corners, inset) the element itself, or something laid over it?
const uncovered = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].filter(el => el.getClientRects().length).map(el => {
  const r = el.getBoundingClientRect();
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
  const ok = pts.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && (hit === el || el.contains(hit)); });
  return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), ok, bottom: Math.round(r.bottom) };
}), sel);

// 1. first visit, phone and computer
for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
  const L = `first visit ${w}`;
  const { ctx, page, google, errors } = await open(w, h);
  if (!(await bannerShown(page))) fail(`${L}: the banner does not show`);
  const look = await page.evaluate(() => {
    const st = b => { const c = getComputedStyle(b), r = b.getBoundingClientRect(); return [c.backgroundColor, c.color, c.borderColor, c.borderWidth, c.fontSize, c.fontWeight, Math.round(r.height)].join(' '); };
    const yes = document.querySelector('.js-consent-yes'), no = document.querySelector('.js-consent-no');
    const a = document.querySelector('.js-consent a[href]');
    const box = document.querySelector('.js-consent').getBoundingClientRect();
    return { yes: st(yes), no: st(no), wYes: yes.getBoundingClientRect().width, wNo: no.getBoundingClientRect().width,
      link: a && a.getAttribute('href'), top: Math.round(box.top), height: Math.round(box.height),
      sideways: document.documentElement.scrollWidth > innerWidth };
  });
  if (look.yes !== look.no) fail(`${L}: the two buttons look different (yes ${look.yes} / no ${look.no})`);
  if (Math.abs(look.wYes - look.wNo) > 2) fail(`${L}: the two buttons differ in width (${look.wYes} / ${look.wNo})`);
  if (!look.link) fail(`${L}: no policy link in the banner`);
  if (look.sideways) fail(`${L}: sideways scroll with the banner`);
  for (const r of [...await uncovered(page, '.js-cta-row a, .js-cta-row button'), ...await uncovered(page, '.site-header a[href^="tel:"]')]) {
    if (!r.ok) fail(`${L}: "${r.text}" is covered (bottom ${r.bottom}, banner top ${look.top})`);
  }
  notes.push(`${w}: banner ${look.height}px from ${look.top}`);
  // the whole page, top to bottom, the way a visitor scrolls it: still nothing from Google
  await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
  await page.waitForTimeout(400);
  if (google.length) fail(`${L}: requests to Google before any choice: ${[...new Set(google)].slice(0, 3).join(', ')}`);
  if (await page.evaluate(() => !!document.querySelector('iframe'))) fail(`${L}: an iframe is on the page before the map was asked for`);
  if (w < 768) {
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.js-bar'), c = document.querySelector('.js-consent');
      if (!b || getComputedStyle(b).display === 'none') return null;
      const r = b.getBoundingClientRect(), q = c.getBoundingClientRect();
      return { overlap: r.top < q.bottom && q.top < r.bottom, bar: Math.round(r.top), banner: [Math.round(q.top), Math.round(q.bottom)] };
    });
    if (!bar) fail(`${L}: the sticky call bar did not show after scrolling`);
    else if (bar.overlap) fail(`${L}: the banner (${bar.banner.join(' to ')}) overlaps the call bar (from ${bar.bar})`);
  }
  if (errors.length) fail(`${L}: console ${errors.join(' | ')}`);
  await ctx.close();
}

// 2. no, then a reload
{
  const L = 'no';
  const { ctx, page, google } = await open(1440, 900);
  await page.click('.js-consent-no');
  if (await bannerShown(page)) fail(`${L}: the banner is still there`);
  const s = await stored(page);
  if (!s || s.analytics !== false || s.v !== 1) fail(`${L}: stored ${JSON.stringify(s)}`);
  await page.reload({ waitUntil: 'load' });
  if (await bannerShown(page)) fail(`${L}: the banner came back after a reload`);
  if (google.length) fail(`${L}: requests to Google: ${google.slice(0, 3).join(', ')}`);
  await ctx.close();
}

// 3. settings: yes, then no again
{
  const L = 'settings';
  const { ctx, page, google } = await open(1440, 900, { choice: { v: 1, analytics: false, at: new Date().toISOString() } });
  if (await bannerShown(page)) fail(`${L}: the banner shows although a choice is stored`);
  await page.locator('.js-consent-open').first().click();
  if (!(await bannerShown(page))) fail(`${L}: Sīkdatņu iestatījumi did not bring the banner back`);
  if (!(await page.evaluate(() => document.querySelector('.js-consent').contains(document.activeElement)))) fail(`${L}: focus is not in the banner`);
  await page.click('.js-consent-yes');
  await page.waitForTimeout(200);
  const gtm = google.filter(u => /gtm\.js/.test(u));
  if (gtm.length !== 1) fail(`${L}: after the yes gtm.js was requested ${gtm.length} times`);
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('js-consent-open')))) fail(`${L}: focus did not return to the settings button`);
  if ((await stored(page) || {}).analytics !== true) fail(`${L}: the yes was not stored`);
  // GA4 would have set these by now; a no must take them away again
  await page.evaluate(() => { document.cookie = '_ga=GA1.1.1.1; path=/'; document.cookie = '_ga_TEST123=GS1.1.1; path=/'; document.cookie = 'keepme=1; path=/'; });
  await page.locator('.js-consent-open').first().click();
  await page.click('.js-consent-no');
  const after = await page.evaluate(() => ({ cookies: document.cookie, updates: window.dataLayer.filter(x => x && x[0] === 'consent' && x[1] === 'update').map(x => x[2].analytics_storage) }));
  if (/(^|; )_ga/.test(after.cookies)) fail(`${L}: _ga cookies left after the no: ${after.cookies}`);
  if (!/keepme=1/.test(after.cookies)) fail(`${L}: the no deleted a cookie that is not GA's`);
  if (after.updates.join(',') !== 'granted,denied') fail(`${L}: consent updates ${after.updates.join(',')}, expected granted,denied`);
  await ctx.close();
}

// 4. an expired choice
{
  const days = await (async () => { const r = await fetch(new URL('js/site.js', url.replace(/en\/$/, ''))); const m = (await r.text()).match(/CONSENT_DAYS = (\d+);/); return m ? Number(m[1]) : null; })();
  if (!days) fail('expired: no CONSENT_DAYS in site.js');
  else {
    const old = new Date(Date.now() - (days + 1) * 864e5).toISOString();
    const { ctx, page } = await open(1440, 900, { choice: { v: 1, analytics: true, at: old } });
    if (!(await bannerShown(page))) fail(`expired: a ${days + 1}-day-old yes still counts`);
    await ctx.close();
  }
}

// 5. the map
{
  const L = 'map';
  const { ctx, page, google } = await open(1440, 900, { choice: { v: 1, analytics: false, at: new Date().toISOString() } });
  const want = await page.evaluate(() => { const m = document.querySelector('.js-map'); return m && m.getAttribute('data-src'); });
  if (!want) fail(`${L}: no .js-map with data-src`);
  else {
    await page.locator('.js-map-load').scrollIntoViewIfNeeded();
    if (google.length) fail(`${L}: Google asked before the button: ${google[0]}`);
    await page.click('.js-map-load');
    await page.waitForTimeout(300);
    const f = await page.evaluate(() => { const i = document.querySelector('.js-map iframe'); return i && { src: i.getAttribute('src'), title: i.title, button: !!document.querySelector('.js-map-load'), h: Math.round(i.getBoundingClientRect().height) }; });
    if (!f) fail(`${L}: no iframe after Rādīt karti`);
    else {
      if (f.src !== want.replace(/&amp;/g, '&')) fail(`${L}: iframe src ${f.src}, wanted ${want}`);
      if (!f.title) fail(`${L}: the iframe has no title`);
      if (f.button) fail(`${L}: the button is still there`);
      if (f.h < 200) fail(`${L}: the map is only ${f.h}px tall`);
      if (!google.some(u => u.startsWith('https://maps.google.com/maps'))) fail(`${L}: maps.google.com was not asked after the button`);
    }
  }
  await ctx.close();
}

// 6. the policy pages
{
  const { ctx, page } = await open(1440, 900, { choice: { v: 1, analytics: false, at: new Date().toISOString() } });
  const lang = await page.evaluate(() => document.documentElement.lang);
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('.js-consent a[href], .footer-links a[href]')].map(a => a.href))]);
  await ctx.close();
  if (links.length < 2) fail(`policies: ${links.length} policy links on the page, expected the privacy and the cookie policy`);
  for (const href of links) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const L = `policy ${new URL(href).pathname} ${w}`;
      const p = await open(w, h, { href });
      if (p.status !== 200) { fail(`${L}: HTTP ${p.status}`); await p.ctx.close(); continue; }
      const r = await p.page.evaluate(() => ({
        lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length,
        sideways: document.documentElement.scrollWidth > innerWidth,
        twin: (document.querySelector('.lang-switch a[hreflang]:not([aria-current])') || {}).href || null,
        settings: !!document.querySelector('.js-consent-open'), banner: !!document.querySelector('.js-consent'),
      }));
      if (r.lang !== lang) fail(`${L}: lang ${r.lang}, the home page is ${lang}`);
      if (r.h1 !== 1) fail(`${L}: ${r.h1} h1 elements`);
      if (r.sideways) fail(`${L}: sideways scroll`);
      if (!r.banner || !r.settings) fail(`${L}: no banner or no settings button`);
      if (p.errors.length) fail(`${L}: console ${p.errors.join(' | ')}`);
      if (p.google.length) fail(`${L}: requests to Google: ${p.google[0]}`);
      if (w === 1440) {
        if (!r.twin) fail(`${L}: no link to the other language`);
        else {
          const t = await p.page.request.get(r.twin);
          if (t.status() !== 200) fail(`${L}: its twin ${r.twin} answers ${t.status()}`);
        }
      }
      await p.ctx.close();
    }
  }
  notes.push(`${links.length} policy pages open`);
}

await browser.close();
if (failures.length) {
  console.log('FAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('PASS: ' + notes.join('; '));

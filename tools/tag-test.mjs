// tag-test.mjs: Google Tag Manager stays off until the visitor agrees, then the four events reach the dataLayer.
// Usage: node tools/tag-test.mjs <url>
// The page's own site.js is served with GTM_ID swapped for a test ID, and every request to Google's tag hosts is
// answered here with a stub, so the check runs offline and nothing reaches a real container. Three visitors:
//   no choice yet      no request to any Google tag host, Consent Mode defaults all denied, none of the four events
//   said no            the same
//   said yes           gtm.js fetched once with the ID, analytics_storage granted after the defaults and before
//                      gtm.js, the ad signals never granted, and every tel: link, every WhatsApp link to the owner,
//                      the map's Dalīties button and a valid enquiry each push their event with page_language and a
//                      link_location (generate_lead once the fake form Worker answers that e-mail and WhatsApp both
//                      delivered: one lead, one event, even with Nosutit pressed three times in a row); the map share's
//                      wa.me/?text link is not counted as a WhatsApp click
// Then once more with site.js exactly as shipped: an empty GTM_ID must load nothing, a set one must look like GTM-...
// Exit code 1 if any of that fails.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) { console.error('usage: node tools/tag-test.mjs <url>'); process.exit(2); }
const TEST_ID = 'GTM-TEST000';
const KEY = 'karumnieki-consent';
const TAG_HOSTS = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com/;
const EVENTS = ['phone_click', 'whatsapp_click', 'share', 'generate_lead'];
const failures = [];
const notes = [];

const browser = await chromium.launch({ headless: true });

async function visit(label, consent, { swapId = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const tagRequests = [];
  page.on('pageerror', e => errors.push(String(e)));
  // the page's own requests only: the Google map iframe is its own question (the cookie banner step), not GTM's
  page.on('request', r => { if (TAG_HOSTS.test(r.url()) && r.frame() === page.mainFrame()) tagRequests.push(r.url()); });
  let shippedId = null;
  await page.route('**/js/site.js*', async route => {
    const res = await route.fetch();
    let js = await res.text();
    const m = js.match(/var GTM_ID = '([^']*)';/);
    if (!m) { failures.push(`${label}: site.js has no "var GTM_ID = '...';" line`); }
    else {
      shippedId = m[1];
      if (swapId) js = js.replace(m[0], `var GTM_ID = '${TEST_ID}';`);
    }
    // generate_lead fires only after the form Worker confirms delivery, so a fake Worker says yes here
    js = js.replace(/var FORM_ENDPOINT = '[^']*';/, "var FORM_ENDPOINT = 'https://form.test/send';");
    await route.fulfill({ response: res, body: js });
  });
  // the Worker sends e-mail AND WhatsApp in one request and answers once: both channels delivered is still one lead
  let workerCalls = 0;
  await page.route('https://form.test/send', async route => {
    workerCalls++;
    await new Promise(r => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: '{"ok":true,"channels":{"email":true,"whatsapp":true}}', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route(TAG_HOSTS, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__tagStub = (window.__tagStub || 0) + 1;' }));
  if (consent !== undefined) {
    await page.addInitScript(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); }, [KEY, consent]);
  }
  await page.goto(url, { waitUntil: 'load' });

  // Click everything that should count, without leaving the page: a capture listener cancels the navigation
  // (tel:, wa.me) but lets the click reach the page's own listener on document.
  const counts = await page.evaluate(() => {
    document.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a) e.preventDefault(); }, true);
    const tel = [...document.querySelectorAll('a[href^="tel:"]')];
    const wa = [...document.querySelectorAll('a[href*="wa.me/37129338444"]')];
    const waShare = [...document.querySelectorAll('a[href*="wa.me/?"]')];
    for (const a of [...tel, ...wa, ...waShare]) a.click();
    document.querySelector('.js-share').click();
    return { tel: tel.length, wa: wa.length, waShare: waShare.length };
  });
  if (await page.evaluate(() => document.querySelector('.js-thanks').open)) await page.keyboard.press('Escape');
  await page.fill('#f-name', 'Testa Viesis');
  await page.fill('#f-tel', '+371 20000000');
  // Nosutit pressed twice in a row while the first send is still out (a double click, or Enter twice)
  await page.$eval('.btn-submit', b => { b.click(); b.click(); }); // by script: the cookie banner may sit over the button
  await page.evaluate(() => document.querySelector('.js-form').requestSubmit());
  await page.waitForTimeout(900);

  const dl = await page.evaluate(() => (window.dataLayer || []).map(x =>
    (x && typeof x === 'object' && !Array.isArray(x) && typeof x.length === 'number') ? { gtag: Array.from(x) } : x));
  const lang = await page.evaluate(() => document.documentElement.lang);
  await ctx.close();
  if (errors.length) failures.push(`${label}: page errors ${errors.join(' | ')}`);
  if (workerCalls !== 1) failures.push(`${label}: the form reached the Worker ${workerCalls} times for one enquiry sent three times in a row`);
  return { dl, tagRequests, counts, lang, shippedId };
}

const consentCalls = (dl, kind) => dl.filter(x => x.gtag && x.gtag[0] === 'consent' && x.gtag[1] === kind).map(x => x.gtag[2]);
const ours = dl => dl.filter(x => x && EVENTS.includes(x.event));

function expectSilent(label, r) {
  if (r.tagRequests.length) failures.push(`${label}: requested ${r.tagRequests.join(', ')}`);
  const def = consentCalls(r.dl, 'default')[0];
  const allDenied = def && ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'].every(k => def[k] === 'denied');
  if (!allDenied) failures.push(`${label}: Consent Mode default is not all denied (${JSON.stringify(def)})`);
  if (consentCalls(r.dl, 'update').length) failures.push(`${label}: consent was updated without a yes`);
  const ev = ours(r.dl);
  if (ev.length) failures.push(`${label}: ${ev.length} events pushed without consent (${ev.map(e => e.event).join(', ')})`);
}

// 1. no choice yet
const none = await visit('no choice', undefined);
expectSilent('no choice', none);

// 2. said no
const no = await visit('said no', { v: 1, analytics: false, at: new Date().toISOString() });
expectSilent('said no', no);

// 3. said yes
const yes = await visit('said yes', { v: 1, analytics: true, at: new Date().toISOString() });
{
  const L = 'said yes';
  const gtm = yes.tagRequests.filter(u => u.startsWith('https://www.googletagmanager.com/gtm.js'));
  if (gtm.length !== 1) failures.push(`${L}: gtm.js requested ${gtm.length} times`);
  else if (!gtm[0].includes('id=' + TEST_ID)) failures.push(`${L}: gtm.js without the container ID (${gtm[0]})`);
  const iDefault = yes.dl.findIndex(x => x.gtag && x.gtag[0] === 'consent' && x.gtag[1] === 'default');
  const iUpdate = yes.dl.findIndex(x => x.gtag && x.gtag[0] === 'consent' && x.gtag[1] === 'update');
  const iStart = yes.dl.findIndex(x => x && x.event === 'gtm.js');
  if (!(iDefault >= 0 && iDefault < iUpdate && iUpdate < iStart)) failures.push(`${L}: order should be consent default, update, gtm.js (got ${iDefault}, ${iUpdate}, ${iStart})`);
  const upd = consentCalls(yes.dl, 'update');
  if (!upd.some(u => u.analytics_storage === 'granted')) failures.push(`${L}: analytics_storage never granted`);
  if (upd.some(u => u.ad_storage === 'granted' || u.ad_user_data === 'granted' || u.ad_personalization === 'granted')) failures.push(`${L}: an ad signal was granted`);
  const ev = ours(yes.dl);
  const by = n => ev.filter(e => e.event === n);
  const want = { phone_click: yes.counts.tel, whatsapp_click: yes.counts.wa, share: 1, generate_lead: 1 };
  for (const [n, c] of Object.entries(want)) if (by(n).length !== c) failures.push(`${L}: ${n} pushed ${by(n).length} times, expected ${c}`);
  for (const e of ev) {
    if (e.page_language !== yes.lang) failures.push(`${L}: ${e.event} page_language ${e.page_language}, page is ${yes.lang}`);
    if (!e.link_location || e.link_location === 'other') failures.push(`${L}: ${e.event} without a link_location`);
  }
  if (by('share').some(e => e.content_type !== 'map')) failures.push(`${L}: share without content_type map`);
  const places = n => [...new Set(by(n).map(e => e.link_location))].join(' ');
  notes.push(`phone_click x${by('phone_click').length} (${places('phone_click')}), whatsapp_click x${by('whatsapp_click').length} (${places('whatsapp_click')}), share x${by('share').length}, generate_lead x${by('generate_lead').length}; ${yes.counts.waShare} map-share WhatsApp link not counted`);
}

// 4. site.js as shipped, with a yes
const shipped = await visit('as shipped', { v: 1, analytics: true, at: new Date().toISOString() }, { swapId: false });
if (shipped.shippedId === '') {
  if (shipped.tagRequests.length) failures.push(`as shipped: GTM_ID is empty but ${shipped.tagRequests.join(', ')} was requested`);
  notes.push('GTM_ID is empty in site.js, so the live page loads no container yet');
} else if (shipped.shippedId !== null) {
  if (!/^GTM-[A-Z0-9]{4,}$/.test(shipped.shippedId)) failures.push(`as shipped: GTM_ID "${shipped.shippedId}" does not look like GTM-XXXXXXX`);
  notes.push(`GTM_ID ${shipped.shippedId}`);
}

await browser.close();
if (failures.length) {
  console.log('FAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log(`PASS: silent with no choice and with a no; with a yes ${notes.join('; ')}`);

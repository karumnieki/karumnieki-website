// links-test.mjs: open every link that leaves the site, on both pages, and check it lands where its words say.
// Usage: node links-test.mjs <lvUrl> <outdir>      e.g. node links-test.mjs http://localhost:8477/site/ out/links
// Written 2026-10-01 after the three per-review Google links were found landing on a plain map of Riga
// on a computer: every tool before this one checked that a link existed, none opened it. Checks:
//   Google review links  the review opens: the quote's own opening words are on the landed page;
//   Google reviews list  the listing opens and still shows the numbers the page prints (rating and count);
//   Facebook             the page and its reviews open, and the reviews page shows the page's recommend share and count;
//   Maps, the map embed  the pin's coordinates survive the redirect; the embed answers 200;
//   Waze                 the route ends at the pin;
//   WhatsApp             the owner's number, and the prefill in the page's own language exactly as written;
//   tel: and mailto:     the one phone number and the one address.
// Needs the internet, and Google's and Facebook's pages change: a FAIL here is checked by hand before anything is
// edited. Google's consent page is answered with "reject all", as a visitor who says no would. Exit code 1 on any FAIL.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [lvArg, outdirArg] = process.argv.slice(2);
if (!lvArg || !outdirArg) { console.error('usage: node links-test.mjs <lvUrl> <outdir>'); process.exit(2); }
const LV = lvArg.endsWith('/') ? lvArg : lvArg + '/';
const PAGES = { lv: LV, en: LV + 'en/' };
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });
const PHONE = '+37129338444', MAIL = 'karumnieki@gmail.com', LAT = '57.1276772', LNG = '24.8535513';
const PREFILL = { lv: 'Labdien!', en: 'Hello!' };

const failures = [];
const fail = (why) => { failures.push(why); console.log('  FAIL ' + why); };
const ok = (what) => console.log('  ok   ' + what);
const norm = (s) => s.replace(/\s+/g, ' ');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'lv-LV' });
await answered(ctx);
const page = await ctx.newPage();

// what each page links to, read from the served page
const found = {};
for (const [lang, url] of Object.entries(PAGES)) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  found[lang] = await page.evaluate(() => ({
    links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /^(https?:|tel:|mailto:)/.test(h)),
    iframes: [...document.querySelectorAll('iframe[src], [data-src]')].map(f => f.getAttribute('src') || f.getAttribute('data-src')),
    // the quote under each per-review link, without the quote marks and a leading ellipsis
    reviews: [...document.querySelectorAll('blockquote.review')].map(b => ({
      href: b.querySelector('.review-by a').getAttribute('href'),
      quote: b.querySelector('p').textContent.replace(/^[\u201e\u201c"]+(\.\.\.)?/, '').replace(/[\u201d"]+$/, '').trim(),
    })),
    ratings: [...document.querySelectorAll('.rating-text')].map(r => r.textContent),
  }));
}
const lvQuote = Object.fromEntries(found.lv.reviews.map(r => [r.href, r.quote]));

async function visit(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Google's reviews list reaches the consent page through a script redirect after its first load, so keep watching
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1000);
    if (page.url().includes('consent.google')) {
      await page.getByRole('button', { name: /Noraidīt visus|Reject all/ }).first().click({ timeout: 10000 });
      // the redirect chain may abort a navigation half way; the next round of the loop looks again
      await page.waitForURL(u => !String(u).includes('consent.google'), { timeout: 20000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(3000);
  return norm(await page.evaluate(() => document.body ? document.body.innerText : ''));
}
let shot = 0;
const snap = async (name) => { await page.screenshot({ path: path.join(outdir, (++shot) + '-' + name + '.png') }); };

for (const lang of ['lv', 'en']) {
  console.log('== ' + lang);
  const { links, iframes, reviews, ratings } = found[lang];
  const tels = links.filter(h => h.startsWith('tel:'));
  const mails = links.filter(h => h.startsWith('mailto:'));
  if (tels.some(h => h !== 'tel:' + PHONE)) fail(lang + ': a tel: link is not tel:' + PHONE + ' (' + tels.join(', ') + ')'); else ok(lang + ': ' + tels.length + ' tel: links, all ' + PHONE);
  if (mails.some(h => h !== 'mailto:' + MAIL)) fail(lang + ': a mailto: link is not ' + MAIL); else ok(lang + ': ' + mails.length + ' mailto: link(s), all ' + MAIL);
  for (const href of links.filter(h => /^https:\/\/wa\.me\//.test(h))) {
    const u = new URL(href);
    const text = u.searchParams.get('text') || '';
    if (u.pathname === '/37129338444') {
      if (!text.startsWith(PREFILL[lang])) fail(lang + ': the WhatsApp prefill is not in the page language: ' + text);
      else ok(lang + ': WhatsApp to the owner, prefill "' + text + '"');
    } else if (u.pathname === '/') {
      if (!text.includes('maps.google.com/?q=' + LAT + ',' + LNG)) fail(lang + ': the WhatsApp share does not carry the map link: ' + text);
      else ok(lang + ': WhatsApp share carries the map link');
    } else fail(lang + ': unexpected wa.me link ' + href);
  }
  if (lang === 'en') {
    // the external links are the same on both pages (parity.py holds that), so they are opened once, from lv
    const same = JSON.stringify(found.en.links.filter(h => !/^https:\/\/wa\.me\//.test(h))) === JSON.stringify(found.lv.links.filter(h => !/^https:\/\/wa\.me\//.test(h)));
    if (!same) fail('en: the outbound links differ from the Latvian page'); else ok('en: outbound links identical to the Latvian page');
    continue;
  }
  const opened = new Set();
  for (const href of [...links, ...iframes]) {
    if (!/^https?:/.test(href) || /^https:\/\/wa\.me\//.test(href) || /karumnieki\.lv/.test(href) || opened.has(href)) continue;
    opened.add(href);
    try {
      if (href.includes('/maps/reviews/')) {
        const body = await visit(href);
        const words = (lvQuote[href] || '').split(' ').slice(0, 5).join(' ');
        if (!words) fail('a review link with no quote beside it: ' + href);
        else if (!body.includes(words)) { fail('review link does not open the review "' + words + '...": landed on ' + page.url().slice(0, 80)); await snap('review'); }
        else ok('review opens: "' + words + '..."');
      } else if (href.includes('search.google.com/local/reviews')) {
        const body = await visit(href);
        const g = ratings.find(r => /Google/.test(r)) || '';
        const [rating, count] = [(g.match(/\d[,.]\d/) || [''])[0], (g.match(/(\d+) atsauksm/) || ['', ''])[1]];
        if (!body.includes('Kārumnieki')) { fail('Google reviews list does not open the listing: ' + page.url().slice(0, 80)); await snap('google-list'); }
        else if (!body.includes(rating.replace('.', ',')) && !body.includes(rating.replace(',', '.'))) fail('Google now shows a different rating than the page\'s ' + rating);
        else if (!body.includes(count)) fail('Google now shows a different review count than the page\'s ' + count);
        else ok('Google reviews list opens and still shows ' + rating + ' and ' + count);
      } else if (href.includes('facebook.com')) {
        const body = await visit(href);
        const title = await page.title();
        if (/login/.test(page.url()) || !/K.rumnieki/.test(title)) { fail('Facebook link does not open the page (' + page.url().slice(0, 60) + ', "' + title + '")'); await snap('facebook'); continue; }
        if (href.includes('/reviews')) {
          const fb = ratings.find(r => /Facebook/.test(r)) || '';
          const [share, count] = [(fb.match(/(\d+)\s?%/) || ['', ''])[1], (fb.match(/(\d+) (atsauksmes|reviews)/) || ['', ''])[1]];
          if (!new RegExp(share + '\\s?%').test(body) || !body.includes(count)) fail('Facebook reviews no longer show ' + share + ' % and ' + count + ': "' + body.slice(0, 160) + '"');
          else ok('Facebook reviews open and still show ' + share + ' % and ' + count);
        } else ok('Facebook page opens: "' + title + '"');
      } else if (href.includes('output=embed')) {
        const res = await page.request.get(href);
        if (res.status() !== 200) fail('the map embed answers ' + res.status()); else ok('the map embed answers 200');
      } else if (href.includes('maps.google.com')) {
        await visit(href);
        if (!page.url().includes(LAT) || !page.url().includes(LNG)) fail('Google Maps lost the pin: ' + page.url().slice(0, 100));
        else ok('Google Maps opens at the pin');
      } else if (href.includes('waze.com')) {
        await visit(href);
        if (!decodeURIComponent(page.url()).includes(LAT + ',' + LNG)) fail('Waze does not route to the pin: ' + page.url().slice(0, 100));
        else ok('Waze routes to the pin');
      } else fail('an outbound link this test does not know: ' + href);
    } catch (e) { fail('could not open ' + href.slice(0, 80) + ': ' + String(e).slice(0, 120)); }
  }
}
await browser.close();
console.log(failures.length ? 'FAIL: ' + failures.length + ' link(s), see above' : 'PASS: every outbound link on both pages lands where it says');
process.exit(failures.length ? 1 : 0);

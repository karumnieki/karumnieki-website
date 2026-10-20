// reviews-test.mjs: the Atsauksmes block follows Google through the form Worker, and falls back to its own quotes.
// Usage: node tools/reviews-test.mjs <url>
// site.js is served with REVIEWS_ENDPOINT swapped for a test address, answered here from a fixture, so the check runs
// offline and nothing reaches the Worker or Google. Four visits:
//   good data      nothing is asked for at the top of the page, only near the block; both rating numbers take Google's (4,7 and "221 atsauksme": Latvian takes the singular after 1,
//                  21, 221, never after 11 or 211); the lead and the static row give way to one carousel; slide 1 is
//                  the lead, word for word, with that guest's photos; then the reviews with photos (even one given
//                  last), then the rest; "1 / 9", the arrows page (prev off at the start, next off at the end) and so
//                  do the arrow keys; only the slide in view is reachable; a long paragraph folds with Lasīt visu and
//                  opens, the height following it; a photo review without text has no empty quote; up to four
//                  thumbnails with "+N" on the fourth; a thumbnail opens all that guest's photos in the gallery's
//                  viewer ("1 / 5", next, Escape hands focus back); a photo the Worker no longer has hides its
//                  thumbnail; five stars always, the missing ones dimmed; English says "translated by Google" under a
//                  machine translation; the guest's text is text (an <img> in it stays letters); no console errors
//   server error   the page keeps its own quotes and numbers, no carousel
//   odd data       a link that is not Google's: the same
//   as shipped     an empty REVIEWS_ENDPOINT asks nothing of anyone; a set one points at /atsauksmes/ over https
// Exit code 1 if any of that fails.
import { createRequire } from 'node:module';
import { answered } from './visitor.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) { console.error('usage: node tools/reviews-test.mjs <url>'); process.exit(2); }
const EN = /\/en\/?$/.test(url);
const LANG = EN ? 'en' : 'lv';
const TEST = 'https://reviews.test/atsauksmes/';
const GOOGLE = 'https://search.google.com/local/reviews?placeid=ChIJy2ZJLKBP6UYRNVJRpDEdHy0';
const failures = [];
const notes = [];

const long = Array.from({ length: 24 }, (_, i) => `Teikums numur ${i + 1} par pirti, kublu un mieru.`).join('\n');
const ph = n => ({ id: (n + '0000000000000000').slice(0, 16).replace(/[^0-9a-f]/g, '0'), w: 1200, h: 800 });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
function fixture(link = GOOGLE) {
  const one = (author, text, extra = {}) => ({ author, rating: 5, text, translated: EN, published: '2026-06-01', date: EN ? 'June 2026' : '2026. gada jūnijs', photos: [], ...extra });
  return {
    meta: { rating: 4.7, count: 221, url: link, generated: '2026-10-12', lang: LANG },
    reviews: [
      one('Juta K.', 'The live text of the lead, which must not replace the approved words.', { photos: [ph('d1'), ph('d2')], date: EN ? 'December 2022' : '2022. gada decembris' }),
      one('Viesis A.', 'Pirmā atsauksme ar bildēm: ' + 'lieliska vieta, plašas telpas, silta pirts un kubls, saimnieks palīdzēja ar visu, ko lūdzām. '.repeat(9), { photos: [ph('a1'), ph('a2')] }),
      one('Viesis B.', long),
      one('Viesis C.', 'Trešā atsauksme <img src=x onerror="window.__xss=1"> ar zīmēm.', { rating: 4 }),
      one('Viesis D.', 'Ceturtā atsauksme: saimnieks ļoti atsaucīgs un laipns.'),
      one('Viesis E.', 'Piektā atsauksme: kāzas izdevās, telpas plašas.'),
      one('Viesis F.', 'Sestā atsauksme: atgriezīsimies vēl, paldies par visu.'),
      one('Viesis G.', 'Septītā atsauksme: miers, klusums un daba.', { translated: false }),
      one('Viesis P.', '', { translated: false, photos: ['c1', 'c2', 'c3', 'c4', 'c5'].map(ph) }),
    ],
  };
}

const browser = await chromium.launch({ headless: true });

async function visit(label, answer, { swap = true } = {}) {
  const ctx = await answered(await browser.newContext({ viewport: { width: 1440, height: 900 } }));
  const page = await ctx.newPage();
  const errors = [];
  const asked = [];
  let shipped = null;
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (/\/atsauksmes\//.test(r.url())) asked.push(r.url()); });
  await page.route('**/js/site.js*', async route => {
    const res = await route.fetch();
    let js = await res.text();
    const m = js.match(/var REVIEWS_ENDPOINT = '([^']*)';/);
    shipped = m ? m[1] : null;
    if (swap) js = js.replace(/var REVIEWS_ENDPOINT = '[^']*';/, `var REVIEWS_ENDPOINT = '${TEST}';`);
    await route.fulfill({ response: res, body: js });
  });
  await page.route(TEST + '*', route => answer(route));
  await page.route(TEST + 'foto/*', route => /\/foto\/c3/.test(route.request().url())
    ? route.fulfill({ status: 404, body: 'Not found' })
    : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const askedBeforeScroll = asked.length;
  await page.locator('#atsauksmes').scrollIntoViewIfNeeded();   // the reviews are asked for only near the screen
  await page.waitForTimeout(900);
  const state = () => page.evaluate(() => {
    const vp = document.querySelector('.rv-viewport');
    return {
      ratings: Array.from(document.querySelectorAll('.js-g-rating'), e => e.textContent),
      counts: Array.from(document.querySelectorAll('.js-g-count'), e => e.textContent),
      carousels: document.querySelectorAll('.rv').length,
      leadHidden: document.querySelector('.review-lead').hidden,
      rowHidden: document.querySelector('.js-reviews').hidden,
      staticQuotes: document.querySelectorAll('.js-reviews .review').length,
      slides: Array.from(document.querySelectorAll('.rv-slide'), s => ({
        name: (s.querySelector('.rv-name') || {}).textContent || '',
        date: (s.querySelector('.rv-date') || {}).textContent || '',
        text: (s.querySelector('.rv-text') || {}).textContent || '',
        hasText: !!s.querySelector('.rv-text'),
        toggle: !!s.querySelector('.rv-toggle'),
        on: s.querySelectorAll('.rv-star:not(.rv-star-off)').length, stars: s.querySelectorAll('.rv-star').length,
        thumbs: s.querySelectorAll('.rv-shot').length,
        hiddenThumbs: Array.from(s.querySelectorAll('.rv-shot')).filter(b => b.hidden).length,
        plus: (s.querySelector('.rv-shot-more') || {}).textContent || '',
        thumbSrc: (s.querySelector('.rv-shot img') || {}).src || '',
        inert: s.inert, h: s.offsetHeight,
      })),
      count: (document.querySelector('.rv-count') || {}).textContent || '',
      prevOff: (document.querySelector('.rv-prev') || {}).disabled, nextOff: (document.querySelector('.rv-next') || {}).disabled,
      vpH: vp ? vp.offsetHeight : 0, scroll: vp ? Math.round(vp.scrollLeft / vp.clientWidth) : -1,
      textImgs: document.querySelectorAll('.rv-text img').length,
      xss: !!window.__xss,
      lead: (document.querySelector('.review-lead p') || {}).textContent || '',
    };
  });
  return { page, ctx, errors, asked, askedBeforeScroll, state, shipped: () => shipped };
}

const ok = route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(fixture()) });
// until the strip has come to rest and the height has caught up with the slide in view (or 4 s)
const settle = async p => {
  await p.waitForTimeout(150);
  await p.waitForFunction(() => {
    const vp = document.querySelector('.rv-viewport');
    if (!vp) return true;
    const i = Number((document.querySelector('.rv-count') || {}).textContent.split(' / ')[0]) - 1;
    const sl = document.querySelectorAll('.rv-slide')[i];
    return sl && Math.abs(vp.scrollLeft - i * vp.clientWidth) < 2 && Math.abs(vp.offsetHeight - sl.offsetHeight) <= 2;
  }, null, { timeout: 4000, polling: 100 }).catch(() => {});
};

// 1. good data
{
  const v = await visit('good data', ok);
  let s = await v.state();
  if (v.askedBeforeScroll) failures.push(`good data: the reviews were asked for at the top of the page (${v.askedBeforeScroll} requests)`);
  const want = EN ? ['4.7', '221 reviews'] : ['4,7', '221 atsauksme'];
  if (s.ratings.length < 2 || s.ratings.some(r => r !== want[0])) failures.push(`good data: ratings ${JSON.stringify(s.ratings)}, want ${want[0]} twice`);
  if (s.counts.length < 2 || s.counts.some(c => c !== want[1])) failures.push(`good data: counts ${JSON.stringify(s.counts)}, want "${want[1]}" twice`);
  if (s.carousels !== 1 || !s.leadHidden || !s.rowHidden) failures.push(`good data: ${s.carousels} carousels, lead ${s.leadHidden ? 'hidden' : 'shown'}, row ${s.rowHidden ? 'hidden' : 'shown'}`);
  const names = s.slides.map(x => x.name).join(', ');
  if (s.slides.length !== 9) failures.push(`good data: ${s.slides.length} slides (${names}), want 9`);
  if (!s.slides[0] || s.slides[0].name !== 'Juta K.') failures.push(`good data: slide 1 is ${s.slides[0] && s.slides[0].name}, want the lead`);
  else {
    const leadWords = s.lead.replace(/^[„“]/, '').replace(/[”"]$/, '').slice(0, 40);
    if (!s.slides[0].text.includes(leadWords)) failures.push('good data: the lead slide does not carry the approved words');
    if (s.slides[0].text.includes('live text')) failures.push('good data: the lead slide took the live text');
    if (s.slides[0].thumbs !== 2) failures.push(`good data: the lead slide has ${s.slides[0].thumbs} photos, want that guest's 2`);
    if (EN && !s.slides[0].date.includes('translated from Latvian')) failures.push('good data: the English lead lost "translated from Latvian"');
  }
  if (s.slides.filter(x => x.name === 'Juta K.').length !== 1) failures.push('good data: the lead\'s author shows twice');
  if (!s.slides[1] || s.slides[1].name !== 'Viesis A.' || !s.slides[2] || s.slides[2].name !== 'Viesis P.') failures.push(`good data: photo reviews not first after the lead: ${names}`);
  if (s.count !== '1 / 9' || !s.prevOff || s.nextOff) failures.push(`good data: at the start "${s.count}", prev ${s.prevOff ? 'off' : 'on'}, next ${s.nextOff ? 'off' : 'on'}`);
  if (s.slides.slice(1).some(x => !x.inert) || (s.slides[0] && s.slides[0].inert)) failures.push('good data: slides out of view are reachable, or the one in view is not');
  if (s.slides[0] && Math.abs(s.vpH - s.slides[0].h) > 2) failures.push(`good data: the carousel is ${s.vpH}px for a ${s.slides[0].h}px slide`);
  if (s.slides.some(x => x.stars !== 5)) failures.push('good data: a slide without five stars');
  if (!s.slides.some(x => x.on === 4)) failures.push('good data: a 4 star review does not dim one star');
  const a = s.slides.find(x => x.name === 'Viesis A.');
  const p = s.slides.find(x => x.name === 'Viesis P.');
  if (!a || !a.toggle) failures.push('good data: a long paragraph has no Lasīt visu');
  if (s.slides.find(x => x.name === 'Viesis D.' && x.toggle)) failures.push('good data: a short review got a Lasīt visu');
  if (!a || a.thumbs !== 2 || a.plus) failures.push(`good data: 2 photos show as ${a && a.thumbs} thumbnails ${a && a.plus}`);
  if (!a || !/\/foto\/a1[0-9a-f]{14}-s$/.test(a.thumbSrc)) failures.push(`good data: thumbnail src ${a && a.thumbSrc}`);
  if (!p || p.thumbs !== 4 || p.plus !== '+1') failures.push(`good data: 5 photos show as ${p && p.thumbs} thumbnails "${p && p.plus}", want 4 and +1`);
  if (!p || p.hasText) failures.push('good data: a photo review without text got a quote');
  if (EN && a && !a.date.includes('translated by Google')) failures.push('good data: an English machine translation does not say so');
  if (EN && p && p.date.includes('translated by Google')) failures.push('good data: a review without text says it was translated');
  if (!EN && !/^„/.test(a ? a.text : '')) failures.push('good data: Latvian quote marks missing');

  if (s.carousels === 1) {
    // the arrows page, the keys too
    await v.page.locator('.rv-next').click();
    await settle(v.page);
    s = await v.state();
    if (s.count !== '2 / 9' || s.scroll !== 1 || s.prevOff || s.slides[1].inert) failures.push(`good data: next went to "${s.count}" (scroll ${s.scroll})`);
    if (Math.abs(s.vpH - s.slides[1].h) > 2) failures.push(`good data: the height did not follow slide 2 (${s.vpH} vs ${s.slides[1].h})`);
    // Lasīt visu on slide 2 (Viesis A.) opens and the height follows
    const before = s.vpH;
    const toggle = v.page.locator('.rv-slide').nth(1).locator('.rv-toggle');
    if (await toggle.count()) {
      await toggle.click();
      await settle(v.page);
      s = await v.state();
      const open = await v.page.evaluate(() => {
        const sl = document.querySelectorAll('.rv-slide')[1];
        const t = sl.querySelector('.rv-text');
        return { cls: sl.classList.contains('is-open'), aria: sl.querySelector('.rv-toggle').getAttribute('aria-expanded'), whole: t.scrollHeight <= t.clientHeight + 4 };
      });
      if (!open.cls || open.aria !== 'true' || !open.whole || s.vpH <= before) failures.push(`good data: Lasīt visu ${JSON.stringify(open)}, height ${before} to ${s.vpH}`);
    }
    await v.page.locator('.rv-viewport').focus();
    await v.page.keyboard.press('ArrowRight');
    await settle(v.page);
    s = await v.state();
    if (s.count !== '3 / 9') failures.push(`good data: ArrowRight went to "${s.count}"`);
    await v.page.keyboard.press('ArrowLeft');
    await settle(v.page);
    s = await v.state();
    if (s.count !== '2 / 9') failures.push(`good data: ArrowLeft went to "${s.count}"`);

    // slide 3 (Viesis P.): a missing photo hides, a thumbnail opens the viewer
    await v.page.locator('.rv-next').click();
    await settle(v.page);
    await v.page.waitForTimeout(400);
    s = await v.state();
    const pp = s.slides[2];
    if (!pp || pp.hiddenThumbs !== 1) failures.push(`good data: a photo the Worker no longer has left ${pp && pp.hiddenThumbs} thumbnails hidden, want 1`);
    await v.page.locator('.rv-slide').nth(2).locator('.rv-shot').first().click();
    await v.page.waitForTimeout(300);
    let lb = await v.page.evaluate(() => {
      const d = document.querySelector('dialog.lb');
      return d ? { open: d.open, count: d.querySelector('.lb-count').textContent, src: d.querySelector('.lb-frame img').getAttribute('src') || '' } : null;
    });
    if (!lb || !lb.open || lb.count !== '1 / 5' || !/\/foto\/c1[0-9a-f]{14}-l$/.test(lb.src)) failures.push(`good data: the viewer ${JSON.stringify(lb)}, want open at 1 / 5 with the large c1`);
    if (lb && lb.open) {
      await v.page.locator('dialog.lb .lb-next').click();
      lb = await v.page.evaluate(() => document.querySelector('dialog.lb .lb-count').textContent);
      if (lb !== '2 / 5') failures.push(`good data: next in the viewer shows ${lb}`);
      await v.page.keyboard.press('Escape');
      await v.page.waitForTimeout(200);
      const back = await v.page.evaluate(() => ({ open: document.querySelector('dialog.lb').open, focus: document.activeElement && document.activeElement.classList.contains('rv-shot') }));
      if (back.open || !back.focus) failures.push(`good data: Escape left the viewer ${back.open ? 'open' : 'closed'} with focus ${back.focus ? 'on' : 'off'} the thumbnail`);
    }

    // to the end: next goes off
    // quick presses while the strip still glides: every one counts
    await v.page.locator('.rv-viewport').focus();
    for (let i = 0; i < 8; i++) { await v.page.keyboard.press('ArrowRight'); await v.page.waitForTimeout(60); }
    await settle(v.page);
    s = await v.state();
    if (s.count !== '9 / 9' || !s.nextOff) failures.push(`good data: at the end "${s.count}", next ${s.nextOff ? 'off' : 'on'}`);
  }
  if (s.textImgs || s.xss) failures.push('good data: a review\'s text became markup');
  if (v.errors.length) failures.push('good data: console ' + v.errors.join(' | '));
  notes.push('a carousel of 9 (the lead first with its photos, then photo reviews), arrows, keys, Lasīt visu, viewer');
  await v.ctx.close();
}

// 2. server error, 3. odd data: the page's own quotes and numbers stay
for (const [label, answer] of [
  ['server error', route => route.fulfill({ status: 500, body: '{}' })],
  ['odd data', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture('https://evil.example/')) })],
]) {
  const v = await visit(label, answer);
  const s = await v.state();
  const keep = EN ? ['4.8', '210 reviews'] : ['4,8', '210 atsauksmes'];
  if (s.carousels || s.leadHidden || s.rowHidden || s.staticQuotes !== 2) failures.push(`${label}: ${s.carousels} carousels, lead ${s.leadHidden ? 'hidden' : 'shown'}, ${s.staticQuotes} quotes; want the page's own`);
  if (label === 'server error' && (s.ratings.some(r => r !== keep[0]) || s.counts.some(c => c !== keep[1]))) failures.push(`${label}: numbers changed to ${s.ratings} ${s.counts}`);
  await v.ctx.close();
}

// 4. as shipped
{
  const v = await visit('as shipped', ok, { swap: false });
  const s = await v.state();
  const shipped = v.shipped();
  if (shipped === null) failures.push('as shipped: no REVIEWS_ENDPOINT in site.js');
  else if (shipped === '') {
    if (v.asked.length) failures.push('as shipped: REVIEWS_ENDPOINT is empty but ' + v.asked.join(', ') + ' was asked');
    if (s.carousels) failures.push('as shipped: a carousel with an empty REVIEWS_ENDPOINT');
    notes.push('REVIEWS_ENDPOINT is empty, so the page keeps its own quotes');
  } else {
    if (!/^https:\/\/[a-z0-9.-]+\/atsauksmes\/$/.test(shipped)) failures.push(`as shipped: REVIEWS_ENDPOINT "${shipped}" is not https://<host>/atsauksmes/`);
    notes.push('REVIEWS_ENDPOINT ' + shipped);
  }
  await v.ctx.close();
}

await browser.close();
if (failures.length) {
  console.log('FAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log(`PASS: ${notes.join('; ')}; error and odd data keep the page's quotes`);

// form-fit.mjs: does the Pieprasījums form fit on one screen? For each viewport it follows the nav link to
// #pieprasijums (as a visitor would), then reports where the first field and the Nosūtīt button land, and the
// form's own height against the space under the sticky header.
// Usage: node form-fit.mjs <url> [WxH,WxH,...] [--shots=<dir>]   (--shots saves the landed screen per size)
// Then, once per page, what the form DOES on Nosutit: an empty form and a bad e-mail must
// not open the thank-you and must keep what was typed, a name and a phone with no e-mail must open it (e-mail is
// optional since 2026-10-02), a filled form must open it even for 60 guests (an enquiry over 45 is still a lead),
// focus goes to Aizvert and back to Nosutit on Escape. Then the real send against a fake Worker (see below).
// Exit code 1 if any of that fails.
// The fit lines are a report, not a pass/fail.
import { answered } from './visitor.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const argv = process.argv.slice(2);
const shots = (argv.find(a => a.startsWith('--shots=')) || '').slice(8);
const [url, sizesArg = '1920x1080,1536x864,1440x900,1366x768,1280x720,390x844'] = argv.filter(a => !a.startsWith('--'));
const browser = await chromium.launch({ headless: true, args: ['--font-render-hinting=none'] });
for (const s of sizesArg.split(',')) {
  const [w, h] = s.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1 });
  await answered(ctx);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector('a[href="#pieprasijums"]').click();
    const hdr = document.querySelector('.site-header').getBoundingClientRect().bottom;
    const bar = document.body.classList.contains('bar-on') && getComputedStyle(document.querySelector('.js-bar')).display !== 'none' ? document.querySelector('.js-bar').getBoundingClientRect().height : 0;
    const form = document.querySelector('.js-form').getBoundingClientRect();
    // the first field a visitor sees: not the hidden valoda input that comes first (it measures 0)
    const first = document.querySelector('.js-form input:not([type=hidden]), .js-form select').getBoundingClientRect();
    const btn = document.querySelector('.btn-submit').getBoundingClientRect();
    const h2 = document.querySelector('#pieprasijums h2').getBoundingClientRect();
    return { hdr: Math.round(hdr), bar: Math.round(bar), h2Top: Math.round(h2.top), firstTop: Math.round(first.top), btnBottom: Math.round(btn.bottom), formH: Math.round(btn.bottom - form.top), usable: Math.round(innerHeight - hdr - bar), vh: innerHeight };
  });
  const fits = r.btnBottom <= r.vh - r.bar;
  console.log(`${s}: heading at ${r.h2Top}, first field at ${r.firstTop}, Nosutit bottom ${r.btnBottom} of ${r.vh - r.bar} visible -> ${fits ? 'FITS' : 'needs ' + (r.btnBottom - (r.vh - r.bar)) + 'px scroll'}; form ${r.formH}px vs ${r.usable}px under the header`);
  if (shots) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/form-${s}.png` }); }
  await ctx.close();
}

const failures = [];
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await answered(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  const state = () => page.evaluate(() => ({
    open: document.querySelector('.js-thanks').open,
    focus: document.activeElement.id || document.activeElement.className,
    name: document.querySelector('#f-name').value,
  }));
  const fill = async (email, guests) => {
    await page.fill('#f-name', 'Testa Viesis'); await page.fill('#f-tel', '+371 20000000');
    await page.fill('#f-email', email); await page.fill('#f-guests', guests);
  };
  await page.click('.btn-submit'); await page.waitForTimeout(200);
  let s = await state();
  if (s.open) { failures.push('an empty form opened the thank-you'); await page.keyboard.press('Escape'); }
  else if (s.focus !== 'f-name') failures.push('an empty form did not put focus on the first required field (got ' + s.focus + ')');
  await fill('not-an-email', '10'); await page.click('.btn-submit'); await page.waitForTimeout(200);
  s = await state();
  if (s.open) { failures.push('a bad e-mail opened the thank-you'); await page.keyboard.press('Escape'); }
  if (s.name !== 'Testa Viesis') failures.push('a refused submit wiped what was typed');
  await fill('', '10'); await page.click('.btn-submit'); await page.waitForTimeout(200);
  s = await state();
  if (!s.open) failures.push('a name and a phone without an e-mail did not open the thank-you');
  else { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await fill('viesis@example.com', '60'); await page.click('.btn-submit'); await page.waitForTimeout(200);
  s = await state();
  if (!s.open) failures.push('a filled form with 60 guests did not open the thank-you');
  else {
    if (!/js-thanks-first/.test(s.focus)) failures.push('the thank-you did not put focus on its close button (got ' + s.focus + ')');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    s = await state();
    if (s.open) failures.push('Escape did not close the thank-you');
    if (!/btn-submit/.test(s.focus)) failures.push('focus did not come back to Nosutit (got ' + s.focus + ')');
  }
  if (errors.length) failures.push('page errors: ' + errors.join(' | '));
  await ctx.close();
}
// The real send (2026-10-04): site.js is served with FORM_ENDPOINT pointing at a fake Worker answered here, so nothing
// leaves the machine. Success opens the thank-you with every field in the request; a refusal or a dropped connection
// keeps the dialog shut, shows the error line with the phone link, keeps what was typed and gives Nosutit back.
const ENDPOINT = 'https://form.test/send';
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await answered(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/js/site.js*', async route => {
    const res = await route.fetch();
    const js = (await res.text()).replace(/var FORM_ENDPOINT = '[^']*';/, `var FORM_ENDPOINT = '${ENDPOINT}';`);
    await route.fulfill({ response: res, body: js });
  });
  let answer = { status: 200, body: { ok: true, channels: { email: true, whatsapp: true } }, delay: 0 };
  let sent = null;
  await page.route(ENDPOINT, async route => {
    sent = JSON.parse(route.request().postData() || 'null');
    if (answer.abort) return route.abort('failed');
    if (answer.delay) await new Promise(r => setTimeout(r, answer.delay));
    await route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body),
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto(url, { waitUntil: 'load' });
  const lang = await page.evaluate(() => document.documentElement.lang);
  const view = () => page.evaluate(() => ({
    open: document.querySelector('.js-thanks').open, name: document.querySelector('#f-name').value,
    error: (() => { const e = document.querySelector('.js-form-error'); return e.hidden ? '' : e.textContent; })(),
    errorTel: !!document.querySelector('.js-form-error a[href="tel:+37129338444"]'),
    btn: document.querySelector('.btn-submit').textContent.trim(), disabled: document.querySelector('.btn-submit').disabled,
    focus: document.activeElement.className, note: !!document.querySelector('.js-thanks .form-note'),
  }));
  const fillAll = async () => {
    await page.fill('#f-name', 'Testa Viesis'); await page.fill('#f-tel', '+371 20000000');
    await page.fill('#f-email', 'viesis@example.com'); await page.fill('#f-guests', '60');
    await page.fill('#f-from', '2027-06-12'); await page.fill('#f-to', '2027-06-14');
    await page.fill('#f-msg', 'Rindas viens\nrindas divi'); await page.check('input[name=pirts]'); await page.check('input[name=zvanit_man]');
  };

  // 1. success, slowly enough to see the button while it waits
  answer = { status: 200, body: { ok: true, channels: { email: true, whatsapp: true } }, delay: 700 };
  await fillAll(); await page.click('.btn-submit'); await page.waitForTimeout(250);
  let v = await view();
  if (!v.disabled) failures.push('send: Nosutit is not disabled while sending');
  if (v.btn === 'Nosūtīt' || v.btn === 'Send') failures.push('send: the button does not say it is sending');
  await page.waitForTimeout(900);
  v = await view();
  if (!v.open) failures.push('send: a delivered enquiry did not open the thank-you');
  if (v.note) failures.push('send: the preview note is still in the thank-you');
  if (v.name) failures.push('send: the form was not cleared after a delivered enquiry');
  const want = { vards: 'Testa Viesis', talrunis: '+371 20000000', epasts: 'viesis@example.com', viesu_skaits: '60',
    datums_no: '2027-06-12', datums_lidz: '2027-06-14', komentars: 'Rindas viens\nrindas divi', valoda: lang, pirts: true, zvanit_man: true, vietne: '' };
  if (!sent) failures.push('send: nothing reached the endpoint');
  else {
    for (const [k, val] of Object.entries(want)) if (sent[k] !== val) failures.push(`send: ${k} was ${JSON.stringify(sent[k])}, expected ${JSON.stringify(val)}`);
    if ('kubuls' in sent) failures.push('send: an unticked extra was sent');
    if (!(typeof sent.t === 'number' && sent.t >= 0)) failures.push('send: no fill time t');
    if ('cf-turnstile-response' in sent) failures.push('send: a Turnstile token without a site key');
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // 2. the Worker refuses (every channel failed)
  answer = { status: 502, body: { ok: false, error: 'delivery' } };
  await fillAll(); await page.click('.btn-submit'); await page.waitForTimeout(500);
  v = await view();
  if (v.open) failures.push('refused: the thank-you opened although nothing was delivered');
  if (!v.error || !v.errorTel) failures.push('refused: no error line with the phone link');
  if (v.name !== 'Testa Viesis') failures.push('refused: what was typed is gone');
  if (v.disabled || !/btn-submit/.test(v.focus)) failures.push('refused: Nosutit is not back and focused');

  // 3. the connection drops
  answer = { abort: true };
  await page.click('.btn-submit'); await page.waitForTimeout(500);
  v = await view();
  if (v.open || !v.error) failures.push('offline: no error line, or the thank-you opened');

  // 4. a 200 that does not say ok (a proxy page, say) is not a success either
  answer = { status: 200, body: { hello: 1 } };
  await page.click('.btn-submit'); await page.waitForTimeout(500);
  v = await view();
  if (v.open) failures.push('not ok: a 200 without ok:true opened the thank-you');

  // 5. after an error, a good send clears the error line
  answer = { status: 200, body: { ok: true } };
  await page.click('.btn-submit'); await page.waitForTimeout(500);
  v = await view();
  if (!v.open) failures.push('retry: the second try did not open the thank-you');
  else { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  if ((await view()).error) failures.push('retry: the error line stayed after a good send');
  if (errors.length) failures.push('send: page errors ' + errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures.length ? 'FAIL: ' + failures.join('; ') : 'PASS: empty and bad e-mail refused and kept, no e-mail and 60 guests accepted, focus in and back; send: every field reaches the Worker, the thank-you only on delivery, error line on refusal or no network');
process.exit(failures.length ? 1 : 0);

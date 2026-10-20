// worker.test.mjs: the form Worker against a fake fetch, so nothing reaches Brevo, Meta or Cloudflare.
// Run: node --test form-worker/test/   (tools/gate.mjs runs it as "form-worker")
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { readEnquiry, whatsappParams, intlDigits, whatsappComponents } from '../src/index.js';

const ORIGIN = 'https://karumnieki.lv';
const ENV = {
  ALLOWED_ORIGINS: 'https://karumnieki.lv, http://localhost:8477',
  BREVO_API_KEY: 'brevo-test', TO_EMAIL: 'owner@example.com', FROM_EMAIL: 'forma@example.com',
  WHATSAPP_TOKEN: 'wa-test', WHATSAPP_PHONE_ID: '123', WHATSAPP_TO: '37129338444',
};
const GOOD = {
  vards: 'Anna Bērziņa', talrunis: '+371 20 000 000', epasts: 'anna@example.com', datums_no: '2027-06-12', datums_lidz: '2027-06-14',
  pasakuma_veids: 'Kāzas', viesu_skaits: '60', gultas_vietas: '30', komentars: 'Vai var\nar suni?', valoda: 'lv',
  pirts: true, kubuls: true, zvanit_man: true, vietne: '', t: 9000,
};

// a fake fetch: answers by URL and records every call
function fakeFetch(answers = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [part, status] of Object.entries(answers)) {
      if (String(url).includes(part)) {
        if (part.includes('siteverify')) return new Response(JSON.stringify({ success: status === 200 }), { status: 200 });
        if (typeof status === 'object') return new Response(JSON.stringify(status.body), { status: status.status });
        return new Response('{}', { status });
      }
    }
    return new Response('{}', { status: 201 });
  };
  return calls;
}
const post = (body, { origin = ORIGIN, raw } = {}) => new Request('https://form.example/', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
  body: raw !== undefined ? raw : JSON.stringify(body),
});
const json = async r => ({ status: r.status, body: await r.json(), acao: r.headers.get('Access-Control-Allow-Origin') });

test('CORS: the preflight is answered for the site only, a foreign origin is refused', async () => {
  const ok = await worker.fetch(new Request('https://form.example/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), ENV);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const bad = await worker.fetch(new Request('https://form.example/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), ENV);
  assert.equal(bad.status, 403);
  fakeFetch();
  const r = await json(await worker.fetch(post(GOOD, { origin: 'https://evil.example' }), ENV));
  assert.equal(r.status, 403);
  assert.equal(r.acao, null);
});

test('size, method and JSON are checked before anything is sent', async () => {
  const calls = fakeFetch();
  assert.equal((await worker.fetch(post(null, { raw: 'x'.repeat(20000) }), ENV)).status, 413);
  assert.equal((await worker.fetch(post(null, { raw: '{not json' }), ENV)).status, 400);
  assert.equal((await worker.fetch(post(null, { raw: '[1,2]' }), ENV)).status, 400);
  assert.equal((await worker.fetch(new Request('https://form.example/', { method: 'GET', headers: { Origin: ORIGIN } }), ENV)).status, 405);
  assert.equal(calls.length, 0);
});

test('a bot is told all went well and nothing is sent: honeypot filled, or sent too fast', async () => {
  const calls = fakeFetch();
  for (const body of [{ ...GOOD, vietne: 'http://spam.example' }, { ...GOOD, t: 800 }, { ...GOOD, t: undefined }]) {
    const r = await json(await worker.fetch(post(body), ENV));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  }
  assert.equal(calls.length, 0);
});

test('name and phone are required, e-mail is optional but must be an address, 60 guests is accepted', () => {
  assert.equal(readEnquiry({ ...GOOD, vards: '  ' }).error, 'vards');
  assert.equal(readEnquiry({ ...GOOD, talrunis: '12345' }).error, 'talrunis');
  assert.equal(readEnquiry({ ...GOOD, talrunis: 'call me' }).error, 'talrunis');
  assert.equal(readEnquiry({ ...GOOD, epasts: 'not-an-email' }).error, 'epasts');
  assert.equal(readEnquiry({ ...GOOD, epasts: '' }).error, undefined);
  assert.equal(readEnquiry({ ...GOOD, talrunis: '29-338-444' }).error, undefined);
  const d = readEnquiry(GOOD).data;
  assert.equal(d.viesu_skaits, '60');
  assert.deepEqual(d.papildus, ['pirts', 'kubuls']);
  assert.equal(readEnquiry({ ...GOOD, datums_no: '2027-13-45' }).data.datums_no, '');
  assert.equal(readEnquiry({ ...GOOD, vards: 'x'.repeat(500) }).data.vards.length, 120);
});

test('a wrong field answers 400 with the field name and sends nothing', async () => {
  const calls = fakeFetch();
  const r = await json(await worker.fetch(post({ ...GOOD, talrunis: '' }), ENV));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'talrunis');
  assert.equal(calls.length, 0);
});

test('both channels: the owner gets every field by e-mail (reply goes to the guest) and a WhatsApp template', async () => {
  const calls = fakeFetch();
  const r = await json(await worker.fetch(post(GOOD), ENV));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, channels: { email: true, whatsapp: true } });
  assert.ok(!JSON.stringify(r.body).includes('owner@example.com'), 'the owner address never goes back to the page');

  const mail = JSON.parse(calls.find(c => c.url.includes('brevo')).init.body);
  assert.equal(calls.find(c => c.url.includes('brevo')).init.headers['api-key'], 'brevo-test');
  assert.deepEqual(mail.to, [{ email: 'owner@example.com', name: 'Kārumnieki' }]);
  assert.deepEqual(mail.replyTo, { email: 'anna@example.com', name: 'Anna Bērziņa' });
  assert.equal(mail.subject, 'Pieprasījums: Anna Bērziņa, 12.06.2027 līdz 14.06.2027, 60 viesi');
  for (const line of ['Tālrunis: +371 20 000 000', 'Datumi: 12.06.2027 līdz 14.06.2027', 'Pasākuma veids: Kāzas', 'Viesu skaits: 60',
    'Gultas vietu skaits: 30', 'Papildus: Pirts, Kubuls', 'Labāk piezvaniet man: jā', 'Valoda: latviešu (atbildiet latviski)', 'Komentārs: Vai var\nar suni?']) {
    assert.ok(mail.textContent.includes(line), 'e-mail text has ' + line);
  }

  const wa = calls.find(c => c.url.includes('graph.facebook.com'));
  assert.equal(wa.url, 'https://graph.facebook.com/v26.0/123/messages');
  assert.equal(wa.init.headers.Authorization, 'Bearer wa-test');
  const msg = JSON.parse(wa.init.body);
  assert.equal(msg.to, '37129338444');
  assert.equal(msg.template.name, 'jauns_pieprasijums_v3');
  assert.equal(msg.template.language.code, 'lv');
  const params = msg.template.components[0].parameters.map(p => p.text);
  assert.deepEqual(params, ['Anna Bērziņa', '+371 20 000 000', 'anna@example.com', '12.06.2027', '14.06.2027', 'Kāzas', '60', '30',
    'Pirts, Kubuls', 'jā', 'Vai var / ar suni?']);
  for (const p of params) assert.ok(p && !/\n/.test(p), 'a WhatsApp variable is one non-empty line');
});

test('no e-mail typed: no reply-to; English page: the owner is told to answer in English', async () => {
  const calls = fakeFetch();
  await worker.fetch(post({ ...GOOD, epasts: '', valoda: 'en' }), ENV);
  const mail = JSON.parse(calls.find(c => c.url.includes('brevo')).init.body);
  assert.equal(mail.replyTo, undefined);
  assert.ok(mail.textContent.includes('Valoda: angļu (atbildiet angliski)'));
  assert.ok(mail.textContent.includes('E-pasts: nav norādīts'));
});

test('empty optional fields still give WhatsApp eleven non-empty variables', () => {
  const p = whatsappParams(readEnquiry({ vards: 'Jānis', talrunis: '29338444', t: 9000 }).data);
  assert.deepEqual(p, ['Jānis', '29338444', ...Array(7).fill('nav norādīts'), 'nē', 'nav norādīts']);
});

test('the e-mail HTML escapes what the guest typed', async () => {
  const calls = fakeFetch();
  await worker.fetch(post({ ...GOOD, vards: '<script>alert(1)</script>' }), ENV);
  const mail = JSON.parse(calls.find(c => c.url.includes('brevo')).init.body);
  assert.ok(!mail.htmlContent.includes('<script>'));
  assert.ok(mail.htmlContent.includes('&lt;script&gt;'));
});

test('one channel down: still a success, so the guest sees the thank-you; both down: 502', async () => {
  fakeFetch({ 'api.brevo.com': 500 });
  let r = await json(await worker.fetch(post(GOOD), ENV));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.channels, { email: false, whatsapp: true });
  fakeFetch({ 'api.brevo.com': 500, 'graph.facebook.com': 400 });
  r = await json(await worker.fetch(post(GOOD), ENV));
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
});

test('only e-mail configured (WhatsApp not set up yet) works; nothing configured answers 503', async () => {
  const calls = fakeFetch();
  const env = { ...ENV, WHATSAPP_TOKEN: '' };
  const r = await json(await worker.fetch(post(GOOD), env));
  assert.deepEqual(r.body, { ok: true, channels: { email: true } });
  assert.ok(!calls.some(c => c.url.includes('graph.facebook.com')));
  const none = await worker.fetch(post(GOOD), { ALLOWED_ORIGINS: ORIGIN });
  assert.equal(none.status, 503);
});

test('Turnstile: with a secret set, no token or a failed check is refused and nothing is sent', async () => {
  const env = { ...ENV, TURNSTILE_SECRET: 'ts-test' };
  let calls = fakeFetch({ siteverify: 200 });
  assert.equal((await worker.fetch(post(GOOD), env)).status, 403);
  assert.equal(calls.length, 0);
  calls = fakeFetch({ siteverify: 403 });
  assert.equal((await worker.fetch(post({ ...GOOD, 'cf-turnstile-response': 'bad' }), env)).status, 403);
  assert.ok(!calls.some(c => c.url.includes('brevo')));
  calls = fakeFetch({ siteverify: 200 });
  assert.equal((await worker.fetch(post({ ...GOOD, 'cf-turnstile-response': 'good' }), env)).status, 200);
  const verify = calls.find(c => c.url.includes('siteverify'));
  assert.equal(verify.init.body.get('secret'), 'ts-test');
  assert.equal(verify.init.body.get('remoteip'), '203.0.113.9');
});

test('the rate limit binding, when present, turns a flood away with 429', async () => {
  const calls = fakeFetch();
  const env = { ...ENV, RATE_LIMIT: { limit: async ({ key }) => ({ success: key !== '203.0.113.9' }) } };
  assert.equal((await worker.fetch(post(GOOD), env)).status, 429);
  assert.equal(calls.length, 0);
});

test('WhatsApp refused: the log gets Meta\'s error code, and with ALERT_EMAIL Servo gets a note without guest data', async () => {
  const refused = { status: 400, body: { error: { code: 131030, message: 'Recipient phone number +37129338444 not in allowed list' } } };
  let calls = fakeFetch({ 'graph.facebook.com': refused });
  const logs = [];
  const log = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let r;
  try { r = await json(await worker.fetch(post(GOOD), { ...ENV, ALERT_EMAIL: 'servo@example.com' })); } finally { console.log = log; }
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.channels, { email: true, whatsapp: false });
  assert.ok(logs.includes('failed: whatsapp 400 code 131030'));
  assert.ok(!logs.join('\n').includes('37129338444'), 'Meta\'s message text, which names the number, is not logged');
  const mails = calls.filter(c => c.url.includes('brevo')).map(c => JSON.parse(c.init.body));
  assert.equal(mails.length, 2);
  const alert = mails.find(m => m.to[0].email === 'servo@example.com');
  assert.equal(alert.subject, 'Kārumnieki forma: neizdevās whatsapp');
  assert.ok(alert.textContent.includes('whatsapp 400 code 131030'));
  for (const guest of ['Anna', 'Bērziņa', '20 000 000', 'anna@example.com', 'Kāzas']) {
    assert.ok(!JSON.stringify(alert).includes(guest), 'the alert carries no guest data: ' + guest);
  }

  calls = fakeFetch({ 'graph.facebook.com': refused });
  await worker.fetch(post(GOOD), ENV);
  assert.equal(calls.filter(c => c.url.includes('brevo')).length, 1, 'no ALERT_EMAIL, no note');
  calls = fakeFetch();
  await worker.fetch(post(GOOD), { ...ENV, ALERT_EMAIL: 'servo@example.com' });
  assert.equal(calls.filter(c => c.url.includes('brevo')).length, 1, 'all delivered, no note');
});

// the approved template jauns_pieprasijums_v3 (form-worker/README.md): the form's own labels, one line per field
const TEMPLATE = '*Jauns pieprasījums no karumnieki.lv*\n\nVārds, uzvārds: {{1}}\nTālrunis: {{2}}\nE-pasts: {{3}}\n' +
  'Datums no: {{4}}\nDatums līdz: {{5}}\nPasākuma veids: {{6}}\nViesu skaits: {{7}}\nGultas vietu skaits: {{8}}\n' +
  'Papildus: {{9}}\nLabāk piezvaniet man: {{10}}\nKomentārs: {{11}}\n\nTas pats pieprasījums ir arī e-pastā.';
const wa = raw => whatsappParams(readEnquiry({ vards: 'Anna', talrunis: '29338444', t: 9000, ...raw }).data);

test('WhatsApp carries only what the form asks, in the form\'s words: every extra as labelled, one date alone', () => {
  const all = { pirts: true, kubuls: true, edinasana: true, muzikanti: true, vaditajs: true, sporta_laukums: true };
  assert.equal(wa(all)[8], 'Pirts, Kubuls, Ēdināšana, Muzikanti, Pasākuma vadītājs, Sporta laukums');
  const p = wa({ datums_lidz: '2027-06-14', valoda: 'en' });
  assert.deepEqual([p[3], p[4]], ['nav norādīts', '14.06.2027']);
  assert.ok(!p.join(' ').includes('angl'), 'nothing the guest did not type, not even the page language');
});

test('WhatsApp: the longest enquiry stays under Meta\'s 1024, a long comment points to the e-mail', () => {
  const all = { pirts: true, kubuls: true, edinasana: true, muzikanti: true, vaditajs: true, sporta_laukums: true, zvanit_man: true };
  const p = wa({ vards: 'V'.repeat(200), talrunis: '+371 ' + '2'.repeat(35), epasts: 'e'.repeat(148) + '@example.com',
    datums_no: '2027-06-01', datums_lidz: '2027-08-30', viesu_skaits: '9999', gultas_vietas: '9999',
    pasakuma_veids: 'P'.repeat(300), komentars: 'K'.repeat(3000), ...all });
  assert.ok(p[10].endsWith('… (pilns teksts e-pastā)') && p[10].length === 320);
  assert.ok(p[2].endsWith('…') && p[2].length === 80);
  const text = TEMPLATE.replace(/\{\{(\d+)\}\}/g, (_, i) => p[i - 1]);
  assert.ok(text.length <= 1024, 'rendered ' + text.length);
  assert.equal(wa({ komentars: 'Īss' })[10], 'Īss');
});

test('buttons: the guest\'s phone as international digits, whatever way it was typed', () => {
  for (const [typed, want] of [['20 000 001', '37120000001'], ['+371 20 000 001', '37120000001'], ['0037120000001', '37120000001'],
    ['(+371) 20000001', '37120000001'], ['67 123 456', '37167123456'], ['+44 20 7946 0958', '442079460958'], ['+1 (555) 010-0199', '15550100199']]) {
    assert.equal(intlDigits(typed), want, typed);
  }
});

test('buttons: /w/<digits> goes to the guest\'s WhatsApp, /z/<digits> to a call; nothing else is redirected', async () => {
  const calls = fakeFetch();
  const w = await worker.fetch(new Request('https://form.example/w/37120000001'), ENV);
  assert.equal(w.status, 302);
  assert.equal(w.headers.get('Location'), 'https://wa.me/37120000001');
  const z = await worker.fetch(new Request('https://form.example/z/37120000001'), ENV);
  assert.equal(z.status, 200);
  const page = await z.text();
  assert.ok(page.includes('url=tel:+37120000001') && page.includes('href="tel:+37120000001"'));
  for (const bad of ['/w/123', '/w/37120000001x', '/w/https:%2F%2Fevil.example', '/x/37120000001', '/w/3712000000112345']) {
    const r = await worker.fetch(new Request('https://form.example' + bad), ENV);
    assert.notEqual(r.status, 302, bad);
    assert.equal(r.headers.get('Location'), null, bad);
  }
  assert.equal(calls.length, 0, 'a button tap sends nothing anywhere');
});

test('buttons: sent to Meta only when the template has them (WHATSAPP_BUTTONS), both with the guest\'s digits', async () => {
  const d = readEnquiry({ vards: 'Anna', talrunis: '20 000 001', t: 9000 }).data;
  assert.deepEqual(whatsappComponents(d, ENV).map(c => c.type), ['body']);
  const c = whatsappComponents(d, { ...ENV, WHATSAPP_BUTTONS: '1' });
  assert.deepEqual(c.slice(1), [
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '37120000001' }] },
    { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: '37120000001' }] },
  ]);
  const calls = fakeFetch();
  await worker.fetch(post(GOOD), { ...ENV, WHATSAPP_BUTTONS: '1' });
  const msg = JSON.parse(calls.find(x => x.url.includes('graph.facebook.com')).init.body);
  assert.equal(msg.template.components.length, 3);
});

test('reviews: /atsauksmes/lv and /en come from KV, readable only by the site\'s origins; none stored is a 404', async () => {
  const stored = { lv: '{"meta":{"rating":4.8,"count":210},"reviews":[]}' };
  const env = { ...ENV, ATSAUKSMES: { get: async key => stored[key] || null } };
  const get = (path, origin = ORIGIN) => worker.fetch(new Request('https://form.example' + path, { headers: { Origin: origin } }), env);
  const lv = await get('/atsauksmes/lv');
  assert.equal(lv.status, 200);
  assert.equal(await lv.text(), stored.lv);
  assert.equal(lv.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(lv.headers.get('Cache-Control'), /max-age=3600/);
  assert.equal((await get('/atsauksmes/lv', 'https://evil.example')).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await get('/atsauksmes/en')).status, 404);
  assert.equal((await worker.fetch(new Request('https://form.example/atsauksmes/lv'), ENV)).status, 404);   // no KV bound
  for (const bad of ['/atsauksmes/ru', '/atsauksmes/', '/atsauksmes/lv/x']) {
    assert.notEqual((await get(bad)).status, 200, bad);
  }
});

test('reviews: a guest photo comes from KV with its type and a week of cache; any other name is not looked up', async () => {
  const seen = [];
  const env = { ...ENV, ATSAUKSMES: { get: async () => null, getWithMetadata: async (key, type) => {
    seen.push(key);
    return key === 'foto/0123456789abcdef-s' && type === 'arrayBuffer' ? { value: new Uint8Array([255, 216, 255, 0]).buffer, metadata: { type: 'image/jpeg' } } : { value: null, metadata: null };
  } } };
  const get = path => worker.fetch(new Request('https://form.example' + path), env);
  const ok = await get('/atsauksmes/foto/0123456789abcdef-s');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/jpeg');
  assert.match(ok.headers.get('Cache-Control'), /max-age=604800/);
  assert.equal(new Uint8Array(await ok.arrayBuffer())[0], 255);
  assert.equal((await get('/atsauksmes/foto/0123456789abcdef-l')).status, 404);
  seen.length = 0;
  for (const bad of ['/atsauksmes/foto/../lv', '/atsauksmes/foto/0123456789ABCDEF-s', '/atsauksmes/foto/0123-s', '/atsauksmes/foto/0123456789abcdef-x', '/atsauksmes/foto/0123456789abcdef-s.jpg']) {
    assert.notEqual((await get(bad)).status, 200, bad);
  }
  assert.deepEqual(seen, []);
});

test('ingest: only with the secret; everything checked before anything is written; the expiry is the Worker\'s', async () => {
  const puts = [];
  const kv = {
    get: async () => null,
    put: async (key, value, opts) => { puts.push({ key, value, opts }); },
    list: async ({ prefix, cursor }) => cursor ? { keys: [{ name: 'foto/bbbbbbbbbbbbbbbb-l', expiration: 2 }], list_complete: true }
      : { keys: [{ name: 'foto/aaaaaaaaaaaaaaaa-s', expiration: 1 }], list_complete: false, cursor: 'c1' },
  };
  const env = { ...ENV, ATSAUKSMES: kv, INGEST_SECRET: 's3cret-0123456789' };
  const send = (body, auth = 'Bearer s3cret-0123456789', method = 'POST', path = '/atsauksmes/ingest') => worker.fetch(new Request('https://form.example' + path, {
    method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), env);
  const reviewsJson = JSON.stringify({ meta: { rating: 4.8, count: 210 }, reviews: [] });
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]).toString('base64');
  assert.equal((await worker.fetch(new Request('https://form.example/atsauksmes/ingest', { method: 'POST', body: '{}' }), { ...ENV, ATSAUKSMES: kv })).status, 503);
  assert.equal((await send({ items: [{ key: 'lv', value: reviewsJson }] }, 'Bearer wrong')).status, 401);
  assert.equal((await send({ items: [{ key: 'lv', value: reviewsJson }] }, 'Bearer s3cret-012345678')).status, 401);
  assert.equal(puts.length, 0);
  // one bad item: nothing at all is written
  for (const bad of [
    [{ key: 'lv', value: reviewsJson }, { key: 'foto/../x', value: jpeg, type: 'image/jpeg' }],
    [{ key: 'lv', value: reviewsJson }, { key: 'foto/aaaaaaaaaaaaaaaa-s', value: jpeg, type: 'text/html' }],
    [{ key: 'en', value: '{"meta":1}' }],
    [{ key: 'ru', value: reviewsJson }],
  ]) { assert.equal((await send({ items: bad })).status, 400, JSON.stringify(bad).slice(0, 80)); }
  assert.equal(puts.length, 0);
  const ok = await send({ items: [{ key: 'lv', value: reviewsJson }, { key: 'foto/aaaaaaaaaaaaaaaa-s', value: jpeg, type: 'image/jpeg', expirationTtl: 9e9 }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(puts.map(p => [p.key, p.opts.expirationTtl, p.opts.metadata && p.opts.metadata.type]), [['lv', 2592000, undefined], ['foto/aaaaaaaaaaaaaaaa-s', 2592000, 'image/jpeg']]);
  assert.equal(puts[1].value[0], 255);
  const list = await send(null, undefined, 'GET', '/atsauksmes/ingest?prefix=foto/');
  assert.deepEqual((await list.json()).keys, [{ name: 'foto/aaaaaaaaaaaaaaaa-s', expiration: 1 }, { name: 'foto/bbbbbbbbbbbbbbbb-l', expiration: 2 }]);
  assert.equal((await send(null, undefined, 'GET', '/atsauksmes/ingest?prefix=')).status, 400);
  assert.equal((await send(null, 'Bearer nope', 'GET', '/atsauksmes/ingest?prefix=foto/')).status, 401);
});

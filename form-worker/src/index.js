/* Kārumnieki enquiry form: a Cloudflare Worker that takes the form from karumnieki.lv as JSON, checks it, and passes
   it to the owner by e-mail (Brevo) and as a WhatsApp message (Meta WhatsApp Cloud API). It stores nothing and logs
   no personal data, only which channel worked.

   The page (site/js/site.js) posts: the form's own field names (vards, talrunis, epasts, datums_no, datums_lidz,
   pasakuma_veids, viesu_skaits, gultas_vietas, komentars, valoda), the ticked extras as true (pirts, kubuls,
   edinasana, muzikanti, vaditajs, sporta_laukums, zvanit_man), the honeypot "vietne" (empty for a person), "t" (ms
   between the form showing and the send) and the Turnstile token "cf-turnstile-response".

   Answers: 200 {ok:true} when at least one channel delivered (or when a bot is quietly dropped), 400 when a field is
   wrong, 403 for a failed spam check or a foreign origin, 413 for an oversized body, 429 when rate limited, 502 when
   every configured channel failed, 503 when no channel is configured. Settings: see form-worker/README.md. */

const TEXT = {
  vards: 'Vārds, uzvārds', talrunis: 'Tālrunis', epasts: 'E-pasts', datums: 'Datumi', pasakuma_veids: 'Pasākuma veids',
  viesu_skaits: 'Viesu skaits', gultas_vietas: 'Gultas vietu skaits', papildus: 'Papildus', zvanit_man: 'Labāk piezvaniet man',
  komentars: 'Komentārs', valoda: 'Valoda', nav: 'nav norādīts', ja: 'jā',
  lv: 'latviešu (atbildiet latviski)', en: 'angļu (atbildiet angliski)',
};
const EXTRAS = { pirts: 'Pirts', kubuls: 'Kubuls', edinasana: 'Ēdināšana', muzikanti: 'Muzikanti', vaditajs: 'Pasākuma vadītājs', sporta_laukums: 'Sporta laukums' };
const LIMIT = { vards: 120, talrunis: 40, epasts: 160, pasakuma_veids: 160, komentars: 2000 };
const MAX_BODY = 16384;
const MIN_FILL_MS = 2500;
const REVIEWS_TTL = 30 * 24 * 3600;   /* Google lets nobody keep its reviews or photos longer than 30 days */
const INGEST_MAX = 12 * 1024 * 1024;
const GRAPH_VERSION = 'v26.0';

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
  } : null;
}
function reply(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) } });
}

/* One line of text: control characters and runs of spaces go, the length is capped. */
function clean(v, max, multiline) {
  if (v === undefined || v === null) { return ''; }
  let s = String(v).normalize('NFC').replace(multiline ? /[^\S\n]+/g : /\s+/g, ' ');
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
  if (multiline) { s = s.replace(/\n{3,}/g, '\n\n'); }
  return s.slice(0, max);
}
function isoDate(v) {
  const s = clean(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : '';
}
function count(v) {
  const s = clean(v, 6);
  return /^\d{1,4}$/.test(s) ? String(Number(s)) : '';
}
function lvDate(iso) { return iso ? iso.split('-').reverse().join('.') : ''; }

/* The enquiry, checked: returns {data} or {error: field name}. */
export function readEnquiry(raw) {
  const d = {
    vards: clean(raw.vards, LIMIT.vards), talrunis: clean(raw.talrunis, LIMIT.talrunis), epasts: clean(raw.epasts, LIMIT.epasts),
    datums_no: isoDate(raw.datums_no), datums_lidz: isoDate(raw.datums_lidz), pasakuma_veids: clean(raw.pasakuma_veids, LIMIT.pasakuma_veids),
    viesu_skaits: count(raw.viesu_skaits), gultas_vietas: count(raw.gultas_vietas), komentars: clean(raw.komentars, LIMIT.komentars, true),
    valoda: raw.valoda === 'en' ? 'en' : 'lv', zvanit_man: raw.zvanit_man === true,
    papildus: Object.keys(EXTRAS).filter(k => raw[k] === true),
  };
  if (!d.vards) { return { error: 'vards' }; }
  if ((d.talrunis.match(/\d/g) || []).length < 7 || /[^\d\s+()./-]/.test(d.talrunis)) { return { error: 'talrunis' }; }
  if (d.epasts && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.epasts)) { return { error: 'epasts' }; }
  return { data: d };
}

function dates(d) {
  if (d.datums_no && d.datums_lidz && d.datums_lidz !== d.datums_no) { return lvDate(d.datums_no) + ' līdz ' + lvDate(d.datums_lidz); }
  return lvDate(d.datums_no || d.datums_lidz);
}
function rows(d) {
  return [
    [TEXT.vards, d.vards], [TEXT.talrunis, d.talrunis], [TEXT.epasts, d.epasts || TEXT.nav], [TEXT.datums, dates(d) || TEXT.nav],
    [TEXT.pasakuma_veids, d.pasakuma_veids || TEXT.nav], [TEXT.viesu_skaits, d.viesu_skaits || TEXT.nav],
    [TEXT.gultas_vietas, d.gultas_vietas || TEXT.nav], [TEXT.papildus, d.papildus.map(k => EXTRAS[k]).join(', ') || TEXT.nav],
    [TEXT.zvanit_man, d.zvanit_man ? TEXT.ja : 'nē'], [TEXT.valoda, TEXT[d.valoda]], [TEXT.komentars, d.komentars || TEXT.nav],
  ];
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function emailMessage(d, env) {
  const subject = 'Pieprasījums: ' + d.vards + (dates(d) ? ', ' + dates(d) : '') + (d.viesu_skaits ? ', ' + d.viesu_skaits + ' viesi' : '');
  const list = rows(d);
  const text = 'Jauns pieprasījums no karumnieki.lv\n\n' + list.map(([k, v]) => k + ': ' + v).join('\n') + '\n';
  const html = '<p>Jauns pieprasījums no karumnieki.lv</p><table cellpadding="6" style="border-collapse:collapse">' +
    list.map(([k, v]) => '<tr><th align="left" valign="top">' + esc(k) + '</th><td>' + esc(v).replace(/\n/g, '<br>') + '</td></tr>').join('') + '</table>';
  const msg = {
    sender: { name: 'Kārumnieki vietne', email: env.FROM_EMAIL }, to: [{ email: env.TO_EMAIL, name: 'Kārumnieki' }],
    subject, textContent: text, htmlContent: html,
  };
  if (d.epasts) { msg.replyTo = { email: d.epasts, name: d.vards }; }
  return msg;
}

/* The WhatsApp template's eleven body variables, one per form field with the form's own labels in the template
   (README has the text); nothing the guest did not type is added. Meta refuses empty variables and new lines inside
   one, so each is one line with a fallback; a long comment is cut and points to the e-mail, so the whole message
   stays under Meta's 1024. */
export function whatsappParams(d) {
  const one = (s, max, more) => {
    let t = clean(String(s).replace(/\n+/g, ' / '), 4000);
    if (t.length > max) { t = t.slice(0, max - (more || '…').length).trimEnd() + (more || '…'); }
    return t || TEXT.nav;
  };
  return [
    one(d.vards, 100), one(d.talrunis, 40), one(d.epasts, 80), one(lvDate(d.datums_no), 10), one(lvDate(d.datums_lidz), 10),
    one(d.pasakuma_veids, 120), one(d.viesu_skaits, 6), one(d.gultas_vietas, 6), one(d.papildus.map(k => EXTRAS[k]).join(', '), 100),
    d.zvanit_man ? TEXT.ja : 'nē', one(d.komentars, 320, '… (pilns teksts e-pastā)'),
  ];
}

/* The guest's phone as international digits, for the two buttons (wa.me and tel: take no spaces). A Latvian number
   typed without the country code (8 digits from 2 or 6) gets 371; 00 in front means the same as a plus. */
export function intlDigits(phone) {
  const s = String(phone).trim();
  let n = s.replace(/\D/g, '');
  if (!s.startsWith('+') && n.startsWith('00')) { n = n.slice(2); } else if (!s.startsWith('+') && /^[26]\d{7}$/.test(n)) { n = '371' + n; }
  return n;
}

/* The buttons' targets (template URL buttons https://<this Worker>/w/{{1}} and /z/{{1}}): Meta refuses links to
   WhatsApp in a button, so the button opens this address and it sends the owner on. Digits only, so it can lead
   nowhere but a chat or a call; nothing is logged or kept. */
function buttonTarget(kind, n) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
  if (kind === 'w') { return new Response(null, { status: 302, headers: { ...headers, Location: 'https://wa.me/' + n } }); }
  const tel = 'tel:+' + n;
  return new Response('<!doctype html><html lang="lv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Zvanīt</title><meta http-equiv="refresh" content="0;url=' + tel + '">' +
    '<p style="font:22px system-ui,sans-serif;text-align:center;margin-top:35vh"><a href="' + tel + '">Zvanīt +' + n + '</a></p></html>',
    { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

/* The Google reviews the Atsauksmes block shows. A nightly job outside this repo reads
   them from the Business Profile API and puts one JSON per language into KV with a 30 day expiry, which
   is as long as Google lets anyone keep them; so the visitor's browser asks this Worker, never Google. No value (the
   script stopped, or KV is not bound): 404, and the page keeps its own three quotes. */
async function reviews(lang, request, env) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex',
    ...(cors(request.headers.get('Origin'), env) || {}),
  };
  const body = env.ATSAUKSMES ? await env.ATSAUKSMES.get(lang) : null;
  if (!body) { return new Response(JSON.stringify({ ok: false, error: 'none' }), { status: 404, headers: { ...headers, 'Cache-Control': 'no-store' } }); }
  return new Response(body, { headers });
}
/* The guests' photos under those reviews, kept in the same KV by the same script (foto/<id>-s a thumbnail, -l the
   viewer's size) with the same 30 day expiry; the page shows them from here, never from Google. */
async function reviewPhoto(key, env) {
  const hit = env.ATSAUKSMES ? await env.ATSAUKSMES.getWithMetadata(key, 'arrayBuffer') : null;
  if (!hit || !hit.value) { return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
  const type = hit.metadata && /^image\/(jpeg|webp|png)$/.test(hit.metadata.type) ? hit.metadata.type : 'image/jpeg';
  return new Response(hit.value, { headers: {
    'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Robots-Tag': 'noindex',
  } });
}

/* The way in for that data (POST /atsauksmes/ingest), used by that nightly job:
   Bearer INGEST_SECRET, a list of items, each "lv", "en" (the reviews JSON) or "foto/<id>-s|l"
   (a photo, base64, with its type). Everything is checked before anything is written, and the expiry is set here,
   not by the caller. GET with ?prefix=foto/ lists the photos and when each expires, so the job sends only the new
   ones and those about to lapse. Without INGEST_SECRET the door is shut (503). */
function sameSecret(given, secret) {
  if (typeof given !== 'string' || typeof secret !== 'string' || !secret) { return false; }
  let d = given.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) { d |= given.charCodeAt(i % (given.length || 1)) ^ secret.charCodeAt(i); }
  return d === 0;
}
async function ingest(request, env, url) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.INGEST_SECRET || !env.ATSAUKSMES) { return json(503, { ok: false, error: 'not_configured' }); }
  if (!sameSecret((request.headers.get('Authorization') || '').replace(/^Bearer /, ''), env.INGEST_SECRET)) { return json(401, { ok: false, error: 'auth' }); }
  if (request.method === 'GET') {
    if (url.searchParams.get('prefix') !== 'foto/') { return json(400, { ok: false, error: 'prefix' }); }
    const keys = [];
    let cursor;
    do {
      const r = await env.ATSAUKSMES.list({ prefix: 'foto/', cursor });
      r.keys.forEach(k => keys.push({ name: k.name, expiration: k.expiration || null }));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor);
    return json(200, { ok: true, keys });
  }
  if (request.method !== 'POST') { return json(405, { ok: false, error: 'method' }); }
  if (Number(request.headers.get('Content-Length') || 0) > INGEST_MAX) { return json(413, { ok: false, error: 'size' }); }
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { ok: false, error: 'json' }); }
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length || items.length > 40) { return json(400, { ok: false, error: 'items' }); }
  const writes = [];
  for (const it of items) {
    if (!it || typeof it.key !== 'string' || typeof it.value !== 'string') { return json(400, { ok: false, error: 'item' }); }
    if (it.key === 'lv' || it.key === 'en') {
      let d = null;
      try { d = JSON.parse(it.value); } catch (e) { d = null; }
      if (!d || !d.meta || !Array.isArray(d.reviews) || it.value.length > 1000000) { return json(400, { ok: false, error: 'reviews ' + it.key }); }
      writes.push([it.key, it.value, {}]);
    } else if (/^foto\/[0-9a-f]{16}-[sl]$/.test(it.key)) {
      if (!/^image\/(jpeg|webp|png)$/.test(it.type || '')) { return json(400, { ok: false, error: 'type ' + it.key }); }
      let bytes = null;
      try { bytes = Uint8Array.from(atob(it.value), c => c.charCodeAt(0)); } catch (e) { bytes = null; }
      if (!bytes || bytes.length < 8 || bytes.length > 3000000) { return json(400, { ok: false, error: 'photo ' + it.key }); }
      writes.push([it.key, bytes, { metadata: { type: it.type } }]);
    } else {
      return json(400, { ok: false, error: 'key' });
    }
  }
  for (const [key, value, opts] of writes) { await env.ATSAUKSMES.put(key, value, { expirationTtl: REVIEWS_TTL, ...opts }); }
  return json(200, { ok: true, written: writes.length });
}

async function sendEmail(d, env) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(emailMessage(d, env)),
  });
  if (!r.ok) { throw new Error('brevo ' + r.status); }
}
/* The template's body, plus the two buttons (Rakstīt, Zvanīt) when the template has them: WHATSAPP_BUTTONS set. */
export function whatsappComponents(d, env) {
  const c = [{ type: 'body', parameters: whatsappParams(d).map(text => ({ type: 'text', text })) }];
  if (env.WHATSAPP_BUTTONS) {
    const n = intlDigits(d.talrunis);
    ['0', '1'].forEach(index => c.push({ type: 'button', sub_type: 'url', index, parameters: [{ type: 'text', text: n }] }));
  }
  return c;
}
async function sendWhatsApp(d, env) {
  const r = await fetch('https://graph.facebook.com/' + (env.GRAPH_VERSION || GRAPH_VERSION) + '/' + env.WHATSAPP_PHONE_ID + '/messages', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: env.WHATSAPP_TO, type: 'template',
      template: { name: env.WHATSAPP_TEMPLATE || 'jauns_pieprasijums_v3', language: { code: env.WHATSAPP_LANG || 'lv' },
        components: whatsappComponents(d, env) },
    }),
  });
  if (!r.ok) {
    /* Meta's error code (131030, 132001, 190...) says what broke; the message text is not logged, it can name the number */
    const e = await r.json().catch(() => ({}));
    throw new Error('whatsapp ' + r.status + (e.error && e.error.code ? ' code ' + e.error.code : ''));
  }
}
/* A channel failed but e-mail works: a short note to the maintainers with no guest data, so a dead WhatsApp route (Meta's test
   number switched off, a revoked token) does not go unnoticed. On only when ALERT_EMAIL is set. */
async function sendAlert(failed, env) {
  const text = 'Pieprasījums no karumnieki.lv tika piegādāts, bet šis kanāls neizdevās: ' + failed.join('; ') +
    '.\nViesa dati šajā vēstulē nav. Cloudflare žurnālā ir tas pats.\n';
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Kārumnieki vietne', email: env.FROM_EMAIL }, to: [{ email: env.ALERT_EMAIL }],
      subject: 'Kārumnieki forma: neizdevās ' + failed.map(f => f.split(' ')[0]).join(', '), textContent: text,
    }),
  });
  if (!r.ok) { throw new Error('alert ' + r.status); }
}
async function turnstileOk(token, ip, env) {
  if (!token) { return false; }
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token).slice(0, 2048));
  if (ip) { form.append('remoteip', ip); }
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/atsauksmes/ingest') { return ingest(request, env, url); }
    const go = request.method === 'GET' && url.pathname.match(/^\/([wz])\/(\d{8,15})$/);
    if (go) { return buttonTarget(go[1], go[2]); }
    const rv = request.method === 'GET' && new URL(request.url).pathname.match(/^\/atsauksmes\/(lv|en)$/);
    if (rv) { return reviews(rv[1], request, env); }
    const ph = request.method === 'GET' && new URL(request.url).pathname.match(/^\/atsauksmes\/foto\/([0-9a-f]{16}-[sl])$/);
    if (ph) { return reviewPhoto('foto/' + ph[1], env); }
    const h = cors(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') { return h ? new Response(null, { status: 204, headers: h }) : new Response(null, { status: 403 }); }
    if (!h) { return reply(403, { ok: false, error: 'origin' }); }
    if (request.method !== 'POST') { return reply(405, { ok: false, error: 'method' }, h); }
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) { return reply(413, { ok: false, error: 'size' }, h); }
    const body = await request.text();
    if (body.length > MAX_BODY) { return reply(413, { ok: false, error: 'size' }, h); }
    let raw;
    try { raw = JSON.parse(body); } catch (e) { return reply(400, { ok: false, error: 'json' }, h); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return reply(400, { ok: false, error: 'json' }, h); }

    /* a bot: it filled the hidden field or sent the form faster than a person can; it is told all went well */
    if (clean(raw.vietne, 200) || !(Number(raw.t) >= MIN_FILL_MS)) { console.log('dropped: honeypot or too fast'); return reply(200, { ok: true }, h); }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (env.RATE_LIMIT && ip) {
      const { success } = await env.RATE_LIMIT.limit({ key: ip });
      if (!success) { return reply(429, { ok: false, error: 'rate' }, h); }
    }
    if (env.TURNSTILE_SECRET && !(await turnstileOk(raw['cf-turnstile-response'], ip, env))) { return reply(403, { ok: false, error: 'spam' }, h); }

    const { data, error } = readEnquiry(raw);
    if (error) { return reply(400, { ok: false, error }, h); }

    const jobs = [];
    if (env.BREVO_API_KEY && env.TO_EMAIL && env.FROM_EMAIL) { jobs.push(['email', sendEmail(data, env)]); }
    if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_TO) { jobs.push(['whatsapp', sendWhatsApp(data, env)]); }
    if (!jobs.length) { return reply(503, { ok: false, error: 'not_configured' }, h); }
    const done = await Promise.allSettled(jobs.map(j => j[1]));
    const channels = {};
    const failed = [];
    done.forEach((r, i) => {
      channels[jobs[i][0]] = r.status === 'fulfilled';
      if (r.status === 'rejected') { failed.push(String(r.reason && r.reason.message)); console.log('failed:', failed[failed.length - 1]); }
    });
    console.log('sent:', JSON.stringify(channels));
    if (failed.length && channels.email && env.ALERT_EMAIL) {
      try { await sendAlert(failed, env); } catch (e) { console.log('failed:', String(e.message)); }
    }
    return Object.values(channels).some(Boolean) ? reply(200, { ok: true, channels }, h) : reply(502, { ok: false, error: 'delivery', channels }, h);
  },
};

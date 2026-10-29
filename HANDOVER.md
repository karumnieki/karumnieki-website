# Kārumnieki website: handover

For whoever works on this site, and for the AI assistant they work with. Read this first.

## 1. What this is

The website of viesu nams "Kārumnieki", an event venue and guest house for up to 45 guests near Sigulda (Kalnabeites,
Siguldas pagasts), live at https://karumnieki.lv/ since 2026-10-15. It has one job: make a visitor on a phone call,
write on WhatsApp, or send an enquiry. There is no booking calendar and there are no prices, on purpose (the owner's
decisions).

One page with 11 sections, in Latvian at `site/` and in English at `site/en/`, plus a privacy policy and a cookie
policy in both languages. Plain HTML, CSS and one small script: no framework, no server code. Fonts and photos are
self-hosted inside `site/`. The live files are built from `site/` by `tools/build.py` (section 4).

## 2. Run it and test it

Needs Node 20 or newer and Python 3.

```
git clone https://github.com/karumnieki/karumnieki-website.git
cd karumnieki-website
npm ci
npx playwright install chromium
python3 tools/serve.py 8477          (on Windows: python tools\serve.py 8477)
```

Then open http://localhost:8477/site/ (Latvian) and http://localhost:8477/site/en/ (English). `serve.py` serves the
repo root with caching off and listens on every network interface, so a phone on the same Wi-Fi can open
`http://<your LAN IP>:8477/site/`.

**Tests: `npm test`.** One command runs everything on both pages and prints PASS or FAIL per check; it exits 1 if
anything failed, and logs and screenshots land in `out/gate/`. It starts its own server on port 8478, so a preview
on 8477 can stay open. Run it after every change. What it checks:

| Check | What it proves |
|---|---|
| `lint.py` (with `parity.py`) | no long dashes, `lang` set, every image has alt, width, height and an existing file, Lora only for the quoted lines, no prices, the English page matches the Latvian one (section 6), and every `data-edit` marker has its row in `tools/editable.json` (section 7) |
| `test_check_edit.py` | every rule of `check_edit.py` refuses its bad change and a valid edit passes (section 7) |
| `shoot.mjs` | screenshots at 390, 768, 1024 and 1440; no sideways scroll, no console errors, no broken requests, nothing running off screen, the phone link and the hero buttons on the first screen, the sticky call bar after a scroll on a phone; it prints each page's height |
| `lb-test.mjs` | the gallery lightbox at 1440 and 390, including the crop floors some photos must keep (`tools/slots.json`) |
| `focus-pass.mjs` | every control reachable with Tab, with a visible focus ring, at 1440, 1024 and 390 |
| `lang-test.mjs` | the LV / EN switch, the header at 11 widths, every section landing in both directions |
| `form-fit.mjs` | the form: name and phone required, e-mail optional but valid when typed, 60 guests accepted, the thank-you dialog and its focus; the send against a fake Worker (every field arrives, the thank-you only on delivery, an error line on refusal or no network) |
| `font-swap.mjs` | the page does not jump when the web fonts arrive late |
| `tag-test.mjs` | Google Tag Manager is never fetched without a yes to analytics; with a yes it loads once, after the Consent Mode defaults, and the four events reach the dataLayer with `page_language` and `link_location` |
| `reviews-test.mjs` | the Atsauksmes block follows the reviews feed (a fixture here) and keeps its own quotes when that fails |
| `form-worker` | the enquiry Worker against a fake fetch (node:test): CORS, size, honeypot, fill time, fields, the e-mail and WhatsApp messages, one channel down, Turnstile, rate limit |
| `consent-test.mjs` | the banner on a first visit at 390, 768 and 1440 (equal buttons, policy link, the hero's call buttons and the call bar uncovered, no request to Google while scrolling the page), no, yes, Sīkdatņu iestatījumi, deleting `_ga` cookies, an expired choice, the click-to-load map, and every policy page the home page links to |

Every browser check except `shoot.mjs` and `consent-test.mjs` runs as a visitor who has already said no to cookies
(`tools/visitor.mjs`), so the banner never covers what they click.

Every tool starts Chromium with `--font-render-hinting=none`. Without it, Chromium on Linux rounds each glyph's width
to a whole pixel, lines wrap differently from Windows and macOS on a phone-width page, and the page heights, the
banner check and the font-swap check drift. With it, Linux gives the same page heights as Windows (checked on
2026-10-20 at all four widths, both languages).

`npm run test:online` adds `links-test.mjs`, which opens every outbound link (Google reviews, Facebook, Maps, Waze,
WhatsApp) and checks it lands where it says. It needs the internet, and those sites change their pages, so read a
FAIL by hand before editing anything. `npm run test:perf` adds a Lighthouse report.

`.github/workflows/gate.yml` runs `npm test` on a GitHub Ubuntu runner, by hand (Actions, gate, Run workflow). It
installs Arial and Georgia first (`ttf-mscorefonts-installer`), because the size-matched fallback fonts in
`site/css/fonts.css` are drawn from them and stock Ubuntu has neither. The runner is pinned to `ubuntu-24.04`:
`ubuntu-latest` became 26.04 in October 2026, where Playwright 1.59.1 cannot install Chromium. Moving on means a
newer Playwright and the page heights measured again on Windows and Linux.

## 3. How the site works

- **Enquiry form.** Field names are Latvian on both pages: `vards`, `talrunis`, `epasts`, `datums_no`,
  `datums_lidz`, `pasakuma_veids`, `viesu_skaits`, `gultas_vietas`, the checkboxes `pirts`, `kubuls`, `edinasana`,
  `muzikanti`, `vaditajs`, `sporta_laukums`, `zvanit_man` (call me back), `komentars`, and the hidden `valoda` (`lv`
  or `en`, so the owner answers in the visitor's language). Name and phone are required; e-mail is optional. The guest
  count is not capped on purpose: an enquiry for 60 is still a lead. `site/js/site.js` posts the form to the form
  Worker (`form-worker/`, a Cloudflare Worker; its README has the setup), which sends it to the owner by e-mail through
  Brevo and as a WhatsApp message through the Meta Cloud API. The thank-you opens only when at least one channel
  delivered; otherwise an error line shows the phone number and keeps what was typed. Turnstile loads only when the
  visitor reaches the form.
- **Cookie banner and analytics.** Google Tag Manager (`GTM-K3334MP7`) loads only after a yes to analytics; Consent
  Mode defaults are all denied and only `analytics_storage` is ever granted. The site pushes `phone_click`,
  `whatsapp_click`, `share` (content_type map) and `generate_lead` to the dataLayer, each with `page_language` and
  `link_location`. The choice is stored in localStorage (`karumnieki-consent`, 180 days, `CONSENT_DAYS` in
  `site.js`); Sīkdatņu iestatījumi in the footer reopens it, and a no after a yes deletes the `_ga` cookies. Below
  900px the banner sits at the foot of the screen, above the sticky call bar once that shows; from 900px it is a bar
  across the foot of the screen.
- **Map.** A still OpenStreetMap picture from our own server shows at once (`img/karte-800.webp`, `img/karte-560.webp`
  for phones, with the © OpenStreetMap credit the licence asks for). Google's embed loads only on Rādīt Google karti
  (`.js-map`, address in `data-src`), because loading it sends the visitor's IP address to Google.
- **Reviews.** The Atsauksmes block follows Google: a nightly job outside this repo reads the reviews from the
  Business Profile API and posts them to the Worker (`POST /atsauksmes/ingest`, Bearer `INGEST_SECRET`), which keeps
  them in KV with a 30 day expiry and serves them at `GET /atsauksmes/lv`, `/en` and `/foto/<id>-s|l`. `site.js`
  (`REVIEWS_ENDPOINT`) reads them once the block comes within a screen or so of view. Nothing is loaded from Google
  in the browser. Empty `REVIEWS_ENDPOINT`, an error or odd data: the page keeps its own quotes and numbers. If the
  feed stops, the data lapses in 30 days and the page falls back to its own quotes.
- **Policies.** `site/privatuma-politika/`, `site/sikdatnu-politika/`, `site/en/privacy-policy/`,
  `site/en/cookie-policy/`, linked from the footer, the banner and a line under the form. They name the services that
  see visitor data (Cloudflare and Turnstile, Brevo, WhatsApp, Google). If the form or analytics route changes, change
  those paragraphs in both languages in the same edit.

## 4. Build and upload

**The live files are built, never edited by hand.** `site/` stays the source, so the checks run on it.
`python3 tools/build.py` writes the live site to `out/dist/site/`:
- every comment out of the HTML, CSS and JS;
- the `noindex` meta out of all six pages; the thank-you dialog's preview line out; the `data-edit` markers out
  (section 7);
- `og:image` absolute and `og:url` added; `robots.txt` and `sitemap.xml` (six pages, hreflang) at the root;
- `.htaccess`: http and www to `https://karumnieki.lv` (301), the old `/phone/` home, `/.well-known/` left alone;
- `FORM_ENDPOINT`, `TURNSTILE_SITEKEY` and `REVIEWS_ENDPOINT` set (`LIVE` at the top of `tools/build.py`);
- `?v=<hash>` on the links to `site.css`, `fonts.css` and `site.js`: the host caches them for 30 days, so without it
  a returning visitor would get new pages with old CSS. The hash is taken from those three source files, so a
  comment change in them changes it too. Tests that intercept site.js match `**/js/site.js*`.

Before every upload: `python3 tools/build.py --check` (builds both and proves the live build differs from the test
build in those three addresses only), then `node tools/gate.mjs --root=out/dist-test` (every browser check on the
built pages). The host is nano.lv (cPanel, Apache, HTTPS by AutoSSL). Today the contents of `out/dist/site/` are
uploaded to the web root by hand; leave the folders that are not ours (the old site's dated folder, `.well-known/`)
and the DNS and mail records alone. An automatic build, test and upload is planned.

By hand still: `site.webmanifest` is Latvian only. Now and then run `npm run test:online` (it fails when Google or
Facebook show different rating numbers than the page).

## 5. Rules

### 5.1 The owner's decisions: they change only with his yes
- No booking calendar, no prices anywhere on the site.
- Capacity 45. 50 minutes from Rīga, 4 km from Sigulda.
- Phone +371 29338444. Another number in some directories is stale.
- His own words: the Par mums text, the headings he wrote, the thank-you dialog's lines.
- The reviews quoted on the page (the lead quote stays as he approved it); guests may swim in the pond and use the
  grill; bed linen is provided.
- No partners row.

### 5.2 Rules for this site
- **Real photos only.** A photo may lose temporary things (clutter, cars) and be graded, but nothing permanent is
  invented: no new windows, walls or views, no AI seasons, no AI aerial shot. A new or different photo goes through a
  maintainer; the photo masters (`photos/`) are not in this repo.
- **No fake reviews, no placeholder text, no invented numbers.**
- Latvian with its diacritics; **no em or en dashes anywhere** (lint fails on them in `site/`): copy, code comments,
  files. Use a plain hyphen or rephrase.
- Mobile first: Zvanīt and WhatsApp on the first screen of a 390px phone, and the sticky call bar after a scroll.

### 5.3 Design and build choices (change them with a reason)
- Two static pages kept in step by `parity.py`, not a template (plainer to work in). Section ids stay Latvian on both.
- The header shows its row of menu links from 1280px and a menu button below that.
- A still hero: no video, no motion.
- No font preload (it cost LCP); size-matched fallback fonts instead, so the page does not jump when the fonts load.
- Every photo has smaller copies, and each `sizes` is the width it is actually drawn at.
- The English is British English; quoted reviews are marked as translated.

## 6. Keeping the two languages in step
- Make every change in `site/index.html` and `site/en/index.html` in the same edit, then `npm test`. The same goes for
  the policy pages and their English twins: `parity.py` checks all three pairs (`PAIRS`), and reads a link from an
  English page to an English page as its Latvian twin's (`TWIN`).
- `tools/parity.py` (run by `lint.py`) fails when the pages differ in tags, ids, classes, images, links, crops, tile
  order or numbers, when the English page has Latvian letters or untranslated text, or when the `STRINGS` keys in
  `site.js` differ. `python3 tools/parity.py --sheet out/pairs.html` writes every text pair side by side.
- Strings the script writes are in `STRINGS` at the top of `site/js/site.js`. Both pages carry the hreflang trio
  (lv, en, x-default = the Latvian root) and a self canonical.

## 7. Texts the owner may edit

The owner changes his own words through an AI assistant, and a check refuses anything else. Three parts:

- **Markers.** 70 texts carry `data-edit="<section>.<n>"` (the section id, then the place in page order) on the
  same element in `site/index.html` and `site/en/index.html`: the section headings and prose, the bear lines, the
  photo captions, the gallery captions (the tile's `data-caption`), the thank-you dialog. The marker is always the
  last attribute of its start tag, and `build.py` removes it, so the live HTML is the same as without it. A text
  with bold or line breaks inside is one marker; its tags stay as they are and only the words change. Everything
  else is locked: the head, the menu, buttons, the form, the cookie banner, the policies, contacts and links, the
  reviews block, images and alt texts, the hero facts line and the small labels above the headings.
- **`tools/editable.json`.** One row per marker: a Latvian `label` the owner reads, `lv_max` and `en_max`
  (characters: 1.3 times the text of 2026-10-29, at least 10 more), `attr: "data-caption"` for a gallery caption,
  `fixed_numbers: true` where the numbers may not change (the capacity, in the Svinības heading and first
  paragraph). The hero heading is capped at 50 / 59 characters: at 390x844 the hero buttons clear the cookie banner
  by about 3 px, and in 120 trial headings made of the page's own words nothing shorter pushed them under it (in
  English 2 of the 120 already wrap to a fourth line at 58 and 59 characters; the gate catches those).
- **`tools/check_edit.py`** (Python standard library only). `python3 tools/check_edit.py` compares the working tree
  with `main`; `--head <commit>` checks a commit through git alone, without checking it out; `--base` sets another
  base. It refuses any other file; any change outside the marked texts; markup, or a straight quote in a caption;
  web and e-mail addresses and phone numbers; long dashes; the euro sign or eur, euro, eiro; a text over its cap or
  empty; invisible characters; the Latvian text changed without the English or the reverse; Latvian letters in
  the English text; English the same as Latvian; numbers that differ between the two, or that changed in a
  `fixed_numbers` text; and with `--head`, a commit not built on the base as it is now. One plain Latvian line per
  refusal; exit 0 passes, 1 refuses, 2 could not run. The rows always come from the `editable.json` beside the
  script.

When you change the pages, a marked element keeps its marker. A new text the owner should edit gets a marker on
both pages and a row; a removed one loses its row; lint fails until the two agree. `tools/test_check_edit.py` tests
every rule on its own small pages, so it does not depend on the live wording.

## 8. The repo

```
HANDOVER.md        this file
CLAUDE.md          loads this file and AGENTS.md for Claude Code
AGENTS.md          working rules for an AI assistant in this repo
site/              the website: index.html (LV), en/index.html (EN), the policy pages, css/, js/site.js, fonts/, img/
tools/             the tests (section 2), build.py, serve.py, slots.json (which photo fills which slot),
                   editable.json and check_edit.py (section 7), photo tools
form-worker/       the enquiry and reviews Worker (Cloudflare), its tests and its README
package.json       Playwright and Lighthouse for the tests
requirements.txt   Pillow and numpy, only for the photo tools
```

- The photo tools (`sync-assets.py`, `smaller-files.py`, `make-icons.py`, `logo-wordmark.*`) need `photos/` beside
  `site/` and stop with a message without it. `site/img/` already holds every file the page uses. After a photo
  change, `img-fit.mjs --compare` checks nothing got less sharp.
- Known and small: at about 1024px wide the browser sometimes starts the 600px gallery files and then cancels them
  for larger ones (`net::ERR_ABORTED`). It does not change the look; it costs some bytes on that width.
- Do not run `tools/fetch-fonts.py`: it rewrites `site/css/fonts.css` and would erase the fallback faces.
- Secrets never go into this repo: the Worker's secrets live in Cloudflare (`npx wrangler secret put`), and the KV
  namespace id stays a placeholder in `form-worker/wrangler.toml` (its comment says why).

## 9. Who to ask
The maintainers of this repo: for content, design, photos, anything that goes to the owner, and anything that leaves
this folder or cannot be undone (deploying, DNS, accounts, messages).

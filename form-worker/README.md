# The enquiry form Worker

A Cloudflare Worker that takes the Pieprasījums form from karumnieki.lv and passes it to the owner twice: by e-mail
(Brevo) to the owner's mailbox and as a WhatsApp message (Meta WhatsApp Cloud API) to +371 29338444. It keeps no
copy: nothing is stored, and the logs say only which channel worked. The page side is the form block at the end of
`site/js/site.js` (`FORM_ENDPOINT`, `TURNSTILE_SITEKEY`).

Why this route: it works whichever host serves the static site (nano.lv, Netlify or Cloudflare Pages), the free tiers
cover the volume (a few dozen enquiries a month), and the secrets never reach the page.

## What it checks

- The origin: only the addresses in `ALLOWED_ORIGINS` (wrangler.toml) may post. Anything else gets 403.
- Size (16 KB), method and JSON.
- Bots: a filled honeypot (`vietne`) or a send sooner than 2.5 s after the visitor first reached the form (`t`) is
  told all went well and dropped. With `TURNSTILE_SECRET` set, the Turnstile token must pass Cloudflare's siteverify.
- Fields: name and phone required (at least 7 digits), e-mail optional but an address when given, dates as
  YYYY-MM-DD, counts as whole numbers (an enquiry for 60 is accepted), everything trimmed and capped.
- Delivery: e-mail and WhatsApp go out in parallel. At least one delivered is a success (the page shows the
  thank-you); both failing answers 502 (the page shows the error line with the phone number).

`node --test form-worker/test/` runs the checks against a fake fetch; `npm test` includes it.

## Setting it up

The account IDs, the WhatsApp sender and the KV namespace id of the live setup are not kept in this public repo; the
maintainers hold them.

1. **Cloudflare** (free): an account, then Workers. From this folder: `npx wrangler login`, `npx wrangler deploy`.
   The Worker answers at `https://karumnieki-forma.<account>.workers.dev/`.
2. **Turnstile** (free, in the same Cloudflare account): add a widget, mode Managed, hostnames karumnieki.lv,
   www.karumnieki.lv, karumnieki-preview.netlify.app and localhost. Site key into `TURNSTILE_SITEKEY` in
   `site/js/site.js`, secret key with `npx wrangler secret put TURNSTILE_SECRET`.
3. **Brevo** (free tier, 300 e-mails a day): an account (Brevo approves new accounts before they can send), an API key
   (`BREVO_API_KEY`), and a sender. Best: authenticate the domain karumnieki.lv in Brevo (its DKIM and DMARC records
   go into the DNS at nano.lv; do not touch the MX record there, mail for @karumnieki.lv runs on that server) and
   send from an address on it, e.g. pieprasijumi@karumnieki.lv, as `FROM_EMAIL`. A Gmail sender works too, but Brevo
   then rewrites it. `TO_EMAIL` is the owner's mailbox (a secret, so it stays out of the repo and the page).
4. **WhatsApp** (Meta Cloud API). The owner's +371 29338444 only receives: a number cannot send to itself (Meta error
   131021), and a number registered on the Cloud API leaves the WhatsApp app.
   - **Now (since 2026-10-06): a Meta test number.** No card, no SIM, free. Limits: up to 5 recipients, each
     confirmed once with a code Meta sends to that WhatsApp (that is also the opt in); the sender shows as "Test
     Number" and its profile cannot be edited, so the owner saves it as a contact. Meta calls the number a testing
     tool, so treat it as a pilot: e-mail goes out anyway, and `ALERT_EMAIL` tells the maintainers if WhatsApp stops.
   - **Later, if wanted: a number of its own** (a SIM, a landline or a virtual number, not on WhatsApp), registered
     with the display name "Kārumnieki", a payment card in WhatsApp Manager (Meta charges each utility message by its
     rate card), and the template made again on it.
   - Token: a system user of its own, role Employee, with two assets only: the app (Test app is enough) and this
     WhatsApp account with Everything (with "Message templates (view only)" Meta refuses to send, error 10, tested
     2026-10-06). The token never expires and carries only `whatsapp_business_messaging`, so it can send and nothing
     else. Never an existing admin system user: those reach other assets. Keep the token in your system's keychain
     and pipe it straight into `npx wrangler secret put WHATSAPP_TOKEN`, so it never goes into a file or a chat.
   - a message template, category Utility, name `jauns_pieprasijums_v3` (approved 2026-10-06; v1 and v2 had our
     own wording and are no longer used), language Latvian. Rule: only the form's fields, under the form's
     own labels, nothing the guest did not type. Body:

     ```
     *Jauns pieprasījums no karumnieki.lv*

     Vārds, uzvārds: {{1}}
     Tālrunis: {{2}}
     E-pasts: {{3}}
     Datums no: {{4}}
     Datums līdz: {{5}}
     Pasākuma veids: {{6}}
     Viesu skaits: {{7}}
     Gultas vietu skaits: {{8}}
     Papildus: {{9}}
     Labāk piezvaniet man: {{10}}
     Komentārs: {{11}}

     Tas pats pieprasījums ir arī e-pastā.
     ```

     Footer: `Uzspied uz tālruņa, lai rakstītu vai zvanītu viesim`. The last line is there because Meta refuses a body
     that ends with a variable. An empty field reads "nav norādīts", the call-me box "jā" or "nē"; a comment over 320
     characters is cut with "… (pilns teksts e-pastā)", so the longest message is 1001 of Meta's 1024 characters
     (a test checks it). Buttons: Meta refuses any link to WhatsApp (wa.me and api.whatsapp.com: "Direct links to
     WhatsApp aren't allowed for buttons"), and a call button rings one fixed number, so a "write" or "call the guest"
     button can only go through an address of ours that redirects. Built (2026-10-06, not live): the Worker answers
     `GET /w/<digits>` with a redirect to `https://wa.me/<digits>` and `GET /z/<digits>` with a page that starts a
     call to `tel:+<digits>`; digits only (8 to 15), anything else is not redirected, nothing is logged. The guest's
     phone becomes international digits (`intlDigits`: 8 digits from 2 or 6 get 371, 00 counts as a plus). To use
     them: a template with two URL buttons, dynamic, `https://<Worker address>/w/{{1}}` ("Rakstīt WhatsApp") and
     `https://<Worker address>/z/{{1}}` ("Zvanīt"), and the var `WHATSAPP_BUTTONS = "1"` (without it the Worker sends
     no button parameters, which a template without buttons needs).
     Variable type "Number". In WhatsApp Manager's editor type only `{{` (it inserts the next `{{n}}` itself), then
     jump to the end of the line; fill the samples from the bottom up, the form shifts. Approval took minutes for v1
     and about ten minutes for v2. A template made on Meta's test number has to be made again on a real number;
   - Message time to live: leave Meta's default (30 days for utility), so a phone that is off for a while still gets
     the message later. A custom value would be 12 hours at most.
   - `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` as secrets. `GRAPH_VERSION` defaults to v26.0 (the app's version too);
     set it as a var if Meta retires that version. On a refusal the log shows Meta's error code, not its message.
5. On the page: set `FORM_ENDPOINT` (and `TURNSTILE_SITEKEY`) in `site/js/site.js`, run `npm test`, then send a test
   enquiry from the preview and from the live domain and check that both the e-mail and the WhatsApp message arrive.
6. Optional: Cloudflare's rate limiting binding as `RATE_LIMIT` (the Worker uses it when present, keyed by IP).

The privacy policy already names Cloudflare, Brevo (Sendinblue SAS) and WhatsApp Ireland as processors. If a
different service is used, change the policy pages in both languages in the same edit.

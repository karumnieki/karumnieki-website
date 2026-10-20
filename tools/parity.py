"""parity.py: keep the Latvian pages and their English twins in step: site/index.html and site/en/index.html, and
since 2026-10-04 the two policy pages (privatuma-politika and sikdatnu-politika, in English privacy-policy and
cookie-policy under en/), all listed in PAIRS.

The two pages are the same HTML with different words (chosen over a template: both stay
plain pages anyone can edit, and this check is what stops them drifting apart). It reads both and compares them tag by
tag: every tag, id, class, image, link, crop, style and gallery tile must match, and only the text and the
translatable attributes may differ (alt, title, aria-label, placeholder, data-caption, data-text, the meta
descriptions). Then, slot by slot, the numbers must match (45, 50 min, 4 km, 4,8 against 4.8, 210), Latvian letters
left on the English page are flagged, and the two string sets at the top of js/site.js must hold the same keys.

What it cannot see: a Latvian sentence reworded without its English twin, when no number changed. So a copy change is
made on both pages in the same edit, and the review sheet below shows every pair side by side.

The places where the pages differ on purpose are the EXCEPTIONS below, each with its reason. A new one is a decision,
so add it there rather than loosening a rule.

Usage:
  python parity.py                   check both pages, exit 1 on any difference (lint.py runs this too)
  python parity.py --sheet out.html  also write the LV | EN side-by-side table used to review the English
"""
import difflib
import html
import io
import os
import posixpath
import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))
# Each Latvian page and its English twin, with the addresses their canonical and hreflang links must carry. Only the
# home pages hold the enquiry form, so only they carry the hidden valoda field.
PAIRS = (
    {"lv": "index.html", "en": "en/index.html", "valoda": True,
     "url": {"lv": "https://karumnieki.lv/", "en": "https://karumnieki.lv/en/"}},
    {"lv": "privatuma-politika/index.html", "en": "en/privacy-policy/index.html", "valoda": False,
     "url": {"lv": "https://karumnieki.lv/privatuma-politika/", "en": "https://karumnieki.lv/en/privacy-policy/"}},
    {"lv": "sikdatnu-politika/index.html", "en": "en/cookie-policy/index.html", "valoda": False,
     "url": {"lv": "https://karumnieki.lv/sikdatnu-politika/", "en": "https://karumnieki.lv/en/cookie-policy/"}},
)
# A link from an English page to an English page is the twin of the Latvian page's link to the Latvian page (the home
# page, a policy), so before comparing, an English address is read as its Latvian twin's (paths from the site root).
TWIN = {"en": ".", "en/privacy-policy": "privatuma-politika", "en/cookie-policy": "sikdatnu-politika"}

# EXCEPTIONS, the only places the two pages may differ beyond their words:
#   html lang          lv on the Latvian page, en on the English one (asserted, not ignored)
#   link canonical     each page names itself as the address Google should use (asserted)
#   links to a twin    a link to the home page or a policy page goes to the page in the reader's language (TWIN)
#   a[hreflang]        the language switch: its href points at the other page and aria-current marks the page you
#                      are on, so both are skipped; its lang and hreflang are the same on both pages
#   https://wa.me/...  the prefilled WhatsApp message is in the page's language, so only the part before ? is
#                      compared; the message itself goes into the review sheet
#   input[name=valoda] the hidden field that tells the owner which language the enquiry came from (asserted)

TRANSLATABLE = {"alt", "title", "aria-label", "placeholder", "data-caption", "data-text"}
TRANSLATABLE_META = {"description", "og:title", "og:description", "og:image:alt", "og:locale", "og:locale:alternate"}
URL_ATTRS = {"src", "href", "srcset", "imagesrcset", "data-url"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
CONTEXTS = {"head": "head", "header": "header", "footer": "footer", "dialog": "thank-you dialog"}
LV_LETTERS = re.compile(r"[āčēģīķļņšūž]", re.I)
# Latvian words allowed on the English page outside a lang="lv" element: the name, and a reviewer's first name
ALLOWED_LV_WORDS = {"kārumnieki", "katrīna"}
# Text that is the same in both languages on purpose. Any other slot left identical is untranslated, which catches a
# Latvian word with no Latvian letters in it ("pirts", "kubuls") that the letter check cannot see.
NEUTRAL = {"", "Kārumnieki", "- Kārumnieki", "WhatsApp", "Facebook", "karumnieki@gmail.com", "+371 29338444",
           "LV", "EN", "Latviski", "English", "|", "·", ".", ",", "© OpenStreetMap",
           # the policy pages: names of stored items, and the data protection authority's contacts
           "karumnieki-consent", "_ga", "_ga_GQS1ZY72EX", "Cloudflare Turnstile", "pasts@dvi.gov.lv", "www.dvi.gov.lv",
           "Kalnabeites, Siguldas pagasts,",  # the postal address stays Latvian: it is what a satnav needs
           # the rating lines since 2026-10-12: the numbers sit in their own spans (site.js keeps them current)
           "Google", "Google ·"}


class Page(HTMLParser):
    """One page as a list of events (the skeleton) plus the list of its words (the slots)."""

    def __init__(self, lang, folder):
        super().__init__(convert_charrefs=True)
        self.lang, self.folder = lang, folder
        self.events = []     # (key, line): the skeleton
        self.slots = []      # the words, in page order
        self.stack = []      # open elements: (tag, transparent, lang attribute, context label)
        self.pending = []    # text pieces waiting to become one slot: (text, in a Latvian element)
        self.pending_line = None
        self.raw_tag, self.raw = None, []
        self.found = {"hreflang": {}}

    def where(self):
        for _, _, _, ctx in reversed(self.stack):
            if ctx:
                return ctx
        return "page"

    def latvian_here(self):
        for _, _, lang, _ in reversed(self.stack):
            if lang:
                return lang == "lv"
        return self.lang == "lv"

    def add_slot(self, kind, text, latvian, line):
        text = " ".join(text.split())
        self.slots.append({"kind": kind, "text": text, "scan": "" if latvian else text, "line": line,
                           "where": self.where()})

    def flush(self):
        text = "".join(t for t, _ in self.pending)
        if text.strip():
            scan = " ".join("".join(t for t, lv in self.pending if not lv).split())
            self.slots.append({"kind": "text", "text": " ".join(text.split()), "scan": scan,
                               "line": self.pending_line, "where": self.where()})
            self.events.append((("text",), self.pending_line))
        self.pending, self.pending_line = [], None

    def norm_url(self, u):
        u = u.strip()
        if u.lower().startswith("https://wa.me/"):
            text = parse_qs(urlsplit(u).query).get("text")
            if text:
                self.add_slot("whatsapp message", text[0], self.latvian_here(), self.getpos()[0])
            return u.split("?", 1)[0]
        if not u or re.match(r"^(?:[a-z][a-z0-9+.\-]*:|//|#)", u, re.I):
            return u
        path, tail = re.match(r"^([^?#]*)(.*)$", u).groups()
        if not path:
            return tail
        path = posixpath.normpath(posixpath.join(self.folder, path))
        if self.lang == "en":
            # an English page's link to an English page reads as its Latvian twin's; a link from an English page
            # straight to a Latvian page is marked, so it can never pass for the twin link
            path = TWIN[path] if path in TWIN else ("(a Latvian page) " + path if path in TWIN.values() else path)
        return path + tail

    def norm_urls(self, name, value):
        if name in ("srcset", "imagesrcset"):
            out = []
            for cand in value.split(","):
                bits = cand.split()
                if bits:
                    out.append(" ".join([self.norm_url(bits[0])] + bits[1:]))
            return ", ".join(out)
        return self.norm_url(value)

    def norm_attrs(self, tag, attrs, d):
        meta = (d.get("name") or d.get("property")) if tag == "meta" else None
        latvian = (d["lang"] == "lv") if "lang" in d else self.latvian_here()
        line = self.getpos()[0]
        out = []
        for k, v in attrs:
            v = v or ""
            if tag == "html" and k == "lang":
                self.found["lang"], v = v, "*"
            elif tag == "link" and d.get("rel") == "canonical" and k == "href":
                self.found["canonical"], v = v, "*"
            elif tag == "a" and "hreflang" in d and k in ("href", "aria-current"):
                continue
            elif tag == "input" and d.get("name") == "valoda" and k == "value":
                self.found["valoda"], v = v, "*"
            elif k in TRANSLATABLE or (meta in TRANSLATABLE_META and k == "content"):
                self.add_slot("meta " + meta if meta else k, v, latvian, line)
                v = "*"
            elif k in URL_ATTRS or (meta == "og:image" and k == "content"):
                v = self.norm_urls(k, v)
                if tag == "link" and d.get("rel") == "alternate" and k == "href" and "hreflang" in d:
                    self.found["hreflang"][d["hreflang"]] = d["href"]
            else:
                v = " ".join(v.split())
            out.append((k, v))
        return tuple(sorted(out))

    def handle_starttag(self, tag, attrs):
        d = {k: (v or "") for k, v in attrs}
        # an inline element that only marks a language (<i lang="lv">pirts</i>) is part of the sentence around it
        if tag in ("span", "i", "em", "b") and set(d) == {"lang"}:
            self.stack.append((tag, True, d["lang"], None))
            return
        self.flush()
        self.events.append((("start", tag, self.norm_attrs(tag, attrs, d)), self.getpos()[0]))
        if tag in ("script", "style"):
            self.raw_tag, self.raw = tag, []
        if tag not in VOID:
            ctx = None
            if tag == "section" and d.get("id"):
                ctx = "#" + d["id"]
            elif tag == "nav" and "sticky-bar" in d.get("class", ""):
                ctx = "sticky bar"
            elif tag in CONTEXTS:
                ctx = CONTEXTS[tag]
            self.stack.append((tag, False, d.get("lang"), ctx))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.raw_tag == tag:
            self.events.append((("raw", tag, "".join(self.raw).strip()), self.getpos()[0]))
            self.raw_tag = None
        if self.stack and self.stack[-1][0] == tag and self.stack[-1][1]:
            self.stack.pop()
            return
        self.flush()
        self.events.append((("end", tag), self.getpos()[0]))
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.raw_tag:
            self.raw.append(data)
            return
        if not self.pending:
            self.pending_line = self.getpos()[0]
        self.pending.append((data, self.latvian_here()))


def load(lang, rel):
    path = os.path.join(SITE, rel.replace("/", os.sep))
    if not os.path.exists(path):
        return None
    page = Page(lang, posixpath.dirname(rel))
    page.feed(io.open(path, encoding="utf-8").read())
    page.close()
    page.flush()
    return page


def show(keys):
    out = []
    for k in keys[:3]:
        if k[0] == "start":
            out.append("<%s %s>" % (k[1], " ".join("%s=%s" % (a, (v[:40] + "...") if len(v) > 43 else v)
                                                  for a, v in k[2]))[:160])
        elif k[0] == "end":
            out.append("</%s>" % k[1])
        elif k[0] == "raw":
            out.append("<%s> body" % k[1])
        else:
            out.append("(text)")
    return " ".join(out) + (" ... (%d more)" % (len(keys) - 3) if len(keys) > 3 else "") if out else "(nothing)"


def numbers(s):
    return sorted(n.replace(",", ".") for n in re.findall(r"\d+(?:[.,]\d+)?", s))


def js_problems():
    path = os.path.join(SITE, "js", "site.js")
    js = io.open(path, encoding="utf-8").read()
    sets = {lang: set(re.findall(r"(\w+)\s*:", body))
            for lang, body in re.findall(r"^\s*(lv|en):\s*\{([^}]*)\}", js, re.M)}
    if set(sets) != {"lv", "en"}:
        return ["parity: js/site.js has no lv and en string sets at the top"]
    out = []
    if sets["lv"] != sets["en"]:
        out.append("parity: js/site.js string keys differ: only lv %s, only en %s"
                   % (sorted(sets["lv"] - sets["en"]), sorted(sets["en"] - sets["lv"])))
    for used in sorted(set(re.findall(r"\bT\.(\w+)", js)) - sets["lv"] - sets["en"]):
        out.append("parity: js/site.js uses T.%s, which neither string set defines" % used)
    return out


def run(pair=PAIRS[0]):
    """Returns (problems, lv page, en page, aligned) for one pair. Slots are compared only when the skeletons match."""
    names = {"lv": pair["lv"], "en": pair["en"]}
    lv, en = load("lv", names["lv"]), load("en", names["en"])
    if lv is None or en is None:
        return ["parity: site/%s missing" % (names["lv"] if lv is None else names["en"])], lv, en, False
    hreflang = {"lv": pair["url"]["lv"], "en": pair["url"]["en"], "x-default": pair["url"]["lv"]}
    problems = []
    for p in (lv, en):
        name = names[p.lang]
        if p.found.get("lang") != p.lang:
            problems.append('parity: %s has <html lang="%s">, wants "%s"' % (name, p.found.get("lang"), p.lang))
        if p.found.get("canonical") != pair["url"][p.lang]:
            problems.append("parity: %s canonical is %s, wants %s" % (name, p.found.get("canonical"), pair["url"][p.lang]))
        if p.found["hreflang"] != hreflang:
            problems.append("parity: %s hreflang links %s, want %s" % (name, p.found["hreflang"], hreflang))
        want = p.lang if pair["valoda"] else None
        if p.found.get("valoda") != want:
            problems.append('parity: %s hidden valoda field is "%s", wants "%s"' % (name, p.found.get("valoda"), want))

    a, b = [k for k, _ in lv.events], [k for k, _ in en.events]
    if a != b:
        sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
        shown = 0
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "equal":
                continue
            li = lv.events[min(i1, len(a) - 1)][1]
            lj = en.events[min(j1, len(b) - 1)][1]
            problems.append("parity: %s at %s:%s / %s:%s\n      lv: %s\n      en: %s"
                            % (op, names["lv"], li, names["en"], lj, show(a[i1:i2]), show(b[j1:j2])))
            shown += 1
            if shown == 8:
                problems.append("parity: more differences not shown")
                break
        return problems, lv, en, False

    if len(lv.slots) != len(en.slots):
        problems.append("parity: %d word slots on %s, %d on %s (a WhatsApp link with and without its message?)"
                        % (len(lv.slots), names["lv"], len(en.slots), names["en"]))
        return problems, lv, en, False
    for s, t in zip(lv.slots, en.slots):
        if numbers(s["text"]) != numbers(t["text"]):
            problems.append("parity: numbers differ at %s:%s / %s:%s (%s): %s against %s"
                            % (names["lv"], s["line"], names["en"], t["line"], s["kind"], numbers(s["text"]),
                               numbers(t["text"])))
        for word in re.findall(r"\w+", t["scan"]):
            if LV_LETTERS.search(word) and word.lower() not in ALLOWED_LV_WORDS:
                problems.append('parity: Latvian word "%s" on the English page, %s:%s (%s): %s'
                                % (word, names["en"], t["line"], t["kind"], t["text"][:90]))
        if s["text"] == t["text"] and s["text"] not in NEUTRAL:
            problems.append('parity: untranslated at %s:%s (%s): "%s" (if it is the same in both languages '
                            'on purpose, add it to NEUTRAL)' % (names["en"], t["line"], t["kind"], t["text"][:90]))
    return problems, lv, en, True


def check():
    problems = []
    for pair in PAIRS:
        problems += run(pair)[0]
    return problems + js_problems()


def write_sheet(path, lv, en):
    rows, last = [], None
    for n, (s, t) in enumerate(zip(lv.slots, en.slots), 1):
        if s["where"] != last:
            last = s["where"]
            rows.append('<tr class="sec"><th colspan="4">%s</th></tr>' % html.escape(last))
        cls = ' class="same"' if s["text"] == t["text"] else ""
        rows.append('<tr%s><td class="n">%d</td><td class="k">%s</td><td lang="lv">%s</td><td lang="en">%s</td></tr>'
                    % (cls, n, html.escape(s["kind"]), html.escape(s["text"]), html.escape(t["text"])))
    js = io.open(os.path.join(SITE, "js", "site.js"), encoding="utf-8").read()
    sets = dict(re.findall(r"^\s*(lv|en):\s*\{([^}]*)\}", js, re.M))
    pairs = {lang: dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", body)) for lang, body in sets.items()}
    if pairs:
        rows.append('<tr class="sec"><th colspan="4">js/site.js (strings the script writes)</th></tr>')
        for key in pairs.get("lv", {}):
            rows.append('<tr><td class="n"></td><td class="k">%s</td><td lang="lv">%s</td><td lang="en">%s</td></tr>'
                        % (html.escape(key), html.escape(pairs["lv"][key]), html.escape(pairs.get("en", {}).get(key, ""))))
    doc = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>K&#257;rumnieki LV | EN review sheet</title>
<style>
body { margin: 24px; font: 15px/1.45 system-ui, 'Segoe UI', Roboto, Arial, sans-serif; color: #27231e; background: #f4eee3; }
h1 { font-size: 20px; margin: 0 0 4px; }
p.meta { margin: 0 0 16px; color: #5a5444; }
table { border-collapse: collapse; width: 100%%; background: #fff; }
td, th { border-bottom: 1px solid #e4d9c6; padding: 6px 10px; vertical-align: top; text-align: left; }
td[lang] { width: 44%%; }
td.n { width: 3em; color: #8a8270; font-variant-numeric: tabular-nums; }
td.k { width: 9em; color: #5a5444; font-size: 13px; }
tr.sec th { background: #27231e; color: #fcead1; font-weight: 600; letter-spacing: .04em; }
tr.same td[lang] { color: #8a8270; }
</style>
</head>
<body>
<h1>K&#257;rumnieki: every Latvian text on the page beside its English</h1>
<p class="meta">Generated by tools/parity.py from site/index.html and site/en/index.html, %s. %d pairs in page order;
grey rows are the same in both languages (names, numbers, the phone). Kinds: text is visible text, alt is the image
description, caption opens with a gallery photo, aria-label is read out by screen readers, whatsapp message is the
prefilled text.</p>
<table>
%s
</table>
</body>
</html>
""" % (datetime.now().strftime("%Y-%m-%d %H:%M"), len(lv.slots), "\n".join(rows))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    io.open(path, "w", encoding="utf-8").write(doc)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    problems, lv, en, aligned = run()
    problems = check()
    if "--sheet" in args:
        out = args[args.index("--sheet") + 1]
        if aligned:
            write_sheet(out, lv, en)
            print("sheet written: %s" % out)
        else:
            print("sheet NOT written: the two pages do not line up yet")
    if problems:
        print("PARITY FAIL (%d)" % len(problems))
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    print("parity clean: %d page pairs; on the home pages %d tags and %d word slots line up, numbers match, no Latvian "
          "left on the English page" % (len(PAIRS), sum(1 for k, _ in lv.events if k[0] == "start"), len(lv.slots)))


if __name__ == "__main__":
    main()

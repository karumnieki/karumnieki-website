"""lint.py: the site rules that a script can check, run on site/ after every change.

Checks: no U+2013 or U+2014 anywhere in site/ text files; <html lang="lv"> on index.html and <html lang="en"> on
en/index.html (and the same on the four policy pages since 2026-10-04); on every page every <img> has alt, width, height and a src that exists, every srcset candidate exists,
no image URL leaves the origin; the words "elektrisk" (Latvian page), "electric" (English page), "EUR" and the euro
sign are absent; Lora is used only in CSS rules whose selector contains .bear. Then tools/parity.py: the two pages
must be the same HTML with different words.
Usage: python lint.py   (exit 1 on any failure)
"""
import io
import os
import re
import sys

import parity

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))
problems = []

text_files = []
for dp, dn, fn in os.walk(SITE):
    for f in fn:
        if f.lower().endswith((".html", ".css", ".js", ".txt", ".json", ".svg", ".webmanifest")):
            text_files.append(os.path.join(dp, f))

for p in text_files:
    t = io.open(p, encoding="utf-8").read()
    for i, line in enumerate(t.splitlines(), 1):
        if "\u2013" in line or "\u2014" in line:
            problems.append("%s:%d long dash" % (os.path.relpath(p, SITE), i))

# (page, its lang, its folder inside site/, the word that must not appear: the sauna is wood-fired)
PAGES = (("index.html", "lv", "", "elektrisk"), ("en/index.html", "en", "en", "electric"),
         ("privatuma-politika/index.html", "lv", "privatuma-politika", "elektrisk"),
         ("sikdatnu-politika/index.html", "lv", "sikdatnu-politika", "elektrisk"),
         ("en/privacy-policy/index.html", "en", "en/privacy-policy", "electric"),
         ("en/cookie-policy/index.html", "en", "en/cookie-policy", "electric"))
img_counts = {}
for name, lang, folder, electric in PAGES:
    path = os.path.join(SITE, name.replace("/", os.sep))
    html = io.open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    if not html:
        problems.append("%s missing" % name)
        continue
    base = os.path.join(SITE, folder)

    def exists(url):
        return os.path.exists(os.path.normpath(os.path.join(base, url.replace("/", os.sep))))

    if not re.search(r'<html[^>]*\blang="%s"' % lang, html):
        problems.append('%s: <html lang="%s"> missing' % (name, lang))
    for m in re.finditer(r"<img\b([^>]*)>", html, re.S):
        attrs = m.group(1)
        for need in ("alt=", "width=", "height=", "src="):
            if need not in attrs:
                problems.append("%s: <img> without %s -> %s" % (name, need, " ".join(attrs.split())[:80]))
        srcs = re.findall(r'\bsrc="([^"]+)"', attrs)
        srcset = re.findall(r'\bsrcset="([^"]+)"', attrs)
        cands = list(srcs) + [c.strip().split(" ")[0] for s in srcset for c in s.split(",") if c.strip()]
        for c in cands:
            if c.startswith("http") or c.startswith("//"):
                problems.append("%s: external image %s" % (name, c))
            elif not exists(c):
                problems.append("%s: missing image file %s" % (name, c))
    for m in re.finditer(r"<source\b([^>]*)>", html, re.S):
        for s in re.findall(r'\bsrcset="([^"]+)"', m.group(1)):
            for c in s.split(","):
                c = c.strip().split(" ")[0]
                if c and not exists(c):
                    problems.append("%s: missing <source> file %s" % (name, c))
    # a gallery tile's href is the file the lightbox opens; since 2026-09-15 it is often not the tile's own src
    # (the -lightbox- sizes), so it is checked on its own
    for m in re.finditer(r'<a class="tile" href="([^"]+)"', html):
        if not exists(m.group(1)):
            problems.append("%s: missing lightbox file %s" % (name, m.group(1)))
    low = html.lower()
    for bad in (electric, " eur ", "€"):
        if bad in low:
            problems.append("%s: forbidden word %r present" % (name, bad))
    img_counts[name] = len(re.findall(r"<img\b", html))

css_path = os.path.join(SITE, "css", "site.css")
if os.path.exists(css_path):
    css = io.open(css_path, encoding="utf-8").read()
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        sel, body = m.group(1).strip(), m.group(2)
        if "lora" in body.lower() and "font-family" in body.lower() and ".bear" not in sel and "--font-bear" not in body:
            problems.append("site.css: Lora outside .bear -> %s" % sel[:80])

problems += parity.check()

if problems:
    print("LINT FAIL (%d)" % len(problems))
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("lint clean: %d text files, <img> tags %s, parity clean"
      % (len(text_files), ", ".join("%s %d" % (k, v) for k, v in img_counts.items())))

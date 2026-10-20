#!/usr/bin/env python3
"""build.py: the site as it goes live, built from site/ (which stays the source, comments and all).

    python3 tools/build.py            out/dist/site/       the live build, the Worker addresses set
    python3 tools/build.py --test     out/dist-test/site/  the same with the three addresses left empty
    python3 tools/build.py --check    both, then: they may differ in those three lines of site.js and nothing else

What changes against site/ (HANDOVER section 6):
- every comment out of the HTML, CSS and JS: on a live page they are public and carry working notes. The JS is read token by token (strings and regular expressions are left alone),
  the CSS and HTML have no comment markers inside strings (checked below);
- the robots noindex meta out of all six pages;
- the thank-you dialog's preview line (<p class="form-note">, "the form does not send yet") out of both home pages;
- og:image made absolute and og:url added (the page's canonical), which WhatsApp and Facebook previews need;
- robots.txt and sitemap.xml (six pages, hreflang pairs) at the site root;
- .htaccess (nano.lv runs Apache): http and www go to https://karumnieki.lv with a 301, /phone/ (the old site's phone
  copy) goes home, /.well-known/ is left alone for AutoSSL;
- site.js: FORM_ENDPOINT, TURNSTILE_SITEKEY and REVIEWS_ENDPOINT from LIVE below (all three public values);
- ?v=<hash> on every link to css/site.css, css/fonts.css and js/site.js: nano.lv sends them with a 30 day cache, so
  without it a returning visitor would get new pages with last month's CSS. The hash is of the sources and LIVE,
  so the live and the test build carry the same one.
The gate then runs on the --test build exactly as on site/: node tools/gate.mjs --root=out/dist-test. No dashes."""
import datetime as dt
import hashlib
import json
import filecmp
import pathlib
import re
import shutil
import subprocess
import sys
from urllib.parse import urljoin

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "site"
SITE = "https://karumnieki.lv/"
LIVE = {
    "FORM_ENDPOINT": "https://karumnieki-forma.karumnieki.workers.dev/",
    "TURNSTILE_SITEKEY": "0x4AAAAAAFUigU6rVD1clGrt",
    "REVIEWS_ENDPOINT": "https://karumnieki-forma.karumnieki.workers.dev/atsauksmes/",
}
# the files nano.lv caches for 30 days; their links get ?v=<hash>
ASSETS = ("css/site.css", "css/fonts.css", "js/site.js")
# the six pages and their twins (sitemap hreflang), as served live
PAGES = [("", "en/"), ("privatuma-politika/", "en/privacy-policy/"), ("sikdatnu-politika/", "en/cookie-policy/")]
# One address for the whole site. Two rules, not one with [OR]: if TLS ends in front of Apache, HTTPS reads off, so
# X-Forwarded-Proto counts as https too (otherwise a redirect loop). /.well-known/ stays reachable over http.
HTACCESS = r"""RewriteEngine On
RewriteCond %{REQUEST_URI} !^/\.well-known/
RewriteCond %{HTTP_HOST} !^karumnieki\.lv$ [NC]
RewriteRule ^ https://karumnieki.lv%{REQUEST_URI} [R=301,L]
RewriteCond %{REQUEST_URI} !^/\.well-known/
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !=https
RewriteRule ^ https://karumnieki.lv%{REQUEST_URI} [R=301,L]
RewriteRule ^phone(/.*)?$ https://karumnieki.lv/ [R=301,L]
"""
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^")
REGEX_WORDS = {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "instanceof"}


def strip_js(src: str) -> str:
    """Drop /* */ and // comments; strings ('...', "...") and regex literals pass through untouched."""
    out, i, n = [], 0, len(src)
    last = ""          # last significant character written, to tell a regex from a division
    word = ""          # last identifier written
    while i < n:
        c = src[i]
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1]); last, word = c, ""; i = j + 1
            continue
        if c == "`":
            raise ValueError("template literal: strip_js does not handle them")
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.index("*/", i + 2)
            i = j + 2
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and (last == "" or last in REGEX_BEFORE or word in REGEX_WORDS):
            j, cls = i + 1, False
            while j < n:
                if src[j] == "\\":
                    j += 2; continue
                if src[j] == "[": cls = True
                elif src[j] == "]": cls = False
                elif src[j] == "/" and not cls: break
                elif src[j] == "\n": raise ValueError(f"unterminated regex at {i}")
                j += 1
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            out.append(src[i:j]); last, word = "/", ""; i = j
            continue
        out.append(c)
        if not c.isspace():
            if c.isalnum() or c in "_$":
                word = word + c if (last.isalnum() or last in "_$") else c
            else:
                word = ""
            last = c
        i += 1
    return tidy("".join(out))


def tidy(text: str) -> str:
    """Lines left empty by a removed comment go; trailing spaces too."""
    lines = [l.rstrip() for l in text.split("\n")]
    kept, blank = [], False
    for l in lines:
        if not l.strip():
            if not blank and kept:
                kept.append("")
            blank = True
        else:
            kept.append(l); blank = False
    return "\n".join(kept).strip("\n") + "\n"


def strip_css(src: str) -> str:
    if re.search(r"""(['"])[^'"\n]*(/\*|\*/)[^'"\n]*\1""", src):
        raise ValueError("a comment marker inside a CSS string")
    return tidy(re.sub(r"/\*.*?\*/", "", src, flags=re.S))


def page_url(rel: pathlib.Path) -> str:
    return urljoin(SITE, str(rel.parent).replace(".", "") + "/" if str(rel.parent) != "." else "")


def asset_version() -> str:
    h = hashlib.sha256()
    for name in ASSETS:
        h.update((SRC / name).read_bytes())
    h.update(json.dumps(LIVE, sort_keys=True).encode())
    return h.hexdigest()[:10]


def build_html(src: str, rel: pathlib.Path) -> str:
    if "<script>" in src or re.search(r"<script(?![^>]*\bsrc=)", src):
        raise ValueError(f"{rel}: an inline script, the comment remover does not expect one")
    html = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    ver = asset_version()
    html, n = re.subn(r'((?:href|src)="(?:\.\./)*(?:' + "|".join(re.escape(x) for x in ASSETS) + r'))"', r'\1?v=' + ver + '"', html)
    if n < 3:
        raise ValueError(f"{rel}: {n} asset links versioned, want 3")
    html, n = re.subn(r'\s*<meta name="robots" content="noindex, nofollow">', "", html)
    if n != 1:
        raise ValueError(f"{rel}: {n} noindex metas, want 1")
    html = re.sub(r'\s*<p class="form-note">.*?</p>', "", html, flags=re.S)
    canonical = re.search(r'<link rel="canonical" href="([^"]+)">', html)
    if not canonical:
        raise ValueError(f"{rel}: no canonical")
    og = re.search(r'<meta property="og:image" content="([^"]+)">', html)
    if og:
        absolute = urljoin(canonical.group(1), og.group(1))
        html = html.replace(og.group(0), f'<meta property="og:image" content="{absolute}">\n'
                                         f'<meta property="og:url" content="{canonical.group(1)}">')
    return tidy(html)


def build_js(src: str, test: bool) -> str:
    js = strip_js(src)
    for name, value in LIVE.items():
        pat = f"var {name} = '';"
        if js.count(pat) != 1:
            raise ValueError(f"site.js: {pat} not found once")
        if not test:
            js = js.replace(pat, f"var {name} = '{value}';")
    return js


def sitemap() -> str:
    today = dt.date.today().isoformat()
    rows = []
    for lv, en in PAGES:
        for loc in (lv, en):
            rows.append(f"""  <url>
    <loc>{SITE}{loc}</loc>
    <lastmod>{today}</lastmod>
    <xhtml:link rel="alternate" hreflang="lv" href="{SITE}{lv}"/>
    <xhtml:link rel="alternate" hreflang="en" href="{SITE}{en}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}{lv}"/>
  </url>""")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
            + "\n".join(rows) + "\n</urlset>\n")


def build(test: bool) -> pathlib.Path:
    dest = ROOT / "out" / ("dist-test" if test else "dist") / "site"
    if dest.parent.exists():
        shutil.rmtree(dest.parent)
    shutil.copytree(SRC, dest)
    for path in sorted(dest.rglob("*")):
        rel = path.relative_to(dest)
        if path.suffix == ".html":
            path.write_text(build_html(path.read_text(encoding="utf-8"), rel), encoding="utf-8")
        elif path.suffix == ".css":
            path.write_text(strip_css(path.read_text(encoding="utf-8")), encoding="utf-8")
        elif path.suffix == ".js":
            path.write_text(build_js(path.read_text(encoding="utf-8"), test), encoding="utf-8")
    (dest / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}sitemap.xml\n", encoding="utf-8")
    (dest / "sitemap.xml").write_text(sitemap(), encoding="utf-8")
    (dest / ".htaccess").write_text(HTACCESS, encoding="utf-8")
    for js in dest.rglob("*.js"):
        r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
        if r.returncode:
            raise ValueError(f"{js.name} no longer parses: {r.stderr[:300]}")
    left = [str(p.relative_to(dest)) for p in dest.rglob("*") if p.suffix in (".html", ".css", ".js")
            and re.search(r"<!--|/\*", p.read_text(encoding="utf-8"))]
    if left:
        raise ValueError(f"comments left in {left}")
    if test is False:
        dashes = [str(p.relative_to(dest)) for p in dest.rglob("*") if p.suffix in (".html", ".css", ".js", ".xml", ".txt")
                  and re.search("[" + chr(0x2013) + chr(0x2014) + "]", p.read_text(encoding="utf-8"))]
        if dashes:
            raise ValueError(f"dashes in {dashes}")
    return dest


def check() -> None:
    live, test = build(False), build(True)
    cmp = filecmp.dircmp(live, test)
    def walk(c, base=""):
        diff = [base + f for f in c.diff_files] + [base + f for f in c.left_only + c.right_only]
        for name, sub in c.subdirs.items():
            diff += walk(sub, base + name + "/")
        return diff
    diff = walk(cmp)
    if diff != ["js/site.js"]:
        raise ValueError(f"the two builds differ in {diff}, want js/site.js only")
    a = (live / "js/site.js").read_text(encoding="utf-8").split("\n")
    b = (test / "js/site.js").read_text(encoding="utf-8").split("\n")
    lines = [(x, y) for x, y in zip(a, b) if x != y]
    if len(a) != len(b) or len(lines) != 3 or not all(y.strip().endswith("= '';") for _, y in lines):
        raise ValueError(f"site.js differs beyond the three addresses: {lines[:5]}")
    print("check: the live and the test build differ only in", ", ".join(x.split()[1] for x, _ in lines))


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        out = build("--test" in sys.argv)
        print("built", out.relative_to(ROOT))

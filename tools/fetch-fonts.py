"""fetch-fonts.py: self-host the four faces the brief loads.

Playfair Display 500, Lora 400, Source Sans 3 400 and 600, latin + latin-ext woff2, fetched through the Google
Fonts CSS API with a Chrome user agent (so it answers with woff2 and unicode-range subsets), saved into
site/fonts and declared in site/css/fonts.css with the same unicode-range per subset (2026-09-03).
Usage: python fetch-fonts.py [--keep-existing]

--keep-existing (added 2026-09-11 for the Source Sans 3 600 download): a file
already in site/fonts is kept byte for byte and only declared again; only files missing on disk are fetched.

What that download showed (2026-09-11): the API answers the 400 and the 600 request with the SAME woff2 (same
URL, same bytes), because Google serves Source Sans 3 as a variable font. A render proved it: at weight 600 the range declaration from the 400 file sets the same 600.05px as the "600" file, while
a family locked to 400 falls back to a synthetic bold at 582.25px, the width of plain 400. So the site never
had a faux bold. This script therefore merges every weight that resolves to
one file into a single @font-face with a weight range, named by its lowest weight, which is exactly the
2026-09-03 file set; a duplicate "600" file is never written.
"""
import io
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
FONTS = os.path.join(ROOT, "site", "fonts")
CSS_OUT = os.path.join(ROOT, "site", "css", "fonts.css")
os.makedirs(FONTS, exist_ok=True)
os.makedirs(os.path.dirname(CSS_OUT), exist_ok=True)
KEEP = "--keep-existing" in sys.argv
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
API = ("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500&family=Lora:wght@400"
       "&family=Source+Sans+3:wght@400;600&display=swap")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


css = fetch(API).decode("utf-8")
block_re = re.compile(r"/\*\s*([a-z-]+)\s*\*/\s*@font-face\s*\{(.*?)\}", re.S)
faces = {}
order = []
for subset, body in block_re.findall(css):
    if subset not in ("latin", "latin-ext"):
        continue
    fam = re.search(r"font-family:\s*'([^']+)'", body).group(1)
    weight = int(re.search(r"font-weight:\s*(\d+)", body).group(1))
    url = re.search(r"url\(([^)]+)\)", body).group(1)
    urange = re.search(r"unicode-range:\s*([^;]+);", body).group(1).strip()
    key = (fam, subset, url)
    if key in faces:
        faces[key]["weights"].append(weight)  # the same file answering another weight: a variable font
        continue
    faces[key] = {"fam": fam, "subset": subset, "url": url, "weights": [weight], "urange": urange}
    order.append(key)

rules = []
total = 0
for key in order:
    f = faces[key]
    ws = sorted(set(f["weights"]))
    wdecl = "%d %d" % (ws[0], ws[-1]) if len(ws) > 1 else str(ws[0])
    label = "%d (one variable file serving %s)" % (ws[0], " to ".join(str(w) for w in (ws[0], ws[-1]))) if len(ws) > 1 else str(ws[0])
    slug = f["fam"].lower().replace(" ", "-")
    fname = "%s-%s-%s.woff2" % (slug, ws[0], f["subset"])
    fpath = os.path.join(FONTS, fname)
    if KEEP and os.path.exists(fpath):
        data = io.open(fpath, "rb").read()
        print("%-42s %6d bytes  kept, already on disk" % (fname, len(data)))
    else:
        data = fetch(f["url"])
        io.open(fpath, "wb").write(data)
        print("%-42s %6d bytes  <- %s" % (fname, len(data), f["url"]))
    total += len(data)
    rules.append(
        "/* %s %s, %s */\n@font-face {\n  font-family: '%s';\n  font-style: normal;\n  font-weight: %s;\n"
        "  font-display: swap;\n  src: url('../fonts/%s') format('woff2');\n  unicode-range: %s;\n}\n"
        % (f["fam"], label, f["subset"], f["fam"], wdecl, fname, f["urange"])
    )
header = ("/* Self-hosted fonts for karumnieki.lv v1. Files fetched from Google Fonts on 2026-09-03 by\n"
          "   tools/fetch-fonts.py; SIL Open Font License for all three families. Latin + latin-ext only.\n"
          "   Source Sans 3 is one variable file per subset: the API answers the 400 and the 600 request with the\n"
          "   same bytes, so the 400 600 range below serves a real 600 (proved by render 2026-09-11 with\n"
          "   tools/font-weight-test.html: 600.05px from the file against 582.25px for a synthetic bold). */\n\n")
io.open(CSS_OUT, "w", encoding="utf-8").write(header + "\n".join(rules))
print("wrote %s with %d @font-face rules, %d KB of woff2" % (CSS_OUT, len(rules), total // 1024))

"""smaller-files.py: the smaller copies of the photos for phones (2026-10-02).

On a phone the section photos loaded their 1600px files into ~350px slots and every gallery tile a 1200px file shown
at ~170px. This writes smaller copies into photos/web/ from the LARGEST graded file of the same photo and role (the
same pixels the page already shows, never the original, never a model): Lanczos, WebP q82, method 6, exactly as
photos/_pipeline/towebp.py does (three section photos also get a 2000, see ADD). Then it adds the sizes to
tools/slots.json, so sync-assets.py copies them into site/img like any other web asset. The page offers them through srcset and sizes; tools/img-fit.mjs checks that no
photo ends up with fewer file pixels per screen pixel than it had (or than the screen shows).

The hero is left alone: on a phone it is drawn 1.78x wider than its square box and is already short on a 3x screen.
E01 already ships a 900 and K35 an 800.

Usage: python smaller-files.py [--force]   (--force rewrites files that exist)
"""
import io
import json
import os
import sys

from PIL import Image

# photos/ (the graded photo masters) is not in this repo. Stop before any
# write when it is missing, because this script makes its copies from the graded files there.
if not os.path.isdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "photos", "web")):
    sys.exit("smaller-files.py: photos/web is not here. The photo masters are not in this repo; "
             "site/img already holds every file the page uses. Ask a maintainer for photo changes.")

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "photos", "web"))
SLOTS = os.path.join(HERE, "slots.json")
force = "--force" in sys.argv

# (id, role): the long edges to add. Section photos get 800 and 1200, tiles 600, dikis-mezs (a 1520 tile) 760.
ADD = {}
for fid in ("karumnie:parmums", "K62:section", "K61:companion", "K09:section", "K32:section", "pirts_6:companion", "K27:section"):
    ADD[tuple(fid.split(":"))] = [800, 1200]
for fid in ("K67", "K43", "zale_10", "K38", "K39", "K37", "zale_1", "zale_3", "pirts_4", "pirts_1", "pirts_5", "K18",
            "K06", "K10", "K11", "K12", "dzakuzi", "K36", "K30", "F01", "K22", "K26", "K23"):
    ADD[(fid, "gallery")] = [600]
ADD[("dikis-mezs", "section")] = [760]
# drawn 1.185x (K27 1.317x) wider than their box, these three need about 1670 to 1850 file pixels on a 768 to 834px
# tablet: between the 1600 (a little short) and the 3200 (twice the weight). A 2000 is the step that fits.
for fid in ("karumnie:parmums", "K32:section", "K27:section"):
    ADD[tuple(fid.split(":"))] = [800, 1200, 2000]

slots = json.load(io.open(SLOTS, encoding="utf-8"))
made = []
for (fid, role), sizes in ADD.items():
    entries = [p for p in slots["photos"] if p["id"] == fid and p["role"] == role]
    if not entries:
        sys.exit("no slots.json entry for %s %s" % (fid, role))
    largest = max(s for p in entries for s in p["sizes"])
    src = os.path.join(WEB, "%s-%s-%d.webp" % (fid, role, largest))
    im0 = Image.open(src).convert("RGB")
    w, h = im0.size
    for size in sizes:
        dst = os.path.join(WEB, "%s-%s-%d.webp" % (fid, role, size))
        if os.path.exists(dst) and not force:
            continue
        r = size / float(max(w, h))
        im = im0.resize((round(w * r), round(h * r)), Image.LANCZOS)
        im.save(dst, "WEBP", quality=82, method=6)
        made.append("%s from %s  %dx%d  %dKB" % (os.path.basename(dst), os.path.basename(src), im.size[0], im.size[1],
                                                 os.path.getsize(dst) // 1024))
    for p in entries:
        p["sizes"] = sorted(set(p["sizes"]) | set(sizes))

io.open(SLOTS, "w", encoding="utf-8", newline="\n").write(json.dumps(slots, indent=2, ensure_ascii=False))
print("\n".join(made) if made else "nothing new to write")
print("slots.json: %d photo/role pairs carry the smaller sizes" % len(ADD))

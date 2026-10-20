"""logo-wordmark.py: cut the owner's own "kārumnieki" lettering out of the lockup SVG as a wordmark asset.

Nothing is redrawn, the path data stays and only the viewBox changes,
so the wordmark is the artwork's own letters exact to the unit. The lockup stacks bears / "kārumnieki" /
"VIESU NAMS"; the two transparent bands between them are measured off a render. Outputs into photos/web:
logo-wordmark.svg plus PNG and WebP at 400 and 600 px wide for the header. Usage: python logo-wordmark.py
"""
import io
import os
import re
import sys

import numpy as np
import resvg_py
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "photos", "web"))
SRC = os.path.join(WEB, "logo.svg")
svg = io.open(SRC, encoding="utf-8").read()

m = re.search(r'viewBox="([\d.\- ]+)"', svg)
vx, vy, vw, vh = (float(v) for v in m.group(1).split())
print("lockup viewBox %g %g %g %g" % (vx, vy, vw, vh))


def render(s, w=1200):
    return Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=s, width=w)))).convert("RGBA")


full = render(svg)
alpha = np.array(full)[:, :, 3] > 8
PW, PH = full.size
rows = alpha.sum(axis=1)
gaps, start = [], None
for y in range(PH):
    if rows[y] == 0:
        start = y if start is None else start
    elif start is not None:
        gaps.append((start, y - 1))
        start = None
gaps = [g for g in gaps if g[1] - g[0] >= 3 and g[0] / PH > 0.5]
if len(gaps) < 2:
    sys.exit("expected two transparent bands below the bears, found %r" % gaps)
g1, g2 = gaps[0], gaps[1]
y0, y1 = g1[1] + 1, g2[0] - 1
cols = alpha[y0:y1 + 1].sum(axis=0)
xs = np.nonzero(cols)[0]
sx, sy = vw / PW, vh / PH
pad = 0.01 * vw
bx0, bx1 = vx + xs.min() * sx - pad, vx + (xs.max() + 1) * sx + pad
by0, by1 = vy + y0 * sy - pad, vy + (y1 + 1) * sy + pad
print("wordmark rows %d..%d of %d, box in svg units x %.1f..%.1f y %.1f..%.1f" % (y0, y1, PH, bx0, bx1, by0, by1))

word = re.sub(r'viewBox="[\d.\- ]+"', 'viewBox="%.2f %.2f %.2f %.2f"' % (bx0, by0, bx1 - bx0, by1 - by0), svg, count=1)
word = re.sub(r'width="[\d.]+"', 'width="%.2f"' % (bx1 - bx0), word, count=1)
word = re.sub(r'height="[\d.]+"', 'height="%.2f"' % (by1 - by0), word, count=1)
io.open(os.path.join(WEB, "logo-wordmark.svg"), "w", encoding="utf-8").write(word)

for w in (400, 600):
    im = render(word, w=w)
    bbox = im.getbbox()
    im = im.crop(bbox)
    im.save(os.path.join(WEB, "logo-wordmark-%d.png" % w), optimize=True)
    im.save(os.path.join(WEB, "logo-wordmark-%d.webp" % w), "WEBP", quality=90, method=6)
    print("logo-wordmark-%d: %dx%d px" % (w, im.size[0], im.size[1]))
print("done")

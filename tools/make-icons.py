"""make-icons.py: the favicon set, the PWA icons and the og:image, from assets already on disk.

Every icon is composited on the cream ground (#f4eee3) rather than left transparent: iOS fills a
transparent apple-touch-icon with black, and a transparent 16px favicon reads as mud on a light tab
strip. The mark keeps its own proportions and is centred with a margin, never stretched to square.

Run from the client root: python tools/make-icons.py
"""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "photos" / "web" / "logo-mark-512.png"
HERO = ROOT / "site" / "img" / "K21-hero-1600.webp"
OUT = ROOT / "site" / "img"
CREAM = (244, 238, 227, 255)
MARGIN = 0.08  # share of the canvas left as cream on the tight side


def square(size, margin=MARGIN):
    """The mark, centred on a cream square of the given size."""
    mark = Image.open(SRC).convert("RGBA")
    box = int(round(size * (1 - 2 * margin)))
    scale = min(box / mark.width, box / mark.height)
    w, h = max(1, int(round(mark.width * scale))), max(1, int(round(mark.height * scale)))
    mark = mark.resize((w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), CREAM)
    canvas.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    return canvas


def main():
    written = []

    # .ico carries 16 and 32 in one file; Pillow builds both from the largest source given
    ico = square(64, margin=0.04)
    ico.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32)])
    written.append(("favicon.ico", "16 and 32"))

    for name, size, margin in [
        ("favicon-32.png", 32, 0.04),
        ("apple-touch-icon.png", 180, 0.10),
        ("icon-192.png", 192, 0.10),
        ("icon-512.png", 512, 0.10),
    ]:
        img = square(size, margin)
        img.convert("RGB").save(OUT / name)  # no alpha anywhere: the ground is already painted
        written.append((name, str(size)))

    # WhatsApp, Messenger and several link previewers do not render WebP, so the share card is JPEG
    hero = Image.open(HERO).convert("RGB")
    og_w = 1200
    og = hero.resize((og_w, int(round(hero.height * og_w / hero.width))), Image.LANCZOS)
    og.save(OUT / "og-karumnieki-1200.jpg", quality=82, optimize=True, progressive=True)
    written.append(("og-karumnieki-1200.jpg", str(og.size)))

    for name, note in written:
        p = OUT / name
        print("%-26s %-12s %6d bytes" % (name, note, p.stat().st_size))


if __name__ == "__main__":
    main()

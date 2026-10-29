#!/usr/bin/env python3
"""check_edit.py: the fence for the owner's text edits. Python standard library only.

The texts the owner may change carry data-edit="<section>.<n>" in site/index.html and site/en/index.html, and
tools/editable.json has one row per id (a Latvian label, the caps in characters). This script compares the two
pages with a base (main) and refuses anything but new words inside those elements:

- any other file changed, or anything in the pages outside the marked texts (tags, attributes, other text);
- markup in a text (< or >, a tag added or removed, an & entity even without its ;, the word data-edit), a
  straight quote in a photo caption;
- web addresses, e-mail addresses, phone numbers, long dashes, the euro sign or eur / euro / eiro;
- a text over its cap, an empty text, invisible or unusual characters;
- the Latvian text changed without the English one or the reverse, Latvian letters in the English text, the
  English text the same as the Latvian, numbers that differ between the two, and on the rows marked
  fixed_numbers (the capacity) any change to the numbers at all.

Usage (from anywhere inside the repo):
  python tools/check_edit.py                 the working tree against main (or origin/main): what Codex runs
  python tools/check_edit.py --base REF      against another base
  python tools/check_edit.py --head REF      the commit REF against the base, read through git only, so nothing
                                             from a pull request is checked out or run; REF must be built on
                                             the base as it is now
The rows always come from the editable.json beside this script (with --head that is the base's own copy).
Exit 0: the change passes (each changed text is listed). 1: refused, one Latvian line per reason. 2: could not run.
lint.py runs lint_problems() on every gate run, so the markers and the rows cannot drift apart. No dashes."""
import argparse
import html
import io
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import parity  # noqa: E402  (the Latvian letters, the allowed names and the number reader are shared)

PAGES = (("lv", "site/index.html"), ("en", "site/en/index.html"))
ROWS = os.path.join(HERE, "editable.json")
LANG = {"lv": "latviešu", "en": "angliskais"}
# a marker is always the last attribute of its start tag, so build.py can drop it and leave the old bytes
MARK = re.compile(r'<([a-z][a-z0-9]*)\b([^<>]*?) data-edit="([^"<>]*)">')
TAG = re.compile(r"<(/?)([a-z][a-z0-9]*)\b[^<>]*>")
INLINE = re.compile(r'</?(?:strong|em|b)>|<br>|<(?:i|span) lang="[a-z]{2}">|</(?:i|span)>')
ID = re.compile(r"^([a-z][a-z-]*)\.([1-9][0-9]*)$")
ROW_KEYS = {"id", "section", "label", "lv_max", "en_max", "attr", "fixed_numbers"}

DASHES = re.compile("[\u2012\u2013\u2014\u2015]")
URL = re.compile(r"(?i)\b(?:https?:|ftp:|www\.)\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b")
PHONE = re.compile(r"\+\s*\d|\d(?:[\s().-]*\d){6,}")
LETTER = "a-zāčēģīķļņšūž"
EURO = re.compile("\u20ac|(?<![%s])(?:eur|euro|eiro)(?![%s])" % (LETTER, LETTER), re.I)
# browsers read some entities even without the semicolon (&lt), so any & right before a letter or # counts
ENTITY = re.compile(r"&#?[0-9a-zA-Z]")
LATVIAN_SPAN = re.compile(r'<(i|span) lang="lv">.*?</\1>', re.S)


class Slot:
    def __init__(self, ident, attr, raw, line):
        self.id, self.attr, self.raw, self.line = ident, attr, raw, line


def norm_newlines(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def line_at(src, pos):
    return src.count("\n", 0, pos) + 1


def close_of(src, tag, start):
    """Where the element opened just before start ends: the position of its matching </tag>."""
    depth = 0
    for m in TAG.finditer(src, start):
        if m.group(2) != tag:
            continue
        if m.group(1):
            if depth == 0:
                return m.start()
            depth -= 1
        elif not m.group(0).endswith("/>"):
            depth += 1
    raise ValueError("no </%s> after line %d" % (tag, line_at(src, start)))


def cut(src, rows):
    """Split a page into its frame and its slots: src == frame[0] + slot[0].raw + frame[1] + ... + frame[n]."""
    frame, slots, pos = [], [], 0
    for m in MARK.finditer(src):
        tag, attrs, ident = m.groups()
        attr = (rows.get(ident) or {}).get("attr")
        if attr:
            a = re.search(r'(?:^|\s)%s="([^"]*)"' % re.escape(attr), attrs)
            if not a:
                raise ValueError("%s has no %s" % (ident, attr))
            start, end = m.start(2) + a.start(1), m.start(2) + a.end(1)
        else:
            start = m.end()
            end = close_of(src, tag, start)
        frame.append(src[pos:start])
        slots.append(Slot(ident, attr, src[start:end], line_at(src, start)))
        pos = end
    frame.append(src[pos:])
    return frame, slots


def pieces(raw):
    """The words of a slot, its inline tags taken out."""
    return TAG.split(raw)[::3]


def text(raw, attr=None):
    """What a visitor reads: the words joined by single spaces (a caption is all words, tags or not)."""
    return " ".join(html.unescape(raw if attr else " ".join(pieces(raw))).split())


def scan_text(raw):
    """The words that must be English on the English page: anything inside lang="lv" is left out."""
    return text(LATVIAN_SPAN.sub(" ", raw))


def fill(new, frame):
    """The new page read against the base's frame: the new slot contents, or (None, line) where the frame differs."""
    if not new.startswith(frame[0]):
        return None, first_diff(new, frame[0])
    pos, out = len(frame[0]), []
    for f in frame[1:-1]:
        i = new.find(f, pos)
        if i < 0:
            return None, line_at(new, pos)
        out.append(new[pos:i])
        pos = i + len(f)
    end = len(new) - len(frame[-1])
    if end < pos or not new.endswith(frame[-1]):
        tail = frame[-1]
        k = 0
        while k < min(len(tail), len(new)) and new[len(new) - 1 - k] == tail[len(tail) - 1 - k]:
            k += 1
        return None, line_at(new, max(pos, len(new) - k))
    out.append(new[pos:end])
    return out, None


def first_diff(a, b):
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return line_at(a, i)


def read_text(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def load_rows(path=ROWS):
    with io.open(path, encoding="utf-8") as f:
        return {r["id"]: r for r in json.load(f)["slots"]}


def markup_problems(label, base_raw, new_raw, attr):
    """A slot holds words only: its inline tags exactly as on the base, no < > or entity, no " in a caption."""
    out = []
    if attr:
        if '"' in new_raw:
            out.append('%s: bildes parakstā nedrīkst būt taisnās pēdiņas ("); liec „ un ”.' % label)
        if re.search(r"[<>]", new_raw) or ENTITY.search(new_raw):
            out.append("%s: tekstā nedrīkst būt zīmes < un > vai HTML kods." % label)
    elif [t.group(0) for t in TAG.finditer(new_raw)] != [t.group(0) for t in TAG.finditer(base_raw)]:
        out.append("%s: teksta noformējums jāatstāj kā bija (treknraksts, rindu pārnesumi), un HTML kodu "
                   "pievienot nedrīkst." % label)
    elif any(re.search(r"[<>]", p) for p in pieces(new_raw)) or ENTITY.search(new_raw):
        out.append("%s: tekstā nedrīkst būt zīmes < un > vai HTML kods." % label)
    if "data-edit" in new_raw and not out:
        out.append("%s: tekstā nedrīkst būt HTML kods (data-edit)." % label)
    return out


def slot_problems(label, side, base_raw, new_raw, attr):
    """What is wrong with one new text on its own (markup, addresses, dashes, money, characters)."""
    out = markup_problems(label, base_raw, new_raw, attr)
    t = text(new_raw, attr)
    raw_words = new_raw if attr else "".join(pieces(new_raw))
    if not t:
        out.append("%s: %s teksts nevar būt tukšs." % (label, LANG[side]))
        return out
    odd = [c for c in raw_words if unicodedata.category(c) in ("Cc", "Cf", "Co", "Cs", "Cn", "Zl", "Zp")
           and c not in "\n\t"]
    if odd or unicodedata.normalize("NFC", raw_words) != raw_words:
        out.append("%s: tekstā ir neredzamas vai neparastas rakstzīmes; ieraksti to no jauna." % label)
    for m in URL.finditer(t):
        out.append('%s: tekstā nedrīkst būt tīmekļa adreses ("%s"). Ja tas ir teikuma beigu punkts, aiz tā '
                   "liec atstarpi." % (label, m.group(0)))
        break
    if "@" in t:
        out.append("%s: tekstā nedrīkst būt e-pasta adreses. Kontaktus maina Deniss." % label)
    if PHONE.search(t):
        out.append('%s: tekstā nedrīkst būt tālruņa numuri ("%s"). Kontaktus maina Deniss.'
                   % (label, PHONE.search(t).group(0).strip()))
    if DASHES.search(t):
        out.append("%s: garās domuzīmes nedrīkst; liec parasto defisi (-)." % label)
    if EURO.search(t):
        out.append("%s: cenas un valūtu (eiro zīmi, EUR) lapā neliek. Cenas maina Deniss." % label)
    return out


def check(base, new, changed_files, rows):
    """base and new: {"lv": page text, "en": page text} (new may hold None for a missing page); changed_files:
    the paths that differ from the base. Returns (refusals, changed slots), refusals as plain Latvian lines."""
    refusals, changed = [], []
    names = dict(PAGES)
    for path in sorted(set(changed_files) - set(names.values())):
        refusals.append("Mainīts fails, ko labot nedrīkst: %s. Labot drīkst tikai tekstus lapās "
                        "site/index.html un site/en/index.html." % path)
    olds, news = {}, {}
    for lang, path in PAGES:
        if new.get(lang) is None:
            refusals.append("Lapa %s ir izdzēsta vai nav atrodama." % path)
            continue
        b, n = norm_newlines(base[lang]), norm_newlines(new[lang])
        frame, slots = cut(b, rows)
        got, line = fill(n, frame)
        if got is None:
            refusals.append("%s: mainīts kaut kas ārpus labojamajiem tekstiem (ap %d. rindu). Labot drīkst tikai "
                            "tekstus, kas iezīmēti ar data-edit." % (path, line))
            continue
        olds[lang] = {s.id: s for s in slots}
        news[lang] = dict(zip((s.id for s in slots), got))
    if len(news) < 2:
        return refusals, changed

    for ident in olds["lv"]:
        row = rows.get(ident, {"label": ident})
        label = "%s (%s)" % (row["label"], ident)
        base_raw = {k: olds[k][ident].raw for k in ("lv", "en")}
        new_raw = {k: news[k][ident] for k in ("lv", "en")}
        attr = row.get("attr")
        # changed = anything but spacing, so a tag added around the same words counts too
        moved = {k: new_raw[k].split() != base_raw[k].split() for k in ("lv", "en")}
        if not (moved["lv"] or moved["en"]):
            continue
        changed.append(label)
        for k in ("lv", "en"):
            if not moved[k]:
                continue
            refusals += slot_problems(label, k, base_raw[k], new_raw[k], attr)
            cap = row.get(k + "_max")
            n = len(text(new_raw[k], attr))
            if cap and n > cap:
                refusals.append("%s: %s teksts ir %d zīmes garš, atļauts līdz %d. Saīsini."
                                % (label, LANG[k], n, cap))
            if row.get("fixed_numbers") and \
                    parity.numbers(text(new_raw[k], attr)) != parity.numbers(text(base_raw[k], attr)):
                refusals.append("%s: skaitļus šajā tekstā (viesu skaits) maina tikai Deniss." % label)
        if moved["lv"] != moved["en"]:
            refusals.append("%s: mainīts tikai %s teksts; abas valodas jāmaina kopā."
                            % (label, LANG["lv" if moved["lv"] else "en"]))
            continue
        lv, en = text(new_raw["lv"], attr), text(new_raw["en"], attr)
        for word in re.findall(r"\w+", en if attr else scan_text(new_raw["en"])):
            if parity.LV_LETTERS.search(word) and word.lower() not in parity.ALLOWED_LV_WORDS:
                refusals.append('%s: angliskajā tekstā ir latviešu burti ("%s").' % (label, word))
                break
        if lv == en and lv not in parity.NEUTRAL:
            refusals.append("%s: angliskais teksts ir tāds pats kā latviešu; tas jāiztulko." % label)
        if parity.numbers(lv) != parity.numbers(en):
            refusals.append("%s: skaitļi latviešu un angļu tekstā atšķiras (%s un %s)."
                            % (label, ", ".join(parity.numbers(lv)) or "nav", ", ".join(parity.numbers(en)) or "nav"))
    return refusals, changed


def inventory(lv, en, rows):
    """The markers and the rows, for lint: English lines, empty when all is in order."""
    out = []
    marks = {}
    for lang, src in (("lv", lv), ("en", en)):
        src = norm_newlines(src)
        found = list(MARK.finditer(src))
        if src.count("data-edit") != len(found):
            out.append('check_edit: %s has a data-edit that is not the last attribute of its start tag, written '
                       'as data-edit="<section>.<n>"' % dict(PAGES)[lang])
        ids = [m.group(3) for m in found]
        for ident in sorted({i for i in ids if ids.count(i) > 1}):
            out.append("check_edit: %s carries %s twice" % (dict(PAGES)[lang], ident))
        for m in found:
            ident = m.group(3)
            idm = ID.match(ident)
            if not idm:
                out.append("check_edit: %s: bad id %r (want <section>.<n>)" % (dict(PAGES)[lang], ident))
                continue
            sec = section_at(src, m.start())
            if idm.group(1) != sec:
                out.append("check_edit: %s: %s sits in %s" % (dict(PAGES)[lang], ident, sec))
        marks[lang] = ids
        try:
            _, slots = cut(src, rows)
        except ValueError as e:
            out.append("check_edit: %s: %s" % (dict(PAGES)[lang], e))
            continue
        for s in slots:
            row = rows.get(s.id)
            if not row:
                continue
            if s.attr:
                if re.search(r'[<>"]', s.raw) or ENTITY.search(s.raw):
                    out.append("check_edit: %s: %s holds markup or an entity" % (dict(PAGES)[lang], s.id))
            else:
                bad = [t.group(0) for t in TAG.finditer(s.raw) if not INLINE.fullmatch(t.group(0))]
                if bad or any(re.search(r"[<>]", p) for p in pieces(s.raw)) or ENTITY.search(s.raw):
                    out.append("check_edit: %s: %s holds markup a slot may not hold: %s"
                               % (dict(PAGES)[lang], s.id, " ".join(bad)[:80] or "< > or an entity"))
            n = len(text(s.raw, s.attr))
            if not n:
                out.append("check_edit: %s: %s is empty" % (dict(PAGES)[lang], s.id))
            cap = row.get(lang + "_max")
            if isinstance(cap, int) and n > cap:
                out.append("check_edit: %s is %d characters in %s, over its %s_max %d"
                           % (s.id, n, lang, lang, cap))
    if marks.get("lv") != marks.get("en"):
        out.append("check_edit: the two pages carry different data-edit ids or a different order")
    ids = set(marks.get("lv", []))
    for ident in sorted(ids - set(rows)):
        out.append("check_edit: %s has no row in tools/editable.json" % ident)
    for ident in sorted(set(rows) - ids):
        out.append("check_edit: tools/editable.json row %s has no element on the pages" % ident)
    for ident, row in sorted(rows.items()):
        extra = set(row) - ROW_KEYS
        if extra:
            out.append("check_edit: row %s has unknown keys %s" % (ident, sorted(extra)))
        if not isinstance(row.get("label"), str) or not row["label"].strip():
            out.append("check_edit: row %s has no label" % ident)
        if ID.match(ident) and row.get("section") != ID.match(ident).group(1):
            out.append("check_edit: row %s says section %r" % (ident, row.get("section")))
        for k in ("lv_max", "en_max"):
            if not isinstance(row.get(k), int) or isinstance(row.get(k), bool) or row[k] < 1:
                out.append("check_edit: row %s needs a whole number %s" % (ident, k))
        if row.get("attr") not in (None, "data-caption"):
            out.append("check_edit: row %s: attr may only be data-caption" % ident)
        if not isinstance(row.get("fixed_numbers", False), bool):
            out.append("check_edit: row %s: fixed_numbers is true or false" % ident)
    return out


def section_at(src, pos):
    """The id of the section around pos, or footer for the page footer."""
    head = src[:pos]
    s, e = head.rfind("<section"), head.rfind("</section>")
    if s > e:
        m = re.match(r'<section\b[^>]*\bid="([^"]+)"', src[s:])
        return m.group(1) if m else "?"
    f, fe = head.rfind('<footer class="footer"'), head.rfind("</footer>")
    return "footer" if f > fe else "?"


def lint_problems(site):
    """Run by lint.py: the two pages against editable.json, and no marker on any other page."""
    read = lambda p: read_text(os.path.join(site, p.replace("/", os.sep)))
    try:
        rows = load_rows()
    except (OSError, ValueError, KeyError, TypeError) as e:
        return ["check_edit: tools/editable.json does not read: %s" % e]
    out = inventory(read("index.html"), read("en/index.html"), rows)
    for dp, _, fn in os.walk(site):
        for f in fn:
            p = os.path.relpath(os.path.join(dp, f), site).replace(os.sep, "/")
            if f.endswith(".html") and p not in ("index.html", "en/index.html") and "data-edit" in read(p):
                out.append("check_edit: %s carries a data-edit marker; only the two home pages may" % p)
    return out


# the command line: everything below reads git, nothing above does

def git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True)
    if r.returncode:
        raise RuntimeError("git %s: %s" % (" ".join(args), r.stderr.decode("utf-8", "replace").strip()[:200]))
    return r.stdout


def show(repo, specs):
    """Several <commit>:<path> files in one git call (each git start is slow on some Windows machines); None for
    each one that is missing."""
    r = subprocess.run(["git", "-C", repo, "cat-file", "--batch"], input="".join(s + "\n" for s in specs).encode(),
                       capture_output=True)
    if r.returncode:
        raise RuntimeError("git cat-file: %s" % r.stderr.decode("utf-8", "replace").strip()[:200])
    out, buf = [], r.stdout
    for _ in specs:
        head, _, buf = buf.partition(b"\n")
        bits = head.split()
        if len(bits) == 3 and bits[1] == b"blob":
            size = int(bits[2])
            out.append(buf[:size].decode("utf-8"))
            buf = buf[size + 1:]
        else:
            out.append(None)
    return out


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Refuse every change but new words in the data-edit texts.")
    ap.add_argument("--base", help="the base to compare with (default main, else origin/main)")
    ap.add_argument("--head", help="a commit to check instead of the working tree")
    ap.add_argument("--rows", default=ROWS, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    try:
        repo = git(os.getcwd(), "rev-parse", "--show-toplevel").decode("utf-8").strip()
        base_sha = None
        for cand in [a.base] if a.base else ["main", "origin/main"]:
            r = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", cand + "^{commit}"],
                               capture_output=True)
            if r.returncode == 0:
                base_sha = r.stdout.decode().strip()
                break
        if not base_sha:
            raise RuntimeError("no %s to compare with" % (a.base or "main or origin/main (pass --base)"))
        rows = load_rows(a.rows)
        if a.head:
            head_sha = git(repo, "rev-parse", "--verify", a.head + "^{commit}").decode().strip()
            if git(repo, "merge-base", base_sha, head_sha).decode().strip() != base_sha:
                print("NEDRĪKST (1):")
                print("- Labojums sākts no vecākas lapas versijas. Sāc no jauna no jaunākās versijas.")
                return 1
            got = show(repo, ["%s:%s" % (sha, path) for sha in (base_sha, head_sha) for _, path in PAGES])
            old, new = dict(zip(("lv", "en"), got[:2])), dict(zip(("lv", "en"), got[2:]))
            files = git(repo, "diff", "--name-only", "--no-renames", "-z", base_sha, head_sha)
        else:
            old = dict(zip(("lv", "en"), show(repo, ["%s:%s" % (base_sha, path) for _, path in PAGES])))
            files = git(repo, "diff", "--name-only", "--no-renames", "-z", base_sha) + \
                git(repo, "ls-files", "--others", "--exclude-standard", "-z")
            new = {}
            for lang, path in PAGES:
                p = os.path.join(repo, path.replace("/", os.sep))
                new[lang] = read_text(p) if os.path.exists(p) else None
        if None in old.values():
            raise RuntimeError("the base has no site/index.html or site/en/index.html")
        changed_files = [f for f in files.decode("utf-8").split("\0") if f]
        refusals, changed = check(old, new, changed_files, rows)
    except (RuntimeError, ValueError, OSError, KeyError, UnicodeDecodeError) as e:
        print("check_edit: could not run: %s" % e)
        return 2
    if refusals:
        print("NEDRĪKST (%d):" % len(refusals))
        for r in refusals:
            print("- " + r)
        return 1
    if not changed:
        print("LABI: neviens teksts nav mainīts.")
    else:
        n = len(changed)
        print("LABI: izmaiņa atbilst noteikumiem. %s:" % (
            "Mainīts %d teksts" % n if n % 10 == 1 and n % 100 != 11 else "Mainīti %d teksti" % n))
        for c in changed:
            print("- " + c)
    return 0


if __name__ == "__main__":
    sys.exit(main())

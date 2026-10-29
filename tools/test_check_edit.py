"""test_check_edit.py: the unit tests of tools/check_edit.py, run by the gate (npm test). Standard library only.

The rule tests run on two small pages written below, never on the live wording, so an edit of the real texts can
never break them: one valid edit passes, and every rule has its own bad edit that it must refuse with its own line
(and nothing else may fire). Then the live pages: the markers match tools/editable.json, the pages pass against
themselves, each of their marked texts takes an edit, and build.py gives the same HTML with or without the markers.
Last, the command line in a throwaway git repo (skipped when git is missing).
Usage: python tools/test_check_edit.py [-v]"""
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
import check_edit as ce  # noqa: E402

LV = """<!doctype html>
<html lang="lv">
<head><title>Proba</title></head>
<body>
<header><a href="tel:+37129338444">+371 29338444</a></header>
<section class="hero" id="sakums">
  <h1 data-edit="sakums.1">Svinības meža malā</h1>
  <p class="facts">līdz 45 viesiem</p>
</section>
<section id="par-mums">
  <h2 data-edit="par-mums.1">Vieta atpūtai</h2>
  <p data-edit="par-mums.2"><strong>Vēlaties ballīti?</strong><br>Te ir vieta svinībām.</p>
</section>
<section id="svinibas">
  <h2 data-edit="svinibas.1">Zāle līdz 45 viesiem</h2>
</section>
<section id="pirts">
  <ul><li data-edit="pirts.1">Pirts ir kurināma ar malku</li></ul>
</section>
<section id="galerija">
  <ul><li><a class="tile" href="img/a.webp" data-caption="Zāle vakarā" data-edit="galerija.1"><img src="img/a.webp" alt="Zāle vakarā"></a></li></ul>
</section>
<footer class="footer"><p class="bear" data-edit="footer.1">„Atceries par mani.”</p><p>Tālrunis +371 29338444</p></footer>
</body>
</html>
"""
EN = """<!doctype html>
<html lang="en">
<head><title>Test</title></head>
<body>
<header><a href="tel:+37129338444">+371 29338444</a></header>
<section class="hero" id="sakums">
  <h1 data-edit="sakums.1">Celebrations by the forest</h1>
  <p class="facts">up to 45 guests</p>
</section>
<section id="par-mums">
  <h2 data-edit="par-mums.1">A place to relax</h2>
  <p data-edit="par-mums.2"><strong>Want a party?</strong><br>Here is room to celebrate.</p>
</section>
<section id="svinibas">
  <h2 data-edit="svinibas.1">A hall for up to 45 guests</h2>
</section>
<section id="pirts">
  <ul><li data-edit="pirts.1">The sauna is a wood-fired Latvian <i lang="lv">pirts</i></li></ul>
</section>
<section id="galerija">
  <ul><li><a class="tile" href="img/a.webp" data-caption="The hall in the evening" data-edit="galerija.1"><img src="img/a.webp" alt="The hall in the evening"></a></li></ul>
</section>
<footer class="footer"><p class="bear" data-edit="footer.1">“Remember me.”</p><p>Phone +371 29338444</p></footer>
</body>
</html>
"""
ROWS = {r["id"]: r for r in [
    {"id": "sakums.1", "section": "sakums", "label": "Sākums: virsraksts", "lv_max": 30, "en_max": 40},
    {"id": "par-mums.1", "section": "par-mums", "label": "Par mums: virsraksts", "lv_max": 40, "en_max": 40},
    {"id": "par-mums.2", "section": "par-mums", "label": "Par mums: rindkopa", "lv_max": 80, "en_max": 80},
    {"id": "svinibas.1", "section": "svinibas", "label": "Svinības: virsraksts", "lv_max": 40, "en_max": 40,
     "fixed_numbers": True},
    {"id": "pirts.1", "section": "pirts", "label": "Pirts: punkts", "lv_max": 60, "en_max": 80},
    {"id": "galerija.1", "section": "galerija", "label": "Galerija: paraksts", "lv_max": 30, "en_max": 40,
     "attr": "data-caption"},
    {"id": "footer.1", "section": "footer", "label": "Apakša: lāča teikums", "lv_max": 40, "en_max": 40},
]}
PAGES = ["site/index.html", "site/en/index.html"]


def edit(src, pairs):
    for old, new in pairs:
        assert src.count(old) == 1, "test setup: %r is not in the page once" % old
        src = src.replace(old, new)
    return src


def run(lv=(), en=(), files=PAGES, new_lv=None, new_en=None):
    new = {"lv": edit(LV, lv) if new_lv is None else new_lv, "en": edit(EN, en) if new_en is None else new_en}
    return ce.check({"lv": LV, "en": EN}, new, files, ROWS)


class Rules(unittest.TestCase):
    def only(self, result, *needles):
        """Refused, and every refusal is one of the expected kinds (so no other rule misfires)."""
        refusals = result[0]
        self.assertTrue(refusals, "nothing was refused")
        for r in refusals:
            self.assertTrue(any(n in r for n in needles), "unexpected refusal: " + r)
        for n in needles:
            self.assertTrue(any(n in r for r in refusals), "no refusal says %r: %s" % (n, refusals))

    def test_pass_a_valid_edit(self):
        """PASS: new words in a heading, a bold-and-break paragraph, a bullet and a photo caption, both languages"""
        refusals, changed = run(
            lv=[("Vieta atpūtai", "Vieta mierīgai atpūtai"), ("Vēlaties ballīti?", "Gribat svinēt?"),
                ("Te ir vieta svinībām.", "Te pietiek vietas visiem."), ("ar malku", "ar bērza malku"),
                ('data-caption="Zāle vakarā"', 'data-caption="Zāle svētku vakarā"')],
            en=[("A place to relax", "A place for a quiet rest"), ("Want a party?", "Want to celebrate?"),
                ("Here is room to celebrate.", "There is room for everyone."),
                ('Latvian <i lang="lv">pirts</i>', 'Latvian <i lang="lv">pirtiņa</i>'),
                ('data-caption="The hall in the evening"', 'data-caption="The hall on a festive evening"')])
        self.assertEqual(refusals, [])
        self.assertEqual(len(changed), 4)
        self.assertIn("Par mums: rindkopa (par-mums.2)", changed)

    def test_pass_nothing_changed(self):
        """PASS: no change at all"""
        self.assertEqual(run(), ([], []))

    def test_pass_capacity_reworded_numbers_kept(self):
        """PASS: a fixed_numbers text reworded with its numbers unchanged"""
        self.assertEqual(run(lv=[("Zāle līdz 45 viesiem", "Plaša zāle līdz 45 viesiem")],
                             en=[("A hall for up to 45 guests", "A large hall for up to 45 guests")])[0], [])

    def test_pass_windows_line_endings(self):
        """PASS: the same valid edit read from a Windows checkout (CRLF)"""
        lv = edit(LV, [("Vieta atpūtai", "Vieta mierīgai atpūtai")]).replace("\n", "\r\n")
        en = edit(EN, [("A place to relax", "A place for a quiet rest")]).replace("\n", "\r\n")
        self.assertEqual(run(new_lv=lv, new_en=en)[0], [])

    def test_fail_other_file(self):
        """FAIL: any other file changed"""
        self.only(run(files=PAGES + ["site/css/site.css"]), "Mainīts fails, ko labot nedrīkst: site/css/site.css")

    def test_fail_page_missing(self):
        """FAIL: a page deleted"""
        r = ce.check({"lv": LV, "en": EN}, {"lv": LV, "en": None}, PAGES, ROWS)
        self.only(r, "site/en/index.html ir izdzēsta")

    def test_fail_text_outside_the_marked_texts(self):
        """FAIL: a change outside data-edit element text (the phone line)"""
        self.only(run(lv=[("Tālrunis +371 29338444", "Tālrunis +371 20000000")],
                      en=[("Phone +371 29338444", "Phone +371 20000000")]), "ārpus labojamajiem tekstiem")

    def test_fail_attribute_of_a_marked_element(self):
        """FAIL: a change to the tag around a marked text (its class)"""
        self.only(run(lv=[('<p class="bear" data-edit', '<p class="bear big" data-edit')],
                      en=[('<p class="bear" data-edit', '<p class="bear big" data-edit')]),
                  "ārpus labojamajiem tekstiem")

    def test_fail_new_element(self):
        """FAIL: a new element between the marked texts"""
        self.only(run(lv=[("</section>\n<section id=\"svinibas\">", "</section>\n<p>Jauns</p>\n<section id=\"svinibas\">")],
                      en=[("</section>\n<section id=\"svinibas\">", "</section>\n<p>New</p>\n<section id=\"svinibas\">")]),
                  "ārpus labojamajiem tekstiem")

    def test_fail_markup_tag(self):
        """FAIL: markup in a slot (a tag)"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta <b>atpūtai</b>")], en=[("A place to relax", "A place to <b>relax</b>")]),
                  "noformējums jāatstāj kā bija")

    def test_fail_markup_angle_bracket(self):
        """FAIL: markup in a slot (a lone < or >)"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta > atpūtai")], en=[("A place to relax", "A place > to relax")]),
                  "zīmes < un >")

    def test_fail_markup_entity(self):
        """FAIL: markup in a slot (an entity, with or without its semicolon; a marker written as text)"""
        for lv, en, says in (("Vieta &lt;atpūtai", "A place &lt;to relax", "zīmes < un >"),
                             ("Vieta &lt atpūtai", "A place &lt to relax", "zīmes < un >"),
                             ('Vieta data-edit="x"', 'A place data-edit="x"', "(data-edit)")):
            with self.subTest(lv):
                self.only(run(lv=[("Vieta atpūtai", lv)], en=[("A place to relax", en)]), says)

    def test_pass_ampersand_as_a_word(self):
        """PASS: a plain & between words is text, not markup"""
        self.assertEqual(run(lv=[("Vieta atpūtai", "Vieta & atpūta")], en=[("A place to relax", "Rest & relax")])[0], [])

    def test_fail_inline_tag_dropped(self):
        """FAIL: markup in a slot (the line break taken out, words unchanged)"""
        self.only(run(lv=[("?</strong><br>Te", "?</strong>Te")], en=[("?</strong><br>Here", "?</strong>Here")]),
                  "noformējums jāatstāj kā bija")

    def test_fail_slot_closed_early(self):
        """FAIL: markup in a slot (a closing tag that splits the heading in two)"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta</h2><h2>atpūtai")], en=[("A place to relax", "A place</h2><h2>to relax")]),
                  "noformējums jāatstāj kā bija")

    def test_fail_caption_quote(self):
        """FAIL: a straight quote in a photo caption (it would end the attribute)"""
        self.only(run(lv=[('caption="Zāle vakarā"', 'caption="Zāle" onclick="x"')],
                      en=[('caption="The hall in the evening"', 'caption="Hall" onclick="x"')]),
                  "taisnās pēdiņas")

    def test_fail_caption_markup(self):
        """FAIL: markup in a photo caption"""
        self.only(run(lv=[('caption="Zāle vakarā"', 'caption="Zāle <b>vakarā"')],
                      en=[('caption="The hall in the evening"', 'caption="The <b>hall"')]),
                  "zīmes < un >")

    def test_fail_web_address(self):
        """FAIL: a web address"""
        for lv, en in (("Skaties https://example.com", "See https://example.com"),
                       ("Skaties karumnieki.lv", "See karumnieki.lv"), ("Skaties www.piemers", "See www.piemers")):
            with self.subTest(lv):
                self.only(run(lv=[("Vieta atpūtai", lv)], en=[("A place to relax", en)]), "tīmekļa adreses")

    def test_fail_email_address(self):
        """FAIL: an e-mail address"""
        self.only(run(lv=[("Vieta atpūtai", "Raksti vards@pasts")], en=[("A place to relax", "Write to vards@pasts")]),
                  "e-pasta adreses")

    def test_fail_phone_number(self):
        """FAIL: a new phone number"""
        for lv, en in (("Zvani 29 338 444", "Call 29 338 444"), ("Zvani +371", "Call +371")):
            with self.subTest(lv):
                self.only(run(lv=[("Vieta atpūtai", lv)], en=[("A place to relax", en)]), "tālruņa numuri")

    def test_fail_long_dash(self):
        """FAIL: a long dash (en dash or em dash)"""
        for dash in ("\u2013", "\u2014"):
            with self.subTest(hex(ord(dash))):
                self.only(run(lv=[("Vieta atpūtai", "Vieta %s atpūtai" % dash)],
                              en=[("A place to relax", "A place %s to relax" % dash)]), "garās domuzīmes")

    def test_fail_euro_sign(self):
        """FAIL: the euro sign"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta 50 \u20ac")], en=[("A place to relax", "A place 50 \u20ac")]),
                  "cenas un valūtu")

    def test_fail_eur_word(self):
        """FAIL: eur, euro or eiro as a word"""
        for lv, en in (("Vieta par 50 EUR", "A place for 50 EUR"), ("Vieta par 50eiro", "A place for 50euro")):
            with self.subTest(lv):
                self.only(run(lv=[("Vieta atpūtai", lv)], en=[("A place to relax", en)]), "cenas un valūtu")

    def test_fail_over_the_latvian_cap(self):
        """FAIL: the Latvian text over its cap"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta atpūtai " * 4)], en=[("A place to relax", "A place to rest")]),
                  "latviešu teksts ir 55 zīmes garš, atļauts līdz 40")

    def test_fail_over_the_english_cap(self):
        """FAIL: the English text over its cap"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta mieram")], en=[("A place to relax", "A place to relax " * 3)]),
                  "angliskais teksts ir 50 zīmes garš, atļauts līdz 40")

    def test_fail_latvian_changed_without_english(self):
        """FAIL: LV changed without EN"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta mieram")]), "mainīts tikai latviešu teksts")

    def test_fail_english_changed_without_latvian(self):
        """FAIL: EN changed without LV"""
        self.only(run(en=[("A place to relax", "A place to rest")]), "mainīts tikai angliskais teksts")

    def test_fail_latvian_letters_in_english(self):
        """FAIL: Latvian letters in the English text"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta pirtij")], en=[("A place to relax", "A place for the pirtī")]),
                  'latviešu burti ("pirtī")')

    def test_fail_english_same_as_latvian(self):
        """FAIL: the English text the same as the Latvian"""
        self.only(run(lv=[("Vieta atpūtai", "Sauna un kubuls")], en=[("A place to relax", "Sauna un kubuls")]),
                  "tāds pats kā latviešu")

    def test_fail_digits_differ(self):
        """FAIL: digits that differ between LV and EN"""
        self.only(run(lv=[("Vieta atpūtai", "Vieta 3 istabās")], en=[("A place to relax", "A place in 4 rooms")]),
                  "skaitļi latviešu un angļu tekstā atšķiras (3 un 4)")

    def test_fail_capacity_number_changed(self):
        """FAIL: a number changed in a fixed_numbers text (the capacity)"""
        self.only(run(lv=[("Zāle līdz 45 viesiem", "Zāle līdz 50 viesiem")],
                      en=[("A hall for up to 45 guests", "A hall for up to 50 guests")]), "maina tikai Deniss")

    def test_fail_empty_text(self):
        """FAIL: a text left empty"""
        self.only(run(lv=[("Vieta atpūtai", "")], en=[("A place to relax", "")]), "nevar būt tukšs")

    def test_fail_invisible_characters(self):
        """FAIL: invisible or unusual characters (a zero-width space, letters not in NFC)"""
        for lv, en in (("Vieta\u200batpūtai", "A place\u200bto relax"), ("Vieta atpu\u0304tai", "A place to unwind")):
            with self.subTest(repr(lv)):
                self.only(run(lv=[("Vieta atpūtai", lv)], en=[("A place to relax", en)]), "neredzamas vai neparastas")


SITE = os.path.normpath(os.path.join(HERE, "..", "site"))


def live():
    return {"lv": ce.read_text(os.path.join(SITE, "index.html")), "en": ce.read_text(os.path.join(SITE, "en", "index.html"))}


class LivePages(unittest.TestCase):
    def test_markers_match_editable_json(self):
        """the live pages: every marker has its row, every row its marker, caps not below today's text"""
        self.assertEqual(ce.lint_problems(SITE), [])

    def test_live_pages_pass_against_themselves(self):
        pages = live()
        self.assertEqual(ce.check(pages, pages, [], ce.load_rows()), ([], []))

    def test_every_live_text_takes_an_edit(self):
        """each marked text on the live pages accepts new words in both languages"""
        rows, pages = ce.load_rows(), live()
        new = {}
        for lang, words in (("lv", "Jauns teksts"), ("en", "New text")):
            src = ce.norm_newlines(pages[lang])
            frame, slots = ce.cut(src, rows)
            out = [frame[0]]
            for s, f in zip(slots, frame[1:]):
                if rows[s.id].get("fixed_numbers"):
                    raw = ("Jauns " if lang == "lv" else "New ") + s.raw
                else:
                    raw = re.sub(r"(^|>)([^<>]*\S[^<>]*)(?=<|$)", lambda m: m.group(1) + words, s.raw)
                out += [raw, f]
            new[lang] = "".join(out)
        refusals, changed = ce.check(pages, new, ["site/index.html", "site/en/index.html"], rows)
        self.assertEqual(refusals, [])
        self.assertEqual(len(changed), len(rows))

    def test_build_drops_the_markers_and_nothing_else(self):
        """build.py gives the same HTML for a page with or without its markers"""
        for rel, src in (("index.html", live()["lv"]), ("en/index.html", live()["en"])):
            bare = re.sub(r' data-edit="[^"]*"(?=>)', "", src)
            self.assertNotEqual(bare, src)
            self.assertEqual(build.build_html(src, pathlib.Path(rel)), build.build_html(bare, pathlib.Path(rel)))


def git_in(repo, *args):
    return subprocess.run(["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid",
                           "-c", "core.autocrlf=false", "-C", repo] + list(args), capture_output=True, check=True)


def put(path, content):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def write_pages(repo, lv, en):
    put(os.path.join(repo, "site", "index.html"), lv)
    put(os.path.join(repo, "site", "en", "index.html"), en)


@unittest.skipUnless(shutil.which("git"), "git is not installed")
class CommandLine(unittest.TestCase):
    """One small repo is made once and copied for each test: on some Windows machines every git start is slow."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="check-edit-")
        cls.template = os.path.join(cls.tmp, "template")
        os.makedirs(os.path.join(cls.template, "site", "en"))
        cls.rows = os.path.join(cls.tmp, "editable.json")
        put(cls.rows, json.dumps({"slots": list(ROWS.values())}))
        git_in(cls.template, "init", "-q")
        git_in(cls.template, "symbolic-ref", "HEAD", "refs/heads/main")
        write_pages(cls.template, LV, EN)
        git_in(cls.template, "add", "-A")
        git_in(cls.template, "commit", "-q", "-m", "base")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.repo = os.path.join(self.tmp, self._testMethodName)
        shutil.copytree(self.template, self.repo)

    def git(self, *args):
        return git_in(self.repo, *args)

    def write(self, lv, en):
        write_pages(self.repo, lv, en)

    def commit(self, msg, new_file=False):
        if new_file:
            self.git("add", "-A")
        self.git("commit", "-q", "-a", "-m", msg)

    def cli(self, *args):
        r = subprocess.run([sys.executable, os.path.join(HERE, "check_edit.py"), "--rows", self.rows] + list(args),
                           cwd=self.repo, capture_output=True)
        return r.returncode, r.stdout.decode("utf-8")

    def valid(self):
        self.write(edit(LV, [("Vieta atpūtai", "Vieta mieram")]), edit(EN, [("A place to relax", "A place to rest")]))

    def test_working_tree(self):
        """the command line on the working tree: a valid edit exits 0, another file exits 1"""
        self.valid()
        code, out = self.cli()
        self.assertEqual(code, 0, out)
        self.assertIn("LABI", out)
        self.assertIn("Par mums: virsraksts (par-mums.1)", out)
        put(os.path.join(self.repo, "notes.txt"), "x")
        code, out = self.cli()
        self.assertEqual(code, 1, out)
        self.assertIn("Mainīts fails, ko labot nedrīkst: notes.txt", out)

    def test_head(self):
        """--head reads a commit through git: a valid one exits 0, one that adds a file exits 1"""
        self.git("checkout", "-q", "-b", "edit")
        self.valid()
        self.commit("edit")
        code, out = self.cli("--head", "edit")
        self.assertEqual(code, 0, out)
        put(os.path.join(self.repo, "tools.py"), "print(1)")
        self.commit("a file", new_file=True)
        code, out = self.cli("--head", "edit")
        self.assertEqual(code, 1, out)
        self.assertIn("tools.py", out)

    def test_stale_head(self):
        """--head refuses a commit that is not built on the base as it is now"""
        self.git("checkout", "-q", "-b", "edit")
        self.valid()
        self.commit("edit")
        self.git("checkout", "-q", "main")
        self.write(LV, edit(EN, [("Remember me.", "Remember us.")]))
        self.commit("main moved")
        code, out = self.cli("--head", "edit")
        self.assertEqual(code, 1, out)
        self.assertIn("vecākas lapas versijas", out)

    def test_no_base(self):
        """a base that does not exist exits 2"""
        code, out = self.cli("--base", "no-such-branch")
        self.assertEqual(code, 2, out)


if __name__ == "__main__":
    unittest.main(verbosity=2 if "-v" in sys.argv else 1, argv=[sys.argv[0]])

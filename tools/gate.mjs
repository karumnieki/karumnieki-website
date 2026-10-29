// gate.mjs: the whole test gate in one command, on both pages. Run it as `npm test` from the repo root.
// Usage: node tools/gate.mjs [--online] [--perf] [--port=8478] [--root=out/dist-test]
// --root runs every browser check on a build (tools/build.py --test) instead of site/; lint still reads site/.
// 1. lint.py: long dashes, html lang, every <img> has alt, width, height and an existing file, Lora only in .bear,
//    and parity.py (the English page must match the Latvian one tag for tag, image for image, link for link).
//    check-edit tests: tools/test_check_edit.py, every rule of tools/check_edit.py refusing its bad change.
// 2. Starts tools/serve.py on its own port (8478, so a preview you keep open on 8477 is left alone).
// 3. The browser checks, each on the Latvian page /site/ and the English page /site/en/:
//    shoot       screenshots at 390, 768, 1024 and 1440; fails on sideways scroll, console errors, 4xx/5xx
//                responses, failed local requests (a cancelled one is normal and ignored), elements running off
//                screen, the phone link or the hero
//                buttons below the first screen, or the sticky call bar not showing after a scroll on a phone
//    lb-test     the gallery lightbox at 1440 and 390, including the binding crop floors in tools/slots.json
//    focus-pass  every control reachable by Tab with a visible focus ring, at 1440, 1024 and 390
//    lang-test   the LV | EN switch, the header at 11 widths, every section landing both ways
//    form-fit    the enquiry form: required fields, e-mail optional, the thank-you dialog and focus
//    tag-test    Google Tag Manager loads only after a yes to analytics, and the four events reach the dataLayer
//    reviews-test the Atsauksmes block follows Google through the form Worker (a fixture here), and keeps its own
//                quotes when that fails
// form-worker: the enquiry Worker (form-worker/src/index.js) against a fake fetch: CORS, size, honeypot, timing, fields,
//    the e-mail and WhatsApp messages, one channel down, Turnstile, rate limit.
//    consent-test the cookie banner (first visit, no, yes, settings, expiry, nothing covered), the click-to-load map
//                and the policy pages the home page links to
// Since the banner (2026-10-04) every other browser check runs as a visitor who has already said no (visitor.mjs).
//    font-swap   the page does not jump when the web fonts arrive late
// --online adds links-test (opens Google, Facebook, Waze, WhatsApp and checks each lands where it should; needs the
// internet, and those pages change, so read a FAIL by hand before editing anything). --perf adds Lighthouse
// (slow; a report, never a FAIL). Everything a check writes goes to out/gate/. Exit code 1 if anything failed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'gate');
const args = process.argv.slice(2);
const online = args.includes('--online');
const perf = args.includes('--perf');
const buildRoot = (args.find(a => a.startsWith('--root=')) || '').slice(7);
const port = Number((args.find(a => a.startsWith('--port=')) || '--port=8478').slice(7));
const LV = `http://localhost:${port}/site/`;
const EN = LV + 'en/';
fs.mkdirSync(OUT, { recursive: true });

// python3 on a Mac or Linux, python on Windows; PYTHON=... overrides
const PY = process.env.PYTHON || [process.platform === 'win32' ? 'python' : 'python3', 'python3', 'python']
  .find(p => spawnSync(p, ['--version'], { encoding: 'utf8' }).status === 0);
if (!PY) { console.error('gate: no python found (install Python 3, or set PYTHON=/path/to/python)'); process.exit(2); }

const results = [];
const tail = (s, n) => s.trim().split(/\r?\n/).filter(Boolean).slice(-n);

function run(name, cmd, cmdArgs, judge) {
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const log = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  fs.writeFileSync(path.join(OUT, name.replace(/[^\w.-]+/g, '-') + '.log'), log);
  let ok = r.status === 0;
  let why = '';
  if (ok && judge) { const j = judge(); ok = j.ok; why = j.why || ''; }
  const secs = Math.round((Date.now() - t0) / 1000);
  const last = tail(log, 1)[0] || (r.error ? String(r.error) : '');
  results.push({ name, ok, secs });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${String(secs).padStart(4)}s  ${why || last}`.slice(0, 220));
  if (!ok) for (const l of tail(log, 12)) console.log('        ' + l);
  return ok;
}

// shoot.mjs writes its findings to <tag>-checks.json and always exits 0, so the gate reads them
function judgeShoot(dir, tag) {
  return () => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, tag + '-checks.json'), 'utf8'));
    const bad = [];
    for (const [w, r] of Object.entries(c.widths)) {
      if (!r.top.noHorizontalScroll) bad.push(`${w}: sideways scroll`);
      if (r.top.overflowing.length) bad.push(`${w}: off screen ${r.top.overflowing.join(', ')}`);
      if (!r.top.telAboveFold) bad.push(`${w}: no phone link on the first screen`);
      if (!r.top.ctaAboveFold) bad.push(`${w}: hero buttons below the first screen`);
      if (Number(w) < 768 && !(r.barAfterScroll && r.barAfterScroll.visible)) bad.push(`${w}: call bar not visible after scrolling`);
      if (r.consoleErrors.length) bad.push(`${w}: console ${r.consoleErrors.join(' | ')}`);
      if (r.responses4xx5xx.length) bad.push(`${w}: ${r.responses4xx5xx.join(', ')}`);
      // a local request that failed for any reason but a cancellation (the browser dropping a small srcset file
      // when it switches to a larger one mid-load is normal); a missing file shows up as a 404 above anyway
      const local = r.requestsFailed.filter(u => u.startsWith(`http://localhost:${port}/`) && !/ERR_ABORTED|cancel/i.test(u));
      if (local.length) bad.push(`${w}: failed ${local.join(', ')}`);
    }
    const heights = Object.entries(c.widths).map(([w, r]) => `${w}:${r.top.docHeight}`).join(' ');
    return bad.length ? { ok: false, why: bad.join('; ') } : { ok: true, why: `no sideways scroll, 0 errors, 0 bad responses; page height ${heights}` };
  };
}

// 1. lint, no server needed; the form Worker's own tests (node:test, a fake fetch: nothing is sent anywhere). The file,
// not the folder: Node 24 on Windows does not take a folder after --test
run('lint + parity', PY, ['tools/lint.py']);
run('check-edit tests', PY, ['tools/test_check_edit.py']);
run('form-worker', 'node', ['--test', 'form-worker/test/worker.test.mjs']);

// 2. the server
const srv = spawn(PY, ['tools/serve.py', String(port)].concat(buildRoot ? [buildRoot] : []), { cwd: ROOT, stdio: 'ignore' });
if (buildRoot) console.log(`gate: browser checks on the build in ${buildRoot}`);
const stop = () => { try { srv.kill(); } catch {} };
process.on('exit', stop);
let up = false;
for (let i = 0; i < 50 && !up; i++) {
  try { up = (await fetch(LV)).ok; } catch { await new Promise(r => setTimeout(r, 200)); }
}
if (!up) { console.error(`gate: serve.py did not answer on ${LV}`); stop(); process.exit(2); }

// 3. the browser checks
for (const [lang, url] of [['lv', LV], ['en', EN]]) {
  const dir = path.join(OUT, 'shoot-' + lang);
  run(`shoot ${lang}`, 'node', ['tools/shoot.mjs', url, dir, lang, '390,768,1024,1440'], judgeShoot(dir, lang));
  for (const w of ['1440', '390']) run(`lb-test ${lang} ${w}`, 'node', ['tools/lb-test.mjs', url, path.join(OUT, `lb-${lang}-${w}`), w]);
  for (const w of ['1440', '1024', '390']) run(`focus-pass ${lang} ${w}`, 'node', ['tools/focus-pass.mjs', url, path.join(OUT, `focus-${lang}-${w}`), w, '160']);
  run(`form-fit ${lang}`, 'node', ['tools/form-fit.mjs', url]);
  run(`tag-test ${lang}`, 'node', ['tools/tag-test.mjs', url]);
  run(`reviews-test ${lang}`, 'node', ['tools/reviews-test.mjs', url]);
  run(`consent-test ${lang}`, 'node', ['tools/consent-test.mjs', url]);
}
run('lang-test lv+en', 'node', ['tools/lang-test.mjs', LV, path.join(OUT, 'lang')]);
run('font-swap lv+en', 'node', ['tools/font-swap.mjs', LV]);
if (online) run('links-test lv+en', 'node', ['tools/links-test.mjs', LV, path.join(OUT, 'links')]);
if (perf) {
  for (const [lang, url] of [['lv', LV], ['en', EN]]) {
    const r = spawnSync('node', ['tools/perf.mjs', url, path.join(OUT, 'perf-' + lang), 'mobile,desktop', '--all'], { cwd: ROOT, encoding: 'utf8' });
    console.log(`REPORT  Lighthouse ${lang}\n` + tail(r.stdout || r.stderr || '', 12).map(l => '        ' + l).join('\n'));
  }
}
stop();

const failed = results.filter(r => !r.ok);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length} of ${results.length} checks passed` +
  (failed.length ? ` (failed: ${failed.map(r => r.name).join(', ')})` : '') + `. Logs and screenshots: out/gate/`);
process.exit(failed.length ? 1 : 0);

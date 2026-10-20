// perf.mjs: Lighthouse through Playwright's Chromium (lighthouse and playwright-core are in package.json). Reports the performance score, LCP, CLS, TBT and the LCP element, per emulated device.
// Usage: node perf.mjs <url> <outdir> [profiles=mobile,desktop] [--all]
// --all also runs Lighthouse's accessibility, best-practices and SEO categories and lists
// every audit in them that does not pass. The SEO score is expected to show "is-crawlable" failing while the
// preview carries noindex (build.py removes it); anything else listed there is a finding.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const all = process.argv.includes('--all');
const [url, outdirArg, profilesArg = 'mobile,desktop'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outdir = path.resolve(outdirArg);
fs.mkdirSync(outdir, { recursive: true });

const lighthouse = (await import('lighthouse')).default;

const PROFILES = {
  // Lighthouse's own defaults: mobile is throttled 4G + 4x CPU, desktop is near-native
  mobile: { formFactor: 'mobile', screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false } },
  desktop: {
    formFactor: 'desktop',
    screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
    throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
  },
};

const port = 9339;
const browser = await chromium.launch({ headless: true, args: ['--remote-debugging-port=' + port] });
const summary = {};
for (const name of profilesArg.split(',')) {
  const res = await lighthouse(url, { port, output: 'json', logLevel: 'error', onlyCategories: all ? ['performance', 'accessibility', 'best-practices', 'seo'] : ['performance'] }, {
    extends: 'lighthouse:default',
    settings: PROFILES[name],
  });
  const a = res.lhr.audits;
  const num = (id) => a[id] && a[id].numericValue != null ? Math.round(a[id].numericValue) : null;
  const lcpEl = a['largest-contentful-paint-element'];
  const row = {
    score: Math.round(res.lhr.categories.performance.score * 100),
    lcpMs: num('largest-contentful-paint'),
    fcpMs: num('first-contentful-paint'),
    cls: a['cumulative-layout-shift'] ? Math.round(a['cumulative-layout-shift'].numericValue * 1000) / 1000 : null,
    tbtMs: num('total-blocking-time'),
    speedIndexMs: num('speed-index'),
    totalBytes: num('total-byte-weight'),
    lcpElement: (lcpEl && lcpEl.details && lcpEl.details.items && lcpEl.details.items[0] && lcpEl.details.items[0].items
      && lcpEl.details.items[0].items[0] && lcpEl.details.items[0].items[0].node
      ? lcpEl.details.items[0].items[0].node.snippet : '').slice(0, 90),
  };
  summary[name] = row;
  fs.writeFileSync(path.join(outdir, 'lighthouse-' + name + '.json'), JSON.stringify(res.lhr, null, 1));
  console.log(name.padEnd(8) + ' score=' + row.score + '  LCP=' + row.lcpMs + 'ms  CLS=' + row.cls +
    '  TBT=' + row.tbtMs + 'ms  SI=' + row.speedIndexMs + 'ms  weight=' + Math.round(row.totalBytes / 1024) + 'KB');
  console.log('         LCP element: ' + row.lcpElement);
  if (all) {
    for (const cat of ['accessibility', 'best-practices', 'seo']) {
      const c = res.lhr.categories[cat];
      row[cat] = Math.round(c.score * 100);
      // an audit that counts and did not pass (score under 1; null = not applicable or informative)
      const failed = c.auditRefs.filter(r => r.weight > 0 && a[r.id] && a[r.id].score !== null && a[r.id].score < 1)
        .map(r => r.id + (a[r.id].details && a[r.id].details.items ? ' (' + a[r.id].details.items.length + ')' : ''));
      row[cat + 'Failed'] = failed;
      console.log('         ' + cat.padEnd(15) + row[cat] + (failed.length ? '  not passing: ' + failed.join(', ') : ''));
    }
  }
}
fs.writeFileSync(path.join(outdir, 'perf-summary.json'), JSON.stringify(summary, null, 2));
await browser.close();

// logo-wordmark.mjs: cut the owner's own "kārumnieki" lettering out of the lockup SVG as its own asset.
// A viewBox change, nothing redrawn, done in Chromium so no extra
// Python package is needed, and one step further: shapes outside the lettering band are removed, so the
// wordmark SVG is small. The lockup stacks bears / "kārumnieki" / "VIESU NAMS"; the two transparent bands
// between them are measured off a canvas render. Writes photos/web/logo-wordmark.svg and PNGs at 400 / 600 px.
// Usage: node logo-wordmark.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const WEB = fileURLToPath(new URL('../photos/web', import.meta.url)); // the photo masters, not in the repo
const svgText = fs.readFileSync(path.join(WEB, 'logo.svg'), 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 }, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><body style="margin:0;background:transparent"><div id="host"></div></body></html>');

const result = await page.evaluate(async (text) => {
  const host = document.getElementById('host');
  host.innerHTML = text;
  const svg = host.querySelector('svg');
  const vb = svg.viewBox.baseVal;
  const W = 1200;
  const H = Math.round(W * vb.height / vb.width);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.style.display = 'block';

  // 1. rasterise the lockup and find the transparent bands below the bears
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const gaps = [];
  let start = null;
  for (let y = 0; y < H; y++) {
    let ink = 0;
    for (let x = 0; x < W; x++) { if (data[(y * W + x) * 4 + 3] > 8) { ink = 1; break; } }
    if (!ink) { if (start === null) start = y; }
    else if (start !== null) { gaps.push([start, y - 1]); start = null; }
  }
  const mid = gaps.filter(g => g[1] - g[0] >= 3 && g[0] / H > 0.5);
  if (mid.length < 2) return { error: 'expected two transparent bands below the bears', gaps };
  const sy = vb.height / H;
  const bandTop = vb.y + (mid[0][1] + 1) * sy;
  const bandBottom = vb.y + mid[1][0] * sy;

  // 2. keep only the shapes whose rendered box lies inside that band
  const svgRect = svg.getBoundingClientRect();
  const scale = svgRect.width / vb.width;
  const shapes = Array.from(svg.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line, text, use, image'));
  let kept = 0, removed = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const el of shapes) {
    const r = el.getBoundingClientRect();
    const top = vb.y + (r.top - svgRect.top) / scale;
    const bottom = vb.y + (r.bottom - svgRect.top) / scale;
    const inside = r.width > 0 && top >= bandTop - 2 && bottom <= bandBottom + 2;
    if (inside) {
      kept++;
      minX = Math.min(minX, vb.x + (r.left - svgRect.left) / scale);
      maxX = Math.max(maxX, vb.x + (r.right - svgRect.left) / scale);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
    } else {
      el.remove();
      removed++;
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    svg.querySelectorAll('g').forEach(g => { if (!g.children.length) { g.remove(); changed = true; } });
  }
  svg.querySelectorAll('metadata, title, desc').forEach(e => e.remove());
  /* the lockup's clip path rectangle lies outside the band and was removed above; an empty clipPath would
     hide every letter, so drop the clip references and any now-empty clipPath or defs */
  svg.querySelectorAll('[clip-path]').forEach(e => e.removeAttribute('clip-path'));
  svg.querySelectorAll('clipPath').forEach(c => { if (!c.children.length) c.remove(); });
  svg.querySelectorAll('defs').forEach(d => { if (!d.children.length) d.remove(); });
  const pad = vb.width * 0.01;
  const nvb = [minX - pad, minY - pad, (maxX - minX) + 2 * pad, (maxY - minY) + 2 * pad];
  svg.setAttribute('viewBox', nvb.map(v => v.toFixed(2)).join(' '));
  svg.setAttribute('width', nvb[2].toFixed(2));
  svg.setAttribute('height', nvb[3].toFixed(2));
  return { gaps: mid, band: [bandTop, bandBottom], kept, removed, viewBox: nvb, svg: new XMLSerializer().serializeToString(svg) };
}, svgText);

if (result.error) { console.error(result); await browser.close(); process.exit(1); }
const out = path.join(WEB, 'logo-wordmark.svg');
fs.writeFileSync(out, result.svg, 'utf8');
console.log('wordmark: kept ' + result.kept + ' shapes, removed ' + result.removed + ', viewBox ' + result.viewBox.map(v => v.toFixed(1)).join(' ') + ', ' + Math.round(result.svg.length / 1024) + ' KB');

// 3. raster fallbacks, transparent, at 400 and 600 px wide
const b64 = Buffer.from(result.svg, 'utf8').toString('base64');
for (const w of [400, 600]) {
  await page.setContent('<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="data:image/svg+xml;base64,' + b64 + '" style="display:block;width:' + w + 'px;height:auto"></body></html>');
  await page.waitForSelector('#i');
  await page.evaluate(() => document.getElementById('i').decode());
  const el = await page.$('#i');
  const box = await el.boundingBox();
  await el.screenshot({ path: path.join(WEB, 'logo-wordmark-' + w + '.png'), omitBackground: true, type: 'png' });
  console.log('logo-wordmark-' + w + '.png: ' + Math.round(box.width) + 'x' + Math.round(box.height));
}
await browser.close();

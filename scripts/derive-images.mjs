#!/usr/bin/env node
// =====================================================================
// Make 400/800/1600 WebP derivatives from source photographs.
//
//   node scripts/derive-images.mjs <source-dir> <output-dir>
//
// The admin does this in the browser, on the machine of whoever is
// uploading, which is why the project needs no image library. This is
// the same job for photographs that arrive as a folder on disk —
// a bulk import, or a batch from the photographer — and it does it the
// same way: by driving headless Chrome and using the canvas encoder
// that every browser already ships.
//
// The alternative was adding `sharp`, which means a native binary, a
// node_modules tree, and a dependency that must be kept current for as
// long as the site lives. Chrome is already on the machine, so the
// honest cost of this approach is one subprocess.
//
// Chrome cannot write to disk, so the page POSTs each encoded blob
// back to a short-lived local server. Nothing listens outside
// localhost and the server exits as soon as the work is done.
// =====================================================================

import { createServer } from 'node:http';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SRC = resolve(process.argv[2] || 'photos');
const OUT = resolve(process.argv[3] || 'derivatives');
const SIZES = [400, 800, 1600];
const QUALITY = 0.82;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p;
  throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
}

if (!existsSync(SRC)) { console.error(`\n  No such directory: ${SRC}\n`); process.exit(1); }

const sources = readdirSync(SRC)
  .filter((f) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f))
  .sort();

if (!sources.length) { console.error(`\n  No images in ${SRC}\n`); process.exit(1); }

mkdirSync(OUT, { recursive: true });
console.log(`\n  ${sources.length} source image(s) -> ${SIZES.join('/')} WebP\n`);

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };

// The page. Same halving-downscale as static/admin/js/images.js: going
// straight from 2048px to 400px in one drawImage point-samples and
// leaves fine detail — a drill chuck, a pump nameplate — looking
// aliased.
const PAGE = `<!doctype html><meta charset="utf-8"><body><pre id="log"></pre><script>
window.onerror = (m) => { fetch('/fail?name=page&msg=' + encodeURIComponent(m), { method: 'POST' }); };
const SIZES = ${JSON.stringify(SIZES)}, QUALITY = ${QUALITY};
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function resize(src, sw, sh, tw, th) {
  let cur = src, cw = sw, ch = sh;
  while (cw / 2 > tw && ch / 2 > th) {
    const n = canvasOf(Math.round(cw / 2), Math.round(ch / 2));
    const x = n.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, n.width, n.height);
    cur = n; cw = n.width; ch = n.height;
  }
  const out = canvasOf(tw, th);
  const x = out.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, tw, th);
  return out;
}

const toBlob = (c) => new Promise((res, rej) =>
  c.toBlob((b) => b ? res(b) : rej(new Error('encode failed')), 'image/webp', QUALITY));

(async () => {
  const list = await (await fetch('/list')).json();
  for (const name of list) {
    try {
      const bmp = await createImageBitmap(await (await fetch('/src/' + encodeURIComponent(name))).blob());
      for (const size of SIZES) {
        const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const blob = await toBlob(resize(bmp, bmp.width, bmp.height, w, h));
        await fetch('/put?name=' + encodeURIComponent(name) + '&size=' + size +
                    '&w=' + w + '&h=' + h, { method: 'POST', body: blob });
      }
      bmp.close && bmp.close();
      log('ok ' + name);
    } catch (e) {
      await fetch('/fail?name=' + encodeURIComponent(name) +
                  '&msg=' + encodeURIComponent(e.message), { method: 'POST' });
    }
  }
  await fetch('/done', { method: 'POST' });
})();
</script>`;

const written = [];
const failed = [];
let pageServed = false;
let finish;
const allDone = new Promise((r) => { finish = r; });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'text/plain') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };

  if (process.env.DEBUG_DERIVE) console.log(`    <- ${req.method} ${url.pathname}`);
  if (url.pathname === '/') { pageServed = true; return send(200, PAGE, 'text/html; charset=utf-8'); }
  if (url.pathname === '/list') return send(200, JSON.stringify(sources), 'application/json');

  if (url.pathname.startsWith('/src/')) {
    const name = decodeURIComponent(url.pathname.slice(5));
    if (!sources.includes(name)) return send(404, 'no');
    return send(200, readFileSync(join(SRC, name)), TYPES[extname(name).toLowerCase()] || 'application/octet-stream');
  }

  if (url.pathname === '/put') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const name = url.searchParams.get('name');
    const size = url.searchParams.get('size');
    const file = join(OUT, `${basename(name, extname(name))}-${size}.webp`);
    writeFileSync(file, buf);
    written.push({ file, size: Number(size), bytes: buf.length,
                   w: Number(url.searchParams.get('w')), h: Number(url.searchParams.get('h')) });
    console.log(`  ${basename(file).padEnd(34)} ${String(url.searchParams.get('w')).padStart(5)}px  ${(buf.length / 1024).toFixed(0).padStart(5)}KB`);
    return send(200, 'ok');
  }

  if (url.pathname === '/fail') {
    failed.push(`${url.searchParams.get('name')}: ${url.searchParams.get('msg')}`);
    return send(200, 'ok');
  }

  if (url.pathname === '/done') { send(200, 'ok'); finish(); return; }
  return send(404, 'no');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const chrome = spawn(process.env.CHROME_PATH || findChrome(), [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(OUT, '.chrome-profile')}`,
  // NO --virtual-time-budget here. It fast-forwards the clock for
  // screenshotting and starves a page doing real network I/O, which
  // is why the first version of this script sat there producing
  // nothing at all.
  '--no-sandbox', '--disable-dev-shm-usage',
  `http://127.0.0.1:${port}/`,
], { stdio: 'ignore' });

// If Chrome never even asks for the page, say so plainly rather than
// sitting silent for ten minutes — which is exactly what the first
// version of this script did.
const startupCheck = setTimeout(() => {
  if (!pageServed) {
    console.error('\n  Chrome never requested the page — it is not reaching 127.0.0.1.');
    console.error('  Try CHROME_PATH=<path>, or check whether something blocks localhost.\n');
    chrome.kill(); server.close(); process.exit(1);
  }
}, 30000);

// A hung browser must not hang the build forever.
const timeout = setTimeout(() => {
  console.error(`\n  Timed out. ${written.length} derivative(s) written before the stall.\n`);
  chrome.kill(); server.close(); process.exit(1);
}, 600000);

await allDone;
clearTimeout(timeout);
clearTimeout(startupCheck);
chrome.kill();
server.close();

const total = written.reduce((n, w) => n + w.bytes, 0);
const srcTotal = sources.reduce((n, s) => n + readFileSync(join(SRC, s)).length, 0);
console.log(`\n  ${written.length} derivatives from ${sources.length} sources`);
console.log(`  ${(srcTotal / 1048576).toFixed(1)}MB of originals -> ${(total / 1024).toFixed(0)}KB of WebP`);
if (failed.length) {
  console.log(`\n  FAILED (${failed.length}):`);
  for (const f of failed) console.log(`    ${f}`);
}
console.log(`\n  -> ${OUT}\n`);
process.exit(failed.length ? 1 : 0);

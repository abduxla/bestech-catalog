#!/usr/bin/env node
// =====================================================================
// Preview server.
//
//   node scripts/serve.mjs            # http://localhost:4000
//   node scripts/serve.mjs --port 8080
//
// Serves dist/ exactly the way a CDN will: directory URLs resolve to
// index.html, unknown paths get 404.html, assets get long cache headers.
//
// This is for LOCAL PREVIEW ONLY. Nothing in production runs this file —
// production is dist/ uploaded to a CDN, with no Node process anywhere
// in the request path. That is the point of the whole architecture, and
// it is why this server can afford to be forty lines.
// =====================================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 4000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  // Strip the query, decode, and normalise away any "../" before it can
  // climb out of dist/.
  let path = decodeURIComponent(req.url.split('?')[0]);
  path = normalize(path).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';

  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // Hashed-content assets could be immutable; HTML must not be.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    try {
      const nf = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(nf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
    }
  }
}).listen(PORT, () => {
  console.log(`\n  Preview  ->  http://localhost:${PORT}\n  Serving  ->  ${ROOT}\n  Ctrl+C to stop.\n`);
});

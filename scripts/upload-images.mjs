#!/usr/bin/env node
// =====================================================================
// Upload WebP derivatives to object storage and record them.
//
//   node scripts/upload-images.mjs <derivatives-dir> <manifest.json>
//
// Takes the output of scripts/derive-images.mjs and a manifest saying
// where each image belongs, then uploads every size and writes the
// database rows that point at them.
//
// The manifest maps a derivative's base name to a destination:
//
//   { "impact-drill": { "product": "HG-ID13", "alt": "...", "position": 0 },
//     "cat-drills":   { "category": "drills" },
//     "hero":         { "division": "power-tools-machinery" } }
//
// Only the KEY is stored in the database — never a URL — so moving
// from Supabase Storage to Cloudflare R2 later is a bucket copy and a
// changed environment variable, with no rows to rewrite.
//
// Idempotent: uploads overwrite, and a product image at the same
// position is replaced rather than duplicated. Re-running after a
// partial failure is always safe.
// =====================================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const DIR = resolve(process.argv[2] || 'derivatives');
const MANIFEST = resolve(process.argv[3] || 'manifest.json');

// Load .env ourselves — no dotenv dependency for six lines of parsing.
const envFile = resolve('.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.IMAGE_BUCKET || 'product-images';
const SIZES = [400, 800, 1600];

if (!BASE || !KEY) {
  console.error('\n  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n');
  process.exit(1);
}
if (!existsSync(MANIFEST)) { console.error(`\n  No manifest at ${MANIFEST}\n`); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const JH = { ...H, 'Content-Type': 'application/json' };

async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...JH, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function putObject(key, body) {
  // PUT rather than POST: re-running must overwrite, not fail with
  // "already exists" and leave the catalogue half-updated.
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const available = new Set(
  readdirSync(DIR).filter((f) => f.endsWith('.webp'))
    .map((f) => basename(f).replace(/-(\d+)\.webp$/, '')));

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  console.log(`\n  Uploading to ${BUCKET}\n`);

  const [products, categories, divisions, brands] = await Promise.all([
    rest('products?select=id,sku,name'),
    rest('categories?select=id,slug,path,name'),
    rest('divisions?select=id,slug'),
    rest('brands?select=id,slug,name'),
  ]);
  const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]));
  const byCatSlug = new Map(categories.map((c) => [c.slug, c]));
  const byDivSlug = new Map(divisions.map((d) => [d.slug, d]));
  const byBrandSlug = new Map(brands.map((b) => [b.slug, b]));

  let uploaded = 0, linked = 0;
  const problems = [];

  for (const [name, dest] of Object.entries(manifest)) {
    if (!available.has(name)) { problems.push(`${name}: no derivatives found in ${DIR}`); continue; }

    // Work out the storage key from where it belongs.
    let key;
    if (dest.product) key = `products/${slugify(dest.product)}/${(dest.position ?? 0) + 1}`;
    else if (dest.category) key = `categories/${slugify(dest.category)}`;
    else if (dest.brand) key = `brands/${slugify(dest.brand)}`;
    else if (dest.division) key = `divisions/${slugify(dest.division)}`;
    // A bare storage key, for site furniture that belongs to no row -
    // editorial photography referenced by configuration rather than
    // by a foreign key.
    else if (dest.key) key = String(dest.key).replace(/^\/+/, '');
    else { problems.push(`${name}: manifest entry names no product, category, division or key`); continue; }

    let sizesDone = 0;
    for (const size of SIZES) {
      const file = join(DIR, `${name}-${size}.webp`);
      if (!existsSync(file)) continue;
      await putObject(`${key}-${size}.webp`, readFileSync(file));
      sizesDone++;
    }
    if (!sizesDone) { problems.push(`${name}: no size files on disk`); continue; }
    uploaded += sizesDone;

    // Record it.
    try {
      if (dest.product) {
        const p = bySku.get(String(dest.product).toUpperCase());
        if (!p) { problems.push(`${name}: no product with sku ${dest.product}`); continue; }
        const position = dest.position ?? 0;
        // Replace whatever is at this position rather than stacking a
        // duplicate on every re-run.
        const existing = await rest(
          `product_images?select=id&product_id=eq.${p.id}&position=eq.${position}`);
        const row = { product_id: p.id, storage_key: key, alt: dest.alt || p.name, position };
        if (existing.length) {
          await rest(`product_images?id=eq.${existing[0].id}`,
            { method: 'PATCH', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } });
        } else {
          await rest('product_images',
            { method: 'POST', body: JSON.stringify([row]), headers: { Prefer: 'return=minimal' } });
        }
      } else if (dest.category) {
        const c = byCatSlug.get(slugify(dest.category));
        if (!c) { problems.push(`${name}: no category "${dest.category}"`); continue; }
        await rest(`categories?id=eq.${c.id}`,
          { method: 'PATCH', body: JSON.stringify({ image_key: key }), headers: { Prefer: 'return=minimal' } });
      } else if (dest.brand) {
        const b = byBrandSlug.get(slugify(dest.brand));
        if (!b) { problems.push(`${name}: no brand "${dest.brand}"`); continue; }
        await rest(`brands?id=eq.${b.id}`,
          { method: 'PATCH', body: JSON.stringify({ logo_key: key }), headers: { Prefer: 'return=minimal' } });
      } else if (dest.key) {
        // Nothing to record: the key IS the reference.
      } else {
        const d = byDivSlug.get(slugify(dest.division));
        if (!d) { problems.push(`${name}: no division "${dest.division}"`); continue; }
        await rest(`divisions?id=eq.${d.id}`,
          { method: 'PATCH', body: JSON.stringify({ hero_key: key }), headers: { Prefer: 'return=minimal' } });
      }
      linked++;
      console.log(`  ${name.padEnd(18)} -> ${key}`);
    } catch (e) { problems.push(`${name}: ${e.message}`); }
  }

  console.log(`\n  ${uploaded} files uploaded, ${linked} records linked`);
  if (problems.length) {
    console.log(`\n  PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`    ${p}`);
  }
  console.log('');
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });

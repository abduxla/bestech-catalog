#!/usr/bin/env node
// =====================================================================
// Catalogue backup / export.
//
//   node scripts/backup.mjs                      # -> backups/catalogue-<stamp>.jsonl
//   node scripts/backup.mjs --out my-export.jsonl
//
// This writes THE SAME canonical JSONL that import/import.mjs reads
// (docs/import-format.md). That symmetry is the point, and it is what
// actually answers "what if we have to move off this database":
//
//     node scripts/backup.mjs                 # export from the old DB
//     SUPABASE_URL=<new> node import/import.mjs <file> --apply
//
// Moving to a different Postgres - Neon, RDS, a VPS, a different vendor
// entirely - is those two commands plus running the migrations. There is
// no proprietary dump format in the path, and no vendor-specific export
// to reverse-engineer. The catalogue is portable by construction rather
// than by promise.
//
// It is also the disaster answer. A bad bulk edit or a deleted range is
// recoverable from the most recent export, because the restore path is
// the same importer that is exercised every time the client loads a
// price list - not a cold restore procedure nobody has ever tested.
//
// RUN THIS ON A SCHEDULE. Nightly is plenty for a catalogue that changes
// a few times a week. An untested backup is not a backup.
// =====================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { queryAll } from '../lib/db.mjs';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');

// Date.now() rather than a passed-in stamp: this is a CLI, not a
// workflow script, so a wall-clock filename is correct here.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = outFlag >= 0 ? args[outFlag + 1] : `backups/catalogue-${stamp}.jsonl`;

async function main() {
  console.log('\n  Exporting catalogue...\n');

  // Paged reads - never a hardcoded limit that silently truncates.
  const [products, brands, categories, images, links] = await Promise.all([
    queryAll('products', {
      select: 'id,sku,slug,name,brand_id,primary_category_id,summary,description,specs,status,is_featured,sort',
      order: 'sku.asc',
    }),
    queryAll('brands', { select: 'id,slug,name', order: 'sort.asc' }),
    queryAll('categories', { select: 'id,slug,name,path', order: 'path.asc' }),
    queryAll('product_images', {
      select: 'product_id,storage_key,alt,width,height,position',
      order: 'product_id.asc,position.asc',
    }),
    queryAll('product_categories', { select: 'product_id,category_id' }),
  ]);

  const brandById = new Map(brands.map((b) => [b.id, b]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const imagesByProduct = new Map();
  for (const im of images) {
    if (!imagesByProduct.has(im.product_id)) imagesByProduct.set(im.product_id, []);
    imagesByProduct.get(im.product_id).push(im);
  }
  const catsByProduct = new Map();
  for (const l of links) {
    if (!catsByProduct.has(l.product_id)) catsByProduct.set(l.product_id, []);
    catsByProduct.get(l.product_id).push(l.category_id);
  }

  // Human-readable names, not opaque ids. A backup whose foreign keys
  // only resolve against the database it came from is useless for
  // moving to a new one - and unreadable when something goes wrong.
  const pathToLabel = (p) =>
    (catById.get(p) || {}).path
      ? catById.get(p).path.split('/').map((s) => (categories.find((c) => c.slug === s) || {}).name || s).join(' > ')
      : '';

  const lines = products.map((p) => {
    const rec = {
      sku: p.sku,
      slug: p.slug,
      name: p.name,
      brand: p.brand_id ? (brandById.get(p.brand_id) || {}).name || '' : '',
      category_path: p.primary_category_id ? pathToLabel(p.primary_category_id) : '',
      summary: p.summary || '',
      description: p.description || '',
      status: p.status,
      specs: Array.isArray(p.specs) ? p.specs : [],
    };
    // Extra fields the importer ignores but a human (or a future
    // migration) will want. Keeping them here costs nothing and means
    // the export is a complete record, not a lossy one.
    const extraCats = (catsByProduct.get(p.id) || [])
      .filter((cid) => cid !== p.primary_category_id)
      .map((cid) => pathToLabel(cid))
      .filter(Boolean);
    if (extraCats.length) rec._also_in = extraCats;

    const imgs = imagesByProduct.get(p.id) || [];
    if (imgs.length) {
      rec._images = imgs.map((i) => ({
        storage_key: i.storage_key, alt: i.alt, width: i.width, height: i.height,
      }));
    }
    if (p.is_featured) rec._is_featured = true;
    return JSON.stringify(rec);
  });

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

  console.log(`  products   ${products.length}`);
  console.log(`  brands     ${brands.length}`);
  console.log(`  categories ${categories.length}`);
  console.log(`  images     ${images.length}`);
  console.log(`\n  -> ${OUT}\n`);
  console.log('  Restore or migrate with:');
  console.log(`    node import/import.mjs ${OUT}            # dry run`);
  console.log(`    node import/import.mjs ${OUT} --apply\n`);

  // Images are NOT in this file - only their keys. The object store
  // needs its own copy; say so rather than let a reader assume the
  // catalogue is fully recoverable from one JSONL.
  if (images.length) {
    console.log('  NOTE: this exports image KEYS, not the image files.');
    console.log('        Back the object-store bucket up separately.\n');
  }
}

main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });

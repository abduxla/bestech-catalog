#!/usr/bin/env node
// =====================================================================
// Catalogue importer — STAGE 2 (format-agnostic).
//
//   node import/import.mjs <file.jsonl>            # dry run (default)
//   node import/import.mjs <file.jsonl> --apply    # actually write
//
// Reads the frozen canonical format documented in docs/import-format.md.
// It never sees the client's spreadsheet: a small disposable adapter
// converts that to JSONL first. Nothing here depends on the source
// format, which is why it can be finished and tested before the real
// catalogue file exists.
//
// Zero dependencies — talks to PostgREST over fetch, so there is no
// node_modules to install or keep current.
//
// Environment:
//   SUPABASE_URL              https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY service role key (server-side only, never
//                             in the site bundle)
//
// Guarantees, each closing a specific way importers destroy catalogues:
//   * DRY RUN IS THE DEFAULT. Writing needs --apply.
//   * ABSENCE IS NEVER DESTRUCTIVE. Products missing from the file are
//     reported, never deleted or auto-archived — partial files (one
//     brand, one division) are how distributors actually send updates.
//   * MATCH ON sku ONLY, via `on conflict (sku) do update`. Never on
//     name: rename the product in the sheet and a name-matcher silently
//     creates a duplicate.
//   * REJECT, NEVER GUESS. Unknown brand or category is an error, not a
//     side-effecting create.
//   * ONE BAD ROW NEVER STOPS THE FILE.
//   * status defaults to draft, so an import cannot silently publish.
// =====================================================================

import { readFileSync } from 'node:fs';
// All database access goes through the one seam, so moving off Supabase
// changes lib/db.mjs and nothing in here.
import { queryAll, upsert, assertCanWrite } from '../lib/db.mjs';

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');

function die(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

if (!FILE) die('usage: node import/import.mjs <file.jsonl> [--apply]');
// Checked even for a dry run: with a read-only key the importer would see
// only published rows, so every draft would be reported as a CREATE and
// the plan shown to the operator would be wrong.
try { assertCanWrite('Importing'); } catch (e) { die(e.message); }

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// ---------------------------------------------------------------------
// Validation. Returns [] when the row is importable, else the reasons.
// ---------------------------------------------------------------------
function validate(row, i, seenSku) {
  const errs = [];
  const sku = (row.sku ?? '').toString().trim();

  if (!sku) errs.push('missing sku (the model number) — rows are never given a generated one');
  else if (seenSku.has(sku)) errs.push(`duplicate sku "${sku}" (also on line ${seenSku.get(sku)})`);

  if (!(row.name ?? '').toString().trim()) errs.push('missing name');

  if (row.status && !['draft', 'published', 'archived'].includes(row.status)) {
    errs.push(`status "${row.status}" is not draft|published|archived`);
  }

  if (row.specs !== undefined && row.specs !== null) {
    if (!Array.isArray(row.specs)) {
      // The single most damaging mistake an adapter can make: a JSON
      // object silently loses row order and merges duplicate labels.
      errs.push('specs must be an ARRAY of sections, not an object');
    } else {
      row.specs.forEach((sec, si) => {
        if (!sec || typeof sec !== 'object' || Array.isArray(sec)) {
          errs.push(`specs[${si}] is not a section object`);
          return;
        }
        if (!Array.isArray(sec.rows)) {
          errs.push(`specs[${si}].rows must be an array`);
          return;
        }
        sec.rows.forEach((r, ri) => {
          if (!r || typeof r !== 'object') errs.push(`specs[${si}].rows[${ri}] is not an object`);
          else if (!(r.label ?? '').toString().trim()) errs.push(`specs[${si}].rows[${ri}] missing label`);
        });
      });
    }
  }
  if (sku && !errs.length) seenSku.set(sku, i + 1);
  return errs;
}

// Normalise to exactly the shape the products table expects. Every spec
// value is coerced to a string so "0-1300", "Φ10" and "Yes" all survive.
function normaliseSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs.map((sec) => ({
    title: sec.title ?? null,
    caption: sec.caption ?? null,
    rows: (sec.rows || []).map((r) => ({
      label: String(r.label ?? '').trim(),
      unit: String(r.unit ?? '').trim(),
      value: String(r.value ?? '').trim(),
    })),
  }));
}

// ---------------------------------------------------------------------
async function main() {
  const lines = readFileSync(FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  console.log(`\n  ${FILE} — ${lines.length} rows\n`);

  // Reference data. The importer resolves against what exists and
  // rejects anything it cannot match; it never creates a brand or a
  // category as a side effect of importing a product.
  // queryAll pages until exhausted. A plain fetch would be silently
  // capped by PostgREST, so a catalogue past the cap would import as
  // "all creates" and duplicate everything already in the database.
  const [brands, categories, existing] = await Promise.all([
    queryAll('brands', { select: 'id,slug,name', order: 'sort.asc' }),
    queryAll('categories', { select: 'id,parent_id,slug,name,path', order: 'path.asc' }),
    queryAll('products', {
      select: 'sku,slug,name,summary,description,status,specs,brand_id,primary_category_id',
      order: 'sku.asc',
    }),
  ]);

  const brandBy = new Map();
  for (const b of brands) { brandBy.set(b.slug, b); brandBy.set(slugify(b.name), b); }
  const catByPath = new Map(categories.map((c) => [c.path, c]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Categories are matched on their NAME as well as their slug.
  //
  // A slug is chosen for the URL and a name is written for people, and
  // the two routinely differ: "Arc / MMA Welders" slugifies to
  // "arc-mma-welders" but lives at "arc-welders". A spreadsheet will
  // always carry the name, so matching only on slugified names would
  // reject most of a real catalogue for no good reason.
  //
  // Keys can collide - "Accessories" under two parents - so each key
  // holds every candidate and an ambiguous match is REJECTED with the
  // options listed, never silently resolved to the first one.
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const catByKey = new Map();
  const addKey = (k, c) => {
    if (!k) return;
    if (!catByKey.has(k)) catByKey.set(k, []);
    const bucket = catByKey.get(k);
    if (!bucket.includes(c)) bucket.push(c);
  };
  for (const c of categories) { addKey(norm(c.slug), c); addKey(norm(c.name), c); }
  const existingBy = new Map(existing.map((p) => [p.sku, p]));

  const creates = [], updates = [], rejects = [], slugChanges = [];
  const seenSku = new Map();

  lines.forEach((line, i) => {
    let row;
    try { row = JSON.parse(line); }
    catch { rejects.push({ line: i + 1, sku: '?', errs: ['not valid JSON'] }); return; }

    const errs = validate(row, i, seenSku);
    const sku = (row.sku ?? '').toString().trim();

    // Resolve brand
    let brand_id = null;
    if (row.brand) {
      const b = brandBy.get(slugify(row.brand));
      if (!b) errs.push(`unknown brand "${row.brand}" — add it first, the importer will not invent one`);
      else brand_id = b.id;
    }

    // Resolve category: full " > " path, else the leaf name
    let primary_category_id = null;
    if (row.category_path) {
      const raw = String(row.category_path).split('>').map((x) => x.trim()).filter(Boolean);
      const slugPath = raw.map((x) => slugify(x)).join('/');
      const leaf = raw[raw.length - 1];
      const parent = raw.length > 1 ? raw[raw.length - 2] : null;

      let c = catByPath.get(slugPath) || null;
      if (!c) {
        let candidates = catByKey.get(norm(leaf)) || [];
        // Several categories share this name: use the parent written in
        // the file to choose between them.
        if (candidates.length > 1 && parent) {
          const narrowed = candidates.filter((x) => {
            const p = x.parent_id ? catById.get(x.parent_id) : null;
            return p && (norm(p.name) === norm(parent) || norm(p.slug) === norm(parent));
          });
          if (narrowed.length) candidates = narrowed;
        }
        if (candidates.length === 1) c = candidates[0];
        else if (candidates.length > 1) {
          errs.push(`category "${row.category_path}" is ambiguous - matches ` +
            candidates.map((x) => x.path).join(', ') + ' - use the full path');
        }
      }
      if (!c && !errs.some((e) => e.startsWith('category'))) {
        errs.push(`unknown category "${row.category_path}" — create it first`);
      }
      if (c) primary_category_id = c.id;
    }

    if (errs.length) { rejects.push({ line: i + 1, sku: sku || '?', errs }); return; }

    const record = {
      sku,
      name: String(row.name).trim(),
      brand_id,
      primary_category_id,
      summary: String(row.summary ?? '').trim(),
      description: String(row.description ?? '').trim(),
      specs: normaliseSpecs(row.specs),
      // Defaults to draft: an import can never silently publish to a
      // live site. Publishing stays a deliberate action.
      status: row.status || 'draft',
    };

    // A product's URL is frozen the moment it is created.
    //
    // The slug is deliberately NOT part of an update. Spreadsheets do
    // not carry a slug column, so it would be recomputed from the name
    // on every import — and renaming "HUGO 13mm Impact Drill" to "HUGO
    // Impact Drill 13mm" in a sheet (an ordinary edit) would silently
    // change that product's URL, 404ing every indexed page, inbound
    // link and shared WhatsApp link pointing at it. With no prices and
    // no cart, organic search is the entire funnel.
    //
    // Renames are therefore surfaced for a human to approve, never
    // applied automatically.
    const impliedSlug = slugify(row.slug || `${row.name}-${sku}`);
    if (existingBy.has(sku)) {
      const current = existingBy.get(sku).slug;
      if (current && impliedSlug !== current) {
        slugChanges.push({ sku, from: current, to: impliedSlug });
      }
      updates.push(record);
    } else {
      record.slug = impliedSlug;
      creates.push(record);
    }
  });

  // Reported, never touched. The client WILL send partial files.
  const inFile = new Set([...creates, ...updates].map((r) => r.sku));
  const absent = existing.filter((p) => !inFile.has(p.sku)).map((p) => p.sku);

  // ---- report ----
  console.log(`  ${String(creates.length).padStart(4)} create`);
  console.log(`  ${String(updates.length).padStart(4)} update`);
  console.log(`  ${String(absent.length).padStart(4)} absent  (left untouched — never auto-deleted)`);
  console.log(`  ${String(rejects.length).padStart(4)} rejected\n`);

  if (rejects.length) {
    console.log('  REJECTED');
    for (const r of rejects.slice(0, 25)) {
      console.log(`    line ${r.line} [${r.sku}]`);
      for (const e of r.errs) console.log(`      - ${e}`);
    }
    if (rejects.length > 25) console.log(`    …and ${rejects.length - 25} more`);
    console.log('');
  }

  // Field-level diff on a sample, so a wrong column mapping is obvious
  // before it overwrites 250 hand-written descriptions.
  if (updates.length) {
    console.log('  SAMPLE CHANGES');
    for (const u of updates.slice(0, 3)) {
      const before = existingBy.get(u.sku);
      const diffs = Object.keys(u).filter((k) => {
        const a = k === 'specs' ? JSON.stringify(before[k] ?? []) : (before[k] ?? '');
        const b = k === 'specs' ? JSON.stringify(u[k]) : u[k];
        return String(a) !== String(b);
      });
      console.log(`    ${u.sku}: ${diffs.length ? diffs.join(', ') : 'no change'}`);
    }
    console.log('');
  }

  if (slugChanges.length) {
    console.log('  URL CHANGES IMPLIED BY THIS FILE — NOT APPLIED');
    console.log('    These products were renamed in the file. Their existing');
    console.log('    URLs are kept, because changing one breaks every indexed');
    console.log('    page and shared link pointing at it. Rename deliberately');
    console.log('    in the admin if you really want a new URL.');
    for (const c of slugChanges.slice(0, 15)) {
      console.log(`    ${c.sku}: /${c.from}  (file implies /${c.to})`);
    }
    if (slugChanges.length > 15) console.log(`    ...and ${slugChanges.length - 15} more`);
    console.log('');
  }

  if (absent.length) {
    console.log(`  ABSENT (review by hand; archive deliberately if intended)`);
    console.log(`    ${absent.slice(0, 15).join(', ')}${absent.length > 15 ? ` …+${absent.length - 15}` : ''}\n`);
  }

  if (!APPLY) {
    console.log('  DRY RUN — nothing written. Re-run with --apply to commit.\n');
    return;
  }
  if (rejects.length) {
    console.log('  Rejected rows present. Fix them, or re-run on a file without them.');
    console.log('  Importing anyway would load a knowingly incomplete catalogue.\n');
  }

  const all = [...creates, ...updates];
  if (!all.length) { console.log('  Nothing to write.\n'); return; }

  // Chunked upsert on the sku unique constraint. Re-running is therefore
  // idempotent: same file twice = same database.
  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = all.slice(i, i + CHUNK);
    await upsert('products', batch, { onConflict: 'sku' });
    done += batch.length;
    console.log(`  written ${done}/${all.length}`);
  }
  console.log(`\n  Done. ${creates.length} created, ${updates.length} updated, ${absent.length} left alone.\n`);
}

main().catch((e) => die(e.message));

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

const API = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');

if (!FILE) die('usage: node import/import.mjs <file.jsonl> [--apply]');
if (!API || !KEY) die('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

function die(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

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
  const [brands, categories, existing] = await Promise.all([
    rest('brands?select=id,slug,name'),
    rest('categories?select=id,slug,name,path'),
    rest('products?select=sku,name,summary,description,status,specs,brand_id,primary_category_id'),
  ]);

  const brandBy = new Map();
  for (const b of brands) { brandBy.set(b.slug, b); brandBy.set(slugify(b.name), b); }
  const catByPath = new Map(categories.map((c) => [c.path, c]));
  const catByLeaf = new Map(categories.map((c) => [c.slug, c]));
  const existingBy = new Map(existing.map((p) => [p.sku, p]));

  const creates = [], updates = [], rejects = [];
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
      const parts = String(row.category_path).split('>').map((s) => slugify(s));
      const path = parts.join('/');
      const c = catByPath.get(path) || catByLeaf.get(parts[parts.length - 1]);
      if (!c) errs.push(`unknown category "${row.category_path}" — create it first`);
      else primary_category_id = c.id;
    }

    if (errs.length) { rejects.push({ line: i + 1, sku: sku || '?', errs }); return; }

    const record = {
      sku,
      slug: slugify(row.slug || `${row.name}-${sku}`),
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
    (existingBy.has(sku) ? updates : creates).push(record);
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
    await rest('products?on_conflict=sku', {
      method: 'POST',
      body: batch,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    done += batch.length;
    console.log(`  written ${done}/${all.length}`);
  }
  console.log(`\n  Done. ${creates.length} created, ${updates.length} updated, ${absent.length} left alone.\n`);
}

main().catch((e) => die(e.message));

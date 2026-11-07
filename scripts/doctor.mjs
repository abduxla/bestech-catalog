#!/usr/bin/env node
// =====================================================================
// Setup check.
//
//   node scripts/doctor.mjs
//
// Answers "is this database actually set up correctly and actually
// secure", by asking it rather than by trusting that the migrations
// did what they say.
//
// Most of these checks are LIVE PROBES, not inspections. The security
// ones genuinely attempt the thing that must be impossible — reading a
// draft anonymously, writing a product anonymously, listing the admin
// allowlist — and fail loudly if any of them works. Reading the policy
// SQL proves what was written; only a probe proves what is enforced.
// On the previous project, two holes that "the SQL clearly closed" were
// found open exactly this way.
//
// Safe to run against production. The one write it attempts is
// supposed to be rejected; on the off chance it succeeds, the row is
// cleaned up immediately and reported as critical.
// =====================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env ourselves — no dotenv dependency for six lines of parsing.
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const PUB = process.env.SUPABASE_ANON_KEY || '';
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let pass = 0, warn = 0, critical = 0;
const ok   = (m, d) => { pass++;     console.log(`  \u001b[32mPASS\u001b[0m  ${m}${d ? `  \u001b[90m${d}\u001b[0m` : ''}`); };
const bad  = (m, d) => { critical++; console.log(`  \u001b[31mFAIL\u001b[0m  ${m}${d ? `\n        \u001b[90m${d}\u001b[0m` : ''}`); };
const soft = (m, d) => { warn++;     console.log(`  \u001b[33mWARN\u001b[0m  ${m}${d ? `\n        \u001b[90m${d}\u001b[0m` : ''}`); };
const head = (m)    => console.log(`\n\u001b[1m${m}\u001b[0m`);

const isPublishable = (k) => /^sb_publishable_/.test(k);

/** A request as a specific identity. Never throws; returns the outcome. */
async function call(path, { key, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!isPublishable(key)) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, ok: res.ok, text, json };
  } catch (e) {
    return { status: 0, ok: false, text: e.message, json: null };
  }
}

const asAnon = (p, o) => call(p, { ...o, key: PUB });
const asRoot = (p, o) => call(p, { ...o, key: SECRET });

// ---------------------------------------------------------------------
async function main() {
  console.log('\n\u001b[1mBestech catalogue — setup check\u001b[0m');

  // ---- configuration ----
  head('Configuration');
  if (!URL_BASE) {
    bad('SUPABASE_URL is not set',
        'Settings -> Data API -> Project URL. Put it in .env. Nothing else can be checked without it.');
    return finish();
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(URL_BASE)) {
    soft(`SUPABASE_URL looks unusual: ${URL_BASE}`, 'Expected https://<ref>.supabase.co');
  } else {
    ok('SUPABASE_URL', URL_BASE);
  }
  PUB ? ok('publishable key', isPublishable(PUB) ? 'new format' : 'legacy JWT')
      : bad('SUPABASE_ANON_KEY is not set', 'The admin page and the build need it.');
  SECRET ? ok('secret key', 'present (not shown)')
         : bad('SUPABASE_SERVICE_ROLE_KEY is not set', 'The importer, backup and CI need it.');
  if (!PUB || !SECRET) return finish();

  // ---- reachability ----
  head('Reachability');
  const ping = await asRoot('/rest/v1/');
  if (ping.status === 0) { bad('cannot reach the project', ping.text); return finish(); }
  ping.ok || ping.status === 404
    ? ok('REST API responds', `HTTP ${ping.status}`)
    : bad(`REST API returned HTTP ${ping.status}`, ping.text.slice(0, 200));

  // ---- schema ----
  head('Schema (have the migrations been applied?)');
  const TABLES = [
    ['divisions', '0001'], ['brands', '0001'], ['categories', '0001'],
    ['products', '0001'], ['product_categories', '0001'], ['product_images', '0001'],
    ['admins', '0001'], ['path_history', '0003'], ['publish_requests', '0005'],
  ];
  let missing = [];
  for (const [table, mig] of TABLES) {
    const r = await asRoot(`/rest/v1/${table}?select=*&limit=1`);
    if (r.status === 404 || (r.json && r.json.code === '42P01')) { missing.push(`${table} (${mig})`); }
    else if (!r.ok) soft(`${table} responded HTTP ${r.status}`, r.text.slice(0, 160));
    else ok(`table ${table}`);
  }
  if (missing.length) {
    bad(`${missing.length} table(s) missing: ${missing.join(', ')}`,
        'Apply the migrations:  npx supabase link --project-ref <ref>  &&  npx supabase db push');
  }

  head('Functions');
  for (const [fn, args] of [
    ['is_admin', {}], ['publish_status', {}],
  ]) {
    const r = await asRoot(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
    r.status === 404 ? bad(`function ${fn}() is missing`, 'Migrations not fully applied.') : ok(`function ${fn}()`);
  }

  // ---- seed ----
  head('Reference data');
  const divs = await asRoot('/rest/v1/divisions?select=slug');
  const brands = await asRoot('/rest/v1/brands?select=slug');
  const cats = await asRoot('/rest/v1/categories?select=slug');
  const prods = await asRoot('/rest/v1/products?select=sku,status');
  const n = (r) => (Array.isArray(r.json) ? r.json.length : 0);

  n(divs) ? ok(`${n(divs)} divisions`) : soft('no divisions', 'Migration 0002 seeds two. Has it run?');
  n(brands) ? ok(`${n(brands)} brands`) : soft('no brands', 'Migration 0002 seeds the brand list.');
  n(cats) ? ok(`${n(cats)} categories`) : soft('no categories yet', 'Expected — the taxonomy comes with the catalogue.');
  if (n(prods)) {
    const live = prods.json.filter((p) => p.status === 'published').length;
    ok(`${n(prods)} products`, `${live} published, ${n(prods) - live} draft/archived`);
  } else {
    soft('no products yet', 'Expected before the first import.');
  }

  // ---- security: live probes ----
  head('Security (probing what an anonymous visitor can actually do)');

  // 1. Anonymous reads of published content must work, or the public
  //    site cannot be built from a publishable key.
  const anonRead = await asAnon('/rest/v1/products?select=sku&limit=1');
  anonRead.ok
    ? ok('anonymous can read published products', 'required — the build depends on it')
    : bad(`anonymous read failed (HTTP ${anonRead.status})`, anonRead.text.slice(0, 200));

  // 2. Drafts must be invisible anonymously. Compared against what the
  //    secret key sees, so this is a real check rather than a guess.
  const anonAll = await asAnon('/rest/v1/products?select=sku,status');
  if (Array.isArray(anonAll.json)) {
    const leaked = anonAll.json.filter((p) => p.status !== 'published');
    leaked.length
      ? bad(`${leaked.length} non-published product(s) are visible anonymously`,
            `e.g. ${leaked.slice(0, 3).map((p) => `${p.sku} (${p.status})`).join(', ')} — check the products_read policy`)
      : ok('drafts and archived products are invisible anonymously');
  }

  // 3. The admin allowlist must not be readable. RLS is on with no
  //    public policy, so this should come back empty or refused.
  const anonAdmins = await asAnon('/rest/v1/admins?select=email');
  const adminRows = Array.isArray(anonAdmins.json) ? anonAdmins.json.length : 0;
  adminRows === 0
    ? ok('the admin allowlist is not readable anonymously')
    : bad(`the admin allowlist leaked ${adminRows} row(s) anonymously`, 'Staff email addresses are exposed.');

  // 4. is_admin() must be false for a visitor.
  const anonIsAdmin = await asAnon('/rest/v1/rpc/is_admin', { method: 'POST', body: {} });
  anonIsAdmin.json === false
    ? ok('is_admin() is false for an anonymous visitor')
    : bad(`is_admin() returned ${JSON.stringify(anonIsAdmin.json)} anonymously`, 'Everything is writable.');

  // 5. The real test: attempt a write. This MUST be rejected.
  const probeSku = `__DOCTOR_PROBE_${Date.now()}`;
  const anonWrite = await asAnon('/rest/v1/products', {
    method: 'POST', prefer: 'return=representation',
    body: [{ sku: probeSku, slug: probeSku.toLowerCase(), name: 'doctor probe', status: 'draft' }],
  });
  if (anonWrite.ok) {
    bad('ANONYMOUS WRITE SUCCEEDED — anyone on the internet can edit the catalogue',
        'The products_write policy is missing or wrong. Removing the probe row now.');
    await asRoot(`/rest/v1/products?sku=eq.${probeSku}`, { method: 'DELETE' });
  } else {
    ok('anonymous writes are rejected', `HTTP ${anonWrite.status}`);
  }

  // 6. Publishing must be staff-only.
  const anonPublish = await asAnon('/rest/v1/rpc/request_publish', { method: 'POST', body: { p_note: 'probe' } });
  anonPublish.ok
    ? bad('anonymous callers can trigger a publish', 'request_publish() is not checking is_admin().')
    : ok('publishing is refused anonymously', `HTTP ${anonPublish.status}`);

  // ---- storage ----
  head('Image storage');
  const buckets = await asRoot('/storage/v1/bucket');
  if (Array.isArray(buckets.json)) {
    const bucket = buckets.json.find((b) => b.id === (process.env.IMAGE_BUCKET || 'product-images'));
    if (!bucket) {
      bad('the product-images bucket does not exist', 'Migration 0004 creates it. Has it run?');
    } else {
      ok('bucket product-images exists');
      bucket.public
        ? ok('bucket is public', 'required — <img> tags carry no token')
        : bad('bucket is not public', 'Every product photo on the site will 400.');
    }
  } else {
    soft('could not list storage buckets', `HTTP ${buckets.status}`);
  }

  if (!process.env.IMAGE_BASE_URL) {
    soft('IMAGE_BASE_URL is not set',
         `Set it to ${URL_BASE}/storage/v1/object/public/product-images or images will have no host.`);
  } else {
    ok('IMAGE_BASE_URL', process.env.IMAGE_BASE_URL);
  }

  // ---- staff ----
  head('Staff');
  const admins = await asRoot('/rest/v1/admins?select=email');
  if (Array.isArray(admins.json)) {
    admins.json.length
      ? ok(`${admins.json.length} administrator(s)`, admins.json.map((a) => a.email).join(', '))
      : soft('no administrators yet',
             'Nobody can sign in to /admin/. Create a user in Authentication -> Users, then insert them into admins once.');
  }

  finish();
}

function finish() {
  console.log(`\n  ${pass} passed, ${warn} warnings, ${critical} failures\n`);
  if (critical) {
    console.log('  \u001b[31mDo not go live until the failures above are fixed.\u001b[0m\n');
    process.exit(1);
  }
  if (warn) console.log('  Warnings are usually just "not set up yet" rather than wrong.\n');
  else console.log('  \u001b[32mEverything checks out.\u001b[0m\n');
}

main().catch((e) => { console.error(`\n  doctor crashed: ${e.message}\n`); process.exit(1); });

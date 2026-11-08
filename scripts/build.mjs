#!/usr/bin/env node
// =====================================================================
// The build.
//
//   node scripts/build.mjs                  # read the DB, render dist/
//   node scripts/build.mjs --from-cache     # re-render from last snapshot
//   node scripts/build.mjs --drafts         # include drafts (preview only)
//
// This is the whole answer to "make it withstand heavy traffic without
// budging". Every page is rendered ONCE here and served as a plain file
// from a CDN edge. At request time there is no database, no API, no
// server-side render and no cold start — so there is nothing to fall
// over. Ten visitors and ten thousand visitors cost the origin exactly
// the same: nothing. The database only ever sees this script.
//
// Costs for ~250 products: a few hundred files, a second or two of CPU,
// about a dozen DB queries total. That stays true at 25,000 products.
//
// ---------------------------------------------------------------------
// Three failure modes are guarded explicitly, because each of them is a
// way a static build silently destroys a live site:
//
//   1. DB UNREACHABLE -> exit non-zero, dist/ untouched. A half-built
//      site is worse than a stale one.
//   2. DB REACHABLE BUT EMPTY (wrong project, revoked key, a bad RLS
//      change) -> refuses to publish a catalogue that lost most of its
//      products. --allow-shrink overrides, deliberately.
//   3. TEMPLATE CRASH on one product -> that product is reported and
//      skipped; it does not take the other 249 pages down with it.
// ---------------------------------------------------------------------

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join as pathJoin, posix, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryAll, assertConfigured } from '../lib/db.mjs';
import {
  layout, productPage, listingPage, homePage, brandsIndexPage, redirectStub,
  url, SITE, BASE, assets, site,
} from '../lib/render.mjs';
import { imageUrl } from '../lib/images.mjs';

const ROOT = pathJoin(dirname(fileURLToPath(import.meta.url)), '..');
// DIST_DIR exists so the test suite can build into a throwaway
// directory. Tests used to render into the real dist/, which meant a
// test run silently replaced a live build with fixture data - and in
// CI, a test step between build and deploy would have shipped it.
const DIST = process.env.DIST_DIR
  ? (isAbsolute(process.env.DIST_DIR) ? process.env.DIST_DIR : pathJoin(ROOT, process.env.DIST_DIR))
  : pathJoin(ROOT, 'dist');
const CACHE = pathJoin(ROOT, '.cache', 'snapshot.json');
const STATIC = pathJoin(ROOT, 'static');

const args = process.argv.slice(2);
const FROM_CACHE = args.includes('--from-cache');
const DRAFTS = args.includes('--drafts');
const ALLOW_SHRINK = args.includes('--allow-shrink');
const ORIGIN = (process.env.SITE_ORIGIN || 'https://www.bestech.lk').replace(/\/+$/, '');

const t0 = Date.now();
let written = 0, unchanged = 0, skipped = [];
const emitted = new Set();

// ---------------------------------------------------------------------
// Writing
//
// Hash-compare before writing. A rebuild where only one description
// changed rewrites one file, not four hundred — which keeps `rsync`,
// `vercel deploy` and CDN cache invalidation proportional to the edit
// instead of to the catalogue.
// ---------------------------------------------------------------------
function emit(route, html) {
  // Routes carry BASE (/bestech-catalog/c/drills/) because that is what
  // a browser asks for; the FILE still belongs at dist/c/drills/, which
  // the host serves from that prefix. Strip it here, in one place.
  const path = BASE && route.startsWith(BASE) ? route.slice(BASE.length) || '/' : route;
  // "/c/drills/" -> "dist/c/drills/index.html"
  const rel = path.endsWith('/') ? `${path}index.html` : path;
  const file = pathJoin(DIST, rel.replace(/^\//, ''));
  emitted.add(posix.normalize(rel.replace(/^\//, '')));

  const next = createHash('sha1').update(html).digest('hex');
  if (existsSync(file)) {
    const prev = createHash('sha1').update(readFileSync(file)).digest('hex');
    if (prev === next) { unchanged++; return; }
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html, 'utf8');
  written++;
}

/** Render one page without letting a single bad row fail the build. */
function safely(label, fn) {
  try { return fn(); }
  catch (e) { skipped.push(`${label}: ${e.message}`); return null; }
}

// Everything under dist/ that this run did not emit is stale — a deleted
// product, a renamed category. Collected and removed at the end so old
// pages do not linger on the CDN forever.
function listExisting(dir, base = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? posix.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...listExisting(pathJoin(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

// The stylesheet and the script are content-hashed, so a cached copy
// can never be paired with newer HTML. Everything else keeps its name.
const HASHED = { 'assets/css/site.css': 'css', 'assets/js/site.js': 'js' };

function hashAssets() {
  for (const [rel, key] of Object.entries(HASHED)) {
    const src = pathJoin(STATIC, rel);
    if (!existsSync(src)) continue;
    const h = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 10);
    const dot = rel.lastIndexOf('.');
    assets[key] = '/' + rel.slice(0, dot) + '.' + h + rel.slice(dot);
  }
}

function copyStatic() {
  // CSS, JS and anything else hand-written. Copied rather than imported
  // so the assets stay editable by anyone without touching the build.
  if (!existsSync(STATIC)) return;
  for (const relRaw of listExisting(STATIC)) {
    const src = pathJoin(STATIC, relRaw);
    // A hashed asset is written under its hashed name, which is what
    // the HTML references. Its unhashed name is never emitted, so the
    // prune step clears the previous build's copy by itself.
    // A hashed asset is emitted under BOTH names.
    //
    // The hashed name is what new HTML references and can be cached
    // forever. The plain name has to stay, because the host serves
    // HTML with max-age=600 - so for ten minutes after every deploy
    // there are browsers holding the PREVIOUS page, which asks for the
    // plain name. Renaming and deleting in one step strands all of
    // them on a completely unstyled page, which is exactly what the
    // previous deploy did.
    const names = HASHED[relRaw] ? [assets[HASHED[relRaw]].slice(1), relRaw] : [relRaw];
    for (const rel of names) emitted.add(rel);
    const rel = names[0];
    const dest = pathJoin(DIST, rel);
    const body = readFileSync(src);
    const next = createHash('sha1').update(body).digest('hex');
    if (existsSync(dest)) {
      const prev = createHash('sha1').update(readFileSync(dest)).digest('hex');
      if (prev === next) { unchanged++; continue; }
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    written++;
    for (const alias of names.slice(1)) {
      const aliasPath = pathJoin(DIST, alias);
      mkdirSync(dirname(aliasPath), { recursive: true });
      writeFileSync(aliasPath, body);
    }
  }
}

// ---------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------
async function load() {
  if (FROM_CACHE) {
    if (!existsSync(CACHE)) {
      throw new Error('--from-cache given but .cache/snapshot.json does not exist. Run a normal build first.');
    }
    console.log('  reading .cache/snapshot.json (NOT the database)\n');
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }

  assertConfigured();
  // Published-only unless --drafts. The anon key is also restricted by
  // RLS, so this is belt and braces rather than the only guard.
  const statusFilter = DRAFTS ? '' : 'status=eq.published';

  const [divisions, brands, categories, products, links, images, history] = await Promise.all([
    queryAll('divisions', { select: 'id,slug,name,tagline,blurb,hero_key,sort', filter: 'is_published=is.true', order: 'sort.asc,name.asc' }),
    queryAll('brands', { select: 'id,slug,name,blurb,logo_key,is_flagship,sort', filter: 'is_published=is.true', order: 'is_flagship.desc,sort.asc,name.asc' }),
    queryAll('categories', { select: 'id,division_id,parent_id,slug,name,blurb,image_key,path,depth,sort', filter: 'is_published=is.true', order: 'path.asc' }),
    queryAll('products', {
      select: 'id,sku,slug,name,brand_id,primary_category_id,summary,description,specs,status,is_featured,sort',
      filter: statusFilter, order: 'sort.asc,name.asc',
    }),
    queryAll('product_categories', { select: 'product_id,category_id' }),
    queryAll('product_images', { select: 'product_id,storage_key,alt,width,height,position', order: 'product_id.asc,position.asc' }),
    queryAll('path_history', { select: 'old_path,new_path,kind' }),
  ]);

  const snap = { divisions, brands, categories, products, links, images, history, fetched_at: new Date().toISOString() };

  // Guard 2: refuse to publish a catalogue that just lost its contents.
  if (existsSync(CACHE) && !ALLOW_SHRINK) {
    const prev = JSON.parse(readFileSync(CACHE, 'utf8'));
    const before = (prev.products || []).length;
    if (before >= 10 && products.length < before * 0.5) {
      throw new Error(
        `the database returned ${products.length} products but the last build saw ${before}.\n` +
        '  That is the signature of a wrong project, a revoked key or a bad RLS change,\n' +
        '  not an edit. dist/ has been left exactly as it was.\n' +
        '  If the catalogue really did shrink, re-run with --allow-shrink.'
      );
    }
  }

  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(snap), 'utf8');
  return snap;
}

// ---------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------
function shape(snap) {
  const { divisions, brands, categories, products, links, images } = snap;

  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catByPath = new Map(categories.map((c) => [c.path, c]));

  const categoriesByDivision = new Map();
  for (const c of categories) {
    if (!categoriesByDivision.has(c.division_id)) categoriesByDivision.set(c.division_id, []);
    categoriesByDivision.get(c.division_id).push(c);
  }

  const imagesByProduct = new Map();
  for (const im of images) {
    if (!imagesByProduct.has(im.product_id)) imagesByProduct.set(im.product_id, []);
    imagesByProduct.get(im.product_id).push(im);
  }

  // Decorate each product once with everything every template needs, so
  // no template ever reaches back into a lookup table (and no page ends
  // up doing an accidental O(n) scan per product).
  const byId = new Map();
  for (const p of products) {
    const brand = p.brand_id ? brandById.get(p.brand_id) : null;
    const cat = p.primary_category_id ? catById.get(p.primary_category_id) : null;

    // Breadcrumb from the materialised path, walking real rows so a
    // category removed from the tree cannot leave a dangling crumb.
    const trail = [];
    if (cat) {
      const segs = cat.path.split('/');
      const div = divisionById.get(cat.division_id);
      if (div) trail.push({ name: div.name, href: url.division(div) });
      for (let i = 0; i < segs.length; i++) {
        const node = catByPath.get(segs.slice(0, i + 1).join('/'));
        if (node) trail.push({ name: node.name, href: url.category(node) });
      }
    }

    const decorated = {
      ...p,
      specs: Array.isArray(p.specs) ? p.specs : [],
      brand_name: brand ? brand.name : '',
      brand_href: brand ? url.brand(brand) : '',
      category: cat || null,
      trail,
      // Which division this product belongs to, for the home page's
      // filter tabs.
      division_slug: cat && divisionById.get(cat.division_id)
        ? divisionById.get(cat.division_id).slug : '',
      images: imagesByProduct.get(p.id) || [],
      image: (imagesByProduct.get(p.id) || [])[0] || null,
    };
    byId.set(p.id, decorated);
  }
  const all = [...byId.values()];

  // Listings show a category AND all of its descendants: the m2m table
  // plus a path-prefix match, so a product filed only on a leaf still
  // appears on its parent's page. This is what dbl.lk gets wrong — its
  // parent categories come back empty.
  const productsByCategory = new Map();
  const add = (catId, prod) => {
    if (!productsByCategory.has(catId)) productsByCategory.set(catId, new Set());
    productsByCategory.get(catId).add(prod);
  };
  for (const l of links) {
    const prod = byId.get(l.product_id);
    const cat = catById.get(l.category_id);
    if (!prod || !cat) continue;
    for (const anc of categories) {
      if (cat.path === anc.path || cat.path.startsWith(`${anc.path}/`)) add(anc.id, prod);
    }
  }
  // primary_category_id alone is enough to be listed — the m2m table is
  // optional enrichment, not a requirement, so an import that only sets
  // the primary category still produces a populated site.
  for (const p of all) {
    if (!p.category) continue;
    for (const anc of categories) {
      if (p.category.path === anc.path || p.category.path.startsWith(`${anc.path}/`)) add(anc.id, p);
    }
  }

  const productsByBrand = new Map();
  for (const p of all) {
    if (!p.brand_id) continue;
    if (!productsByBrand.has(p.brand_id)) productsByBrand.set(p.brand_id, []);
    productsByBrand.get(p.brand_id).push(p);
  }

  const productsByDivision = new Map();
  for (const p of all) {
    if (!p.category) continue;
    const d = p.category.division_id;
    if (!productsByDivision.has(d)) productsByDivision.set(d, []);
    productsByDivision.get(d).push(p);
  }

  const nav = { divisions, brands, categories, categoriesByDivision };
  return {
    nav, divisions, brands, categories, products: all,
    divisionById, brandById, catById, catByPath,
    productsByCategory, productsByBrand, productsByDivision,
  };
}

const bySort = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name);

/**
 * Hero slides, built from the divisions that have a photograph.
 *
 * Copy lives here rather than in the template so that adding a
 * division, or giving one a hero image in the admin, adds a slide
 * without anybody editing code. With one photograph there is one
 * slide and the carousel controls hide themselves.
 */
function heroSlides(d) {
  const withPhoto = d.divisions.filter((x) => x.hero_key);
  const lead = {
    // A brand-level photograph for the opening slide, named in
    // configuration because it belongs to the site rather than to any
    // one division. Falls back to the first division that has one.
    key: process.env.HERO_IMAGE_KEY || (withPhoto[0] || {}).hero_key || '',
    eyebrow: SITE.legal,
    title: SITE.tagline,
    sub: `Power tools, machinery and water pumps from ${d.brands.length} brands, stocked and supported in Colombo since 1988.`,
    cta: 'Browse the catalogue',
    href: d.divisions[0] ? url.division(d.divisions[0]) : BASE + '/',
  };
  // With a configured lead image, every division becomes its own
  // slide; without one, the first division supplies the lead.
  const rest = (process.env.HERO_IMAGE_KEY ? withPhoto : withPhoto.slice(1)).map((div) => ({
    key: div.hero_key,
    eyebrow: div.name,
    title: div.tagline || div.name,
    sub: div.blurb || '',
    cta: `See ${div.name}`,
    href: url.division(div),
  }));
  return [lead, ...rest];
}

// ---------------------------------------------------------------------
async function main() {
  console.log(`\n  Building ${SITE.name} -> dist/\n`);
  hashAssets();   // must run before the first page is rendered
  // The enquiry modal appears on every page, so its photograph is a
  // site-wide value rather than a home page prop.
  site.modalKey = process.env.MODAL_IMAGE_KEY || process.env.SHOWCASE_IMAGE_KEY || '';
  const snap = await load();
  const d = shape(snap);
  const ctx = { nav: d.nav, origin: ORIGIN };

  const routes = [];   // for the sitemap
  const track = (route, priority) => { routes.push({ route, priority }); };

  // ---- home ----
  const featured = d.products.filter((p) => p.is_featured).slice(0, 12);
  const home = safely('home', () => homePage({
    divisions: d.divisions.map((div) => ({
      ...div,
      count: (d.productsByDivision.get(div.id) || []).length,
      // Three representative top-level categories as entry tiles.
      tiles: (d.nav.categoriesByDivision.get(div.id) || [])
        .filter((c) => !c.parent_id).sort(bySort).slice(0, 6),
    })),
    brands: d.brands,
    featured: featured.length ? featured : d.products.slice(0, 12),
    total: d.products.length,
    // The hero photograph comes from the first division that has one,
    // so it is managed in the admin like everything else rather than
    // being a filename baked into the template.
    heroKey: (d.divisions.find((x) => x.hero_key) || {}).hero_key || '',
    // Editorial photography is managed as division hero images, so it
    // is editable in the admin like everything else. The first one
    // backs the hero; a second, if present, backs the showcase band.
    editorial: {
      // Site furniture rather than catalogue data, so it is named by
      // configuration instead of borrowing a division's hero image -
      // which previously meant the same photograph appeared twice.
      modalKey: process.env.MODAL_IMAGE_KEY || process.env.SHOWCASE_IMAGE_KEY || '',
      counterKey: process.env.SHOWCASE_IMAGE_KEY || '',
    },
    // Hero slides: one per division that has a photograph, so the
    // carousel grows by uploading a hero image in the admin rather
    // than by editing a template.
    slides: heroSlides(d),
    // Lead-in cards for the biggest categories that have a photo.
    solutions: d.categories
      .filter((c) => !c.parent_id && c.image_key)
      .sort(bySort)
      .map((c) => ({
        key: c.image_key, name: c.name, href: url.category(c),
        verb: ((n) => (n ? `${n} product${n === 1 ? '' : 's'}` : 'the range'))(
          (d.productsByCategory.get(c.id) || new Set()).size),
      })),
  }, ctx));
  if (home) { emit(url.home(), home); track(url.home(), '1.0'); }

  // ---- divisions ----
  for (const div of d.divisions) {
    const prods = (d.productsByDivision.get(div.id) || []);
    const tops = (d.nav.categoriesByDivision.get(div.id) || []).filter((c) => !c.parent_id).sort(bySort);
    const html = safely(`division ${div.slug}`, () => listingPage({
      heading: div.name,
      intro: div.blurb || div.tagline,
      products: prods.slice(0, 48),
      trail: [{ name: div.name, href: url.division(div) }],
      canonical: ORIGIN + url.division(div),
      facets: tops.map((c) => ({
        name: c.name,
        href: url.category(c),
        count: (d.productsByCategory.get(c.id) || new Set()).size,
      })),
    }, ctx));
    if (html) { emit(url.division(div), html); track(url.division(div), '0.8'); }
  }

  // ---- categories ----
  for (const c of d.categories) {
    const set = d.productsByCategory.get(c.id) || new Set();
    const prods = [...set].sort(bySort);
    const kids = d.categories.filter((k) => k.parent_id === c.id).sort(bySort);
    const div = d.divisionById.get(c.division_id);

    const trail = [];
    if (div) trail.push({ name: div.name, href: url.division(div) });
    const segs = c.path.split('/');
    for (let i = 0; i < segs.length; i++) {
      const node = d.catByPath.get(segs.slice(0, i + 1).join('/'));
      if (node) trail.push({ name: node.name, href: url.category(node) });
    }

    const html = safely(`category ${c.path}`, () => listingPage({
      heading: c.name,
      intro: c.blurb,
      products: prods,
      trail,
      canonical: ORIGIN + url.category(c),
      facets: kids.map((k) => ({
        name: k.name,
        href: url.category(k),
        count: (d.productsByCategory.get(k.id) || new Set()).size,
      })),
    }, ctx));
    if (html) { emit(url.category(c), html); track(url.category(c), '0.7'); }
  }

  // ---- brands ----
  const brandsIndex = safely('brands index', () => brandsIndexPage(
    d.brands.map((b) => ({ ...b, count: (d.productsByBrand.get(b.id) || []).length })), ctx));
  if (brandsIndex) { emit('/brands/', brandsIndex); track('/brands/', '0.6'); }

  for (const b of d.brands) {
    const prods = (d.productsByBrand.get(b.id) || []).sort(bySort);
    const html = safely(`brand ${b.slug}`, () => listingPage({
      heading: b.name,
      intro: b.blurb || `${b.name} products available from ${SITE.legal}.`,
      products: prods,
      trail: [{ name: 'Brands', href: `${BASE}/brands/` }, { name: b.name, href: url.brand(b) }],
      canonical: ORIGIN + url.brand(b),
    }, ctx));
    if (html) { emit(url.brand(b), html); track(url.brand(b), '0.6'); }
  }

  // ---- products ----
  for (const p of d.products) {
    // Related: same category first, then same brand, never itself.
    const sameCat = p.category ? [...(d.productsByCategory.get(p.category.id) || new Set())] : [];
    const pool = sameCat.length > 1 ? sameCat : (d.productsByBrand.get(p.brand_id) || []);
    const related = pool.filter((x) => x.id !== p.id).slice(0, 4);

    const html = safely(`product ${p.sku}`, () => productPage(p, { ...ctx, related }));
    if (html) { emit(url.product(p), html); track(url.product(p), '0.9'); }
  }

  // ---- search ----
  // One small JSON file, fetched once and searched in the browser. At
  // 250 products it is ~30KB gzipped — far cheaper and far faster than
  // a round trip to a database for every keystroke, and it keeps the
  // search box working when everything else is a static file.
  const index = d.products.map((p) => ({
    s: p.sku, n: p.name, b: p.brand_name,
    c: p.category ? p.category.name : '',
    u: url.product(p),
    i: p.image ? imageUrl(p.image.storage_key, 400) : '',
  }));
  emit('/search-index.json', JSON.stringify(index));

  const searchHtml = safely('search', () => layout({
    title: 'Search',
    description: `Search the ${SITE.legal} catalogue by model number or product name.`,
    canonical: ORIGIN + url.search(),
    nav: d.nav,
    body: `<div class="wrap listing">
      <h1>Search</h1>
      <form class="search search--page" action="${url.search()}" method="get" role="search">
        <input type="search" id="q" name="q" placeholder="Model number or product name" autofocus aria-label="Search">
        <button type="submit">Search</button>
      </form>
      <p class="listing__count" id="searchCount"></p>
      <div class="grid" id="searchResults"></div>
      <noscript><p>Search needs JavaScript. Please browse the categories above, or call ${SITE.phones[0].value}.</p></noscript>
    </div>`,
  }));
  if (searchHtml) { emit(url.search(), searchHtml); track(url.search(), '0.4'); }

  // ---- redirect stubs ----
  // Every URL this site has ever served, pointed at where that thing
  // lives now. Emitted only when the destination actually exists, so a
  // deleted product does not get a stub into a 404.
  const live = new Set([
    ...d.products.map((p) => url.product(p)),
    ...d.categories.map((c) => url.category(c)),
  ]);
  let stubs = 0;
  for (const h of snap.history || []) {
    const to = h.new_path.endsWith('/') ? h.new_path : `${h.new_path}/`;
    const from = h.old_path.endsWith('/') ? h.old_path : `${h.old_path}/`;
    if (!live.has(to) || live.has(from)) continue;
    emit(from, redirectStub(from, to, ORIGIN));
    stubs++;
  }

  // ---- sitemap + robots ----
  const today = new Date().toISOString().slice(0, 10);
  emit('/sitemap.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...routes.map((r) =>
      `<url><loc>${ORIGIN}${r.route}</loc><lastmod>${today}</lastmod><priority>${r.priority}</priority></url>`),
    '</urlset>',
  ].join('\n'));

  // A preview build must never be crawled: it is fixture data wearing
  // the client's name.
  emit('/robots.txt', process.env.PREVIEW_BUILD === '1'
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: ${BASE}/admin/\nSitemap: ${ORIGIN}${BASE}/sitemap.xml\n`);

  // ---- admin configuration ----
  // Written from the environment so the same committed admin page works
  // against a local, staging or production database with no edits.
  //
  // The anon key here is PUBLIC BY DESIGN: it identifies the project,
  // not the user, and grants nothing on its own, because every table's
  // RLS requires an allowlisted administrator for writes. The service
  // role key and the deploy credential are deliberately NOT here - the
  // first would hand any visitor the whole database, and the second
  // would let a stranger trigger unlimited paid builds.
  emit('/admin/config.js',
    '/* Generated by scripts/build.mjs - do not edit. */\n' +
    `window.BESTECH_CONFIG = ${JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || '',
      anonKey: process.env.SUPABASE_ANON_KEY || '',
      bucket: process.env.IMAGE_BUCKET || 'product-images',
      imageBaseUrl: process.env.IMAGE_BASE_URL || '',
    }, null, 2)};\n`);

  // 404 served by the host's error page config.
  const notFound = safely('404', () => layout({
    title: 'Page not found',
    nav: d.nav,
    body: `<div class="wrap listing"><h1>Page not found</h1>
      <p class="listing__intro">That page has moved or no longer exists.</p>
      <p><a class="btn" href="/">Back to the catalogue</a></p>
      <p>Looking for something specific? Call ${SITE.phones[0].value}.</p></div>`,
  }));
  if (notFound) emit('/404.html', notFound);

  copyStatic();

  // ---- prune ----
  const stale = listExisting(DIST).filter((rel) => !emitted.has(rel));
  for (const rel of stale) rmSync(pathJoin(DIST, rel), { force: true });

  // ---- report ----
  console.log(`  products    ${d.products.length}`);
  console.log(`  categories  ${d.categories.length}`);
  console.log(`  brands      ${d.brands.length}`);
  console.log(`  redirects   ${stubs}`);
  console.log('');
  console.log(`  written     ${written}`);
  console.log(`  unchanged   ${unchanged}`);
  console.log(`  pruned      ${stale.length}`);
  if (skipped.length) {
    console.log(`\n  SKIPPED ${skipped.length} page(s) — the rest of the site built fine:`);
    for (const s of skipped.slice(0, 20)) console.log(`    ${s}`);
  }
  console.log(`\n  ${Date.now() - t0}ms -> dist/\n`);

  // A build that produced no product pages is not a build.
  if (!d.products.length) {
    console.log('  WARNING: zero products. The site is a shell — check the database and the key.\n');
  }
}

main().catch((e) => {
  console.error(`\n  BUILD FAILED — dist/ unchanged\n\n  ${e.message}\n`);
  process.exit(1);
});

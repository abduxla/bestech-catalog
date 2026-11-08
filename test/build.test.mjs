// =====================================================================
// End-to-end build test.
//
// Builds the entire site from the development fixture — no database,
// no keys, no network — and asserts the things that would be expensive
// to discover in production.
//
// Each assertion below corresponds to a real way a catalogue site goes
// wrong, several of which dbl.lk (the client's own reference) exhibits
// today: parent categories that list nothing, specifications that are
// not data, and dead links from renamed pages.
// =====================================================================

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const env = { ...process.env, IMAGE_BASE_URL: 'https://images.example.test', SITE_ORIGIN: 'https://www.bestech.lk' };

const run = (script, args = []) =>
  execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, env, encoding: 'utf8' });

const read = (rel) => readFileSync(join(DIST, rel), 'utf8');
const has = (rel) => existsSync(join(DIST, rel));

let firstBuild = '';

before(() => {
  // From scratch every time: a test that depends on whatever dist/
  // happened to contain is a test that passes or fails for reasons
  // unrelated to the code.
  rmSync(DIST, { recursive: true, force: true });
  run('dev-fixture.mjs');
  firstBuild = run('build.mjs', ['--from-cache']);
});

test('the build renders every kind of page', () => {
  for (const page of [
    'index.html',
    'd/power-tools-machinery/index.html',
    'c/drills/index.html',
    'c/drills/rotary-hammers/sds-plus/index.html',
    'brands/index.html',
    'brands/hugo/index.html',
    'product/hugo-13mm-impact-drill-hg-id13/index.html',
    'search/index.html',
    'search-index.json',
    'sitemap.xml',
    'robots.txt',
    '404.html',
  ]) {
    assert.ok(has(page), `missing ${page}`);
  }
});

test('a product filed only on a deep leaf still appears on its ancestors', () => {
  // dbl.lk's parent categories come back empty for exactly this reason.
  const slug = 'hugo-max-borehole-pump-4-inch-hm-bh400';
  assert.match(read('c/submersible/borehole/index.html'), new RegExp(slug));
  assert.match(read('c/submersible/index.html'), new RegExp(slug));
  assert.match(read('d/water-pumps/index.html'), new RegExp(slug));
});

test('two spec rows sharing a label both survive', () => {
  // The whole reason specs are a jsonb ARRAY: an object keyed by label
  // would have silently merged these and lost a figure.
  const html = read('product/hugo-13mm-impact-drill-hg-id13/index.html').replace(/\s+/g, ' ');
  assert.match(html, /Power<\/th> <td class="spec__unit">W<\/td> <td class="spec__value">750</);
  assert.match(html, /Power<\/th> <td class="spec__unit">HP<\/td> <td class="spec__value">1\.0</);
});

test('sections and captions render in order', () => {
  const html = read('product/hugo-sds-plus-rotary-hammer-hg-rh26/index.html');
  const perf = html.indexOf('Performance');
  const caption = html.indexOf('Figures measured at 230V');
  const capacity = html.indexOf('Capacity');
  assert.ok(perf > -1 && caption > perf && capacity > caption, 'spec sections are out of order');
});

test('a product with no specs renders prose only, not an empty table', () => {
  const html = read('product/welding-plant-commissioning-bt-weld-svc/index.html');
  assert.ok(!html.includes('class="spec"'), 'rendered an empty spec table');
  assert.match(html, /engineering division commissions/);
});

test('names containing HTML characters are escaped', () => {
  const html = read('product/hugo-4-inch-angle-grinder-hg-ag100/index.html');
  assert.match(html, /HUGO 4&quot; Angle Grinder &amp; Cutter/);
  assert.ok(!html.includes('HUGO 4" Angle Grinder & Cutter'), 'raw unescaped name leaked into the page');
});

test('retired URLs get a stub pointing at the live page', () => {
  const stub = read('product/hugo-impact-drill-13mm/index.html');
  assert.match(stub, /canonical.*hugo-13mm-impact-drill-hg-id13/);
  assert.match(stub, /noindex, follow/);
  assert.ok(has('c/hammers/sds-plus/index.html'), 'a re-parented category lost its redirect');
});

test('a stub is NOT emitted when its destination no longer exists', () => {
  // Otherwise a deleted product leaves a redirect into a 404.
  assert.ok(!has('product/discontinued-thing/index.html'));
});

test('the search index carries ready-to-use image URLs', () => {
  const index = JSON.parse(read('search-index.json'));
  assert.equal(index.length, 6);
  const drill = index.find((r) => r.s === 'HG-ID13');
  assert.ok(drill, 'the drill is missing from the search index');
  assert.match(drill.i, /^https:\/\/images\.example\.test\/.*-400\.webp$/);
  assert.equal(drill.u, '/product/hugo-13mm-impact-drill-hg-id13/');
});

test('the admin is kept out of the index', () => {
  assert.match(read('robots.txt'), /Disallow: \/admin\//);
  assert.ok(!read('sitemap.xml').includes('/admin/'));
});

test('the service role key never reaches the browser', () => {
  // The single worst thing this project could ship.
  const cfg = read('admin/config.js');
  assert.ok(!/service_role|SERVICE_ROLE/i.test(cfg), 'service role key leaked into admin config');
  assert.ok(!/deployHook|deploy_hook/i.test(cfg), 'a deploy credential leaked into admin config');
});

test('products are not published unless they say they are', () => {
  // The fixture is all published; the guard being tested is that the
  // build filters on status at all rather than rendering everything.
  const src = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(src, /status=eq\.published/);
});

test('a rebuild with no changes writes nothing', () => {
  const second = run('build.mjs', ['--from-cache']);
  assert.match(second, /written\s+0\b/, `expected no writes:\n${second}`);
  assert.match(firstBuild, /written\s+[1-9]/);
});

// ---------------------------------------------------------------------
// Base path. GitHub Pages serves a project site from /bestech-catalog/
// while a real domain serves it from the root. Getting this wrong
// produces a site whose every stylesheet and link 404s — which is
// exactly what happened on the first deploy attempt.
// ---------------------------------------------------------------------
test('with BASE_PATH set, links are prefixed but files stay at the root', () => {
  rmSync(DIST, { recursive: true, force: true });
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--from-cache'], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...env, BASE_PATH: '/bestech-catalog', SITE_ORIGIN: 'https://abduxla.github.io' },
  });

  const home = read('index.html');
  assert.match(home, /href="\/bestech-catalog\/assets\/css\/site\.css"/);
  assert.match(home, /src="\/bestech-catalog\/assets\/js\/site\.js"/);
  assert.match(home, /href="\/bestech-catalog\/brands\/"/);

  // The files themselves must NOT be nested under the prefix — the host
  // serves dist/ AT that prefix, so doing both would give
  // /bestech-catalog/bestech-catalog/.
  assert.ok(has('index.html'), 'index.html is not at the root of dist/');
  assert.ok(!has('bestech-catalog/index.html'), 'output was double-nested under the base path');
  assert.ok(has('product/hugo-13mm-impact-drill-hg-id13/index.html'));

  assert.match(read('sitemap.xml'), /<loc>https:\/\/abduxla\.github\.io\/bestech-catalog\/<\/loc>/);

  // Restore the default (no base path) build for any later run.
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--from-cache'], { cwd: ROOT, env, encoding: 'utf8' });
});

test('a preview build is impossible to mistake for the real site', () => {
  rmSync(DIST, { recursive: true, force: true });
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--from-cache'], {
    cwd: ROOT, encoding: 'utf8', env: { ...env, PREVIEW_BUILD: '1' },
  });
  assert.match(read('robots.txt'), /Disallow: \/\s*$/m, 'preview is crawlable');
  assert.ok(!read('robots.txt').includes('Sitemap:'), 'preview advertises a sitemap');
  assert.match(read('index.html'), /noindex, nofollow/);
  assert.match(read('index.html'), /PREVIEW/);
  assert.match(read('product/hugo-13mm-impact-drill-hg-id13/index.html'), /noindex, nofollow/);
});

#!/usr/bin/env node
// =====================================================================
// Development fixture.
//
//   node scripts/dev-fixture.mjs && node scripts/build.mjs --from-cache
//
// Writes a realistic .cache/snapshot.json so the entire site can be
// built, viewed and worked on with NO database, NO keys and NO network.
//
// This is not a toy. It is how templates get developed and reviewed
// before the client's catalogue arrives, and it is the regression test
// for the build: it deliberately contains every awkward shape the real
// data will have —
//
//   * a spec table with two rows sharing the label "Power" (HP and Kw),
//     which is exactly what a jsonb object would have silently merged
//   * a two-section spec with a caption between the tables
//   * a prose-only product with NO spec table at all
//   * a product with no images
//   * a product with no brand
//   * a product filed only on a deep leaf, to prove its ancestors list it
//   * a renamed product in path_history, to prove the redirect stub
//   * an ampersand and quotes in a product name, to prove escaping
//
// If the build survives this file, it will survive the real one.
// =====================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cache', 'snapshot.json');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const divisions = [
  { id: id(1), slug: 'power-tools-machinery', name: 'Power Tools & Machinery',
    tagline: 'Drills, grinders, saws and workshop machinery.',
    blurb: 'Professional and industrial power tools for construction, fabrication and the workshop.',
    hero_key: '', sort: 1 },
  { id: id(2), slug: 'water-pumps', name: 'Water Pumps',
    tagline: 'Domestic, agricultural and industrial pumping.',
    blurb: 'Surface pumps, submersibles, booster sets and pressure systems.',
    hero_key: '', sort: 2 },
];

const brands = [
  { id: id(10), slug: 'hugo', name: 'HUGO', blurb: 'Power tools distributed by Bestech in Sri Lanka.', logo_key: '', is_flagship: true, sort: 1 },
  { id: id(11), slug: 'hugo-max', name: 'HUGO MAX', blurb: 'Water pumps and pressure systems.', logo_key: '', is_flagship: true, sort: 2 },
  { id: id(12), slug: 'makita', name: 'Makita', blurb: '', logo_key: '', is_flagship: false, sort: 10 },
  { id: id(13), slug: 'bosch', name: 'Bosch', blurb: '', logo_key: '', is_flagship: false, sort: 11 },
];

const categories = [
  // division 1
  { id: id(20), division_id: id(1), parent_id: null,   slug: 'drills',          name: 'Drills',           blurb: 'Rotary, impact and hammer drills.', image_key: 'cat/drills',  path: 'drills', depth: 0, sort: 1 },
  { id: id(21), division_id: id(1), parent_id: id(20), slug: 'impact-drills',   name: 'Impact Drills',    blurb: '', image_key: '', path: 'drills/impact-drills', depth: 1, sort: 1 },
  { id: id(22), division_id: id(1), parent_id: id(20), slug: 'rotary-hammers',  name: 'Rotary Hammers',   blurb: '', image_key: '', path: 'drills/rotary-hammers', depth: 1, sort: 2 },
  { id: id(23), division_id: id(1), parent_id: id(22), slug: 'sds-plus',        name: 'SDS-Plus',         blurb: '', image_key: '', path: 'drills/rotary-hammers/sds-plus', depth: 2, sort: 1 },
  { id: id(24), division_id: id(1), parent_id: null,   slug: 'grinders',        name: 'Grinders',         blurb: '', image_key: 'cat/grinders', path: 'grinders', depth: 0, sort: 2 },
  { id: id(25), division_id: id(1), parent_id: null,   slug: 'welding',         name: 'Welding',          blurb: '', image_key: '', path: 'welding', depth: 0, sort: 3 },
  // division 2
  { id: id(30), division_id: id(2), parent_id: null,   slug: 'surface-pumps',   name: 'Surface Pumps',    blurb: 'Self-priming and centrifugal pumps.', image_key: 'cat/surface', path: 'surface-pumps', depth: 0, sort: 1 },
  { id: id(31), division_id: id(2), parent_id: null,   slug: 'submersible',     name: 'Submersible Pumps', blurb: '', image_key: '', path: 'submersible', depth: 0, sort: 2 },
  { id: id(32), division_id: id(2), parent_id: id(31), slug: 'borehole',        name: 'Borehole Pumps',   blurb: '', image_key: '', path: 'submersible/borehole', depth: 1, sort: 1 },
];

const products = [
  {
    id: id(100), sku: 'HG-ID13', slug: 'hugo-13mm-impact-drill-hg-id13',
    name: 'HUGO 13mm Impact Drill', brand_id: id(10), primary_category_id: id(21),
    summary: 'Reversible 13mm impact drill with variable speed and a metal gearbox.',
    description: 'A general-purpose impact drill for masonry, timber and steel.\n\nThe two-speed metal gearbox and 13mm keyless chuck suit site work and repeat drilling. Supplied with a side handle and depth stop.',
    // The duplicate-label case. An object keyed by label would have
    // merged these two rows into one and lost the HP figure.
    specs: [{ title: null, caption: null, rows: [
      { label: 'Power', unit: 'W', value: '750' },
      { label: 'Power', unit: 'HP', value: '1.0' },
      { label: 'Chuck capacity', unit: 'mm', value: '13' },
      { label: 'No load speed', unit: 'rpm', value: '0–2800' },
      { label: 'Impact rate', unit: 'bpm', value: '0–44800' },
      { label: 'Max drilling — concrete', unit: 'mm', value: '16' },
      { label: 'Max drilling — steel', unit: 'mm', value: '13' },
      { label: 'Weight', unit: 'kg', value: '2.4' },
    ] }],
    status: 'published', is_featured: true, sort: 1,
  },
  {
    id: id(101), sku: 'HG-RH26', slug: 'hugo-sds-plus-rotary-hammer-hg-rh26',
    name: 'HUGO SDS-Plus Rotary Hammer 26mm', brand_id: id(10), primary_category_id: id(23),
    summary: 'Three-mode 26mm SDS-Plus hammer for drilling and light chipping.',
    description: 'Rotation only, rotary hammer and hammer-only modes with a vibration-damped grip.',
    // Two sections with a caption — the dbl.lk welding-plant shape.
    specs: [
      { title: 'Performance', caption: 'Figures measured at 230V / 50Hz.', rows: [
        { label: 'Input power', unit: 'W', value: '800' },
        { label: 'Impact energy', unit: 'J', value: '2.7' },
        { label: 'No load speed', unit: 'rpm', value: '0–1100' },
        { label: 'Blows per minute', unit: 'bpm', value: '0–4500' },
      ] },
      { title: 'Capacity', caption: null, rows: [
        { label: 'Concrete', unit: 'mm', value: '26' },
        { label: 'Steel', unit: 'mm', value: '13' },
        { label: 'Wood', unit: 'mm', value: '30' },
        { label: 'Core bit', unit: 'mm', value: '68' },
        { label: 'Weight', unit: 'kg', value: '2.9' },
      ] },
    ],
    status: 'published', is_featured: true, sort: 2,
  },
  {
    id: id(102), sku: 'HG-AG100', slug: 'hugo-4-inch-angle-grinder-hg-ag100',
    name: 'HUGO 4" Angle Grinder & Cutter', // ampersand + inch quote: escaping test
    brand_id: id(10), primary_category_id: id(24),
    summary: 'Compact 100mm grinder with a restart-protected switch.',
    description: '',
    specs: [{ title: null, caption: null, rows: [
      { label: 'Power', unit: 'W', value: '710' },
      { label: 'Disc diameter', unit: 'mm', value: '100' },
      { label: 'No load speed', unit: 'rpm', value: '11000' },
      { label: 'Spindle', unit: '', value: 'M10' },
      { label: 'Weight', unit: 'kg', value: '1.8' },
    ] }],
    status: 'published', is_featured: true, sort: 3,
  },
  {
    id: id(103), sku: 'HM-JET100', slug: 'hugo-max-self-priming-jet-pump-1hp-hm-jet100',
    name: 'HUGO MAX Self-Priming Jet Pump 1HP', brand_id: id(11), primary_category_id: id(30),
    summary: 'Cast iron self-priming jet pump for domestic supply and garden use.',
    description: 'Suitable for shallow wells and overhead tank filling.',
    specs: [{ title: null, caption: 'Performance curve available on request.', rows: [
      { label: 'Power', unit: 'HP', value: '1.0' },
      { label: 'Power', unit: 'kW', value: '0.75' },
      { label: 'Max head', unit: 'm', value: '40' },
      { label: 'Max flow', unit: 'l/min', value: '60' },
      { label: 'Suction lift', unit: 'm', value: '9' },
      { label: 'Outlet', unit: 'in', value: '1' },
      { label: 'Voltage', unit: 'V', value: '230 / 50Hz' },
    ] }],
    status: 'published', is_featured: true, sort: 1,
  },
  {
    id: id(104), sku: 'HM-BH400', slug: 'hugo-max-borehole-pump-4-inch-hm-bh400',
    name: 'HUGO MAX 4" Borehole Pump', brand_id: id(11),
    primary_category_id: id(32),   // deep leaf only: ancestors must still list it
    summary: 'Stainless steel 4-inch submersible borehole pump with control box.',
    description: '',
    specs: [{ title: null, caption: null, rows: [
      { label: 'Power', unit: 'HP', value: '1.5' },
      { label: 'Max head', unit: 'm', value: '95' },
      { label: 'Max flow', unit: 'l/min', value: '50' },
      { label: 'Outlet', unit: 'in', value: '1.25' },
      { label: 'Body', unit: '', value: 'Stainless steel' },
    ] }],
    status: 'published', is_featured: false, sort: 2,
  },
  {
    // Prose only, no spec table, no brand, no images — all three at once.
    id: id(105), sku: 'BT-WELD-SVC', slug: 'welding-plant-commissioning-bt-weld-svc',
    name: 'Welding Plant Commissioning & Service', brand_id: null, primary_category_id: id(25),
    summary: 'On-site commissioning, calibration and servicing of welding plant.',
    description: 'Our engineering division commissions and services welding plant across the island.\n\nThis is a service rather than a stocked item. Call the engineering office to arrange a site visit.',
    specs: [],
    status: 'published', is_featured: false, sort: 1,
  },
];

const links = [
  { product_id: id(100), category_id: id(21) },
  { product_id: id(101), category_id: id(23) },
  { product_id: id(101), category_id: id(21) },  // also filed under impact drills
  { product_id: id(102), category_id: id(24) },
  { product_id: id(103), category_id: id(30) },
  { product_id: id(104), category_id: id(32) },
  { product_id: id(105), category_id: id(25) },
];

const images = [
  { product_id: id(100), storage_key: 'products/hg-id13/1',  alt: 'HUGO 13mm impact drill', width: 1600, height: 1600, position: 0 },
  { product_id: id(100), storage_key: 'products/hg-id13/2',  alt: 'Side handle and depth stop', width: 1600, height: 1600, position: 1 },
  { product_id: id(100), storage_key: 'products/hg-id13/3',  alt: 'In the carry case', width: 1600, height: 1600, position: 2 },
  { product_id: id(101), storage_key: 'products/hg-rh26/1',  alt: 'HUGO SDS-Plus rotary hammer', width: 1600, height: 1600, position: 0 },
  { product_id: id(102), storage_key: 'products/hg-ag100/1', alt: 'HUGO 4 inch angle grinder', width: 1600, height: 1600, position: 0 },
  { product_id: id(103), storage_key: 'products/hm-jet100/1', alt: 'HUGO MAX jet pump', width: 1600, height: 1600, position: 0 },
  { product_id: id(103), storage_key: 'products/hm-jet100/2', alt: 'Pump nameplate', width: 1600, height: 1600, position: 1 },
  // 104 and 105 deliberately have none.
];

// A product that was renamed once, and a category that was re-parented:
// both must produce a working stub page.
const history = [
  { old_path: '/product/hugo-impact-drill-13mm', new_path: '/product/hugo-13mm-impact-drill-hg-id13', kind: 'product' },
  { old_path: '/c/hammers/sds-plus',             new_path: '/c/drills/rotary-hammers/sds-plus',       kind: 'category' },
  // Points at something that no longer exists: must be SKIPPED, not
  // emitted as a stub into a 404.
  { old_path: '/product/discontinued-thing',     new_path: '/product/does-not-exist',                 kind: 'product' },
];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  divisions, brands, categories, products, links, images, history,
  fetched_at: new Date().toISOString(),
  _fixture: true,
}), 'utf8');

console.log(`\n  Wrote fixture snapshot -> .cache/snapshot.json`);
console.log(`    ${divisions.length} divisions, ${brands.length} brands, ${categories.length} categories, ${products.length} products\n`);
console.log('  Now:  node scripts/build.mjs --from-cache\n');

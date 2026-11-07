// =====================================================================
// Bulk photo filename matching.
//
// Run with `npm test`. Uses node:test, which is built into Node — no
// test framework to install, keep current or have abandoned.
//
// This is the highest-risk pure function in the project. It decides
// which product each of several hundred photographs belongs to, and a
// quiet off-by-one here attaches photo 2 of a drill as the main image
// of a pump. Nobody would notice until a customer did.
// =====================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilename } from '../static/admin/js/images.js';

// The real index is built from the catalogue: normalised SKU -> real SKU.
const index = new Map([
  ['hgid13', 'HG-ID13'],
  ['hgrh26', 'HG-RH26'],
  ['hmjet100', 'HM-JET100'],   // a model number that genuinely ends in digits
  ['hmbh400', 'HM-BH400'],
  ['btweldsvc', 'BT-WELD-SVC'],
]);

const p = (name) => parseFilename(name, index);

test('a bare model number is the main photo', () => {
  assert.deepEqual(p('HG-ID13.jpg'), { sku: 'HG-ID13', position: 0, base: 'HG-ID13' });
});

test('a trailing number selects the photo position, 1-based in, 0-based out', () => {
  assert.equal(p('HG-ID13-2.jpg').sku, 'HG-ID13');
  assert.equal(p('HG-ID13-2.jpg').position, 1);
  assert.equal(p('HG-ID13-3.jpg').position, 2);
});

test('case and punctuation do not matter', () => {
  for (const name of ['hg_id13.jpg', 'HG ID13.JPG', 'hgid13.jpeg', 'Hg-Id13.png']) {
    assert.equal(p(name).sku, 'HG-ID13', name);
  }
});

test('the shapes Windows and phones actually produce', () => {
  assert.deepEqual(p('HG-ID13 (2).jpg'), { sku: 'HG-ID13', position: 1, base: 'HG-ID13' });
  assert.equal(p('HG-ID13 copy 2.jpg').sku, 'HG-ID13');
  assert.equal(p('HG-ID13 copy 2.jpg').position, 1);
  assert.equal(p('hg_id13_3.JPG').position, 2);
});

test('a model number ending in digits is not mistaken for an index', () => {
  // The whole point: "HM-JET100" must not parse as "HM-JET" photo 100.
  const r = p('HM-JET100.jpg');
  assert.equal(r.sku, 'HM-JET100');
  assert.equal(r.position, 0);
});

test('...and such a model can still be numbered', () => {
  const r = p('HM-JET100-2.jpg');
  assert.equal(r.sku, 'HM-JET100');
  assert.equal(r.position, 1);
});

test('a model number containing words still matches', () => {
  assert.equal(p('BT-WELD-SVC.jpg').sku, 'BT-WELD-SVC');
  assert.equal(p('BT-WELD-SVC-2.jpg').position, 1);
});

test('an unknown product is reported, never guessed', () => {
  const r = p('random-photo.jpg');
  assert.equal(r.sku, null);
  // The operator is shown what was tried, so they can rename or pick.
  assert.ok(r.base.length > 0);
});

test('position is never negative, whatever the filename says', () => {
  assert.ok(p('HG-ID13-0.jpg').position >= 0);
});

test('extensions of any case are stripped', () => {
  for (const ext of ['.jpg', '.JPG', '.jpeg', '.png', '.PNG', '.webp', '.HEIC']) {
    assert.equal(p(`HG-RH26${ext}`).sku, 'HG-RH26', ext);
  }
});

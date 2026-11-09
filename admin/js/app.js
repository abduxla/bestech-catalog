// =====================================================================
// Bestech admin.
//
// A static page. There is no admin server — it talks straight to
// Postgres through PostgREST, and every rule that protects the data is
// a row-level-security policy in the database, not a check in this
// file. That matters: an admin UI that enforces its own permissions is
// one `curl` away from being bypassed. Here, the worst a hostile client
// can do is exactly what the signed-in user was already allowed to do.
//
// No framework and no build step, for the same reason as the rest of
// the project: this has to still run in five years.
// =====================================================================

import * as api from './api.js';
import { derive, parseFilename, SIZES } from './images.js';

// ---------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const slugify = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function toast(message, kind = 'ok') {
  const box = $('#toasts');
  const t = el('div', { class: `toast toast--${kind}` }, message);
  box.append(t);
  setTimeout(() => t.classList.add('is-out'), kind === 'err' ? 7000 : 3200);
  setTimeout(() => t.remove(), kind === 'err' ? 7600 : 3800);
}

const fail = (e) => toast(e && e.message ? e.message : String(e), 'err');

function confirmDanger(message) { return window.confirm(message); }

// ---------------------------------------------------------------------
// Shared state — loaded once per session, refreshed when it changes.
// ---------------------------------------------------------------------
const state = {
  brands: [], categories: [], divisions: [],
  products: [], imagesByProduct: new Map(),
  dirty: false,
};

async function loadReference() {
  const [divisions, brands, categories] = await Promise.all([
    api.selectAll('divisions', { select: 'id,slug,name,sort', order: 'sort.asc' }),
    api.selectAll('brands', { select: 'id,slug,name,sort', order: 'sort.asc,name.asc' }),
    api.selectAll('categories', { select: 'id,division_id,parent_id,slug,name,path,depth', order: 'path.asc' }),
  ]);
  Object.assign(state, { divisions, brands, categories });
}

async function loadProducts() {
  state.products = await api.selectAll('products', {
    select: 'id,sku,slug,name,brand_id,primary_category_id,summary,description,specs,status,is_featured,sort,updated_at',
    order: 'updated_at.desc',
  });
  const images = await api.selectAll('product_images', {
    select: 'id,product_id,storage_key,alt,width,height,position',
    order: 'product_id.asc,position.asc',
  });
  state.imagesByProduct = new Map();
  for (const im of images) {
    if (!state.imagesByProduct.has(im.product_id)) state.imagesByProduct.set(im.product_id, []);
    state.imagesByProduct.get(im.product_id).push(im);
  }
}

const catLabel = (c) => `${'— '.repeat(c.depth)}${c.name}`;
const brandName = (id) => (state.brands.find((b) => b.id === id) || {}).name || '';
const catName = (id) => (state.categories.find((c) => c.id === id) || {}).name || '';

// =====================================================================
// Sign in
// =====================================================================
function viewLogin(message) {
  const form = el('form', { class: 'card login', onsubmit: onSubmit },
    el('h1', {}, 'Bestech admin'),
    message && el('p', { class: 'note note--err' }, message),
    el('label', {}, 'Email', el('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    el('label', {}, 'Password', el('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
    el('button', { class: 'btn btn--primary', type: 'submit' }, 'Sign in'),
    el('p', { class: 'muted' }, 'Accounts are created by an existing administrator.'),
  );

  async function onSubmit(e) {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await api.signIn(form.email.value.trim(), form.password.value);
      if (!(await api.isAdmin())) {
        api.signOut();
        throw new Error('That account is not an administrator of this catalogue.');
      }
      await boot();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Sign in';
      fail(err);
    }
  }

  render(form, false);
}

// =====================================================================
// Product list
// =====================================================================
function viewProducts() {
  let filter = '', status = '';

  const search = el('input', {
    type: 'search', placeholder: 'Model number or name', class: 'field',
    oninput: (e) => { filter = e.target.value.toLowerCase(); paint(); },
  });
  const statusSel = el('select', {
    class: 'field',
    onchange: (e) => { status = e.target.value; paint(); },
  },
    el('option', { value: '' }, 'All statuses'),
    el('option', { value: 'published' }, 'Published'),
    el('option', { value: 'draft' }, 'Draft'),
    el('option', { value: 'archived' }, 'Archived'),
  );

  const tbody = el('tbody');
  const count = el('p', { class: 'muted' });

  function paint() {
    const rows = state.products.filter((p) => {
      if (status && p.status !== status) return false;
      if (!filter) return true;
      return (`${p.sku} ${p.name} ${brandName(p.brand_id)}`).toLowerCase().includes(filter);
    });

    count.textContent = `${rows.length} of ${state.products.length} products`;
    tbody.replaceChildren(...rows.slice(0, 400).map((p) => {
      const imgs = state.imagesByProduct.get(p.id) || [];
      return el('tr', {},
        el('td', { class: 'cell-thumb' },
          imgs.length
            ? el('img', { src: api.publicUrl(imgs[0].storage_key, 400), alt: '', loading: 'lazy' })
            : el('span', { class: 'nothumb', title: 'No photograph yet' }, '—')),
        el('td', {}, el('code', {}, p.sku)),
        el('td', {},
          el('a', { href: `#/product/${p.id}`, class: 'link' }, p.name),
          imgs.length === 0 && el('span', { class: 'flag flag--warn', title: 'This product has no photograph' }, 'no photo')),
        el('td', { class: 'muted' }, brandName(p.brand_id)),
        el('td', { class: 'muted' }, catName(p.primary_category_id)),
        el('td', {}, el('span', { class: `pill pill--${p.status}` }, p.status)),
        el('td', { class: 'muted' }, (p.specs || []).reduce((n, s) => n + (s.rows || []).length, 0) || '—'),
      );
    }));

    if (rows.length > 400) {
      tbody.append(el('tr', {}, el('td', { colspan: '7', class: 'muted' },
        `Showing the first 400. Narrow the search to see the rest.`)));
    }
  }

  const noPhoto = state.products.filter((p) => !(state.imagesByProduct.get(p.id) || []).length).length;

  const page = el('div', {},
    el('div', { class: 'pagehead' },
      el('h1', {}, 'Products'),
      el('div', { class: 'pagehead__actions' },
        el('a', { class: 'btn', href: '#/photos' }, 'Bulk photo upload'),
        el('button', { class: 'btn btn--primary', onclick: () => newProduct() }, 'New product'),
      ),
    ),
    noPhoto > 0 && el('p', { class: 'note' },
      `${noPhoto} product${noPhoto === 1 ? ' has' : 's have'} no photograph. `,
      el('a', { href: '#/photos', class: 'link' }, 'Upload photos in bulk →')),
    el('div', { class: 'toolbar' }, search, statusSel, count),
    el('div', { class: 'card card--flush' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, ''), el('th', {}, 'Model'), el('th', {}, 'Name'),
          el('th', {}, 'Brand'), el('th', {}, 'Category'), el('th', {}, 'Status'), el('th', {}, 'Specs'))),
        tbody)),
  );

  paint();
  render(page);
}

async function newProduct() {
  const sku = window.prompt('Model number (SKU). This is permanent and is how imports match the product.');
  if (!sku || !sku.trim()) return;
  const name = window.prompt('Product name');
  if (!name || !name.trim()) return;
  try {
    const [row] = await api.insert('products', [{
      sku: sku.trim(), name: name.trim(),
      slug: slugify(`${name}-${sku}`),
      status: 'draft', specs: [],
    }]);
    await loadProducts();
    location.hash = `#/product/${row.id}`;
    toast('Created as a draft. It will not appear on the site until you publish it.');
  } catch (e) { fail(e); }
}

// =====================================================================
// Product editor
// =====================================================================
function viewProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) { location.hash = '#/products'; return; }

  // Edit a copy. Nothing is written until Save, so an abandoned edit
  // leaves the live catalogue untouched.
  const draft = JSON.parse(JSON.stringify({
    name: p.name, slug: p.slug, brand_id: p.brand_id, primary_category_id: p.primary_category_id,
    summary: p.summary || '', description: p.description || '',
    specs: Array.isArray(p.specs) ? p.specs : [],
    status: p.status, is_featured: !!p.is_featured, sort: p.sort || 0,
  }));

  const field = (label, input, hint) =>
    el('label', { class: 'f' }, el('span', { class: 'f__label' }, label), input,
      hint && el('span', { class: 'f__hint' }, hint));

  const nameIn = el('input', { class: 'field', value: draft.name, oninput: (e) => { draft.name = e.target.value; } });
  const slugIn = el('input', { class: 'field', value: draft.slug, oninput: (e) => { draft.slug = e.target.value; } });
  const summaryIn = el('input', { class: 'field', value: draft.summary, oninput: (e) => { draft.summary = e.target.value; } });
  const descIn = el('textarea', { class: 'field', rows: '7', oninput: (e) => { draft.description = e.target.value; } });
  descIn.value = draft.description;

  const brandIn = el('select', { class: 'field', onchange: (e) => { draft.brand_id = e.target.value || null; } },
    el('option', { value: '' }, '— none —'),
    ...state.brands.map((b) => el('option', { value: b.id, selected: b.id === draft.brand_id }, b.name)));

  const catIn = el('select', { class: 'field', onchange: (e) => { draft.primary_category_id = e.target.value || null; } },
    el('option', { value: '' }, '— none —'),
    ...state.categories.map((c) => el('option', { value: c.id, selected: c.id === draft.primary_category_id }, catLabel(c))));

  const statusIn = el('select', { class: 'field', onchange: (e) => { draft.status = e.target.value; } },
    ...['draft', 'published', 'archived'].map((s) =>
      el('option', { value: s, selected: s === draft.status }, s)));

  const featuredIn = el('input', { type: 'checkbox', checked: draft.is_featured, onchange: (e) => { draft.is_featured = e.target.checked; } });

  // ---- specs ----
  const specBox = el('div', { class: 'specs' });

  function paintSpecs() {
    specBox.replaceChildren(...draft.specs.map((section, si) => {
      const rowsBox = el('div', { class: 'specrows' });

      const paintRows = () => rowsBox.replaceChildren(
        el('div', { class: 'specrow specrow--head' },
          el('span', {}, 'Label'), el('span', {}, 'Unit'), el('span', {}, 'Value'), el('span', {}, '')),
        ...(section.rows || []).map((r, ri) => el('div', { class: 'specrow' },
          el('input', { class: 'field', value: r.label || '', placeholder: 'Power', oninput: (e) => { r.label = e.target.value; } }),
          el('input', { class: 'field', value: r.unit || '', placeholder: 'kW', oninput: (e) => { r.unit = e.target.value; } }),
          el('input', { class: 'field', value: r.value || '', placeholder: '0.75', oninput: (e) => { r.value = e.target.value; } }),
          el('span', { class: 'specrow__tools' },
            el('button', { class: 'ibtn', title: 'Move up', disabled: ri === 0, onclick: () => { const [x] = section.rows.splice(ri, 1); section.rows.splice(ri - 1, 0, x); paintRows(); } }, '↑'),
            el('button', { class: 'ibtn', title: 'Move down', disabled: ri === section.rows.length - 1, onclick: () => { const [x] = section.rows.splice(ri, 1); section.rows.splice(ri + 1, 0, x); paintRows(); } }, '↓'),
            el('button', { class: 'ibtn ibtn--danger', title: 'Remove row', onclick: () => { section.rows.splice(ri, 1); paintRows(); } }, '×')),
        )),
        el('button', { class: 'btn btn--small', onclick: () => { (section.rows = section.rows || []).push({ label: '', unit: '', value: '' }); paintRows(); } }, '+ Add row'),
      );
      paintRows();

      return el('div', { class: 'card specsection' },
        el('div', { class: 'specsection__head' },
          el('input', {
            class: 'field', placeholder: 'Section heading (optional, e.g. "Performance")',
            value: section.title || '', oninput: (e) => { section.title = e.target.value || null; },
          }),
          el('button', {
            class: 'ibtn ibtn--danger', title: 'Remove this whole section',
            onclick: () => { if (confirmDanger('Remove this entire spec section?')) { draft.specs.splice(si, 1); paintSpecs(); } },
          }, '×')),
        rowsBox,
        el('input', {
          class: 'field field--caption', placeholder: 'Caption under this table (optional)',
          value: section.caption || '', oninput: (e) => { section.caption = e.target.value || null; },
        }),
      );
    }),
    el('button', {
      class: 'btn btn--small',
      onclick: () => { draft.specs.push({ title: null, caption: null, rows: [{ label: '', unit: '', value: '' }] }); paintSpecs(); },
    }, '+ Add spec section'));
  }
  paintSpecs();

  // ---- images ----
  const imgBox = el('div', { class: 'imggrid' });

  function paintImages() {
    const imgs = state.imagesByProduct.get(p.id) || [];
    imgBox.replaceChildren(...imgs.map((im, i) => el('div', { class: 'imgcard' },
      el('img', { src: api.publicUrl(im.storage_key, 400), alt: '', loading: 'lazy' }),
      i === 0 && el('span', { class: 'imgcard__main' }, 'Main'),
      el('input', {
        class: 'field field--small', placeholder: 'Describe the photo', value: im.alt || '',
        onchange: async (e) => {
          try { await api.update('product_images', `id=eq.${im.id}`, { alt: e.target.value }); toast('Caption saved'); }
          catch (err) { fail(err); }
        },
      }),
      el('div', { class: 'imgcard__tools' },
        el('button', { class: 'ibtn', title: 'Move left', disabled: i === 0, onclick: () => reorder(i, i - 1) }, '←'),
        el('button', { class: 'ibtn', title: 'Move right', disabled: i === imgs.length - 1, onclick: () => reorder(i, i + 1) }, '→'),
        el('button', { class: 'ibtn ibtn--danger', title: 'Delete photo', onclick: () => removeImage(im) }, 'Delete')),
    )),
    el('label', { class: 'imgdrop' },
      el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addImages([...e.target.files]) }),
      el('span', {}, '+ Add photos'),
      el('span', { class: 'muted' }, 'Resized here in your browser')));
  }

  async function reorder(from, to) {
    const imgs = state.imagesByProduct.get(p.id) || [];
    const [moved] = imgs.splice(from, 1);
    imgs.splice(to, 0, moved);
    paintImages();
    try {
      await api.upsert('product_images',
        imgs.map((im, i) => ({ id: im.id, product_id: p.id, storage_key: im.storage_key, alt: im.alt, width: im.width, height: im.height, position: i })),
        'id');
      imgs.forEach((im, i) => { im.position = i; });
    } catch (e) { fail(e); await loadProducts(); paintImages(); }
  }

  async function removeImage(im) {
    if (!confirmDanger('Delete this photograph? This cannot be undone.')) return;
    try {
      await api.remove('product_images', `id=eq.${im.id}`);
      await api.deleteObjects(SIZES.map((s) => `${im.storage_key}-${s}.webp`));
      const imgs = (state.imagesByProduct.get(p.id) || []).filter((x) => x.id !== im.id);
      state.imagesByProduct.set(p.id, imgs);
      paintImages();
      toast('Photograph deleted');
    } catch (e) { fail(e); }
  }

  async function addImages(files) {
    if (!files.length) return;
    const start = (state.imagesByProduct.get(p.id) || []).length;
    let done = 0;
    for (const [i, file] of files.entries()) {
      try {
        const rec = await uploadOne(p.sku, file, start + i);
        const list = state.imagesByProduct.get(p.id) || [];
        list.push(rec); state.imagesByProduct.set(p.id, list);
        done++;
        paintImages();
      } catch (e) { fail(e); }
    }
    if (done) toast(`${done} photo${done === 1 ? '' : 's'} uploaded`);
  }
  paintImages();

  // ---- save ----
  async function save() {
    const btn = $('#saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // Drop blank spec rows and empty sections rather than storing
      // them: a half-typed row is a mistake, not data.
      const specs = draft.specs
        .map((s) => ({
          title: s.title || null,
          caption: s.caption || null,
          rows: (s.rows || []).filter((r) => (r.label || '').trim()),
        }))
        .filter((s) => s.rows.length);

      const patch = {
        name: draft.name.trim(), slug: slugify(draft.slug) || slugify(`${draft.name}-${p.sku}`),
        brand_id: draft.brand_id, primary_category_id: draft.primary_category_id,
        summary: draft.summary.trim(), description: draft.description.trim(),
        specs, status: draft.status, is_featured: draft.is_featured, sort: Number(draft.sort) || 0,
      };

      if (patch.slug !== p.slug &&
          !confirmDanger(
            `This changes the product's web address:\n\n  /product/${p.slug}/\n  /product/${patch.slug}/\n\n` +
            'Anyone who bookmarked or shared the old link, and every search result pointing at it, ' +
            'will be redirected automatically — but the old address stops being the real one.\n\nContinue?')) {
        btn.disabled = false; btn.textContent = 'Save';
        return;
      }

      await api.update('products', `id=eq.${p.id}`, patch);
      // Keep the primary category in the m2m table so listings include it.
      if (patch.primary_category_id) {
        await api.upsert('product_categories',
          [{ product_id: p.id, category_id: patch.primary_category_id }], 'product_id,category_id');
      }
      await loadProducts();
      state.dirty = true;
      updatePublishBanner();
      toast('Saved. Press Publish when you want it on the live site.');
      btn.disabled = false; btn.textContent = 'Save';
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Save';
      fail(e);
    }
  }

  const page = el('div', {},
    el('div', { class: 'pagehead' },
      el('div', {},
        el('a', { href: '#/products', class: 'back' }, '← All products'),
        el('h1', {}, p.name),
        el('p', { class: 'muted' }, 'Model ', el('code', {}, p.sku), ' · ',
          el('span', {}, `/product/${p.slug}/`))),
      el('div', { class: 'pagehead__actions' },
        el('button', { class: 'btn btn--primary', id: 'saveBtn', onclick: save }, 'Save'))),

    el('div', { class: 'cols' },
      el('div', {},
        el('div', { class: 'card' },
          el('h2', {}, 'Details'),
          field('Name', nameIn),
          field('Summary', summaryIn, 'One line, shown under the product name and used as the search-engine description.'),
          field('Description', descIn, 'Full prose. Blank lines become paragraphs.'),
          el('div', { class: 'f2' },
            field('Brand', brandIn),
            field('Category', catIn)),
          field('Web address', slugIn, `Currently /product/${p.slug}/ — changing this redirects the old address automatically, but avoid it once the page is indexed.`),
        ),
        el('div', { class: 'card' },
          el('h2', {}, 'Photographs'),
          el('p', { class: 'muted' }, 'The first photo is the one shown in listings. Drag order with the arrows.'),
          imgBox),
        el('div', {},
          el('h2', {}, 'Specifications'),
          el('p', { class: 'muted' }, 'Leave this empty for products that only need a description. ' +
            'The same label may appear twice — "Power" in HP and in kW is normal.'),
          specBox)),

      el('div', {},
        el('div', { class: 'card' },
          el('h2', {}, 'Visibility'),
          field('Status', statusIn,
            'Draft is invisible on the live site. Archived keeps the record but removes the page.'),
          el('label', { class: 'f f--check' }, featuredIn, el('span', {}, 'Show on the home page as a best seller')),
          field('Sort order', el('input', {
            class: 'field', type: 'number', value: draft.sort,
            oninput: (e) => { draft.sort = e.target.value; },
          }), 'Lower numbers come first within a category.')))),
  );

  render(page);
}

// =====================================================================
// Shared upload
// =====================================================================
async function uploadOne(sku, file, position) {
  const { width, height, derivatives } = await derive(file);
  // One stable key per photo; the three derivatives hang off it.
  const key = `products/${slugify(sku)}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  for (const d of derivatives) {
    await api.uploadObject(`${key}-${d.size}.webp`, d.blob);
  }
  const product = state.products.find((x) => x.sku === sku);
  const [row] = await api.insert('product_images', [{
    product_id: product.id, storage_key: key, alt: '', width, height, position,
  }]);
  return row;
}

// =====================================================================
// Bulk photo upload
//
// The reason this screen exists: 250 products photographed in-house
// means several hundred files. Naming each one after the model number
// turns a day of clicking into one drag-and-drop.
// =====================================================================
function viewPhotos() {
  const skuIndex = new Map(state.products.map((p) => [p.sku.toLowerCase().replace(/[^a-z0-9]/g, ''), p.sku]));

  let queue = [];
  const listBox = el('div', { class: 'queue' });
  const summary = el('p', { class: 'muted' });
  const goBtn = el('button', { class: 'btn btn--primary', disabled: true, onclick: run }, 'Upload matched photos');

  const drop = el('label', { class: 'bigdrop' },
    el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => accept([...e.target.files]) }),
    el('strong', {}, 'Drop photographs here, or click to choose'),
    el('span', { class: 'muted' }, 'Name each file after its model number: HG-ID13.jpg, HG-ID13-2.jpg, HG-ID13-3.jpg'),
  );
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('is-over');
    accept([...e.dataTransfer.files].filter((f) => /^image\//.test(f.type)));
  });

  function accept(files) {
    for (const file of files) {
      const { sku, position, base } = parseFilename(file.name, skuIndex);
      queue.push({ file, sku, position, base, state: sku ? 'ready' : 'nomatch' });
    }
    // Group by product, then by the number in the filename, so photo 1
    // of each product really does become the main image.
    queue.sort((a, b) => (a.sku || 'zzz').localeCompare(b.sku || 'zzz') || a.position - b.position);
    paint();
  }

  function paint() {
    const matched = queue.filter((q) => q.sku);
    const unmatched = queue.filter((q) => !q.sku);
    summary.textContent = queue.length
      ? `${matched.length} matched to a product, ${unmatched.length} unmatched`
      : '';
    goBtn.disabled = !matched.length;
    goBtn.textContent = `Upload ${matched.length} photo${matched.length === 1 ? '' : 's'}`;

    listBox.replaceChildren(...queue.map((q, i) => el('div', { class: `qrow qrow--${q.state}` },
      el('span', { class: 'qrow__name' }, q.file.name),
      el('span', { class: 'qrow__arrow' }, '→'),
      q.sku
        ? el('span', { class: 'qrow__sku' }, q.sku, el('small', {}, q.position === 0 ? ' (main)' : ` (photo ${q.position + 1})`))
        : el('span', { class: 'qrow__none' },
            'no product matches "', q.base, '" — ',
            el('select', {
              class: 'field field--small',
              onchange: (e) => { q.sku = e.target.value || null; q.state = q.sku ? 'ready' : 'nomatch'; paint(); },
            },
              el('option', { value: '' }, 'choose…'),
              ...state.products.map((p) => el('option', { value: p.sku }, `${p.sku} — ${p.name}`)))),
      el('span', { class: 'qrow__status' }, q.message || ''),
      el('button', { class: 'ibtn ibtn--danger', title: 'Remove from the list', onclick: () => { queue.splice(i, 1); paint(); } }, '×'),
    )));
  }

  async function run() {
    goBtn.disabled = true;
    const work = queue.filter((q) => q.sku && q.state !== 'done');
    let ok = 0, bad = 0;

    for (const q of work) {
      q.state = 'working'; q.message = 'resizing…'; paint();
      try {
        // Append after whatever the product already has, so a second
        // batch does not fight the first for position 0.
        const product = state.products.find((x) => x.sku === q.sku);
        const existing = (state.imagesByProduct.get(product.id) || []).length;
        q.message = 'uploading…'; paint();
        const row = await uploadOne(q.sku, q.file, existing);
        const list = state.imagesByProduct.get(product.id) || [];
        list.push(row); state.imagesByProduct.set(product.id, list);
        q.state = 'done'; q.message = 'done'; ok++;
      } catch (e) {
        q.state = 'error'; q.message = e.message; bad++;
      }
      paint();
    }

    if (ok) { state.dirty = true; updatePublishBanner(); }
    toast(`${ok} uploaded${bad ? `, ${bad} failed` : ''}`, bad ? 'err' : 'ok');
    queue = queue.filter((q) => q.state !== 'done');
    paint();
  }

  const missing = state.products.filter((p) => !(state.imagesByProduct.get(p.id) || []).length);

  render(el('div', {},
    el('div', { class: 'pagehead' },
      el('div', {},
        el('a', { href: '#/products', class: 'back' }, '← All products'),
        el('h1', {}, 'Bulk photo upload')),
      el('div', { class: 'pagehead__actions' }, goBtn)),

    el('p', { class: 'note' },
      'Photos are resized to three sizes and converted to WebP ',
      el('strong', {}, 'in this browser'),
      ' before anything is uploaded — so a 12MB phone photo leaves here as about 200KB. ',
      'Large batches are fine; leave the tab open while it works.'),

    drop,
    summary,
    listBox,

    missing.length > 0 && el('details', { class: 'card' },
      el('summary', {}, `${missing.length} product${missing.length === 1 ? '' : 's'} still without a photograph`),
      el('div', { class: 'missinglist' },
        ...missing.map((p) => el('div', {}, el('code', {}, p.sku), ' ', p.name)))),
  ));
}

// =====================================================================
// Staff
// =====================================================================
function viewStaff() {
  const listBox = el('div', { class: 'card card--flush' });

  async function paint() {
    try {
      const admins = await api.selectAll('admins', { select: 'user_id,email,added_at', order: 'added_at.asc' });
      const me = api.currentUser();
      listBox.replaceChildren(el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Email'), el('th', {}, 'Added'), el('th', {}, ''))),
        el('tbody', {}, ...admins.map((a) => el('tr', {},
          el('td', {}, a.email || a.user_id, me && a.user_id === me.id && el('span', { class: 'flag' }, 'you')),
          el('td', { class: 'muted' }, new Date(a.added_at).toLocaleDateString()),
          el('td', {}, admins.length > 1 && el('button', {
            class: 'btn btn--small btn--danger',
            onclick: async () => {
              if (!confirmDanger(`Remove ${a.email} as an administrator?`)) return;
              try { await api.rpc('remove_admin', { p_user_id: a.user_id }); toast('Removed'); paint(); }
              catch (e) { fail(e); }
            },
          }, 'Remove'))))),
      ));
    } catch (e) { fail(e); }
  }
  paint();

  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.rpc('add_admin', { p_email: form.email.value.trim() });
        form.reset(); toast('Administrator added'); paint();
      } catch (err) { fail(err); }
    },
  },
    el('h2', {}, 'Add an administrator'),
    el('p', { class: 'muted' },
      'The person must sign in once first so an account exists — then add their email here.'),
    el('div', { class: 'f2' },
      el('input', { class: 'field', name: 'email', type: 'email', placeholder: 'name@example.com', required: true }),
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Add')),
  );

  render(el('div', {},
    el('div', { class: 'pagehead' }, el('h1', {}, 'Staff access')),
    el('p', { class: 'note' },
      'Everyone listed here can edit the whole catalogue. The last administrator cannot be removed — ' +
      'that would lock everyone out permanently.'),
    listBox, form));
}

// =====================================================================
// Shell
// =====================================================================
function updatePublishBanner() {
  const bar = $('#publishbar');
  if (!bar) return;
  bar.hidden = !state.dirty;
}

function chrome() {
  const user = api.currentUser();
  return el('header', { class: 'topbar' },
    el('a', { class: 'logo', href: '#/products' }, el('span', {}, 'BE'), 'STECH'),
    el('nav', { class: 'topnav' },
      el('a', { href: '#/products' }, 'Products'),
      el('a', { href: '#/photos' }, 'Photos'),
      el('a', { href: '#/staff' }, 'Staff')),
    el('div', { class: 'topbar__right' },
      user && el('span', { class: 'muted' }, user.email),
      el('button', { class: 'btn btn--small', onclick: () => { api.signOut(); viewLogin(); } }, 'Sign out')),
  );
}

function publishBar() {
  const status = el('span', { class: 'muted', id: 'publishstatus' });

  // Poll while something is in flight so the bar reflects reality
  // rather than what this tab happens to remember.
  let timer = null;
  async function refresh() {
    try {
      const s = await api.publishStatus();
      if (s.state === 'queued') status.textContent = 'Queued — the next build picks it up.';
      else if (s.state === 'building') status.textContent = 'Building…';
      else if (s.state === 'done' && s.ok === false) status.textContent = `Last publish failed: ${s.detail || 'see CI'}`;
      else status.textContent = '';

      const busy = s.state === 'queued' || s.state === 'building';
      if (busy && !timer) timer = setInterval(refresh, 15000);
      if (!busy && timer) { clearInterval(timer); timer = null; }
      if (!busy && s.state === 'done' && s.ok !== false) {
        state.dirty = false;
        updatePublishBanner();
      }
    } catch { /* a failed status poll must never break the page */ }
  }
  refresh();

  return el('div', { class: 'publishbar', id: 'publishbar', hidden: true },
    el('span', {}, 'You have changes that are not on the live site yet.'),
    el('button', {
      class: 'btn btn--primary btn--small',
      onclick: async (e) => {
        const b = e.target;
        b.disabled = true; b.textContent = 'Requesting…';
        try {
          await api.publish();
          toast('Publish requested. The live site rebuilds shortly.');
          refresh();
        } catch (err) { fail(err); }
        b.disabled = false; b.textContent = 'Publish now';
      },
    }, 'Publish now'),
    status,
  );
}

function render(node, withChrome = true) {
  const root = $('#app');
  root.replaceChildren(
    withChrome ? chrome() : '',
    withChrome ? publishBar() : '',
    el('main', { class: withChrome ? 'wrap' : 'wrap wrap--narrow' }, node),
  );
  if (withChrome) updatePublishBanner();
}

function route() {
  const hash = location.hash || '#/products';
  const [, section, arg] = hash.split('/');
  if (section === 'product' && arg) return viewProduct(arg);
  if (section === 'photos') return viewPhotos();
  if (section === 'staff') return viewStaff();
  return viewProducts();
}

async function boot() {
  if (!api.configured()) {
    render(el('div', { class: 'card' },
      el('h1', {}, 'Not configured'),
      el('p', {}, 'This admin was built without a database URL. Set SUPABASE_URL and ' +
        'SUPABASE_ANON_KEY and rebuild the site.')), false);
    return;
  }
  if (!api.currentUser()) return viewLogin();

  try {
    if (!(await api.isAdmin())) {
      api.signOut();
      return viewLogin('That account is not an administrator of this catalogue.');
    }
    await loadReference();
    await loadProducts();
    window.addEventListener('hashchange', route);
    route();
  } catch (e) {
    api.signOut();
    viewLogin(e.message);
  }
}

boot();

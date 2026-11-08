// =====================================================================
// Page templates.
//
// Plain template literals, no engine, no components library. This is the
// durability bet: in five years this file still runs on whatever Node
// exists, because it uses nothing but string concatenation.
//
// Layout and information architecture follow dewalt.com (narrow top-level
// nav over a deep catalogue, footer reproducing the whole tree so it is
// crawlable). The product page follows dbl.lk, but with real structured
// specs behind it rather than hand-pasted table HTML.
// =====================================================================

import { esc, escJson, join, slugify } from './html.mjs';
import { imageUrl, imageSrcset, SIZES_HINT } from './images.mjs';

export const SITE = {
  name: 'Bestech',
  legal: 'Bestech (Pvt) Ltd',
  tagline: 'Equipping Sri Lanka to build.',
  // Telephone only, deliberately: the company's email domain lapsed and
  // every published address bounces. Do not invent an email here.
  phones: [
    { label: 'Head office', value: '+94 112 437 392', addr: 'No. 550, Sri Sangaraja Mawatha, Colombo 10' },
    { label: 'Engineering', value: '+94 112 424 692', addr: "265 Layard's Broadway, Colombo 14" },
  ],
  hours: 'Monday to Saturday, 9:00am – 5:00pm',
};

// ---------------------------------------------------------------------
// URLs — one definition, used by the build, the sitemap and every link.
// ---------------------------------------------------------------------
// BASE_PATH exists because GitHub Pages serves a project site under a
// sub-path (/bestech-catalog/) while a real domain serves it at the
// root. Every link and every asset reference is built from it, so
// moving between the two is one environment variable rather than a
// find-and-replace that always misses three files.
export const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');

/**
 * Asset URLs, content-hashed by the build.
 *
 * Without this, a deploy that changes the stylesheet but keeps its
 * filename serves NEW html to a browser holding OLD css — and the page
 * arrives structurally broken, with no error anywhere. That happened
 * on the previous deploy: the header markup changed class names, the
 * cached stylesheet had no rule for them, and the whole header
 * collapsed into a stack.
 *
 * Hashing the filename makes that impossible: new content is a new
 * URL, so the two can never disagree, and the files can then be
 * cached forever instead of for ten minutes.
 */
/**
 * Site-wide values the build fills in once.
 *
 * The enquiry modal lives on EVERY page, because an enquiry button
 * can appear on any of them and a button that works on one page and
 * silently navigates away on another is worse than no button.
 * Auto-opening it on a timer stays home-only.
 */
export const site = { modalKey: '' };

export const assets = {
  css: '/assets/css/site.css',
  js: '/assets/js/site.js',
};

export const url = {
  home: () => `${BASE}/`,
  division: (d) => `${BASE}/d/${d.slug}/`,
  category: (c) => `${BASE}/c/${c.path}/`,
  brand: (b) => `${BASE}/brands/${b.slug}/`,
  // Flat, not nested under category: one canonical URL per product no
  // matter how many categories it sits in (the dewalt.com pattern).
  product: (p) => `${BASE}/product/${p.slug}/`,
  search: () => `${BASE}/search/`,
};

// ---------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------
function head({ title, description, canonical, image }) {
  const full = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
  return join([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(full)}</title>`,
    description && `<meta name="description" content="${esc(description)}">`,
    canonical && `<link rel="canonical" href="${esc(canonical)}">`,
    // Keep preview builds out of search results entirely.
    process.env.PREVIEW_BUILD === '1' && '<meta name="robots" content="noindex, nofollow">',
    `<meta property="og:title" content="${esc(full)}">`,
    description && `<meta property="og:description" content="${esc(description)}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:type" content="website">',
    `<link rel="stylesheet" href="${BASE}${assets.css}">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
      'family=Archivo:wdth,wght@125,900&family=Inter:wght@400;500;600;700;800&display=swap">',
    '</head>',
  ], '\n');
}

function header(nav) {
  const divisions = nav.divisions.map((d) => {
    const cats = nav.categoriesByDivision.get(d.id) || [];
    const tops = cats.filter((c) => !c.parent_id).slice(0, 12);
    return `
      <li class="nav__item">
        <a class="nav__link" href="${url.division(d)}">${esc(d.name)}</a>
        ${tops.length ? `<div class="mega">
          <div class="mega__inner">
            ${tops.map((t) => {
              const kids = cats.filter((c) => c.parent_id === t.id).slice(0, 8);
              return `<div class="mega__col">
                <a class="mega__head" href="${url.category(t)}">${esc(t.name)}</a>
                ${kids.map((k) => `<a class="mega__link" href="${url.category(k)}">${esc(k.name)}</a>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </li>`;
  }).join('');

  return `
<header class="site-header">
  <div class="topbar">
    <div class="wrap topbar__inner">
      <span>${esc(SITE.legal)} — authorised distributor</span>
      <span class="topbar__phone">Call ${esc(SITE.phones[0].value)}</span>
    </div>
  </div>
  <div class="wrap header__top">
    <a class="brand" href="${BASE}/" aria-label="Bestech — Machines &amp; Tools">
      <svg class="brand__mark" viewBox="0 0 78 86" aria-hidden="true" focusable="false">
        <path fill="#e01b22" d="M14 60 C14 34 34 14 60 14 C50 22 44 31 41 43 C38 55 36 63 26 70 C18 70 14 66 14 60 Z"/>
        <path fill="#e01b22" d="M30 72 C40 64 46 54 50 42 C54 30 60 22 70 16 C66 34 60 52 48 66 C42 72 36 74 30 72 Z"/>
        <path fill="#d8dadd" d="M58 10 C50 26 44 40 40 54 C37 64 33 70 27 74 C37 74 45 68 50 58 C56 44 60 26 64 10 Z"/>
      </svg>
      <span class="brand__text">
        <span class="brand__word"><span class="brand__be">BE</span><span class="brand__rest">STECH</span></span>
        <span class="brand__tag">Machines &amp; Tools</span>
      </span>
    </a>
    <form class="search" action="${url.search()}" method="get" role="search">
      <input type="search" name="q" placeholder="What are you looking for?" aria-label="Search the catalogue">
      <button type="submit" aria-label="Search">Search</button>
    </form>
    <a class="header__call" href="tel:${esc(SITE.phones[0].value.replace(/\s/g, ''))}">
      <strong>${esc(SITE.phones[0].value)}</strong><span>Call for pricing</span>
    </a>
  </div>
  <div class="header__navrow">
    <nav class="wrap nav" aria-label="Catalogue">
      <ul class="nav__list">
        ${divisions}
        <li class="nav__item"><a class="nav__link" href="${BASE}/brands/">Brands</a></li>
      </ul>
    </nav>
  </div>
</header>`;
}

function footer(nav) {
  // The footer reproduces the whole tree. This is how the taxonomy stays
  // crawlable without depending on a JavaScript mega-menu.
  const cols = nav.divisions.map((d) => {
    const cats = (nav.categoriesByDivision.get(d.id) || []).filter((c) => !c.parent_id);
    return `<div class="foot__col">
      <h3>${esc(d.name)}</h3>
      ${cats.map((c) => `<a href="${url.category(c)}">${esc(c.name)}</a>`).join('')}
    </div>`;
  }).join('');

  return `
<footer class="site-footer">
  <div class="wrap foot__grid">
    ${cols}
    <div class="foot__col">
      <h3>Brands</h3>
      ${nav.brands.slice(0, 10).map((b) => `<a href="${url.brand(b)}">${esc(b.name)}</a>`).join('')}
    </div>
    <div class="foot__col foot__contact">
      <h3>Contact</h3>
      ${SITE.phones.map((p) => `
        <p><strong>${esc(p.label)}</strong><br>
        <a href="tel:${esc(p.value.replace(/\s/g, ''))}">${esc(p.value)}</a><br>
        <span class="muted">${esc(p.addr)}</span></p>`).join('')}
      <p class="muted">${esc(SITE.hours)}</p>
    </div>
  </div>
  <div class="wrap foot__legal">
    <p>&copy; ${new Date().getFullYear()} ${esc(SITE.legal)}. Prices and availability on request — please telephone.</p>
  </div>
</footer>`;
}

// Preview builds run from fixture data, with no database behind them.
// They must be impossible to mistake for the real site: a banner on
// every page and noindex in the head, because a preview that gets
// indexed as the real Bestech catalogue is worse than no preview.
const PREVIEW = process.env.PREVIEW_BUILD === '1';

const PREVIEW_BANNER = `
<div style="background:#111;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,sans-serif;text-align:center">
  <strong style="color:#ff5a5f">PREVIEW</strong>
  &nbsp;Design and layout only. The six products below are invented test data, not the real catalogue.
</div>`;

/**
 * The interstitial.
 *
 * The reference pops a mailing-list sign-up. There is no mailing list
 * here, and no cart, so the equivalent is the thing a visitor actually
 * needs: the counter's number and what to have ready when they ring.
 *
 * Built on <dialog>, so the browser supplies the backdrop, Escape to
 * close, focus trapping and inertness behind it. Hand-rolling those on
 * a div is how modals end up trapping screen readers.
 *
 * It is opened once per visitor and remembered, after a delay, and
 * never on a first page view - see site.js. An overlay that greets
 * someone before they have seen anything is an advertisement, not an
 * offer of help.
 */
export const INTERESTS = [
  'Power tools & machinery',
  'Water pumps',
  'Spare parts',
  'Service or repair',
  'Dealership / trade account',
  'Something else',
];

/**
 * The enquiry form.
 *
 * Posts straight to the database. One form definition, used by both
 * the contact band and the modal, so the two can never drift apart.
 *
 * A real <form> with real inputs, real labels and real `required`
 * attributes: it validates and submits without JavaScript having to
 * reimplement any of that, and the script only intercepts submission
 * to send it as JSON instead of navigating away.
 */
export function enquiryButton({ label = 'Make an enquiry', cls = 'btn btn--primary', source = '' } = {}) {
  // An anchor, not a button: with no JavaScript it is a link to the
  // contact form, which is a working route to the same outcome. The
  // script upgrades it to open the modal in place.
  return `<a class="${esc(cls)}" href="${BASE}/#contact" data-enquire
     ${source ? `data-enquiry-source="${esc(source)}"` : ''}>${esc(label)}</a>`;
}

export function enquiryForm({ id, compact = false, source = '' } = {}) {
  const f = (name) => `${id}-${name}`;
  return `
<form class="eform${compact ? ' eform--compact' : ''}" data-enquiry novalidate
      data-source="${esc(source)}">
  <div class="eform__row">
    <label class="eform__field">
      <span class="eform__label">Name <i aria-hidden="true">*</i></span>
      <input id="${esc(f('name'))}" name="name" type="text" required maxlength="120"
             autocomplete="name" placeholder="Your full name">
    </label>
    <label class="eform__field">
      <span class="eform__label">Company</span>
      <input id="${esc(f('company'))}" name="company" type="text" maxlength="160"
             autocomplete="organization" placeholder="Business or trading name">
    </label>
  </div>

  <div class="eform__row">
    <label class="eform__field">
      <span class="eform__label">Email or telephone <i aria-hidden="true">*</i></span>
      <input id="${esc(f('contact'))}" name="contact" type="text" required maxlength="160"
             autocomplete="tel" placeholder="07X XXX XXXX or you@example.com">
      <span class="eform__hint">However you prefer to be reached.</span>
    </label>
    <label class="eform__field">
      <span class="eform__label">Area of interest <i aria-hidden="true">*</i></span>
      <select id="${esc(f('interest'))}" name="interest" required>
        <option value="">Choose one&hellip;</option>
        ${INTERESTS.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}
      </select>
    </label>
  </div>

  <label class="eform__field">
    <span class="eform__label">Message <i aria-hidden="true">*</i></span>
    <textarea id="${esc(f('message'))}" name="message" required maxlength="4000"
              rows="${compact ? 3 : 5}"
              placeholder="What are you looking for? Model numbers, quantities and your location all help."></textarea>
  </label>

  <!-- Honeypot. A person never sees this and never fills it in; the
       simpler sort of bot fills in everything it finds. Hidden from
       assistive technology and skipped by the tab order, so it costs
       nobody anything. -->
  <div class="eform__trap" aria-hidden="true">
    <label>Do not fill this in <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
  </div>

  <div class="eform__foot">
    <button class="btn btn--primary" type="submit" data-enquiry-submit>
      Send enquiry <span aria-hidden="true">&rarr;</span>
    </button>
    <p class="eform__required">Required fields are marked <i>*</i>.</p>
  </div>

  <p class="eform__status" data-enquiry-status role="status" aria-live="polite"></p>
</form>`;
}

function interstitial(ctx) {
  const img = ctx.modalKey
    ? `<img src="${esc(imageUrl(ctx.modalKey, 800))}" srcset="${esc(imageSrcset(ctx.modalKey))}"
           sizes="340px" alt="" loading="lazy" decoding="async">`
    : '';
  return `
<dialog class="modal" id="counterModal" data-modal${ctx.auto ? ' data-modal-auto' : ''} aria-labelledby="counterModalTitle">
  <div class="modal__grid">
    <div class="modal__media">${img}</div>
    <div class="modal__body">
      <button class="modal__close" type="button" data-modal-close aria-label="Close">&times;</button>
      <p class="modal__eyebrow">Trade enquiries</p>
      <h2 class="modal__title" id="counterModalTitle">Tell us what<br>the job needs</h2>
      <p>Send the details and our counter comes back to you with stock and a price.
         Model numbers help; a description of the work is plenty.</p>
      ${enquiryForm({ id: 'modal', compact: true, source: 'home modal' })}
      <button class="modal__dismiss" type="button" data-modal-close>Keep browsing</button>
    </div>
  </div>
</dialog>`;
}

export function layout({ title, description, canonical, image, body, nav, jsonLd, autoModal }) {
  return join([
    head({ title, description, canonical, image }),
    '<body>',
    PREVIEW && PREVIEW_BANNER,
    header(nav),
    `<main id="main">${body}</main>`,
    footer(nav),
    interstitial({ modalKey: site.modalKey, auto: Boolean(autoModal) }),
    jsonLd && `<script type="application/ld+json">${escJson(jsonLd)}</script>`,
    `<script src="${BASE}${assets.js}" defer></script>`,
    '</body>',
    '</html>',
  ], '\n');
}

// ---------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------
/**
 * A horizontally scrolling rail of cards, with arrow controls.
 *
 * The rail is a plain overflow-x container with scroll-snap, so it is
 * fully usable by touch and by keyboard before a line of JavaScript
 * runs. site.js only adds the arrow behaviour and hides the arrows
 * when everything already fits.
 */
/**
 * A tall card that is a photograph with its title set over the bottom
 * of it. The reference uses these for trades; here they lead into the
 * biggest categories, which is the same job: get a buyer who knows
 * what they came for into the right aisle in one click.
 */

// Inline so they cost no request, inherit currentColor, and cannot
// 404. Stroke-based, so they stay crisp at any size.
const ICONS = {
  phone: '<path d="M6 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  spanner: '<path d="M15 3a6 6 0 0 0-5.3 8.8L3 18.5 5.5 21l6.7-6.7A6 6 0 1 0 15 3Z"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17.5" cy="18.5" r="1.8"/>',
};

/** An outlined icon from the set above. */
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function solutionCard(item) {
  return `
<a class="solution" href="${esc(item.href)}">
  <span class="solution__media">${item.key
    ? `<img src="${esc(imageUrl(item.key, 800))}" srcset="${esc(imageSrcset(item.key))}"
           sizes="(max-width: 700px) 80vw, 380px" alt="" loading="lazy" decoding="async">`
    : ''}</span>
  <span class="solution__body">
    <span class="solution__title">${esc(item.name)}</span>
    <span class="solution__cta">Explore ${esc(item.verb || 'the range')} &rsaquo;</span>
  </span>
</a>`;
}

export function rail(id, cards) {
  return `
<div class="rail" data-rail>
  <button class="rail__arrow rail__arrow--prev" type="button" data-rail-prev aria-label="Scroll left" hidden>&#8249;</button>
  <div class="rail__track" id="${esc(id)}" data-rail-track>${cards.join('')}</div>
  <button class="rail__arrow rail__arrow--next" type="button" data-rail-next aria-label="Scroll right" hidden>&#8250;</button>
</div>`;
}

export function productCard(p) {
  const img = p.image;
  // data-division lets the filter tabs hide and show cards that are
  // all already in the markup - so a visitor without JavaScript sees
  // every product rather than none.
  return `
<a class="card" href="${url.product(p)}"${p.division_slug ? ` data-division="${esc(p.division_slug)}"` : ''}>
  <div class="card__media">
    ${img
      ? `<img src="${esc(imageUrl(img.storage_key, 400))}" srcset="${esc(imageSrcset(img.storage_key))}"
             sizes="${esc(SIZES_HINT.grid)}" alt="${esc(img.alt || p.name)}" loading="lazy" decoding="async">`
      : `<span class="card__noimg" aria-hidden="true"></span>`}
  </div>
  <div class="card__body">
    <span class="card__sku">${esc(p.sku)}</span>
    <h3 class="card__name">${esc(p.name)}</h3>
    ${p.brand_name ? `<span class="card__brand">${esc(p.brand_name)}</span>` : ''}
  </div>
</a>`;
}

function breadcrumb(trail) {
  if (!trail.length) return '';
  return `<nav class="crumb" aria-label="Breadcrumb"><ol class="wrap">
    <li><a href="${BASE}/">Home</a></li>
    ${trail.map((t, i) => `<li>${i === trail.length - 1
      ? `<span aria-current="page">${esc(t.name)}</span>`
      : `<a href="${esc(t.href)}">${esc(t.name)}</a>`}</li>`).join('')}
  </ol></nav>`;
}

/**
 * The specification table.
 *
 * Renders the ordered sections stored in products.specs. A product with
 * none simply gets no table — prose only, which is a first-class case
 * (dbl.lk's lawn mower works exactly this way), not an empty shell.
 */
function specTable(specs) {
  if (!Array.isArray(specs) || !specs.length) return '';
  return specs.map((section) => {
    const rows = (section.rows || []).filter((r) => r && r.label);
    if (!rows.length) return '';
    return `
      ${section.title ? `<h3 class="spec__title">${esc(section.title)}</h3>` : ''}
      <table class="spec">
        <tbody>
          ${rows.map((r) => `<tr>
            <th scope="row">${esc(r.label)}</th>
            <td class="spec__unit">${esc(r.unit || '')}</td>
            <td class="spec__value">${esc(r.value || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${section.caption ? `<p class="spec__caption">${esc(section.caption)}</p>` : ''}`;
  }).join('');
}

// ---------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------
export function productPage(p, ctx) {
  const imgs = p.images || [];
  const main = imgs[0];
  const trail = [...(p.trail || []), { name: p.name, href: url.product(p) }];

  const body = `
${breadcrumb(trail)}
<div class="wrap pdp">
  <div class="pdp__grid">
    <div class="pdp__media">
      <div class="pdp__main" id="pdpMain">
        ${main
          ? `<img src="${esc(imageUrl(main.storage_key, 800))}" srcset="${esc(imageSrcset(main.storage_key))}"
                 sizes="${esc(SIZES_HINT.productMain)}" alt="${esc(main.alt || p.name)}" fetchpriority="high" decoding="async">`
          : `<span class="pdp__noimg" aria-hidden="true"></span>`}
      </div>
      ${imgs.length > 1 ? `<div class="pdp__thumbs">
        ${imgs.map((im, i) => `<button class="pdp__thumb${i === 0 ? ' is-active' : ''}" type="button"
            data-full="${esc(imageUrl(im.storage_key, 800))}" data-srcset="${esc(imageSrcset(im.storage_key))}"
            aria-label="View image ${i + 1}">
            <img src="${esc(imageUrl(im.storage_key, 400))}" alt="" loading="lazy" decoding="async">
          </button>`).join('')}
      </div>` : ''}
    </div>

    <div class="pdp__info">
      ${p.brand_name ? `<a class="pdp__brand" href="${esc(p.brand_href)}">${esc(p.brand_name)}</a>` : ''}
      <h1 class="pdp__name">${esc(p.name)}</h1>
      <p class="pdp__sku">Model <strong>${esc(p.sku)}</strong></p>
      ${p.summary ? `<p class="pdp__summary">${esc(p.summary)}</p>` : ''}

      <!-- No price and no cart, by instruction: this catalogue informs
           and the buyer gets in touch. The enquiry carries the model
           number automatically, so nobody has to read it back over a
           bad line. -->
      <div class="pdp__contact">
        <p class="pdp__contact-lead">For pricing and availability:</p>
        ${enquiryButton({ cls: 'btn btn--primary btn--block', source: `product ${p.sku}` })}
        <p class="pdp__or">or call
          ${SITE.phones.map((ph) => `<a href="tel:${esc(ph.value.replace(/\s/g, ''))}">${esc(ph.value)}</a>`).join(' / ')}
        </p>
        <p class="muted">${esc(SITE.hours)}</p>
      </div>

      ${p.description ? `<div class="pdp__desc"><h2>Description</h2><p>${esc(p.description)}</p></div>` : ''}
      ${p.specs && p.specs.length ? `<div class="pdp__specs"><h2>Specifications</h2>${specTable(p.specs)}</div>` : ''}
    </div>
  </div>

  ${ctx.related && ctx.related.length ? `<section class="related">
    <h2>Related products</h2>
    <div class="grid">${ctx.related.map(productCard).join('')}</div>
  </section>` : ''}
</div>`;

  return layout({
    title: `${p.name} (${p.sku})`,
    description: p.summary || `${p.name}. ${p.brand_name || ''} ${p.sku}. Specifications and details from ${SITE.legal}.`.trim(),
    canonical: ctx.origin + url.product(p),
    image: main ? imageUrl(main.storage_key, 1600) : undefined,
    nav: ctx.nav,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      sku: p.sku,
      ...(p.brand_name ? { brand: { '@type': 'Brand', name: p.brand_name } } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(main ? { image: ctx.origin + imageUrl(main.storage_key, 1600) } : {}),
    },
  });
}

export function listingPage({ heading, intro, products, trail, canonical, facets }, ctx) {
  const body = `
${breadcrumb(trail || [])}
<div class="wrap listing">
  <header class="listing__head">
    <h1>${esc(heading)}</h1>
    ${intro ? `<p class="listing__intro">${esc(intro)}</p>` : ''}
    <p class="listing__count">${products.length} product${products.length === 1 ? '' : 's'}</p>
  </header>
  ${facets && facets.length ? `<nav class="facets" aria-label="Refine">
    ${facets.map((f) => `<a class="facet" href="${esc(f.href)}">${esc(f.name)} <span>${f.count}</span></a>`).join('')}
  </nav>` : ''}
  ${products.length
    ? `<div class="grid">${products.map(productCard).join('')}</div>`
    : `<p class="empty">Nothing listed here yet &mdash; we carry more than is shown online.
         ${enquiryButton({ label: 'Ask us what we stock', source: `empty ${heading}` })}</p>`}
</div>`;

  return layout({
    title: heading,
    description: intro || `${heading} from ${SITE.legal}.`,
    canonical,
    nav: ctx.nav,
    body,
  });
}

/** Stub left at a retired URL so old links and search results still land. */
export function redirectStub(from, to, origin) {
  return join([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<link rel="canonical" href="${esc(origin + to)}">`,
    `<meta http-equiv="refresh" content="0; url=${esc(to)}">`,
    '<meta name="robots" content="noindex, follow">',
    '<title>Moved</title>',
    '</head>',
    `<body><p>This page has moved to <a href="${esc(to)}">${esc(to)}</a>.</p></body>`,
    '</html>',
  ], '\n');
}

// ---------------------------------------------------------------------
// Home
//
// Division-led, like dewalt.com: two confident entry points rather than
// a wall of 250 products. A B2B buyer arrives knowing whether they want
// a drill or a pump, and the fastest useful page is the one that asks
// that single question and then gets out of the way.
// ---------------------------------------------------------------------
export function homePage({ divisions, brands, featured, total, heroKey, editorial, slides: given, solutions = [] }, ctx) {
  const ed = editorial || {};
  // One slide per thing worth leading with. Falls back to a single
  // slide when there is only one photograph, and the carousel controls
  // hide themselves in that case.
  const slides = (given && given.length) ? given : [{
    key: heroKey, eyebrow: SITE.legal, title: SITE.tagline,
    sub: `Power tools, machinery and water pumps from ${brands.length} brands, stocked and supported in Colombo since 1988.`,
    cta: 'Browse the catalogue', href: divisions[0] ? url.division(divisions[0]) : '/',
  }];
  const body = `
<section class="hero" data-hero aria-roledescription="carousel" aria-label="Featured">
  ${slides.map((sl, i) => `
  <article class="heroslide${i === 0 ? ' is-active' : ''}"
           ${sl.key ? `style="--hero-image:url('${esc(imageUrl(sl.key, 1600))}')"` : ''}
           data-slide aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}"${i ? ' aria-hidden="true"' : ''}>
    <div class="wrap heroslide__inner">
      <span class="rule rule--top" aria-hidden="true"></span>
      <div class="heroslide__copy">
        <p class="hero__eyebrow">${esc(sl.eyebrow)}</p>
        ${i === 0 ? `<h1 class="hero__title">${esc(sl.title)}</h1>`
                  : `<p class="hero__title">${esc(sl.title)}</p>`}
        <p class="hero__sub">${esc(sl.sub)}</p>
        <a class="btn btn--hero" href="${esc(sl.href)}">${esc(sl.cta)}</a>
      </div>
      <span class="rule rule--bottom" aria-hidden="true"></span>
    </div>
  </article>`).join('')}

  <!-- Numbered pagination with a progress bar on the active slide,
       plus a pause control. Autoplay without a visible way to stop it
       is hostile, and fails WCAG 2.2.2 outright. -->
  <div class="heronav wrap" data-hero-nav hidden>
    <button class="heronav__arrow" type="button" data-hero-prev aria-label="Previous slide">&#8249;</button>
    <ol class="heronav__dots">
      ${slides.map((sl, i) => `
        <li><button class="heronav__dot${i === 0 ? ' is-active' : ''}" type="button"
            data-hero-go="${i}" aria-label="Slide ${i + 1}: ${esc(sl.title)}">
          <span>${i + 1}</span><i class="heronav__bar" aria-hidden="true"></i>
        </button></li>`).join('')}
    </ol>
    <button class="heronav__arrow" type="button" data-hero-next aria-label="Next slide">&#8250;</button>
    <button class="heronav__pause" type="button" data-hero-pause aria-label="Pause slideshow">
      <span data-hero-pause-icon>&#10073;&#10073;</span>
    </button>
  </div>
</section>

<!-- Section jump bar, pinned under the header. -->
<nav class="subnav" aria-label="Sections">
  <div class="wrap subnav__inner">
    ${divisions.map((d) => `<a class="subnav__link" href="#${esc(d.slug)}">${esc(d.name)}</a>`).join('')}
    <a class="subnav__link" href="#bestsellers">Best Sellers</a>
    <a class="subnav__link" href="#solutions">Categories</a>
    <a class="subnav__link" href="#about">Why Bestech</a>
    <a class="subnav__link" href="#brands">Brands</a>
    <a class="subnav__link" href="#support">Support</a>
    <a class="subnav__link" href="#contact">Contact</a>
  </div>
</nav>

${divisions.map((d, i) => `
<section class="band${i % 2 ? ' band--wash' : ''}" id="${esc(d.slug)}">
  <div class="wrap">
    <header class="band__head">
      <h2>${esc(d.name)}</h2>
      ${d.tagline ? `<p class="band__lede">${esc(d.tagline)}</p>` : ''}
    </header>
    <div class="division__tiles">
      ${d.tiles.map((t) => `<a class="tile" href="${url.category(t)}">
        <span class="tile__media">${t.image_key
          ? `<img src="${esc(imageUrl(t.image_key, 400))}" srcset="${esc(imageSrcset(t.image_key))}"
                 sizes="${esc(SIZES_HINT.categoryTile)}" alt="" loading="lazy" decoding="async">`
          : ''}</span>
        <span class="tile__name">${esc(t.name)}</span>
      </a>`).join('')}
    </div>
    <a class="btn btn--ghost" href="${url.division(d)}">See all ${esc(d.name)}</a>
  </div>
</section>`).join('')}

${featured.length ? `<section class="band" id="bestsellers">
  <div class="wrap">
    <header class="band__head">
      <h2>Best Sellers</h2>
      <p class="band__lede">What the trade buys most, across both divisions.</p>
    </header>
    <div class="tabs" data-tabs>
      <button class="tab is-active" type="button" data-tab-all>All</button>
      ${divisions.map((d) => `<button class="tab" type="button" data-tab="${esc(d.slug)}">${esc(d.name)}</button>`).join('')}
    </div>
    ${rail('bestsellers-rail', featured.map((p) => productCard(p)))}
  </div>
</section>` : ''}

<!-- Lead-ins to the biggest parts of the catalogue: a photograph with
     the name over it, in a rail so a long list does not become a wall. -->
${solutions.length ? `<section class="band" id="solutions">
  <div class="wrap">
    <header class="band__head band__head--row">
      <h2>Shop by category</h2>
      <p class="band__lede">The ranges the trade asks for most.</p>
    </header>
    ${rail('solutions-rail', solutions.map(solutionCard))}
  </div>
</section>` : ''}

<!-- Editorial band: a full-bleed photograph with the copy sitting in
     a panel that overlaps it, as the reference does. -->
${ed.counterKey ? `<section class="showcase" style="--showcase-image:url('${esc(imageUrl(ed.counterKey, 1600))}')">
  <div class="wrap showcase__inner">
    <div class="showcase__panel">
      <p class="showcase__eyebrow">Over the counter since 1988</p>
      <h2>Stocked in Colombo,<br>not on back order</h2>
      <p>Thirty-seven years supplying contractors, fabricators and farms across the
         island. If it is in this catalogue, it is on a shelf at Sri Sangaraja Mawatha
         &mdash; and if it is not, we will tell you honestly when it lands.</p>
      ${enquiryButton({ label: 'Make an enquiry', source: 'home showcase' })}
    </div>
  </div>
</section>` : ''}

<section class="band band--wash" id="about">
  <div class="wrap">
    <header class="band__head band__head--center">
      <h2>Why the trade buys here</h2>
    </header>
    <div class="pillars">
      <article class="pillar">
        <h3>Authorised distribution</h3>
        <p>We are the appointed Sri Lankan distributor for every brand listed here.
           Genuine stock, manufacturer warranty, and parts that actually exist.</p>
      </article>
      <article class="pillar">
        <h3>Specifications you can trust</h3>
        <p>Every figure on this site comes from the manufacturer&rsquo;s own data,
           entered once and shown in full &mdash; power, capacity, duty cycle, weight.
           No guessing from a photograph.</p>
      </article>
      <article class="pillar">
        <h3>Service and spares</h3>
        <p>Our engineering division commissions, services and repairs what we sell,
           from a single pump to a workshop fit-out.</p>
      </article>
    </div>
  </div>
</section>

<section class="band" id="brands">
  <div class="wrap">
    <header class="band__head">
      <h2>Brands we distribute</h2>
      <p class="band__lede">${brands.length} manufacturers, all under authorised distribution.</p>
    </header>
    ${rail('brands-rail', brands.map((b) => `
      <a class="brandcard brandcard--rail${b.is_flagship ? ' is-flagship' : ''}" href="${url.brand(b)}">
        ${b.logo_key
          ? `<span class="brandcard__logo"><img src="${esc(imageUrl(b.logo_key, 400))}" alt="${esc(b.name)}" loading="lazy" decoding="async"></span>`
          : ''}
        <span class="brandcard__name${b.logo_key ? ' sr-only' : ''}">${esc(b.name)}</span>
      </a>`))}
  </div>
</section>

<!-- Solid-colour band. The reference puts a newsletter here; this
     catalogue has no mailing list and no cart, so the equivalent
     action is asking for a quotation. -->
<section class="enquiry">
  <div class="wrap enquiry__grid">
    <div class="enquiry__lead">
      <span class="enquiry__bar" aria-hidden="true"></span>
      <p class="enquiry__eyebrow">Trade and project enquiries</p>
      <h2>Need a quotation,<br>or help specifying?</h2>
      <span class="enquiry__bar" aria-hidden="true"></span>
    </div>
    <div class="enquiry__card">
      <h3>Tell us what the job needs</h3>
      <p>Give our counter the model number, or just describe the work. We will
         confirm stock, price it, and tell you honestly if something else suits
         the job better.</p>
      <div class="enquiry__actions">
        ${enquiryButton({ label: 'Make an enquiry', source: 'home enquiry band' })}
        <a class="btn btn--ghost" href="tel:${esc(SITE.phones[0].value.replace(/\s/g, ''))}">${esc(SITE.phones[0].value)}</a>
      </div>
      <p class="muted">${esc(SITE.hours)}</p>
    </div>
  </div>
</section>

<section class="band band--wash" id="support">
  <div class="wrap">
    <header class="band__head"><h2>Support</h2></header>
    <div class="support">
      <article class="supportcard">
        ${icon('phone')}
        <h3>Talk to the counter</h3>
        <p>Send the details and someone who has actually sold the thing comes back
           to you with stock and a price &mdash; usually the same day.</p>
        ${enquiryButton({ cls: 'btn btn--primary btn--block', label: 'Make an enquiry', source: 'support counter' })}
      </article>
      <article class="supportcard">
        ${icon('shield')}
        <h3>Warranty</h3>
        <p>Every brand here is under authorised distribution, so manufacturer
           warranty is honoured locally rather than argued about.</p>
        ${enquiryButton({ cls: 'btn btn--block', label: 'Warranty help', source: 'support warranty' })}
      </article>
      <article class="supportcard">
        ${icon('spanner')}
        <h3>Service &amp; repair</h3>
        <p>Our engineering division services and repairs what we sell, from a
           single pump to a full workshop.</p>
        ${enquiryButton({ cls: 'btn btn--block', label: 'Book a service', source: 'support service' })}
      </article>
      <article class="supportcard">
        ${icon('truck')}
        <h3>Island-wide supply</h3>
        <p>Two Colombo premises and delivery across Sri Lanka for contractors,
           fabricators and farms.</p>
        <a class="btn btn--block" href="${BASE}/brands/">See our brands</a>
      </article>
    </div>
  </div>
</section>

<section class="contact" id="contact">
  <div class="wrap contact__grid">
    <div class="contact__lead">
      <p class="contact__eyebrow"><span class="contact__tick" aria-hidden="true"></span> Contact &amp; enquiries</p>
      <h2>Tell us what you need.</h2>
      <p class="contact__blurb">Whether you are a contractor sourcing equipment, a dealer looking
         to carry our brands, or a supplier with a proposal &mdash; send the details and our team
         will come back to you.</p>

      <div class="contact__places">
        ${SITE.phones.map((ph) => `
          <div class="contact__place">
            <h3>${esc(ph.label)}</h3>
            <p>${esc(ph.addr)}</p>
            <a class="contact__tel" href="tel:${esc(ph.value.replace(/\s/g, ''))}">
              ${icon('phone')} ${esc(ph.value)}</a>
          </div>`).join('')}
      </div>

      <p class="contact__hours">${esc(SITE.hours)}</p>
    </div>

    <div class="contact__card">
      <h3>Send an enquiry</h3>
      ${enquiryForm({ id: 'contact', source: 'home contact' })}
    </div>
  </div>
</section>`;

  return layout({
    title: '',
    description: `${SITE.legal} — power tool, machinery and water pump distributor in Colombo. ${total} products with full specifications.`,
    canonical: ctx.origin + '/',
    nav: ctx.nav,
    body,
    autoModal: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE.legal,
      url: ctx.origin,
      telephone: SITE.phones.map((p) => p.value),
      address: SITE.phones.map((p) => ({
        '@type': 'PostalAddress', streetAddress: p.addr, addressCountry: 'LK',
      })),
    },
  });
}

export function brandsIndexPage(brands, ctx) {
  const body = `
${breadcrumb([{ name: 'Brands', href: `${BASE}/brands/` }])}
<div class="wrap listing">
  <header class="listing__head">
    <h1>Brands</h1>
    <p class="listing__intro">${esc(SITE.legal)} is the authorised distributor for the following
      manufacturers in Sri Lanka.</p>
  </header>
  <div class="brandgrid">
    ${brands.map((b) => `<a class="brandcard${b.is_flagship ? ' is-flagship' : ''}" href="${url.brand(b)}">
      ${b.logo_key
        ? `<span class="brandcard__logo"><img src="${esc(imageUrl(b.logo_key, 400))}" alt="${esc(b.name)}" loading="lazy" decoding="async"></span>`
        : ''}
      <span class="brandcard__name${b.logo_key ? ' sr-only' : ''}">${esc(b.name)}</span>
      <span class="brandcard__count">${b.count} product${b.count === 1 ? '' : 's'}</span>
    </a>`).join('')}
  </div>
</div>`;

  return layout({
    title: 'Brands',
    description: `Brands distributed by ${SITE.legal} in Sri Lanka.`,
    canonical: ctx.origin + '/brands/',
    nav: ctx.nav,
    body,
  });
}

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
    `<link rel="stylesheet" href="${BASE}/assets/css/site.css">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
      'family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap">',
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
  <div class="wrap header__inner">
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
    <nav class="nav" aria-label="Catalogue">
      <ul class="nav__list">
        ${divisions}
        <li class="nav__item"><a class="nav__link" href="${BASE}/brands/">Brands</a></li>
      </ul>
    </nav>
    <form class="search" action="${url.search()}" method="get" role="search">
      <input type="search" name="q" placeholder="Search model or product" aria-label="Search the catalogue">
      <button type="submit" aria-label="Search">Search</button>
    </form>
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

export function layout({ title, description, canonical, image, body, nav, jsonLd }) {
  return join([
    head({ title, description, canonical, image }),
    '<body>',
    PREVIEW && PREVIEW_BANNER,
    header(nav),
    `<main id="main">${body}</main>`,
    footer(nav),
    jsonLd && `<script type="application/ld+json">${escJson(jsonLd)}</script>`,
    `<script src="${BASE}/assets/js/site.js" defer></script>`,
    '</body>',
    '</html>',
  ], '\n');
}

// ---------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------
export function productCard(p) {
  const img = p.image;
  return `
<a class="card" href="${url.product(p)}">
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
  return `<nav class="crumb" aria-label="Breadcrumb"><ol>
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
<div class="wrap pdp">
  ${breadcrumb(trail)}
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

      <!-- No price and no cart, by instruction: this catalogue informs,
           and buyers telephone. The call to action is the phone number. -->
      <div class="pdp__contact">
        <p class="pdp__contact-lead">For pricing and availability, please call:</p>
        ${SITE.phones.map((ph) => `<a class="btn btn--call" href="tel:${esc(ph.value.replace(/\s/g, ''))}">
            ${esc(ph.value)} <span>${esc(ph.label)}</span></a>`).join('')}
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
<div class="wrap listing">
  ${breadcrumb(trail || [])}
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
    : `<p class="empty">Nothing listed here yet. Please call ${esc(SITE.phones[0].value)} — we carry more than is shown online.</p>`}
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
export function homePage({ divisions, brands, featured, total, heroKey }, ctx) {
  const body = `
<section class="hero${heroKey ? ' hero--photo' : ''}"${heroKey ? ` style="--hero-image:url('${esc(imageUrl(heroKey, 1600))}')"` : ''}>
  <div class="wrap hero__inner">
    <p class="hero__eyebrow">${esc(SITE.legal)}</p>
    <h1 class="hero__title">${esc(SITE.tagline)}</h1>
    <p class="hero__sub">Power tools, machinery and water pumps from ${brands.length} brands,
      stocked and supported in Colombo since 1988.</p>
    <div class="hero__actions">
      ${divisions.map((d) => `<a class="btn btn--hero" href="${url.division(d)}">${esc(d.name)}</a>`).join('')}
    </div>
  </div>
</section>

<section class="wrap divisions">
  ${divisions.map((d) => `
    <article class="division">
      <header class="division__head">
        <h2><a href="${url.division(d)}">${esc(d.name)}</a></h2>
        ${d.tagline ? `<p>${esc(d.tagline)}</p>` : ''}
        <span class="division__count">${d.count} product${d.count === 1 ? '' : 's'}</span>
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
      <a class="division__all" href="${url.division(d)}">See all ${esc(d.name)}</a>
    </article>`).join('')}
</section>

${featured.length ? `<section class="wrap feature">
  <h2>Best sellers</h2>
  <div class="grid">${featured.map(productCard).join('')}</div>
</section>` : ''}

<section class="wrap brandstrip">
  <h2>Brands we distribute</h2>
  <div class="brandstrip__row">
    ${brands.map((b) => `<a class="brandchip" href="${url.brand(b)}">${esc(b.name)}</a>`).join('')}
  </div>
</section>

<section class="callout">
  <div class="wrap callout__inner">
    <h2>Prices and availability by telephone</h2>
    <p>This catalogue is for reference. For a quotation, stock check or technical advice,
       speak to our counter directly.</p>
    <div class="callout__phones">
      ${SITE.phones.map((p) => `<a class="btn btn--call" href="tel:${esc(p.value.replace(/\s/g, ''))}">
        ${esc(p.value)} <span>${esc(p.label)}</span></a>`).join('')}
    </div>
  </div>
</section>`;

  return layout({
    title: '',
    description: `${SITE.legal} — power tool, machinery and water pump distributor in Colombo. ${total} products with full specifications.`,
    canonical: ctx.origin + '/',
    nav: ctx.nav,
    body,
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
<div class="wrap listing">
  ${breadcrumb([{ name: 'Brands', href: `${BASE}/brands/` }])}
  <header class="listing__head">
    <h1>Brands</h1>
    <p class="listing__intro">${esc(SITE.legal)} is the authorised distributor for the following
      manufacturers in Sri Lanka.</p>
  </header>
  <div class="brandgrid">
    ${brands.map((b) => `<a class="brandcard${b.is_flagship ? ' is-flagship' : ''}" href="${url.brand(b)}">
      <span class="brandcard__logo">${b.logo_key
        ? `<img src="${esc(imageUrl(b.logo_key, 400))}" alt="${esc(b.name)}" loading="lazy" decoding="async">`
        : esc(b.name)}</span>
      <span class="brandcard__name">${esc(b.name)}</span>
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

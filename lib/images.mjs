// =====================================================================
// Image URL composition.
//
// The database stores a storage KEY ("products/db-100l/1"), never a URL.
// Everything about *where* images live is confined to this file, so
// moving between Cloudflare R2, Vercel Blob or anything else is a config
// change rather than a migration over every row.
//
// Three derivatives are generated at upload time and served as WebP:
//   400  grid thumbnails   (~25KB)
//   800  product page      (~70KB)
//   1600 zoom / retina     (~200KB)
//
// Why it matters: shipping one big original everywhere is what put the
// previous project through its hosting bandwidth ceiling. A 24-product
// grid built from 400px thumbs is ~800KB; built from 1800px originals it
// is ~12MB. Same page, fifteen times the bill.
// =====================================================================

export const SIZES = [400, 800, 1600];

// Set IMAGE_BASE_URL to whichever CDN ends up in front of the bucket,
// e.g. https://images.bestech.lk  (R2 + Cloudflare, or Vercel Blob).
const BASE = (process.env.IMAGE_BASE_URL || '').replace(/\/+$/, '');

/** URL for one derivative of a stored image. */
export function imageUrl(storageKey, size = 800) {
  if (!storageKey) return '';
  if (!SIZES.includes(size)) {
    throw new Error(`size ${size} is not one of ${SIZES.join(', ')}`);
  }
  return `${BASE}/${storageKey}-${size}.webp`;
}

/**
 * A srcset covering all three derivatives, so the browser downloads the
 * one it actually needs instead of the biggest.
 */
export function imageSrcset(storageKey) {
  if (!storageKey) return '';
  return SIZES.map((s) => `${imageUrl(storageKey, s)} ${s}w`).join(', ');
}

/**
 * Everything an <img> needs. `sizes` tells the browser how wide the image
 * will actually render, which it cannot know before CSS is applied — get
 * this wrong and it downloads the 1600px file for a 200px thumbnail.
 */
export function imageAttrs(image, { sizes = '100vw', eager = false } = {}) {
  if (!image || !image.storage_key) return null;
  return {
    src: imageUrl(image.storage_key, 800),
    srcset: imageSrcset(image.storage_key),
    sizes,
    alt: image.alt || '',
    width: image.width || undefined,
    height: image.height || undefined,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
  };
}

// Render-width hints for each surface the catalogue has. Keeping them in
// one place stops a grid quietly asking for full-width images.
export const SIZES_HINT = {
  grid: '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 280px',
  productMain: '(max-width: 900px) 100vw, 600px',
  productThumb: '72px',
  categoryTile: '(max-width: 640px) 90vw, 360px',
};

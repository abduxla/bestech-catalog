// =====================================================================
// Image derivatives, generated in the browser.
//
// A photo taken on a phone is 3-12MB of JPEG at 4000px. The site needs
// three WebP derivatives at 400/800/1600. Normally that means a server
// with `sharp` installed, or a paid image service — a dependency, a
// build step and a running process, all of which this project is
// explicitly trying not to have.
//
// It is not needed. Every browser since 2020 ships a competent image
// decoder and a WebP encoder behind <canvas>. Resizing happens on the
// machine of whoever is uploading, and the network only ever carries
// the finished derivatives. For 250 products that is the difference
// between pushing ~3GB of originals and ~50MB of WebP.
//
// No dependency, no server, no cost, and the upload is faster too.
// =====================================================================

export const SIZES = [400, 800, 1600];
const QUALITY = 0.82;   // visually lossless for product photography on white

/**
 * Decode a File into an ImageBitmap, respecting EXIF orientation.
 *
 * `imageOrientation: 'from-image'` matters: a phone photographed in
 * portrait is stored landscape with an orientation flag, and a canvas
 * that ignores it uploads every photo on its side.
 */
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari took a while to support the option. Fall back to an <img>,
    // which applies orientation itself.
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not read that image'));
      img.src = URL.createObjectURL(file);
    });
  }
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Downscale in halving steps.
 *
 * drawImage straight from 4000px to 400px point-samples and leaves a
 * drill chuck looking like a screen door. Halving repeatedly lets the
 * browser average properly at each step, which is what makes a 400px
 * thumbnail actually look sharp.
 */
function resize(source, sw, sh, targetW, targetH) {
  let cur = source, cw = sw, ch = sh;
  while (cw / 2 > targetW && ch / 2 > targetH) {
    const next = canvasOf(Math.max(1, Math.round(cw / 2)), Math.max(1, Math.round(ch / 2)));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next; cw = next.width; ch = next.height;
  }
  const out = canvasOf(targetW, targetH);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, targetW, targetH);
  return out;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
  });
}

/**
 * One File in, three WebP blobs out.
 *
 * Never upscales: a 300px source stays 300px rather than being blown up
 * to 1600 and looking soft. The srcset simply has fewer useful entries.
 */
export async function derive(file) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not an image`);

  const bitmap = await decode(file);
  const sw = bitmap.width || bitmap.naturalWidth;
  const sh = bitmap.height || bitmap.naturalHeight;
  if (!sw || !sh) throw new Error(`${file.name} has no dimensions`);

  // WebP is near-universal now, but if a browser cannot encode it we
  // must find out here rather than silently uploading PNGs named .webp.
  const probe = await toBlob(canvasOf(2, 2), 'image/webp', 0.8);
  if (probe.type !== 'image/webp') {
    throw new Error('this browser cannot write WebP — please use Chrome, Edge, Firefox or Safari 16+');
  }

  const out = [];
  for (const size of SIZES) {
    const scale = Math.min(1, size / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = resize(bitmap, sw, sh, w, h);
    out.push({ size, width: w, height: h, blob: await toBlob(canvas, 'image/webp', QUALITY) });
  }

  if (bitmap.close) bitmap.close();
  return { width: sw, height: sh, derivatives: out };
}

/**
 * Work out which product a photo belongs to from its filename.
 *
 * This is the whole point of the bulk uploader. Photographing 250
 * products produces 250+ files; naming them after the model number
 * turns an afternoon of clicking into a drag-and-drop.
 *
 *   HG-ID13.jpg        -> HG-ID13, position 0
 *   HG-ID13-2.jpg      -> HG-ID13, position 1
 *   hg_id13_3.JPG      -> HG-ID13, position 2
 *   HG-ID13 (2).jpg    -> HG-ID13, position 1   (what Windows does on copy)
 *
 * The SKU is matched case- and punctuation-insensitively against the
 * real catalogue, so "hg_id13" finds "HG-ID13". Anything unmatched is
 * listed for the operator rather than guessed at.
 */
export function parseFilename(name, skuIndex) {
  const stem = name.replace(/\.[a-z0-9]+$/i, '').trim();

  // Strip a trailing index: "-2", "_2", " 2", "(2)", " copy 2"
  const m = stem.match(/^(.*?)(?:[\s_-]*(?:copy)?[\s_-]*\(?(\d{1,2})\)?)?$/i);
  let base = (m && m[1] ? m[1] : stem).trim();
  let n = m && m[2] ? parseInt(m[2], 10) : 1;

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  let sku = skuIndex.get(norm(base));
  let matched = base;
  if (!sku) {
    // The whole stem may itself be the SKU ("HG-RH26" with no index, or
    // a model number that genuinely ends in a digit, like "HM-JET100").
    // This is why the index lookup is tried twice rather than trusting
    // the regex: "HM-JET100" splits as "HM-JET" + "100", and guessing
    // wrong there files a pump's photo under a drill.
    sku = skuIndex.get(norm(stem));
    if (sku) { n = 1; matched = stem; }
    else matched = base || stem;
  }

  // Photographers number from 1; positions are 0-based.
  // `base` is what the operator is shown when nothing matched, so it
  // must be the thing actually looked up, not a truncated fragment.
  return { sku: sku || null, position: Math.max(0, n - 1), base: matched };
}

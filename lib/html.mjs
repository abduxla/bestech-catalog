// =====================================================================
// HTML primitives.
//
// Deliberately tiny and dependency-free. Everything the site renders
// goes through esc() — there is no template engine to trust, and no
// escaping rule to remember, because forgetting one is how a product
// name containing an ampersand or a quote breaks a page.
// =====================================================================

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape for HTML text and attribute values. */
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Escape for text inside a <script> or JSON embedded in HTML. */
export function escJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Join template parts, dropping null/undefined/false so `cond && html` works. */
export function join(parts, sep = '') {
  return parts.filter((p) => p !== null && p !== undefined && p !== false).join(sep);
}

/** Build an attribute string from an object, skipping empty values. */
export function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(' ');
}

/** URL-safe slug. The single definition used by the build and importer. */
export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// =====================================================================
// Supabase, over plain fetch.
//
// Deliberately not supabase-js. That library is ~80KB, changes its API
// across majors, and everything this admin needs is four REST endpoints
// and a bearer token. Writing them out means the admin has no
// dependencies, no bundler and nothing that can break on an upgrade —
// the same bet the rest of the project makes.
//
// It mirrors lib/db.mjs on the server side: one file, one seam, so
// moving off Supabase changes this and nothing above it.
// =====================================================================

const CFG = window.BESTECH_CONFIG || {};
export const SUPABASE_URL = (CFG.supabaseUrl || '').replace(/\/+$/, '');
const ANON = CFG.anonKey || '';
export const BUCKET = CFG.bucket || 'product-images';
export const IMAGE_BASE = (CFG.imageBaseUrl || '').replace(/\/+$/, '');

const STORE = 'bestech.session';

export function configured() { return Boolean(SUPABASE_URL && ANON); }

// ---------------------------------------------------------------------
// Session
//
// The refresh token lives in localStorage; the access token is kept in
// memory and refreshed on demand. The anon key in the page is public by
// design — it grants nothing on its own, because every table's RLS
// requires an allowlisted admin for writes.
// ---------------------------------------------------------------------
let session = null;
try { session = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { session = null; }

function save(s) {
  session = s;
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch { /* private mode: stay signed in for this tab only */ }
}

export function currentUser() { return session && session.user ? session.user : null; }

async function auth(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Sign in failed');
  return data;
}

export async function signIn(email, password) {
  const d = await auth('token?grant_type=password', { email, password });
  save({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    user: d.user,
  });
  return d.user;
}

export function signOut() { save(null); }

async function token() {
  if (!session) throw new Error('not signed in');
  // Refresh a minute early so a long edit never fails mid-save.
  if (Date.now() > session.expires_at - 60000) {
    try {
      const d = await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      save({
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_at: Date.now() + (d.expires_in || 3600) * 1000,
        user: d.user || session.user,
      });
    } catch {
      save(null);
      throw new Error('Your session expired. Please sign in again.');
    }
  }
  return session.access_token;
}

/** Is the signed-in user actually on the admin allowlist? */
export async function isAdmin() {
  if (!session) return false;
  try {
    const rows = await rpc('is_admin', {});
    return rows === true;
  } catch { return false; }
}

// ---------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------
async function rest(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const t = await token();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.message || j.hint || j.details || text; } catch { /* plain text */ }
    throw new Error(msg || `${method} ${path} failed (${res.status})`);
  }
  return text ? JSON.parse(text) : null;
}

export function select(table, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.set(k, v);
  return rest(`${table}?${qs}`);
}

/** Read every row, paging — the admin must never silently show a subset. */
export async function selectAll(table, params = {}, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await select(table, { ...params, limit: pageSize, offset });
    if (!page || !page.length) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export function insert(table, rows) {
  return rest(table, { method: 'POST', body: rows, prefer: 'return=representation' });
}

export function update(table, filter, patch) {
  return rest(`${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
}

export function remove(table, filter) {
  return rest(`${table}?${filter}`, { method: 'DELETE', prefer: 'return=minimal' });
}

export function upsert(table, rows, onConflict) {
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST', body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

export async function rpc(fn, args) {
  const t = await token();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* plain text */ }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------

/** Upload one derivative. `path` is e.g. "products/hg-id13/1-400.webp". */
export async function uploadObject(path, blob, { upsert: over = true } = {}) {
  const t = await token();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: over ? 'PUT' : 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${t}`,
      'Content-Type': blob.type || 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upload ${path}: ${text || res.status}`);
  }
  return path;
}

export async function deleteObjects(paths) {
  if (!paths.length) return;
  const t = await token();
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
}

/** Public URL for a stored derivative — must match lib/images.mjs. */
export function publicUrl(storageKey, size = 400) {
  if (!storageKey) return '';
  if (IMAGE_BASE) return `${IMAGE_BASE}/${storageKey}-${size}.webp`;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storageKey}-${size}.webp`;
}

// ---------------------------------------------------------------------
// Publish
//
// The public site is static files, so "publish" means "rebuild and
// redeploy". The tempting shortcut is to POST a deploy-hook URL from
// here — but this page is served to anyone who asks for it, and a
// deploy hook is a bearer credential: the URL *is* the authorisation.
// Shipping one in a public script lets a stranger trigger unlimited
// builds, which costs money on every host that bills for them.
//
// So publishing writes a row instead. CI polls the queue, rebuilds and
// marks it done; the deploy credential never leaves CI. See
// supabase/migrations/0005_publishing.sql.
// ---------------------------------------------------------------------
export function publish(note = '') {
  return rpc('request_publish', { p_note: note });
}

/** 'idle' | 'queued' | 'building' | 'done' */
export async function publishStatus() {
  const rows = await rpc('publish_status', {});
  return (rows && rows[0]) || { state: 'idle' };
}

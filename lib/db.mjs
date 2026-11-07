// =====================================================================
// The database seam.
//
// EVERY read and write in this project goes through this one file. That
// is the whole point of it: the catalogue must be movable off Supabase
// onto any plain Postgres (Neon, RDS, a VPS) without touching the
// importer, the build script or the admin.
//
// Today it speaks PostgREST over fetch, which is why the project has no
// dependencies and no build step. If Supabase ever has to go, only the
// `query`/`upsert` bodies below change — swap them for a `pg` client
// against the same tables and everything upstream is unaffected.
//
// Deliberately kept out of the schema so the data stays portable:
//   * no Supabase Edge Functions
//   * no Realtime, no Storage (images live in an object store keyed by
//     storage_key, see lib/images.mjs)
//   * no database features outside standard Postgres, apart from the
//     `admins` allowlist + RLS, which any Postgres can run
// The one genuinely Supabase-shaped thing is `auth.users`, referenced by
// admins.user_id. If you ever leave, that single FK is the thing to drop
// — the catalogue tables themselves are vanilla Postgres.
// =====================================================================

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Supabase has two generations of API key, and they are NOT
// interchangeable in the Authorization header:
//
//   legacy   eyJhbGci...            a JWT; valid as apikey AND as Bearer
//   current  sb_secret_...          server-side; valid as both
//            sb_publishable_...     browser-safe; apikey ONLY — it is not
//                                   a JWT, so presenting it as a Bearer
//                                   token is a malformed credential
//
// Sending a publishable key as a Bearer token is the kind of thing that
// works on one gateway version and starts 401-ing after the next
// upgrade. So the header is only set when the key actually belongs
// there.
const IS_PUBLISHABLE = /^sb_publishable_/.test(KEY || '');

// Can this process write, or see drafts? A publishable key is subject to
// RLS as an anonymous visitor: it reads published rows and nothing else.
// Importing with one would not fail loudly — it would read a subset and
// write nothing — so the scripts that need write access check this and
// say so, rather than reporting "0 products" and looking like a bug.
const IS_SECRET = /^sb_secret_/.test(KEY || '') ||
                  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export function hasWriteAccess() { return IS_SECRET; }

export function assertConfigured() {
  if (!URL_BASE || !KEY) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_ANON_KEY (see .env.example).'
    );
  }
}

export function assertCanWrite(what = 'This') {
  assertConfigured();
  if (!IS_SECRET) {
    throw new Error(
      `${what} needs a secret key, but SUPABASE_ANON_KEY (a publishable key) is set.\n` +
      '  A publishable key is read-only to anyone who is not signed in, so this\n' +
      '  would silently do nothing. Set SUPABASE_SERVICE_ROLE_KEY to the project\'s\n' +
      '  secret key (sb_secret_... in Project Settings -> API keys).'
    );
  }
}

async function request(path, { method = 'GET', body, prefer } = {}) {
  assertConfigured();
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(IS_PUBLISHABLE ? {} : { Authorization: `Bearer ${KEY}` }),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Read rows. Always pass an explicit column list — never `*`.
 * A listing that selects the prose description and the spec JSON it does
 * not render is how a fast page silently becomes a slow one.
 */
export function query(table, { select, filter = '', order, limit, offset } = {}) {
  if (!select) throw new Error(`query(${table}) needs an explicit select list, never "*"`);
  const parts = [`select=${encodeURIComponent(select)}`];
  if (filter) parts.push(filter);
  if (order) parts.push(`order=${encodeURIComponent(order)}`);
  if (limit != null) parts.push(`limit=${limit}`);
  if (offset != null) parts.push(`offset=${offset}`);
  return request(`${table}?${parts.join('&')}`);
}

/**
 * Read EVERY row of a table, paging under the hood.
 *
 * PostgREST silently caps responses, and the previous project papered
 * over that with a hardcoded `.limit(2000)` — which would truncate this
 * catalogue at its own stated growth target, with no error anywhere.
 * This pages until exhausted instead, so it cannot silently lose rows.
 */
export async function queryAll(table, { select, filter = '', order, pageSize = 1000 } = {}) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await query(table, { select, filter, order, limit: pageSize, offset });
    if (!page || !page.length) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/** Insert-or-update on a unique column. Idempotent by construction. */
export function upsert(table, rows, { onConflict, returning = 'minimal' } = {}) {
  if (!onConflict) throw new Error(`upsert(${table}) needs an onConflict column`);
  if (!rows.length) return Promise.resolve(null);
  return request(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    body: rows,
    prefer: `resolution=merge-duplicates,return=${returning}`,
  });
}

export function insert(table, rows, { returning = 'representation' } = {}) {
  if (!rows.length) return Promise.resolve([]);
  return request(table, { method: 'POST', body: rows, prefer: `return=${returning}` });
}

// Note there is deliberately no generic `del()` helper. Deletion in this
// project is always a specific, named operation with its own guard rails
// — a convenient delete-anything helper is how an importer ends up
// wiping a division that was merely absent from a partial file.

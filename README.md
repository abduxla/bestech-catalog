# Bestech catalogue

The product catalogue for **Bestech (Pvt) Ltd** — power tools, machinery and
water pumps. Informational only: no prices, no cart, no stock. Buyers
telephone, so the phone number is the call to action on every page.

```
Postgres (Supabase)  ──►  node scripts/build.mjs  ──►  dist/  ──►  CDN
   source of truth          runs on a laptop or CI      plain files
```

---

## Why it is built this way

The brief was a site that needs no attention for five years and does not
fall over under load. Three decisions follow from that, and everything
else is a consequence of them.

**1. The database is not in the request path.**
Every page is rendered once, at build time, into a plain HTML file. A
visitor gets a file from a CDN edge. There is no server-side render, no
API call, no database query and no cold start while anyone is waiting.
Ten visitors and ten thousand cost the origin the same: nothing. This is
the entire answer to "withstand heavy traffic" — not caching bolted onto
a dynamic site, but having nothing dynamic to cache.

**2. Zero dependencies.**
`package.json` has an empty `dependencies` block, and that is deliberate.
No framework, no bundler, no `node_modules`. Nothing in this repo can be
broken by an upstream release, a deprecated transitive package or a
breaking major version, because there is no upstream. A Node 18 install
runs it; so will whatever Node exists in 2031.

A framework was considered and rejected. Next.js would have added a
toolchain, a yearly breaking major and a build output nobody can read, in
exchange for features this site does not use — the content is 100%
static and there is not one interactive surface on the public site.

**3. The data is portable by construction.**
All database access goes through one file, [`lib/db.mjs`](lib/db.mjs).
The backup script writes *the same JSONL the importer reads*, so moving
off Supabase to any plain Postgres is:

```bash
node scripts/backup.mjs                          # export from the old DB
# apply supabase/migrations/*.sql to the new DB
SUPABASE_URL=<new> node import/import.mjs <file> --apply
```

No proprietary dump format, no vendor export to reverse-engineer.

---

## Running it

Node 18+. There is nothing to install.

```bash
# Work on templates with no database and no keys at all:
npm run dev           # fixture -> build -> http://localhost:4000

# Against the real database:
npm run build         # read the DB, render dist/
npm run serve         # preview dist/ locally

npm run import -- catalogue.jsonl            # dry run, writes nothing
npm run import -- catalogue.jsonl --apply    # commit it
npm run backup                               # export to backups/
```

Copy `.env.example` to `.env` and fill it in. `SUPABASE_SERVICE_ROLE_KEY`
is server-side only and must never reach the browser or the repo.

### Build flags

| Flag | Effect |
|---|---|
| *(none)* | Read the database, render `dist/`, cache a snapshot |
| `--from-cache` | Re-render from the last snapshot. No DB, no keys, no network |
| `--drafts` | Include unpublished products (preview builds only) |
| `--allow-shrink` | Override the guard below. Use deliberately |

---

## The guard rails

Each of these exists because it is a specific way a catalogue site
destroys itself. They are not hypothetical.

**The build refuses to publish a collapsed catalogue.** If the database
returns fewer than half the products the last build saw, the build fails
and `dist/` is left untouched. A wrong project reference, a revoked key
or a bad RLS change all look like "the catalogue is now empty", and
without this guard the next deploy quietly replaces a working site with
a shell.

**A broken product cannot take the site down.** Each page renders inside
a try/catch. One bad row is reported and skipped; the other 249 pages
build.

**Imports are dry-run by default.** Writing needs `--apply`.

**Absence is never destructive.** Products missing from an import file
are reported, never deleted or auto-archived — the client will send
partial files, one brand at a time, and a "sync" that deletes the
difference would wipe the catalogue on the first one.

**Imports cannot change a URL.** A product's slug is frozen when it is
created. Renaming a product in a spreadsheet is an ordinary edit, and
without this it would silently 404 every indexed page and shared link
pointing at that product. Renames are reported for a human to approve.

**Nothing an import does can publish.** New rows land as `draft`.

**URLs never rot.** Every path the site has ever served is recorded in
`path_history` by a database trigger the moment it stops being current,
and the build emits a stub at each retired path pointing to the live
one. Nobody has to know what a 301 is: it is a side effect of renaming.

**Backups restore through the importer.** The restore path is the same
code exercised every time the client sends a price list — not a cold
procedure nobody has ever run.

---

## The data

The specification table is one JSONB column, an **array** of sections,
each with an **array** of rows:

```json
[{"title": null, "caption": null,
  "rows": [{"label": "Power", "unit": "HP", "value": "1.0"},
           {"label": "Power", "unit": "W",  "value": "750"}]}]
```

An array, never an object keyed by label — Postgres `jsonb` sorts keys
and drops duplicates, which would reorder the table and silently merge
those two Power rows into one. Real tools genuinely list the same
measurement in two units. (dbl.lk stores specs as pasted HTML, which is
why their site cannot filter, compare or search on them. This can.)

The full import contract is in [`docs/import-format.md`](docs/import-format.md)
and is frozen. The client's spreadsheet is converted to it by a small
disposable adapter, so the importer never has to know what shape the
catalogue file arrives in.

---

## Layout

```
supabase/migrations/   numbered, append-only SQL. Never edited in the dashboard
lib/db.mjs             the only place that talks to the database
lib/render.mjs         page templates (plain template literals)
lib/images.mjs         the only place that knows where images live
lib/html.mjs           esc() and friends
scripts/build.mjs      DB -> dist/
scripts/dev-fixture.mjs  realistic offline data, incl. every awkward shape
scripts/serve.mjs      local preview only — never runs in production
scripts/backup.mjs     DB -> the same JSONL the importer reads
import/import.mjs      JSONL -> DB
static/                CSS, JS, host config. Copied verbatim into dist/
dist/                  build output. Not committed
```

Images are stored as a **key** (`products/hg-id13/1`), never a URL, and
served as 400/800/1600 WebP derivatives. The CDN hostname lives in one
environment variable, so changing image host is config, not a migration.

---

## Deploying

`dist/` is a folder of static files. Host config for Vercel
(`vercel.json`) and for Cloudflare Pages / Netlify (`static/_headers`)
are both committed, so moving host is an afternoon, not a rewrite.

Publishing is a build plus an upload. A rebuild only rewrites the files
that actually changed, so a one-product edit is a one-file deploy.

---

## Still to do

- Admin UI for editing products and uploading photos
- Image upload pipeline (original → 400/800/1600 WebP)
- Supabase project + the first `supabase db push`
- Real catalogue data and photography (~250 best sellers)
- Domain: `bestechlanka.com` lapsed and the company mailbox is dead with
  it, so a domain in Bestech's own name has to be registered before the
  site can go live on its own address.

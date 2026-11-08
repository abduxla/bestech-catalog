# Handover

Everything needed to continue this project in any editor, with any
assistant, or by hand. Nothing here depends on the tool that wrote it.

---

## The 60-second version

```bash
git clone https://github.com/abduxla/bestech-catalog
cd bestech-catalog
cp .env.example .env          # then fill it in — see "Secrets" below
npm test                      # 28 tests, no install step
npm run dev                   # fixture data, no database, localhost:4000
```

There is **no `npm install`**. `package.json` has an empty
`dependencies` block and that is deliberate — nothing here can be
broken by an upstream release.

---

## Where things live

| | |
|---|---|
| Repo | `github.com/abduxla/bestech-catalog` (branch `main`) |
| Live site | `https://abduxla.github.io/bestech-catalog/` |
| Served from | branch `gh-pages`, root |
| Database | Supabase project `npsvtfplwzrscdykrbzs` |
| Admin | `/admin/` on the live site |
| Local working copy | `D:\bestech-catalog` |

Read [`README.md`](../README.md) first — it is the operations runbook
and explains *why* the architecture is what it is. This file is just
the state of play.

---

## Secrets

`.env` is **gitignored and not in the repo**. A fresh clone has none of
it. The live values are in `D:\bestech-catalog\.env` on the Windows
machine; copy that file across, or rebuild it from `.env.example`.

```
SUPABASE_URL=https://npsvtfplwzrscdykrbzs.supabase.co
SUPABASE_ANON_KEY=sb_publishable_…      # public by design
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…   # server only, never in a browser
IMAGE_BASE_URL=…/storage/v1/object/public/product-images
HERO_IMAGE_KEY=site/hero-main
SHOWCASE_IMAGE_KEY=site/showcase-counter
MODAL_IMAGE_KEY=site/showcase-tools
SITE_ORIGIN=https://abduxla.github.io
```

The secret key was pasted into a chat window during development, so it
should be rotated in Supabase (Settings → API Keys) before this goes
anywhere public. Rotating means updating `.env` and, once CI is wired,
the GitHub secret.

Admin login: `zyvaitech@gmail.com`. The password was generated during
setup and is in the chat history; change it on first sign-in.

---

## Deploying

CI exists (`.github/workflows/publish.yml`) but **is not wired up**:
the four repository secrets have never been added, so every deploy so
far has been done by hand. Until the secrets exist, publish like this:

```bash
rm -rf dist
set -a && . ./.env && set +a
MSYS_NO_PATHCONV=1 BASE_PATH=/bestech-catalog \
  SITE_ORIGIN=https://abduxla.github.io node scripts/build.mjs
touch dist/.nojekyll

cd dist
git init -q && git checkout -q -b gh-pages
git add -A && git commit -q -m "Build"
git push --force https://github.com/abduxla/bestech-catalog.git gh-pages
```

`MSYS_NO_PATHCONV=1` is only needed in Git Bash on Windows, which
otherwise rewrites `BASE_PATH=/bestech-catalog` into a Windows path and
produces a site whose every stylesheet 404s.

To hand deploys to CI instead, add these at **Settings → Secrets and
variables → Actions**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `IMAGE_BASE_URL`. CI then builds on every
push to `main`, and picks up "Publish" requests from the admin every
15 minutes.

---

## Two rules that are easy to break

**1. Never remove an asset in the same deploy that stops referencing
it.** GitHub Pages serves HTML with `max-age=600`, so for ten minutes
after any deploy there are browsers holding the *previous* page. The
stylesheet and script are content-hashed AND written under their plain
names for exactly this reason. Dropping the plain copy takes the live
site down to unstyled HTML for everyone mid-cache. This has happened
once already.

**2. Schema changes are numbered migration files.** Never edit a table
in the Supabase dashboard. `supabase/migrations/` is the only source of
truth; `supabase/bootstrap.sql` is generated from it by
`npm run bundle` and is for setting up an empty project, not for
ongoing work.

---

## Outstanding

Roughly in the order that unblocks the most.

- **Run `supabase/apply-0007-enquiries.sql`.** The enquiry form is
  built, deployed and wired, but the table does not exist yet, so the
  form tells visitors it is not switched on. One paste into the SQL
  editor.
- **The 8 products are invented.** Model numbers, specifications and
  photographs are all placeholder. `import/demo-catalogue.jsonl` lists
  them so they can be purged in one query when the real catalogue
  arrives. Do not show this to the client as their product range.
- **The real catalogue.** Send it in whatever format it arrives in; a
  small disposable adapter converts it to the frozen JSONL contract in
  `docs/import-format.md`, and `import/import.mjs` does the rest.
- **Photography.** 11 of 18 brands have no logo. Category cards still
  use studio product shots where the reference uses tradespeople at
  work. Options: the client's own files (best), Unsplash under its free
  licence (watch for competitor branding — most stock tool photography
  has a rival's logo in frame), or generated.
- **Admin: an enquiries screen.** Staff can currently receive enquiries
  but not read them anywhere except the database.
- **Smartec.** Has a logo in the client's material but no brand row.
  Decide whether it belongs.
- **The original logo vector.** What is on the site is extracted from a
  raster — exact at screen sizes, will soften in print.
- **A domain.** `bestechlanka.com` lapsed and took the company mailbox
  with it. Nothing can go live under Bestech's own name until a domain
  is registered. Setting a `SITE_ORIGIN` repository variable switches
  the build from `/bestech-catalog/` to serving at a domain root.

---

## Useful commands

```bash
npm test              # 28 tests (node:test, nothing to install)
npm run doctor        # probes the live database and its RLS policies
npm run dev           # fixture data, no database, no keys
npm run build         # real database -> dist/
npm run serve         # preview dist/ locally
npm run import -- file.jsonl          # dry run
npm run import -- file.jsonl --apply  # commit it
npm run backup        # export, in the same format the importer reads
npm run bundle        # regenerate supabase/bootstrap.sql
node scripts/derive-images.mjs <src> <out>      # 400/800/1600 WebP
node scripts/upload-images.mjs <dir> <manifest> # upload and link
```

`npm run doctor` is the one to reach for first if anything looks wrong:
it attempts, as an anonymous visitor, every action that should be
impossible, and reports what is actually enforced rather than what the
SQL says.

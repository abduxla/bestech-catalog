-- =====================================================================
-- Bestech catalogue — 0001_init
--
-- Append-only numbered migration, applied with the Supabase CLI
-- (`supabase db push`). Nothing in this project is applied by pasting
-- into the dashboard SQL editor, and nobody edits schema in the table
-- editor: the previous project ended up with three production columns
-- that existed in no SQL file, so the repo could not rebuild the
-- database. Every later change is a NEW numbered file.
--
-- Scope: a purely informational B2B catalogue. No prices, no cart, no
-- stock, no orders — by client instruction. Buyers telephone.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
  language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end
$fn$;

-- ---------------------------------------------------------------------
-- Admin allowlist. Mirrors the pattern already running in the team's
-- production project, so writes are limited to named accounts rather
-- than to anyone who can reach the `authenticated` role.
-- ---------------------------------------------------------------------
create table admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);
-- RLS on with no policies => not reachable through the API at all.
alter table admins enable row level security;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $fn$
    select exists (select 1 from admins a where a.user_id = auth.uid());
$fn$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Divisions — the top of the taxonomy. Two at launch: Power Tools &
-- Machinery, and Water Pumps. (Primebase / hardware & plumbing is a
-- separate company and is deliberately NOT in this catalogue.)
-- ---------------------------------------------------------------------
create table divisions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  tagline      text not null default '',
  blurb        text not null default '',
  hero_key     text not null default '',
  sort         int  not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger divisions_touch before update on divisions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Brands — third-party brands Bestech is the authorised seller for
-- (HUGO, HUGO MAX and the rest). Bestech does not own them, so there is
-- no "house brand" concept; is_flagship only drives display order.
-- ---------------------------------------------------------------------
create table brands (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  blurb        text not null default '',
  logo_key     text not null default '',
  is_flagship  boolean not null default false,
  sort         int  not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger brands_touch before update on brands
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Categories — nested to any depth (DeWalt runs 3 levels, dbl.lk 5).
--
-- parent_id is the structure. `path` is a maintained materialised path
-- ('power-tools/drills/hammer-drills') so that "this category and every
-- descendant" is one indexed prefix match rather than a recursive CTE
-- on every listing request.
-- ---------------------------------------------------------------------
create table categories (
  id           uuid primary key default gen_random_uuid(),
  division_id  uuid not null references divisions(id) on delete restrict,
  parent_id    uuid references categories(id) on delete restrict,
  slug         text not null,
  name         text not null,
  blurb        text not null default '',
  image_key    text not null default '',
  path         text not null default '',
  depth        int  not null default 0,
  sort         int  not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Siblings must differ. The same slug may recur under another parent.
  constraint categories_unique_sibling_slug unique (parent_id, slug)
);
create trigger categories_touch before update on categories
  for each row execute function set_updated_at();

-- Derive path/depth from the parent chain so `path` can never drift
-- from `parent_id`. Two sources of truth that disagree is precisely the
-- class of bug this project is avoiding.
create or replace function categories_sync_path() returns trigger
  language plpgsql as $fn$
declare
  parent_path  text;
  parent_depth int;
begin
  if new.parent_id is null then
    new.path  := new.slug;
    new.depth := 0;
  else
    select c.path, c.depth into parent_path, parent_depth
      from categories c where c.id = new.parent_id;
    if parent_path is null then
      raise exception 'parent category % not found', new.parent_id;
    end if;
    new.path  := parent_path || '/' || new.slug;
    new.depth := parent_depth + 1;
  end if;
  return new;
end
$fn$;

create trigger categories_path_sync
  before insert or update of slug, parent_id on categories
  for each row execute function categories_sync_path();

-- Re-parenting or renaming a branch rewrites its descendants' paths.
create or replace function categories_resync_children() returns trigger
  language plpgsql as $fn$
begin
  if new.path is distinct from old.path then
    -- Re-touching slug makes the before-trigger recompute each child,
    -- which cascades down the branch.
    update categories set slug = slug where parent_id = new.id;
  end if;
  return null;
end
$fn$;

create trigger categories_path_cascade
  after update of path on categories
  for each row execute function categories_resync_children();

create index categories_path_idx     on categories (path text_pattern_ops);
create index categories_division_idx on categories (division_id, sort);
create index categories_parent_idx   on categories (parent_id, sort);

-- ---------------------------------------------------------------------
-- Products
--
-- `sku` is the client's own model number and is the ONLY import key:
-- the importer runs `on conflict (sku) do update`, so re-importing a
-- file updates rather than duplicating. A row with no model number is
-- rejected to the error report, never given a generated one.
--
-- `specs` holds the entire specification table as ONE ordered JSONB
-- value — an array of sections, each with an ordered array of rows:
--
--   [{"title": null,
--     "caption": null,
--     "rows": [{"label":"Power","unit":"HP","value":"2.5"},
--              {"label":"Power","unit":"Kw","value":"1.8"}]}]
--
-- Why this exact shape:
--   * An ARRAY, never an object keyed by label. Postgres jsonb sorts
--     keys and drops duplicates, which would reorder the table AND
--     silently merge the two "Power" rows above into one.
--   * Each row is one self-contained object, so label/unit/value can
--     never desynchronise. Parallel text[] columns are forbidden here:
--     that is exactly how the previous project mis-flagged variants.
--   * No `position` field inside rows — array order is the single order
--     authority, and two authorities can disagree.
--   * SECTIONS, because real catalogues need them: dbl.lk's welding
--     plant has a main table, then a caption, then a second table.
--   * One column means re-import is a single-column overwrite inside
--     the same upsert as the rest of the row: atomic, with no child
--     rows to orphan and no half-written spec table if a run dies.
--
-- A product with no table at all simply has '[]' and renders its prose
-- description only (dbl.lk's lawn mower does exactly that).
-- ---------------------------------------------------------------------
create table products (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text not null unique,
  slug                text not null unique,
  name                text not null,
  brand_id            uuid references brands(id) on delete restrict,
  primary_category_id uuid references categories(id) on delete restrict,
  summary             text not null default '',
  description         text not null default '',
  specs               jsonb not null default '[]'::jsonb,
  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'archived')),
  is_featured         boolean not null default false,
  sort                int  not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint products_specs_is_array check (jsonb_typeof(specs) = 'array')
);
create trigger products_touch before update on products
  for each row execute function set_updated_at();

create index products_status_idx   on products (status) where status = 'published';
create index products_brand_idx    on products (brand_id);
create index products_category_idx on products (primary_category_id);
create index products_featured_idx on products (is_featured) where is_featured;

-- Trigram search over what buyers actually type: model number and name.
-- Typo-tolerant, and no stemming configuration to get wrong for a
-- catalogue that is largely model numbers.
create index products_name_trgm on products using gin (name gin_trgm_ops);
create index products_sku_trgm  on products using gin (sku  gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Product <-> category, many-to-many. A product legitimately sits in
-- several categories (dbl.lk assigns the leaf AND its ancestors).
-- primary_category_id drives the breadcrumb; this table drives listings.
-- ---------------------------------------------------------------------
create table product_categories (
  product_id  uuid not null references products(id)   on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (product_id, category_id)
);
create index product_categories_cat_idx on product_categories (category_id);

-- ---------------------------------------------------------------------
-- Product images — a child table rather than a JSON blob, because
-- images are uploaded one at a time through the admin (never bulk
-- imported), each carries its own metadata, and they are reordered and
-- deleted individually.
--
-- We store the storage KEY, never a full URL, so the CDN hostname can
-- change without rewriting every row. The 400/800/1600 WebP derivative
-- URLs are composed in code from this key.
-- ---------------------------------------------------------------------
create table product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  storage_key text not null,
  alt         text not null default '',
  width       int,
  height      int,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index product_images_product_idx on product_images (product_id, position);

-- ---------------------------------------------------------------------
-- Row level security
--
-- Anonymous visitors may read PUBLISHED catalogue rows only. Every
-- write, and any sight of a draft, requires an allowlisted admin.
-- A table's policies live in exactly one migration and are never
-- redefined in a second file — that is how the previous project's
-- schema.sql silently reopened a hole its security.sql had closed.
-- ---------------------------------------------------------------------
alter table divisions          enable row level security;
alter table brands             enable row level security;
alter table categories         enable row level security;
alter table products           enable row level security;
alter table product_categories enable row level security;
alter table product_images     enable row level security;

create policy divisions_read on divisions
  for select using (is_published or is_admin());
create policy divisions_write on divisions
  for all to authenticated using (is_admin()) with check (is_admin());

create policy brands_read on brands
  for select using (is_published or is_admin());
create policy brands_write on brands
  for all to authenticated using (is_admin()) with check (is_admin());

create policy categories_read on categories
  for select using (is_published or is_admin());
create policy categories_write on categories
  for all to authenticated using (is_admin()) with check (is_admin());

create policy products_read on products
  for select using (status = 'published' or is_admin());
create policy products_write on products
  for all to authenticated using (is_admin()) with check (is_admin());

-- Child rows are visible exactly when their parent product is.
create policy product_categories_read on product_categories
  for select using (
    exists (select 1 from products p
             where p.id = product_id
               and (p.status = 'published' or is_admin())));
create policy product_categories_write on product_categories
  for all to authenticated using (is_admin()) with check (is_admin());

create policy product_images_read on product_images
  for select using (
    exists (select 1 from products p
             where p.id = product_id
               and (p.status = 'published' or is_admin())));
create policy product_images_write on product_images
  for all to authenticated using (is_admin()) with check (is_admin());

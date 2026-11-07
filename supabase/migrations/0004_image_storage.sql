-- =====================================================================
-- Bestech catalogue — 0004
--
-- Somewhere to put the photographs.
--
-- ~250 best sellers, photographed in-house, at three derivatives each
-- = roughly 750 files. They are written once and read constantly, which
-- is the easiest possible storage workload; the only thing that matters
-- is that reads are public and cheap, and that writes are locked to
-- staff.
--
-- The bucket is PUBLIC on purpose. These are product photographs for a
-- catalogue whose whole job is to be found — signed URLs would add an
-- API round trip in front of every image on every page and break CDN
-- caching, in exchange for protecting pictures we want indexed.
--
-- Portability note: the database stores a KEY ("products/hg-id13/1"),
-- never a URL, and lib/images.mjs composes the URL from one environment
-- variable. Moving these files to Cloudflare R2 or any other object
-- store is therefore a bucket copy plus a changed variable — no rows to
-- rewrite, which is why this migration can safely start on Supabase
-- Storage today without committing the project to it.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  -- 6MB. The admin resizes and re-encodes to WebP in the browser before
  -- anything is uploaded, so a derivative is tens of kilobytes; this cap
  -- exists only to stop a misconfigured client streaming a raw 40MB file.
  6291456,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- Anyone may read. This is what makes a plain <img src> work with no
-- token, no expiry and no API call in front of it.
create policy "product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- Only allowlisted staff may write, using the same is_admin() check that
-- guards every other table. One definition of "staff", not two.
create policy "admins may upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and is_admin());

create policy "admins may replace product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and is_admin())
  with check (bucket_id = 'product-images' and is_admin());

create policy "admins may delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and is_admin());

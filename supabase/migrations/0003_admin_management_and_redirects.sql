-- =====================================================================
-- Bestech catalogue — 0003
--
-- Closes two gaps that would each have required a developer call-out,
-- which is exactly what this project is meant to avoid.
--
--   A. Staff management. 0001 enabled RLS on `admins` and created no
--      policy, which locks the table to attackers AND to the owner.
--      Adding a colleague or removing someone who left meant opening
--      the Supabase dashboard and running SQL by hand.
--
--   B. URL history. Renaming a product or re-organising the category
--      tree changes URLs. With no prices and no cart, organic search is
--      the whole funnel, so a silently broken URL is lost business.
--      Nothing recorded the change, so no redirect could be emitted.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. Staff management
-- ---------------------------------------------------------------------

-- Admins can see the staff list. Still invisible to everyone else:
-- there is deliberately no insert/update/delete policy, so the only way
-- to change this table through the API is the two guarded functions
-- below, which enforce rules a raw policy cannot.
create policy admins_read on admins
  for select using (is_admin());

-- Grant access by email. The person must already have signed in once
-- (so an auth user exists) — we never create accounts here.
create or replace function add_admin(p_email text)
  returns uuid
  language plpgsql security definer set search_path = public, auth as $fn$
declare
  target uuid;
begin
  if not is_admin() then
    raise exception 'only an administrator may add another administrator';
  end if;

  select id into target from auth.users
   where lower(email) = lower(trim(p_email)) limit 1;

  if target is null then
    raise exception 'no account exists for %. Ask them to sign in once first, then add them.', p_email;
  end if;

  insert into admins (user_id, email) values (target, lower(trim(p_email)))
    on conflict (user_id) do nothing;

  return target;
end
$fn$;

-- Revoke access. Refuses to remove the last administrator, because an
-- empty admins table locks everyone out of the site permanently and can
-- only be undone from the Supabase dashboard.
create or replace function remove_admin(p_user_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'only an administrator may remove an administrator';
  end if;

  if (select count(*) from admins) <= 1 then
    raise exception 'cannot remove the last administrator — add someone else first';
  end if;

  delete from admins where user_id = p_user_id;
end
$fn$;

revoke all on function add_admin(text)    from public, anon;
revoke all on function remove_admin(uuid) from public, anon;
grant execute on function add_admin(text)    to authenticated;
grant execute on function remove_admin(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- B. URL history, so links never rot
--
-- Every path this site has ever served is recorded the moment it stops
-- being current. The build reads this table and emits a small stub page
-- at each retired path carrying a canonical link to the live one, so an
-- old Google result or a WhatsApp link from two years ago still lands
-- somewhere useful instead of on a 404.
--
-- Nobody has to know what a 301 is: it is a side effect of renaming.
-- ---------------------------------------------------------------------
create table path_history (
  old_path    text primary key,
  new_path    text not null,
  kind        text not null check (kind in ('product', 'category')),
  recorded_at timestamptz not null default now()
);

alter table path_history enable row level security;
create policy path_history_read on path_history for select using (true);
create policy path_history_write on path_history
  for all to authenticated using (is_admin()) with check (is_admin());

-- Record a move, and re-point any older entries that led to the old
-- location so a chain of renames (A->B, then B->C) always resolves in
-- ONE hop to the current page rather than bouncing through history.
create or replace function record_path_move(p_old text, p_new text, p_kind text)
  returns void
  language plpgsql as $fn$
begin
  if p_old is null or p_new is null or p_old = p_new then return; end if;

  insert into path_history (old_path, new_path, kind)
       values (p_old, p_new, p_kind)
  on conflict (old_path) do update set new_path = excluded.new_path,
                                       recorded_at = now();

  -- Collapse chains.
  update path_history set new_path = p_new, recorded_at = now()
   where new_path = p_old;

  -- If the path has been reused, it is no longer a redirect source.
  delete from path_history where old_path = p_new;
end
$fn$;

create or replace function products_track_slug() returns trigger
  language plpgsql as $fn$
begin
  perform record_path_move('/product/' || old.slug, '/product/' || new.slug, 'product');
  return null;
end
$fn$;

create trigger products_slug_history
  after update of slug on products
  for each row when (old.slug is distinct from new.slug)
  execute function products_track_slug();

create or replace function categories_track_path() returns trigger
  language plpgsql as $fn$
begin
  perform record_path_move('/c/' || old.path, '/c/' || new.path, 'category');
  return null;
end
$fn$;

-- Note this fires for descendants too: 0001's path trigger cascades a
-- re-parent down the branch, so every moved child records its own
-- redirect automatically.
create trigger categories_path_history
  after update of path on categories
  for each row when (old.path is distinct from new.path)
  execute function categories_track_path();

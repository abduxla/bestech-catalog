-- =====================================================================
-- Bestech catalogue — 0005
--
-- Publishing.
--
-- The public site is static files, so "publish" means "rebuild and
-- redeploy". The obvious way to let staff trigger that is to put a
-- deploy-hook URL in the admin page and POST it from the browser.
--
-- That is wrong, and worth spelling out so nobody re-adds it later:
-- the admin is a static page served to anyone who asks for it, so a
-- URL inside it is public. A deploy hook is a bearer credential — the
-- URL IS the authorisation. Publishing it means a stranger can trigger
-- unlimited builds, which costs money on every host that bills them.
--
-- Instead, publishing is a ROW. An administrator (checked by the same
-- RLS used everywhere else) inserts a request; CI reads the queue,
-- rebuilds, and marks it done. The deploy credential stays in CI where
-- it belongs, never reaching a browser.
--
-- The side benefit is a permanent record of who published what and
-- when, which is the first thing anyone wants when a wrong price list
-- goes live.
-- =====================================================================

create table publish_requests (
  id            bigint generated always as identity primary key,
  requested_by  uuid references auth.users(id) on delete set null,
  requested_at  timestamptz not null default now(),
  note          text not null default '',
  started_at    timestamptz,
  completed_at  timestamptz,
  ok            boolean,
  detail        text not null default ''
);

create index publish_requests_pending_idx
  on publish_requests (requested_at)
  where completed_at is null;

alter table publish_requests enable row level security;

-- Staff can see the history (useful: "did my change go live?").
create policy publish_requests_read on publish_requests
  for select using (is_admin());

-- Nobody writes directly. Requesting goes through the function below so
-- the queue cannot be flooded, and CI updates rows with the service
-- role, which bypasses RLS.
create or replace function request_publish(p_note text default '')
  returns publish_requests
  language plpgsql security definer set search_path = public as $fn$
declare
  pending publish_requests;
begin
  if not is_admin() then
    raise exception 'only an administrator may publish';
  end if;

  -- Coalesce. Ten edits in a row should be one rebuild, not ten: the
  -- build always renders the current state of the database, so a second
  -- request while one is still queued adds nothing but cost.
  select * into pending from publish_requests
   where completed_at is null
   order by requested_at asc limit 1;

  if found then
    return pending;
  end if;

  insert into publish_requests (requested_by, note)
       values (auth.uid(), coalesce(p_note, ''))
    returning * into pending;

  return pending;
end
$fn$;

revoke all on function request_publish(text) from public, anon;
grant execute on function request_publish(text) to authenticated;

-- What the admin polls to show "queued" / "building" / "live".
create or replace function publish_status()
  returns table (state text, requested_at timestamptz, completed_at timestamptz, ok boolean, detail text)
  language sql stable security definer set search_path = public as $fn$
  select
    case
      when r.id is null            then 'idle'
      when r.started_at is null    then 'queued'
      when r.completed_at is null  then 'building'
      else 'done'
    end,
    r.requested_at, r.completed_at, r.ok, r.detail
  from (
    select * from publish_requests
     order by requested_at desc limit 1
  ) r
  where is_admin();
$fn$;

revoke all on function publish_status() from public, anon;
grant execute on function publish_status() to authenticated;

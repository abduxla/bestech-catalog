-- =====================================================================
-- Bestech catalogue — 0007
--
-- Enquiries.
--
-- The site has no cart and no prices, so the enquiry form IS the
-- conversion. It posts straight to this table through PostgREST with
-- the publishable key; there is no form service, no third-party
-- endpoint, and no email relay to keep alive for five years.
--
-- The security shape is the important part and is the opposite of the
-- rest of the schema:
--
--   INSERT  anonymous, because a customer filling in a form is not
--           signed in and never will be.
--   SELECT  administrators only. An enquiry holds a person's name and
--           telephone number. A public read policy here would hand
--           every customer's details to anyone who viewed source and
--           copied the publishable key out of the admin config, which
--           is exactly the kind of quiet catastrophe RLS exists to
--           prevent.
--
-- Because anonymous insert is open by necessity, the damage a bot can
-- do is bounded by CHECK constraints rather than by trust: no field
-- can be longer than a human would type, and the form carries a
-- honeypot that real people never fill in.
-- =====================================================================

create table enquiries (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),

  name        text not null,
  company     text not null default '',
  -- Deliberately one field rather than separate email and telephone.
  -- Trade buyers here overwhelmingly give a mobile number, and a form
  -- that demands a valid email address loses them.
  contact     text not null,
  interest    text not null default '',
  message     text not null,

  -- Which page the enquiry came from, so the counter knows whether
  -- someone was looking at pumps or at a specific product.
  source      text not null default '',

  -- Worked by staff in the admin.
  handled_at  timestamptz,
  handled_by  uuid references auth.users(id) on delete set null,
  note        text not null default '',

  constraint enquiries_sane check (
    length(name)     between 1 and 120  and
    length(company)  <= 160             and
    length(contact)  between 3 and 160  and
    length(interest) <= 80              and
    length(message)  between 1 and 4000 and
    length(source)   <= 200             and
    length(note)     <= 4000
  )
);

-- The admin's working list: everything still outstanding, newest first.
create index enquiries_open_idx on enquiries (created_at desc) where handled_at is null;
create index enquiries_recent_idx on enquiries (created_at desc);

alter table enquiries enable row level security;

-- Anyone may submit one.
create policy enquiries_submit on enquiries
  for insert to anon, authenticated
  with check (true);

-- Only staff may read them. There is no anonymous select policy, and
-- adding one would expose every customer's contact details.
create policy enquiries_read on enquiries
  for select using (is_admin());

-- Only staff may mark one handled or annotate it. Nobody may delete:
-- a deleted enquiry is a lost customer with no trace, so the admin
-- archives by setting handled_at instead.
create policy enquiries_work on enquiries
  for update to authenticated
  using (is_admin()) with check (is_admin());

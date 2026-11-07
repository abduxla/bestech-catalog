-- =====================================================================
-- Bestech catalogue — 0002_seed_reference_data
--
-- Divisions and brands. This is reference data the catalogue cannot
-- function without (the importer REJECTS a product whose brand or
-- category it cannot resolve, rather than inventing one), so it ships
-- as a migration rather than as a manual dashboard step.
--
-- `on conflict do nothing` so re-running never clobbers wording the
-- client has since edited in the admin.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Divisions
--
-- TWO only. Primebase (hardware & plumbing) is a separate company and
-- is deliberately excluded from this catalogue — confirmed with the
-- client. Do not add it without a new instruction.
-- ---------------------------------------------------------------------
insert into divisions (slug, name, tagline, blurb, sort) values
  ('power-tools-machinery',
   'Power Tools & Machinery',
   'Equipping Sri Lanka to build.',
   'Power tools, air compressors, welding plants, cutting and grinding wheels and high-pressure equipment, supplied to builders, workshops and the hardware trade.',
   1),
  ('water-pumps',
   'Water Pumps',
   'Pumping life into every drop.',
   'Engine, electric and tube-well water pumps, together with sprayers and agricultural equipment, distributed to farming, construction and domestic customers.',
   2)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Brands
--
-- Every one of these is a THIRD-PARTY brand that Bestech is the
-- authorised seller for in Sri Lanka — Bestech does not own them.
-- HUGO (power tools, carried since 2000) and HUGO MAX (which makes the
-- water pumps) are separate brands in their own right, not tiers of one
-- another; they are flagged flagship only so they sort first.
--
-- Deliberately NOT seeded:
--   * Smartec/Smartech — appeared in old marketing copy, the client does
--     not recognise it. Left out until confirmed.
-- Spelling still unconfirmed:
--   * MAK — the old site writes it "Mack". Seeded as MAK; change here
--     (in a NEW migration) once the client rules.
-- ---------------------------------------------------------------------
insert into brands (slug, name, is_flagship, sort) values
  ('hugo',      'HUGO',       true,  1),
  ('hugo-max',  'HUGO MAX',   true,  2),
  ('greaves',   'Greaves',    false, 10),
  ('taifu',     'Taifu',      false, 11),
  ('lutian',    'Lutian',     false, 12),
  ('mak',       'MAK',        false, 13),
  ('dki',       'DKI',        false, 14),
  ('force',     'Force',      false, 15),
  ('sumo',      'Sumo',       false, 16),
  ('lika',      'Lika',       false, 17),
  ('labacha',   'Labacha',    false, 18),
  ('macorient', 'Macorient',  false, 19),
  ('piranha',   'Piranha',    false, 20),
  ('intec',     'Intec',      false, 21),
  ('woolf-flex','Woolf Flex', false, 22),
  ('top-flex',  'Top Flex',   false, 23),
  ('boada',     'Boada',      false, 24),
  ('asaki',     'Asaki',      false, 25)
on conflict (slug) do nothing;

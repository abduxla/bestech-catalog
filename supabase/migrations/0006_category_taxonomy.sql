-- =====================================================================
-- Bestech catalogue — 0006
--
-- The category tree, and a uniqueness bug in 0001.
--
-- WHY NOW, before the client's catalogue has arrived: the importer
-- deliberately refuses to create categories as a side effect of
-- importing a product — guessing a taxonomy from a spreadsheet is how
-- you end up with "Drills", "drills" and "Drill" as three siblings. So
-- until a tree exists, NO product file can be imported at all. This is
-- required work, not a guess at decoration.
--
-- The shape follows how the trade actually shops: by tool type first
-- (dewalt.com), not by brand. A buyer wants a 13mm impact drill and
-- does not care who made it until they are comparing two.
--
-- It is a STARTING POINT, not a decision. Every name here is editable
-- in the admin, and the real catalogue will add and rename branches.
-- Renames are safe: the path trigger from 0001 cascades to children,
-- and 0003 records a redirect for every moved URL automatically.
-- =====================================================================


-- ---------------------------------------------------------------------
-- First, a real bug in 0001.
--
-- `unique (parent_id, slug)` does NOT constrain top-level categories,
-- because in standard SQL two NULLs are not equal — so any number of
-- root categories could share a slug. Since a root category's `path`
-- IS its slug, that means two categories resolving to the same URL,
-- and a build where one silently overwrites the other's page.
--
-- `path` is the thing that must actually be unique: it is what the URL
-- is built from. Constrain that directly and both cases are covered.
-- ---------------------------------------------------------------------
create unique index categories_path_unique on categories (path);


-- ---------------------------------------------------------------------
-- Top level
--
-- path and depth are NOT set here. The trigger from 0001 derives them
-- from the parent chain, so they can never drift from parent_id.
-- ---------------------------------------------------------------------
insert into categories (division_id, parent_id, slug, name, sort)
select d.id, null, v.slug, v.name, v.sort
from (values
  ('drills',            'Drills',                     10),
  ('grinders',          'Grinders',                   20),
  ('saws',              'Saws',                       30),
  ('sanders-polishers', 'Sanders & Polishers',        40),
  ('planers-routers',   'Planers & Routers',          50),
  ('demolition',        'Demolition & Breakers',      60),
  ('welding',           'Welding & Cutting',          70),
  ('air-tools',         'Air Tools & Compressors',    80),
  ('generators',        'Generators',                 90),
  ('concrete',          'Concrete & Masonry',        100),
  ('garden',            'Garden & Outdoor',          110),
  ('cleaning',          'Cleaning Equipment',        120),
  ('measuring',         'Measuring & Levelling',     130),
  ('workshop',          'Workshop Machinery',        140),
  ('accessories',       'Accessories & Consumables', 150)
) as v(slug, name, sort)
cross join divisions d
where d.slug = 'power-tools-machinery'
on conflict do nothing;

insert into categories (division_id, parent_id, slug, name, sort)
select d.id, null, v.slug, v.name, v.sort
from (values
  ('surface-pumps',     'Surface Pumps',              10),
  ('submersible-pumps', 'Submersible Pumps',          20),
  ('pressure-systems',  'Pressure Systems',           30),
  ('agricultural',      'Agricultural & Irrigation',  40),
  ('pump-accessories',  'Pump Accessories',           50)
) as v(slug, name, sort)
cross join divisions d
where d.slug = 'water-pumps'
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Second level
--
-- Joined on the parent's `path`, which for a root category is just its
-- slug. The child inherits its parent's division, so a branch can
-- never straddle two divisions.
-- ---------------------------------------------------------------------
insert into categories (division_id, parent_id, slug, name, sort)
select p.division_id, p.id, v.slug, v.name, v.sort
from (values
  -- Drills
  ('drills', 'impact-drills',        'Impact Drills',            10),
  ('drills', 'rotary-hammers',       'Rotary Hammers',           20),
  ('drills', 'cordless-drills',      'Cordless Drills',          30),
  ('drills', 'core-drills',          'Core Drills',              40),
  ('drills', 'magnetic-drills',      'Magnetic Drills',          50),
  ('drills', 'screwdrivers',         'Screwdrivers & Drivers',   60),

  -- Grinders
  ('grinders', 'angle-grinders',     'Angle Grinders',           10),
  ('grinders', 'bench-grinders',     'Bench Grinders',           20),
  ('grinders', 'die-grinders',       'Die Grinders',             30),
  ('grinders', 'wall-chasers',       'Wall Chasers',             40),

  -- Saws
  ('saws', 'circular-saws',          'Circular Saws',            10),
  ('saws', 'mitre-saws',             'Mitre Saws',               20),
  ('saws', 'jigsaws',                'Jigsaws',                  30),
  ('saws', 'reciprocating-saws',     'Reciprocating Saws',       40),
  ('saws', 'cut-off-saws',           'Cut-off Saws',             50),
  ('saws', 'table-saws',             'Table Saws',               60),
  ('saws', 'band-saws',              'Band Saws',                70),
  ('saws', 'chop-saws',              'Chop Saws',                80),

  -- Sanders & polishers
  ('sanders-polishers', 'orbital-sanders', 'Orbital Sanders',    10),
  ('sanders-polishers', 'belt-sanders',    'Belt Sanders',       20),
  ('sanders-polishers', 'polishers',       'Polishers & Buffers',30),

  -- Planers & routers
  ('planers-routers', 'planers',       'Planers',                10),
  ('planers-routers', 'routers',       'Routers & Trimmers',     20),

  -- Demolition
  ('demolition', 'demolition-hammers', 'Demolition Hammers',     10),
  ('demolition', 'breakers',           'Road Breakers',          20),
  ('demolition', 'chipping-hammers',   'Chipping Hammers',       30),

  -- Welding & cutting
  ('welding', 'arc-welders',          'Arc / MMA Welders',       10),
  ('welding', 'mig-welders',          'MIG Welders',             20),
  ('welding', 'tig-welders',          'TIG Welders',             30),
  ('welding', 'plasma-cutters',       'Plasma Cutters',          40),
  ('welding', 'welding-accessories',  'Welding Accessories',     50),

  -- Air
  ('air-tools', 'air-compressors',    'Air Compressors',         10),
  ('air-tools', 'impact-wrenches',    'Impact Wrenches',         20),
  ('air-tools', 'spray-guns',         'Spray Guns',              30),
  ('air-tools', 'air-accessories',    'Air Accessories',         40),

  -- Generators
  ('generators', 'petrol-generators', 'Petrol Generators',       10),
  ('generators', 'diesel-generators', 'Diesel Generators',       20),
  ('generators', 'inverter-generators','Inverter Generators',    30),

  -- Concrete
  ('concrete', 'concrete-mixers',     'Concrete Mixers',         10),
  ('concrete', 'concrete-vibrators',  'Concrete Vibrators',      20),
  ('concrete', 'tile-cutters',        'Tile Cutters',            30),
  ('concrete', 'floor-equipment',     'Floor Grinders & Trowels',40),

  -- Garden
  ('garden', 'brush-cutters',         'Brush Cutters',           10),
  ('garden', 'lawn-mowers',           'Lawn Mowers',             20),
  ('garden', 'chainsaws',             'Chainsaws',               30),
  ('garden', 'hedge-trimmers',        'Hedge Trimmers',          40),
  ('garden', 'earth-augers',          'Earth Augers',            50),

  -- Cleaning
  ('cleaning', 'pressure-washers',    'Pressure Washers',        10),
  ('cleaning', 'vacuum-cleaners',     'Vacuum Cleaners',         20),

  -- Measuring
  ('measuring', 'laser-levels',       'Laser Levels',            10),
  ('measuring', 'measuring-tools',    'Measuring Tools',         20),
  ('measuring', 'detectors',          'Detectors',               30),

  -- Workshop
  ('workshop', 'pillar-drills',       'Pillar Drills',           10),
  ('workshop', 'lathes',              'Lathes',                  20),
  ('workshop', 'bench-machinery',     'Bench Machinery',         30),

  -- Accessories
  ('accessories', 'drill-bits',       'Drill Bits',              10),
  ('accessories', 'cutting-discs',    'Cutting & Grinding Discs',20),
  ('accessories', 'saw-blades',       'Saw Blades',              30),
  ('accessories', 'batteries',        'Batteries & Chargers',    40),

  -- Water pumps
  ('surface-pumps', 'jet-pumps',          'Self-Priming Jet Pumps', 10),
  ('surface-pumps', 'centrifugal-pumps',  'Centrifugal Pumps',      20),
  ('surface-pumps', 'peripheral-pumps',   'Peripheral Pumps',       30),
  ('surface-pumps', 'multistage-pumps',   'Multistage Pumps',       40),

  ('submersible-pumps', 'borehole-pumps', 'Borehole / Deep Well',   10),
  ('submersible-pumps', 'drainage-pumps', 'Drainage Pumps',         20),
  ('submersible-pumps', 'sewage-pumps',   'Sewage Pumps',           30),
  ('submersible-pumps', 'well-pumps',     'Shallow Well Pumps',     40),

  ('pressure-systems', 'booster-pumps',   'Booster Pumps',          10),
  ('pressure-systems', 'pressure-tanks',  'Pressure Tanks',         20),
  ('pressure-systems', 'controllers',     'Pump Controllers',       30),

  ('agricultural', 'engine-pumps',        'Engine Driven Pumps',    10),
  ('agricultural', 'irrigation-pumps',    'Irrigation Pumps',       20),
  ('agricultural', 'sprayers',            'Sprayers',               30),

  ('pump-accessories', 'control-boxes',   'Control Boxes',          10),
  ('pump-accessories', 'foot-valves',     'Foot Valves & Fittings', 20),
  ('pump-accessories', 'pipes',           'Pipes & Hoses',          30)
) as v(parent, slug, name, sort)
join categories p on p.path = v.parent
on conflict do nothing;

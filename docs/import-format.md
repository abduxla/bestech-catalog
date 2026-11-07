# Catalogue import — the contract

The client's catalogue file has not arrived yet, and its format is genuinely
unknown (Excel, CSV, a supplier export, or a PDF price list are all live
possibilities). So the importer is deliberately split in two at a **frozen
internal format**, and only the half that cannot change is built now.

```
   client's file                 canonical                  database
  (xlsx / csv / pdf)  ──▶  catalogue.jsonl  ──▶  validate → dry-run → upsert
   ╰── STAGE 1 ──╯              (frozen)          ╰────────── STAGE 2 ──────────╯
   written in an afternoon                        ~90% of the code, 100% of the risk
   once the file exists,                          built and tested NOW against the
   thrown away after                              fixtures, before the file exists
```

Stage 2 does not contain one line that depends on the source file's shape.
When the catalogue arrives, only the small disposable adapter is written.

---

## The canonical format

**JSON Lines** — one JSON object per line, UTF-8. One object = one product.
**Every value is a string** (units live in their own field, so nothing has to
be numeric to be stored or displayed, and "0-1300" or "Φ10" survive intact).

```json
{"sku":"DB-100L","name":"HUGO Air Compressor DB-100L","brand":"HUGO","division":"power-tools-machinery","category_path":"Power Tools & Machinery > Air Compressors > Belt Type","summary":"100-litre belt-type air compressor, 8 bar, 2.5 hp.","description":"A durable 100-litre belt type air compressor…","status":"published","specs":[{"title":null,"caption":null,"rows":[{"label":"Power","unit":"HP","value":"2.5"},{"label":"Power","unit":"Kw","value":"1.8"}]}]}
```

### Fields

| field | required | notes |
|---|---|---|
| `sku` | **yes** | The client's own model number. **The only import key.** Must be unique across the file. A row without one is rejected — never auto-assigned. |
| `name` | **yes** | Full display name, e.g. `HUGO Air Compressor DB-100L`. |
| `brand` | no | Brand name or slug. Must already exist, or the row is rejected. |
| `division` | no | Division slug. Must already exist. |
| `category_path` | no | ` > `-separated, from division down to leaf. Must resolve to an existing category, or the row is rejected. |
| `summary` | no | One line, used on cards. |
| `description` | no | Prose body. May be the entire content — specs are optional. |
| `status` | no | `draft` \| `published` \| `archived`. Defaults to `draft`, so an import can never silently publish. |
| `specs` | no | Array of sections (below). Omit or `[]` for a prose-only product. |

Images are **not** part of the import. They are uploaded through the admin and
attached per product, because the client photographs the products themselves.

### `specs` — array of sections

```json
"specs": [
  { "title": null, "caption": null,
    "rows": [ {"label":"Power","unit":"HP","value":"2.5"} ] }
]
```

Rules, each of which exists because breaking it has a specific failure:

- `specs` is an **array**, never an object keyed by label. Postgres `jsonb`
  sorts keys and drops duplicates, which would reorder the table *and* merge
  the two `Power` rows (HP and Kw) in the client's own compressor into one.
- Each row is **one self-contained object**. Never three parallel arrays of
  labels / units / values — that is exactly the positional coupling that
  mis-flagged variants on the previous project.
- **Array order is the only order authority.** Do not add a `position` field;
  two authorities can disagree.
- `unit` may be `""`. `title` and `caption` may be `null`.
- Multiple sections are supported because real catalogues need them: dbl.lk's
  welding plant has a main table, a caption, then a second table.

---

## Stage 2 rules

These are the behaviours that stop an importer destroying a catalogue.

1. **Dry run is the default, not a flag.** Every run first reports
   `12 create · 238 update · 4 absent · 6 rejected` with a field-level diff of
   a sample. Writing requires explicit confirmation. An importer whose default
   mode mutates data is how 250 hand-written descriptions die at once.
2. **Absence is never destructive.** Products missing from the file are
   *reported*, never deleted or auto-archived. The client will send partial
   files — one brand, one division — because that is how distributors send
   updates. Archiving stays a deliberate, separate action.
3. **Match on `sku` only.** `on conflict (sku) do update`. Never match on name:
   the client edits "HUGO 13mm Impact Drill" to "HUGO Impact Drill 13mm" and a
   name-matcher silently creates a duplicate.
4. **Reject, don't guess.** Unknown brand or unresolvable category path →
   the row goes to the error report. The importer never invents a brand or
   creates a category as a side effect.
5. **One bad row never stops the file.** Rejects are collected and reported;
   the good rows still import.
6. **`status` defaults to `draft`.** An import cannot silently publish 250
   products to a live site.

## Fixtures

`import/fixtures/` is the test suite, hand-written before any real file exists:

- `valid.jsonl` — three products covering the three real shapes: a normal spec
  table *with a duplicated label across two units*, a two-section table with a
  caption, and a prose-only product with no specs at all.
- `broken.jsonl` — nine rows that must each be rejected with a useful message
  and must not stop the others: missing sku, blank sku, duplicate sku, missing
  name, specs as an object, a row missing its label, unknown brand, unknown
  category.

Stage 2 is finished when it is green against both.

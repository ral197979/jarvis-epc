# Commissioning Export Bundle — Format & Ingest Guide

Phase C of the commissioning extraction (see `COMMISSIONING_EXTRACTION_PLAN.md`).
Denver produces a **portable, read-only bundle** of commissioning-execution data.
The future Commissioning repo ingests it. **Denver is never mutated and nothing
is deleted** by the export.

## Producing the bundle (in Denver)

```bash
# Full migration (all tenants):
tsx api/scripts/cxExportRun.ts --out=./cx-export-bundle
# or via npm:
npm run cx:export -- --out=./cx-export-bundle

# Scoped to one tenant / project:
npm run cx:export -- --tenant=<uuid> --project=<uuid> --out=./bundle-acme

# Deterministic manifest timestamp (CI / reproducible runs):
npm run cx:export -- --tenant=<uuid> --now=2026-06-25T00:00:00.000Z
```

`DATABASE_URL` must be set. The export reads via the admin pool and scopes every
query with an explicit `WHERE` (tenant/project), so a scoped run never leaks other
tenants' rows. Exit code `2` means parity failed — inspect `parity_report.json`.

## Bundle layout

```
cx-export-bundle/
├── manifest.json              # what's in the bundle (see below)
├── parity_report.json         # integrity check (see below)
├── test_packs.ndjson
├── test_results.ndjson
├── deficiencies.ndjson
├── ncrs.ndjson
├── corrective_actions.ndjson
├── punch_lists.ndjson
├── punch_items.ndjson
├── commissioning_baselines.ndjson
└── commissioning_observations.ndjson
```

Each `.ndjson` file is one JSON object per line — a **verbatim row** including all
audit fields (`created_by`, `updated_by`, `created_at`, `updated_at`, `closed_by`,
`verified_by`, `performed_by`, `witnessed_by`, …) and the **original UUID `id`**.
Keys are emitted in stable (sorted) order and timestamps as ISO-8601 UTC, so the
files are byte-identical across re-runs of the same DB state (idempotent).

### `manifest.json`
- `schemaVersion` — bundle format version (`denver-epc-cx/1.0.0`).
- `exportedAt` — ISO timestamp (the only non-deterministic field).
- `scope` — `{ org, tenant, project }` (org == tenant in Denver).
- `tables[]` — per table: `table`, `file`, `sourceMigration`, `rowCount`,
  `checksum` (sha256 of the NDJSON file), and `foreignKeys`:
  - `inBundle` — FKs whose target table is also in this bundle.
  - `external` — FKs whose target lives **outside** the bundle (Denver-owned:
    `systems`, `subsystems`, `tags`, `commissioning_items`, `drawings`, `users`,
    `commissioning_packs`, `commissioning_autosign_rules`).
- `totals` — `{ tables, rows }`.

### `parity_report.json`
- Per table: `expectedRows` (independent `COUNT(*)`), `exportedRows` (lines
  written), `rowsOk`, `checksum`, `checksumOk` (disk round-trip), `orphans`
  (in-bundle child rows whose parent id is absent), `missingReferences`
  (non-null external FK counts to resolve on ingest), `warnings`.
- Top level: `ok` (all checks passed) and aggregated `warnings`.

## Foreign-key relationships

In-bundle (must resolve **within** the bundle):
- `test_results.test_pack_id` → `test_packs`
- `deficiencies.test_pack_id` → `test_packs`, `deficiencies.test_result_id` → `test_results`
- `corrective_actions.ncr_id` → `ncrs`
- `punch_items.punch_list_id` → `punch_lists`
- `commissioning_observations.baseline_id` → `commissioning_baselines`

External (Denver-owned — the Commissioning repo must **map or reference**, not
import): `systems`, `subsystems`, `tags`, `commissioning_items`, `drawings`,
`users`, `commissioning_packs`, `commissioning_autosign_rules`, `projects`,
`tenants`. These appear in `missingReferences`; they are expected and not errors.

## Recommended ingest procedure (future Commissioning repo)

1. **Verify before import.** Recompute each file's sha256 and compare to
   `manifest.tables[].checksum`; count lines and compare to `rowCount`. Refuse
   ingest if `parity_report.json.ok` is `false` (or re-export from Denver first).
2. **Preserve IDs.** Insert rows with their original `id` UUIDs so cross-bundle
   FKs (and Denver's references back via the status mirror) keep resolving. Do
   **not** regenerate primary keys.
3. **Load parents before children** — same order as the file list above. Wrap each
   table in a transaction; abort on any in-bundle FK miss (should be zero given a
   passing parity report).
4. **Map external references.** For each `missingReferences` entry, either (a) keep
   the UUID as an opaque reference back to Denver, or (b) resolve it against a
   Denver-provided mapping (e.g. tag/system registry sync). Never fabricate rows
   for external targets.
5. **Keep audit fields verbatim.** Carry `created_at/by`, `updated_at/by`, and all
   actor/timestamp columns unchanged for traceability.
6. **Idempotent ingest.** Upsert on `id` (`ON CONFLICT (id) DO NOTHING`/`DO UPDATE`)
   so re-running an ingest does not duplicate rows.
7. **Record provenance.** Persist `manifest.schemaVersion`, `exportedAt`, and
   `scope` alongside the imported data for later reconciliation.

## What this bundle is NOT

- Not a deletion or cutover — Denver execution routes/tables remain live (removed
  later, Phase E, only after ingest is verified).
- Not a live API transfer — it is a file bundle, ingested out-of-band.
- Not a schema migration for Commissioning — the target repo owns its own schema
  and maps these rows into it.

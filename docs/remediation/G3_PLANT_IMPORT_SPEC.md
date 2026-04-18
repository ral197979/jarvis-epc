# G3 — Plant-Engineering File Import Spec

**Gap class:** LAG (integrate-don't-build)
**Release slot:** v4.32.0
**Competitive reference:** AVEVA, Hexagon SmartPlant, Bentley OpenPlant own native plant engineering — we don't compete on their turf
**Status:** DRAFT — awaiting owner approval

---

## Explicit non-build posture

JARVIS EPC will **not** build:
- Native P&ID editor
- Native 3D piping model editor
- Stress analysis
- Electrical single-line diagram editor

These remain the domain of AVEVA, Hexagon, and Bentley. JARVIS EPC consumes their outputs via file-based handover.

---

## Target end-state

Owner can import:
1. Tag lists (instruments, equipment, lines)
2. Equipment schedules (motors, pumps, vessels)
3. Line lists (with from/to, service, size, spec)
4. P&ID metadata (PID number, revision, drawing file reference)

Imports are dry-run-first, then committed. Imported counts surface in `EngineeringView.tsx` with filter by source system and revision.

---

## Canonical schema — `PlantDataImport`

TypeScript-equivalent interface for docs only:

```typescript
interface PlantDataImportPayload {
  source: 'aveva' | 'hexagon' | 'bentley' | 'generic-csv';
  project_id: string;          // UUID of target project
  revision: string;             // "Rev-A", "IFC", "AFC", etc.
  revision_date: string;        // ISO date
  items: PlantItem[];
}

interface PlantItem {
  tag: string;                  // primary identifier, unique per project+revision
  item_type: 'instrument' | 'equipment' | 'line' | 'valve' | 'fitting';
  unit?: string;                // process unit / area code
  service?: string;             // process service (e.g., "Steam HP")
  line_size?: string;           // "6in", "150mm"
  line_class?: string;          // material / rating spec
  from_ref?: string;            // source equipment tag or node
  to_ref?: string;              // destination tag or node
  pid_ref?: string;             // drawing number this item appears on
  source_system_id?: string;    // GUID in source system
  manufacturer?: string;
  model?: string;
  quantity?: number;
  uom?: string;                 // unit of measure ("EA", "m", "kg")
  metadata?: Record<string, string>;  // open-ended for source-specific fields
}
```

---

## Source-format mapping

### AVEVA (E3D / SmartPlant P&ID export)

AVEVA exports via their Report module as tab-separated or Excel. Typical column names:

| AVEVA column | Maps to |
|---|---|
| `TAG` or `ITEM_TAG` | `tag` |
| `TYPE` | `item_type` (requires normalization) |
| `AREA` | `unit` |
| `SERVICE` | `service` |
| `NOMINAL_BORE` | `line_size` |
| `LINE_CLASS` | `line_class` |
| `FROM_NODE` | `from_ref` |
| `TO_NODE` | `to_ref` |
| `DRAWING` | `pid_ref` |
| `OBID` | `source_system_id` (AVEVA object ID) |

### Hexagon (SmartPlant P&ID + SmartPlant Instrumentation)

Typical SmartPlant report export (CSV, UTF-16 encoded):

| SmartPlant column | Maps to |
|---|---|
| `Name` | `tag` |
| `ItemType` | `item_type` |
| `Plant Area` | `unit` |
| `Service` | `service` |
| `Nominal Diameter` | `line_size` |
| `Pipeline Spec` | `line_class` |
| `SourceTag` | `from_ref` |
| `DestinationTag` | `to_ref` |
| `PID` | `pid_ref` |
| `SP_OID` | `source_system_id` |

Note: SmartPlant CSV exports are commonly UTF-16; importer must detect encoding.

### Bentley (OpenPlant / ProjectWise export)

Bentley exports as either TSV or `.xlsx`:

| Bentley column | Maps to |
|---|---|
| `TagNumber` | `tag` |
| `ClassName` | `item_type` |
| `Area` | `unit` |
| `MediumService` | `service` |
| `NominalDiameter` | `line_size` |
| `PipingSpec` | `line_class` |
| `UpstreamTag` | `from_ref` |
| `DownstreamTag` | `to_ref` |
| `PIDNumber` | `pid_ref` |
| `BentleyGUID` | `source_system_id` |

### Generic CSV (escape hatch)

Accepts any CSV with at minimum `tag` and `item_type` columns. All other fields optional. Any unrecognized column stored in `metadata`.

---

## API surface

New file: `api/routes/plant.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/import/plant/dry-run` | pm+ | Parses file, returns validation report (counts, errors, duplicates) — no DB writes |
| `POST` | `/api/v1/import/plant/commit` | pm+ | Commits a previously dry-run batch by its token; transactional |
| `GET` | `/api/v1/import/plant/history` | user | Lists prior imports for tenant with counts, source, revision |
| `GET` | `/api/v1/plant/items` | user | Browse imported items with filters (project, unit, revision, item_type) |

Request/response formats and idempotency keys follow existing `api/routes/files.ts` patterns.

---

## Database schema (migration 006)

File: `api/db/migrations/006_plant.sql`

```sql
CREATE TABLE plant_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  source TEXT NOT NULL CHECK (source IN ('aveva','hexagon','bentley','generic-csv')),
  revision TEXT NOT NULL,
  revision_date DATE,
  source_filename TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID NOT NULL REFERENCES users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX plant_imports_project ON plant_imports(project_id, revision);

CREATE TABLE plant_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  import_id UUID NOT NULL REFERENCES plant_imports(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id),
  tag TEXT NOT NULL,
  item_type TEXT NOT NULL,
  unit TEXT, service TEXT, line_size TEXT, line_class TEXT,
  from_ref TEXT, to_ref TEXT, pid_ref TEXT,
  source_system_id TEXT,
  manufacturer TEXT, model TEXT, quantity NUMERIC, uom TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(project_id, tag, import_id)
);
CREATE INDEX plant_items_tag ON plant_items(project_id, tag);
CREATE INDEX plant_items_type ON plant_items(project_id, item_type);

ALTER TABLE plant_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_plant_imports ON plant_imports
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_plant_items ON plant_items
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## Dry-run validation rules

| Rule | Severity | Action |
|---|---|---|
| Missing required column `tag` | Error | Reject file |
| Duplicate `tag` within single import | Error | Surface line numbers |
| `tag` already exists in prior revision | Warning | Flag as potential update; owner decides |
| Unknown `item_type` value | Warning | Normalize to `generic`; log mapping gap |
| File > 50 MB | Error | Reject; suggest split |
| Item count > 50,000 | Warning | Require owner confirm |
| Encoding detection (UTF-16 for SmartPlant) | Info | Auto-detect; log detected encoding |

---

## Frontend changes

### `src/components/EngineeringView.tsx` — add Handover section

New panel below existing content:

- Summary counts by source system (AVEVA: 12,480 tags · Hexagon: 3,201 · Bentley: 0)
- "Import Handover Package" button → upload modal
- Revision selector dropdown (per project)
- Item browser (table with filters: unit, type, line class)
- Export back to CSV for downstream tools

### New component: `src/components/PlantImportModal.tsx`

- Two-step wizard: Upload → Review dry-run report → Commit
- Shows line-level errors + warnings
- Owner can proceed to commit only if zero errors

---

## Acceptance criteria

- [ ] Upload a 500-row AVEVA export sample → dry-run succeeds → commit succeeds
- [ ] Upload a SmartPlant UTF-16 CSV → encoding detected → import succeeds
- [ ] Upload a Bentley `.xlsx` → sheet detected → import succeeds
- [ ] Upload a file missing `tag` column → dry-run surfaces error, commit is impossible
- [ ] RLS test: tenant A cannot see tenant B's `plant_items`
- [ ] Re-import same file → duplicates flagged as warnings, not silent overwrites
- [ ] `EngineeringView` shows imported counts by source, filtered by revision
- [ ] E2E test `plant-import.spec.ts` passes
- [ ] `CHANGELOG.md` v4.32.0 entry

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Source systems change column names between versions | Medium | Mappings are externalized as JSON config in `api/services/plant/mappings.ts`; version-tagged |
| Very large imports lock the database | Medium | Batch insert in 1,000-row chunks inside transaction; progress reported to client |
| Encoding detection false positive | Low | Show detected encoding to user, allow override |

---

## Effort estimate

| Slice | Days |
|---|---|
| Migration 006 + routes + dry-run parser | 1.5 |
| Mapping adapters (AVEVA, Hexagon, Bentley) | 1 |
| EngineeringView handover section + import modal | 0.5 |
| **Total** | **3 days** |

---

## Owner approval

- [ ] **Approved** — explicit non-build posture for plant engineering; proceed with file import only
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — revisit build-vs-buy stance
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________

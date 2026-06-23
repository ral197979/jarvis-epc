# Document Control Specification — Phase 2

**Denver Engineering — the AI-native project operating system**
*Goal: surpass Aconex on controlled document management by adding an AI layer that understands, predicts, and decides — not just stores.*

**Status legend:** ✅ shipped & wired · 🟡 partial / shell · ❌ not built · ⚠️ caveat

**Sibling specs:** [AI_PROJECT_INTELLIGENCE_SPEC.md](./AI_PROJECT_INTELLIGENCE_SPEC.md) · [MOBILE_FIELD_EXECUTION_SPEC.md](./MOBILE_FIELD_EXECUTION_SPEC.md) · [COST_CONTROL_SPEC.md](./COST_CONTROL_SPEC.md) · [PROCUREMENT_SPEC.md](./PROCUREMENT_SPEC.md) · [INTEGRATION_MARKETPLACE_SPEC.md](./INTEGRATION_MARKETPLACE_SPEC.md) · [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md) · [FEATURES.md](./FEATURES.md) · [APP_OVERVIEW.md](./APP_OVERVIEW.md)

---

## 1. Positioning & Thesis

Aconex won the controlled-document market by being the neutral, audit-grade system of record: every transmittal numbered, every revision superseded, every distribution logged. It is excellent at *storing and tracking* documents. It does not *read* them.

Denver Engineering already has the system-of-record primitives (drawings register, revisions, markups, BIM/IFC coordination, formal transmittals, a versioned document library with hybrid lexical + vector search, and **real** ISA-5.1 P&ID/PFD drawing generation). Phase 2 closes the classic Aconex-parity gaps (superseded sets, distribution lists, controlled copies, version compare/overlay) **and** adds two AI layers that no incumbent has:

- **AI Drawing Intelligence** — vision/OCR over sheets to auto-identify equipment, tags, rooms, and systems, then **link them into the object graph** (extending the existing `bim_element_links` / `evidence_links` polymorphic pattern) so a tag on a drawing becomes a queryable, trackable object.
- **Spec Intelligence** — NLP over specification sections to extract equipment and their testing/submittal/closeout requirements, then **auto-generate the submittal register and commissioning checklists**.

The result: the document set stops being a filing cabinet and becomes a structured, predictive model of what the project requires.

---

## 2. Current State (with evidence)

### 2.1 Drawings register, revisions, markups — ✅
**Route:** `api/routes/drawings.ts` · **Tables:** `drawings`, `drawing_revisions`, `drawing_markups` (migration `007_pm_modules.sql`).

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/projects/:projectId/drawings` | GET / POST | List (filter `discipline`, `set_name`), create. `UNIQUE(tenant_id, project_id, sheet_number, current_rev)` |
| `/api/v1/drawings/:id` | GET / PATCH / DELETE | CRUD |
| `/api/v1/drawings/:id/revisions` | GET / POST | Creating a revision bumps `drawings.current_rev` and copies `document_id`. `UNIQUE(drawing_id, rev)` |
| `/api/v1/drawings/:id/markups` | GET / POST | Annotations stored as `JSONB[]`; filter by `rev`, `resolved` |
| `/api/v1/markups/:markupId` | PATCH / DELETE | Resolving stamps `resolved_by` + `resolved_at` |

`drawings`: `id, tenant_id, project_id, sheet_number, title, discipline, current_rev (default 'A'), set_name, issue_date, document_id→documents, scale, page_count, metadata, created_by, created_at, updated_at`. Markups have an `idx_drawing_markups_open` partial index on `resolved=FALSE`.

### 2.2 Document library + versions + hybrid search — ✅
**Route:** `api/routes/files.ts` (11 endpoints) · **Tables:** `documents`, `document_versions`, `document_folders`, `upload_tokens` (`003_files.sql`).

- Presigned upload/confirm flow: `POST /files/request-upload` → `PUT /files/upload/:token` → `POST /files/confirm/:versionId`. Multi-backend (`local|s3|gcs|azure`), `checksum_sha256` for dedup/integrity, materialized-path folders (`document_folders.path`), soft delete (`status='deleted'`).
- `document_versions`: `version (INT)`, `storage_*`, `mime_type`, `size_bytes`, `extracted_text` (FTS), `ai_summary`, `change_note`. `UNIQUE(document_id, version)`.

**Semantic search — ✅** `api/services/knowledgeSearch.ts` over `knowledge_chunks` / `knowledge_sources` (`022`, pgvector in `071_pgvector.sql`). Hybrid:
1. Lexical: PostgreSQL `websearch_to_tsquery` + `ts_rank_cd`.
2. Vector: `pgvector` `embedding vector(1536)`, **IVFFlat** index `idx_kc_embedding_cosine` (`lists=100`, `vector_cosine_ops`). Distance→similarity: `sim = max(0, 1 - dist/2)`.
3. Blend: `score = (1-w)·lex_norm + w·semantic`, default `w=0.55`, optional source-tier boost.

### 2.3 BIM / IFC coordination + clash issues — ✅
**Route:** `api/routes/bim.ts` (9 endpoints) · **Worker:** `api/services/bim/ifcParseWorker.ts` · **Tables:** `bim_models`, `bim_elements`, `bim_issues`, `bim_element_links`, `ifc_parse_jobs` (`007`, `050_bim_estimating.sql`).

- `ifcParseWorker.ts` uses `web-ifc` to parse `.ifc` buffers: `parseIfcBuffer()` extracts `ifc_guid`, `ifc_type` (IfcWall/Beam/Column/Door/Space/PipeSegment/DuctSegment/LightFixture…), `centroid`, PropertySet `properties`, BaseQuantity `quantities`; `upsertBimElements()` writes with `UNIQUE(tenant_id, model_id, ifc_guid)`. Job queue `ifc_parse_jobs` polled every 15 s by `startIfcParseWorker()`. ⚠️ Property/quantity extraction only — geometry/render is client-side (APS/Forge viewer token at `/bim-models/:id/viewer-token`).
- `bim_issues` (clash/coordination): `severity (minor|major|critical)`, `status`, `element_ids (JSONB[])`, `viewpoint (JSONB)`. Creating an issue fires an `actions` row (`action_type='BIM_ISSUE'`).
- `bim_element_links`: polymorphic join (`entity_type ∈ action|punch_item|deficiency|evidence`, `entity_id`) — **this is the existing object-graph anchor the AI layers extend.**

### 2.4 Transmittals — ✅
**Route:** `api/routes/transmittals.ts` · **Service:** `api/services/transmittals/transmittalService.ts` · **Tables:** `transmittals`, `transmittal_items`, `transmittal_events`, `transmittal_counters` (`051_geo_links_montecarlo_transmittals.sql`, RLS in `069_rls_transmittal_counters.sql`).

Endpoints: `POST /transmittals`, `GET /transmittals` (filter project/status/purpose/overdue), `GET /transmittals/:id`, `POST /:id/send`, `POST /:id/respond`, `POST /:id/close`, `GET /transmittals/overdue`.

State machine `draft → sent → received → under_review → actioned → closed` (plus `voided`); auto-number `TRN-0001` via `transmittal_counters(tenant_id, project_id, next_seq)`; immutable `transmittal_events` log; response set `{approved, approved_with_comments, revise_and_resubmit, rejected, received, no_exception_taken}`; overdue tracking via `response_due_date`. Items reference `document_id` and/or `evidence_id` with per-item `rev` and `copies`.

### 2.5 P&ID / PFD generation — ✅ (real drawing) / ❌ (no process calc)
**Files:** `public/tools/denver/TRUE-PID-GENERATOR.js`, `UNIVERSAL-PID-GENERATOR.js`, `pid-true.html`, `pid-universal.html`.

These are **real** ISA-5.1 diagram generators: they draw genuine geometry (equipment, valve/actuator symbols, instrument bubbles, control loops, tag counters, title blocks) and export **SVG/DXF** client-side. ⚠️ **Drawing only** — they perform **no process calculations** (no pump TDH, hydraulics, heat balance). Per [FEATURES.md](./FEATURES.md), the discipline "design tools" (WWTP/PWTP/HVAC/stormwater/process) are **front-end shells**; serious math is delegated over MCP (`/api/v1/mcp/execute`) and any in-browser math is placeholder. Do not market these as calculators.

### 2.6 Honest gap summary

| Capability | State |
|---|---|
| Superseded-set management | ❌ — revisions exist per-sheet; no set-level supersede/issue |
| Distribution lists | ❌ — `to_contacts` is ad-hoc JSONB per transmittal; no reusable lists |
| Controlled copies / watermarked issue | ❌ |
| Version compare / overlay (raster + vector diff) | ❌ |
| AI Drawing Intelligence (vision/OCR → object graph) | ❌ |
| Spec Intelligence (extract reqs → submittal register/checklists) | ❌ |

---

## 3. Target Architecture (Phase 2)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Document Control Plane                         │
│                                                                        │
│  Sheets / Sets        Transmittals          Library + Vector Search   │
│  drawings             transmittals          documents/_versions       │
│  drawing_sets ▲NEW    distribution_lists ▲  knowledge_chunks(pgvector) │
│  drawing_revisions    controlled_copies ▲                             │
│  drawing_markups                                                       │
│                                                                        │
│  ── AI Layer 1: Drawing Intelligence ──   ── AI Layer 2: Spec Intel ──│
│  drawing_intelligence_runs ▲              spec_documents ▲            │
│  drawing_detections ▲ (tags/equip/rooms)  spec_sections ▲            │
│   └─► object graph (bim_element_links /   spec_requirements ▲        │
│       doc_object_links ▲)                  └─► submittal_register ▲  │
│                                             └─► commissioning_checklists ▲ │
└──────────────────────────────────────────────────────────────────────┘
        ▲ NEW = built in Phase 2.  All tables tenant-scoped + RLS.
```

Workers reuse the proven `ifc_parse_jobs` / `evidence_processing_jobs` pattern: a polled job table with `status, attempts, max_attempts, run_after, locked_until, locked_by`.

---

## 4. Data Model (new tables)

All tables: `id UUID PK`, `tenant_id UUID NOT NULL` (RLS `USING tenant_id = current_setting('app.tenant_id')::uuid`), `created_by`, `created_at`, `updated_at` unless noted.

### 4.1 Superseded sets & controlled issue
```sql
CREATE TABLE drawing_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  name TEXT NOT NULL,                      -- "IFC Set Rev 3", "Bid Set"
  set_type TEXT NOT NULL,                  -- ifc|bid|permit|as_built|record|coordination
  status TEXT NOT NULL DEFAULT 'draft',    -- draft|issued|superseded|void
  issued_at TIMESTAMPTZ, issued_by UUID,
  superseded_by UUID REFERENCES drawing_sets(id),  -- supersede chain
  revision_label TEXT,                     -- "Rev 3", "Addendum 2"
  notes TEXT, metadata JSONB DEFAULT '{}',
  UNIQUE(tenant_id, project_id, name)
);

CREATE TABLE drawing_set_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  set_id UUID NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES drawings(id),
  rev VARCHAR(20) NOT NULL,                -- snapshot of the rev included in this set
  document_version_id UUID REFERENCES document_versions(id),
  is_current BOOLEAN DEFAULT TRUE,         -- FALSE once a newer set supersedes this member
  UNIQUE(tenant_id, set_id, drawing_id)
);
```
**Superseded rule:** issuing set B that contains a newer rev of a sheet marks the matching member rows in any prior *issued* set `is_current=FALSE` and (if every member superseded) flips the prior set to `superseded`, writing `superseded_by`. A sheet's "current controlled rev" = the `rev` of the newest *issued, non-void* set containing it.

### 4.2 Distribution lists & controlled copies
```sql
CREATE TABLE distribution_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  name TEXT NOT NULL,                      -- "MEP Subs", "Owner + AOR"
  description TEXT, is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(tenant_id, project_id, name)
);
CREATE TABLE distribution_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  list_id UUID NOT NULL REFERENCES distribution_lists(id) ON DELETE CASCADE,
  party_company TEXT, contact_name TEXT, contact_email TEXT,
  user_id UUID,                            -- internal recipients
  role TEXT,                               -- to|cc|fyi
  UNIQUE(tenant_id, list_id, contact_email)
);

-- A controlled copy = a tracked, optionally-watermarked issuance of a set/sheet to a recipient.
CREATE TABLE controlled_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  set_id UUID REFERENCES drawing_sets(id),
  drawing_id UUID REFERENCES drawings(id), rev VARCHAR(20),
  transmittal_id UUID REFERENCES transmittals(id),     -- issuance vehicle
  recipient_company TEXT, recipient_name TEXT, recipient_email TEXT,
  copy_number TEXT,                        -- "C-0007" stamped copy id
  watermark TEXT,                          -- "CONTROLLED COPY — DO NOT SCALE"
  status TEXT DEFAULT 'issued',            -- issued|acknowledged|recalled|superseded
  acknowledged_at TIMESTAMPTZ,
  storage_key TEXT,                        -- the rendered, stamped artifact
  metadata JSONB DEFAULT '{}'
);
```
Transmittals gain an optional `distribution_list_id` (denormalize members into `to_contacts`/`cc_contacts` at send time so the historical record is immutable even if the list later changes).

### 4.3 Version compare / overlay
```sql
CREATE TABLE drawing_compares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  drawing_id UUID NOT NULL REFERENCES drawings(id),
  base_rev VARCHAR(20) NOT NULL, target_rev VARCHAR(20) NOT NULL,
  page INTEGER DEFAULT 1,
  mode TEXT NOT NULL,                      -- raster_diff|vector_diff|overlay
  status TEXT DEFAULT 'pending',           -- pending|running|done|failed
  result JSONB,                            -- {changed_regions:[{bbox,kind}], added, removed, moved}
  overlay_key TEXT,                        -- rendered overlay image (added=green, removed=red)
  attempts INT DEFAULT 0, max_attempts INT DEFAULT 3,
  run_after TIMESTAMPTZ DEFAULT now(), locked_until TIMESTAMPTZ, locked_by TEXT,
  error TEXT
);
```
Raster diff (rasterize both revs at a fixed DPI, structural/SSIM region diff) ships first; vector diff (PDF content-stream / DXF entity diff) is a follow-on. Changed regions feed AI Drawing Intelligence to flag "this tag moved/was added between Rev B and Rev C".

### 4.4 AI Layer 1 — Drawing Intelligence (object graph)
```sql
CREATE TABLE drawing_intelligence_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  drawing_id UUID NOT NULL REFERENCES drawings(id), rev VARCHAR(20) NOT NULL,
  document_version_id UUID REFERENCES document_versions(id),
  status TEXT DEFAULT 'pending',           -- pending|running|done|failed (job-queue cols below)
  model TEXT,                              -- vision+OCR pipeline id
  page_count INT, detection_count INT,
  attempts INT DEFAULT 0, max_attempts INT DEFAULT 3,
  run_after TIMESTAMPTZ DEFAULT now(), locked_until TIMESTAMPTZ, locked_by TEXT,
  error TEXT, summary JSONB,
  UNIQUE(tenant_id, drawing_id, rev)
);
CREATE TABLE drawing_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES drawing_intelligence_runs(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL, rev VARCHAR(20) NOT NULL, page INTEGER DEFAULT 1,
  detection_type TEXT NOT NULL,            -- equipment|tag|room|system|note|dimension|callout
  label TEXT,                              -- "AHU-3", "P-101", "ELEC ROOM 214", "CHW SUPPLY"
  normalized_tag TEXT,                     -- canonicalized: "AHU-003"
  bbox JSONB NOT NULL,                     -- {x,y,w,h} normalized page coords (0..1)
  ocr_text TEXT, confidence NUMERIC(4,3),
  -- object-graph link (mirrors bim_element_links pattern)
  linked_entity_type TEXT,                 -- bim_element|asset|system|equipment|space
  linked_entity_id UUID,
  link_status TEXT DEFAULT 'unlinked',     -- unlinked|auto_linked|confirmed|rejected
  linked_by UUID, linked_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX idx_det_tag ON drawing_detections(tenant_id, normalized_tag);
CREATE INDEX idx_det_unlinked ON drawing_detections(tenant_id, link_status) WHERE link_status='unlinked';

-- Generic doc↔object link so any detection/spec requirement can anchor to the graph
CREATE TABLE doc_object_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL,               -- drawing_detection|spec_requirement
  source_id UUID NOT NULL,
  object_type TEXT NOT NULL,               -- bim_element|asset|system|equipment|space|drawing
  object_id UUID NOT NULL,
  relation TEXT NOT NULL,                  -- depicts|requires|located_in|serves
  confidence NUMERIC(4,3), confirmed BOOLEAN DEFAULT FALSE,
  UNIQUE(tenant_id, source_type, source_id, object_type, object_id, relation)
);
```
**Auto-link logic:** `normalized_tag` is matched against existing `bim_elements.name`, `assets`, and `systems` for the project. Exact match → `auto_linked` (confidence ≥ 0.9). Fuzzy/vision-only → surfaced for human confirm. Confirmed links write `doc_object_links` (and `bim_element_links` when the object is a BIM element), making "show me every drawing that depicts AHU-3" and "what changed about P-101 across revs" first-class queries.

### 4.5 AI Layer 2 — Spec Intelligence
```sql
CREATE TABLE spec_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  document_id UUID REFERENCES documents(id),
  document_version_id UUID REFERENCES document_versions(id),
  title TEXT, status TEXT DEFAULT 'pending',  -- pending|running|done|failed (+job cols)
  section_count INT, requirement_count INT,
  attempts INT DEFAULT 0, max_attempts INT DEFAULT 3,
  run_after TIMESTAMPTZ DEFAULT now(), locked_until TIMESTAMPTZ, locked_by TEXT, error TEXT
);
CREATE TABLE spec_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  spec_document_id UUID NOT NULL REFERENCES spec_documents(id) ON DELETE CASCADE,
  csi_section TEXT,                        -- "23 74 13", "03 30 00"
  title TEXT, page_start INT, page_end INT,
  knowledge_chunk_ids UUID[],             -- provenance into knowledge_chunks (pgvector)
  metadata JSONB DEFAULT '{}'
);
CREATE TABLE spec_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  spec_section_id UUID NOT NULL REFERENCES spec_sections(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL,          -- submittal|product_data|shop_drawing|sample|
                                           -- test|inspection|closeout|warranty|o_and_m|commissioning
  equipment_label TEXT,                    -- "Air Handling Unit", "AHU-3"
  description TEXT NOT NULL,               -- extracted obligation text
  reference TEXT,                          -- "2.3.A", "PART 3"
  due_phase TEXT,                          -- pre_construction|submittal|installation|closeout
  source_quote TEXT, confidence NUMERIC(4,3),
  status TEXT DEFAULT 'proposed',          -- proposed|accepted|rejected|fulfilled
  generated_submittal_id UUID,             -- backref once register row created
  metadata JSONB DEFAULT '{}'
);
CREATE TABLE submittal_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  submittal_number TEXT,                   -- "23 74 13-001"
  csi_section TEXT, title TEXT,
  submittal_type TEXT,                     -- product_data|shop_drawing|sample|test_report|o_and_m
  spec_requirement_id UUID REFERENCES spec_requirements(id),
  status TEXT DEFAULT 'required',          -- required|prepared|submitted|under_review|approved|...
  responsible_party TEXT, due_date DATE,
  metadata JSONB DEFAULT '{}',
  UNIQUE(tenant_id, project_id, submittal_number)
);
CREATE TABLE commissioning_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  equipment_label TEXT, csi_section TEXT,
  checklist JSONB DEFAULT '[]',            -- [{item, requirement_id, type:test|inspection, criteria}]
  source TEXT DEFAULT 'spec_intelligence',
  status TEXT DEFAULT 'draft'              -- draft|active|complete
);
```
**Flow:** ingest spec → chunk into `knowledge_chunks` (existing pgvector pipeline) → classify sections by CSI → extract obligations into `spec_requirements` → on accept, emit `submittal_register` rows and `commissioning_checklists` (test/inspection items become inspection templates, see [MOBILE_FIELD_EXECUTION_SPEC.md](./MOBILE_FIELD_EXECUTION_SPEC.md)). Every requirement keeps `source_quote` + chunk provenance for audit.

---

## 5. API Contracts (new)

Base: `/api/v1`. All require `requireAuth` + `requireTenant()` (matching existing route style; tenant from middleware, never from body).

### 5.1 Sets, distribution, controlled copies
```
POST   /projects/:projectId/drawing-sets                 {name,set_type,members:[{drawing_id,rev}]}
GET    /projects/:projectId/drawing-sets                 ?status=
POST   /drawing-sets/:id/issue                            → status=issued, runs supersede sweep
POST   /drawing-sets/:id/supersede                        {superseded_by}
GET    /drawing-sets/:id/members

POST   /projects/:projectId/distribution-lists           {name, members:[...]}
GET    /projects/:projectId/distribution-lists
PATCH  /distribution-lists/:id
POST   /distribution-lists/:id/members
DELETE /distribution-list-members/:id

POST   /transmittals/:id/issue-controlled-copies         {set_id?,drawing_id?,rev?,
                                                           distribution_list_id?, watermark?}
GET    /controlled-copies?project_id=&set_id=&status=
POST   /controlled-copies/:id/acknowledge
POST   /controlled-copies/:id/recall
```
`POST /transmittals/:id/issue-controlled-copies` snapshots recipients, renders watermarked artifacts to storage, writes `controlled_copies` rows, and appends a `transmittal_events` row — reusing the existing transmittal event log.

### 5.2 Version compare
```
POST   /drawings/:id/compare        {base_rev,target_rev,page?,mode}  → 202 {compare_id}
GET    /drawing-compares/:id        → {status,result,overlay_url}
```

### 5.3 AI Drawing Intelligence
```
POST   /drawings/:id/intelligence              {rev}                  → 202 {run_id}
GET    /drawing-intelligence-runs/:id          → run + detection summary
GET    /drawings/:id/detections                ?rev=&type=&link_status=
PATCH  /drawing-detections/:id/link            {object_type,object_id,relation}  → confirm/override
POST   /drawing-detections/:id/reject
GET    /objects/:objectType/:objectId/drawings → reverse lookup via doc_object_links
```
**Response (`GET /drawings/:id/detections`):**
```json
{ "data": [
  { "id":"…","detection_type":"equipment","label":"AHU-3","normalized_tag":"AHU-003",
    "page":1,"bbox":{"x":0.41,"y":0.22,"w":0.06,"h":0.04},"confidence":0.94,
    "link_status":"auto_linked","linked_entity_type":"bim_element",
    "linked_entity_id":"…","why":"exact tag match to bim_elements.name" } ] }
```

### 5.4 Spec Intelligence
```
POST   /projects/:projectId/spec-documents     {document_id}          → 202 {spec_document_id}
GET    /spec-documents/:id                      → sections + requirement counts
GET    /spec-documents/:id/requirements         ?type=&status=
PATCH  /spec-requirements/:id                    {status:accepted|rejected}
POST   /spec-documents/:id/generate-register     → creates submittal_register + checklists
GET    /projects/:projectId/submittal-register   ?csi_section=&status=
GET    /projects/:projectId/commissioning-checklists
```

---

## 6. Controlled-Issue Workflow (state machines)

**Drawing set:** `draft → issued → superseded → void`. Only `issued` sets define current controlled revs. Issuing runs the supersede sweep (§4.1) atomically in one transaction.

**Controlled copy:** `issued → acknowledged → (recalled | superseded)`. A copy is auto-`superseded` when a newer set issuance covers its sheet/rev; recipients with un-acknowledged superseded copies are flagged.

**Transmittal (existing):** `draft → sent → received → under_review → actioned → closed` (+`voided`); now optionally carries a `distribution_list_id` and can spawn `controlled_copies`.

**Spec requirement:** `proposed → accepted → fulfilled` (or `rejected`). Accepted requirements generate register/checklist rows; `fulfilled` when the linked submittal reaches `approved`.

**Detection link:** `unlinked → auto_linked → confirmed` (or `rejected`). Only `confirmed` (or high-confidence `auto_linked`) links count toward "documented coverage" metrics.

---

## 7. AI Pipelines

### 7.1 Drawing Intelligence
1. Rasterize each page of the rev's PDF at a fixed DPI.
2. **Detection:** vision model proposes bboxes + types (equipment/tag/room/system/callout). **OCR** (reuse the `evidence_assets.ocr_text` tooling) reads text within/near each bbox.
3. **Normalization:** tag regexes per discipline (`AHU-\d+`, `P-\d+`, `RM \d+`) → `normalized_tag`.
4. **Linking:** match against `bim_elements`, `assets`, `systems`; write `drawing_detections` + `doc_object_links` (+ `bim_element_links` when applicable).
5. **Diff awareness:** if a `drawing_compares` overlay exists for adjacent revs, annotate detections as added/moved/removed.

**Honesty:** vision/OCR detections are *proposals*; default UX requires human confirmation below a confidence threshold. Never auto-mutate the BIM graph on low confidence.

### 7.2 Spec Intelligence
1. Ingest via existing knowledge pipeline → `knowledge_chunks` (pgvector, 1536-D).
2. Section-classify by CSI MasterFormat headers.
3. Extract obligations (submittals, tests, inspections, closeout, warranty, O&M) with `source_quote` + chunk provenance.
4. On human accept, generate `submittal_register` rows + `commissioning_checklists`; test/inspection items become inspection templates for the field app.

---

## 8. Acceptance Criteria

**Sets / supersede**
- [ ] Issuing a set containing a newer rev of sheet X flips prior issued sets' member rows for X to `is_current=FALSE`; a fully-covered prior set becomes `superseded` with `superseded_by` set — all in one transaction.
- [ ] "Current controlled rev" for any sheet resolves to the newest issued, non-void set's member rev.

**Distribution / controlled copies**
- [ ] A transmittal sent to a distribution list snapshots members into `to_contacts`/`cc_contacts`; later edits to the list do not alter the historical transmittal.
- [ ] Issuing controlled copies writes one `controlled_copies` row per recipient with a unique `copy_number`, a stored watermarked artifact, and a `transmittal_events` entry.
- [ ] A newer issuance auto-supersedes covered copies and flags un-acknowledged ones.

**Compare**
- [ ] `POST /drawings/:id/compare` returns 202 + `compare_id`; the worker produces `result.changed_regions` and a retrievable `overlay_url`. Identical revs yield zero changed regions.

**Drawing Intelligence**
- [ ] On a seeded sheet with known tags, ≥90% of exact-match equipment tags auto-link to existing `bim_elements`/`assets`; each link is persisted in `doc_object_links` with provenance.
- [ ] `GET /objects/bim_element/:id/drawings` returns every sheet/rev whose confirmed detection depicts that element.
- [ ] Detections below the confidence threshold are `unlinked` and never silently mutate the graph.

**Spec Intelligence**
- [ ] Ingesting a spec section yields `spec_requirements` rows each with `requirement_type`, `source_quote`, and a `knowledge_chunk` reference.
- [ ] `POST /spec-documents/:id/generate-register` creates `submittal_register` rows for every accepted submittal requirement and `commissioning_checklists` for test/inspection requirements; rejected requirements generate nothing.
- [ ] When a generated submittal reaches `approved`, its source requirement flips to `fulfilled`.

**Cross-cutting**
- [ ] All new tables enforce tenant RLS; no endpoint accepts `tenant_id` from the body.
- [ ] AI runs use the polled job-queue pattern (`attempts/max_attempts/run_after/locked_until/locked_by`) and are idempotent on retry.

---

## 9. Phased Plan

| Phase | Scope | Verify |
|---|---|---|
| **2.0 Parity foundation** | `drawing_sets`/`members`, supersede sweep, `distribution_lists`, controlled copies on transmittals | Supersede + distribution acceptance tests green |
| **2.1 Compare/overlay** | `drawing_compares`, raster diff worker, overlay render + viewer | Identical/changed-rev fixtures produce correct region diffs |
| **2.2 Drawing Intelligence** | runs/detections, OCR+vision pipeline, auto-link to graph, `doc_object_links`, reverse lookup | ≥90% exact-tag auto-link on seed; provenance persisted |
| **2.3 Spec Intelligence** | spec docs/sections/requirements extraction, register + checklist generation, field-template handoff | Requirement→register→fulfilled lifecycle green |
| **2.4 Closed loop** | diff-aware detections ("tag moved Rev B→C"), coverage dashboards ("undocumented equipment", "open submittals by CSI") | Dashboard metrics reconcile against source tables |

---

## 10. Honesty Ledger

| Claim | Reality |
|---|---|
| Drawings/revisions/markups, transmittals, BIM/IFC, document library + hybrid search | ✅ shipped (`api/routes/{drawings,transmittals,bim,files}.ts`, migrations `003/007/050/051/069/071`) |
| P&ID/PFD generation | ✅ **real SVG/DXF drawing** (`public/tools/denver/*PID*`), ❌ **no process calculations** |
| Engineering discipline calculators | 🟡/❌ **shells** — placeholder/synthetic math, delegated over MCP (see [FEATURES.md](./FEATURES.md)) |
| IFC parsing | ✅ property/quantity extraction (`web-ifc`); ⚠️ geometry render is client-side viewer |
| Superseded sets, distribution lists, controlled copies, compare/overlay, AI Drawing/Spec Intelligence | ❌ **to be built in Phase 2** (this spec) |

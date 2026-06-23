# 11 — BIM AUDIT
## IFC Parsing, APS Viewer, and Coordination Assessment

---

## BIM Architecture Overview

Denver Engineering implements two distinct BIM layers:

1. **IFC Parser (server-side):** `web-ifc` library parses IFC files and extracts element properties into the database. Property-based only — no geometry rendering.

2. **APS Viewer (client-side):** Autodesk Platform Services (formerly Forge) 3D viewer embedded in the frontend. Requires `APS_CLIENT_ID` + `APS_CLIENT_SECRET` environment variables.

---

## IFC Parsing (Server-Side)

**Implementation:** `api/services/bim/ifcParseWorker.ts` (verified)

### Verified IFC Element Types Extracted

```typescript
const ELEMENT_TYPES = [
  WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE,
  WebIFC.IFCSLAB, WebIFC.IFCBEAM, WebIFC.IFCCOLUMN,
  WebIFC.IFCDOOR, WebIFC.IFCWINDOW,
  WebIFC.IFCROOF, WebIFC.IFCSTAIR, WebIFC.IFCRAMP,
  WebIFC.IFCFURNISHINGELEMENT,
  // MEP:
  WebIFC.IFCPIPESEGMENT, WebIFC.IFCPIPEFITTING,
  WebIFC.IFCDUCTSEGMENT, WebIFC.IFCDUCTFITTING,
  WebIFC.IFCFLOWCONTROLLER, WebIFC.IFCFLOWTERMINAL,
  WebIFC.IFCCABLESEGMENT, WebIFC.IFCCABLEFITTING,
  WebIFC.IFCLIGHTFIXTURE, WebIFC.IFCOUTLET,
  // Process:
  WebIFC.IFCSENSOR, WebIFC.IFCACTUATOR,
  // Spaces:
  WebIFC.IFCSPACE, WebIFC.IFCZONE,
  WebIFC.IFCBUILDINGELEMENT,
]
```

**Coverage:** Structural, architectural, MEP (piping, HVAC, electrical), process (sensors, actuators), and space management. **Comprehensive for civil/MEP projects.**

### Parse Process

```
1. ifc_parse_jobs queue (DB table)
2. Worker polls every N seconds
3. readFileSync(localPath) — reads IFC file buffer
4. web-ifc API.Init() + OpenModel(Uint8Array)
5. For each ELEMENT_TYPE:
   a. GetLineIDsWithType()
   b. GetLine() — get entity properties
   c. Extract name, type, quantities, psets
6. upsertBimElements() — batch insert to bim_elements
7. Update job status: completed / failed
```

### Known Issues

1. **`readFileSync` blocks event loop** — confirmed in source comments: *"web-ifc operates on raw IFC bytes."* Synchronous file read on a potentially 100MB IFC file will block all HTTP requests for the duration.

2. **No worker isolation** — IFC worker runs in the same process as the HTTP server. A malformed IFC that causes web-ifc to hang will freeze the entire API.

3. **Single-threaded parse** — Large model files (buildings with 50,000+ elements) can take minutes to parse.

**Remediation:** Move to worker_threads (Node.js) or a separate process/BullMQ worker.

---

## BIM Element Storage

**Table:** `bim_elements` (migration 050, confirmed with RLS)

**Fields:**
- `ifc_guid` — IFC GlobalId for element cross-referencing
- `element_type` — IFC type string (IFCWALL, IFCBEAM, etc.)
- `name`, `description` — from IFC properties
- `quantities` JSONB — length, area, volume extracted from IfcElementQuantity
- `psets` JSONB — all IfcPropertySet key-value pairs
- `level`, `zone`, `system` — classification fields
- `bim_model_id` FK — links back to the model
- `tenant_id` + RLS ✅

**BIM element links:** `bim_element_links` table — links BIM elements to deficiencies, punch items, sensors, commissioning items.

**Grade: A- (comprehensive schema; quantities in JSONB not normalized)**

---

## BIM Model Register

**Implementation:** `api/routes/bim.ts` (verified)

```
GET    /api/v1/projects/:projectId/bim-models    — list models
POST   /api/v1/projects/:projectId/bim-models    — register model
GET    /api/v1/bim-models/:id                    — model detail
PATCH  /api/v1/bim-models/:id                    — update
DELETE /api/v1/bim-models/:id                    — delete
GET    /api/v1/projects/:projectId/bim-issues    — clash/issue list
POST   /api/v1/projects/:projectId/bim-issues    — create issue
PATCH  /api/v1/bim-issues/:id                    — update issue
```

**Supported formats:** `ifc, glb, gltf, nwd, rvt` (validated on upload)

**Model metadata:**
- `discipline` — Structural, Architectural, MEP, etc.
- `coord_system` — coordinate reference system
- `georef` JSONB — georeference parameters
- `element_count` — extracted element count

---

## APS Viewer (Autodesk Platform Services)

**Implementation:** `api/services/bim/apsViewerService.ts` (verified)

### Configuration Requirement

```typescript
// getApsViewerToken()
const clientId     = process.env['APS_CLIENT_ID']
const clientSecret = process.env['APS_CLIENT_SECRET']

if (!clientId || !clientSecret) {
  return { access_token: '', expires_in: 0, configured: false }
}
```

**If APS is not configured:** Returns `{ configured: false }` — the viewer renders nothing. The rest of the platform continues to work.

**If APS is configured:** Issues 2-legged OAuth token via Autodesk API, caches it (with 60s buffer), returns to client for viewer initialization.

**URN translation:** `fromStorageKey(storageKey)` converts S3 object keys to base64 APS URNs for the viewer.

### Deployment Reality

- **Development installs without APS credentials:** BIM viewer section of UI renders blank or shows a placeholder.
- **Production:** Requires Autodesk APS account, registered application, and model translation (Forge model derivative service).
- **Model translation cost:** Autodesk charges per translation — 25 Cloud Credits per model translation for large models.

### Clash Detection

**Status: ❌ Not implemented**

No clash detection service was found in the codebase. The `bim_issues` table can store manually reported clashes, but there is no automated:
- Model federation
- Geometry interference calculation
- Clash grouping / deduplication

**This is a significant gap vs. ACC / Navisworks.**

---

## BIM Issues (Coordination)

**From `bim_issues` table and routes:**

Features confirmed:
- Issue creation with category (clash, design, constructability)
- Linked to specific BIM elements via `bim_element_id`
- Status workflow: open → in_review → resolved → closed
- `createAction()` integration — issues generate workflow actions

**Grade: B (manual issue tracking; no automated clash detection)**

---

## BIM Summary Assessment

| Capability | Status | Grade | Evidence |
|-----------|--------|-------|----------|
| IFC element extraction | ✅ Real | A- | web-ifc, 25+ element types |
| Element property storage | ✅ Real | A- | JSONB psets + quantities |
| BIM model register | ✅ Real | B+ | full CRUD, format validation |
| APS 3D viewer | 🔧 Conditional | B | Works only with APS credentials |
| BIM-element links | ✅ Real | A- | Links to deficiencies, sensors, punch items |
| Clash detection | ❌ Missing | F | Manual reporting only |
| MEP coordination | 🟡 Partial | C | Element types extracted; no system routing |
| Federated models | ❌ Missing | F | Single-model view only |
| Event loop blocking (parse) | ⚠️ Risk | — | readFileSync in worker |

**BIM Score: 60/100**

**Critical gap:** No automated clash detection and no federated model support. For $50M+ construction projects on tight schedules, clash detection is non-negotiable.

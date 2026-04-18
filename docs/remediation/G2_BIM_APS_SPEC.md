# G2 — BIM via Autodesk Platform Services (APS)

**Gap class:** LAG
**Release slot:** v4.32.0
**Competitive reference:** Autodesk Construction Cloud, AVEVA Unified Project Execution lead on BIM
**Status:** DRAFT — awaiting owner approval

---

## Target end-state

Users attach a model URN to any project. They can view the model in-app, click any element, and link that element to an RFI, issue, or submittal — round-tripping the reference back to existing EPC workflows. JARVIS EPC does **not** implement a native BIM engine; it integrates with Autodesk Platform Services (formerly Forge).

---

## APS building blocks used

| APS service | Purpose |
|---|---|
| Authentication (2-legged OAuth2) | Server-side app → viewer access token |
| Data Management | Storage + metadata for uploaded models |
| Model Derivative | Translate source formats (RVT, IFC, NWD, DWG) → SVF2 viewer format |
| Viewer (JS SDK) | Embedded 3D viewer in the browser |

---

## Token flow (server-side)

```
┌─────────┐   1. Server holds APS_CLIENT_ID + APS_CLIENT_SECRET
│ Backend │   2. Obtains a 2-legged app-only access token from APS
└──┬──────┘      scope: data:read, bucket:read, viewables:read
   │ 3. On browser request, mints a short-lived (60 min) viewer token
   ▼             with the same scopes, returns to client
┌─────────┐
│ Browser │   4. Initializes APS Viewer with viewer token
└─────────┘   5. Loads model by URN, user interacts
```

**Secret never leaves the server.** Client receives only short-lived viewer tokens.

---

## API surface (new)

New file: `api/routes/bim.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/bim/viewer-token` | user JWT | Returns `{ access_token, expires_in }` for viewer init |
| `GET` | `/api/v1/bim/models` | user JWT | Lists tenant-scoped models with URN + translation status |
| `POST` | `/api/v1/bim/models` | owner/pm | Registers a new model (uploads initial file via APS Data Management) |
| `POST` | `/api/v1/bim/models/:id/translate` | owner/pm | Kicks off Model Derivative translation job |
| `GET` | `/api/v1/bim/models/:id/status` | user JWT | Translation progress (queued/inprogress/success/failed) |
| `POST` | `/api/v1/bim/elements/link` | engineer+ | Links a model element (URN + dbId) to an RFI/issue/submittal ID |
| `GET` | `/api/v1/bim/elements/:rfi_id` | user JWT | Returns linked element refs for a given RFI |

All endpoints RLS-scoped by `tenant_id`.

---

## Database schema (migration 005)

File: `api/db/migrations/005_bim.sql`

```sql
CREATE TABLE bim_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  project_id UUID REFERENCES projects(id),
  name TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  aps_urn TEXT NOT NULL,
  aps_bucket_key TEXT NOT NULL,
  translation_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (translation_status IN ('queued','inprogress','success','failed','timeout')),
  translation_progress TEXT,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bim_models_tenant ON bim_models(tenant_id);
CREATE INDEX bim_models_project ON bim_models(project_id);

-- Link table: model element <-> EPC entity
CREATE TABLE bim_element_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  model_id UUID NOT NULL REFERENCES bim_models(id) ON DELETE CASCADE,
  element_dbid INTEGER NOT NULL,   -- APS viewer dbId
  element_external_id TEXT,        -- source system GUID if available
  linked_entity_type TEXT NOT NULL
    CHECK (linked_entity_type IN ('rfi','submittal','issue','wir','ncr')),
  linked_entity_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bim_links_entity ON bim_element_links(linked_entity_type, linked_entity_id);
CREATE INDEX bim_links_model ON bim_element_links(model_id);

-- RLS
ALTER TABLE bim_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_models ON bim_models
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE bim_element_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_links ON bim_element_links
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## Frontend changes

### `src/components/BIMViewerView.tsx` (replace placeholder)

- Loads APS Viewer JS SDK from `https://developer.api.autodesk.com/modelderivative/v2/viewers/`
- Fetches viewer token on mount + refreshes 5 min before expiry
- Renders model by URN prop (passed from parent — project detail page)
- Element-selection handler: when user clicks an element, stores `{ dbId, externalId }` in local state and opens a popover with actions (Link to RFI, Link to Issue, View Properties)

### New hook: `src/hooks/useAPSViewer.ts`

```typescript
interface UseAPSViewerOptions {
  urn: string;
  onSelect?: (dbId: number, externalId: string | null) => void;
  onError?: (err: Error) => void;
}

interface UseAPSViewerReturn {
  viewerRef: React.RefObject<HTMLDivElement>;
  isLoading: boolean;
  isReady: boolean;
  error: Error | null;
  isolate: (dbIds: number[]) => void;
  fitToView: () => void;
}
```

### `.env.example` additions

```
# Autodesk Platform Services
APS_CLIENT_ID=
APS_CLIENT_SECRET=
APS_BUCKET_KEY=
APS_VIEWER_TOKEN_TTL_SEC=3600
```

---

## Quota + rate-limit policy

APS charges per-token-exchange on some plans. Mitigations:

- Backend token cache: app-only token refreshed 5 minutes before expiry, reused across browser sessions
- Viewer-token endpoint rate-limited: 60 requests/min per tenant
- Translation jobs tracked in `bim_models.translation_status`; client polls no faster than every 10s
- Model upload size cap: 500 MB per file at v1 (configurable via `BIM_MAX_UPLOAD_MB`)

---

## Acceptance criteria

- [ ] Upload a sample IFC or RVT file; translation completes; viewer loads it
- [ ] Click an element; "Link to RFI" flow creates `bim_element_links` row
- [ ] Open an existing RFI with linked element; viewer isolates + zooms to that element
- [ ] Cross-tenant test: tenant A cannot read tenant B's `bim_models` (RLS proves isolation)
- [ ] Viewer token never appears in a URL query string (per user_privacy rules)
- [ ] `APS_CLIENT_SECRET` not present in any client bundle (build-time assertion)
- [ ] E2E test `bim-viewer.spec.ts` covers the happy path
- [ ] `CHANGELOG.md` v4.32.0 entry

---

## Out of scope (v1)

- Clash detection
- Model-to-model overlay / federated view
- Version comparison diff tool
- 4D/5D schedule visualization
- Automatic drawing-to-model reconciliation
- Real-time multi-user cursor presence

All are candidate v2 work.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| APS service outage | Medium | Viewer shows offline banner; cached thumbnails remain available |
| APS API breaking change | Low | Version-pin SDK; monitor Autodesk changelog |
| Token leak via logs | High | Redact `access_token` from all log payloads (add to `pino` serializers) |
| Translation quota exhaustion | Medium | Surface remaining quota in owner panel; alert at 80% |

---

## Effort estimate

| Slice | Days |
|---|---|
| Backend routes + migration + APS auth wiring | 2 |
| Frontend viewer hook + component | 2 |
| Element-linking UI + data contracts | 0.5 |
| E2E test + redaction audit | 0.5 |
| **Total** | **5 days** |

---

## Owner approval

- [ ] **Approved** — proceed with APS integration as specified
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — evaluate alternative (e.g., Forge predecessor APIs, Bentley iTwin) before re-review
- [ ] **Deferred** — re-review at date: ______________

**Commercial prerequisite:** Register APS application at developer.autodesk.com; obtain client ID + secret; confirm pricing tier (Standard / Premium) acceptable.

Signed: _________________________  Date: _______________

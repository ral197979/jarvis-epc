# Mobile & Field Execution Specification — Phase 8

**Denver Engineering — the AI-native project operating system**
*Goal: match and exceed Procore mobile — an offline-first, installable field app that understands, predicts, and decides on site.*

**Status legend:** ✅ shipped & wired · 🟡 partial / shell · ❌ not built · ⚠️ caveat

**Sibling specs:** [DOCUMENT_CONTROL_SPEC.md](./DOCUMENT_CONTROL_SPEC.md) · [AI_PROJECT_INTELLIGENCE_SPEC.md](./AI_PROJECT_INTELLIGENCE_SPEC.md) · [COST_CONTROL_SPEC.md](./COST_CONTROL_SPEC.md) · [PROCUREMENT_SPEC.md](./PROCUREMENT_SPEC.md) · [INTEGRATION_MARKETPLACE_SPEC.md](./INTEGRATION_MARKETPLACE_SPEC.md) · [ENTERPRISE_SECURITY_SPEC.md](./ENTERPRISE_SECURITY_SPEC.md) · [FEATURES.md](./FEATURES.md) · [APP_OVERVIEW.md](./APP_OVERVIEW.md)

---

## 1. Positioning & Thesis

Procore's mobile app wins on field adoption: it works on a dead-zone job site, queues writes, syncs in the background, and lets a super capture a punch item with photos in seconds. Denver Engineering already has the **server half** of this — an idempotent batch-replay endpoint, optimistic-locking conflict detection, an evidence-asset ingestion pipeline, daily logs, inspections, and punch lists. What it lacks is the **client half**: a real offline storage layer (IndexedDB), a service worker, background sync, and push.

Phase 8 builds that client half and then goes past Procore by wiring the field app into Denver's existing AI: **AI-generated daily reports** from the day's captures, and an **AI Field Assistant** ("what's behind schedule? what's blocking Area B? what inspections are due today?") powered by the deterministic, explainable **Project Copilot Focus engine** (`api/services/copilot/projectCopilotService.ts`) scoped to a project/area.

---

## 2. Current State (with evidence)

### 2.1 Offline batch replay (server) — ✅
**Route:** `api/routes/fieldSync.ts` · **Service:** `api/services/fieldSync.ts` · **Conflict resolver:** `api/services/mobile/conflictResolver.ts`, `api/services/mobile/syncEngine.ts`.

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/field-sync/batch` | POST | Array of ops (≤100); order-preserving results |
| `/api/v1/field-sync/operations` | GET | Paginated processed-op history (filter `resource`, `status`) |

- **Idempotency:** every op carries a client-generated `client_op_id` (UUID); server enforces `UNIQUE(tenant_id, client_op_id)` in `field_sync_operations` and returns the cached result on duplicate (`_processOne` fast-path).
- **Conflict model:** optimistic lock + last-writer-wins with surfacing. Client sends `base_updated_at`; `_optimisticUpdate(client, table, id, baseUpdatedAt, spec)` updates `WHERE id=$1 AND updated_at=$2`. On 0 rows → `{ status:'conflict', current:{…} }` returns server state for the client to merge; on match → `{ status:'success' }`.
- **Resources:** `action_items`, `daily_logs`, `wirs`, `inspections`, `punch_items` (dispatched via `_dispatchCreate`/`_dispatchUpdate`).
- **Richer device-sync schema exists** (`036_mobile_offline.sql`): `mobile_devices`, `sync_sessions`, `offline_mutations` (`UNIQUE(tenant_id, device_id, client_id)`, `status ∈ pending|applied|conflicted|rejected|skipped`), `offline_conflicts` (`conflict_type ∈ concurrent_edit|deleted_on_server|schema_mismatch`, `resolution ∈ client_wins|server_wins|merged|rejected`). The `conflictResolver` supports field-level merge. ⚠️ The live `field-sync` route currently uses the simpler `field_sync_operations` path; Phase 8 promotes the field client onto the richer `036` device-sync tables.

### 2.2 Daily logs — ✅
**Route:** `api/routes/dailyLogs.ts`. CRUD + `POST /daily-logs/:id/submit` + `POST /daily-logs/:id/approve`. State machine `draft → submitted → approved`. Fields: `log_date, weather, temp_f, wind_mph, humidity_pct, manpower(JSONB), equipment(JSONB), visitors(JSONB), deliveries(JSONB), work_performed, delays, safety_notes, incidents(JSONB), quality_notes, photos(JSONB)`; submit/approve stamp `submitted_by/at`, `approved_by/at`. Index `(project_id, status)`.

### 2.3 Inspections & punch lists — ✅
**Routes:** `api/routes/inspections.ts`, `api/routes/punchLists.ts` · **Tables** (`008_tier1_modules.sql`):
- `inspection_templates` (`checklist JSONB`, `discipline`, `version`, `is_active`) and `inspections` (auto-number `INS-001`; `status scheduled → completed|failed`; `results JSONB` of `{item,result:pass|fail|na,notes}`; `pass_count/fail_count/na_count/overall_result`; `signatures JSONB`, `photos JSONB`). `POST /inspections/:id/complete` tallies results.
- `punch_lists` (`status open|closed`) and `punch_items` (`item_number`, `priority low|medium|high|critical`, `status open → in_progress → verified → closed`, `assigned_to`, `due_date`, `drawing_id`, `pin_x/pin_y` for sheet pins, `photos JSONB`). `POST /punch-items/:id/verify`, `/close`.

### 2.4 Evidence assets — ✅ (schema) / 🟡 (UI)
**Tables** (`037_evidence_assets.sql`):
- `evidence_assets` — `evidence_type ∈ photo|video|voice_note|pdf|markup|annotated_drawing|document`; `status ∈ uploading|uploaded|processing|processed|failed|archived`; `storage_*`, `checksum_sha256` (**`UNIQUE(tenant_id, checksum_sha256)` dedup**), `captured_at`, `geolocation JSONB {lat,lng,accuracy_meters}`, `device_id`, `thumbnail_key`, `compressed_key`, `ocr_text`, `ocr_confidence`, `ai_tags JSONB`, `duration_seconds`, `page_count`, `upload_attempts`.
- `evidence_links` — polymorphic (`entity_type`, `entity_id`, `context ∈ defect_photo|before|after|completion_proof`); `UNIQUE(tenant_id, evidence_id, entity_type, entity_id)`.
- `evidence_processing_jobs` — async `job_type ∈ compress|thumbnail|ocr|ai_tag|transcode` with the standard polled-queue columns.

### 2.5 Mobile frontend — 🟡
`denver-engineering-next/frontend/src/modules/mobile/` + `src/app/mobile/`: `MobileShell.tsx` (app bar, connectivity strip, bottom tabs Home/Scan/FPT/Sync), `FieldHomePage.tsx`, `SyncPage.tsx` (queue + conflict resolve UI), `ArrivalPage.tsx`, `ScanPage.tsx`, `MobileFptPage.tsx`; plus `src/components/FieldOperationsView.tsx`.
- ❌ **No `manifest.json`**, ❌ **no service worker**, ❌ **no IndexedDB/`idb`/Dexie usage**, ❌ no real `navigator.onLine` detection (connectivity toggle is mock `useState`). The sync-queue UI is backed by an in-memory/localStorage adapter, not durable offline storage.

### 2.6 Project Copilot Focus engine — ✅ (per-project) / 🟡 (per-area)
`api/services/copilot/projectCopilotService.ts`. Pure deterministic ranker `synthesizeFocus(inputs, now, limit)` + DB wrappers `buildProjectFocus(tenantId, projectId, …)` and `buildPortfolioFocus(tenantId, …)`. Synthesizes 8 signal sources (RFIs, submittals, risks, inspections, punch items, actions, budget overruns, schedule slips) into ranked `FocusItem`s with `score (0–100)`, `severity (critical≥75/high≥55/medium≥40/low)`, `why` (explanation), `recommendedAction`, `dueDate`, `daysOverdue`. ⚠️ **Per-project only today** — `synthesizeFocus` does not filter by area/location/discipline. Phase 8 adds an area scope (§7).

### 2.7 Honest gap summary

| Capability | State |
|---|---|
| Server batch replay + idempotency + conflict detect | ✅ |
| Daily logs / inspections / punch capture | ✅ |
| Evidence assets pipeline (photo/video/voice/OCR/AI-tag) | ✅ schema · 🟡 no field UI wired |
| Installable PWA (manifest + service worker) | ❌ |
| Offline-first read cache + durable write queue (IndexedDB) | ❌ |
| Background sync | ❌ |
| Push notifications end-to-end | ❌ (`mobile_devices.push_token` column only) |
| Barcode / GPS / voice / video capture | ❌/🟡 |
| AI-generated daily reports | ❌ |
| AI Field Assistant (area-scoped Focus) | ❌ (engine exists, not surfaced/scoped) |

---

## 3. Offline-First Architecture

```
┌── Device (installable PWA) ──────────────────────────────────────────┐
│  Service Worker (Workbox)                                            │
│   • app-shell precache (offline boot)                               │
│   • runtime cache: GET reads (stale-while-revalidate)               │
│   • Background Sync: drain outbox when online                       │
│                                                                      │
│  IndexedDB (idb)                                                     │
│   • cache:    read models (projects, daily logs, punch, inspections)│
│   • outbox:   queued mutations {client_op_id, entity, base_updated_at,│
│               op, payload, attachments[], status}                   │
│   • media:    blobs (photo/video/voice) {checksum, status}          │
│                                                                      │
└──────────────────┬───────────────────────────────────────────────────┘
                   │  POST /field-sync/batch (ordered, idempotent)
                   │  POST /files/request-upload → PUT (resumable media)
                   ▼
        Server: field_sync / 036 device-sync + evidence pipeline (037)
```

**Boot:** service worker serves the precached app shell so the app opens offline. **Read:** runtime cache fills IndexedDB; UI renders from IndexedDB, then revalidates. **Write:** every mutation is written to the IndexedDB `outbox` *first* (optimistic UI), tagged with a client-generated `client_op_id` (UUID) and the `base_updated_at` of the record it edits. **Drain:** Background Sync (or a foreground reconnection listener) posts the outbox to `/field-sync/batch` in order; successes clear, conflicts surface, transient failures retry with backoff.

**Conflict policy:** last-writer-wins by default with explicit surfacing — on `{status:'conflict', current}` the row is flagged in the Sync UI with server-vs-mine, and the user picks Keep Mine / Keep Server / Merge (writing the resolution back as a new idempotent op). This matches the server's `_optimisticUpdate` + `offline_conflicts` resolution enum.

**Media:** captured blobs go to the IndexedDB `media` store with a client-computed `sha256`. On drain, each uploads via the existing presigned flow (`POST /files/request-upload` → `PUT`), then a `field-sync` op links it via `evidence_links`. The server's `UNIQUE(tenant_id, checksum_sha256)` dedups re-uploads (e.g., after a crash); uploads are resumable and survive app restarts.

---

## 4. Data Model

Phase 8 promotes the field client onto the richer `036_mobile_offline.sql` device-sync tables (already present) and the `037` evidence tables. **No new server tables are strictly required** for the core sync loop; the additions below are client-side (IndexedDB) plus two small server columns/tables for push and area scoping.

### 4.1 Client (IndexedDB) stores
```
cache   { key, entity_type, entity_id, data, updated_at }          // read models
outbox  { client_op_id(PK), entity_type, entity_id?, op,            // queued writes
          payload, base_updated_at, attachments[], status,          // pending|sent|applied|conflict|error
          attempts, created_offline_at, error }
media   { sha256(PK), kind, blob, evidence_type, captured_at,       // photo|video|voice_note
          geolocation, status, upload_attempts }                    // local|uploading|uploaded|failed
```

### 4.2 Server (existing, reused)
- Sync: `mobile_devices`, `sync_sessions`, `offline_mutations` (`UNIQUE(tenant_id, device_id, client_id)`), `offline_conflicts` — `036_mobile_offline.sql`.
- Evidence: `evidence_assets`, `evidence_links`, `evidence_processing_jobs` — `037_evidence_assets.sql`.
- Field captures: `daily_logs`, `inspections`/`inspection_templates`, `punch_lists`/`punch_items` — `008_tier1_modules.sql`.

### 4.3 New (push + AI daily report + area scope)
```sql
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, user_id UUID NOT NULL,
  device_id UUID REFERENCES mobile_devices(id),
  channel TEXT NOT NULL,                  -- web_push|fcm|apns
  endpoint TEXT, p256dh TEXT, auth TEXT,  -- web push keys (or token for fcm/apns)
  is_active BOOLEAN DEFAULT TRUE, last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, endpoint)
);

CREATE TABLE daily_report_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, project_id UUID NOT NULL,
  daily_log_id UUID REFERENCES daily_logs(id),
  report_date DATE NOT NULL,
  status TEXT DEFAULT 'draft',            -- draft|edited|finalized
  generated_summary TEXT,                 -- AI narrative
  source_refs JSONB,                      -- {daily_log, inspections[], punch[], evidence[], weather}
  edited_summary TEXT, finalized_by UUID, finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, project_id, report_date)
);
```
Area scoping reuses existing `location`/`discipline` columns already present on `inspections.location`, `punch_items.location/discipline`, and `daily_logs` — no schema change needed; the Focus engine gains an `area` filter (§7).

---

## 5. API Contracts

Base: `/api/v1`. All require `requireAuth` + `requireTenant()`.

### 5.1 Sync (existing, hardened)
```
POST /field-sync/batch          {device_id, ops:[{client_op_id, resource, op, id?, payload,
                                                   base_updated_at}]}
                                → {results:[{client_op_id, status:'success'|'conflict'|'error',
                                             entity?, current?, error?}]}   // order-preserving
GET  /field-sync/operations     ?resource=&status=&limit=&offset=
POST /devices/register          {device_token, device_platform, app_version, push_token?}
```

### 5.2 Media (existing presign reused)
```
POST /files/request-upload      {filename, mime_type, size_bytes, checksum_sha256}  → {token, url}
PUT  /files/upload/:token       (binary)                                            → version
POST /files/confirm/:versionId
POST /evidence/:id/link         {entity_type, entity_id, context}                   // evidence_links
```

### 5.3 Push
```
POST /push/subscribe            {channel, endpoint, p256dh?, auth?}     → subscription
DELETE /push/subscribe/:id
```
Triggers: inspection assigned/due, punch item assigned, RFI/submittal awaiting you, sync conflict needing resolution. Server fan-out via `push_subscriptions`.

### 5.4 AI daily report
```
POST /projects/:projectId/daily-reports/generate   {report_date}   → 202 {draft_id}
GET  /daily-report-drafts/:id
PATCH /daily-report-drafts/:id                       {edited_summary}
POST /daily-report-drafts/:id/finalize
```

### 5.5 AI Field Assistant (area-scoped Focus)
```
GET  /projects/:projectId/focus            ?area=&discipline=&limit=    → FocusBriefing
POST /projects/:projectId/assistant        {question, area?}            → answer + cited FocusItems
```
`GET /focus` wraps `buildProjectFocus` with the new `area`/`discipline` filter. The assistant maps NL questions ("what's blocking Area B?", "inspections due today?") to a focus query + filter and returns the ranked, explained items with deep links.

**Response (`GET /focus?area=Area B`):**
```json
{ "project": {"id":"…","name":"…"}, "generatedAt":"…",
  "headline":"3 critical items in Area B",
  "summary": {"total":7,"critical":1,"high":2,"medium":3,"low":1},
  "items": [
    { "source":"inspection","reference":"INS-014","title":"CHW pressure test — Area B",
      "severity":"critical","score":82,"why":"due today, overdue dependencies",
      "recommendedAction":"Assign inspector + capture results","dueDate":"2026-06-22",
      "deepLink":"/mobile/inspections/…","area":"Area B" } ] }
```

---

## 6. State Machines

**Outbox op (client):** `pending → sent → (applied | conflict | error)`. `conflict` → user resolves → new `pending` op. `error` (transient) → backoff retry; `error` (permanent/4xx) → surfaced.

**Media (client):** `local → uploading → uploaded` (or `failed → retry`). Dedup short-circuits to `uploaded` if server already holds the checksum.

**Daily report:** `draft (AI) → edited → finalized`. Finalize stamps `finalized_by/at` and may submit the linked `daily_logs` row.

**Field captures (server, existing):** daily log `draft → submitted → approved`; inspection `scheduled → completed|failed`; punch item `open → in_progress → verified → closed`.

---

## 7. AI Layers

### 7.1 AI-generated daily report
On `generate`, collect the day's `daily_logs` (weather, manpower, equipment, delays, incidents), completed `inspections`, new/closed `punch_items`, and linked `evidence_assets` for the project/date, then produce a narrative `generated_summary` with `source_refs` provenance. Output is a **draft** — always human-editable before finalize. (Honesty: the report summarizes captured data; it does not invent production figures.)

### 7.2 AI Field Assistant (area-scoped Focus)
Reuse the deterministic, explainable `projectCopilotService`. Add an `area` filter to `synthesizeFocus`/`buildProjectFocus` that scopes by `location`/`discipline` already carried on inspections, punch items, and daily logs. The assistant is a thin NL→query mapper over `GET /focus`, returning ranked `FocusItem`s with `why`, `recommendedAction`, and deep links — so "what's blocking Area B?" yields the same scored, auditable items the dashboard shows, not a free-text hallucination.

---

## 8. Acceptance Criteria

**PWA / offline**
- [ ] App is installable (valid `manifest.json` + registered service worker) and boots offline from the precached shell.
- [ ] A full daily-log + 2 punch items + 1 inspection captured in airplane mode persist in IndexedDB, survive an app restart, and replay cleanly to the server on reconnect.
- [ ] Reads served from IndexedDB cache offline; revalidated when online (stale-while-revalidate).

**Sync / conflict**
- [ ] Replaying the same outbox twice (duplicate `client_op_id`) produces no duplicate rows (server idempotency).
- [ ] Concurrent edit yields `{status:'conflict', current}`; the Sync UI surfaces server-vs-mine; user resolution writes back as a new idempotent op and clears the conflict.

**Media**
- [ ] Photo/video/voice captured offline queue with a client `sha256`; uploads resume after restart; re-upload of an identical file is deduped server-side and links correctly via `evidence_links`.
- [ ] GPS `geolocation` and `captured_at` are stamped at capture and persisted on `evidence_assets`.

**Push**
- [ ] Subscribing registers `push_subscriptions`; an inspection assigned to a user delivers a push; unsubscribing stops delivery.

**AI**
- [ ] `POST /daily-reports/generate` returns a draft summarizing that date's captures with `source_refs`; editing + finalize persists and stamps `finalized_by/at`.
- [ ] `GET /focus?area=Area B` returns only items whose `location`/`discipline` match Area B, each with a non-empty `why` and a working deep link; results match the dashboard's scoring.

**Cross-cutting**
- [ ] All endpoints enforce tenant RLS; `tenant_id`/`device` identity come from auth/middleware, never the body.

---

## 9. Phased Plan

| Phase | Scope | Verify |
|---|---|---|
| **8.0 PWA shell** | `manifest.json`, service worker (Workbox), app-shell precache, real `navigator.onLine` | App installs + boots offline |
| **8.1 Offline data layer** | IndexedDB `cache`/`outbox`/`media` (idb), optimistic UI, drain to `/field-sync/batch` | Airplane-mode capture → clean replay; idempotent on retry |
| **8.2 Conflict UX** | Surface `{status:'conflict'}`, Keep Mine/Server/Merge, write-back ops; promote to `036` device-sync tables | Concurrent-edit acceptance tests green |
| **8.3 Field capture** | Photo/video/voice/signature/QR+barcode/GPS via `evidence_assets`; offline media queue + dedup | Media resumes after restart; dedup verified |
| **8.4 Push** | `push_subscriptions`, web-push/FCM/APNs fan-out, assignment/due/conflict triggers | Push delivered + unsubscribed |
| **8.5 AI daily report** | `daily_report_drafts`, generate/edit/finalize | Draft from day's captures with provenance |
| **8.6 AI Field Assistant** | area filter on Focus engine, `/focus`, NL `/assistant` | Area-scoped, explained, deep-linked answers |

---

## 10. Honesty Ledger

| Claim | Reality |
|---|---|
| Server batch replay, idempotency, optimistic-lock conflict detect | ✅ `api/routes/fieldSync.ts`, `api/services/fieldSync.ts`, `036_mobile_offline.sql` |
| Daily logs / inspections / punch capture | ✅ `api/routes/{dailyLogs,inspections,punchLists}.ts`, `008_tier1_modules.sql` |
| Evidence assets (photo/video/voice/OCR/AI-tag, dedup) | ✅ schema (`037_evidence_assets.sql`) · 🟡 field UI not wired |
| Project Copilot Focus engine | ✅ deterministic + explainable (`projectCopilotService.ts`); ⚠️ per-project only — area scope added here |
| Installable PWA, service worker, IndexedDB offline store, background sync, push | ❌ **to be built in Phase 8** (this spec) |
| AI daily reports, AI Field Assistant | ❌ engine exists for the assistant; report + area-scoped surfacing are new |
| Connectivity indicator in current mobile UI | ⚠️ mock `useState`, not real `navigator.onLine` — replaced in 8.0 |

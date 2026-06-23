# 10 — Field Service, Offline & Mobile Audit

## Modules Covered
- Field Operations View
- Field Sync (Offline Sync)
- Mobile Offline Queue
- QR Workflow Launcher
- Offline Indicator

---

## Field Operations

**Frontend:** `src/components/FieldOperationsView.tsx` ✅  
**Nav ID:** `field` (domain: `field`) ✅  
**Backend:** `api/routes/fieldSync.ts`, `api/services/fieldSync.ts` ✅  
**Migration:** `013_field_sync.sql` ✅  
**RLS:** ✅ (migration 013)

**Assessment:** Field operations view provides a hub for field-side users. Connected to field sync for offline capability.

---

## Offline Sync Architecture

**Backend:**
- `api/routes/fieldSync.ts` — batch replay endpoint
- `api/services/fieldSync.ts` — sync engine
- `api/services/mobile/syncEngine.ts` — sync core
- `api/services/mobile/conflictResolver.ts` — conflict resolution

**Frontend:**
- `src/modules/offlineQueue/index.ts` — offline operation queue (localStorage)
- `src/components/OfflineIndicator.tsx` — connection status indicator
- `src/components/ops/OfflineSyncStatus.tsx` — sync status display
- `src/modules/persistence/index.ts` — persistence layer

**Migration:** `036_mobile_offline.sql` ✅

**Tests:** `api/__tests__/fieldSync.test.ts` ✅

### Offline Flow
1. Frontend detects offline state → `OfflineIndicator` shown
2. Operations queued in `offlineQueue` (localStorage)
3. On reconnect → queue replayed via `api/routes/fieldSync.ts`
4. Server applies operations and resolves conflicts

**Strengths:**
- Conflict resolver service exists ✅
- Field sync test coverage ✅
- `field_sync_operations` table with RLS ✅

**Gaps:**
- Conflict resolution strategy not documented (last-write-wins? merge? user prompt?)
- No confirmed maximum queue size before data loss
- No sync status indication in field views (only `OfflineSyncStatus` component)
- No Progressive Web App (PWA) service worker — offline-first requires SW for background sync
- No `manifest.json` for PWA installation on mobile devices

---

## QR Workflow Launcher

**Frontend:** `src/components/ops/QRWorkflowLauncher.tsx` ✅

**Assessment:** QR code-based workflow launch for field operations. Allows workers to scan a QR code to access a specific asset's workflow.

**Gaps:**
- QR code generation backend not confirmed
- Deep link URL scheme not confirmed
- No auth bypass concern — QR links presumably still require login

---

## Mobile / Responsive Assessment

**No dedicated mobile app** — platform is a web SPA. Mobile use via browser.

**Responsive CSS:** Not explicitly confirmed in design tokens review. Construction/field views likely not optimized for small screens.

**Gaps:**
- No PWA manifest (`manifest.json`) — cannot install to home screen
- No service worker — no true offline capability (service worker required for offline-first)
- `OfflineQueue` uses localStorage — limited storage (5MB typical) insufficient for large field data sets
- No push notification support (notification module exists server-side but browser push not confirmed)
- No camera API integration for photo capture in inspections/daily logs

---

## IoT Integration (Field)

**Frontend:** `src/components/iot/IoTDashboard.tsx` ✅  
**Backend:** `api/routes/iot.ts`, `api/services/iot/sensorIngestService.ts` ✅

**Ingest security:**
- Bearer token auth for IoT devices (`sensor_ingest_tokens`) ✅
- 90-day token expiry ✅
- Token revocation ✅

**Gaps:**
- No MQTT protocol support — HTTP POST only for sensor data
- No data buffering during network outage (edge-side buffering)
- No real-time alerting when sensor exceeds threshold (notification service exists but integration not confirmed)

---

## Evidence Pipeline (Field Evidence)

**Backend:** `api/routes/evidence.ts`, `api/services/evidence/evidencePipeline.ts` ✅  
**Migration:** `037_evidence_assets.sql` ✅  
**Auth:** `requireAuth + requireTenant` at server mount ✅

**Assessment:** Evidence capture for field inspections and compliance. Pipeline handles evidence file processing.

**Gaps:**
- Photo metadata (GPS, timestamp) extraction not confirmed
- Evidence chain of custody not confirmed
- Digital signature on evidence not confirmed

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| Offline Sync | No PWA service worker — true offline not achievable | P1 |
| Mobile | No responsive CSS confirmed for field views | P2 |
| Mobile | localStorage limited to 5MB for offline queue | P2 |
| Mobile | No camera API for photo capture | P2 |
| Offline | Conflict resolution strategy not documented | P2 |
| IoT | HTTP POST only — no MQTT support | P2 |
| PWA | No manifest.json — cannot install to home screen | P2 |
| Evidence | No GPS metadata extraction | P2 |
| QR | Deep link URL scheme not confirmed | P3 |

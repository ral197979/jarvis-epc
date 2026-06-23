# 05 — Construction Module Audit

## Modules Covered
- Daily Logs
- Drawings & Revisions
- RFIs
- Submittals
- Punch Lists
- Inspections
- BIM/IFC
- IoT Sensors
- Schedule Import (P6 XER / MSP XML)
- Subcontracts

---

## Daily Logs

**Frontend:** `src/components/DailyLogsView.tsx` ✅  
**Backend:** `api/routes/dailyLogs.ts` ✅  
**Migration:** `007_pm_modules.sql` — `daily_logs` table ✅  
**RLS:** ✅ (migration 007)

### Business Logic Found
- Daily log CRUD with project scoping
- Date, weather, crew count, work performed fields expected

**Gaps:**
- No photo attachment workflow confirmed on daily logs (file upload integration)
- No labor hour tracking on daily logs (separate timesheet module exists but not linked)
- No subcontractor daily reporting section

---

## Drawings & Revisions

**Frontend:** `src/components/DrawingsView.tsx` ✅  
**Backend:** `api/routes/drawings.ts` ✅  
**Migration:** `007_pm_modules.sql` — `drawings`, `drawing_revisions`, `drawing_markups` ✅  
**RLS:** ✅ (migration 007)

### Business Logic Found
- Drawing version control with `drawing_revisions` table ✅
- Markup support via `drawing_markups` table ✅
- PDF/image storage via file abstraction

**Gaps:**
- No transmittal workflow linking drawings to transmittals (transmittals exist separately in migration 051)
- No PDF annotation rendering in browser (would need PDF.js or similar)
- No bulk revision upload
- Drawing number auto-generation not confirmed

---

## RFIs (Request for Information)

**Frontend:** `src/components/RFIsView.tsx` ✅  
**Backend:** `api/routes/procurement.ts` — `rfisRouter` ✅  
**Migration:** `002_epc_core.sql` — `rfis` table ✅  
**RLS:** ✅ (migration 002)

### Business Logic Found
- RFI CRUD with status transitions
- `submittals` and `rfis` separated correctly

**Gaps:**
- Official response workflow (respond_by_date, answer, closure) not confirmed
- No linked drawing/specification reference
- No email notification on RFI status change (notification service exists separately)

---

## Submittals

**Frontend:** `src/components/SubmittalsView.tsx` ✅  
**Backend:** `api/routes/procurement.ts` — `submittalsRouter` ✅  
**Migration:** `002_epc_core.sql` — `submittals` table ✅  
**RLS:** ✅ (migration 002)

### Status Transitions
Standard submittal workflow requires: Draft → Submitted → Under Review → Approved/Rejected → Resubmit  
**Not confirmed:** Whether all status transitions are enforced server-side or UI-only.

---

## Punch Lists

**Frontend:** `src/components/PunchListView.tsx` ✅  
**Backend:** `api/routes/punchLists.ts` ✅  
**Migration:** Part of `007_pm_modules` or later — to verify

**Gaps:**
- Punch list closure workflow (sign-off by contractor + owner) not confirmed
- Photo evidence capture for punch items not confirmed
- QR code-based punch item lookup in the field — `QRWorkflowLauncher` component exists but connection to punch lists unclear

---

## Inspections

**Frontend:** `src/components/InspectionsView.tsx` ✅ (largest view bundle — 49KB gzip)  
**Backend:** `api/routes/inspections.ts` ✅  
**Migration:** Not confirmed in reviewed migrations — likely in 007 or a later file

**Assessment:** Large component size suggests comprehensive template system with line items. Evidence capture integration with `api/services/evidence/evidencePipeline.ts` expected.

**Gaps:**
- Inspection template versioning not confirmed
- Offline capture for field inspections (offline queue module exists but integration point unclear)

---

## BIM / IFC

**Frontend:** `src/components/BIMViewerView.tsx` ✅, `src/components/bim/ApsViewer.tsx` ✅  
**Backend:** `api/routes/bim.ts`, `api/services/bim/` ✅  
**Migration:** `007_pm_modules.sql` — `bim_models`, `bim_issues` ✅; `050_bim_estimating.sql` — `bim_elements`, `bim_element_links`, `ifc_parse_jobs` ✅  
**RLS:** ✅ (migrations 007, 050)

### IFC Parsing
- `api/services/bim/ifcParseWorker.ts` — background worker started on boot
- `web-ifc ^0.0.77` — IFC geometry engine (alpha — **P2**)
- `api/services/bim/bimElementService.ts` — element extraction
- `api/services/bim/apsViewerService.ts` — Autodesk Platform Services integration

**Gaps:**
- `web-ifc ^0.0.77` is pre-1.0 — API stability risk (**P2**)
- No file size limit confirmed for IFC uploads (**P1**) — large IFC files (100MB+) could exhaust memory on a free-tier dyno
- APS Viewer requires Autodesk credentials — no documentation confirming credentials are provisioned in env
- No clash detection (requires commercial BIM tool)

---

## IoT Sensors

**Frontend:** `src/components/iot/IoTDashboard.tsx` ✅  
**Backend:** `api/routes/iot.ts`, `api/services/iot/sensorIngestService.ts` ✅  
**Migration:** `055_iot_sensors.sql`, token expiry in `056_rls_backfill_and_token_expiry.sql` ✅

**Strengths:**
- IoT ingest tokens with 90-day expiry ✅
- Token revocation (`revoked_at`) ✅
- Previous security fix for `pool.query` bypass ✅

**Gaps:**
- No MQTT/WebSocket ingest endpoint confirmed (likely HTTP POST only)
- No data rate limiting per sensor (individual sensor flooding possible)
- Sensor data retention policy not confirmed

---

## Schedule Import (P6 XER / MSP XML)

**Frontend:** `src/components/schedule/ScheduleImportView.tsx` ✅  
**Backend:** `api/routes/scheduleImport.ts`, `api/services/phase11/importPipeline.ts` ✅  
**Migration:** `054_schedule_import.sql` ✅  
**Package:** `fast-xml-parser ^5.8.0` for XML parsing

**Business Logic:**
- P6 XER import (`fast-xml-parser` for XML portion, custom XER text parser)
- MSP XML import
- Schedule data mapped to internal task/dependency model
- CPM re-calculation after import

**Gaps:**
- No XER validation before import (malformed XER could crash parser)
- No import rollback if partial import fails
- Previous security fix for MSP lag bug (v10.6.1) — confirms edge cases exist

---

## Subcontracts

**Frontend:** `src/components/procurement/SubcontractView.tsx` ✅  
**Backend:** `api/routes/subcontracts.ts` ✅  
**Migration:** `059_subcontracts.sql` ✅  
**RLS:** **NOT CONFIRMED** — migration 059 needs review (**P1**)

**ESLint Warning:** `SubcontractView.tsx:110:38` — `'tenantId' is defined but never used` — suggests tenantId is not being passed to some API calls (**P2**)

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| BIM/IFC | No file size limit on IFC uploads | P1 |
| Subcontracts | RLS not confirmed on migration 059 | P1 |
| BIM | web-ifc pre-release dependency | P2 |
| Drawings | No transmittal linking | P2 |
| RFIs | Response workflow not confirmed | P2 |
| Schedule Import | No import rollback | P2 |
| IoT | No per-sensor rate limiting | P2 |
| Inspections | Offline capture integration unclear | P2 |
| Punch Lists | Closure sign-off workflow not confirmed | P2 |

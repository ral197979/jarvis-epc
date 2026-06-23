# 08 — EPC FUNCTIONAL AUDIT
## Procore / ACC / Aconex / Trimble Parity Assessment

---

## Scope

This audit benchmarks Denver Engineering against the four dominant EPC platforms:
- **Procore** (construction management, financials, quality)
- **Autodesk Construction Cloud (ACC)** (BIM coordination, field, docs)
- **Aconex** (document control, transmittals, correspondence)
- **Trimble ProjectSight / Prolog** (quality, commissioning)

Each module is rated on three axes: **Depth** (feature completeness), **Parity** (vs. comparable platform), **Production-readiness** (data quality, UX, reliability).

---

## Module-by-Module Comparison

### 1. Project Management

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Project register | ✅ Full | ✅ Full | A | `api/routes/projects.ts` — full CRUD + status lifecycle |
| WBS structure | ✅ | ✅ | A- | `evm_wbs_entries` table + upsert API |
| Team assignment | ✅ | ✅ | B+ | `api/routes/team.ts` — role assignments per project |
| Milestone tracking | ✅ | ✅ | B | Schedule tasks with `is_milestone` flag |
| Portfolio dashboard | ✅ | 🟡 Partial | C+ | CrossProjectHeatmap uses `Math.random()` for risk scores |
| Reporting / exports | ✅ | 🟡 Partial | C | Export routes exist; PDF output not verified from source |

**Verdict:** Core project management is solid. Portfolio analytics are mocked.

---

### 2. Schedule (CPM)

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Task entry | ✅ | ✅ | A- | `api/routes/schedule.ts` — full CRUD |
| Finish-to-Start dependencies | ✅ | ✅ | A | `schedule_task_dependencies` table |
| CPM forward/backward pass | ✅ | ✅ | A | `api/services/cpm.ts` — full Dijkstra CPM with cycle detection |
| Critical path visualization | ✅ | 🟡 | C+ | API returns critical path IDs; frontend Gantt not verified |
| Resource leveling | ✅ | ❌ | F | Not implemented |
| P6 / MS Project import | ✅ | 🟡 Partial | C | `scheduleImport` route exists; format support not verified |
| Monte Carlo risk | ✅ | 🟡 | C | `api/routes/monteCarlo.ts` exists; depth unknown |

**Verdict:** CPM engine is genuinely real (forward/backward pass, cycle detection). No resource leveling. P6 import unverified.

---

### 3. Financial Controls

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Budget creation | ✅ | ✅ | A- | `api/routes/budgets.ts` — budget + line items |
| Change orders | ✅ | ✅ | A- | `api/routes/changeOrders.ts` — full approval workflow |
| Cost codes | ✅ | ✅ | B+ | `budgets` with code structure |
| Subcontracts | ✅ | ✅ | B | `api/routes/subcontracts.ts` |
| Earned Value (EVM) | ✅ | ✅ | A | ANSI/EIA-748 compliant — CPI/SPI/EAC verified |
| Cost control snapshot | ✅ | ✅ | B+ | `costControlService` aggregates live vs. baseline |
| Invoicing / billing | ✅ | ❌ | F | Not found in routes or services |
| Budget forecasting (AI) | ❌ | 🟡 | C | Linear regression on EVM snapshots — not true ML |

---

### 4. RFI Management

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| RFI create/respond | ✅ | ✅ | A- | `api/routes/procurement.ts` — full RFI CRUD + respond |
| Numbering scheme | ✅ | ✅ | B+ | Auto-incrementing RFI numbers per project |
| Distribution list | ✅ | 🟡 | C | Not verified from source |
| Status workflow | ✅ | ✅ | B+ | draft → open → responded → closed |
| Action integration | ✅ | ✅ | A | `createAction()` called on RFI creation |
| Ball-in-court tracking | ✅ | 🟡 | C | assigned_to exists; dedicated BIC view not found |

---

### 5. Submittal Management

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Submittal log | ✅ | ✅ | B+ | `api/routes/procurement.ts` submittals section |
| Review workflow | ✅ | ✅ | B | POST /:id/review endpoint |
| Spec section mapping | ✅ | ❌ | N/A | No spec section data model found |
| Revision tracking | ✅ | 🟡 | C | Revision tracking not verified from source |
| Action creation on review | ✅ | ✅ | A | `createAction()` wired to submittal review |

---

### 6. Document Control

| Capability | Aconex | Denver Eng | Grade | Evidence |
|-----------|--------|-----------|-------|----------|
| Document register | ✅ | ✅ | A- | `api/routes/files.ts` — full CRUD, versioning |
| Version control | ✅ | ✅ | A- | `document_versions` table, version increment on upload |
| Folder structure | ✅ | ✅ | B+ | `document_folders` with tree API |
| Transmittals | ✅ | ✅ | A- | `api/routes/transmittals.ts` — send/respond/close workflow |
| Transmittal counters | ✅ | ✅ | A | Auto-increment per project (`transmittal_counters` table) |
| Approval workflows | ✅ | 🟡 | C+ | Status lifecycle exists; multi-party approval not verified |
| ISO 19650 metadata | ✅ | 🟡 | C | Fields exist; ISO compliance enforced at UI layer only |
| OCR / text extraction | ✅ | 🟡 | C+ | AI summary in `knowledge_chunks`; OCR not confirmed |

---

### 7. Inspections & Punch Lists

| Capability | Procore | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Inspection templates | ✅ | ✅ | B+ | `api/routes/inspections.ts` — templates + instances |
| Mobile field entry | ✅ | 🟡 | C | `api/services/mobile/` exists; frontend mobile views not verified |
| Deficiency logging | ✅ | ✅ | A- | `api/routes/deficiencies.ts` |
| Fix library (AI) | ✅ | ✅ | A | Pattern mining from deficiency history — genuinely real |
| Punch list | ✅ | ✅ | A- | `api/routes/punchLists.ts` — 318 lines, full status lifecycle |
| Photo attachments | ✅ | 🟡 | C | File uploads generic; photo-specific workflow not verified |

---

### 8. Commissioning

| Capability | Trimble | Denver Eng | Grade | Evidence |
|-----------|---------|-----------|-------|----------|
| Pre-commissioning packs | ✅ | ✅ | B+ | AI-generated packs via `api/routes/commissioning.ts` |
| Test packs | ✅ | ✅ | B+ | `api/routes/testPacks.ts` |
| Test results | ✅ | ✅ | B | `api/routes/testResults.ts` |
| System test types | ✅ | ✅ | A- | PWTP, WWTP, HVAC, EPC in `system_type` enum |
| Runbooks | ✅ | ✅ | B+ | `api/routes/runbooks.ts` — step-by-step with execution tracking |
| Credit-based pack generation | ❌ | ✅ | A | Unique billing model via `billing_credits` table |

---

## Honest Assessment vs. Top Competitors

### vs. Procore (Construction Management)

| Area | Procore Score | Denver Eng Score |
|------|-------------|-----------------|
| Financial management | 95 | 72 |
| RFIs / Submittals | 95 | 70 |
| Daily field reports | 90 | 65 |
| Quality/inspections | 90 | 75 |
| Schedule | 85 | 70 |
| BIM coordination | 75 | 60 |
| Overall | **88** | **69** |

### vs. Aconex (Document Control)

| Area | Aconex Score | Denver Eng Score |
|------|-------------|-----------------|
| Document register | 95 | 80 |
| Transmittals | 95 | 82 |
| Correspondence | 90 | 30 |
| Approval workflows | 90 | 50 |
| Overall | **93** | **61** |

### vs. ACC (BIM + Field)

| Area | ACC Score | Denver Eng Score |
|------|----------|-----------------|
| BIM coordination | 95 | 55 |
| Model management | 95 | 60 |
| Clash detection | 90 | 0 |
| Field issues (from BIM) | 85 | 50 |
| Overall | **91** | **41** |

---

## Unique Differentiation

Denver Engineering has features none of the big four offer:

| Feature | Unique to Denver Eng | Evidence |
|---------|---------------------|----------|
| AI commissioning pack generation | ✅ | Credit-based AI generation |
| Embedded RAG knowledge assistant | ✅ | pgvector + Claude via Ask Jarvis |
| Fix Library (AI pattern mining) | ✅ | Deficiency pattern extraction |
| IoT sensor ingest (WWTP/PWTP) | ✅ | Full BACnet/MQTT ingest pipeline |
| Real-time process monitoring | ✅ | Threshold alerting with sensor_alerts |
| EVM + CPM in one platform | ✅ | Full ANSI/EIA-748 EVM with CPM |

---

## EPC Functional Score: 68/100

**Strengths:** Core construction workflow complete, real EVM, transmittals, commissioning.  
**Gaps:** No clash detection, no resource leveling, invoicing missing, portfolio analytics mocked.

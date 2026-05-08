# Denver Engineering — Feature Recommendation Matrix

**Version:** v4.32.0  
**Date:** 2026-05-06  
**Classification:** Internal Product Strategy

---

## How to Read This Matrix

- **Priority:** P0 = production blocker · P1 = high-value growth · P2 = strategic/competitive
- **Value:** 1–5 (5 = highest business impact)
- **Complexity:** 1–5 (5 = highest engineering effort)
- **Effort:** Story points (1 SP ≈ 1 engineering day)
- **Phase:** Which roadmap phase this belongs to

---

## Full Feature Matrix

| # | Feature | Module | Priority | Value | Complexity | Effort (SP) | Phase | Dependencies | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Global Action Center | Cross-module | P0 | 5 | 3 | 13 | 1 | All modules with `assigned_to` + `status` fields | All assigned items visible in one view; sorted by urgency; badge count on nav; one-click navigation; zero false positives |
| 2 | SLA Escalation Engine | Cross-module | P0 | 5 | 3 | 16 | 1 | complianceWatcher, all modules with due_date | Configurable SLA rules per project per module; multi-level escalation; audit log records; no escalations on terminal items |
| 3 | Project Health Score | Projects / Dashboard | P0 | 5 | 3 | 12 | 1 | EVM, Safety, Compliance, RFI, Punch data | 0–100 score with RAG banding; 5-dimension breakdown; daily kpiSnapshot job; 90-day trend chart |
| 4 | CDE Transmittal Acknowledgment | Documents (CDE) | P0 | 4 | 2 | 8 | 1 | Transmittal module, email integration | Tokenized ACK link; external acknowledgment without login; immutable timestamp; PDF audit export |
| 5 | Approval Delegation | Cross-module | P0 | 5 | 3 | 10 | 1 | All approval route handlers | Per-user, per-module, per-date-range delegation; circular delegation rejected; `delegated_from` in audit log |
| 6 | In-App Notifications | Cross-module | P1 | 5 | 2 | 10 | 1 | SLA Engine, all state-transition events | Unread count badge; panel shows 20 most recent; all SLA escalations generate notification; email digest fallback |
| 7 | Drawing → RFI / Punch Workflow | Drawings / RFIs / Punch | P1 | 4 | 1 | 6 | 1 | Drawings, RFI, Punch List modules | One-click raise from drawing; pre-populated drawing context; back-link on created record; drawing shows open item count |
| 8 | BIM Issue → RFI / Submittal / Punch | BIM / RFIs / Submittals | P1 | 4 | 1 | 5 | 1 | BIM, RFI, Submittal, Punch modules | Convert action on BIM issue; source BIM issue shown on converted record; auto-close BIM issue on child closure |
| 9 | Daily Log Auto-Summary (AI) | Daily Logs / Jarvis | P1 | 4 | 2 | 8 | 2 | Daily Logs, Claude API, Documents (CDE) | Nightly draft generation; PM reviews and approves; stored in CDE; zero auto-publish |
| 10 | RFI Response Draft Generator (AI) | RFIs / Jarvis | P1 | 4 | 2 | 8 | 2 | RFI module, Knowledge Base, Claude API | Draft only when KB confidence > 0.75; engineer submits explicitly; AI generation in audit log |
| 11 | Document Ingestion Quality Score (AI) | Knowledge Base / Jarvis | P1 | 3 | 2 | 5 | 2 | Knowledge Base, Claude haiku API | Score computed within 2 min post-ingest; poor sources flagged; score visible in KB list |
| 12 | Contextual Ask Jarvis (Project-Scoped) | Jarvis AI | P1 | 4 | 2 | 6 | 2 | Ask Jarvis, Knowledge Base | Project-scoped retrieval first; citations labeled by scope; toggle to disable |
| 13 | Commissioning Readiness Dashboard | Commissioning | P1 | 5 | 3 | 13 | 2 | Test Packs, Punch, RFI, Compliance, Inspections | Go/No-Go per system; blocking items listed with links; PDF export; real-time refresh |
| 14 | AI Punch Item Standardizer | Punch List / Jarvis | P1 | 3 | 1 | 4 | 2 | Punch List, Claude haiku API | Suggestion non-blocking; user accepts explicitly; `ai_standardized` tag |
| 15 | JHA Auto-Draft Generator (AI) | Safety / Jarvis | P1 | 4 | 2 | 8 | 2 | Safety (JHAs), Claude API | Draft in < 20 sec; control hierarchy used; safety officer approves explicitly; labeled AI Draft |
| 16 | Weekly Status Report Generator (AI) | Projects / Jarvis | P1 | 4 | 2 | 8 | 2 | Projects, EVM, Safety, RFI, Submittals, Claude API | Generated in < 60 sec; all metrics from live data; PM explicitly publishes; stored in CDE |
| 17 | Mobile-Responsive Field UI | Cross-module (field) | P1 | 5 | 4 | 16 | 3 | Daily Logs, Punch, RFIs, Safety, Tags components | All 5 field views usable on 375px screen; 48px touch targets; bottom nav bar |
| 18 | Offline Daily Log Entry | Daily Logs | P1 | 5 | 3 | 12 | 3 | offlineQueue module, Daily Logs | Log entry works without network; auto-sync on reconnect; conflicts surfaced to user; no silent data loss |
| 19 | QR Code Tag / Equipment Lookup | Systems / Tags | P1 | 4 | 1 | 6 | 3 | Systems / Tags module | QR per tag; mobile page loads in < 2 sec without login; print label (A4); token-scoped access |
| 20 | Offline Punch Item Create / Update | Punch List | P1 | 4 | 3 | 8 | 3 | offlineQueue, Punch List | Punch items created/updated offline; photos queued; sync conflicts surfaced |
| 21 | Non-Conformance Reports (NCR) | Construction / Quality | P1 | 5 | 3 | 13 | 3 | Inspections, Drawings, Submittals, Punch | Full NCR lifecycle; linkable to source records; exportable log; searchable for trend analysis |
| 22 | Global Search | Cross-module | P1 | 4 | 3 | 10 | 3 | All modules with FTS columns | Results from all modules in < 500ms; grouped by module; ⌘K shortcut |
| 23 | Client Portal | Cross-module | P2 | 5 | 5 | 20 | 4 | Projects, RFIs, Submittals, Transmittals, Commissioning | Client users isolated; fully read-only; PM controls visibility; invitation-only; no internal cost data |
| 24 | Schedule Impact Tracker | Projects / Budget / RFIs | P1 | 4 | 3 | 10 | 4 | Budget (COs), Daily Logs, RFIs | All delay sources auto-populated; EOT entitlement accurate; PDF export for contract notices |
| 25 | Integration Health Dashboard | Integrations / System | P2 | 3 | 1 | 6 | 4 | Integrations module, sync_jobs | All integrations with RAG status; 1-hour error alert; manual retry; 30-day sync history |
| 26 | Vendor Risk Score | Procurement / Vendors | P1 | 4 | 3 | 8 | 4 | POs, Inspections, Safety, RFIs, Submittals, Vendor Directory | 0–100 score; dimension breakdown; recomputed on data change; shown in RFQ bid comparison |
| 27 | Handover Package Generator | Commissioning / Documents | P1 | 5 | 4 | 18 | 4 | Test Packs, Inspections, Punch, Documents, Knowledge Base | Cover sheet + TOC + ZIP per system; missing items listed; stored in CDE; generation history |
| 28 | Procurement Anomaly Detection | Procurement | P2 | 4 | 3 | 8 | 4 | POs, RFQs, Vendor Directory | Rule-based flags visible to Owner/Admin only; dismissible with justification; dismissed in audit log |
| 29 | MFA (Multi-Factor Authentication) | System / Auth | P1 | 5 | 3 | 12 | 5 | Auth module | TOTP-based; admin can enforce tenant-wide; recovery codes; MFA events in audit log |
| 30 | Tenant Feature Flags | System / Admin | P1 | 4 | 1 | 6 | 5 | Tenant module, NavSidebar, all route modules | Disabled modules hidden from nav and return 403 on API; changes take effect in one session |
| 31 | Audit Chain Verification Dashboard | System / Audit | P2 | 3 | 2 | 6 | 5 | Audit log module | Date gaps flagged; full CSV/JSON export; Owner-only access |
| 32 | Session Timeout | System / Auth | P1 | 4 | 1 | 3 | 5 | Auth / JWT module | Idle timeout at configurable threshold; warning modal 2 min before; configurable per tenant |
| 33 | Safety Incident Trend Detection | Safety | P2 | 4 | 3 | 8 | 5 | Safety (Incidents), Action Items | Daily trend analysis; alerts for location/body-part/type clusters; dismiss requires corrective action |
| 34 | Contract Change Impact Simulator | Budget / Projects | P2 | 4 | 3 | 8 | 5 | Budget, Projects (EVM) | Simulation in < 3 sec; labeled "Simulated — Not Approved"; non-destructive; PDF export |
| 35 | Document Expiry Alerts | Documents / Compliance | P2 | 3 | 1 | 5 | 5 | Documents, Compliance, Action Center | Alerts N days before expiry; expired items flagged; surface in Action Center; admin-configurable N |
| 36 | Proposal Draft Generator (AI) | CRM / Jarvis | P2 | 4 | 2 | 8 | 5 | CRM, Claude API, Documents (CDE) | Draft in < 60 sec; labeled "AI Draft"; all sections editable; stored in CDE as WIP; no auto-submit |
| 37 | Win/Loss Pattern Analysis (AI) | CRM / Jarvis | P2 | 3 | 2 | 6 | 5 | CRM (closed opportunities), Claude API | Monthly report; min 10 opportunities required; top win/loss factors; probabilistic language |
| 38 | Commissioning Readiness Risk Briefing (AI) | Commissioning / Jarvis | P1 | 4 | 2 | 6 | 2 | Commissioning Readiness Dashboard, Claude API | Briefing in < 30 sec; grounded in platform data; CM reviews before sharing; PDF export |
| 39 | Test Pack Batch Generation (AI) | Commissioning / Jarvis | P1 | 5 | 3 | 10 | 2 | Commissioning (Test Packs), Knowledge Base, Claude API | Batch generation for system with ≤ 20 tags in < 5 min; all packs in draft; source citations per step; flagged unknowns |
| 40 | Bid Evaluation Narrative (AI) | Procurement / Jarvis | P2 | 3 | 2 | 6 | 4 | RFQs (bid scores), Claude API, Documents (CDE) | Memo in < 30 sec; recommendation section accurate; stored as CDE S3 doc; PM approves before publish |
| 41 | RFQ Scope Extraction (AI) | Procurement / Jarvis | P2 | 4 | 2 | 8 | 4 | Knowledge Base, RFQ module, Claude API | Extraction in < 90 sec for 100-page spec; items editable; page references shown; uncertain items flagged |
| 42 | Equipment Data Sheet Extraction (AI) | Knowledge Base / Tags / Jarvis | P2 | 4 | 3 | 10 | 4 | Knowledge Base, Systems/Tags, Claude API | ≥ 80% extraction accuracy; all data in review table before tag creation; confidence per field; approval required |
| 43 | Safety Incident Root Cause Classifier (AI) | Safety / Jarvis | P2 | 3 | 2 | 5 | 4 | Safety (Incidents), Claude haiku API | Suggestion in < 5 sec; confidence score shown; officer can override; low confidence = no suggestion |
| 44 | Compliance Task Risk Scoring (AI) | Compliance / Jarvis | P2 | 3 | 2 | 5 | 4 | Compliance, Claude haiku API | Risk score assigned on task creation; rationale shown; compliance manager can override |
| 45 | Subcontractor / Vendor Portal | Procurement / Field | P2 | 4 | 5 | 20 | 5 | Procurement, Punch, Daily Logs, RFIs | Scoped to specific projects/contracts; can submit own logs; cannot see other subs' data; submissions flagged in audit log |
| 46 | Progress Payment Certificates | Budget / Procurement | P1 | 5 | 4 | 16 | 5 | Budget (invoiced_amount), Contracts | Full invoice → certificate lifecycle; linked to contract value; PM approves before sending; stored in CDE |
| 47 | Non-Conformance to ITP Link | Quality / Inspections | P2 | 4 | 3 | 10 | 5 | NCR module, Inspections | ITP defines hold/witness points; NCR raised from ITP hold failure; ITP completion tracked per activity |
| 48 | Commissioning AI Anomaly Detection | Commissioning / Jarvis | P2 | 4 | 2 | 6 | 4 | Test Results, Baselines, Claude haiku API | Narrative generated only for `queued_novelty`; 2–3 sentences; human accepts/rejects; AI advisory only |
| 49 | Transmittal Cover Sheet Auto-Draft (AI) | Documents / Jarvis | P2 | 3 | 1 | 4 | 4 | Documents (CDE), Transmittals, Claude haiku API | Draft in < 10 sec; editable before sending; user explicitly sends; cover sheet PDF attached to transmittal |
| 50 | Jarvis Next Best Action Engine | Jarvis / Dashboard | P1 | 4 | 3 | 10 | 2 | Action Center, all modules, Claude API | 3–5 suggestions per user on login; specific record names; dismissible; no repeat within 24h |

---

## Matrix Sorted by Priority + Value

| Priority | Feature | Value | Complexity | Effort | Phase |
|---|---|---|---|---|---|
| P0 | Global Action Center | 5 | 3 | 13 SP | 1 |
| P0 | SLA Escalation Engine | 5 | 3 | 16 SP | 1 |
| P0 | Project Health Score | 5 | 3 | 12 SP | 1 |
| P0 | Approval Delegation | 5 | 3 | 10 SP | 1 |
| P0 | CDE Transmittal Acknowledgment | 4 | 2 | 8 SP | 1 |
| P1 | Handover Package Generator | 5 | 4 | 18 SP | 4 |
| P1 | Commissioning Readiness Dashboard | 5 | 3 | 13 SP | 2 |
| P1 | Test Pack Batch Generation (AI) | 5 | 3 | 10 SP | 2 |
| P1 | Non-Conformance Reports (NCR) | 5 | 3 | 13 SP | 3 |
| P1 | Mobile-Responsive Field UI | 5 | 4 | 16 SP | 3 |
| P1 | Offline Daily Log Entry | 5 | 3 | 12 SP | 3 |
| P1 | In-App Notifications | 5 | 2 | 10 SP | 1 |
| P1 | MFA (Multi-Factor Authentication) | 5 | 3 | 12 SP | 5 |
| P1 | Progress Payment Certificates | 5 | 4 | 16 SP | 5 |
| P1 | Drawing → RFI / Punch Workflow | 4 | 1 | 6 SP | 1 |
| P1 | Daily Log Auto-Summary (AI) | 4 | 2 | 8 SP | 2 |
| P1 | RFI Response Draft Generator (AI) | 4 | 2 | 8 SP | 2 |
| P1 | Contextual Ask Jarvis | 4 | 2 | 6 SP | 2 |
| P1 | BIM Issue → RFI / Submittal / Punch | 4 | 1 | 5 SP | 1 |
| P1 | Weekly Status Report Generator (AI) | 4 | 2 | 8 SP | 2 |
| P1 | QR Code Tag / Equipment Lookup | 4 | 1 | 6 SP | 3 |
| P1 | Offline Punch Item Create/Update | 4 | 3 | 8 SP | 3 |
| P1 | Commissioning Readiness Briefing (AI) | 4 | 2 | 6 SP | 2 |
| P1 | Vendor Risk Score | 4 | 3 | 8 SP | 4 |
| P1 | Global Search | 4 | 3 | 10 SP | 3 |
| P1 | Schedule Impact Tracker | 4 | 3 | 10 SP | 4 |
| P1 | Jarvis Next Best Action Engine | 4 | 3 | 10 SP | 2 |
| P1 | Tenant Feature Flags | 4 | 1 | 6 SP | 5 |
| P1 | Session Timeout | 4 | 1 | 3 SP | 5 |
| P1 | JHA Auto-Draft Generator (AI) | 4 | 2 | 8 SP | 2 |
| P2 | Client Portal | 5 | 5 | 20 SP | 4 |
| P2 | RFQ Scope Extraction (AI) | 4 | 2 | 8 SP | 4 |
| P2 | Equipment Data Sheet Extraction (AI) | 4 | 3 | 10 SP | 4 |
| P2 | Subcontractor / Vendor Portal | 4 | 5 | 20 SP | 5 |
| P2 | Non-Conformance to ITP Link | 4 | 3 | 10 SP | 5 |
| P2 | Procurement Anomaly Detection | 4 | 3 | 8 SP | 4 |
| P2 | Safety Incident Trend Detection | 4 | 3 | 8 SP | 5 |
| P2 | Contract Change Impact Simulator | 4 | 3 | 8 SP | 5 |
| P2 | Commissioning AI Anomaly Detection | 4 | 2 | 6 SP | 4 |
| P2 | Proposal Draft Generator (AI) | 4 | 2 | 8 SP | 5 |
| P2 | Audit Chain Verification Dashboard | 3 | 2 | 6 SP | 5 |
| P2 | Integration Health Dashboard | 3 | 1 | 6 SP | 4 |
| P2 | Document Ingestion Quality Score (AI) | 3 | 2 | 5 SP | 2 |
| P2 | AI Punch Item Standardizer | 3 | 1 | 4 SP | 2 |
| P2 | Safety Root Cause Classifier (AI) | 3 | 2 | 5 SP | 4 |
| P2 | Compliance Task Risk Scoring (AI) | 3 | 2 | 5 SP | 4 |
| P2 | Document Expiry Alerts | 3 | 1 | 5 SP | 5 |
| P2 | Bid Evaluation Narrative (AI) | 3 | 2 | 6 SP | 4 |
| P2 | Win/Loss Pattern Analysis (AI) | 3 | 2 | 6 SP | 5 |
| P2 | Transmittal Cover Sheet Auto-Draft (AI) | 3 | 1 | 4 SP | 4 |

---

## Effort Summary by Phase

| Phase | Features | Total Effort (SP) | Duration |
|---|---|---|---|
| Phase 1 — Workflow Closure | 8 features | ~80 SP | 8 weeks |
| Phase 2 — AI Automation | 10 features | ~82 SP | 6 weeks |
| Phase 3 — Field / Mobile | 6 features | ~65 SP | 8 weeks |
| Phase 4 — Analytics & Integrations | 12 features | ~96 SP | 8 weeks |
| Phase 5 — Enterprise Hardening | 14 features | ~95 SP | 6 weeks |
| **Total** | **50 features** | **~418 SP** | **~36 weeks** |

---

## Quick Wins (< 6 SP, high value)

These can be shipped in any sprint as filler without blocking the phase structure:

| Feature | Priority | Effort |
|---|---|---|
| Drawing → RFI / Punch Workflow | P1 | 6 SP |
| BIM Issue → RFI / Submittal / Punch | P1 | 5 SP |
| QR Code Tag / Equipment Lookup | P1 | 6 SP |
| AI Punch Item Standardizer | P2 | 4 SP |
| Transmittal Cover Sheet Auto-Draft (AI) | P2 | 4 SP |
| Tenant Feature Flags | P1 | 6 SP |
| Session Timeout | P1 | 3 SP |
| Document Expiry Alerts | P2 | 5 SP |
| Document Ingestion Quality Score (AI) | P2 | 5 SP |
| Safety Root Cause Classifier (AI) | P2 | 5 SP |
| Compliance Task Risk Scoring (AI) | P2 | 5 SP |
| Audit Chain Verification Dashboard | P2 | 6 SP |
| Integration Health Dashboard | P2 | 6 SP |

---

*Denver Engineering v4 — Proprietary. All rights reserved.*

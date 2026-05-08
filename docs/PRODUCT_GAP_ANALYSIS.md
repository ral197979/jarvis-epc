# Denver Engineering — Product Gap Analysis

**Version:** v4.32.0  
**Date:** 2026-05-06  
**Classification:** Internal Product Strategy  
**Benchmark:** Enterprise EPC / construction management platform expectations (Procore, Aconex, Primavera P6, Bentley ProjectWise, e-Builder)

---

## Executive Summary

Denver Engineering v4.32.0 covers the foundational EPC lifecycle comprehensively. The platform is structurally sound with 34 lifecycle modules, a working AI layer, multi-tenancy, RBAC, and ISO 19650 CDE alignment. However, compared to what enterprise clients expect before committing to a platform for live project delivery, three categories of gaps are critical:

1. **Workflow completeness gaps** — key transitions exist in the data model but have no UI workflow to drive them (e.g., no approval delegation, no escalation engine, no inter-module linking at the point of creation).
2. **Depth gaps** — modules exist but are too shallow for real project use (e.g., RFI has status tracking but no formal distribution list, no due date enforcement, no RFI log export for client).
3. **Missing entire workflows** — some EPC-critical capabilities are entirely absent (e.g., schedule baseline and critical path, material tracking / MTO, non-conformance reports, handover package assembly).

**Overall Assessment:** Denver Engineering is a strong MVP with real production architecture. It is **demo-ready and pilot-ready** for small to mid-size projects. It is **not yet enterprise-ready** for projects > $50M or for clients who have used Procore or Aconex.

---

## 1. Coverage vs Enterprise Expectations

### 1A. CRM & Tendering

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Lead pipeline tracking | Full CRM with pipeline stages | ✅ Implemented | — |
| Proposal builder | Structured proposal with line items and pricing | ❌ Missing | Full module gap |
| Bid/no-bid decision register | Formal go/no-bid decision with rationale | ❌ Missing | Full module gap |
| Pre-qualification tracking | Vendor pre-qual linked to CRM | ⚠️ Partial (vendor dir exists, no CRM link) | Integration gap |
| Opportunity-to-contract conversion | CRM win → auto-creates project | ❌ Missing | Automation gap |

**Summary:** CRM is functional for pipeline visibility but stops short of a full tendering workflow. The gap between a CRM lead and a live project requires manual steps outside the platform.

---

### 1B. Projects & Schedule

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Project status & KPIs | Full project health dashboard | ✅ Implemented | — |
| EVM (CPI/SPI/VAC) | Earned value metrics | ✅ Implemented | — |
| Critical Path Method (CPM) schedule | Full CPM with WBS, predecessors, float | ❌ Missing | Major gap |
| Gantt chart | Visual timeline with milestones | ⚠️ Partial (milestones only) | Depth gap |
| Schedule baseline | Baseline vs actual comparison | ❌ Missing | Major gap |
| Schedule delay analysis | Float consumption, critical path slippage | ❌ Missing | Major gap |
| Resource-loaded schedule | Labour and equipment allocation per activity | ❌ Missing | Major gap |
| WBS (Work Breakdown Structure) | Hierarchical work decomposition | ❌ Missing | Major gap |
| Look-ahead schedule | 2-week / 4-week rolling schedule | ❌ Missing | Depth gap |
| Risk register | Risk identification and mitigation | ⚠️ Partial (RiskView exists, shallow) | Depth gap |

**Summary:** The schedule gap is the largest gap in the platform. Denver Engineering has milestones and EVM but no CPM engine. On projects where schedule is a contract deliverable (most EPC projects), this is a blocker. Clients expect P6 or MS Project integration at minimum.

**Recommended Approach:** Do not build a native CPM engine. Integrate with Primavera P6 (via XML import/export) or with a lightweight CPM library for internal use. Surface schedule data in the Denver UI but treat the CPM engine as an integration target.

---

### 1C. Budget & Cost Control

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Budget with cost codes | Line-item budget by cost code | ✅ Implemented | — |
| Change order workflow (PCO/CCO) | Full PCO → CCO lifecycle | ✅ Implemented | — |
| EVM computation | CPI, SPI, VAC | ✅ Implemented | — |
| Cost forecasting | S-curve / forecast to complete | ⚠️ Partial (forecast field exists) | Depth gap |
| Invoice management | Invoice register, matching to POs, payment tracking | ⚠️ Partial (invoiced_amount field only) | Depth gap |
| Progress payment certificates | Formal payment claim → certificate workflow | ❌ Missing | Full module gap |
| Cost code mapping to schedule | Cost codes linked to WBS activities | ❌ Missing | Integration gap |
| Contingency drawdown tracking | Formal contingency release workflow | ❌ Missing | Depth gap |
| Multi-currency | Multiple currencies per project | ❌ Missing | Enterprise gap |
| Tax and retention management | GST/VAT, retention hold/release | ❌ Missing | Enterprise gap |

**Summary:** Budget module covers the basics well but lacks invoice and payment management — meaning the financial lifecycle is incomplete. A project can have an approved CO but the platform cannot track whether the resulting invoice has been received or paid. This forces finance teams to maintain parallel spreadsheets.

---

### 1D. Procurement

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| PO lifecycle (9 stages) | Full PO management | ✅ Implemented | — |
| RFQ with bidder comparison | Bid tabulation | ✅ Implemented | — |
| Vendor prequalification | Vendor status tracking | ✅ Implemented | — |
| Material Tracking Order (MTO) | Line-item material quantities, delivery tracking | ❌ Missing | Major gap |
| Material receiving (GRN) | Goods receipt note against PO line items | ❌ Missing | Major gap |
| Inspection at receipt | Quality inspection linked to PO delivery | ❌ Missing | Integration gap |
| Expediting | Vendor expediting schedule, overdue alerts | ❌ Missing | Depth gap |
| Supplier performance scorecard | Formal scorecard per vendor per project | ⚠️ Partial (rating field only) | Depth gap |
| Procurement plan / schedule | Procurement schedule linked to project timeline | ⚠️ Partial (PlannerView is a stub) | Depth gap |
| Long-lead register | Flagged items with extended lead times | ❌ Missing | Depth gap |

**Summary:** Procurement covers requisition to PO well but misses the receiving and material tracking side. On construction sites, knowing that a material has arrived (GRN) and passed incoming inspection is as important as placing the order. This gap means the procurement lifecycle ends at "delivered" status without evidence verification.

---

### 1E. Construction & Field

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Daily logs | Procore-parity daily logs | ✅ Implemented | — |
| Drawings register with revisions | ISO 19650 revision control | ✅ Implemented | — |
| BIM viewer + clash detection | Model viewer with issue tracking | ✅ Implemented | — |
| RFIs | Full RFI lifecycle | ✅ Implemented | — |
| Submittals | Full submittal review lifecycle | ✅ Implemented | — |
| Punch list | 6-stage lifecycle | ✅ Implemented | — |
| Non-Conformance Reports (NCRs) | Formal NCR workflow | ❌ Missing | Major gap |
| Drawing markups (collaborative) | Multi-user markup with annotation tools | ⚠️ Partial (basic markup exists) | Depth gap |
| Meeting minutes | Formal meeting record with actions | ❌ Missing | Module gap |
| Correspondence log | Formal letter / notice register | ❌ Missing | Module gap |
| Time-lapse / photo log | Structured site photo register | ⚠️ Partial (photos in daily logs, no gallery) | Depth gap |
| Quantity tracking / production rates | Installed quantities vs planned | ❌ Missing | Major gap |
| Method statements | Formal method statement approval workflow | ❌ Missing | Module gap |

**Summary:** The construction module is strong on documentation workflows (RFIs, submittals, drawings) but weak on quality management (NCRs are a critical gap) and production tracking (quantities installed). NCRs are the formal mechanism for documenting and resolving non-conforming work — their absence means quality failures are tracked only informally in punch items.

---

### 1F. Commissioning

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Test packs with steps | Full pre-comm / functional test packs | ✅ Implemented | — |
| Test results (pass/fail/na) | Per-step result tracking | ✅ Implemented | — |
| Commissioning items | Coverage tracking | ✅ Implemented | — |
| AI pack generation from IOM | Automated pack drafting | ✅ Implemented | — |
| Deficiency tracking | Linked to test failures | ✅ Implemented | — |
| Commissioning readiness dashboard | Go/No-Go per system | ❌ Missing | P1 gap (recommended) |
| Handover package generator | Automated handover dossier | ❌ Missing | P1 gap (recommended) |
| Loop diagrams / instrument index | P&ID-driven instrumentation tracking | ❌ Missing | Major gap |
| Punch categorization (A/B/C) | A = safety, B = functional, C = cosmetic | ⚠️ Partial (priority field, not formal A/B/C) | Depth gap |
| Certificate of Completion (CoC) | Formal system completion certificate | ❌ Missing | Module gap |
| Mechanical Completion (MC) | Formal MC declaration per system | ❌ Missing | Module gap |
| Pre-startup Safety Review (PSSR) | Safety review before energization | ❌ Missing | Major gap |

**Summary:** Commissioning is the strongest area of Denver Engineering relative to competitors. The test pack engine and AI generation are genuine differentiators. However, two critical gaps exist: PSSR (Pre-Startup Safety Review) is a regulatory requirement before energizing any system in oil & gas or chemical processing, and Mechanical Completion is the formal handover milestone from construction to commissioning. Without these, the platform cannot manage the commissioning-to-operations transition.

---

### 1G. Safety (HSE)

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Incident register | Full incident lifecycle | ✅ Implemented | — |
| JHAs | Job Hazard Analysis | ✅ Implemented | — |
| Work permits | Permit to work system | ✅ Implemented | — |
| TRIR / safety KPIs | Key safety metrics | ✅ Implemented | — |
| Toolbox talks | Attendance tracking | ✅ Implemented | — |
| Contractor safety management | Per-contractor safety performance | ⚠️ Partial (incidents only) | Depth gap |
| Safety inspection rounds | Mobile safety audit forms | ❌ Missing | Module gap |
| Emergency response plans | Document storage + drill tracking | ❌ Missing | Module gap |
| Leading indicator tracking | Near-miss rate, observation rate, training completion | ⚠️ Partial (near-miss in incidents) | Depth gap |
| Drug & alcohol testing records | Test result register | ❌ Missing | Enterprise gap |
| HSE statistics dashboard | Peer comparison, trend analysis | ⚠️ Partial (basic KPIs) | Depth gap |

**Summary:** Safety is well-implemented for incident tracking and permit management. The gap is in proactive/leading indicator tracking — safety inspection rounds, observation cards, and contractor performance comparison. Enterprise clients expect leading indicators, not just lagging indicators.

---

### 1H. Compliance & Documents

| Capability | Enterprise Expectation | Denver Status | Gap |
|---|---|---|---|
| Compliance task lifecycle | Full task tracking with escalation | ✅ Implemented | — |
| ISO 19650 CDE | CDE state tracking | ✅ Implemented | — |
| Transmittal workflow | Transmittal register | ✅ Implemented | — |
| Transmittal acknowledgment | Recipient acknowledgment tracking | ❌ Missing | P0 gap |
| Document numbering (ISO 19650) | Structured document numbering | ⚠️ Partial (naming convention defined, not enforced) | Depth gap |
| Document expiry / re-issue alerts | Alerts for expiring certs or standards | ❌ Missing | Depth gap |
| External regulatory submissions | Track submissions to regulatory bodies | ❌ Missing | Module gap |
| QA/QC plan | Formal ITP (Inspection Test Plan) | ❌ Missing | Major gap |
| Inspection Test Plan (ITP) | ITP linked to inspection records | ❌ Missing | Major gap |

**Summary:** The Inspection Test Plan is the master document governing quality for a construction project — it defines every hold point, witness point, and review point for every activity. Without an ITP module, Denver Engineering lacks the backbone of a quality management system (QMS). This is a significant gap for any project requiring third-party quality certification.

---

## 2. Shallow Workflows — Depth Gaps

These modules exist but lack the depth required for real project delivery.

### 2-01 · Risk Register (RiskView)

**Current state:** A basic risk register with title, priority, and description. No formal risk matrix (likelihood × consequence), no risk treatment plan, no risk owner, no residual risk tracking, no Monte Carlo simulation.

**What's needed:** Risk matrix scoring, risk response plans (accept/mitigate/transfer/avoid), residual risk tracking after controls, risk review schedule, and linkage to schedule and cost contingency.

---

### 2-02 · Engineering Calculations (CalcView)

**Current state:** Exists as a placeholder with a basic session storage structure. No calculation engine, no revision control on calculations, no checking/approval workflow.

**What's needed:** Calculation register with revision control (A, B, C), checking and approval workflow (engineer checks, senior engineer approves), status tracking (draft → checked → approved), and storage of input parameters and results. Many EPC clients require as-built calculation packages as a contract deliverable.

---

### 2-03 · Procurement Planner (PlannerView)

**Current state:** Listed as a stub / coming soon. No implementation.

**What's needed:** A procurement schedule linked to the project timeline — showing requisition dates, RFQ issue dates, bid receipt dates, award dates, manufacturing completion dates, and delivery dates per long-lead item. This drives the procurement critical path.

---

### 2-04 · BIM Model Viewer

**Current state:** BIM model register with format/metadata tracking and clash issue management. No in-browser 3D viewer.

**What's needed:** Integration with Autodesk Platform Services (APS/Forge) or IFC.js for in-browser model viewing, element selection, and measurement. Users expect to view models in the browser, not download and open in Revit. This is a P2 integration (not a P0 gap) but is a significant UX gap.

---

### 2-05 · Field Operations (FeView / WtView)

**Current state:** Tab views exist but appear to be shells with limited structured data.

**What's needed:** Structured tracking of installed quantities per activity (pipes welded, cable pulled, formwork placed), production rates (actual vs planned), work front assignments, and crew performance by activity. This data is what drives the construction S-curve and EVM.

---

### 2-06 · Drawing Markup Collaboration

**Current state:** Markups are stored as JSONB annotations but there is no collaborative overlay — multiple users cannot mark up the same sheet simultaneously, and there is no PDF viewer with markup overlay.

**What's needed:** PDF viewer integration (PDF.js) with overlay of stored markups, multi-user markup visibility, and filtered views (show my markups, show unresolved markups, show markups by discipline).

---

## 3. Duplicate / Overlapping Modules

### 3-01 · Punch List vs Deficiencies

**Overlap:** Punch items and deficiencies both track rectification work items. The distinction (deficiencies are test-traced, punch items are field-observed) is architecturally sound but is not clear in the UI. Users may create punch items for what should be deficiencies and vice versa.

**Recommendation:** Add a "Raise Deficiency" action from the test result detail and a "Convert to Punch" action from a deficiency — making the intended flow explicit. Add in-app documentation explaining when to use each.

---

### 3-02 · Action Items vs Compliance Tasks

**Overlap:** Both track tasks assigned to users with due dates. The distinction (compliance tasks = regulatory obligations, action items = project-level corrective actions) is meaningful but not obvious.

**Recommendation:** Add `source_module` and `source_record_id` to action items so they can be linked as children of compliance tasks, incidents, RFIs, or inspections. This clarifies the relationship: compliance tasks can spawn action items when they require corrective work.

---

### 3-03 · Documents vs Knowledge Base

**Overlap:** Both store documents. The distinction (CDE/Documents = live project documents in a structured lifecycle; Knowledge Base = reference material for AI retrieval) is architecturally correct but UX-confusing.

**Recommendation:** Add a clear "Add to Knowledge Base" action from a finalized/published CDE document. O&M manuals, specifications, and as-built documents published in CDE should automatically be ingested into the Knowledge Base. This removes the need to upload twice.

---

### 3-04 · Commissioning Packs vs Test Packs

**Overlap:** The platform has both "commissioning packs" (AI-generated deliverables from the pack worker) and "test packs" (structured pre-comm/functional test packages per system). These are related but distinct concepts that may confuse new users.

**Recommendation:** Rename "Commissioning Packs" to "Pack Documents" (to distinguish AI-generated PDF deliverables from test execution packs). Add cross-links: a Test Pack shows its associated Pack Documents; a Pack Document shows its source Test Pack.

---

## 4. Missing Enterprise Workflows

The following workflows are entirely absent and should be planned for inclusion within 6–12 months:

| Workflow | Priority | Why It Matters |
|---|---|---|
| Non-Conformance Reports (NCR) | P1 | Required by ISO 9001 and most quality plans; punch items are not a substitute |
| Inspection Test Plan (ITP) | P1 | Master quality document — defines every hold/witness point for every activity |
| Progress Payment Certificates | P1 | Required for contractor payment on all contract types |
| Mechanical Completion Register | P1 | Formal milestone between construction and commissioning |
| Pre-Startup Safety Review (PSSR) | P1 | Regulatory requirement before energization in oil & gas |
| Meeting Minutes | P2 | Formal record of project decisions; links to action items |
| Correspondence Log | P2 | Formal contract letter/notice register |
| Method Statements | P2 | Pre-approval of high-risk activities |
| Material Tracking / MTO | P2 | Track materials from procurement through installation |
| Goods Receipt Notes (GRN) | P2 | Receive materials against PO line items with inspection |
| Certificate of Completion (CoC) | P2 | System-level completion certification |
| CPM Schedule Integration | P2 | Critical path scheduling (via P6 integration) |
| QR Code Tag Lookup | P1 | Field-readiness requirement (recommended in FEATURE_RECOMMENDATIONS.md) |

---

## 5. UX Gaps

### 5-01 · No Mobile-Optimized View

**Impact:** Field workers use phones and tablets. The current UI is desktop-first. RFI responses, punch item updates, and daily log entry are difficult on mobile.

**Minimum Viable Mobile:** Responsive layout for the 5 most common field actions: daily log entry, punch item creation/update, RFI viewing, QR code tag lookup, and safety incident reporting.

---

### 5-02 · No Offline Mode for Field

**Impact:** Construction sites have poor connectivity. Field workers cannot reliably use a web app that requires constant connectivity.

**Minimum Viable Offline:** Offline queue for daily log entry and punch item creation/update. Data syncs when connection is restored. The `offlineQueue` module exists in the codebase but is not surfaced in the field UI.

---

### 5-03 · No In-App Notifications

**Impact:** All action items and escalations require the user to visit the platform. Without push notifications or in-app alert delivery, users miss time-sensitive items.

**Minimum Viable:** In-app notification bell with unread count + email digest. The notification infrastructure is partially stubbed (Notifications nav item exists as "coming soon").

---

### 5-04 · No Global Search

**Impact:** Users cannot search across modules for a tag number, drawing number, or vendor name. They must navigate to the correct module and search within it.

**Minimum Viable:** A global search bar that queries across: projects, RFIs, punch items, drawings, vendors, tags, documents, and knowledge base sources. Returns results grouped by module.

---

### 5-05 · No Keyboard Shortcuts or Command Palette

**Impact:** Power users — PMs, engineers, and commissioning managers — perform repetitive navigation. The CmdPalette component exists in the codebase but appears to be an early-stage implementation.

**Minimum Viable:** Activate the existing CmdPalette with keyboard shortcut (⌘K), populated with the most common actions and recently visited records.

---

## 6. Security & Hardening Gaps

| Gap | Severity | Description |
|---|---|---|
| No MFA | High | Multi-factor authentication is absent. Required for SOC 2 Type II. |
| No session timeout | Medium | JWT refresh tokens have no enforced idle timeout. |
| No IP allowlisting | Medium | Tenant admins cannot restrict access to known IP ranges. |
| No API rate limiting per route | Medium | Global rate limiting exists but per-endpoint rate limiting for sensitive routes (auth, bulk operations) is not confirmed. |
| No field-level encryption | Low | Sensitive fields (contract values, personal injury details) are stored in plaintext. |
| Audit log has no tamper detection | Medium | Audit records are mutable at the DB level — no hash chain or append-only enforcement at storage layer. |
| No data retention policy enforcement | Low | Audit retention handler exists but no tenant-configurable data retention periods for other modules. |

---

## 7. Summary Scorecard

| Category | Current Score | Target (Enterprise-Ready) | Gap |
|---|---|---|---|
| CRM & Tendering | 5/10 | 8/10 | Missing proposal builder, bid workflow |
| Projects & Schedule | 6/10 | 9/10 | Missing CPM schedule |
| Budget & Cost | 6/10 | 8/10 | Missing invoice/payment management |
| Procurement | 7/10 | 9/10 | Missing MTO and GRN |
| Construction & Field | 7/10 | 9/10 | Missing NCR and ITP |
| Commissioning | 8/10 | 9/10 | Missing MC and PSSR |
| Safety | 7/10 | 8/10 | Shallow leading indicators |
| Compliance & Docs | 7/10 | 9/10 | Missing ITP, NCR linkage |
| AI Layer | 7/10 | 9/10 | Many use cases unrealized |
| UX / Mobile | 4/10 | 8/10 | No mobile, no offline, no global search |
| Security | 5/10 | 9/10 | No MFA, audit log tamper risk |
| **Overall** | **6.3/10** | **8.7/10** | **Significant gaps remain** |

---

*Denver Engineering v4 — Proprietary. All rights reserved.*

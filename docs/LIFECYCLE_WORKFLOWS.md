# Denver Engineering — Lifecycle Workflow Documentation

**Version:** v4.32.0  
**Last Updated:** 2026-05-06  
**Scope:** All customer-facing modules

---

## Table of Contents

1. [CRM & Sales](#1-crm--sales)
2. [Projects & Contracts](#2-projects--contracts)
3. [Budget & Change Orders](#3-budget--change-orders)
4. [Procurement — Purchase Orders](#4-procurement--purchase-orders)
5. [Procurement — RFQs](#5-procurement--rfqs)
6. [Vendors & Directory](#6-vendors--directory)
7. [Daily Logs](#7-daily-logs)
8. [Drawings & Revisions](#8-drawings--revisions)
9. [Drawing Markups](#9-drawing-markups)
10. [BIM Models & Issues](#10-bim-models--issues)
11. [Submittals](#11-submittals)
12. [RFIs](#12-rfis)
13. [Punch List Items](#13-punch-list-items)
14. [Inspections](#14-inspections)
15. [Deficiencies](#15-deficiencies)
16. [Work Inspection Records (WIRs)](#16-work-inspection-records-wirs)
17. [Commissioning — Test Packs](#17-commissioning--test-packs)
18. [Commissioning — Test Results](#18-commissioning--test-results)
19. [Commissioning — Items](#19-commissioning--items)
20. [Commissioning — Packs (Generated)](#20-commissioning--packs-generated)
21. [Commissioning — Baselines](#21-commissioning--baselines)
22. [Commissioning — Credit System](#22-commissioning--credit-system)
23. [Compliance Tasks](#23-compliance-tasks)
24. [Action Items](#24-action-items)
25. [Safety — Incidents](#25-safety--incidents)
26. [Safety — Work Permits](#26-safety--work-permits)
27. [Safety — JHAs](#27-safety--jhas)
28. [Documents (CDE)](#28-documents-cde)
29. [Knowledge Base Sources](#29-knowledge-base-sources)
30. [Ask Jarvis Sessions](#30-ask-jarvis-sessions)
31. [Background / Automation Jobs](#31-background--automation-jobs)
32. [Integrations & Sync](#32-integrations--sync)
33. [Tenant Accounts](#33-tenant-accounts)
34. [Systems, Subsystems & Tags](#34-systems-subsystems--tags)

---

## 1. CRM & Sales

### Leads / Opportunities

**Lifecycle:**
```
prospect → qualified → proposal → negotiation → won
                                              → lost
                                              → no_bid
```

| Stage | Description | Who Sets It |
|---|---|---|
| `prospect` | Lead identified, minimal qualification | Sales / Owner |
| `qualified` | Budget, authority, need, timeline confirmed | Sales / PM |
| `proposal` | Formal proposal or tender submitted | PM / Engineer |
| `negotiation` | Contract terms under discussion | Owner / PM |
| `won` | Contract executed | Owner |
| `lost` | Opportunity not awarded | Owner / PM |
| `no_bid` | Opportunity declined before submission | Owner |

**Key Actors:** `created_by`, `assigned_to` (sales rep), `reviewed_by` (exec)

**Transitions:**
- Any stage can move backward (e.g., won → negotiation on a scope dispute).
- `won` and `lost` are soft terminal — reopening is permitted.
- Win-rate KPIs aggregate `won / (won + lost)` per period, excluding `no_bid`.

**Associated Data:** company, contact, deal value, source, probability %, expected close date, notes.

---

## 2. Projects & Contracts

### Project Lifecycle

**Lifecycle:**
```
planning → active → on_hold → active
                 → completed
                 → cancelled
```

| Status | Description |
|---|---|
| `planning` | Scoping, budgeting, team assignment — not yet mobilized |
| `active` | Mobilized and executing |
| `on_hold` | Paused (client or internal decision) |
| `completed` | Final deliverables accepted, project closed |
| `cancelled` | Project terminated before completion |

**Current Phase** (tracked independently of status):

```
feasibility → feed → detailed_design → procurement
→ construction → commissioning → closeout
```

| Phase | Description |
|---|---|
| `feasibility` | Concept studies, order-of-magnitude estimates |
| `feed` | Front-End Engineering Design |
| `detailed_design` | Full engineering drawings and specs issued |
| `procurement` | Long-lead items and bulk materials being sourced |
| `construction` | Civil, structural, mechanical, and electrical field work |
| `commissioning` | Pre-commissioning, loop checks, start-up |
| `closeout` | Punch completion, handover, as-builts issued |

**Key Actors:** `project_manager`, `lead_engineer`, `created_by`

**Financial Fields Tracked:** `budget`, `committed_cost`, `actual_cost`, `forecast_cost`, `contingency_pct`, `progress_pct`

**EVM Metrics (computed):** CPI = BCWP / ACWP, SPI = BCWP / BCWS, VAC = BAC − EAC

---

### Contract Lifecycle (per Project + Vendor)

**Lifecycle:**
```
draft → negotiation → active → variation → closed
                             → disputed
```

| Status | Description |
|---|---|
| `draft` | Internal draft, not yet shared with vendor |
| `negotiation` | Heads of terms circulating |
| `active` | Executed and in force |
| `variation` | Active contract under a scope change review |
| `closed` | Obligations fulfilled, financial closeout done |
| `disputed` | Active claim or arbitration in progress |

**Contract Types:** `lump_sum`, `reimbursable`, `unit_rate`, `gmp`, `ep`, `epc`, `epcm`

**Financial Fields:** `original_value`, `approved_value`, `invoiced_amount`, `paid_amount`, `retention_pct`

---

## 3. Budget & Change Orders

### Budget

A single budget record exists per project. Budget status progresses from `draft` (initial setup) to `active` once baseline is set.

**Budget Line Items:** Each has `cost_code`, `category`, `original_budget`, `revised_budget`, `committed_cost`, `actual_cost`, `forecast_cost`.

---

### Change Order (PCO / CCO) Lifecycle

**Lifecycle:**
```
draft → submitted → approved → executed
                 → rejected
```

| Status | Description | Auto-Set Fields |
|---|---|---|
| `draft` | CO under internal preparation | — |
| `submitted` | Sent to client / approver | `submitted_by`, `submitted_at` |
| `approved` | Client/owner signed off | `approved_by`, `approved_at` (admin role required) |
| `executed` | Incorporated into contract value | `executed_at` |
| `rejected` | Denied by approver | — |

**CO Types:**
- `PCO` — Prime Change Order (contractor-originated)
- `CCO` — Client Change Order (owner-directed)

**Key Fields:** `co_number`, `title`, `amount`, `reason_code`, `schedule_days` (schedule impact)

**Role Guard:** Transitioning to `approved` requires `admin`, `owner`, or `project_manager` role.

---

## 4. Procurement — Purchase Orders

### Purchase Order Lifecycle

**Lifecycle:**
```
draft → pending_approval → approved → issued → partial_delivery
                         → cancelled          → delivered → invoiced → closed
```

| Stage | Description | Auto-Set Fields |
|---|---|---|
| `draft` | PO being prepared | — |
| `pending_approval` | Submitted for internal sign-off | — |
| `approved` | Authorized to issue to vendor | `approved_by`, `approved_at` |
| `issued` | Sent to vendor, legally binding | — |
| `partial_delivery` | Some line items received | — |
| `delivered` | All items received and accepted | — |
| `invoiced` | Vendor invoice received and matched | — |
| `closed` | Payment settled, PO closed | — |
| `cancelled` | PO voided at any pre-issued stage | — |

**Role Guard:** `pending_approval → approved` requires `project_manager`, `admin`, or `owner`.

**Key Actors:** `created_by`, `approved_by`, `vendor_id`

---

## 5. Procurement — RFQs

### Request for Quotation Lifecycle

**Lifecycle:**
```
draft → issued → bid_period → evaluation → awarded → closed
                                          → cancelled
```

| Stage | Description |
|---|---|
| `draft` | RFQ scope being defined |
| `issued` | Sent to selected bidders |
| `bid_period` | Bidders preparing and submitting quotes |
| `evaluation` | Quotes under technical and commercial review |
| `awarded` | Contract awarded to winning bidder |
| `closed` | Follow-on PO issued; RFQ archived |
| `cancelled` | Scope cancelled or re-tendered |

**Bidder Sub-Workflow (per RFQ):**

```
invited → quote_submitted → shortlisted → recommended → awarded
                          → eliminated
```

**Key Fields:** `bid_due_date`, `award_date`, `awarded_to` (vendor FK), `evaluation_criteria` (JSONB)

---

## 6. Vendors & Directory

### Vendor Prequalification Lifecycle

**Lifecycle:**
```
prospect → qualified → approved → preferred
         → suspended
         → blacklisted
```

| Status | Description | Auto-Set Fields |
|---|---|---|
| `prospect` | Vendor identified, not yet assessed | — |
| `qualified` | Meets minimum capability criteria | — |
| `approved` | Cleared for award; insurance and compliance verified | `approved_by`, `approved_at` |
| `preferred` | Track record of performance; preferred source | — |
| `suspended` | Temporarily barred (e.g., safety incident) | — |
| `blacklisted` | Permanently barred | — |

**Key Fields:** `company_name`, `contact_name`, `email`, `phone`, `trade_category`, `performance_rating` (1–5)

---

## 7. Daily Logs

### Daily Log Lifecycle

**Lifecycle:**
```
draft → submitted → approved
```

| Status | Description | Auto-Set Fields |
|---|---|---|
| `draft` | Log being built by field team | — |
| `submitted` | Submitted for PM review | `submitted_by`, `submitted_at` |
| `approved` | PM sign-off complete | `approved_by`, `approved_at` |

**Trigger Actions:**
- `POST /daily-logs/:id/submit` — transitions `draft → submitted`
- `POST /daily-logs/:id/approve` — transitions any → `approved`

**Log Payload Fields:**

| Field | Type | Notes |
|---|---|---|
| `weather` | text | Conditions at site |
| `temp_f` | numeric | Temperature |
| `wind_mph` | numeric | Wind speed |
| `humidity_pct` | numeric | Humidity % |
| `manpower` | JSONB | Array of `{trade, headcount, hours}` |
| `equipment` | JSONB | Array of `{name, count, hours}` |
| `visitors` | JSONB | Name, company, purpose |
| `deliveries` | JSONB | Material/equipment received |
| `work_performed` | text | Narrative of work completed |
| `delays` | JSONB | Cause, duration, impact |
| `safety_notes` | text | HSE observations |
| `incidents` | JSONB | Incident details if any |
| `quality_notes` | text | NCRs, hold points |
| `photos` | JSONB | Array of file references |

**Export:** CSV export available for date-range batch reporting.

---

## 8. Drawings & Revisions

### Drawing Sheet Lifecycle

Drawings do not have a formal status enum. State is implicit through the revision control system.

**Revision Progression:**
```
[Initial Issue: Rev A] → [Rev B] → [Rev C] → ... → [As-Built]
```

**Drawing Attributes:** `sheet_number`, `title`, `discipline`, `scale`, `page_count`, `set_name`, `current_rev`, `issue_date`

**Revision Record (per revision):**
- `revision_id` — unique per sheet
- `revision_label` — A, B, C, etc.
- `issued_date` — date of this revision's issue
- `issued_by` — engineer who issued
- `reason` — change description
- `document_id` — link to CDE document record (optional)

**Discipline Values (ISO 19650 convention):** Civil, Structural, Mechanical, Electrical, Instrumentation, Process, Architecture, HVAC, Fire Protection

---

## 9. Drawing Markups

### Markup Lifecycle

**Lifecycle:**
```
open (created) → [updates to annotations] → resolved
```

| State | Field | Description |
|---|---|---|
| Active | `resolved = FALSE` | Markup is live / under discussion |
| Resolved | `resolved = TRUE` | Issue addressed; `resolved_by`, `resolved_at` set |

**Markup Attributes:** `sheet_id`, `page`, `revision`, `annotation_data` (JSONB — coordinates, text, shapes), `created_by`

**Filters Supported:** Filter by revision, page number, resolved status.

---

## 10. BIM Models & Issues

### BIM Model Lifecycle

Models are uploaded once and are implicitly `active` upon successful upload. No formal status progression — models are replaced by uploading a new model.

**Supported Formats:** `ifc`, `glb`, `gltf`, `nwd`, `rvt`

**Attributes:** `name`, `discipline`, `format`, `size_bytes`, `element_count`, `coord_system`, `georef` (JSONB — geospatial reference data)

---

### BIM Clash / Coordination Issue Lifecycle

**Lifecycle:**
```
open → assigned → in_progress → resolved
```

| Status | Description |
|---|---|
| `open` | Clash detected and logged |
| `assigned` | Assigned to discipline engineer for resolution |
| `in_progress` | Design change underway |
| `resolved` | Clash eliminated and confirmed |

**Severity:** `minor`, `major`, `critical`

**Attributes:** `title`, `description`, `element_ids` (JSONB — model element references), `viewpoint` (JSONB — camera position for review), `assigned_to`

---

## 11. Submittals

### Submittal Lifecycle

**Lifecycle:**
```
draft → submitted → under_review → approved
                                → approved_as_noted
                                → revise_resubmit → (re-enters at submitted)
                                → rejected
```

| Status | Description | Role Required |
|---|---|---|
| `draft` | Document being prepared | Any |
| `submitted` | Formally submitted to engineer | Any |
| `under_review` | Engineer actively reviewing | PM / Engineer |
| `approved` | Accepted without comment | PM / Admin / Owner |
| `approved_as_noted` | Accepted with minor comments; no resubmission needed | PM / Admin / Owner |
| `revise_resubmit` | Major comments; must be revised and resubmitted | PM / Admin / Owner |
| `rejected` | Not acceptable; start over | PM / Admin / Owner |

**Trigger Endpoints:**
- `PATCH /:id` — allows transitions to `draft`, `submitted`, `under_review` (pre-review states)
- `POST /:id/review` — terminal transitions (approved, approved_as_noted, revise_resubmit, rejected); requires PM/Admin/Owner role

**Key Actors:** `submitted_by`, `reviewed_by`

**Key Fields:** `spec_section`, `document_type`, `revision`, `description`, `due_date`

---

## 12. RFIs

### Request for Information Lifecycle

**Lifecycle:**
```
open → pending → answered → closed
```

| Status | Description | Auto-Set Fields |
|---|---|---|
| `open` | RFI raised; awaiting assignment | — |
| `pending` | Assigned to responder; answer in progress | — |
| `answered` | Official response provided | `response_by`, `responded_at` |
| `closed` | Response accepted; RFI archived | — |

**Trigger Endpoint:** `POST /:id/respond` — transitions to `answered`, sets `response`, `response_by`, `responded_at`

**Key Actors:** `raised_by`, `assigned_to`, `response_by`

**Key Fields:** `rfi_number`, `subject`, `question`, `response`, `discipline`, `due_date`, `drawing_ref`, `spec_ref`

---

## 13. Punch List Items

### Punch Item Lifecycle

**Lifecycle (6 stages):**
```
open → assigned → in_progress → resolved → verified → closed
```

| Stage | Description | Auto-Set Fields |
|---|---|---|
| `open` | Defect or incomplete work identified | — |
| `assigned` | Responsible party assigned | `assigned_to` |
| `in_progress` | Work underway to rectify | — |
| `resolved` | Work completed by responsible party | — |
| `verified` | Independent verification that work is acceptable | `verified_by`, `verified_at` |
| `closed` | Final sign-off; item removed from open register | `closed_by`, `closed_at` |

**Priority:** `low`, `medium`, `high`, `critical`

**Trigger Endpoints:**
- `POST /punch-items/:id/verify` — transitions → `verified`
- `POST /punch-items/:id/close` — transitions → `closed`

**Key Actors:** `created_by`, `assigned_to`, `verified_by`, `closed_by`

**Key Fields:** `item_number`, `description`, `location`, `discipline`, `reference_drawing`, `due_date`, `photo_evidence` (JSONB)

**Punch List Aggregation (header-level):** `open_count`, `in_progress_count`, `verified_count`, `closed_count` — shown on the list overview.

---

## 14. Inspections

### Inspection Lifecycle

**Lifecycle:**
```
scheduled → in_progress → completed
                        → failed
```

| Status | Description |
|---|---|
| `scheduled` | Inspection booked; inspector assigned |
| `in_progress` | On-site execution started |
| `completed` | All checklist items evaluated; result recorded |
| `failed` | Critical failures found; deficiency report generated |

**Attributes:** `inspection_number` (auto: INS-001), `title`, `type`, `location`, `discipline`, `scheduled_date`, `completed_date`

**Results:** Checklist items stored as JSONB — each item carries `pass` / `fail` / `na`.

**Outcome Tallies:** `pass_count`, `fail_count`, `na_count`, `overall_result`

**Evidence:** `photos` (JSONB), `signatures` (JSONB — inspector + witness)

**Key Actors:** `inspector_id`, `created_by`, linked `template_id`

**On Failure:** A `Deficiency` record is generated automatically (see §15).

---

## 15. Deficiencies

### Deficiency Lifecycle

Deficiencies are formally tracked issues that arise from inspections, test failures, or field observations. They are distinct from punch items — deficiencies carry engineering severity and traceability to test evidence.

**Lifecycle:**
```
open → in_review → closed
                → waived
```

| Status | Description | Closure Fields |
|---|---|---|
| `open` | Deficiency raised; not yet assigned | — |
| `in_review` | Being investigated / remediated | — |
| `closed` | Corrective action verified complete | `closed_by`, `closed_at` |
| `waived` | Accepted as-is; engineering concession granted | — |

**Severity:** `low`, `medium`, `high`, `critical`

**Source Traceability:** `test_pack_id`, `test_result_id`, `tag_id` (all nullable — a deficiency can be manually raised or sourced from a test failure)

**Key Actors:** `created_by`, `assignee_user_id`, `closed_by`

**Key Fields:** `code` (unique per project), `title`, `description`, `due_date`

---

## 16. Work Inspection Records (WIRs)

### WIR Lifecycle

**Lifecycle:**
```
open → in_progress → completed
                  → failed → (corrective action, re-inspect)
                  → waived
```

| Status | Description |
|---|---|
| `open` | WIR raised at hold or witness point |
| `in_progress` | Inspection being conducted |
| `completed` | All checks passed; hold point released |
| `failed` | One or more checks not met; work must stop |
| `waived` | Hold point released by concession (engineering sign-off required) |

**Key Fields:** `wir_number`, `inspection_type`, `punch_items` (JSONB — linked punch references), `test_data` (JSONB — measurements)

---

## 17. Commissioning — Test Packs

### Test Pack Lifecycle

**Lifecycle:**
```
draft → [revision issued: Rev A] → [Rev B] → ... → (execution begins)
```

Test packs carry a `revision` label (A, B, C...) rather than a traditional status. Execution state is tracked through the test results associated with each pack.

**Pack Types:**

| Type | Description |
|---|---|
| `pre_comm` | Pre-commissioning checks (cleaning, flushing, torque) |
| `loop_check` | Instrument loop and interlock verification |
| `start_up` | Equipment start-up procedure |
| `functional` | Functional acceptance test |
| `turnover` | Handover package to operations |

**Generation Source:** `manual` (user-built), `template` (from template library), `ai` (AI-generated from specs), `imported` (from external system)

**Scope Hierarchy:** Test packs are scoped to a `system_id` (FK); optionally to subsystems and tags.

**Key Fields:** `pack_no`, `title`, `revision`, `pack_type`, `generated_from`

**Key Actors:** `created_by`, `updated_by`

---

## 18. Commissioning — Test Results

### Test Result Lifecycle

Test results represent individual step outcomes within a test pack.

**Result Status:**
```
pending → pass
        → fail → (deficiency raised)
        → na
```

| Result | Description |
|---|---|
| `pending` | Step not yet executed |
| `pass` | Measurement/observation meets acceptance criteria |
| `fail` | Does not meet criteria; deficiency may be raised |
| `na` | Step not applicable to this scope |

**Key Fields:** `step_no`, `step_title`, `expected_result`, `actual_result`, `evidence_uri` (photo or document link), `comments`, `performed_at`

**Key Actors:** `performed_by` (technician executing), `witnessed_by` (QA engineer or client witness)

---

## 19. Commissioning — Items

### Commissioning Item Lifecycle

Commissioning items provide granular coverage tracking within a test pack.

**Lifecycle:**
```
not_started → in_progress → complete
                          → failed
```

**Item Types:**

| Type | Description |
|---|---|
| `pre_comm` | Pre-commissioning task |
| `pre_func` | Pre-functional check |
| `func` | Functional test item |
| `startup` | Start-up step |
| `turnover` | Turnover / handover task |

**Traceability:** `source_document_id` + `source_reference` — traces each item back to the originating specification or IOM section.

---

## 20. Commissioning — Packs (Generated Deliverables)

### Generated Pack Lifecycle

Pack generation is an asynchronous job process. Packs move through both a **pack status** and an underlying **job status**.

**Pack Status:**
```
draft → ready_for_review → finalized
                         → failed
```

| Status | Description |
|---|---|
| `draft` | Initial generated draft; content not yet reviewed |
| `ready_for_review` | Content complete; awaiting reviewer sign-off |
| `finalized` | Reviewed and locked; artifacts (HTML/Markdown/PDF) generated |
| `failed` | Generation error; retry or re-generate required |

**Generation Job Status (async queue):**
```
queued → running → complete
                 → failed (up to 3 retries)
```

| Job Status | Description |
|---|---|
| `queued` | Job waiting for an available worker |
| `running` | Worker has claimed and is processing |
| `complete` | Generation successful; artifacts stored |
| `failed` | Error after max_attempts (3); error_text recorded |

**Trigger Endpoints:**
- `POST /generate-draft` — creates generation job; debits 1 credit from the billing ledger
- `POST /finalize` — queues finalize job; locks pack content

**Artifacts Produced:** `html_path`, `markdown_path`, `pdf_path`

**Locking:** Workers use optimistic locking — `locked_by` (worker ID) + `locked_at` (timestamp) prevent double-processing.

**Review:** `PATCH /packs/:id/review` — reviewer adds `review_notes`; status advances to `ready_for_review`.

---

## 21. Commissioning — Baselines

### Baseline Observation Lifecycle

Baselines implement statistical novelty detection. There is no traditional status — each observation produces a decision value.

**Observation Decision Values:**

| Decision | Description |
|---|---|
| `auto_pass` | Measurement within expected statistical range; passes automatically |
| `auto_fail` | Measurement outside threshold; fails automatically |
| `queued_novelty` | Novel reading — outside baseline; queued for human review |
| `queued_warmup` | Insufficient sample count; baseline warming up |
| `human_pass` | Reviewer manually passed a novel reading |
| `human_fail` | Reviewer manually failed a novel reading |

**Scope Hierarchy (precedence: project → client → global):**
- `global` — applies to all tenants
- `client` — applies to all projects for a client
- `project` — project-specific override

**Key Fields:** `sample_count`, `mean_value`, `std_dev`, `min_observed`, `max_observed`, `p25_value`, `p75_value`, `window_days` (default 90), `last_sample_at`

---

## 22. Commissioning — Credit System

### Credit Ledger

The credit system is an append-only billing ledger. Balance is never stored directly — it is always computed as `SUM(delta)` across all rows.

**Transaction Types:**

| Delta Sign | Type | Description |
|---|---|---|
| `+` (positive) | Grant | Credits added (admin grant or plan allocation) |
| `−` (negative) | Spend | Credits consumed when a pack draft is generated |

**Cost:** 1 credit per pack draft generation (`PACK_CREDIT_COST`, configurable).

**Credit Check:** The worker validates sufficient balance before generation begins. If balance is insufficient, the job fails with an error and no credit is debited.

---

## 23. Compliance Tasks

### Compliance Task Lifecycle

**Lifecycle:**
```
pending → notified → overdue → completed
                             → waived
```

| Status | Description | Auto-Set Fields |
|---|---|---|
| `pending` | Task created; within normal lead time | — |
| `notified` | Pre-notification sent to assignee (`notify_days_before` before due) | `last_notified_at` |
| `overdue` | Past due date; escalation triggered | — |
| `completed` | Requirement fulfilled | `completed_at` |
| `waived` | Admin-granted concession; task bypassed | — |

**Trigger Endpoints:**
- `POST /:id/complete` — transitions → `completed`; blocked if already in `completed` or `waived`
- `POST /:id/waive` — admin-only; transitions → `waived`

**Automated Transitions (complianceWatcher service):**
- Runs on schedule; scans for tasks where `due_date − notify_days_before ≤ TODAY` → sets `notified`
- Scans for tasks where `due_date < TODAY AND status = pending|notified` → sets `overdue`
- Emits webhook events on state changes for integration with external notification systems

**Categories:** `jha`, `sds`, `permit`, `training`, `inspection`, `audit`

**Key Fields:** `title`, `due_date`, `notify_days_before` (default 7), `assigned_to`, `category`

---

## 24. Action Items

### Action Item Lifecycle

**Lifecycle:**
```
open → in_progress → completed
     → overdue    → completed
                  → cancelled
```

| Status | Description |
|---|---|
| `open` | Created; not yet started |
| `in_progress` | Assignee is actively working on it |
| `overdue` | Past due date; still incomplete |
| `completed` | Resolved and closed |
| `cancelled` | Voided; no action taken |

**Priority:** `low`, `medium`, `high`, `critical`

**Key Actors:** `created_by`, `assigned_to`

**Key Fields:** `title`, `description`, `due_date`, `priority`, linked `project_id`, `module` (which domain raised the action: safety, commissioning, inspection, etc.)

---

## 25. Safety — Incidents

### Incident Lifecycle

**Lifecycle:**
```
reported → under_investigation → corrective_action → closed
                               → closed (no action required)
```

| Stage | Description |
|---|---|
| `reported` | Incident logged in field; initial details captured |
| `under_investigation` | Root cause analysis in progress |
| `corrective_action` | Actions identified and assigned |
| `closed` | Corrective actions verified complete; incident closed |

**Incident Classification:**

| Type | Description |
|---|---|
| `near_miss` | Potential incident; no injury or damage |
| `first_aid` | Minor injury treated on-site |
| `recordable` | OSHA/regulatory recordable injury |
| `lti` | Lost Time Injury — worker unable to return next day |
| `fatality` | Fatal incident |

**Key Fields:** `incident_date`, `location`, `description`, `injury_type`, `body_part`, `root_cause`, `corrective_actions` (JSONB), `days_lost` (for LTI)

**Safety KPIs Derived:**
- TRIR = (recordable + lti + fatality incidents × 200,000) / total hours worked
- Days Since Last Incident — derived from most recent recordable/LTI/fatality date

---

## 26. Safety — Work Permits

### Work Permit Lifecycle

**Lifecycle:**
```
draft → issued → active → expired
                       → cancelled
                       → suspended → reinstated → active
```

**Permit Types:**

| Type | Description |
|---|---|
| `hot_work` | Welding, cutting, grinding near flammables |
| `confined_space` | Entry into tanks, vessels, or enclosed spaces |
| `excavation` | Ground-breaking or trenching work |
| `electrical` | Energized electrical system work |
| `working_at_height` | Work above 1.8 m |
| `general` | Non-specialist elevated-risk work |

**Key Fields:** `permit_number`, `work_description`, `location`, `valid_from`, `valid_to`, `issued_by`, `responsible_person`, `precautions` (JSONB), `isolations` (JSONB)

---

## 27. Safety — JHAs

### Job Hazard Analysis Lifecycle

**Lifecycle:**
```
draft → reviewed → approved → active
                            → expired
                            → revised → (re-enters at draft)
```

**Key Fields:** `title`, `task_description`, `date`, `prepared_by`, `approved_by`, hazard rows (JSONB — `{task_step, hazard, risk_level, control_measure, residual_risk}`)

**Attendees:** `attendees` (JSONB — name, signature, date)

---

## 28. Documents (CDE)

### Document Lifecycle (ISO 19650 CDE States)

Denver Engineering follows the ISO 19650 Common Data Environment model. Documents progress through four CDE states:

**Lifecycle:**
```
Work in Progress (WIP) → Shared → Published → Archived
```

| CDE State | Suitability Code | Description |
|---|---|---|
| `WIP` | S0 | Author's working copy; not shared |
| `Shared` | S1 — Suitable for Coordination | Shared within project team for coordination |
| `Shared` | S2 — Suitable for Information | Shared for information only |
| `Shared` | S3 — Suitable for Review & Comment | Formal review cycle open |
| `Shared` | S4 — Suitable for Construction | Issued for construction use |
| `Published` | A1 — Approved for Construction | Authority approved; construction may proceed |
| `Published` | A2 — As-Built | Record of constructed condition |
| `Archived` | — | Superseded; retained for audit |

**Transmittals:**

Documents are formally transmitted via transmittal records:

| Field | Description |
|---|---|
| `transmittal_number` | Auto-generated sequence |
| `sender` | Originating party |
| `recipient` | Receiving party |
| `purpose` | Reason for transmittal (issue, approval, information) |
| `documents` | JSONB — list of document IDs and revision numbers attached |
| `transmitted_at` | Timestamp |
| `acknowledged_at` | Recipient acknowledgement timestamp |

**Document Naming (ISO 19650):** `{ProjectCode}-{Originator}-{Volume}-{Level}-{Type}-{Discipline}-{Number}`

---

## 29. Knowledge Base Sources

### Knowledge Source Ingest Lifecycle

**Lifecycle:**
```
pending → processing → active
                     → error (retryable)
                     → archived
                     → deleted
```

| Status | Description |
|---|---|
| `pending` | File uploaded; awaiting ingest |
| `processing` | Text extraction and chunk indexing in progress |
| `active` | Fully indexed; available for search and RAG retrieval |
| `error` | Ingest failed; error message stored; can retry |
| `archived` | Superseded version; excluded from search |
| `deleted` | Soft-deleted; chunks purged from index |

**Ingest Process:**
1. File upload → stored in local filesystem or S3
2. Text extraction (PDF parsing)
3. Text chunked into segments (~512 tokens with overlap)
4. Each chunk embedded (vector embedding via configured provider)
5. Chunks indexed in `knowledge_chunks` table with FTS + vector columns
6. Source status → `active`

**Supported Types:** PDF (primary), plain text, Markdown

**Tier Classification (for RAG weighting):** `iom` (equipment manuals — highest weight), `spec` (specifications), `standard` (industry standards), `general`

---

## 30. Ask Jarvis Sessions

### Chat Session Lifecycle

**Lifecycle:**
```
active → resolved
```

| State | Field | Description |
|---|---|---|
| Active | `resolved_flag = FALSE` | Ongoing Q&A session |
| Resolved | `resolved_flag = TRUE` | User marked session as resolved; `resolved_by`, `resolved_at` set |

**Session Attributes:** `title` (auto-derived from first question), `project_id` (optional context), `message_count`

---

### Chat Message Roles

| Role | Description |
|---|---|
| `user` | User's question |
| `assistant` | AI-generated response |
| `system` | Internal context injection (not shown in UI) |

**Assistant Response Schema (JSONB `structured_answer`):**

```json
{
  "answer": "...",
  "procedure": ["Step 1...", "Step 2..."],
  "possible_causes": ["Cause A...", "Cause B..."],
  "confidence": 0.87,
  "citations": [
    { "source": "Carrier 30XA IOM", "page": 42, "chunk_id": "uuid" }
  ]
}
```

**Retrieval:** Multi-tier retrieval — FTS + vector similarity + Fix Library — ranked by tier weight and relevance score.

**Token Tracking:** `input_tokens`, `output_tokens`, `model` — stored per message for cost visibility.

---

## 31. Background / Automation Jobs

### Scheduled Job Lifecycle

**Lifecycle:**
```
pending → running → completed
                 → failed → retrying → completed
                                     → failed (max retries reached)
                          → cancelled
```

**Job Types (registered handlers):**
- `embed_chunks` — vector embed new knowledge chunks
- `compliance_watch` — scan and transition compliance task states
- `integration_sync` — sync data with third-party integrations
- `audit_retention` — purge audit log entries beyond retention window
- `kpi_snapshot` — compute and store KPI snapshots
- `field_sync` — process offline field data submissions
- `generate_draft` — commissioning pack draft generation
- `finalize_pack` — commissioning pack finalization

**Scheduling Modes:**
- `cron` — standard cron expression (e.g., `0 * * * *` for hourly)
- `interval` — fixed interval in milliseconds
- `once` — single future execution via `run_after` timestamp

**Retry Logic:** `attempts` counter incremented on failure; job re-queues if `attempts < max_attempts` (default 3). After max attempts, job enters terminal `failed` state.

**Locking:** `locked_by` (worker process ID) + `locked_at` prevents two workers from processing the same job (`FOR UPDATE SKIP LOCKED` in PostgreSQL).

---

## 32. Integrations & Sync

### Integration Connection Lifecycle

**Lifecycle:**
```
pending → active → error
                → disabled
```

| Status | Description |
|---|---|
| `pending` | OAuth or API key flow initiated; not yet confirmed |
| `active` | Connected and functioning |
| `error` | Connection broken; credentials expired or webhook failing |
| `disabled` | Manually disconnected by user |

**Supported Integration Targets:** QuickBooks (finance), Slack (notifications), Tractian (asset health), BACnet (building systems), custom webhook endpoints.

---

### Sync Job Lifecycle

**Lifecycle:**
```
pending → running → success
                 → partial (some records failed)
                 → failed
                 → cancelled
```

| Status | Description |
|---|---|
| `pending` | Sync queued |
| `running` | Actively syncing |
| `success` | All records synced |
| `partial` | Sync completed with some individual record errors |
| `failed` | Sync aborted due to connection or schema error |
| `cancelled` | User or system cancelled the sync |

---

## 33. Tenant Accounts

### Tenant Account Lifecycle

**Lifecycle:**
```
pending → active → suspended → active
                → cancelled
```

| Status | Description |
|---|---|
| `pending` | Account provisioned; setup not complete |
| `active` | Account operational; users can log in |
| `suspended` | Access blocked (non-payment or compliance violation) |
| `cancelled` | Account terminated; data enters retention period |

**Role Hierarchy (within tenant):**

| Role | Permissions |
|---|---|
| `owner` | Full access — all modules, admin, integrations, billing |
| `admin` | All modules; automation config; audit log access |
| `project_manager` | All operational modules; execute state transitions |
| `engineer` | Engineering, construction, documents; annotate and review |
| `viewer` | Read-only access on public views |

---

## 34. Systems, Subsystems & Tags

### System Lifecycle

**Lifecycle:**
```
draft → active → decommissioned
```

**Hierarchy:** Project → System → Subsystem → Tag (Equipment)

**System Attributes:** `code` (unique per project), `name`, `description`, `discipline`

---

### Tag (Equipment Register) Lifecycle

**Lifecycle:**
```
planned → active → decommissioned
```

| Status | Description |
|---|---|
| `planned` | Tag defined in design; not yet installed |
| `active` | Equipment installed and in service |
| `decommissioned` | Removed from service; retained in register |

**Tag Attributes:** `tag_no` (unique per project), `equipment_name`, `equipment_type`, `location`, `manufacturer`, `model_no`, `serial_no`

**Hierarchy:** Optional `system_id` and `subsystem_id` FK links.

---

## Cross-Cutting Concerns

### Audit Trail

All state-mutating operations are recorded in the audit log:
- **Who** — `user_id` (actor)
- **What** — action type and entity ID
- **When** — UTC timestamp
- **Before/After** — delta of changed fields (JSONB)

Audit log entries are immutable — no update or delete operations are permitted.

### Role-Based Access Control

State transitions that have financial, legal, or safety significance require elevated roles:

| Transition | Minimum Role |
|---|---|
| PO approve | project_manager |
| Submittal final review | project_manager |
| Change order approve | admin |
| Compliance task waive | admin |
| Credit grant | owner |
| Tenant suspend/cancel | owner |

### Notification Hooks

The `complianceWatcher` service is the primary automated state-transition engine. It runs on a cron schedule and:
1. Scans compliance tasks for `notify_days_before` triggers
2. Advances overdue tasks
3. Emits webhook events to registered integration endpoints

Background jobs in the `background_jobs` table provide the same pattern for async operations (pack generation, embedding, sync).

---

*Denver Engineering v4 — Proprietary. All rights reserved.*

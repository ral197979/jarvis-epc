# Customer Workflows

> End-to-end workflows that show how the platform's modules combine to run real work — from a single asset to the executive boardroom.
>
> Each workflow is presented as a customer narrative with the stages, what happens at each step, who's involved, and the business outcome. All workflows reflect capabilities in the live application.

---

## Index

1. [Asset Lifecycle](#1-asset-lifecycle--from-install-to-operating-record)
2. [Commissioning Workflow](#2-commissioning-workflow--from-checklist-to-turnover)
3. [Project Delivery Workflow](#3-project-delivery-workflow--planning-to-completion)
4. [Construction Field Workflow](#4-construction-field-workflow--the-daily-loop)
5. [Financial Control & Change Workflow](#5-financial-control--change-workflow)
6. [Issue-to-Resolution (Operations) Workflow](#6-issue-to-resolution-operations-workflow)
7. [Executive Reporting Workflow](#7-executive-reporting-workflow--data-to-decisions)
8. [Knowledge & AI Assist Workflow](#8-knowledge--ai-assist-workflow)

---

## 1. Asset Lifecycle — from install to operating record

**Who:** Field engineers, commissioning agents, maintenance/reliability managers, facility managers.

```
Register Asset → Inspect → Commission → Resolve Deficiencies → Turnover → Operating Record
```

| Stage | What happens | Modules |
|---|---|---|
| **Register** | The asset is created as a tag under its system/subsystem with type, manufacturer, model, serial, and location. | Commissioning (systems/tags) |
| **Inspect** | Installation and quality are verified against a discipline checklist; pass/fail/conditional results are recorded; failures spawn deficiencies. | Inspections |
| **Commission** | The asset runs through its phase-specific test packs (pre-comm → pre-functional → functional). Each step captures expected vs. actual, performed-by, witnessed-by, and evidence. | Commissioning, Test Packs, Test Results |
| **Resolve deficiencies** | Failed steps create deficiencies with severity and an owner; a retest pack is run; the deficiency closes only when the retest passes. | Deficiencies, Action Center |
| **Turnover** | O&M manuals, spares, training, and warranty records are collected into a turnover package. | Commissioning (turnover) |
| **Operating record** | The asset's full test history, deficiency record, and documents become the operations baseline; ongoing tasks run as actions; asset health is scored from inspection/deficiency/incident history. | Action Center, Operations Command Center (asset health) |

**Business outcome.** Operations inherits a complete, evidence-backed record of every asset on day one — what it is, how it was tested, what was fixed, and what's outstanding.

---

## 2. Commissioning Workflow — from checklist to turnover

**Who:** Commissioning authority (CxA), owner's representative, EPC commissioning lead.

```
Scope → Build Test Packs → Pre-Comm → Pre-Functional → Functional → Deficiency/Retest → Readiness → Turnover
```

| Stage | What happens | What the customer sees |
|---|---|---|
| **Scope** | Define the project's systems, subsystems, and equipment tags; map each to its asset type. | Asset hierarchy with coverage reporting |
| **Build test packs** | Generate phase-appropriate test packs (pre-comm, loop check, start-up, functional, turnover) from templates, with revisions. | Test pack register |
| **Pre-commissioning** | Verify installation, mechanical completeness, and pre-power safety. | Phase 1 checklists, evidence capture |
| **Pre-functional** | Verify controls (HOA), sensor calibration, and startup readiness. | Phase 2 checklists |
| **Functional performance** | Run full-load tests, sequence and interlock validation, alarm checks. | Phase 3 results: expected vs. actual, witnessed-by |
| **Deficiency & retest** | Failures generate deficiencies (severity, owner, due date); a retest pack closes them only on a pass. | Deficiency log + retest loop |
| **Readiness** | A weighted readiness score (open actions, blockers, SLA, inspections, escalations) is computed continuously with the blocking factors listed and a history trend. | Readiness score + blockers + trend |
| **Turnover** | The O&M/spares/training/warranty package is assembled and rendered as a downloadable deliverable. | Turnover package |

**Business outcome.** A defensible, evidence-based commissioning record and an objective readiness number — the difference between "we think it's ready" and "we are ready, and here's the proof." This is the platform's signature workflow.

---

## 3. Project Delivery Workflow — planning to completion

**Who:** EPC project manager, project controls, engineering manager.

```
Win/Setup → Plan → Design Coordination → Construct → Commission → Close-out
```

| Stage | What happens | Modules |
|---|---|---|
| **Win / setup** | An awarded proposal becomes a project with type, value, and dates. | Proposals → Projects |
| **Plan** | Import the P6/MSP schedule; set the budget by cost code/WBS; build the risk register. | Schedule Import, Budget, Risk Register |
| **Design coordination** | Manage drawings and revisions, RFIs, submittals, and BIM clash resolution. | Drawings, RFIs, Submittals, BIM, Engineering Hub |
| **Construct** | Field crews log daily reports, capture costs, run inspections and punch items; meetings produce tracked actions. | Daily Logs, Cost Entry, Inspections, Punch List, Meetings, Action Center |
| **Commission** | Run the four-phase commissioning workflow (see #2). | Commissioning |
| **Close-out** | Punch list verified, turnover package delivered, final cost and earned value reconciled. | Punch List, Commissioning, Cost Control, EVM |

**Business outcome.** The whole project runs on one source of truth, with cost, schedule, quality, and commissioning data continuously reconciled — and an early-warning forecast running the entire time.

---

## 4. Construction Field Workflow — the daily loop

**Who:** Superintendents, field engineers, foremen.

```
Plan the Day → Execute → Capture (logs, costs, photos) → Flag Issues → Sync → Roll Up
```

| Stage | What happens | Modules |
|---|---|---|
| **Plan the day** | Review assigned actions, open RFIs, and today's inspections. | Action Center, RFIs, Inspections |
| **Execute** | Crews perform the work; QR launchers open the right workflow at the right location. | Field Service |
| **Capture** | Daily log (weather, crew, equipment, work, delays, safety), field costs, and photos are recorded — offline if needed. | Daily Logs, Cost Entry, Field Service |
| **Flag issues** | Deficiencies, safety incidents, and RFIs are raised on the spot and become tracked actions. | Inspections, Action Center, RFIs |
| **Sync** | Offline entries sync automatically on reconnect. | Field Service |
| **Roll up** | Field data flows into cost control, the dashboard, and the executive view in real time. | Cost Control, Dashboard, Executive Command Center |

**Business outcome.** Field reality reaches the office the same day — accurate costs, documented delays, and issues that don't get lost.

---

## 5. Financial Control & Change Workflow

**Who:** Project controls, finance, project manager.

```
Baseline Budget → Capture Costs → Manage Changes → Measure Performance → Forecast
```

| Stage | What happens | Modules |
|---|---|---|
| **Baseline budget** | Original budget by cost code/WBS; approved-change and revised columns. | Budget |
| **Capture costs** | Field and office costs (labor, material, equipment) post against cost codes. | Cost Entry, Timesheets |
| **Manage changes** | Change events are priced (cost + schedule impact), approved, and executed; the budget updates. | Change Orders |
| **Measure performance** | Earned value (CPI/SPI), variance, and forecast-at-completion are computed continuously. | EVM, Cost Control |
| **Forecast** | Predictive intelligence projects estimate-at-completion with trend and confidence; portfolio rolls up IRR/NPV/MOIC. | Predict, Portfolio |

**Business outcome.** Cost truth in real time, changes recovered and documented, and a forward forecast that protects margin — at both project and portfolio level.

---

## 6. Issue-to-Resolution (Operations) Workflow

**Who:** Operations managers, program controls, responsible parties.

```
Detect → Triage → Recommend → Act → Correlate Root Cause → Close → Learn
```

| Stage | What happens | Modules |
|---|---|---|
| **Detect** | An issue surfaces — a breached SLA, a failed test, an anomaly, an incident. | Action Center, Predict, Ops Command Center |
| **Triage** | Operational risk scoring ranks it by impact, urgency, and SLA status; blockers analysis shows what it's holding up. | Action Center, Ops Command Center |
| **Recommend** | The rules-based engine suggests the next-best-action (escalate, reassign, prioritize-to-unblock, pause-SLA) with a plain-English reason and impact/urgency/confidence. | Ops Command Center (recommendations) |
| **Act** | The operator executes in real time — bulk reassign, escalate, freeze/unfreeze SLA, or report an incident. | Ops Command Center (command actions) |
| **Correlate root cause** | The platform surfaces proximate events (daily logs, audit, compliance, actions, commissioning) ranked by time-proximity and scope to explain *why* it happened. | Root-cause correlation |
| **Close** | The action/deficiency/incident is resolved and verified; readiness recovers. | Action Center, Commissioning |
| **Learn** | Resolutions feed the fix library and asset-health history. | Fix Library, asset health |

**Business outcome.** Issues are caught early, prioritized objectively, resolved with explainable guidance, and understood at the root — turning firefighting into managed operations.

---

## 7. Executive Reporting Workflow — data to decisions

**Who:** Executive leadership, program directors, finance leadership.

```
Live Data → KPI Aggregation → Portfolio View → Forecast & Anomalies → Decision → Directed Action
```

| Stage | What happens | What leadership sees |
|---|---|---|
| **Live data** | Every field log, cost entry, test result, and action updates the shared data model in real time. | — |
| **KPI aggregation** | KPIs roll up automatically — actions, readiness, incidents, SLA, throughput. | Executive Command Center |
| **Portfolio view** | A risk heatmap ranks projects worst-first; escalation hotspots and contractor performance are visible. | Portfolio risk heatmap |
| **Forecast & anomalies** | Predictive health, EAC forecasts, and anomaly alerts flag what's drifting. | Predict, anomaly alerts |
| **Decision** | Leadership focuses on the few projects that need attention, with the evidence in front of them. | Drill-down to detail |
| **Directed action** | Direction flows back as actions/reassignments/escalations that the org executes and the system tracks. | Action Center, Ops Command Center |

**Business outcome.** Leadership decisions are based on live, trustworthy data — not three-week-old reports — and the resulting direction is tracked to completion.

---

## 8. Knowledge & AI Assist Workflow

**Who:** Everyone — engineers, field staff, commissioning agents, operators.

```
Ingest Documents → Index → Ask → Cited Answer → Resolve / Link to Work → Capture Fix
```

| Stage | What happens | Modules |
|---|---|---|
| **Ingest** | Drawings, specs, manuals, and procedures are uploaded. | Knowledge Hub, Documents |
| **Index** | The platform chunks, embeds, and indexes the content for retrieval. | Knowledge Hub |
| **Ask** | A user asks a natural-language question. | Ask Jarvis |
| **Cited answer** | The assistant answers from the indexed corpus with a citation for every source chunk — and refuses to improvise. | Ask Jarvis |
| **Resolve / link** | The session can be marked resolved or linked to a work item. | Ask Jarvis, Action Center |
| **Capture fix** | Recurring resolutions become reusable fix-library patterns and future retrieval sources. | Fix Library |

**Business outcome.** Institutional knowledge becomes instantly answerable and trustworthy — faster troubleshooting, faster onboarding, and far less key-person dependency.

---

*These workflows map directly to the personas in `CUSTOMER_PERSONAS.md` and the value drivers in `CUSTOMER_VALUE_PROPOSITION.md`.*

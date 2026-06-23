# Denver Engineering — Customer Product Presentation

> The complete, customer-facing story of the platform: what it does, who it's for, how it solves real problems, and why organizations buy it.
>
> *This document is the authoritative product narrative. It is written for prospective customers, not engineers. Every capability described here is backed by the live application.*

---

## Table of contents

1. [The world your teams live in](#1-the-world-your-teams-live-in)
2. [What Denver Engineering is](#2-what-denver-engineering-is)
3. [The platform at a glance](#3-the-platform-at-a-glance)
4. [How the platform is organized](#4-how-the-platform-is-organized)
5. [The capability pillars](#5-the-capability-pillars)
6. [The intelligence layer](#6-the-intelligence-layer)
7. [What makes it ready to operate: readiness as a metric](#7-what-makes-it-ready-to-operate-readiness-as-a-metric)
8. [Security, trust & auditability](#8-security-trust--auditability)
9. [Who it's for](#9-who-its-for)
10. [Why customers choose Denver Engineering](#10-why-customers-choose-denver-engineering)
11. [What it is — and isn't](#11-what-it-is--and-isnt-honest-scope)
12. [Getting started](#12-getting-started)

---

## 1. The world your teams live in

A complex capital project — a hyperscale data center, a 20 MGD water treatment plant, a hospital tower — is delivered by hundreds of people across owners, engineers, contractors, subcontractors, and commissioning agents. The information that should bind them together instead lives in:

- A project-controls spreadsheet that one person owns and nobody else trusts
- A document management system that holds drawings but not decisions
- A separate scheduling tool that's out of date the day it's published
- A shared drive of commissioning PDFs, scanned checklists, and photos
- An email thread where the real decisions actually happen
- A monthly report that's already three weeks stale by the time leadership reads it

The consequences are predictable and expensive: **disputed change orders, lost commissioning records, premature turnover, rework, and overruns that compound silently** because no one sees them until the monthly review.

This isn't a tooling inconvenience. It's the single largest controllable risk in capital project delivery.

---

## 2. What Denver Engineering is

**Denver Engineering is one platform that runs the entire project lifecycle on a single source of truth — and proves the facility is ready to operate.**

It spans the work end to end:

```
Proposal  →  Design Coordination  →  Construction  →  Commissioning  →  Turnover
   │              │                      │                │                │
  CRM &         Drawings, RFIs,       Daily logs,      4-phase Cx,      O&M package,
  bids          submittals, BIM       inspections,     test packs,      readiness
                                      punch lists      deficiencies     sign-off
   └──────────────────── Financial controls run across all of it ───────────────────┘
   └──────────────── AI assistant + predictive intelligence on all data ────────────┘
```

Three things make it different from a database with screens:

1. **It's unified.** A failed functional test, a new change order, and an overdue RFI all land in the same data model — so they show up together in the project's readiness score and the executive's portfolio view.
2. **It's intelligent.** A grounded AI assistant answers from your documents; a predictive engine forecasts cost and schedule and raises anomalies early.
3. **It's auditable.** Every change is logged automatically, with row-level security isolating every customer's data.

---

## 3. The platform at a glance

| Dimension | What you get |
|---|---|
| **Coverage** | Full lifecycle: business development → engineering → construction → commissioning → finance → turnover |
| **Surface** | 45+ purpose-built screens organized into 9 work domains, plus a modern "Mission Control" UI |
| **Real-time** | Live WebSocket updates for actions, notifications, sensor streams, and the ops command feed |
| **AI** | Grounded document Q&A with citations; predictive health & cost forecasting; anomaly detection; explainable recommendations |
| **Commissioning** | Structured 4-phase workflow, 21 asset types, test packs, deficiencies, retest loops, weighted readiness scoring |
| **Financial controls** | Budgets, change orders, cost control, cost entry, earned value management, risk register with Monte Carlo, portfolio IRR/NPV/MOIC |
| **Documents** | Transmittals, ISO 19650 document register, full-text + AI-summarized search, BIM/IFC coordination |
| **Integration** | Connector framework with webhooks for accounting, messaging, and field systems |
| **Security** | Multi-tenant with row-level security on every record, JWT auth, automatic audit logging, rate limiting |

---

## 4. How the platform is organized

The platform groups its screens into **nine work domains**, so each role sees the tools they need without noise:

| Domain | What lives here | Primary users |
|---|---|---|
| **Operations** | Dashboard, Projects, Timesheets, Team, Actions, Notifications | PMs, ops managers, leadership |
| **AI** | Ask Jarvis (assistant), Predict (forecasting) | Everyone |
| **CRM** | CRM pipeline, Proposals | Business development |
| **Engineering** | FEED, Calc tools, Engineering Hub, Fix Library, Process Design | Engineers, designers |
| **Construction** | Daily Logs, Drawings, Schedule Import, Subcontracts, Meetings, BIM, IoT Sensors, RFIs, Submittals, Punch List, Inspections, Compliance, Risk Register | Field & construction teams |
| **Finance** | Change Orders, Cost Control, Cost Entry, EVM, Budget, Portfolio | Project controls, finance |
| **Documents** | Transmittals, Document register | Document controllers, all roles |
| **Procurement** | Vendor/subcontractor directory | Procurement |
| **System** | Knowledge, MCP, Automation, Integrations, Settings | Admins |

Commissioning and the Executive/Operations Command Center sit across these domains, drawing on the shared data.

A complete, screen-by-screen inventory is in `PRODUCT_SCREEN_INDEX.md`.

---

## 5. The capability pillars

### Pillar 1 — Project & Construction Delivery
The operational core. Stand up a project with its type, location, contract value, and dates; then run the work:

- **Dashboard** — portfolio KPI tiles (active projects, budget variance, safety) with one-click drill-down.
- **Projects** — the master register that everything else links to.
- **Daily Logs** — field reports with weather, crew, equipment, and delay/safety flags.
- **RFIs & Submittals** — request-for-information and shop-drawing logs with review workflows, ball-in-court tracking, and overdue escalation.
- **Drawings** — sheet register by discipline with revision history, in-browser markup, and issue-for-construction tracking.
- **BIM coordination** — IFC model upload with background parsing and clash/coordination issue tracking.
- **Inspections** — template-driven checklists (concrete, firestop, MEP rough-in, and more) with pass/fail/conditional results and deficiency linking.
- **Punch List** — close-out items with location, trade, priority, photos, and verification.
- **Meetings** — agendas, minutes, decisions, and action items that auto-link to the Action Center.
- **Schedule Import** — drag-and-drop Primavera P6 (XER) and MS Project (XML) with activity, WBS, and dependency parsing and baseline creation.
- **Action Center** — the cross-module "work-order" system: any action, on any entity, with automatic SLA due dates, escalation, delegation, and real-time notifications.
- **Team & Timesheets** — roster, roles, cost rates, project assignments, and weekly timesheet approval.

### Pillar 2 — Commissioning & Turnover *(a signature strength)*
This is where Denver Engineering separates from project-controls tools. The commissioning module is a real, structured workflow — not a folder of PDFs:

- **Four-phase workflow:** pre-commissioning → pre-functional → functional performance → turnover.
- **21 asset types** with phase-specific test templates and prerequisites — pumps, AHUs, chillers, RO skids, panels, valves, fans, motors, generators, VFDs, PLCs, boilers, blowers, mixers, dosing skids, clarifiers, filters, UV systems, chlorination systems, lift stations, and instruments.
- **Test packs** (pre-comm, loop check, start-up, functional, turnover) with revisions and per-step results — expected vs. actual, performed-by, witnessed-by, timestamp, and evidence link.
- **Deficiency management** with severity, assignment, due dates, and a **retest loop** that closes the deficiency only when the retest passes.
- **Weighted readiness scoring** at project, system, and subsystem level — with the exact blocking factors and a history trend.
- **Turnover packages** — O&M manuals, spare parts, training, and warranty records assembled into a downloadable deliverable.

### Pillar 3 — Financial Controls
A full project-controls and earned-value suite:

- **Budgets** — original / approved-change / revised budgets by cost code and WBS.
- **Change Orders** — change event → pricing → approval → execution, with cost and schedule impact.
- **Cost Control** — budget vs. committed vs. actual with variance analysis and forecast-at-completion trending.
- **Cost Entry** — mobile-friendly field cost capture (labor, materials, equipment) that feeds cost control directly.
- **Earned Value Management** — BCWS/BCWP/ACWP, SPI/CPI/SV/CV, EAC/ETC, and the time-phased S-curve.
- **Risk Register** — probability × impact scoring on a 1–25 matrix, with Monte Carlo simulation for schedule and cost risk.
- **Portfolio** — cross-project budget rollup with IRR, NPV, and MOIC and scenario comparison.

### Pillar 4 — Documents & Knowledge
- **Transmittals** — formal document transmittal workflow with response tracking and overdue detection (Aconex/Procore parity).
- **Document register** — ISO 19650-aware common-data-environment states, full-text search, and AI-generated summaries across the corpus.
- **Knowledge hub** — ingest PDFs, Office files, CSVs, and text; the platform chunks, embeds, and indexes them for retrieval by the AI assistant.
- **Fix Library** — reusable engineering fix patterns mined from historical deficiency data, searchable and used as an AI retrieval source.

### Pillar 5 — Business Development
- **CRM** — contacts and companies with a lead-stage pipeline and activity timeline.
- **Proposals** — bid pipeline with line-item costing and award/loss tracking, linked to CRM and Projects.
- **Vendors & Subcontracts** — directory with prequalification, bid packages, bid comparison, award, and schedule of values.

### Pillar 6 — Field & IoT
- **Field Service** — offline-capable work entry with background sync and QR-code workflow launchers, for crews working where connectivity is poor.
- **IoT Sensors** — sensor registry with live readings ingest, time-series charts, and alert thresholds for construction-site and equipment monitoring.

### Pillar 7 — Engineering Design Tools
- **P&ID / PFD generation** *(genuinely strong)* — real ISA-5.1 process diagrams with valve actuators, instrument bubbles, title blocks, and DXF export.
- **Engineering Hub & Calc workspace** — a unified engineering view (open RFIs, submittals, drawings, deliverables, milestones) plus EPC calculators (earned value, schedule, manpower, unit-rate) and discipline design-assist surfaces for water/wastewater, MEP, and stormwater concept work.

> **On the discipline design tools (honest note):** the water/wastewater/HVAC/stormwater discipline panels are **design-assist and drafting surfaces** — they help engineers lay out and visualize a design and generate diagrams. They are **not** certified calculation engines, and the platform does not present their numeric outputs as stamped engineering. Customers should treat them as concept/drafting aids. This honesty is deliberate — see Section 11.

---

## 6. The intelligence layer

Three AI capabilities sit on top of the shared data.

### Ask Jarvis — grounded document intelligence
A retrieval-augmented assistant that answers questions **from your own ingested documents**, blending semantic vector search with full-text search and returning an answer with a **citation for every source chunk**. It maintains persistent chat sessions, supports a resolve/link-to-work workflow, and includes a **prompt-injection guard** that rejects jailbreak attempts before any model call. It is engineered to ground its answers and cite sources — not to improvise.

### Predict — predictive project intelligence
- **Project health score (0–100)** weighted across cost performance, schedule performance, budget burn, and change-order risk, classified green/amber/red.
- **Earned-value cost forecast** — a projected estimate-at-completion extrapolated forward, with a trend (improving/worsening/stable) and a goodness-of-fit indicator so you know how much to trust it.
- **Anomaly detection** — flags overdue-action spikes, worsening cost-performance trends, and cost variance beyond threshold.
- **Portfolio summary** — average health, at-risk/watchlist/healthy counts, and per-project scores.

### Executive & Operations Command Center — the leadership cockpit
- **Portfolio risk heatmap** — every project ranked by open actions, escalations, overdue items, and readiness, worst-first.
- **SLA compliance** by action type; **escalation hotspots** by project and module; **contractor performance** scoreboards.
- **Live operations feed** — a real-time, scoped event stream of actions created, escalated, reassigned, and incidents reported.
- **Command actions** — bulk reassign, escalate, freeze/unfreeze SLA timers, and report incidents, all in real time.
- **Root-cause correlation** — given a failure (a failed test, an opened punch item), the platform surfaces the proximate events across daily logs, audit history, compliance tasks, actions, and commissioning packs that most likely explain it, ranked by time-proximity and scope.
- **Explainable recommendations** — deterministic, rules-based next-best-actions (escalate, reassign, prioritize-to-unblock, pause-SLA, compliance-priority) each with a plain-English reason and impact/urgency/confidence scores. No black box.
- **Maintenance & asset health forecasting** — health scoring for commissioned assets based on inspection history, open deficiencies, incident frequency, and age, with ranked recommendations.

---

## 7. What makes it ready to operate: readiness as a metric

Most platforms can tell you what *happened*. Denver Engineering tells you whether a system, project, or portfolio is **ready** — as an objective number.

The **readiness score** (0–100) is computed continuously from a transparent, weighted model:

| Component | Weight | What it measures |
|---|---|---|
| Open actions | 30% | Outstanding work items |
| Blockers | 25% | Unresolved dependency blockers |
| SLA health | 20% | SLA breaches and at-risk items |
| Inspections | 15% | Inspection pass rate |
| Escalations | 10% | Escalated actions as a share of open |

The score maps to a state — **not ready / at risk / conditionally ready / ready** — and always comes with the **blocking factors** that explain it and a **history trend** so you can see the trajectory toward turnover. This is the number that turns "I think we're ready" into "we are 86% ready; here are the four items between us and turnover."

---

## 8. Security, trust & auditability

Enterprise customers don't adopt a system of record they can't trust. The platform is built for that bar:

- **Multi-tenant isolation** with **row-level security on every tenant record** — your data is invisible to every other tenant at the database level.
- **JWT authentication** with short-lived access tokens and secure refresh tokens; WebSocket connections are authenticated on upgrade.
- **Automatic audit logging** — every create/update/delete that succeeds is logged with user, IP, and a redacted body. Your compliance evidence accumulates as a byproduct of normal use.
- **Role-based access** — owner / admin / member / viewer roles gate reads, writes, exports, and AI usage.
- **Defense in depth** — content security policy, rate limiting (global, auth, AI, and agent tiers), UUID validation on every record lookup, and file-upload MIME allowlists with size caps.
- **AI safety** — a prompt-injection guard runs before any model call.
- **Enterprise & regulated options** — air-gapped deployment and certification evidence packages for SOC 2 / ISO 27001 alignment.

---

## 9. Who it's for

The platform serves seven primary personas, each with a tailored slice of the product. Full persona profiles — pain points, daily responsibilities, KPIs, and benefits — are in `CUSTOMER_PERSONAS.md`.

- **Facility Manager** — inherits the as-built record, asset register, and test history on day one.
- **Operations / Project Manager** — runs the project on one source of truth with live status and early-warning forecasts.
- **Maintenance / Reliability Manager** — uses asset health scoring, deficiency history, and the fix library.
- **Utility / Plant Owner's Representative** — gets a provable commissioning record and readiness score before accepting the facility.
- **Commissioning Authority** — runs the structured Cx workflow end to end with defensible evidence.
- **EPC Project Manager** — manages cost, schedule, RFIs, submittals, change orders, and turnover in one place.
- **Executive Leadership** — sees portfolio health, risk, and forecasts in real time, with the ROI to back the investment.

---

## 10. Why customers choose Denver Engineering

1. **One source of truth.** Retire the spreadsheet-and-email reconciliation tax.
2. **Provable commissioning.** Structured tests, evidence, deficiencies, and a readiness score — turnover you can defend.
3. **Early warning.** Predictive health and anomaly detection catch slippage while there's still time.
4. **Institutional memory.** Grounded AI turns your document corpus into instant, cited answers.
5. **Auditability by default.** Compliance evidence builds itself.
6. **Real differentiation.** It owns the build-to-operate seam that no horizontal tool covers well.

The full business case — cost savings, risk reduction, productivity, compliance, and worked ROI examples for embassies, data centers, hospitals, universities, water plants, and industrial facilities — is in `CUSTOMER_VALUE_PROPOSITION.md` and `ROI_ANALYSIS.md`.

---

## 11. What it is — and isn't (honest scope)

We position the platform on what it genuinely does, because credibility wins enterprise deals.

**Denver Engineering is** the system of record and intelligence layer for **delivering, commissioning, and handing over** capital facilities — and for managing the project portfolio that produces them.

**Denver Engineering is not** a real-time SCADA / DCS / plant-operations system. It does not run continuous process control, alarm management, or live HMI telemetry for an operating plant. It registers sensors and ingests readings for construction-site and equipment monitoring, and it commissions control systems (PLCs, instruments) as assets — but the live operation of a running plant is the domain of dedicated SCADA/DCS systems, and we integrate with that world rather than replace it.

Similarly, the discipline **design calculators** (water/wastewater/HVAC/stormwater) are **design-assist and drafting surfaces**, not stamped calculation engines. The **P&ID/PFD generation** is genuinely production-grade. Where a number requires certified engineering, customers should rely on their licensed engineers' validated tools.

Being clear about this is a feature, not a caveat: it tells you exactly where the platform delivers outsized value (delivery, commissioning, readiness, financial controls, document AI) and where it integrates with the rest of your stack.

---

## 12. Getting started

The fastest path to value is a **single program or facility**:

1. **Stand up the project** — register it, import the schedule, set the budget.
2. **Ingest the documents** — drawings, specs, and the knowledge corpus that powers Ask Jarvis.
3. **Run the work** — daily logs, RFIs, submittals, inspections, change orders, and the Action Center.
4. **Commission it** — build the test packs, run the four phases, manage deficiencies, watch the readiness score.
5. **Put it in front of leadership** — the executive dashboard and predictive intelligence across the portfolio.

Within one project cycle, you'll have a single source of truth, a provable commissioning record, and an early-warning system for everything else you're building.

---

*Continue with `CUSTOMER_FEATURE_CATALOG.md` (module detail), `CUSTOMER_WORKFLOWS.md` (end-to-end workflows), `CUSTOMER_PERSONAS.md` (who buys and why), `CUSTOMER_VALUE_PROPOSITION.md` and `ROI_ANALYSIS.md` (the business case), `COMPETITIVE_POSITIONING.md` (honest market position), and `PRESENTATION_SLIDES.md` (the deck).*

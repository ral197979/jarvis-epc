# Customer Feature Catalog

> Module-by-module catalog of every customer-visible capability, translated into business outcomes.
>
> For each module: **Overview · Key Features · Customer Benefits · Business Outcomes · Typical Use Cases · Primary User**. Every feature listed is backed by the live application.

---

## How to read this catalog

Modules are grouped by the same nine work domains used in the product. Where the brief asked about a capability that the platform delivers under a different name (for example, "Work Orders" → the **Action Center**), this is noted explicitly. Where a requested capability does **not** exist as a real-time operational system (for example, SCADA/plant operations), that is stated honestly in the [Scope notes](#scope-notes-what-the-platform-deliberately-does-not-do) at the end.

---

# Operations

## 1. Dashboard

**Overview.** The home screen and operational nerve center. A unified, at-a-glance view of portfolio health the moment a user logs in.

**Key Features**
- KPI tiles: pipeline value, active contracts, revenue, accounts receivable, procurement outstanding, documents issued, safety incidents
- Earned-value health gauges (CPI/SPI) per project
- Pipeline-by-stage chart and a live activity feed
- Click-through from any KPI tile to its detail view

**Customer Benefits.** Everyone — from PM to CEO — starts the day with the same trustworthy picture. No assembling a status report; it's already there.

**Business Outcomes.** Faster decisions, fewer status meetings, earlier reaction to red flags.

**Typical Use Cases.** Monday-morning portfolio review; an executive's daily glance; a PM checking overnight changes.

**Primary User.** All roles; especially PMs and leadership.

---

## 2. Projects

**Overview.** The master register that everything in the platform links to.

**Key Features**
- Create projects with type, location, contract value, and key dates
- Status workflow: planning → active → commissioning → closed
- Project-scoped filtering across the entire platform
- Links to drawings, RFIs, inspections, budget, commissioning, and more

**Customer Benefits.** One authoritative record of every project; no more "which spreadsheet is current?"

**Business Outcomes.** Consistent project governance; instant cross-module context.

**Typical Use Cases.** Onboarding a new award; switching context between active jobs; portfolio segmentation.

**Primary User.** Project managers, operations leaders.

---

## 3. Action Center *(this is the platform's "Work Orders")*

**Overview.** The cross-module action and work-order system. Any action, attached to any entity (an RFI, a deficiency, a piece of equipment), tracked to closure.

**Key Features**
- Create actions linked to any domain object
- SLA engine auto-assigns due dates by priority and action type
- Operational risk scoring (impact × urgency × SLA overdue)
- Escalation rules and delegation-chain resolution
- Prioritization recommendations when risk crosses threshold
- Real-time WebSocket notifications on every update

**Customer Benefits.** Nothing falls through the cracks. Every commitment has an owner, a due date, and an escalation path.

**Business Outcomes.** Higher on-time closure rates; fewer missed commitments; auditable accountability.

**Typical Use Cases.** Tracking a punch-item fix, a corrective action from an inspection, an RFI follow-up, or a maintenance task on a commissioned asset.

**Primary User.** Everyone who owns or assigns work.

> **Note on "Work Orders":** The Action Center is the platform's work-order system. It handles assignment, SLA, escalation, and closure for any task. It is not a job-costing/parts-tracking CMMS work-order module — for spare-parts inventory and labor-costed work orders, the platform integrates with dedicated EAM/CMMS systems.

---

## 4. Timesheets

**Overview.** Workforce timesheet capture and approval.

**Key Features** Weekly entry per worker; regular/overtime/double-time breakdown; submitted → approved → payroll workflow; cost-code allocation per line.

**Customer Benefits.** Accurate labor capture tied directly to cost codes and projects.

**Business Outcomes.** Cleaner labor cost data; faster payroll; defensible labor records.

**Typical Use Cases.** Weekly crew time approval; labor cost allocation.

**Primary User.** Supervisors, project controls, payroll.

---

## 5. Team

**Overview.** Workforce and roster management.

**Key Features** Employee/subcontractor roster; role, trade, and cost-rate records; project assignment tracking; allocation percentage; timesheet linkage.

**Customer Benefits.** Know who is on each project, in what role, at what rate.

**Business Outcomes.** Better resource utilization; accurate labor costing.

**Typical Use Cases.** Staffing a new project; tracking allocation across jobs.

**Primary User.** Resource managers, PMs.

---

## 6. Notifications

**Overview.** Real-time in-app notification center.

**Key Features** WebSocket delivery; types include action assigned, SLA breach, document received, system alert; mark-as-read; per-user preferences.

**Customer Benefits.** People hear about what matters to them, when it happens.

**Business Outcomes.** Faster response; less reliance on email.

**Primary User.** All roles.

---

# AI

## 7. Ask Jarvis — Grounded AI Assistant

**Overview.** A retrieval-augmented assistant that answers questions from **your** ingested documents, with a citation for every claim.

**Key Features**
- Answers grounded in your document corpus and fix library (not the open internet)
- Citation hover and source-modal for every chunk used
- Persistent chat sessions per user; resolve / link-to-work workflow
- Prompt-injection guard that rejects jailbreak attempts before any model call
- Structured answers (answer, possible causes, procedure, confidence, citations)

**Customer Benefits.** Decades of institutional knowledge become instantly searchable and trustworthy. New staff onboard faster; experts spend less time answering the same questions.

**Business Outcomes.** Faster problem resolution; reduced key-person dependency; fewer repeated mistakes.

**Typical Use Cases.** "What's the startup sequence for the RO skid?" "Which spec covers firestop at rated walls?" "Why did this pump fail last time?"

**Primary User.** Engineers, field staff, commissioning agents, operators.

---

## 8. Predict — Predictive Project Intelligence

**Overview.** Forecasting and early-warning for project cost, schedule, and health.

**Key Features**
- Project health score (0–100) across cost performance, schedule, budget burn, change-order risk
- Earned-value-based estimate-at-completion forecast with trend and confidence
- Anomaly detection (overdue spikes, worsening CPI, cost variance)
- Portfolio summary: average health, at-risk/watchlist/healthy counts

**Customer Benefits.** Leaders find out about slippage early enough to act.

**Business Outcomes.** Fewer surprise overruns; proactive intervention; protected margin.

**Typical Use Cases.** Monthly portfolio review; flagging the project that's quietly drifting red.

**Primary User.** Executives, project controls, PMs.

---

# CRM & Business Development

## 9. CRM

**Overview.** Contact, company, and lead-pipeline management.

**Key Features** Contact/company records; lead-stage pipeline (prospect → qualified → proposal → closed); activity timeline; win-rate tracking; linked to Proposals.

**Customer Benefits.** Business development and delivery share one view of the customer relationship.

**Business Outcomes.** Higher win rates; cleaner pipeline forecasting.

**Primary User.** Business development.

## 10. Proposals

**Overview.** Bid pipeline from estimate to award.

**Key Features** Proposal header (client, value, due date, status); line-item costing; draft → submitted → awarded/lost workflow; linked to CRM and Projects.

**Customer Benefits.** Bid effort is structured and reusable; awards flow straight into project setup.

**Business Outcomes.** Faster bid turnaround; better bid/no-bid decisions.

**Primary User.** Estimators, business development.

## 11. Vendor & Subcontractor Directory

**Overview.** The procurement registry.

**Key Features** Company records with trade, contact, location; prequalification status; linked to bid packages and subcontracts.

**Customer Benefits.** A vetted, reusable supplier network.

**Business Outcomes.** Faster procurement; better subcontractor selection.

**Primary User.** Procurement, PMs.

## 12. Subcontracts

**Overview.** Bid package and subcontract management.

**Key Features** Bid package creation with scope, budget, due dates; subcontractor invitation and bid comparison; award and execution tracking; schedule of values.

**Customer Benefits.** Competitive, documented, defensible procurement.

**Business Outcomes.** Lower buyout cost; cleaner subcontract administration.

**Primary User.** Procurement, project controls.

---

# Engineering

## 13. Engineering Hub & FEED

**Overview.** A unified engineering view of the active project plus front-end engineering deliverables.

**Key Features** Open RFIs, submittals, drawings, and deliverables in one view; discipline organization; revision and status tracking; milestone tracker; engineering team assignments.

**Customer Benefits.** Engineering leads see the whole picture without hopping between modules.

**Business Outcomes.** Faster design coordination; fewer dropped deliverables.

**Primary User.** Engineering managers, discipline leads.

## 14. Drawings

**Overview.** Drawing register and revision management.

**Key Features** Sheet register by discipline; revision history; in-browser markup and comment threads; issue-for-construction workflow.

**Customer Benefits.** Everyone works from the current revision; markups are captured, not lost on a printout.

**Business Outcomes.** Fewer rework events from outdated drawings.

**Primary User.** Engineers, field staff, document control.

## 15. BIM Coordination

**Overview.** BIM model management and clash coordination.

**Key Features** IFC model upload (validated, size-capped); background model parsing; web-based viewer; coordination/clash issue tracking by severity; element-level annotation.

**Customer Benefits.** Clashes are found and resolved on screen, before they're built.

**Business Outcomes.** Reduced field rework; smoother MEP coordination.

**Primary User.** BIM coordinators, engineers.

## 16. Fix Library

**Overview.** A reusable engineering fix-pattern knowledge base.

**Key Features** Patterns mined from historical deficiency data; searchable by system, symptom, and resolution; confidence scoring; used as an Ask Jarvis retrieval source.

**Customer Benefits.** The organization stops re-solving the same problems.

**Business Outcomes.** Faster troubleshooting; captured tribal knowledge.

**Primary User.** Engineers, maintenance, commissioning agents.

## 17. Process Design & P&ID/PFD Generation

**Overview.** A process-engineering design surface with genuine diagram generation.

**Key Features**
- **P&ID/PFD generation (production-grade):** ISA-5.1 diagrams with valve actuators, instrument bubbles, title blocks, and DXF export
- Equipment library and stream-data input for concept layout
- AI-assisted design conversation for process concepts

**Customer Benefits.** Rapid, standards-compliant process diagrams without a separate CAD seat.

**Business Outcomes.** Faster concept-to-diagram cycles.

**Primary User.** Process engineers, designers.

> **Honest scope:** The diagram generation is real and strong. The discipline *calculators* in this area (water/wastewater/HVAC/stormwater sizing) are **design-assist/drafting aids**, not certified calculation engines — see [Scope notes](#scope-notes-what-the-platform-deliberately-does-not-do).

## 18. Engineering Calc Workspace

**Overview.** EPC calculators for project controls.

**Key Features** Earned-value, schedule, manpower-leveling, and unit-rate estimating calculators with input forms and saved history.

**Customer Benefits.** Common project-controls math in one place, tied to project data.

**Business Outcomes.** Faster, more consistent estimates and analyses.

**Primary User.** Project controls, estimators.

---

# Construction

## 19. Daily Logs

**Overview.** Field daily report capture.

**Key Features** Date, weather, crew count, equipment, work description; delay and safety-incident flags; per-trade manpower; photos; exportable.

**Customer Benefits.** A complete, time-stamped field record — invaluable for claims and disputes.

**Business Outcomes.** Defensible delay documentation; reduced claim exposure.

**Primary User.** Superintendents, field engineers.

## 20. Inspections

**Overview.** Template-driven inspection management.

**Key Features** Configurable checklists per discipline (e.g., concrete, firestop, MEP rough-in); records tied to location and date; pass/fail/conditional per item; deficiency linking.

**Customer Benefits.** Quality is verified to a standard, with evidence.

**Business Outcomes.** Higher first-time quality; reduced rework; cleaner QA/QC record.

**Primary User.** QA/QC inspectors, field engineers.

## 21. Punch List

**Overview.** Construction punch list and close-out.

**Key Features** Items with location, trade, description, priority; open → in-progress → complete → verified workflow; photo attachments; owner close-out export.

**Customer Benefits.** A controlled, photographed, verifiable close-out.

**Business Outcomes.** Faster substantial completion; fewer post-occupancy callbacks.

**Primary User.** PMs, superintendents, owners.

## 22. RFIs

**Overview.** Request-for-information workflow.

**Key Features** RFI creation with subject, question, ball-in-court, due date; open → responded → closed; overdue badge and escalation; linked to drawings and specs.

**Customer Benefits.** Questions get answered and documented, not lost in email.

**Business Outcomes.** Faster answers; documented basis for change.

**Primary User.** Field engineers, design team.

## 23. Submittals

**Overview.** Shop drawing and submittal register.

**Key Features** Submittal log with spec section, type, revision; submitted → under review → approved/rejected; re-submittal tracking.

**Customer Benefits.** Procurement-critical approvals are tracked to closure.

**Business Outcomes.** Fewer procurement delays from late approvals.

**Primary User.** Document control, engineers.

## 24. Meetings

**Overview.** Meeting minutes and action-item capture.

**Key Features** Agendas; minutes with decisions and action items; attendee list and distribution; auto-link of action items to the Action Center.

**Customer Benefits.** Decisions and commitments are captured and tracked, not forgotten.

**Business Outcomes.** Better follow-through; documented decisions.

**Primary User.** PMs, all project participants.

## 25. Schedule Import

**Overview.** Primavera P6 and MS Project import.

**Key Features** Drag-and-drop `.xer`/`.xml`; activity, WBS, and dependency parsing; baseline creation; CPM calculation.

**Customer Benefits.** Bring the master schedule into the platform without re-keying.

**Business Outcomes.** Schedule and execution data live together.

**Primary User.** Schedulers, project controls.

## 26. Compliance

**Overview.** Regulatory compliance task tracking.

**Key Features** Compliance task register with regulation reference and due date; evidence attachment; a background watcher that auto-flags overdue items.

**Customer Benefits.** Regulatory obligations are tracked with evidence, not in someone's head.

**Business Outcomes.** Reduced compliance risk; audit-ready records.

**Primary User.** Compliance officers, PMs.

## 27. Risk Register

**Overview.** Full project risk management.

**Key Features** Risk creation (category, probability, impact, owner, response plan); 1–25 score matrix; identified → assessed → mitigated → closed; Monte Carlo schedule/cost simulation; KPI tiles (total, high, mitigated, overdue).

**Customer Benefits.** Risk is quantified and actively managed, not just listed.

**Business Outcomes.** Fewer realized risks; quantified contingency.

**Primary User.** Risk managers, PMs, executives.

---

# Finance

## 28. Budget

**Overview.** Project budget management.

**Key Features** Original / approved-change / revised budgets; cost-code and WBS breakdown; budget vs. committed vs. actual columns; linked to change orders and EVM.

**Customer Benefits.** A live, structured budget — not a stale spreadsheet.

**Business Outcomes.** Tighter cost control; earlier variance detection.

**Primary User.** Project controls, finance.

## 29. Change Orders

**Overview.** Change order lifecycle management.

**Key Features** Change event → pricing → approval → execution; cost and schedule impact fields; draft → submitted → approved → executed; linked to budget and EVM.

**Customer Benefits.** Changes are priced, approved, and tracked — protecting margin and the record.

**Business Outcomes.** Faster change recovery; reduced disputed changes.

**Primary User.** PMs, project controls.

## 30. Cost Control

**Overview.** The cost-performance dashboard.

**Key Features** Budget vs. committed vs. actual by cost code/WBS; variance analysis with % complete; forecast-at-completion trending; drill-down to entries; waterfall and trend charts; top-subcontractor spend.

**Customer Benefits.** Cost truth, in real time, at the level you need.

**Business Outcomes.** Protected margin; no end-of-month surprises.

**Primary User.** Project controls, finance, PMs.

## 31. Cost Entry

**Overview.** Field cost capture.

**Key Features** Mobile-friendly labor/material/equipment entry; cost-code and WBS selection; batch crew entry; feeds Cost Control directly.

**Customer Benefits.** Costs are captured at the source, accurately, immediately.

**Business Outcomes.** Real-time cost data; fewer reconciliation errors.

**Primary User.** Field supervisors, cost engineers.

## 32. Earned Value Management (EVM)

**Overview.** A full EVM dashboard.

**Key Features** BCWS/BCWP/ACWP; SPI/CPI/SV/CV; EAC/ETC/VAC/TCPI; time-phased S-curve; green/yellow/red health.

**Customer Benefits.** The industry-standard objective measure of project performance.

**Business Outcomes.** Early, quantified performance signals; defensible reporting to owners and lenders.

**Primary User.** Project controls, executives, owners.

## 33. Portfolio

**Overview.** Portfolio-level financial intelligence.

**Key Features** Cross-project budget rollup; IRR, NPV, MOIC; performance comparison grid; scenario modeling; cross-project conflict and bottleneck detection.

**Customer Benefits.** The investment view of the whole portfolio in one place.

**Business Outcomes.** Better capital allocation; earlier portfolio risk detection.

**Primary User.** Executives, finance leadership.

---

# Documents

## 34. Transmittals

**Overview.** Formal document transmittal workflow.

**Key Features** Transmittal with subject, purpose, from/to parties; attached document items with revision tracking; draft → sent → responded → closed; required-response date with overdue detection.

**Customer Benefits.** A defensible, time-stamped record of what was sent, to whom, and when.

**Business Outcomes.** Reduced dispute exposure; controlled distribution.

**Primary User.** Document control, PMs.

## 35. Document Register & Library

**Overview.** General document management with AI search.

**Key Features** Upload with MIME allowlist (PDF, Office, images, IFC, 3D); ISO 19650-aware CDE states; extracted text and AI summaries; full-text search across the corpus.

**Customer Benefits.** Every document is findable, summarized, and access-controlled.

**Business Outcomes.** Less time searching; a controlled common data environment.

**Primary User.** All roles; document controllers.

## 36. Knowledge Hub

**Overview.** Document ingestion that powers the AI assistant.

**Key Features** Upload PDFs/Office/CSV/text; background chunking, embedding, and indexing; semantic + full-text retrieval; source management.

**Customer Benefits.** Your documents become an answerable knowledge base.

**Business Outcomes.** Institutional knowledge captured and reusable.

**Primary User.** Admins, knowledge managers.

---

# Commissioning *(signature module)*

## 37. Commissioning & Turnover

**Overview.** A structured, evidence-based commissioning workflow — the platform's standout capability for owners and commissioning authorities.

**Key Features**
- **Four phases:** pre-commissioning → pre-functional → functional performance → turnover
- **21 asset types** with phase-specific test templates and prerequisites (pumps, AHUs, chillers, RO skids, panels, valves, fans, motors, generators, VFDs, PLCs, boilers, blowers, mixers, dosing skids, clarifiers, filters, UV systems, chlorination systems, lift stations, instruments)
- **Test packs** (pre-comm, loop check, start-up, functional, turnover) with revisions and per-step results: expected vs. actual, performed-by, witnessed-by, timestamp, evidence link
- **Deficiency management** with severity, assignment, due date, and a **retest loop** that closes only on a passing retest
- **Asset hierarchy:** project → system → subsystem → tag, with coverage reporting
- **Weighted readiness scoring** at project/system/subsystem level, with blocking factors and history
- **Turnover packages** (O&M, spares, training, warranty) rendered as downloadable deliverables

**Customer Benefits.** Commissioning becomes provable. Every test, every deficiency, every sign-off is captured with evidence — and the readiness score makes "are we ready?" an objective answer.

**Business Outcomes.** On-time turnover; reduced retest and rework; defensible owner acceptance; a clean as-built record handed to operations.

**Typical Use Cases.** A CxA commissioning a data center's mechanical/electrical systems; an owner's rep verifying a water plant is ready before acceptance; an EPC closing out a hospital's systems.

**Primary User.** Commissioning authorities, owners' representatives, EPC PMs.

---

# Executive & Operations Command Center

## 38. Executive Command Center

**Overview.** The leadership cockpit across the whole portfolio.

**Key Features**
- Portfolio risk heatmap (worst-first by open actions, escalations, overdue, readiness)
- SLA compliance by action type; escalation hotspots by project/module
- Contractor performance scoreboards; AI-recommendation acceptance trends
- Operational throughput trends

**Customer Benefits.** One screen tells leadership where to look — and where not to worry.

**Business Outcomes.** Faster executive decisions; focused intervention.

**Primary User.** Executives, program directors.

## 39. Operations Command Center

**Overview.** The real-time operations cockpit.

**Key Features**
- Live metrics: open/overdue/escalated/blocked actions, active incidents, notification failures
- Live event feed (scoped to tenant/project/action)
- Command actions: bulk reassign, escalate, freeze/unfreeze SLA, report incident
- Blocker analysis (which items unblock the most work)
- Root-cause event correlation across daily logs, audit, compliance, actions, commissioning
- Explainable, rules-based next-best-action recommendations
- Asset health & maintenance forecasting

**Customer Benefits.** Operations leaders run the day from one place, in real time, with the reasons behind every recommendation.

**Business Outcomes.** Faster cycle times; fewer breached SLAs; less firefighting.

**Primary User.** Operations managers, program controls.

---

# Field & IoT

## 40. Field Service (Offline)

**Overview.** Field operations for low-connectivity environments.

**Key Features** Offline-capable work entry; background sync on reconnect; QR-code workflow launchers; batch replay.

**Customer Benefits.** Field crews capture data anywhere; it syncs when they're back online.

**Business Outcomes.** Complete field data; no lost entries.

**Primary User.** Field technicians, superintendents.

## 41. IoT Sensors

**Overview.** Sensor registry and readings for construction-site and equipment monitoring.

**Key Features** Sensor registry (type, location, status); live readings ingest; time-series charts; alert thresholds.

**Customer Benefits.** Site and equipment conditions are monitored and charted with threshold alerts.

**Business Outcomes.** Earlier detection of out-of-range conditions during construction and commissioning.

**Primary User.** Field engineers, commissioning agents.

> **Honest scope:** This is monitoring of registered sensors with threshold alerts — **not** a real-time SCADA/DCS operations system for a running plant. See [Scope notes](#scope-notes-what-the-platform-deliberately-does-not-do).

---

# System & Platform

## 42. Integrations Hub

**Overview.** Outbound connector management.

**Key Features** Integration registry (accounting, messaging, field, BIM, and more); connection test; manual sync trigger; enable/disable auto-sync; webhook delivery; last-sync and error display.

**Customer Benefits.** The platform fits into your existing stack.

**Business Outcomes.** No rip-and-replace; data flows to the systems you already run.

**Primary User.** Admins, IT.

## 43. Automation

**Overview.** Scheduler and background-job administration plus rule-based automation.

**Key Features** View/manage scheduled jobs; trigger manual runs; rule-based action and compliance-task creation; job history and logs.

**Customer Benefits.** Routine work happens automatically and visibly.

**Business Outcomes.** Less manual effort; consistent process execution.

**Primary User.** Admins.

## 44. User Management & Security (Settings)

**Overview.** Tenant and user administration.

**Key Features** Tenant profile and plan; user invite and roles (owner/admin/member/viewer); API key management; usage and quota display; underpinned by row-level security and automatic audit logging.

**Customer Benefits.** Enterprise-grade control over who can see and do what.

**Business Outcomes.** Reduced security risk; clean access governance; audit-ready.

**Primary User.** Tenant admins, security/IT.

## 45. MCP Tool Bridge

**Overview.** Exposes platform capabilities as tools for AI agents (Model Context Protocol).

**Key Features** Tool registry; schema view; controlled tool execution.

**Customer Benefits.** The platform can be safely extended and automated by AI agents.

**Business Outcomes.** Future-proof automation surface.

**Primary User.** Advanced admins, integration partners.

---

## Scope notes (what the platform deliberately does *not* do)

Credibility matters, so the catalog is explicit about boundaries:

| Capability customers sometimes expect | Reality | What the platform offers instead |
|---|---|---|
| **Real-time SCADA / DCS / plant operations** (continuous process control, alarm management, live HMI) | **Not provided.** This is the domain of dedicated operational-technology systems. | Commissioning of control systems as assets; sensor registry + threshold monitoring; integration with OT systems |
| **Certified discipline calculators** (water/wastewater/HVAC/stormwater sizing as stamped engineering) | **Design-assist/drafting only.** Numeric outputs are concept aids, not certified engineering. | Production-grade P&ID/PFD generation; EPC project-controls calculators |
| **CMMS work orders with parts inventory & labor job-costing** | **Not a dedicated CMMS module.** | The Action Center (assignment, SLA, escalation, closure) + integration with EAM/CMMS |
| **Spare-parts / materials inventory management** | **Not provided as a dedicated module.** | Vendor/procurement registry; integration with ERP/inventory systems |

Being explicit here is a strength: it tells customers exactly where Denver Engineering delivers outsized value (delivery, commissioning, readiness, financial controls, document AI, executive intelligence) and where it integrates with the rest of their stack.

---

*See `CUSTOMER_WORKFLOWS.md` for how these modules combine into end-to-end workflows, and `PRODUCT_SCREEN_INDEX.md` for the full screen inventory.*

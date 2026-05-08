# JARVIS EPC — Investor Pitch
## The AI-Native Platform for Engineering, Procurement & Construction

---

## The Problem

Engineering, Procurement & Construction (EPC) is a **$11 trillion global industry** — and it runs on spreadsheets, email chains, and disconnected point tools.

The average large EPC project:
- **Overruns budget by 28%** (McKinsey, 2023)
- **Misses schedule by 45%** on average
- Loses **$1.6M/week** in rework caused by information silos
- Uses **12–18 separate software tools** that don't talk to each other

The incumbents — Procore, Autodesk Construction Cloud, AVEVA, InEight, Hexagon — are expensive ($80K–$500K/yr), desktop-first, and built on 15-year-old architecture. None of them have a native AI layer.

**JARVIS EPC is the first full-lifecycle EPC platform built AI-native, from the ground up.**

---

## The Solution

JARVIS EPC is a **multi-tenant, cloud-native SaaS platform** that manages the entire EPC project lifecycle — from the first client proposal through final commissioning handover — in a single, integrated workspace.

Every module shares the same data model. Every action is audited. Every decision is informed by AI.

---

## Market Opportunity

| Segment | TAM | SAM (5-yr) |
|---|---|---|
| Construction Project Management Software | $2.8B | $420M |
| EPC-specific (O&G, Power, Pharma, Infrastructure) | $4.1B | $680M |
| AI-augmented engineering tools | $1.2B (growing 34% YoY) | $380M |
| **Combined addressable market** | **$8.1B** | **$1.48B** |

Target customers: **mid-market EPC contractors** ($50M–$2B annual revenue) — underserved by heavy enterprise tools, outgrown by basic construction apps.

---

## Product — Full Feature Overview

### Core Architecture

- **Multi-tenant PostgreSQL** with Row-Level Security — every record is tenant-scoped, zero cross-contamination
- **JWT authentication** with httpOnly cookie rotation (15-min access / 7-day refresh), full RBAC (Owner → Exec → PM → Engineer → Viewer)
- **Progressive Web App** — installable on any device, works fully offline with IndexedDB mutation queue that replays on reconnect
- **Audit log** — every write operation is logged with user, resource, IP, user-agent, and request body (PII-redacted)
- **SOC2-ready security** — helmet CSP, rate limiting (600/min global, 30/min AI), HMAC-signed webhooks, security.txt
- **43 registered MCP tools** — extensible AI tool catalog via Model Context Protocol

---

### Module 1 — CRM & Business Development

**Win more work.**

- Full contact and company database with relationship tracking
- Opportunity pipeline with stage management (Prospect → Proposal → Negotiation → Won/Lost)
- **Proposals module**: bid/no-bid decision tracker, win probability scoring (0–100%), pipeline value KPIs, hit-rate analytics
- Proposal status workflow: In Progress → Submitted → Shortlisted → Awarded / Declined
- FEED (Front-End Engineering & Design) phase kickoff directly from won opportunity
- Integrates with CRM leads for seamless handoff from sales to execution

---

### Module 2 — Project Management

**One source of truth across all active projects.**

- Unlimited project register with status lifecycle (FEED → Engineering → Procurement → Construction → Commissioning → Closeout)
- Project health dashboard: budget variance, schedule SPI/CPI, open RFIs, outstanding submittals
- Resource allocation planning across projects
- Multi-project portfolio finance view with roll-up reporting
- Risk register with severity × likelihood matrix, mitigation tracking
- Action items tracker with owner assignment, due-date escalation, and completion audit trail

---

### Module 3 — CPM Scheduling & EVM

**Know exactly where you stand — before it's too late.**

The most analytically rigorous scheduling module in any construction SaaS:

- **CPM Engine** (Critical Path Method):
  - Full forward pass (Early Start, Early Finish)
  - Full backward pass (Late Start, Late Finish)
  - Total Float, Free Float, Critical flag per activity
  - Predecessor/successor dependency network
- **4 schedule views**: Gantt chart, CPM Network diagram (SVG arrows), Float Analysis table, Earned Value Management
- **EVM (Earned Value Management)**:
  - CPI (Cost Performance Index), SPI (Schedule Performance Index)
  - EAC (Estimate at Completion), VAC (Variance at Completion)
  - CV (Cost Variance), SV (Schedule Variance)
  - Baseline vs. actual burn curves
- KPIs: Total activities, critical count, project duration, average float, % complete
- Milestone tracking with critical path highlighting

---

### Module 4 — Engineering

**From P&ID to punch list.**

- Drawing register with revision control (Rev A → Rev Z, IFC, As-Built)
- Markup layer on drawings (comments, redlines, dimensional annotations)
- Calculation log with discipline categorization and approval workflow
- **Plant Engineering Import** (AVEVA, Hexagon SmartPID, Bentley OpenPlant compatible):
  - P&ID tag import: instruments, equipment, lines, valves
  - Dry-run validation before commit
  - Upsert on conflict — re-import updated P&IDs without data loss
  - Source system tracking (AVEVA ERM, PDMS, Smart P&ID)
- **BIM Coordination**:
  - IFC, glTF, NWD, RVT model register with discipline tagging
  - Autodesk Platform Services (APS) integration — server-side token proxy (client secret never exposed to browser)
  - 3D viewer with clash/coordination issue tracker
  - Severity grading (Minor / Major / Critical), issue assignment and resolution workflow

---

### Module 5 — Procurement

**Vendor management built for complex supply chains.**

- Vendor database with qualification status and performance scoring
- Purchase Order management: draft → issued → partially received → closed
- Line-item tracking with unit pricing and quantity reconciliation
- RFI (Request for Information) workflow with response SLA tracking
- Submittal register with review cycles (Submit → Under Review → Approved / Rejected)
- MR (Material Requisition) and MTO (Material Take-Off) support
- Bid tabulation and bid comparison across vendors

---

### Module 6 — Construction

**Real-time site intelligence.**

- Daily logs: weather, manpower, equipment, work performed, safety observations
- Inspection templates and records with pass/fail/conditional outcomes
- Punch list management: open/in-progress/closed items with photo attachments
- **Field Operations** (mobile-first, offline-capable):
  - Quick capture: field observations, safety issues, daily notes
  - Offline queue stores captures locally, replays to server on reconnect
  - Safety module: Job Hazard Analysis (JHA), incident reporting, permit-to-work summary
  - Mobile-optimized tab bar for one-thumb navigation
- Progress measurement against baseline schedule
- Subcontractor performance tracking

---

### Module 7 — Safety

**Zero-incident culture, digitally enforced.**

- Incident report database with severity classification (Near-Miss → First Aid → Recordable → LTI)
- JHA (Job Hazard Analysis) creation and digital sign-off
- Permit-to-work tracking (Hot Work, Confined Space, Electrical Isolation, Working at Height)
- Safety observation feed with trending hazard categories
- Compliance dashboard: recordable rate, near-miss ratio, open permits

---

### Module 8 — Commissioning

**Structured handover, not a scramble.**

- Commissioning baseline — scope, systems list, and ITR (Inspection and Test Record) catalog
- Pack generation workflow: automated punch list export for subsystem walk-downs
- CX workflow management: mechanical completion → pre-commissioning → commissioning → startup
- Tag-level status tracking against RFSU (Ready for Start-Up) milestones
- Integrated with engineering P&ID tag register — same tags, zero re-entry

---

### Module 9 — Finance & Portfolio

**From job cost to executive reporting.**

- Budget management with WBS (Work Breakdown Structure) alignment
- Change order tracking: scope changes → cost impact → approval → committed cost update
- Cost forecast vs. actuals with trend analysis
- Portfolio-level roll-up: total committed, forecast, variance across all active projects
- Invoice matching against purchase orders and GRNs (Goods Receipt Notes)

---

### Module 10 — AI Predict

**Know what will happen before it does.**

- **Risk heat map**: cost variance (Y) vs. schedule slip (X) scatter plot — visual portfolio risk exposure at a glance
- **Per-project predictions**: cost variance %, schedule slip days, risk score (0–100), confidence interval
- **Top risk factor extraction**: AI identifies the primary drivers (procurement delays, resource constraints, weather windows, material escalation)
- **SVG risk gauge** per project — at-a-glance confidence visualization
- **Ask AI (natural language query)**:
  - "Which projects are most at risk this quarter?"
  - "Summarize schedule status across all active jobs"
  - "Which projects are tracking over budget?"
  - Powered by Claude (Anthropic) via server-side proxy with rate limiting
  - Falls back to deterministic canned answers when AI gateway is offline

---

### Module 11 — Integrations & Webhooks

**Connect JARVIS to your existing stack.**

- **Connector catalog**: QuickBooks (accounting), Slack (notifications), Tractian (asset monitoring), Procore (construction data), MS Dynamics (ERP), custom REST endpoints
- Per-connector test, enable/disable, last-sync status
- Add-connector form with API key vault (credentials encrypted at rest)
- **Webhook dispatcher**:
  - Subscribe to 8 event types: `project.created`, `po.issued`, `rfi.submitted`, `submittal.approved`, `inspection.failed`, `punch.closed`, `commissioning.complete`, `budget.exceeded`
  - HMAC-SHA256 signed payloads — receiving systems can verify authenticity
  - Retry-on-failure with delivery log
- Sync job history: trigger, status, records synced, duration, error detail

---

### Module 12 — Team & Directory

**Know your bench.**

- Team roster with role-based color coding (Owner, Exec, PM, Engineer, Viewer)
- Avatar initials, discipline, email, phone, project assignments
- Role-filter chips for instant bench visibility by discipline
- Add/remove members with RBAC enforcement
- Company directory with contact cards
- Skills and certification tracking

---

### Module 13 — Notifications

**Nothing falls through the cracks.**

- Real-time notification stream: info, warning, error, success
- Unread badge count, mark-read on click, mark-all-read
- Unread / All filter tabs
- Time-ago formatting ("3m ago", "2h ago")
- Triggered by: RFI overdue, budget threshold exceeded, submittal rejected, punch item escalated, permit expiry warning

---

### Module 14 — Marketplace

**Extend JARVIS with partner tools.**

- Category-filtered tool catalog: Analytics, Field, Engineering, Documents
- Partner integrations: CostIQ (cost analytics), AerialOps (drone site imagery), LegalAI (contract analysis), StructCalc (structural calculations), WeatherBridge (weather risk), ERPLink (ERP connector)
- Owner-only enable/disable with per-tenant feature gating
- Install/uninstall with audit trail
- Publisher and version metadata for compliance review

---

### Module 15 — MCP Tool Platform

**The AI extension layer.**

- 43 registered Model Context Protocol tools
- Native tool catalog: project search, risk lookup, document retrieval, calculation runner, field observation capture
- Plugin architecture: third-party tools register via MCP server protocol
- Per-tool permission scoping tied to RBAC roles
- Tool call audit log — every AI-invoked action is traceable

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Zustand, PWA (Workbox) |
| Backend | Node.js, Express, TypeScript, PostgreSQL (RLS) |
| AI | Anthropic Claude (claude-haiku-4-5, claude-sonnet-4-6) |
| Auth | JWT (httpOnly cookies), bcrypt, RBAC |
| Integrations | Autodesk APS, QuickBooks, Slack, REST webhooks |
| Security | Helmet CSP, express-rate-limit, HMAC-SHA256, SOC2-ready audit log |
| DevOps | CI gate (typecheck + 1,861 tests + monolith check), GitHub Actions ready |
| Deployment | Docker-ready, ENV-configurable, static SPA + API server |

---

## Competitive Differentiation

| Feature | JARVIS EPC | Procore | Autodesk ACC | AVEVA | InEight |
|---|---|---|---|---|---|
| Full EPC lifecycle (CRM → Closeout) | **✅ Native** | Partial | Partial | Engineering only | Scheduling only |
| AI predictions + NL query | **✅ Native** | ❌ | Limited | ❌ | ❌ |
| Plant engineering import (P&ID tags) | **✅ Native** | ❌ | ❌ | ✅ (own format) | ❌ |
| CPM engine with EVM | **✅ Native** | ❌ | ❌ | ❌ | ✅ (separate tool) |
| Offline-first PWA | **✅ Native** | App required | App required | ❌ | ❌ |
| MCP extensibility | **✅ Native** | ❌ | ❌ | ❌ | ❌ |
| Multi-tenant SaaS | **✅ Native** | ✅ | ✅ | On-premise | ✅ |
| Entry price | **$X/mo** | $375+/user/mo | $500+/user/mo | $100K+/yr | $80K+/yr |

---

## Business Model

**SaaS subscription, seat-based + usage-based AI tier**

| Tier | Price | Includes |
|---|---|---|
| **Starter** | $499/mo | 5 users, 3 active projects, core modules |
| **Professional** | $1,999/mo | 25 users, unlimited projects, full module suite, 1,000 AI queries/mo |
| **Enterprise** | $7,999/mo | Unlimited users, SSO, SLA, dedicated support, custom integrations, unlimited AI |
| **Marketplace** | 30% rev share | Partner tools enabled per tenant |

**Unit economics (Professional tier)**:
- CAC target: $8,000 (sales-assisted) / $1,200 (PLG)
- LTV target: $72,000 (3-yr, 0% churn) / $48,000 (10% annual churn)
- LTV/CAC: **6:1 (sales-assisted) · 40:1 (PLG)**
- Payback period: 4 months

---

## Traction & Roadmap

**Current status**: v4.30.0 production-ready — full test suite (1,861 tests, 0 failures), TypeScript strict, SOC2-ready

**12-month roadmap**:

| Quarter | Milestone |
|---|---|
| Q1 | 5 design partner EPC contractors (paid pilots at $500/mo) |
| Q2 | Mobile app (React Native), document OCR pipeline (Textract), first $100K ARR |
| Q3 | Autodesk APS full viewer embed, ISO 19650 BIM compliance module, $500K ARR |
| Q4 | SOC2 Type II certification, SAP/Oracle ERP connector, Series A at $2M ARR |

---

## The Ask

**Raising: $2.5M Seed Round**

| Use of Funds | Allocation |
|---|---|
| Engineering (3 senior FE/BE engineers, 18 months) | 48% — $1.2M |
| Sales & Marketing (AE + demand gen) | 24% — $600K |
| Cloud infrastructure & security audit | 12% — $300K |
| Operations & G&A | 10% — $250K |
| Reserve | 6% — $150K |

**Milestones this round buys**:
- 50 paying customers
- $2M ARR
- SOC2 Type II certified
- Series A ready

---

## Why Now

1. **AI inflection point** — LLMs finally good enough to extract real signal from EPC project data. First movers will define the category.
2. **EPC labor crisis** — industry losing 40% of experienced engineers to retirement over 5 years. AI-augmented tools are the only path to maintaining output.
3. **Post-COVID infrastructure wave** — $1.2T US Infrastructure Act, EU Green Deal, Middle East gigaprojects. Capital is flowing; execution tools are not keeping pace.
4. **Incumbent complacency** — Procore focused on commercial construction. Autodesk on BIM authoring. No one owns the EPC-specific workflow. The gap is real and wide.

---

## Team

*[Insert founding team bios — engineering and EPC industry experience]*

---

## Contact

**JARVIS EPC** · v4.30.0
Built with: React · TypeScript · PostgreSQL · Anthropic Claude

*This document contains forward-looking statements and proprietary financial projections. Not an offer to sell securities.*

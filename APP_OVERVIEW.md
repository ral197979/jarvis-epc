# Denver Engineering — Application Overview

> **v4.31.0** · AI-powered Engineering, Procurement & Construction Platform  
> Built by Ava Systems LLC · Deployed on Render (Node 20, PostgreSQL 16, Redis)

---

## What it is

Denver Engineering is a full-stack SaaS platform for **engineering, procurement, and construction (EPC) project management**. It combines real-time project operations, financial controls, document management, AI-assisted workflows, and IoT integration into a single application shell. The system is multi-tenant, role-gated, and production-hardened with JWT auth, row-level security on every table, WebSocket streaming, and a grounded RAG AI assistant.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React SPA (Vite + TypeScript)                      │
│  ├── ContentRouter  — lazy-loads 50+ view modules   │
│  ├── NavSidebar     — domain-grouped nav + badges   │
│  ├── Zustand store  — global UI + auth state        │
│  └── WebSocket      — real-time event streaming     │
└───────────────────┬─────────────────────────────────┘
                    │ REST + WS
┌───────────────────▼─────────────────────────────────┐
│  Express API (Node 20, TypeScript)                  │
│  ├── 70+ route modules                              │
│  ├── 67 background services / workers               │
│  ├── 71 SQL migrations (PostgreSQL 16 + pgvector)   │
│  ├── JWT auth + httpOnly cookie refresh tokens      │
│  ├── Redis token revocation store                   │
│  ├── Row-level security on all tenant tables        │
│  ├── Helmet CSP + CORS + rate limiting              │
│  └── WebSocket gateway (JWT-authenticated)          │
└─────────────────────────────────────────────────────┘
```

**Tech stack:** React 18 · Vite · TypeScript · Zustand · Express · PostgreSQL 16 · pgvector · Redis · Pino logging · Helmet · JWT (jsonwebtoken) · bcrypt · Render (hosting)

---

## Navigation Domains

The sidebar groups views into **9 domains**:

| Domain | Views |
|--------|-------|
| **Operations** | Dashboard, Projects, Timesheets, Team, Actions, Notifications |
| **AI** | Ask Jarvis, Predict |
| **CRM** | CRM, Proposals |
| **Engineering** | FEED, Calc, Eng Hub, Fix Library, Process Design |
| **Construction** | Construct, Daily Logs, Drawings, Import Schedule, Subcontracts, Meetings, BIM, IoT Sensors, RFIs, Submittals, Punch List, Inspections, Compliance, Risk Register |
| **Finance** | Change Orders, Cost Control, Cost Entry, EVM, Budget, Portfolio |
| **Documents** | Transmittals, Documents |
| **Procurement** | Directory |
| **System** | Knowledge, MCP, Automation, Integrations, System |

---

## Feature Modules

### 📊 Dashboard
Unified operational overview. KPI tiles for active projects, open actions, budget variance, and safety flags. Clicking any KPI tile navigates to the relevant detail view.

---

### 🤖 Ask Jarvis (AI Assistant)
Grounded retrieval-augmented generation (RAG) chat powered by Anthropic Claude.

- Answers questions using ingested knowledge documents (not hallucinated)
- Maintains persistent chat sessions per user
- Citation hover/modal for every source chunk
- Session history with resolve/link-to-work-order workflow
- Prompt injection guard (rejects jailbreak patterns)
- Learning-loop signal: users can mark sessions as resolved

**API:** `POST /api/v1/ask` · `GET /api/v1/ask/sessions` · `GET /api/v1/ask/chunks/:id`

---

### 🎯 CRM
Customer and lead pipeline management.

- Contact and company records
- Lead stage tracking (prospect → qualified → proposal → closed)
- Activity timeline per contact
- Linked to Proposals module

**API:** `/api/v1/vendors` (shared vendor/contact registry)

---

### 📄 Proposals
Bid pipeline from estimate to award.

- Proposal header (client, value, due date, status)
- Line-item breakdown with unit costs
- Status workflow: draft → submitted → awarded / lost
- Linked to CRM contacts and Projects

**API:** `/api/v1/proposals`

---

### 🔬 FEED (Finance Feed)
Journal and transaction activity stream for financial events across all projects. Provides a chronological audit trail of cost entries, change orders, and budget movements.

---

### 📋 Projects
Core project register.

- Project creation with type, location, contract value, dates
- Status tracking (planning, active, commissioning, closed)
- Links to all other modules (drawings, RFIs, inspections, budget, etc.)
- Project-scoped filtering throughout the platform

**API:** `/api/v1/projects`

---

### 🏗️ Construction (Overview)
Consolidated construction phase dashboard. Aggregates punch items, daily log counts, drawing revision status, and commissioning readiness across the active project.

---

### 🗓️ Daily Logs
Field daily report capture.

- Date, weather, crew count, equipment, work description
- Delay and safety incident flags
- Linked to projects; exportable

**API:** `/api/v1/daily-logs`

---

### 📐 Drawings
Drawing register and revision management.

- Drawing list with discipline, sheet number, revision, and status
- Revision history per drawing
- Markup and comment threads
- Issue-for-construction (IFC) workflow

**API:** `/api/v1/drawings`

---

### 📅 Import Schedule
P6 XER and Microsoft Project XML schedule import.

- Drag-and-drop upload of `.xer` or `.xml` files
- Activity parsing, WBS extraction, dependency mapping
- Baseline creation from imported schedule
- CPM calculation after import

**API:** `/api/v1/schedule-import`

---

### 🏗️ Subcontracts
Bid package and subcontract management.

- Bid package creation with scope, budget, and due dates
- Subcontractor invitation and bid comparison
- Subcontract award and execution tracking
- SOV (Schedule of Values) line items

**API:** `/api/v1/subcontracts`

---

### 📋 Meetings
Meeting minutes and action item capture.

- Meeting agenda management
- Minutes recording with decisions and action items
- Attendee list and distribution
- Auto-link action items to the Action Center

**API:** `/api/v1/meetings`

---

### 🏢 BIM
BIM model management and coordination.

- IFC file upload (100 MB hard cap, MIME-validated)
- Model list with discipline, revision, and status
- Coordination issue (clash) tracking
- IFC parse worker runs in the background after upload

**API:** `/api/v1/bim`

---

### 📡 IoT Sensors
Real-time sensor data dashboard.

- Sensor registry with type, location, and status
- Live readings ingest via the IoT ingest endpoint
- Time-series chart per sensor
- Alert threshold configuration

**API:** `/api/v1/iot`

---

### ❓ RFIs
Request for Information workflow.

- RFI creation with subject, question, ball-in-court, and due date
- Status: open → responded → closed
- Overdue badge and escalation
- Linked to drawings and specifications

**API:** `/api/v1/rfis`

---

### 📨 Submittals
Shop drawing and submittal register.

- Submittal log with spec section, type, and revision
- Review workflow: submitted → under review → approved / rejected
- Re-submittal tracking

**API:** `/api/v1/submittals`

---

### 📌 Punch List
Construction punch list and close-out.

- Item creation with location, trade, description, and priority
- Status: open → in progress → complete → verified
- Photo attachment support
- Export for owner close-out package

**API:** `/api/v1/punch-lists`

---

### 🔍 Inspections
Inspection template and record management.

- Configurable inspection templates (checklist items per discipline)
- Inspection records tied to location and date
- Pass/fail/conditional per item
- Deficiency linking

**API:** `/api/v1/inspections`

---

### 🛡️ Compliance
Regulatory compliance task tracking.

- Compliance task register with regulation reference and due date
- Status workflow with evidence attachment
- Compliance watcher background service auto-flags overdue items

**API:** `/api/v1/compliance-tasks`

---

### ⚠️ Risk Register
Full-stack risk management (v10.17.0).

- Risk creation: category, probability, impact, owner, response plan
- Risk score = probability × impact (1–25 matrix)
- Status: identified → assessed → mitigated → closed
- Monte Carlo integration for schedule/cost risk simulation
- KPI tiles: Total, High Risk, Mitigated, Overdue

**API:** `/api/v1/risk-register`

---

### 🔧 Fix Library
Engineering fix pattern knowledge base.

- Fix patterns extracted from historical deficiency data
- Searchable by system type, failure mode, and resolution
- Used by Ask Jarvis as a retrieval source
- Rated by reuse frequency

**API:** `/api/v1/knowledge-fixes`

---

### 📚 Knowledge
Document ingestion and knowledge corpus management.

- Upload PDFs, Word docs, CSVs, and plain text
- Background chunking, tokenisation, and embedding (OpenAI text-embedding-3-large)
- pgvector cosine similarity search blended with PostgreSQL FTS
- Source management: title, license type, storage path

**API:** `/api/v1/knowledge`

---

### 🔄 Change Orders
Change order management (v10.7.0).

- Change event → pricing → approval → execution workflow
- Cost impact and schedule impact fields
- Status: draft → submitted → approved → rejected → executed
- Linked to budget and EVM modules

**API:** `/api/v1/change-orders`

---

### 📉 Cost Control
Cost control dashboard (v10.10.0).

- Budget vs. actual vs. committed cost by WBS / cost code
- Variance analysis with % complete
- Forecast-at-completion (FAC) trending
- Drill-down to individual cost entries

**API:** `/api/v1/cost-control`

---

### 💵 Cost Entry
Field cost entry (v10.11.0).

- Mobile-friendly cost entry form (labour, materials, equipment)
- Cost code and WBS code selection
- Batch entry for crews
- Feeds directly into Cost Control dashboard

**API:** `/api/v1/cost-entries`

---

### ⏱️ Timesheets
Workforce timesheet management (v10.16.0).

- Weekly timesheet entry per worker
- Regular, overtime, and double-time hour breakdown
- Approval workflow (submitted → approved → payroll)
- Cost code allocation per timesheet line

**API:** `/api/v1/timesheets`

---

### 📊 EVM (Earned Value Management)
Earned Value Management dashboard (v10.3.0).

- BCWS (Planned Value), BCWP (Earned Value), ACWP (Actual Cost)
- SPI, CPI, SV, CV KPI tiles
- EAC and ETC calculations
- Time-phased S-curve chart

**API:** `/api/v1/evm`

---

### 💰 Budget
Project budget management.

- Original budget, approved changes, revised budget
- Cost code / WBS breakdown
- Budget vs. committed vs. actual columns
- Linked to Change Orders and EVM

**API:** `/api/v1/budgets`

---

### 🧪 Process Design
AI-driven process engineering design surface.

- P&ID (Piping & Instrumentation Diagram) schematic builder
- Equipment library (vessels, pumps, heat exchangers, compressors)
- Stream data input (temperature, pressure, flow rate)
- AI-assisted equipment sizing suggestions
- Export to PDF

---

### 🧮 Calcs (Engineering Calculator)
Engineering calculation workspace.

- Pipe sizing, pressure drop, heat transfer, structural load calculations
- Input forms with unit conversion
- Results with formula reference
- Calculation history and save

---

### 🛠️ Eng Hub
Project engineering hub — unified cross-domain summary for the active project.

- Open RFIs, submittals, drawings, and punch items in one view
- Engineering team assignments
- Milestone tracker

---

### 👥 Team
Workforce and team management (v10.13.0).

- Employee / subcontractor roster
- Role, trade, and cost rate records
- Project assignment tracking
- Timesheet linkage

**API:** `/api/v1/team`

---

### 💰 Portfolio
Portfolio-level financial intelligence (Phase 6).

- Cross-project budget rollup
- Portfolio IRR, NPV, and MOIC
- Project performance comparison grid
- Scenario modelling integration

**API:** `/api/v1/portfolio`

---

### 🔮 Predict
AI predictive analytics dashboard (v10.15.0).

- Schedule delay probability forecast
- Cost overrun risk score per project
- Anomaly radar for sensor and cost data
- Forecast drift and accuracy panels

**API:** `/api/v1/predict`

---

### ⚡ Actions (Global Action Center)
Unified action item and work-order system (v4.33.0, Ava Phase 1).

- Cross-module action creation (linked to any domain entity)
- SLA engine: auto-assigns due dates by priority and action type
- Operational risk scoring (impact × urgency × SLA overdue)
- Prioritisation recommendations (score ≥ 48 triggers "prioritise" rec)
- Escalation rules and delegation chain resolution
- Real-time WebSocket notifications when actions update

**API:** `/api/v1/actions`

---

### 🛠️ Field Service
Field operations and offline sync.

- Field technician work order dispatching
- Offline-capable data entry with background sync
- QR-code workflow launcher
- Batch offline replay endpoint

**API:** `/api/v1/field-sync`

---

### 📬 Transmittals
Document transmittal workflow (v10.1.0, Aconex/Procore parity).

- Transmittal creation with subject, purpose, from/to parties
- Attached document items with revision tracking
- Status: draft → sent → responded → closed
- Required response date with overdue detection
- Send and Close actions

**API:** `/api/v1/transmittals`

---

### 🗄️ Documents
General document management.

- File upload with MIME type allowlist validation (PDF, Office, images, IFC, GLTF)
- S3 presigned URL upload flow
- Extracted text and AI summary fields
- Full-text search across document corpus

**API:** `/api/v1/files`

---

### 📚 Directory (Vendor/Subcontractor)
Vendor and subcontractor contact directory.

- Company records with trade, contact, and location
- Prequalification status
- Linked to bid packages and subcontracts

**API:** `/api/v1/vendors`

---

### 🔌 MCP (Model Context Protocol)
MCP tool bridge — exposes internal platform capabilities as MCP-compatible tools for AI agents.

**API:** `/api/v1/mcp`

---

### ⚙️ Automation
Scheduler and background job admin.

- View and manage scheduled jobs
- Trigger manual job runs
- Job history and error logs

**API:** `/api/v1/admin/automation`

---

### 🔗 Integrations
Outbound connector management.

- Integration registry (QuickBooks, Slack, Tractian, BACnet, Procore, Salesforce, etc.)
- Connection test per integration
- Manual sync trigger
- Enable/disable auto-sync
- Last sync timestamp and error display

**API:** `/api/v1/integrations` · `/api/v1/webhooks` · `/api/v1/sync-jobs`

---

### 🔔 Notifications
In-app notification centre (v10.14.0).

- Real-time notification delivery via WebSocket
- Notification types: action assigned, SLA breach, document received, system alert
- Mark as read / mark all read
- Notification preferences per user

**API:** `/api/v1/notifications`

---

### ⚙️ System (Settings)
Tenant and user settings.

- Tenant profile (name, logo, plan)
- User management (invite, roles: owner / admin / member / viewer)
- API key management
- Usage and quota display

**API:** `/api/v1/tenants`

---

## AI & Intelligence Layer

| Capability | Detail |
|------------|--------|
| **Ask Jarvis (RAG)** | Grounded Q&A using pgvector cosine search + PostgreSQL FTS blend, powered by Anthropic Claude |
| **Predict** | Schedule delay and cost overrun probability forecasts |
| **Process Design** | AI equipment sizing suggestions for P&ID schematics |
| **Fix Library extraction** | Background worker extracts fix patterns from deficiency records |
| **Knowledge embedding** | OpenAI text-embedding-3-large (1536-dim), stored in pgvector |
| **Prompt injection guard** | Regex-based detection of 6 jailbreak pattern classes on `/api/v1/ask` |
| **AI Governance** | Agent action log, approval queue, and risk scoring for autonomous decisions |

---

## Security

| Control | Implementation |
|---------|----------------|
| Authentication | JWT access tokens (15 min) + httpOnly refresh tokens (7 days, stored in DB + Redis) |
| Multi-tenancy | PostgreSQL Row-Level Security on all 84 tenant tables |
| CSRF protection | Double-submit cookie pattern; `GET /api/v1/auth/csrf` issues token; Bearer-token clients auto-exempt |
| Content Security Policy | Helmet CSP: `script-src 'self'`, `style-src 'self' unsafe-inline`, `frame-ancestors 'none'` |
| File uploads | MIME type allowlist + 50 MB general cap + 100 MB IFC hard cap |
| WebSocket auth | JWT verified on WS upgrade (`?token=<access_token>`) |
| Rate limiting | 600 req/min global, 200/15 min auth, 30/min AI, 20/min agent endpoints |
| Prompt injection | 6-pattern regex guard before any LLM call |
| Audit log | Every mutating API request auto-logged to `audit_log` with user, IP, and redacted body |
| UUID guards | All `:id` params validated as valid UUID v4 before DB queries |

---

## Background Services (67 total)

| Service | Purpose |
|---------|---------|
| SLA Engine | Auto-escalates actions past due date; updates operational risk scores |
| Notification Worker | Delivers notifications to WebSocket subscribers |
| Knowledge Ingest Worker | Chunks and stores uploaded documents |
| Knowledge Embed Worker | Calls OpenAI embeddings API and stores vectors |
| Fix Extractor | Mines deficiency records for reusable fix patterns |
| KPI Snapshot | Nightly aggregation of project KPIs |
| Compliance Watcher | Flags overdue compliance tasks |
| Webhook Dispatcher | Signs and delivers webhook events to subscriber URLs |
| Integration Sync | Runs scheduled syncs for registered integrations |
| IFC Parse Worker | Parses IFC model files after upload (every 15 s) |
| Federated Aggregation | Differential-privacy data aggregation for ecosystem benchmarking (every 5 min) |
| Audit Retention | Purges audit log entries past retention window |
| Readiness Snapshots | Nightly commissioning readiness score aggregation |
| Analytics Snapshot | Nightly action analytics aggregation |
| Pack Worker | Commissioning test pack generation |
| Scheduler | Generic job runner for all registered handlers |

---

## Deployment

| Component | Spec |
|-----------|------|
| Hosting | Render (standard plan, Node 20) |
| Database | PostgreSQL 16 (standard-4gb, 71 migrations, pgvector extension) |
| Cache / Token store | Redis (allkeys-lru) |
| File storage | S3 (presigned URL upload) |
| AI provider | Anthropic Claude (Ask Jarvis) + OpenAI (embeddings) |
| Build pipeline | `typecheck → lint → test (4538 tests) → build` |
| Health check | `GET /api/v1/health` (DB pool status, uptime, storage backend) |
| Static serving | Express serves `dist/` in production (`SERVE_STATIC=1`) |

---

## API conventions

- **Base path:** `/api/v1/`
- **Auth header:** `Authorization: Bearer <access_token>` OR httpOnly cookie `access_token`
- **Tenant header:** `X-Tenant-ID: <uuid>` (resolved from JWT `tid` claim; header is a dev convenience)
- **CSRF:** `X-CSRF-Token: <token>` required on mutations for cookie-auth sessions; call `GET /api/v1/auth/csrf` once after login
- **Pagination:** `?page=1&limit=25` (most list endpoints)
- **Errors:** `{ error: "error_code", message: "human-readable" }` with appropriate HTTP status
- **Audit:** Every `POST/PUT/PATCH/DELETE` that succeeds is logged automatically

---

*Generated from source — Denver Engineering v4.31.0*

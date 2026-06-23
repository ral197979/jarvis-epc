# Denver Engineering — Features

An AI-powered EPC (Engineering, Procurement & Construction) project-management platform with an embedded engineering-tools surface and a grounded AI assistant. Its strength is the **project lifecycle** — proposal → design coordination → construction → commissioning → financial controls — plus document intelligence and automatic P&ID drawing generation.

> **Read this first — engineering-calculation scope.** The discipline "design tools" in this app (WWTP, PWTP, HVAC/MEP, stormwater, process) are **front-end shells**. Their serious calculations are delegated over MCP (`/api/v1/mcp/execute` → `AVA_MCP_URL`) to an external Ava agent orchestrator, **not** to a calculation engine — and any in-browser math in the tool HTML is placeholder (synthetic/ML-noise), not validated engineering. Treat them as **design-assist / drafting UIs, not certified calculators.** See [Engineering tools — honest status](#engineering-tools--honest-status) before relying on any number. The genuinely solid, self-contained capabilities are the management platform, document AI, P&ID generation, and Ask Jarvis.

---

## Genuinely working features (self-contained in this repo)

### Project & construction management
- **Dashboard** — Portfolio KPI tiles (active projects, budget variance, safety) with drill-down.
- **Projects** — Registry with type, location, contract value, dates, and status workflow.
- **Team & timesheets** — Roster, cost rates, and weekly timesheet approval.
- **Daily logs** — Field reports with weather, crew, equipment, delay/safety flags.
- **Action center** — Cross-module actions with SLA tracking, escalation, real-time notifications.
- **Schedule import** — Drag-and-drop Primavera P6 (XER) and MS Project (XML) with CPM/baseline parsing.
- **RFIs / Submittals** — Request-for-information and shop-drawing logs with review and overdue tracking.
- **Punch list** — Closeout items with location, trade, priority, photos, verification.
- **Inspections** — Template-driven checklists (e.g., ACI 318 concrete, UL 1479 firestop, MEP rough-in).
- **Commissioning** — Full Cx workflow across 21 asset types with prerequisite tracking and retest loops.
- **Meetings** — Agendas, minutes, decisions, and auto-linked action items.

### Financial controls
- **Budgets** — Original / approved-change / revised budgets by cost code and WBS.
- **Change orders** — Pricing → approval → execution with cost and schedule impact.
- **Cost control & cost entry** — Budget vs. committed vs. actual, with field cost entry.
- **Earned Value Management (EVM)** — BCWS/BCWP/ACWP, SPI/CPI, EAC/ETC, S-curves.
- **Risk register** — Probability × impact scoring with Monte Carlo schedule/cost simulation.
- **Portfolio intelligence** — Cross-project rollup, IRR/NPV/MOIC, scenario modeling.

### CRM & business development
- **CRM** — Contacts/companies with lead-stage pipeline and activity timeline.
- **Proposals** — Bid pipeline with line-item costing and award/loss tracking.
- **Vendors & subcontracts** — Directory, bid packages, bid comparison, award, schedule of values.

### Documents & drawings
- **Drawings register & markups** — Sheet register by discipline with revisions, red-line markups, IFC tracking.
- **BIM coordination** — IFC model upload and clash/coordination issue tracking.
- **Transmittals** — Formal document transmittal workflow with response tracking.
- **Document library** — Upload PDFs, Office files, CSVs, images, 3D models; full-text + AI-summarized search.

### P&ID / PFD generation — *real and working*
- **PFD Generator & TRUE P&ID** — ISA-5.1 process diagrams with valve actuators, instrument bubbles, title blocks, and DXF export. This is genuine SVG generation (`public/tools/denver/UNIVERSAL-PID-GENERATOR.js`, `TRUE-PID-GENERATOR.js`) — it draws diagrams, but does **not** perform process calculations.

### AI assistant & automation
- **Ask Jarvis** — Grounded RAG assistant (Anthropic Claude) answering from your ingested documents with citations and persistent sessions.
- **Knowledge hub & fix library** — Ingest documents and reusable engineering fix patterns for retrieval.
- **Predict** — ML forecasting for schedule-delay probability, cost-overrun risk, anomaly detection.
- **Automation & AI governance** — Rule-based action/compliance-task creation; action log, approval queue, risk scoring.

### Platform & integrations
- **IoT sensors** — Registry, live readings, time-series charts, alert thresholds.
- **Field service** — Offline-capable work orders with background sync and QR launchers.
- **Integrations hub** — Third-party connectors with webhook delivery.
- **Exports** — JSON/CSV for reports, schedules, cost data, commissioning records.
- **Real-time updates** — WebSocket notifications for actions, projects, sensor streams.
- **Multi-tenant SaaS** — Row-level security, JWT auth, rate limiting.

---

## Engineering tools — honest status

These appear in the app's "Engineering Tools" / "Process Design" panels (`src/components/CalcView.tsx`, `src/components/ProcessDesignView.tsx`). They render real UIs and can produce diagrams, but **the underlying engineering calculations are not implemented in a backend reachable by this app.** Where a tool computes anything locally, the result is a placeholder (synthetic ML output or a formula with random-noise multipliers) and should not be trusted.

| Discipline / tool | What the UI claims | Actual calculation status |
|---|---|---|
| **WWTP** (ASM1/2d/3, BNR, MBR, sludge) | Treatment design & sizing | ⚠️ **Real math exists, but in a separate repo** (`ava-math-engine` — IWA-validated ASM1/BSM1). **Not wired** to this UI; the in-app tool is a shell. |
| **PWTP** (RO/NF, clarifiers, GAC, UV, chlorine CT) | Potable water design | ❌ **Missing** — no design code anywhere; in-app math is synthetic. |
| **Process: pump** (TDH, Darcy-Weisbach) | Pump sizing | ⚠️ **Real calc exists** in `MEPPro-Precision-Edition`, but **isolated** — not reachable from this app. |
| **Process: separator / flash-VLE / reactor / mass balance / heat exchanger / pressure vessel** | Process equipment design | ❌ **Missing** — routes to MCP, but no backend implements these (Souders-Brown, Rachford-Rice, LMTD/NTU, ASME VIII all absent). |
| **HVAC / MEP** (ASHRAE load, duct/pipe sizing) | Load & sizing calcs | ❌ **Stub** — in-app "load" formula uses a random-noise multiplier; only anomaly-detection code exists elsewhere. |
| **Electrical / NEC** (motor FLA, wire/breaker/conduit) | NEC sizing | ❌ **Text references only** — no 430.250 / 310.16 / 430.52 / conduit-fill code anywhere. |
| **Stormwater** (detention/retention, LID, runoff) | Hydrology & detention | ❌ **Stub** — no Rational Method / curve-number / routing; in-app math is synthetic. |
| **Fire protection** (NFPA) | Suppression references | ❌ **Mention only** — UL 1479 firestop *inspection* checklist + alarm-panel commissioning asset; no NFPA hydraulics. |
| **Oil & Gas** (separator, flash) | O&G process | ❌ **Missing** — same as Process; routes to MCP, no backend. |
| **P&ID / PFD diagrams** | ISA-5.1 drawings | ✅ **Real** — genuine SVG/DXF diagram generation (drawing only, no calc). |

### Why
Denver's `/api/v1/mcp/execute` (`api/routes/mcp.ts`) forwards non-native tool calls via `AVA_MCP_URL` to `ava-mcp-adapter`, which proxies to the **Ava agent orchestrator** (`ava_Agent/ava_agent/main.py`) — a chat/skills/task/git dispatcher, **not** a process-calculation engine. No discipline-specific calc tool is dispatched, so there is no working math behind the design tools as wired today.

### To make these real
- **WWTP:** bridge this UI to the `ava-math-engine` HTTP API (`/wwtp/activated-sludge`, `/wwtp/bsm1/simulate`) — the math is already validated there.
- **Pump:** expose the `MEPPro-Precision-Edition` pump-head calculator as an MCP tool or HTTP endpoint.
- **PWTP, process equipment, HVAC, NEC, stormwater, fire, O&G:** no backend exists; these require building (or integrating) real calculation engines before they can be presented as working tools.
- **Internal accuracy fix:** `src/config/systemPrompt.ts` advertises design tools (incl. a "Fuel" tool) that aren't implemented — this can make Ask Jarvis hallucinate engineering answers and should be corrected.

# Denver Engineering Next

> Mission Control for EPC Projects — the next-generation Denver Engineering UI.

A greenfield frontend that re-imagines the Denver Engineering platform with a
modern enterprise design language (Google Stitch "Industrial Precision System"),
while **reusing the existing Denver business logic** through a typed adapter
layer. This repo owns UI, UX, information architecture, the design system, and
navigation — **not** backend / business-logic replacement.

## Stack

React 19 · TypeScript · Vite 6 · Tailwind CSS 3 · Radix (ShadCN-style) ·
TanStack Query · TanStack Table · Zustand · React Router 7 · React Hook Form ·
Zod · Recharts · Framer Motion · Material Symbols + Lucide.

## Repository layout

The four-folder layout from the brief is wired with path aliases so it builds as
a single Vite app:

```
denver-engineering-next/
├── frontend/          # the application  (@/…)
│   └── src/
│       ├── app/       # shell: Sidebar, Topbar, ContextPanel, CommandPalette, router
│       ├── modules/   # feature screens (dashboard, projects, commissioning, …)
│       ├── components/ # shared cross-module pieces
│       └── lib/       # zustand store, utils
├── design-system/     # tokens + primitive components  (@ds)
│   └── src/
│       ├── tokens.ts        # status / priority / lifecycle maps
│       ├── styles.css       # Tailwind entry + Material Symbols
│       └── components/      # Button, Card, KpiCard, DataTable, Drawer, …
├── backend-adapters/  # typed API adapter layer + mock data  (@adapters)
│   └── src/
│       ├── types.ts         # domain types (mirror /api/v1 shapes)
│       ├── http.ts          # fetch client (auth + CSRF contract)
│       ├── adapters.ts      # one function per endpoint (mock ↔ live seam)
│       ├── hooks.ts         # React Query hooks the UI consumes
│       └── mock/data.ts     # realistic EPC fixtures
└── docs/              # roadmap, adapter strategy, design-system notes
```

## Getting started

```bash
npm install
npm run dev        # http://localhost:5174  (runs on mock data, no backend needed)
npm run typecheck
npm run build
npm run test
```

## Data: mock now, live later

Every screen consumes **only** the React Query hooks in `@adapters`. By default
`VITE_USE_MOCKS` is on, so all screens render from `backend-adapters/src/mock`.
To go live against the existing Denver API:

```bash
VITE_USE_MOCKS=false VITE_API_BASE=https://your-host/api/v1 npm run dev
```

then replace the mock branch in each adapter with the `api<T>(...)` call already
documented inline. Auth/CSRF mirror the existing server contract (httpOnly
session cookie + `X-CSRF-Token`). See [docs/ADAPTER_STRATEGY.md](docs/ADAPTER_STRATEGY.md).

## What's built

**Foundation**
- **Design system** (`@ds`) — tokens (color, type, spacing, radius, status/lifecycle) + ~17 primitive components (Button, Card, KpiCard, DataTable, Drawer, Dialog, Tabs, Gauge, Progress, Badge/StatusChip, Input/Select/Textarea, Avatar, …).
- **App shell** — navy left nav (14 modules), top bar (search, ⌘K command palette, project switcher, quick-create, notifications, AI toggle, profile), right-hand AI context panel. Routes are code-split (lazy + Suspense).

**Modules** (every nav item is a real screen — no placeholders)
- **Dashboard** — portfolio KPIs, project map, health index, AI insights, risk profile, revenue/cost trend.
- **Projects** — card grid + **Project Workspace** (summary, milestones, deliverables, risks, team, activity).
- **CRM** — pipeline KPIs, opportunity funnel, leads table.
- **Contracts** — register + change orders + **Compliance Audit** (clause/LD tracking).
- **Procurement** — PO board + **Vendor Performance** (strategic matrix + scorecard).
- **Inventory & Materials** — warehouse overview, materials registry, requisitions, receiving.
- **Engineering** — drawing/RFI/submittal register.
- **Schedule (Primavera P6 bridge)** — Gantt, Activities, WBS, Critical Path, Baselines, Resource loading, P6 import/sync.
- **Risk** — 5×5 probability×impact matrix, risk register, contingency reserves.
- **Maintenance** — work-order planning, asset register, component lifecycle forecast.
- **Commissioning** (flagship) — Dashboard · Completion Matrix · **PFC** · **FPT execution** (live pass/fail) · **IST orchestration** (sequence + event log) · Equipment · Deficiencies (with create + status-update writes) · **Turnover builder**.
- **Safety** — TRIR/incident overview, incident registry, training compliance, **audits**, **site-access** badges.
- **Digital Twin** — asset hierarchy, completion overlays, **live streaming telemetry**.
- **Closeout** — closeout ledger by category + Final Handover Certificate gate.
- **Documents** — controlled document register.
- **Actions** — kanban board.
- **AI Mitigation Hub** — disruption mitigation plans (execute/dismiss) + resource reallocation.
- **Finance / EVM** — PV/EV/AC, CPI/SPI, S-curve, WBS, forecasts + **Cash Flow** and **Drawdown requests**.
- **Analytics** — portfolio heatmap, cash flow, resource loading + **Scenario Modeler** (stress-test).
- **Reports** — template gallery, generated-report log, and an interactive custom builder.
- **AI Copilot** — streaming responses, tool-use trace, grounded source citations, suggested actions.
- **Administration** — Users & Roles (RBAC), Feature Gates, SSO/SCIM.
- **Field App (mobile)** — separate phone-framed `/m` shell: technician home, site-arrival induction, mobile FPT, QR asset scan, and offline-sync conflict resolution.

**Backend integration** — typed adapter layer with a swappable mock↔live seam.
Live-wired today: Projects (list/detail/create), Commissioning (deficiencies read+create+status update, equipment), Procurement (POs, vendors), Finance (EVM metrics, S-curve), CRM (proposals, pipeline), Engineering (drawings), Documents, Actions, and a client-side portfolio-KPI aggregate. Everything else is mock-backed with documented gaps in [docs/ADAPTER_STRATEGY.md](docs/ADAPTER_STRATEGY.md).

## Verification

`npm run typecheck`, `npm run build`, and `npm run test` (51 tests) all pass.
Every screen has been verified rendering in a real browser.

See [docs/MIGRATION_ROADMAP.md](docs/MIGRATION_ROADMAP.md) for the phased plan and [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for the design language.

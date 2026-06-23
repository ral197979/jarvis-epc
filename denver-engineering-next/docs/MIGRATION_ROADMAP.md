# Migration Roadmap

No big-bang replacement. The new UI ships incrementally, consuming existing
Denver APIs through the adapter layer.

## Phase 1 — Foundation ✅ (this repo)

- Design system: tokens + primitive components
- App shell: left nav, top bar, right context panel, ⌘K command palette
- Executive Dashboard, Project Workspace
- Flagship Commissioning suite (dashboard, completion matrix, equipment, deficiencies)
- Adapter layer + mock data for every wired module
- Build / typecheck / test green

## Phase 2 — Module migration

Wire the adapter `USE_MOCKS=false` branch and harden screens for:
Dashboard · CRM · Projects · Procurement · Engineering. Add mutations
(create/update), pagination, server-side filtering, optimistic updates.

## Phase 3 — Commissioning platform  🟡 in progress

Flagship depth added as new tabs on the Commissioning module (mock-driven UX —
no live endpoints exist yet for these workflows):

- ✅ **PFC Management** — pre-functional check register with checksheet progress + sign-off
- ✅ **FPT Execution** — step-by-step test scripts with live PASS/FAIL recording, progress, submit gate
- ✅ **IST Orchestration** — integrated-systems-test sequences: step timeline (complete/running/pending/blocked) + event log
- ✅ **Turnover Package Builder** — per-system document checklist with live completeness % and sign-off gate

Still to do: training management, commissioning analytics, a dedicated AI
commissioning copilot, mobile field execution flows — and live endpoints for all
of the above (PFC/FPT/IST/turnover have no backend routes yet; when added, wire
them through `live/commissioningLive.ts` exactly like deficiencies/equipment).

## Phase 4 — AI Copilot

Promote the Copilot to a premium, streaming experience grounded on the live RAG
corpus: project/risk/schedule analysis, procurement-delay reasoning,
commissioning readiness, document summaries, action generation, meeting
summaries, engineering reviews, commissioning script generation.

## Phase 5 — Digital Twin, Analytics, Executive Command Center

- Digital Twin: system & equipment hierarchy, completion overlays, asset status
- SCADA/BMS integration: BACnet / Modbus / OPC UA, alarm validation, trend overlays
- Readiness forecasting: AI readiness scoring, turnover/risk/resource forecasting
- Multi-project portfolio: heatmaps, resource loading, cash flow, executive insights

## Cutover approach

1. Run new UI side-by-side on a subroute / subdomain, mock-backed.
2. Flip modules to live one at a time (`USE_MOCKS=false` per adapter is feasible
   by branching individual functions).
3. Validate against the legacy UI per module; migrate users by role.
4. Decommission legacy screens once parity + adoption are confirmed.

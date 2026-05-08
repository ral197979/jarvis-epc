# Denver Engineering — 90-Day Competitor-Gap Remediation Roadmap

**Versions:** v4.31.0 → v4.33.0
**Time horizon:** 2026-04-17 → 2026-07-16 (90 days, three 30-day release slots)
**Status:** DRAFT — Owner approval required before any sprint executes
**Authority model:** Owner-First. Every sprint is advisory until the OWNER checkpoint is explicitly approved.
**Source inputs:** `Denver_Engineering/DENVER_ENGINEERING_vs_Top5_Competitors.xlsx`, `EXTRACTION_ROADMAP.md`, `CHANGELOG.md`, `COMPONENT_MAP.md`, v4.30.0 repo state.

---

## 1. Context Snapshot (v4.30.0)

| Area | State at v4.30.0 | Source |
|---|---|---|
| Backend | PostgreSQL + RLS, JWT, Redis, S3 abstraction, HMAC webhooks | `api/`, CHANGELOG v4.26.0 |
| Frontend | React 18 / TS / Vite / Zustand; CSS tokens + utilities | `src/`, README |
| Monolith | `JarvisCore.jsx` reduced 6,540 → 1,173 lines (−82%) | EXTRACTION_ROADMAP v4.30.0 |
| Tests | 1,800+ unit, E2E smoke via Playwright | README |
| Coverage | 77% stmt / 63% branch / 75% fn / 79% line | README |
| AI layer | 43 MCP tools catalog, typed constants, live browser page | `src/constants/mcpTools.ts`, `MCPToolsPage.tsx` |
| BIM | `BIMViewerView.tsx` placeholder exists | COMPONENT_MAP.md |
| CI | 6 parallel jobs, monolith-size guard | `.github/workflows/ci.yml` |

---

## 2. Competitor-Gap Register (from xlsx Gap Analysis)

| # | Gap | Class | Ranked vs. Top 5 |
|---|---|---|---|
| G1 | Native mobile field apps | LAG | Procore, Autodesk lead |
| G2 | BIM / 3D model coordination | LAG | Autodesk, AVEVA lead |
| G3 | Plant engineering (P&ID, 3D piping) | LAG | AVEVA, Hexagon own it — partner, don't build |
| G4 | Partner / marketplace ecosystem | LAG | Procore, Autodesk lead |
| G5 | JarvisCore monolith residual (~673 lines remaining) | LAG (internal) | Sprints 5–9 in EXTRACTION_ROADMAP |
| P1 | P6-class advanced scheduling | PARITY → LEAD | Primavera, InEight lead |
| P2 | Construction field UX polish | PARITY → LEAD | Procore leads |
| P3 | Security attestations (SOC 2 Type II, ISO 27001) | PARITY → LEAD | All competitors have SOC 2 |
| P4 | Coming-Soon stub reduction | PARITY (internal) | 60+ 🚧 stubs in COMPONENT_MAP |
| P5 | Test coverage 79% → 90%+ | PARITY (internal) | memory.md target; current 79% |

---

## 3. Release Slotting

| Release | Slot dates | Theme | Success criteria |
|---|---|---|---|
| v4.31.0 | 2026-04-17 → 2026-05-16 | **Monolith finish + mobile foundation** | JarvisCore ≤ 500 lines; PWA shell shipped; ≥ 5 Coming-Soon stubs lifted |
| v4.32.0 | 2026-05-17 → 2026-06-15 | **Mobile complete + BIM integration + scheduling depth** | Offline-first field UX; Autodesk APS viewer wired; critical-path analytics v1 |
| v4.33.0 | 2026-06-16 → 2026-07-16 | **Partner surface + attestations + coverage** | Marketplace v0; SOC 2 Type II readiness pack; coverage ≥ 90% lines |

Work is **bounded per sprint** and **owner-approved per checkpoint**. No cross-sprint autonomous execution.

---

## 4. Per-Gap Remediation Plans

Each gap follows the same structure: **Target end-state · Approach · Effort · Risk · Owner checkpoint · Verification.**

### G5 — JarvisCore monolith residual (v4.31.0)

- **Target end-state:** `JarvisCore.jsx` ≤ 500 lines; remaining inline functions extracted per EXTRACTION_ROADMAP.md Sprints 5–9.
- **Approach:**
  1. Sprint 5 — Extract `JARVIS_ACTIONS` constant + `_domainReducer` stub cleanup → `src/modules/biz/constants.ts`.
  2. Sprint 6 — Extract `useJarvis` hook + `JarvisContext` provider → `src/hooks/`, `src/contexts/`.
  3. Sprint 7 — Extract `Bi/Ki/Zi` modal triad → `src/components/ActionModals.tsx`.
  4. Sprint 8 — Extract `_dispatch` / `mutateBiz` orchestration → `src/modules/biz/actions.ts`.
  5. Sprint 9 — Extract `_exportAll` / `_importAll` / `_resetAll` → `src/modules/biz/dataIO.ts`.
- **Effort:** 4 engineering days (0.5 + 1 + 1 + 1 + 0.5).
- **Risk:** Low. Pattern already used for Phases 18a-18d and 19; types and tests established.
- **Owner checkpoint:** Approve EXTRACTION_ROADMAP Sprint 5 kick-off.
- **Verification:** `npm run check:monolith` gate; `npm run typecheck:all`; all 1,800+ tests green; PR per sprint.

### G1 — Native mobile field apps (v4.31.0 foundation → v4.32.0 complete)

- **Target end-state:** Offline-capable field UX parity with Procore on daily reports + punch lists + observations. Two delivery vectors: (a) PWA with service worker + IndexedDB write-through; (b) Capacitor wrapper for iOS/Android store presence.
- **Approach:**
  1. **v4.31.0 sprint A:** Install Vite PWA plugin; implement service worker caching for shell + critical routes; add offline banner + queue indicator.
  2. **v4.31.0 sprint B:** IndexedDB write-through for `ActionItemsView`, `DailyLogsView`, `FieldOperationsView`, `WirView` — outbound mutations queued and replayed on reconnect.
  3. **v4.32.0 sprint A:** Capacitor wrap; camera/photo capture binding to file storage; push notifications via FCM.
  4. **v4.32.0 sprint B:** App store prep — icons, splash, privacy manifest, TestFlight / internal track rollout.
- **Effort:** 10 engineering days across two releases.
- **Risk:** Medium. Offline-first introduces conflict-resolution complexity — mitigate with server-authoritative last-write-wins + audit entries for conflict.
- **Owner checkpoint:** Approve mobile delivery vector (PWA-only vs PWA + Capacitor). Recommend **both**: PWA ships first for internal use, Capacitor for partner distribution.
- **Verification:** Playwright offline mode test; manual device matrix (iOS 17+, Android 13+); field-side UX review with 2 pilot users.

### G2 — BIM / 3D model coordination (v4.32.0)

- **Target end-state:** Viewer integration with Autodesk Platform Services (APS, formerly Forge). Users can attach a model URN to a project and issue RFIs against model elements.
- **Approach:**
  1. Register APS app + obtain credentials; store in `.env.example` as `APS_CLIENT_ID` / `APS_CLIENT_SECRET`.
  2. Backend: `api/routes/bim.ts` — proxy for APS auth token exchange (never expose client secret to browser).
  3. Frontend: replace `BIMViewerView.tsx` stub with APS Viewer embed; element selection surfaces into existing RFI / issue flows.
  4. Defer native model engine; integrate-not-build per competitive posture.
- **Effort:** 5 engineering days.
- **Risk:** Medium — APS API quotas + token lifecycle. Mitigate with backend token cache + rate-limit guard.
- **Owner checkpoint:** Approve APS as the BIM engine; approve commercial terms (APS is per-token billing).
- **Verification:** Load two sample models (IFC + RVT); verify RFI linkage round-trips; E2E test covering viewer init.

### G3 — Plant engineering (integration posture, not build)

- **Target end-state:** Accept P&ID tag lists, equipment schedules, and handover packages from AVEVA / Hexagon Smart P&ID / Bentley OpenPlant via file-based connectors. Denver Engineering does **not** build native plant engineering.
- **Approach:**
  1. Document `PlantDataImport` schema (tag, unit, service, line size, from/to, PID, rev).
  2. Add CSV / Excel import endpoint: `POST /api/v1/import/plant` with dry-run + commit phases.
  3. Add "Engineering handover" section to `EngineeringView.tsx` showing imported counts by source system.
- **Effort:** 3 engineering days.
- **Risk:** Low — scoped file import, no native modelling.
- **Owner checkpoint:** Approve the explicit non-build posture (defer native plant engineering indefinitely).
- **Verification:** Import a sample 500-row P&ID tag list from each source vendor export format.

### G4 — Partner / marketplace ecosystem (v4.33.0)

- **Target end-state:** Marketplace v0 — a catalog surface inside the app where the OWNER can enable/disable third-party MCP skills and integrations from a curated registry.
- **Approach:**
  1. Extend `src/constants/mcpTools.ts` to separate "built-in" from "marketplace" tools; add `source`, `publisher`, `version`, `enabled` fields.
  2. New `api/routes/marketplace.ts` — GET registry, PATCH enable/disable per tenant (RLS-scoped, owner-role only).
  3. New `src/components/MarketplacePage.tsx` — catalog browser with enable/disable, scoped capability preview (matches existing skill-bounded governance philosophy).
  4. Launch design partners: 3 partners with candidate MCP skills (cost analytics, drone site imagery, contract redline).
- **Effort:** 5 engineering days + 15 days of partner outreach (parallel).
- **Risk:** Medium — partner commitment is non-engineering. Mitigate with letter-of-intent template + clear data-handling boundary doc.
- **Owner checkpoint:** Approve marketplace architecture; approve partner shortlist.
- **Verification:** E2E test installing + disabling a sample marketplace skill; owner-audit log entry on every enable/disable.

### P1 — P6-class advanced scheduling (v4.32.0)

- **Target end-state:** Critical-path method (CPM) engine with float/slack, baseline snapshots, and Primavera P6 import/export (`.xer`, `.xml`).
- **Approach:**
  1. Adopt an open CPM engine (candidate: `@project-js/cpm` or build on top of graph library); host server-side in `api/services/scheduling/`.
  2. Schedule model: activities, dependencies, calendars, baselines — tables already partially exist; audit and extend schema in migration `005_scheduling.sql`.
  3. `POST /api/v1/schedule/calculate` returns early/late dates, total/free float, critical path.
  4. `POST /api/v1/schedule/import-xer` + `POST /api/v1/schedule/export-xer` for P6 interop.
  5. Frontend gantt upgrade in `src/components/Dashboard.tsx` or dedicated `SchedulingView.tsx`.
- **Effort:** 8 engineering days.
- **Risk:** Medium-high — P6 XER parsing is nontrivial. Fallback: import XML (simpler); accept XER as stretch.
- **Owner checkpoint:** Approve scheduling scope (CPM + import/export is sufficient for v1; resource-levelling deferred).
- **Verification:** Compare float calculations against a reference P6 baseline on a 200-activity sample.

### P2 — Construction field UX polish (v4.32.0)

- **Target end-state:** `DailyLogsView`, `ActionItemsView`, `FieldOperationsView` match Procore's field-side ergonomics. One-tap entry, photo capture, voice-to-text.
- **Approach:** Shipped alongside G1 mobile work. UX audit drives 5–8 specific micro-improvements (bottom-sheet entry form, large tap targets, sticky submit, photo-first layout).
- **Effort:** 3 engineering days (largely absorbed into G1).
- **Risk:** Low.
- **Owner checkpoint:** Approve UX audit findings.
- **Verification:** Pilot-user feedback from 2 field users; axe-core WCAG 2.1 AA gate remains green.

### P3 — Security attestations (v4.33.0)

- **Target end-state:** SOC 2 Type II readiness pack assembled; engagement with auditor started; ISO 27001 gap assessment complete.
- **Approach:**
  1. Compliance policy binder: Access Control, Change Management, Incident Response, BCDR, Vendor Management, Data Classification.
  2. Control evidence pack: audit_log retention policy, RBAC policies, deploy runbook, key rotation runbook.
  3. Select auditor; scope engagement. Vanta / Drata / Secureframe reduce effort.
  4. ISO 27001 annex A gap assessment (document-only; formal cert deferred beyond 90 days).
- **Effort:** 12 engineering-equivalent days (heavily documentation-weighted).
- **Risk:** Low (documentation-heavy); high budget sensitivity (auditor fees).
- **Owner checkpoint:** Approve auditor budget; approve tool selection (Vanta/Drata/Secureframe).
- **Verification:** Readiness dashboard shows 100% control coverage before audit kickoff.

### P4 — Coming-Soon stub reduction (rolling)

- **Target end-state:** Cut ≥ 20 🚧 stubs from COMPONENT_MAP across 90 days by promoting or deleting.
- **Approach:** Each release, pick 6–8 stubs; for each, decide **promote** (ship functional component) or **delete** (remove from navigation + COMPONENT_MAP).
- **Effort:** 1 engineering day per release slot (absorbed into release planning).
- **Risk:** Low. Already an internal pattern.
- **Owner checkpoint:** Per release, approve promote/delete list.
- **Verification:** COMPONENT_MAP.md Status column count of 🚧 decreases by ≥ 6 per release.

### P5 — Test coverage 79% → 90% lines (v4.33.0)

- **Target end-state:** Line coverage ≥ 90%; branch ≥ 75%; function ≥ 85%. Coverage gate lifted in `vitest.config.ts`.
- **Approach:**
  1. Coverage gap analysis — identify files < 70% line coverage.
  2. Prioritize `api/` services and domain-critical reducers.
  3. Add contract tests for API routes lacking them.
- **Effort:** 6 engineering days across v4.33.0.
- **Risk:** Low. Pattern established in prior 20+ coverage phases.
- **Owner checkpoint:** Approve new thresholds in `vitest.config.ts`.
- **Verification:** CI coverage job green with new thresholds.

---

## 5. Sprint Timeline

```
Week 1–2  (v4.31.0 start)   G5 Sprints 5–6      + G1 sprint A (PWA shell)
Week 3–4  (v4.31.0 end)     G5 Sprints 7–9      + G1 sprint B (IndexedDB)  + P4
Week 5–6  (v4.32.0 start)   G2 (BIM/APS)        + G1 sprint C (Capacitor)  + P2
Week 7–8  (v4.32.0 end)     P1 (CPM scheduling) + G1 sprint D (store prep) + G3 (plant import)
Week 9–10 (v4.33.0 start)   G4 (marketplace)    + P3 (SOC 2 kickoff)       + P4
Week 11–12 (v4.33.0 end)    P3 (readiness pack) + P5 (coverage)            + release + retro
```

---

## 6. Owner Checkpoints (must be approved before work starts)

1. **2026-04-17** — Approve this roadmap.
2. **2026-04-17** — Approve EXTRACTION_ROADMAP Sprint 5 kick-off (G5).
3. **2026-04-17** — Approve mobile delivery vector (PWA + Capacitor) (G1).
4. **2026-05-17** — Approve APS as BIM engine + commercial terms (G2).
5. **2026-05-17** — Approve explicit non-build posture for plant engineering (G3).
6. **2026-05-17** — Approve scheduling scope (CPM + P6 import/export v1) (P1).
7. **2026-06-16** — Approve marketplace architecture + partner shortlist (G4).
8. **2026-06-16** — Approve SOC 2 auditor + compliance tool budget (P3).
9. **Each release** — Approve Coming-Soon promote/delete list (P4).
10. **v4.33.0 close** — Approve new coverage thresholds (P5).

---

## 7. Risk & Blind-Spot Register

| Risk | Owner impact | Mitigation |
|---|---|---|
| Cross-sprint context rot | Reduced auditability | Enforce `INTEGRATION_GUIDE_vX.md` per release (existing pattern). |
| APS token leak | Customer BIM data exposed | Proxy all APS calls server-side; never expose client secret. |
| Offline conflict storms | Bad data in production | Server-authoritative last-write-wins + audit log entry per conflict. |
| P6 XER parser drift | Schedule corruption | Gate XER support behind a feature flag; XML import as stable primary. |
| Partner marketplace escape | Third-party MCP skills act outside expected scope | Every marketplace skill runs under owner-approved bounded capability set; audit log on every invocation. |
| SOC 2 budget shock | Program stall | Owner-approved auditor budget before engagement; defer ISO 27001 formal cert. |

---

## 8. Post-Remediation Scorecard Projection

After 90 days, projected weighted scores (from `Denver_Engineering/DENVER_ENGINEERING_vs_Top5_Competitors.xlsx` methodology):

| Product | Current | Projected v4.33.0 | Δ |
|---|---|---|---|
| Denver Engineering | 4.32 | **4.72** | +0.40 |
| AVEVA Unified Project Execution | 3.64 | 3.64 | — |
| InEight | 3.59 | 3.59 | — |
| Primavera + Aconex | 3.29 | 3.29 | — |
| Procore | 3.24 | 3.24 | — |
| Autodesk Construction Cloud | 3.16 | 3.16 | — |

Projection drivers: mobile (3→5), BIM (2→4), scheduling (2→4), certifications (4→5), marketplace (2→3), monolith→LEAD after completion.

---

## 9. Explicitly Out of Scope

- Native plant engineering / 3D piping (integrate AVEVA/Hexagon, never build).
- HR/payroll, general ledger (remain ERP-connected via integration layer only).
- Full ISO 27001 certification inside 90 days (readiness pack only).
- Replacing Zustand or React frameworks (no framework churn).
- Adding new payment / billing flows (separate project; not competitive-gap-driven).

---

## 10. Approval Block

- [ ] Owner approval — full roadmap as-is
- [ ] Owner approval — with written adjustments (attach)
- [ ] Owner approval — partial scope only: __________
- [ ] Rejected — reason: __________

Signed: _________________________  Date: _______________

*This document is advisory. No code changes have been made. Execution requires the explicit owner approvals listed in §6.*

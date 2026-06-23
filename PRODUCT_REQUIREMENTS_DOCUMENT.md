# Denver Engineering — Product Requirements Document

> **Status:** Build-ready v2 · Grounded in the shipped codebase (Express + Node 20 / PostgreSQL 16 / pgvector / Redis backend, React 18 + Vite + Zustand frontend, deployed on Render).
> **Companion specs:** [System Architecture](SYSTEM_ARCHITECTURE.md) · [Domain Model](DOMAIN_MODEL.md)
> **Source-of-truth honesty docs:** [FEATURES.md](FEATURES.md) · [APP_OVERVIEW.md](APP_OVERVIEW.md)

---

## 0. Honesty legend (used throughout)

| Mark | Meaning |
|------|---------|
| ✅ | **Exists** — shipped, with a cited file / table / route. |
| 🟡 | **Partial** — scaffolded or works for a subset; gaps called out. |
| ❌ | **Missing** — not implemented; planned. |
| ⚠️ | **Present but not trustworthy** — code runs but the output is placeholder/synthetic and must not be relied on. |

This PRD never claims parity with Procore / Autodesk Construction Cloud (ACC) / Oracle Aconex+Unifier where the code does not back it. The engineering-calculation surface is the clearest ⚠️: per [FEATURES.md](FEATURES.md), the WWTP / PWTP / HVAC / NEC / stormwater / process tools are **front-end shells with placeholder math** and are treated as drafting/design-assist UIs, never as validated calculators.

---

## 1. Vision

**Denver Engineering is the AI-native project operating system for capital construction.**

Procore, ACC, and Aconex are **systems of record** — they store documents, track logs, and report status. Denver's thesis is that the record is now a commodity; the value is in the **connective intelligence on top of it**. Denver is being built to:

- **UNDERSTAND** — hold every project artifact (RFI, submittal, drawing, BIM element, spec, system, schedule activity, cost code, risk, inspection, deficiency) in one tenant-isolated graph, retrievable by grounded RAG (`api/services/askBuilder.ts`, pgvector `knowledge_chunks.embedding`).
- **PREDICT** — forecast schedule-delay and cost-overrun probability, run Monte Carlo schedule/cost simulation (`monte_carlo_runs`), and surface anomalies before they become claims.
- **DECIDE** — rank "what should I focus on today?" deterministically across eight live signal sources and recommend the next action (`api/services/copilot/projectCopilotService.ts`), with a governed autonomous-agent layer (`agent_tasks`, `ai_recommendation_queue`) that proposes — and, under policy, executes — remediation with a full rollback trail.

The shipped differentiator today is the **Project Copilot / Focus** engine: a pure, deterministic ranking function (`synthesizeFocus`) over live cross-module rows that turns raw state into an explained, prioritized briefing with deep-links into each source record. That is the seed of the "operating system" — everything else in the roadmap deepens the graph and the autonomy around it.

### Positioning one-liner
> *Procore tells you what happened. Denver tells you what to do about it — and, increasingly, does it.*

---

## 2. Target markets

Denver targets **complex, mission-critical capital programs** where the cost of a missed connection (an RFI that invalidates a submittal that blocks a system turnover) is measured in millions and weeks.

### Primary (high-rigor, high-stakes)
| Segment | Why Denver fits |
|---------|-----------------|
| **Data centers / hyperscale** | Dense MEP, aggressive schedules, commissioning-driven turnover (Lvl 1–5 Cx), repeatable templated builds → the `systems → subsystems → tags → commissioning_items → test_packs` hierarchy + readiness engine is purpose-built for this. |
| **Mission-critical facilities** | Redundancy verification, witnessed test packs, evidence chains. |
| **Water / wastewater treatment (WWTP/PWTP)** | Process-system commissioning; the platform models `system_type` (PWTP, WWTP) end to end (note: process *calculations* are ⚠️ shells). |
| **Hospitals / healthcare** | Heavy inspection/compliance regimes (firestop, MEP), strict turnover and AHJ documentation. |
| **Airports & aviation** | Multi-phase, multi-stakeholder, transmittal-heavy document control. |
| **Government / federal / DoD** | Audit chains, RLS isolation, SAML/SCIM, and a planned air-gapped/FedRAMP deployment tier (`air_gap_licenses` table exists; FedRAMP controls ❌ planned). |
| **Embassies / secure facilities** | Same as government + strict data residency → air-gapped tier. |
| **Energy (generation, transmission, renewables)** | Large EPC contracts, EVM-governed, risk-register + Monte Carlo. |

### Secondary
Commercial / office, universities & higher-ed, mixed-use developments — used as land-and-expand once a primary anchor proves the model.

---

## 3. Personas & Jobs-To-Be-Done (JTBD)

| Persona | Primary JTBD | Where Denver serves it today |
|---------|--------------|------------------------------|
| **Project Executive / Program Director** | "Across my portfolio, where is risk concentrating and what needs my intervention?" | ✅ Portfolio focus roll-up (`buildPortfolioFocus`), `GET /api/v1/copilot/focus`; ✅ Portfolio IRR/NPV/MOIC (`/api/v1/portfolio`). |
| **Project Manager** | "Keep RFIs, submittals, change orders, cost, and schedule from silently drifting." | ✅ Per-project Copilot briefing; ✅ Action Center w/ SLA + escalation (`actions`, `sla_profiles`). |
| **Field Superintendent** | "Capture what happened today, drive punch/inspections to closure, work offline." | ✅ Daily logs, punch lists, inspections; 🟡 mobile/offline mutation queue (`offline_mutations`, `sync_sessions`) — API exists, native app ❌. |
| **Commissioning / Cx Manager** | "Prove every system is tested, witnessed, and ready to turn over." | ✅ Systems→subsystems→tags→Cx items→test packs→results→deficiencies; ✅ readiness engine (`readiness_scores`). |
| **Cost / Controls Engineer** | "Budget vs committed vs actual, EVM indices, forecast at completion." | ✅ Budgets, cost entries, change orders, EVM (BCWS/BCWP/ACWP, CPI/SPI, EAC) (`evm_snapshots`); ⚠️ underlying forecasting math is simple, not statistically validated. |
| **Document Controller** | "Issue and track transmittals; control drawing revisions." | ✅ Transmittals workflow (`transmittals`, `transmittal_events`); ✅ drawings + revisions + markups. |
| **Design / Engineering Lead** | "Coordinate disciplines, run RFIs against drawings/specs, size equipment." | ✅ RFI↔drawing linkage; ✅ BIM coordination issues; ⚠️ engineering calculators are placeholder shells. |
| **Risk Manager** | "Maintain a live register; quantify schedule/cost exposure." | ✅ Risk register (P×I, residual scoring); 🟡 Monte Carlo (`monte_carlo_runs`) — engine present, sampling fidelity not independently validated. |
| **Tenant Admin / IT** | "SSO, provisioning, audit, data residency." | ✅ SAML 2.0 (samlify), SCIM 2.0, audit log w/ hash-chain snapshots, RLS isolation. |
| **AI / Autonomy (the differentiator persona)** | "Watch the project, recommend, and — under guardrails — act." | 🟡 Agent system + governance queue + rollback plans scaffolded (`agent_tasks`, `ai_recommendation_queue`); end-to-end autonomous execution ❌ not production-trusted. |

---

## 4. Scope matrix — the 15-phase vision

The codebase was built in versioned "Ava phases." The table below maps the **product vision's 15 phases** to **what the code actually ships**, with evidence. Phase numbering is the product roadmap; the parenthetical release is the shipped version that delivered it.

| # | Phase (vision) | Status | Code evidence |
|---|----------------|--------|---------------|
| 1 | **Core EPC system of record** (projects, vendors, contracts, POs, RFIs, submittals, WIRs) | ✅ | `api/db/migrations/002_epc_core.sql`; routes `projects`, `procurement` |
| 2 | **PM modules** (daily logs, drawings+revisions+markups, BIM, budgets, change orders) | ✅ | `007_pm_modules.sql`; routes `dailyLogs`, `drawings`, `bim`, `budgets` |
| 3 | **Quality & closeout** (punch lists, inspections w/ templates) | ✅ | `008_tier1_modules.sql`; routes `punchLists`, `inspections` |
| 4 | **Commissioning** (systems/subsystems/tags, Cx items, test packs, results, deficiencies) | ✅ | `026_epc_core.sql`, `006_commissioning_packs.sql`; routes `systems`, `testPacks`, `testResults`, `deficiencies`, `commissioning` |
| 5 | **Documents & knowledge** (file mgmt + versioning, RAG corpus, fix library) | ✅ | `003_files.sql`, `022_knowledge_base.sql`, `021_knowledge_fixes.sql` |
| 6 | **Ask Jarvis — grounded RAG** | ✅ | `api/routes/ask.ts`, `api/services/askBuilder.ts`, pgvector `knowledge_chunks.embedding vector(1536)` |
| 7 | **Action Center + SLA + automation** | ✅ | `029_actions_sla.sql`, `030_action_relations.sql`, `031_sla_profiles.sql`; `api/services/slaEngine.ts` |
| 8 | **Readiness & operations engine** (readiness scoring, ops center, evidence assets) | ✅ | `035_readiness_engine.sql`, `037_evidence_assets.sql`; routes `ops`, `readiness`, `evidence` |
| 9 | **Predict & adaptive intelligence** (delay/overrun forecast, anomaly, calibration) | 🟡 | `039_predictive_sla.sql`, `047_adaptive_intelligence.sql`; route `predict`, `adaptive` — models are heuristic, accuracy not benchmarked |
| 10 | **Project Copilot / Focus — the differentiator** | ✅ | `api/services/copilot/projectCopilotService.ts`, `api/routes/copilot.ts`, `src/components/copilot/CopilotView.tsx` |
| 11 | **Autonomous agents + AI governance** (multi-agent orchestration, approval queue, rollback) | 🟡 | `045_agent_system.sql`, `041_ai_governance.sql`, `040_runbook_engine.sql`; `api/services/agents/agentOrchestrator.ts` — governed but not production-trusted for unattended execution |
| 12 | **Digital twin + scenario simulation** (operational twin graph, temporal snapshots, scenarios) | 🟡 | `046_digital_twin.sql`, `042_simulation_engine.sql`; routes `twin`, `scenarios` — graph + snapshots exist; physics/operational fidelity ❌ |
| 13 | **Financial controls depth** (EVM, Monte Carlo, estimating from BIM, cost DB) | 🟡 | `053_evm.sql`, `051_…montecarlo….sql`, `050_bim_estimating.sql`, `052_cost_db_seed.sql` — works; estimating depends on IFC parse quality; cost DB is a seed |
| 14 | **Enterprise platform** (SSO, SCIM, billing/usage, feature gates, support, exports, integration hub) | 🟡 | `044_enterprise.sql`, `048_enterprise_platform.sql`, `073_saml_sso.sql`, `074_scim_tokens.sql` — SSO/SCIM ✅, billing/Stripe fields present but live billing ❌ |
| 15 | **Ecosystem & federation** (federated/DP benchmarking, playbook marketplace, plugins, edge nodes, air-gap) | 🟡/❌ | `049_ecosystem_platform.sql`; route `ecosystem` — schema + DP-aggregation worker exist; marketplace/plugin runtime, edge, FedRAMP are ❌ scaffolds |

**Engineering-calculation tools (cross-cutting):** ⚠️ across the board. P&ID/PFD diagram generation is the one genuine exception — ✅ real SVG/DXF generation (`public/tools/denver/UNIVERSAL-PID-GENERATOR.js`, `TRUE-PID-GENERATOR.js`), drawing-only, no process math.

---

## 5. Functional requirements (prioritized)

Priorities: **P0** = must hold for enterprise evaluation / launch; **P1** = competitive depth; **P2** = differentiation & expansion. Each lists target state and current gap.

### P0 — Trust, isolation, and the record

- **P0-1 Tenant isolation must be DB-enforced.** Every tenant-scoped table has RLS `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`; request-path traffic runs as the non-owner `jarvis_app` role so RLS is not bypassed (`api/db/pool.ts` `tenantQuery`/`tenantTransaction`, migration `075_rls_app_role_grants.sql`, `072_rls_hardening.sql` adds `FORCE ROW LEVEL SECURITY`).
  - *Gap:* enforcement is **operationally conditional** — RLS is only active when `DATABASE_URL_APP` is configured; otherwise traffic falls back to the owner pool and app-layer `WHERE tenant_id` clauses are the only control. **Acceptance:** `DATABASE_URL_APP` set in every non-dev environment; a CI test proves a cross-tenant `SELECT` returns zero rows under the app role.
- **P0-2 Authn/z.** JWT access (15 min) + httpOnly refresh cookie (7 d) with Redis revocation + rotation; account lockout after 5 failures; role gate (`owner/admin/project_manager/engineer/procurement/field_ops/viewer`) (`api/auth.ts`). **Acceptance:** revoked refresh token cannot mint a new access token; locked account returns 423.
- **P0-3 Audit trail.** Every successful mutation auto-logs to `audit_log` (redacted body, IP, request_id) and emits a webhook event (`api/server.ts` audit middleware); tamper-evident hash-chain snapshots (`audit_integrity_snapshots`, route `audit/verify`). **Acceptance:** chain verification detects an injected/edited row.
- **P0-4 Enterprise SSO & provisioning.** SAML 2.0 per-tenant IdP config + JIT provisioning + attribute/role mapping (`073_saml_sso.sql`, samlify); SCIM 2.0 bearer-token user lifecycle (`074_scim_tokens.sql`). **Acceptance:** Okta/Azure AD round-trip creates/deactivates a user; SCIM token audit logged.
- **P0-5 Security middleware order is correct and complete.** Helmet CSP → CORS → body/cookie parse → correlation/request IDs → rate limits → audit → CSRF (double-submit) → UUID param guards → tenant routes (`api/server.ts`). **Acceptance:** documented in [System Architecture](SYSTEM_ARCHITECTURE.md) §3 and asserted by integration tests.
- **P0-6 Core record CRUD** for projects, RFIs, submittals, change orders, budgets, drawings, daily logs, punch, inspections, transmittals — all ✅ shipped.

### P1 — Competitive depth

- **P1-1 Schedule import & CPM.** P6 XER + MSP XML import (`054_schedule_import.sql`), `schedule_tasks` + FS `schedule_dependencies`, CPM calc. *Gap:* dependencies are **Finish-to-Start only** — SS/FF/SF and calendars/resource leveling ❌.
- **P1-2 EVM.** Baseline → WBS entries → actuals + progress → snapshots with CPI/SPI/EAC/ETC/VAC/TCPI (`053_evm.sql`). **Acceptance:** indices reconcile to a worked PMI example within rounding.
- **P1-3 Commissioning & turnover** end-to-end with witnessed results and evidence links. ✅
- **P1-4 Document control parity** — transmittals with purpose/response workflow, drawing revision history, markup threads. ✅ (Aconex-class workflow; e-signature/seal ❌.)
- **P1-5 BIM coordination & estimating.** IFC upload (100 MB cap) → background parse → `bim_elements` (IFC GUID, psets, quantities) → takeoff → estimate lines against `cost_items`. 🟡 — parser fidelity and the seeded cost DB are the limiters.
- **P1-6 Integrations hub.** Connectors (Procore, SAP, Primavera, Aconex, BIM 360, Slack, Teams, custom webhook), signed outbound webhooks w/ retry, sync jobs (`004_integrations.sql`, `044_enterprise.sql`). 🟡 — connector *framework* exists; live bidirectional Procore/SAP adapters ❌.

### P2 — Differentiation & expansion

- **P2-1 Project Copilot depth.** Today: deterministic ranking over RFI/submittal/risk/inspection/punch/action/budget/schedule. *Next:* learned weights, LLM-written narrative briefings grounded in `knowledge_chunks`, and "explain the chain" impact analysis across the object graph (§7).
- **P2-2 Autonomous agents.** Objective→task-tree orchestration (`agentOrchestrator.ts`), governance check, approval queue with confidence/impact/urgency + rollback plan. *Next:* trustworthy unattended execution for a narrow, reversible action set (e.g., reassign overdue action, draft RFI response).
- **P2-3 Predict / adaptive.** Delay/overrun probability + anomaly + forecast-accuracy calibration (`047_adaptive_intelligence.sql`). *Next:* replace heuristics with benchmarked models; publish accuracy.
- **P2-4 Digital twin & scenarios.** `operational_twins` graph + temporal snapshots + scenario simulation. *Next:* tie twin health to live IoT (`sensors`, `sensor_readings`) and to readiness.
- **P2-5 Ecosystem.** DP-aggregated cross-tenant benchmarking (`federated_*`, opt-in, k-anonymity), playbook marketplace, plugin framework, edge nodes, air-gap licensing. Mostly schema/scaffold today.

---

## 6. Non-functional requirements (NFRs)

| Category | Requirement | Current state |
|----------|-------------|---------------|
| **Availability** | 99.9% API uptime; health endpoint pings DB + Redis (`GET /api/v1/health`, 503 on degraded) | ✅ health check; single-region Render → multi-region/HA ❌ |
| **Latency** | p95 read < 300 ms; slow-query log at >500 ms (`pool.ts`) | 🟡 instrumented, not load-tested at scale |
| **Throughput / limits** | Global 600 req/min; auth 200/15 min; AI 30/min; agent 20/min (`server.ts`) | ✅ |
| **Scalability** | Horizontal API behind LB; pooled PG (min 2 / max 20 per instance) | 🟡 stateless API is horizontal-ready; worker singletons need leases (`worker_leases`) |
| **Security** | RLS per tenant; Helmet CSP (`script-src 'self'`); CSRF double-submit; SSRF allowlist on `http_fetch`/MCP; UUID param guards; bcrypt(12); secrets in env | ✅ (RLS conditional — see P0-1) |
| **Data residency** | Per-tenant region pin; air-gapped option | ❌ planned (`air_gap_licenses` schema only) |
| **Observability** | Pino structured logs + correlation IDs; Prometheus `/metrics`; Sentry error tracking | ✅ |
| **Privacy / compliance** | GDPR erasure (`DELETE /api/v1/auth/me` → `data_deletion_requests`); audit retention purge; DP for federation | ✅ erasure + retention; SOC 2 / FedRAMP ❌ |
| **Backup / DR** | PITR, tested restore, RPO ≤ 1 h / RTO ≤ 4 h | ❌ relies on Render-managed PG defaults |
| **Accessibility** | WCAG 2.1 AA on core flows | 🟡 keyboard + ARIA on Copilot cards; full audit ❌ |
| **Internationalization** | Multi-currency (`currency CHAR(3)`) | 🟡 currency fields exist; UI i18n ❌ |

---

## 7. The object graph (why Denver ≠ a CRUD app)

Denver's differentiation depends on entities being **connected**, not siloed. The connective tissue already in the schema (detailed in [Domain Model](DOMAIN_MODEL.md) §“Object graph”):

```
RFI ──answers──▶ Drawing ──revision──▶ DrawingRevision
 │                  │
 └─raises──▶ Action ◀─source_module/source_id── Submittal, PunchItem, Inspection, BIM Issue
                    │
   action_relations (blocks / caused_by / spawned_from / escalated_from)
                    │
System ─▶ Subsystem ─▶ Tag(equipment) ─▶ Commissioning Item ─▶ Test Pack ─▶ Test Result ─▶ Deficiency
   │                                                                                          │
   └─ readiness_scores (rolls up open actions, blockers, SLA health, inspections)            │
BIM Element ◀─bim_element_links / geo soft-links── PunchItem, Deficiency, Action, Evidence ──┘
Schedule Task ──evm_wbs_entries──▶ EVM ◀── Cost Entries / Change Orders / Budget Items
Transmittal ─▶ transmittal_items ─▶ Document / Evidence
kg_entities ──kg_relationships──▶ kg_entities   (typed knowledge graph, cross-source)
operational_twins ──twin edges──▶ operational_twins   (digital-twin mirror of the above)
```

The **P0 product requirement for the graph**: a focus item or impact query must be able to traverse RFI → drawing → affected system → test pack → schedule activity → cost code and report "this open RFI puts test pack TP-014 and a 6-day critical-path activity at risk." Today the Copilot ranks each source independently; **cross-entity impact traversal is the headline P2 build.**

---

## 8. Success metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Time-to-focus** | Seconds from login to a ranked, explained action list | < 3 s (portfolio roll-up, ≤25 active projects) |
| **Focus precision** | % of top-5 focus items a PM marks "yes, this mattered" | ≥ 80% |
| **Action cycle time** | Median open→closed for SLA-tracked actions vs. pre-Denver baseline | −30% |
| **RFI/submittal overdue rate** | % past due | −50% vs. baseline |
| **Commissioning turnover predictability** | Variance between predicted-ready and actual turnover date | ±5 days |
| **Grounded-answer rate** | % of Ask Jarvis answers with ≥1 cited chunk (no ungrounded answers) | 100% (hard requirement) |
| **Adoption** | Weekly active PMs / licensed seats | ≥ 70% |
| **Agent trust** | % of approved AI recommendations not rolled back within 7 days | ≥ 95% before any unattended execution |

---

## 9. Out of scope (explicit)

- **Validated engineering calculations.** WWTP/PWTP/HVAC/NEC/stormwater/process sizing are ⚠️ shells. We do **not** market them as certified; making them real requires bridging to external validated engines (e.g., `ava-math-engine`) — a separate program.
- **Accounting / GL system of record.** Denver does cost *controls*, not double-entry accounting; integrates to SAP/QuickBooks rather than replacing them.
- **Payroll execution.** Timesheets feed cost; payroll runs elsewhere.
- **Native mobile app** (P1 backlog; offline API exists, client ❌).
- **Live e-signature / digital seal** on transmittals & drawings.
- **FedRAMP authorization / SOC 2 attestation** (control framework + air-gap tier are roadmap).
- **General-purpose BIM authoring/viewing** (we ingest IFC and coordinate; we are not Revit/Navisworks).

---

## 10. Ten-year roadmap

| Horizon | Theme | Outcomes |
|---------|-------|----------|
| **Yr 1 — Trust the record** | Harden P0. RLS enforced everywhere (`DATABASE_URL_APP` mandatory), SOC 2 Type I, live Procore/SAP connectors, native mobile field app on the offline API. | Enterprise-passable system of record + the Copilot wedge. |
| **Yr 2–3 — Connect the graph** | Ship cross-entity impact traversal (§7) and LLM-narrated, citation-grounded briefings. Twin tied to live IoT + readiness. | "Explain the chain" becomes the demo that wins data-center evaluations. |
| **Yr 3–5 — Predict credibly** | Benchmarked delay/overrun models with published accuracy; Monte Carlo validated against historical outturns; calibration loop (`forecast_accuracy`) closes. | Predict graduates from 🟡 to ✅. |
| **Yr 5–7 — Govern autonomy** | Reversible agent actions executed unattended within policy; full rollback ledger; agent trust ≥95%. FedRAMP Moderate + air-gapped tier for gov/embassy. | Denver *decides and acts*, defensibly. |
| **Yr 7–10 — Ecosystem & federation** | Opt-in DP benchmarking at scale, playbook marketplace + plugin runtime, edge deployment, partner ecosystem. | Network effects: every project makes every other project smarter without sharing raw data. |

---

*This PRD is grounded in the repository as of the `audit/enterprise-remediation` branch. Every ✅ cites a file/route/migration; every ⚠️/🟡/❌ marks where the demo must not outrun the code.*

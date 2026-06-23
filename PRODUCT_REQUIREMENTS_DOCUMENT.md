# Product Requirements Document — Denver Engineering

> **The AI-native project operating system for capital construction.**
> Status: v1 (codebase-grounded). Authored against the live repository, not aspiration —
> every "Today" claim is traceable to code in `api/`, `src/`, and `api/db/migrations/`.

---

## 1. Vision & Positioning

Procore **stores** project information. Denver Engineering **understands** it.

| | Legacy (Procore / ACC / Aconex / Unifier) | Denver Engineering |
|---|---|---|
| Core | System of Record + Workflow + Doc Repo | + AI Project Intelligence + Predictive Decision Engine + Autonomous Coordination |
| User time spent | clicking, searching, chasing, reporting | deciding, solving, executing |
| Output | status reports | predicted outcomes & recommended actions |

**Do not position as "Procore with AI." Position as "the AI-native project operating system."**

Every object (RFI, submittal, risk, cost line, inspection, schedule task) must be **AI-understandable, AI-searchable, AI-connected, and AI-actionable**. The Project Copilot (Phase 11) and Autonomous Coordination (Phase 12) are the moat; everything else is table stakes that must reach parity to be credible in enterprise evaluations.

## 2. Target Markets

- **Primary:** Data centers, mission-critical & industrial facilities, water/wastewater treatment plants, hospitals, airports, government facilities, embassies, energy infrastructure.
- **Secondary:** Commercial buildings, universities, mixed-use developments.

These are high-complexity, high-assurance, multi-stakeholder capital programs where **schedule/cost certainty and auditability** outweigh low price. The product must support **billion-dollar programs** and survive enterprise security review (SOC2 / ISO 27001 / FedRAMP path).

## 3. Personas & Top Jobs-to-be-Done

| Persona | Primary needs | Killer capability |
|---|---|---|
| Executive | project health, risk, cash flow, schedule confidence | Executive Copilot board/owner reports |
| Project Executive | portfolio visibility, forecasting, recovery plans | Portfolio Copilot + Monte Carlo |
| Project Manager | RFIs, submittals, schedule, cost, coordination | Coordination Copilot + impact analysis |
| Construction Manager | field execution, issue resolution, progress | Field assistant + daily reports |
| Superintendent | daily planning, manpower, productivity | Mobile field capture + AI daily report |
| QA/QC | inspections, deficiencies, quality records | Quality intelligence (recurring-issue detection) |
| Contractor/Sub | drawings, submittals, RFIs, tasks | Self-serve portal + notifications |
| Owner | visibility, confidence, accountability | Owner Copilot + immutable decision log |

## 4. Scope — Current State vs. Required (grounded in repo)

Legend: ✅ exists & working · 🟡 partial/shallow · ❌ missing · ⚠️ present but not trustworthy

| Phase / Module | State | Evidence in repo |
|---|---|---|
| **1 Foundation** (projects, companies, users, RBAC, SSO, SCIM, audit) | 🟡→✅ | `projects`, `users`, `tenants` (mig 002), `scim` routes + `074_scim_tokens`, `073_saml_sso`, audit log API |
| **2 Document Control** (revisions, transmittals, drawings, markups) | 🟡 | `drawings`, `transmittals` routes/migrations; **AI drawing intelligence ❌**, controlled copies/distribution ❌ |
| **3 RFI Platform** | 🟡 | `rfis` (mig 002) CRUD + overdue; **AI RFI Copilot ❌, impact analysis ❌** |
| **4 Submittals** | 🟡 | `submittals` CRUD + review; **AI review assistant ❌**, package routing 🟡 |
| **5 Schedule Intelligence** | 🟡 | `schedule_tasks` + CPM (`014`), `monteCarlo` route; **recovery planner ❌, critical-path explainability ❌** |
| **6 Cost & Commercial** | 🟡 | budgets, change orders, cost entries, EVM (`053/058/061`); **invoices/payments/claims ❌**, AI cost intelligence ❌ |
| **7 Procurement** | 🟡 | subcontracts, vendors, POs; **procurement risk engine ❌** |
| **8 Field Execution** | 🟡 | daily logs, field-sync (offline batch); **native PWA maturity ❌, media/voice/QR capture 🟡** |
| **9 Quality** | 🟡 | inspections, punch, deficiencies; **NCR/CAPA/RCA 🟡, quality intelligence ❌** |
| **10 Safety** | ❌ | no observations/incidents/permits/JSA modules found |
| **11 AI Project Intelligence** | 🟡 (new) | **Project Copilot Focus shipped** (`api/services/copilot`, `src/components/copilot`); Executive/Coordination/Portfolio copilots ❌ |
| **12 Autonomous Coordination** | 🟡 | `agents/*`, runbooks, AI governance queue exist as scaffolding; closed-loop execute-with-approval ❌ |
| **13 Integration Marketplace** | ❌ | `integrations`/`integrationHub` + connectors (quickbooks/slack/teams) only; **P6/MSP/Procore/ACC/Aconex/Unifier/SAP/Bluebeam/PowerBI ❌** |
| **14 Enterprise Platform** | 🟡 | multi-tenant RLS, SAML, SCIM, audit, rate-limit; **air-gap/FedRAMP/immutable-log attestation ❌** |
| **Engineering calc tools** | ⚠️ | `FEATURES.md` documents these as **shells with placeholder/synthetic math** — must not be sold as calculators |

## 5. Functional Requirements (priority-ordered)

**P0 — credibility to compete (close parity gaps):**
1. Cost & Commercial depth: prime/owner contracts, commitments, **invoices & pay applications**, change-order lifecycle, contingency tracking.
2. RFI/Submittal **impact analysis** + AI review assistant (link to drawings/specs).
3. Field PWA: offline-first, media + voice + QR/GPS capture, AI-generated daily reports.
4. Document control: superseded sets, distribution lists, controlled copies, version compare/overlay.

**P1 — the differentiator (extend the moat):**
5. Executive / Coordination / Portfolio Copilots (build on shipped Focus engine).
6. Schedule: Monte Carlo completion/delay probability + AI recovery planner + critical-path "why".
7. Predictive engines: procurement risk, safety leading indicators, quality recurring-issue detection.

**P2 — autonomy & ecosystem:**
8. Autonomous coordination: monitor → detect → recommend → execute-with-approval, fully audited.
9. Integration marketplace: P6, MSP, Procore, ACC, Aconex, Unifier, SAP, Bluebeam, Power BI.

## 6. Non-Functional Requirements

- **Tenancy & security:** row-level security on every tenant table (today: RLS migrations `056/070/072/075`), JWT + httpOnly refresh, Redis revocation, Helmet CSP, CORS, rate limiting, full audit trail; roadmap: immutable logs, air-gapped deployment, FedRAMP path, SOC2 + ISO 27001.
- **Scale:** billion-dollar programs → 100k+ objects/project, sub-second list/search, async workers for heavy jobs (`api/worker.ts`, notification/IFC/pack workers).
- **AI grounding:** retrieval over pgvector (`071_pgvector`), citations required, prompt-injection guards, cost governance, deterministic/explainable scoring where feasible (the Copilot Focus engine is a pure deterministic ranker by design).
- **Auditability:** every AI recommendation and autonomous action logged with inputs, rationale, actor, and approval state.

## 7. Success Metrics

- Time-to-decision ↓ (Copilot focus adoption, % actions taken from recommendations).
- Forecast accuracy (predicted vs. actual completion/cost) tracked by `forecastAccuracyTracker`.
- Reduction in overdue RFIs/submittals and schedule slip on Copilot-using projects.
- Enterprise: pass SOC2 Type II, win competitive evals vs. Procore/ACC/Unifier/Aconex.

## 8. Out of Scope (explicit)

Not a commissioning platform, CMMS, or facilities/O&M platform. Engineering discipline **calculators** are not a product claim until backed by validated engines (see `FEATURES.md`).

## 9. Related Deliverables

[SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) · [DOMAIN_MODEL.md](DOMAIN_MODEL.md) · [AI_PROJECT_INTELLIGENCE_SPEC.md](AI_PROJECT_INTELLIGENCE_SPEC.md) · [COST_CONTROL_SPEC.md](COST_CONTROL_SPEC.md) · [PROCUREMENT_SPEC.md](PROCUREMENT_SPEC.md) · [DOCUMENT_CONTROL_SPEC.md](DOCUMENT_CONTROL_SPEC.md) · [MOBILE_FIELD_EXECUTION_SPEC.md](MOBILE_FIELD_EXECUTION_SPEC.md) · [INTEGRATION_MARKETPLACE_SPEC.md](INTEGRATION_MARKETPLACE_SPEC.md) · [ENTERPRISE_SECURITY_SPEC.md](ENTERPRISE_SECURITY_SPEC.md) · [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md) · [USER_WORKFLOWS.md](USER_WORKFLOWS.md) · [GO_TO_MARKET_POSITIONING.md](GO_TO_MARKET_POSITIONING.md)

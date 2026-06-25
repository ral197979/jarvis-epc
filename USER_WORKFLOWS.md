# User Workflows — Denver Engineering

> End-to-end workflows per persona for **the AI-native project operating system**. Each step is marked with the screen/route that supports it.
>
> **Legend:** ✅ supported today · 🟡 partial · ❌ planned
> **The recurring theme:** the **Focus** screen (`focus` → `copilot/CopilotView.tsx`) is the daily entry point for every persona. It replaces "click around and chase" with "see what matters, why, and do it" — every Focus card deep-links straight into the live record with the project pre-selected.
> **Sibling docs:** [AI_PROJECT_INTELLIGENCE_SPEC.md](./AI_PROJECT_INTELLIGENCE_SPEC.md) · [SCREEN_INVENTORY.md](./SCREEN_INVENTORY.md)
>
> **Navigation update (Workflow Redesign):** these persona journeys now run inside a lifecycle-grouped sidebar with **My Work**, the **Setup Wizard**, **Lifecycle & gates**, and **Turnover** added, plus a breadcrumb + guided-flow stepper on every screen. The navigation-level role journeys and the authoritative IA are in [WORKFLOW_REDESIGN.md §5](./WORKFLOW_REDESIGN.md#5-role-based-user-journeys) and [NAVIGATION.md](./NAVIGATION.md).

---

## The shared entry point — Focus (all personas)

1. ✅ Open **Focus** (`focus`) → ranked cross-project briefing from `GET /api/v1/copilot/focus`. Each card: severity, source, project, score, **why**, **recommended action**, impact tags, overdue badge.
2. ✅ Filter by severity (critical/high/medium/low) chips.
3. ✅ Click a card → deep-link (`openRecord` → `useDeepLink`) into the source record on the right tab, project pre-selected.
4. ✅ Act in the destination view (respond, route, assign, verify).

Everything below assumes Focus as step 0.

---

## 1. Executive

| Step | Support | Screen / route |
|---|---|---|
| Portfolio health at a glance (red/amber/green, score) | ✅ | `predict` → `GET /predict/portfolio` |
| Cross-project rollup (IRR/NPV/MOIC) | ✅ | `portfolio` → `FinanceView` |
| Top critical/high items across all projects | ✅ | `focus` portfolio roll-up |
| Ops/executive overview (open actions, incidents, AI recs) | 🟡 | `GET /api/v1/executive/overview` (route exists, **no screen**) |
| **Executive Copilot** board/owner/weekly narrative (LLM over verified EVM+risk+schedule, cited) | ❌ | planned — [AI spec §3.1](./AI_PROJECT_INTELLIGENCE_SPEC.md#31-executive-copilot--route-exists-) |
| Immutable decision log for accountability | ✅ | `audit` → `AuditLogView`; `AgentDecisionTrace` ledger |

## 2. Project Executive (PE)

| Step | Support | Screen / route |
|---|---|---|
| Compare projects, spot systemic issues | 🟡 | `portfolio` (`FinanceView`); benchmarking service exists |
| Portfolio focus feed, drill into any project | ✅ | `focus` → deep-link |
| Per-project EVM / forecast | ✅ | `evm`, `predict` |
| **Portfolio Copilot** comparison + resource-conflict flags | ❌ | planned — [AI spec §3.3](./AI_PROJECT_INTELLIGENCE_SPEC.md#33-portfolio-copilot-) |

## 3. Project Manager (PM) — daily coordination

| Step | Support | Screen / route |
|---|---|---|
| Start the day on **Focus** (overdue RFIs, stalled submittals, hot risks, slip, overrun) | ✅ | `focus` |
| Deep-link into the RFI/submittal/risk/inspection/punch | ✅ | `rfis` / `submittals` / `riskregister` / `inspections` / `punch` |
| Respond to RFI, route submittal, assign action | ✅ | `rfis`, `submittals`, `actions` |
| Review change orders, cost variance | ✅ | `changeorders`, `costcontrol` |
| Run/track meetings → auto-linked actions | ✅ | `meetings` |
| **Coordination Copilot**: "what approvals are missing / what blocks the critical path?" | ❌ | planned — [AI spec §3.2](./AI_PROJECT_INTELLIGENCE_SPEC.md#32-coordination-copilot-) |
| **RFI impact analysis** (schedule/cost/procurement/systems) before answering | ❌ | planned — [AI spec §4](./AI_PROJECT_INTELLIGENCE_SPEC.md#4-roadmap--embedded-assistants-per-phase) |

## 4. Construction Manager

| Step | Support | Screen / route |
|---|---|---|
| Field status: daily logs, production, delays | ✅ | `dailylogs` |
| Schedule import + CPM baseline | ✅ | `scheduleimport` |
| Subcontract bid packages, award, SOV | ✅ | `subcontracts` |
| Monte Carlo P50/P80 completion + recovery options | 🟡 | `monteCarloService` real; **no UI/recovery planner** — [AI spec §4](./AI_PROJECT_INTELLIGENCE_SPEC.md#4-roadmap--embedded-assistants-per-phase) |
| Critical-path "why / what-if" explainability | ❌ | planned |

## 5. Superintendent — field execution (mobile)

| Step | Support | Screen / route |
|---|---|---|
| Offline daily log (crew, weather, equipment, production, photos/signatures) | ✅ | `dailylogs` |
| Capture inspections / punch with media + QR/GPS, queue offline → sync | 🟡 | `inspections`, `punch`, `field` (`FieldOperationsView`) |
| AI daily report drafted from the day's captures | 🟡 | partial |
| Field-scoped Focus: "what's behind / blocking Area B / inspections due today?" | 🟡→❌ | `focus` engine can scope per project; area-scoping planned |
| Full mobile field PWA (arrival/scan/field-home) | 🟡→❌ | screens live in `denver-engineering-next` |

## 6. QA/QC — quality

| Step | Support | Screen / route |
|---|---|---|
| Run template inspection (ACI 318, UL 1479, MEP rough-in), record pass/fail/na, sign | ✅ | `inspections` |
| Failed item → deficiency / punch item, assigned + tracked | ✅ | `punch`; failed inspections auto-surface in `focus` (score 50+8) |
| Drive punch to verification (deep-linked from Focus, carries `parentId`) | ✅ | `focus` → `punch` |
| NCR → CAPA → root-cause; recurring-issue & contractor-performance intelligence | ❌ | planned — quality predictive [AI spec §4](./AI_PROJECT_INTELLIGENCE_SPEC.md#4-roadmap--embedded-assistants-per-phase) |

## 7. Contractor / Subcontractor — self-serve

| Step | Support | Screen / route |
|---|---|---|
| View assigned drawings, submittals, RFIs, actions | ✅ | `drawings`, `submittals`, `rfis`, `actions` |
| Real-time notifications | ✅ | `notifications` |
| Submit/respond with overdue tracking | 🟡 | `submittals`, `rfis` |
| **Submittal review assistant** (pre-screen vs. spec) | ❌ | planned |

## 8. Owner — visibility & accountability

| Step | Support | Screen / route |
|---|---|---|
| Read-only project health, documents, transmittals | 🟡 | `predict`, `docs`, `transmittals` |
| Owner Copilot summary report | ❌ | planned (Executive Copilot variant) |
| Immutable decision log for accountability | ✅ | `audit`; `AgentDecisionTrace` |

## 9. Cost Manager — controls

| Step | Support | Screen / route |
|---|---|---|
| Maintain budget by cost code/WBS; record change orders; enter actuals | ✅ | `budget`, `changeorders`, `costentry` |
| Review EVM (SPI/CPI, EAC); Focus flags budget overrun | ✅ | `evm`; `focus` budget item |
| AI explains budget drift with cited drivers | 🟡→❌ | cost intelligence [AI spec §4](./AI_PROJECT_INTELLIGENCE_SPEC.md#4-roadmap--embedded-assistants-per-phase) |
| Generate pay application from SOV + % complete; retention/lien waivers | ❌ | planned billing screen — [SCREEN_INVENTORY](./SCREEN_INVENTORY.md) |

---

## 10. Phase 12 — Autonomous Coordination loop (planned ❌, foundation ✅)

The cross-persona end-state. Every step is persisted to the immutable decision log; **nothing writes without human approval.**

```
MONITOR   the Focus signal sources (RFIs, submittals, risks, inspections, punch, actions, cost, schedule) — continuous
   ↓
DETECT    a coordination break via deterministic rules (e.g. overdue RFI on the critical path, submittal blocking long-lead procurement)
   ↓
RECOMMEND a QueuedRecommendation: action + owner + due date + reason + dataSignals + projected impact + rollbackPlan
   ↓        (aiGovernance.QueuedRecommendation — approval_required defaults TRUE; sub-threshold confidence auto-rejects)
APPROVE   a human reviews in the approval queue; preview shows projected impact with NO mutation
   ↓
EXECUTE   only on approval — spawn the action / nudge the reviewer / propose a re-baseline; immutable AgentDecisionTrace logged; reversible via rollbackPlan
```

**What's real today:** the monitor signals (`synthesizeFocus`) ✅, the recommendation shape + approval queue (`aiGovernance`) ✅, the governance-before-tasks gate (`agentOrchestrator`) ✅, and the immutable decision ledger (`agentExecutionLedger`) ✅.
**What's planned:** the continuous monitor loop, the detection-rule catalogue, and wiring approved recommendations to real construction mutations — see [AI spec §5](./AI_PROJECT_INTELLIGENCE_SPEC.md#5-phase-12--autonomous-coordination--foundation-).

# AI Project Intelligence Spec — Denver Engineering

> The differentiator (Phase 11) and its path to Autonomous Coordination (Phase 12).
> **Shipped today:** the Project Copilot "Focus" engine. Everything else here is the roadmap
> that builds on it. Grounded in `api/services/copilot/`, `src/components/copilot/`, `api/services/agents/`.

---

## 1. Principle

The platform must turn **information into decisions**. Four guarantees for every object:
**AI-understandable** (typed, labeled), **AI-searchable** (indexed + embedded), **AI-connected** (object graph), **AI-actionable** (an `action` can be spawned and tracked).

Design rule learned from the shipped Copilot: **keep ranking/decision logic deterministic and explainable** where possible; use the LLM for language and open-ended reasoning, not for the numbers. This makes the system testable, auditable, and free of hallucinated priorities.

## 2. Shipped — Project Copilot "Focus" (v1)

**Question answered:** *"What should I focus on today?"* (Phase 11 Project Copilot + Phase 8 field assistant).

- **Engine:** `synthesizeFocus(inputs, now)` — a **pure deterministic ranker** over live rows from 8 sources: overdue/unassigned RFIs, stalled submittals, high-score risks, failed/overdue inspections, hot punch items, cross-module actions, budget overrun, schedule slip.
- **Output per item:** `source`, `severity` (critical/high/medium/low), `score 0–100`, **`why`** (plain-English reason), **`recommendedAction`**, `impacts[]`, `dueDate`, `daysOverdue`, `parentId` (e.g. punch→list), and a deep-link target.
- **Scopes:** `GET /api/v1/copilot/projects/:id/focus` (one project) and `GET /api/v1/copilot/focus` (portfolio roll-up).
- **UI:** `Focus` view in the React shell with severity filters; each card **deep-links into its source record** (RFI/submittal/risk/inspection/punch open in place; cost/schedule land on the right module with the project pre-selected).
- **Tested:** deterministic ranking, explanations, severity tiers, route smoke, deep-link store contract.

This is the foundation. The remaining copilots are specializations of the same synthesize→rank→explain→recommend→(act) pipeline over the object graph.

## 3. Roadmap copilots (Phase 11)

| Copilot | Question | Inputs (object graph) | Output |
|---|---|---|---|
| **Project** (✅ Focus shipped) | what's at risk / focus today / why slipping | RFIs, submittals, risks, inspections, punch, actions, cost, schedule | ranked focus list (done) → add "why slipping" causal trace |
| **Executive** | board / owner / weekly summary | portfolio health, EVM, risk, schedule confidence | generated narrative report (LLM over deterministic metrics + citations) |
| **Coordination** | conflicts, missing approvals, schedule clashes, procurement blockers | submittal/RFI status, approvals, schedule logic, PO lead times | prioritized clash/blocker list with owners |
| **Portfolio** | compare projects, systemic issues, resource conflicts, best practices | cross-project metrics | benchmarks + outliers + recommendations |

**Build pattern:** reuse `synthesizeFocus`-style deterministic scorers per copilot; layer an LLM **narration step** (grounded, cited) for Executive/Owner reports. Never let the LLM invent metrics.

## 4. Embedded AI assistants (per phase)

- **RFI Copilot (Phase 3):** "has this been asked before?" (vector search over RFI corpus), "what drawings/specs reference this?" (object graph), "who should answer?" (history/role). **Impact analysis:** schedule/cost/procurement/affected-systems via graph traversal.
- **Submittal review assistant (Phase 4):** compare submitted doc vs. spec + drawing; flag missing data, deviations, risks (RAG + structured extraction).
- **Schedule intelligence (Phase 5):** Monte Carlo completion/delay probability; AI recovery planner (acceleration/resequencing/resource shifts); critical-path "what/why/what-if" explanations.
- **Cost intelligence (Phase 6):** explain budget drift, overrun risk, forecast changes (deterministic variance + LLM narration).
- **Procurement/Safety/Quality engines (Phases 7/9/10):** predict late equipment & supply risk; safety leading indicators; recurring quality issues & contractor performance.

## 5. Autonomous Coordination (Phase 12)

Closed loop, every step persisted to an immutable **decision log**:

```
MONITOR (RFIs, submittals, schedule, cost, procurement — continuous)
   → DETECT (delays, bottlenecks, risks; deterministic thresholds + anomaly models)
   → RECOMMEND (action + owner + due date; spawn `action` records)
   → EXECUTE WITH APPROVAL (reminders, assignments, escalations, reporting)
```

- Scaffolding exists: `api/services/agents/*` (orchestrator/router/worker), runbook engine, AI governance/approval queue. Needs: the monitor loop, the decision log, and approval-gated execution wired end-to-end.
- **Guardrails:** every autonomous action has inputs, rationale, confidence, and an explicit human approval state; full audit; reversible; rate-limited; scoped by RBAC.

## 6. Grounding, safety, governance

- Retrieval over pgvector with **mandatory citations**; prompt-injection guards (already in Ask Jarvis).
- **AI cost governance** + model routing (latest Claude models by default).
- Deterministic scorers are unit-tested; LLM outputs are constrained to narration/extraction over verified data.
- Human-in-the-loop for any write/execute; transparency: the user can always see *why* a recommendation was made.

## 7. Metrics

- % of recommendations acted on; time-to-decision; forecast accuracy (`forecastAccuracyTracker`); reduction in overdue items & slip on Copilot projects; autonomous-action approval/acceptance rate.

## 8. Immediate next steps (build order)

1. Unify the **object graph** (DOMAIN_MODEL §10) — prerequisite for impact analysis & coordination.
2. Extend Focus engine → **Coordination Copilot** (clashes/missing approvals/blockers) — highest reuse.
3. **Executive/Owner report generation** (LLM narration over EVM + risk + schedule, cited).
4. **Schedule Monte Carlo + recovery planner**.
5. Wire **Phase 12 monitor→recommend→approve** loop on top of the existing `actions` + agents scaffolding.

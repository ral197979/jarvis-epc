# AI Project Intelligence — Specification

> **Denver Engineering — the AI-native project operating system.**
> Where Procore *stores* project state, Denver **understands** it, **predicts** where it's going, and **decides** what to do next.
>
> **Status legend:** ✅ exists / 🟡 partial / ❌ missing / ⚠️ not-trustworthy (shell math)
> **Sibling docs:** [SCREEN_INVENTORY.md](./SCREEN_INVENTORY.md) · [USER_WORKFLOWS.md](./USER_WORKFLOWS.md) · honesty baseline in [FEATURES.md](./FEATURES.md)

---

## 0. The design principle (read this first)

Denver's intelligence layer obeys one rule that survives enterprise evaluation:

> **Deterministic, explainable scoring computes the numbers. The LLM only generates language and extracts structure over data that was already verified.**

- **Numbers are never hallucinated.** Every score, rank, severity, overdue count, and forecast comes from a pure function over real rows — unit-testable, reproducible, auditable. An LLM never decides *whether* an RFI is critical.
- **Language is generated, not invented.** When an LLM is in the loop (Ask Jarvis, future RFI/submittal assistants), it summarizes, drafts, or extracts — and is forced to ground every claim in retrieved sources via a tool-call schema, never free text.
- **Decisions are gated.** Anything that *writes* to the project (creates an action, changes a date, sends a notice) passes through a human-in-the-loop approval queue with an immutable decision log.

This is what makes Denver "AI-native" rather than "AI-bolted-on": the differentiating engine — the **Project Copilot Focus ranker** — is 100% deterministic and shipped today. The LLM is an accelerant on top, not the foundation.

---

## 1. The shipped differentiator — Project Copilot (Focus) ✅

**Status: ✅ shipped and tested.**
**Files:** `api/services/copilot/projectCopilotService.ts` · `api/routes/copilot.ts` · `src/components/copilot/CopilotView.tsx` · `src/hooks/useDeepLink.ts` · `src/modules/store/appSlice.ts` · tests `api/__tests__/projectCopilot.test.ts`
**Nav:** `focus` tab (🧭 Focus), domain `ai` (`src/config/navigation.ts`).

### 1.1 What it answers

The Focus engine turns live, cross-module project state into a single ranked answer to:

> **"What should I focus on today?"**

It is the daily entry point for every persona (see [USER_WORKFLOWS.md](./USER_WORKFLOWS.md)). Other modules *hold* records; Focus *triages* them and tells you what matters, why, and what to do next — then deep-links you straight to the record.

### 1.2 The engine — `synthesizeFocus` (pure & deterministic)

`synthesizeFocus(inputs: FocusInputs, now = new Date(), limit = 25): FocusBriefing` is a **pure function**: same inputs + same `now` ⇒ same output, no I/O. This is why it is exhaustively unit-tested without a database (`projectCopilot.test.ts` pins `now = 2026-06-22T12:00:00Z`). `buildProjectFocus` / `buildPortfolioFocus` are the thin DB-backed wrappers that fetch the rows, then delegate to the pure synthesizer.

**Eight signal sources** are pulled from real tables and scored:

| Source | Table | Surfacing filter (DB) | Impacts tagged |
|---|---|---|---|
| `rfi` | `rfis` | `status IN ('open','pending')` | `schedule` |
| `submittal` | `submittals` | `status IN ('submitted','under_review')` | `schedule`, `procurement` |
| `risk` | `risks` | `status IN ('open','mitigating') AND risk_score >= 12` | risk `category` |
| `inspection` | `inspections` | `status='scheduled' OR overall_result='fail'` | `quality`, `schedule` |
| `punch` | `punch_items` | `status='open'` (then high-priority OR overdue) | `closeout`, `quality` |
| `action` | `actions` | `status IN ('open','in_progress')`, de-duped vs. surfaced modules | `execution` |
| `budget` | `projects` | forecast/committed/actual > budget | `cost` |
| `schedule` | `projects` | active project past `planned_finish` | `schedule` |

**Action de-duplication:** the cross-module `actions` query excludes `source_module IN ('rfis','submittals','punch_items','inspections')` (`SURFACED_MODULES`) so an RFI that already spawned an action isn't double-counted.

### 1.3 Scoring model (deterministic, explainable)

Each source has its own builder that produces a 0–100 score from transparent components. Shared primitives:

- `PRIORITY_WEIGHT` = `{ low:0, medium:10, high:22, critical:38 }`
- `daysOverdue(due, now)` = whole days; **positive = overdue**, negative = days remaining, `null` = no due date.
- `dueModifier(d)` = `+4` if due within 2 days; `+3/day` overdue capped at `+30`.
- `clamp` to `[0,100]`; `severityOf(score)` = `≥75 critical · ≥55 high · ≥40 medium · else low`.

**Per-source formulas (as shipped):**

| Source | Base | Adders |
|---|---|---|
| RFI | 30 | priority weight + due modifier + 10 if unassigned |
| Submittal | 28 | due modifier + 6 if `under_review` |
| Risk | — | `risk_score×3` (or `probability×impact×3`) + 15 if mitigation target overdue + 6 if cost exposure |
| Inspection | 50+8 (failed) / 25 (overdue scheduled) | due modifier; passed inspections are dropped entirely |
| Punch | 20 | priority weight + due modifier; surfaced only if high-priority **or** overdue |
| Action | 22 | priority weight + due modifier; only if overdue **or** critical |
| Budget | 40 | `min(45, overrunPct×250)` |
| Schedule | 50 | `min(30, daysLate/7)` + 8 if progress < 90% |

**Ranking:** score desc → most-overdue → source name (stable tiebreak). `summary` counts *all* items by severity; `items` is capped to `limit`.

### 1.4 The `FocusItem` contract

```ts
interface FocusItem {
  source:            'rfi'|'submittal'|'risk'|'inspection'|'punch'|'action'|'budget'|'schedule'
  sourceId:          string | null   // originating record id — drives deep-linking
  reference:         string          // human ref, e.g. "RFI 014", "Risk #3"
  title:             string
  why:               string          // plain-English explanation (deterministic string)
  recommendedAction: string          // the suggested next step
  severity:          'critical'|'high'|'medium'|'low'
  score:             number          // 0–100
  impacts:           string[]        // ['schedule','cost',...]
  dueDate:           string | null   // ISO date
  daysOverdue:       number | null   // >0 overdue, <0 remaining, null = none
  parentId?:         string | null   // e.g. punch item → punch list, for deep-linking
}
```

The portfolio roll-up extends this with `projectId` + `projectName` (`PortfolioFocusItem`).

`FocusBriefing` = `{ project, generatedAt, headline, summary{total,critical,high,medium,low}, items[] }`. `headline` is itself deterministically generated — e.g. *"Denver Data Center: 2 critical and 3 high-priority items need attention. Top focus — RFI 014 …"* — never an LLM call.

### 1.5 Endpoints ✅

Both require `requireAuth` + `requireTenant`; `?limit=` clamped `[1,100]`.

| Method | Route | Returns |
|---|---|---|
| GET | `/api/v1/copilot/projects/:projectId/focus` | `{ data: FocusBriefing }` for one project (404 if not found) |
| GET | `/api/v1/copilot/focus` | `{ data: PortfolioBriefing }` — top items rolled across ≤25 active projects |

`buildPortfolioFocus` fans out `buildProjectFocus` across the most-recently-updated active projects, flattens, re-ranks globally, and bounds query cost via `maxProjects`.

### 1.6 UI + deep-linking ✅

`CopilotView.tsx` renders the portfolio briefing (`/copilot/focus?limit=50`): a headline banner, severity filter chips with live counts, and `FocusCard`s showing severity badge, source icon, project, overdue badge, score, the `why`, the `Do:` recommended action, and impact tags.

**Deep-link flow (the magic):**
1. Click a card → `openRecord({ tab, source, sourceId, projectId, parentId })` in `appSlice.ts`.
2. `SOURCE_TAB` maps each source to its destination tab (`rfi→rfis`, `risk→riskregister`, `budget→costcontrol`, `schedule→evm`, …).
3. `openRecord` sets the active tab, stores a `DeepLinkTarget`, and writes `jarvis-active-project` to `localStorage` so the destination view pre-selects the project.
4. The destination view calls `useDeepLink(source)` — which claims the pending target **once**, clears it, and opens the exact record when its data loads.

This is genuine cross-module navigation: Focus → the live record, project pre-selected, in one click.

### 1.7 Test coverage ✅

`projectCopilot.test.ts` covers: empty-project headline; RFI scoring (overdue/critical/unassigned → critical, ordering); risk scaling + exposure string; inspection/punch surfacing filters + `parentId` carry; budget overrun %, schedule-overrun gated on active status; ranking/limit/summary semantics; and a route smoke test mirroring the mock-pool pattern. **The Focus engine is the most-tested AI surface in the platform.**

---

## 2. Supporting AI that exists today

### 2.1 Ask Jarvis — grounded RAG ✅

**Files:** `api/routes/ask.ts` · `api/services/askBuilder.ts` · `api/services/knowledgeSearch.ts` / `knowledgeEmbed.ts` / `knowledgeIngest.ts` / `knowledgeTier.ts` · `src/components/AskJarvisView.tsx`. **Nav:** `ask` (🤖 Ask Jarvis).

Pipeline (`askBuilder.ts`): retrieve (FTS over `knowledge_chunks`) → filter (project/asset/source) → **tier-weighted rank** (OEM > record > other > form) → parallel fix-library lookup → trim to top-8 chunks @ 1200 chars (hard cost ceiling) → structured prompt → **Claude via Anthropic SDK forced through a `record_answer` tool schema** (no free text) → persist `chat_messages` with `structured_answer` + `retrieved_chunk_ids`.

Output is the enforced `StructuredAnswer` = `{ answer, procedure[], possible_causes[], confidence, citations[] }`. Citations resolve to real chunks via `GET /api/v1/ask/chunks/:id`. **Safety:** prompt-injection regex guard, 4000-char cap, 503 when `ANTHROPIC_API_KEY` absent. **Learning loop:** `POST /ask/sessions/:id/resolve` links a session to a work order as a quality signal. Default model `claude-sonnet-4-6` (env-overridable).

### 2.2 Predict — statistical project health ✅

**Files:** `api/routes/predict.ts` · `api/services/predict/predictService.ts` · `src/components/predict/PredictView.tsx`. **Nav:** `predict` (🔮).

No ML model — **honest statistics** over EVM snapshots: composite health score (CPI 40% / SPI 30% / burn 20% / CO-risk 10%, minus overdue-action penalty) → `green/amber/red`; **linear-regression EAC forecast** (slope, r², 30-day projection, trend from first-half vs. second-half CPI) with last-12-actuals + 4 projected points; heuristic anomaly flags (ACWP spike > 2.5× average, CPI declining 3+ periods, CPI/SPI < 0.85, overdue actions, pending-CO %). Endpoints: `GET /predict/portfolio`, `GET /predict/projects/:id`.

### 2.3 Monte Carlo risk simulation ✅ (engine) / 🟡 (surfacing)

**Files:** `api/routes/monteCarlo.ts` · `api/services/simulation/monteCarloService.ts`.

A **real** probabilistic schedule + cost simulation (positioned at Oracle P6 Risk parity): `POST /monte-carlo/runs` runs iterations synchronously and returns P-level results; `GET /runs`, `GET /runs/:id` (inputs + sensitivity), `GET /runs/:id/distribution` (histogram). 🟡 because there is **no dedicated nav tab or recovery-planner UI** over it yet — see §4 and [SCREEN_INVENTORY.md](./SCREEN_INVENTORY.md).

### 2.4 Multi-agent scaffolding 🟡

**Files:** `api/services/agents/*` (`agentOrchestrator`, `agentRouter`, `agentWorker`, `agents`, `agentTypes`, `agentGovernanceService`, `agentExecutionLedger`, `agentMemoryService`, `agentHandoffService`, `agentTaskQueue`).

A real plan→route→govern→enqueue→execute→ledger spine exists. `orchestrate()` resolves an objective (`assess_readiness`, `incident_response`, `optimize_operations`, `validate_and_document`) to routing hints, builds an `ExecutionPlan`, runs a **governance check before any task is created**, and returns `requires_approval` (creating **no** tasks) when the plan needs sign-off. Eight agent types (`TaskAgent`, `RiskAgent`, `SchedulingAgent`, …) with capability/concurrency metadata, immutable `AgentDecisionTrace` (rationale, confidence, `alternatives[]`), and a typed handoff protocol. 🟡 because the agent *task handlers* (`agents.ts`) are still thin and not yet wired into construction workflows.

### 2.5 AI execution governance ✅ (the guardrail spine)

**File:** `api/services/ai/aiGovernance.ts` · route `api/routes/aiGovernance.ts`.

Human-in-the-loop approval queue with non-negotiable rules: `approval_required` defaults **true**; below-threshold confidence **auto-rejects**; preview returns projected impact with **no mutation**; execution gated on `approved` status; every approve/reject/execute is an **immutable audit event**. `QueuedRecommendation` carries `confidenceScore`, `impactScore`, `urgencyScore`, `reason`, `dataSignals[]`, `affectedEntities[]`, and a `rollbackPlan`. **This is the foundation Phase 12 autonomy is built on.**

### 2.6 MCP bridge ✅ / ⚠️

**File:** `api/routes/mcp.ts`. Native tools (`http_fetch` with SSRF allowlist, `audit_log`, `audit_query`, `model_call`, `embedding_create`, `session_create`) implemented in-process; everything else proxied to Ava at `AVA_MCP_URL` (503 if absent). Model calls use the backend key — **never** exposed to the browser; `bash`/`file_read`/`process_kill` are Ava-only and blocked if Ava is unreachable. ⚠️ The engineering-calc tools route here but **no backend implements the math** — see §6.

---

## 3. Roadmap — the Copilot family

The shipped Project Copilot is the *operator's* view. The vision layers role-specific copilots on the same deterministic-scoring + deep-linking foundation.

### 3.1 Executive Copilot ❌ (route exists 🟡)

**Audience:** Executive, Project Executive. **Backing:** `api/routes/executive.ts` (`/overview`: open/in-progress actions, readiness, incidents, AI recs) exists 🟡 but has **no nav tab and no dedicated screen**.

- Portfolio health headline rolled from `predictService` (portfolio score, at-risk count) + `buildPortfolioFocus` critical/high counts.
- Per-project red/amber/green with the single top driver per project (deterministic).
- Margin/cash exposure deltas, deterministically ranked; **LLM only drafts the narrative summary** over those verified numbers.
- **Acceptance:** every figure traces to a `predict`/`copilot`/EVM query; the LLM narrative cites them; nothing is generated that isn't in the data.

### 3.2 Coordination Copilot ❌

**Audience:** PM, Construction Manager. A project-scoped expansion of Focus that adds **cross-record causality**: "RFI 014 blocks Submittal 22 blocks procurement of switchgear on the critical path." Uses `buildProjectFocus` items plus a deterministic dependency graph (seed services present: `actions/actionDependencyGraph`). Surfaces *chains and missing approvals*, not just isolated items.

### 3.3 Portfolio Copilot 🟡→❌

**Audience:** Executive, PE. `buildPortfolioFocus` ✅ already produces the ranked cross-project feed; the gap ❌ is a dedicated **portfolio Focus screen** (today only `FinanceView` is mapped to `portfolio`). Add week-over-week trend deltas and per-project drill-through via the existing deep-link mechanism + benchmarking services (`ecosystem/benchmarkingService`).

---

## 4. Roadmap — embedded assistants (per phase)

Each is **LLM-for-language over deterministic-data**. None invents numbers.

| Assistant | What it does | Deterministic core | LLM role | Status |
|---|---|---|---|---|
| **RFI Copilot + impact analysis** | On RFI draft: predict schedule/cost/procurement impact + suggest reviewer | Impact via dependency graph + schedule float; reviewer from history | Drafts the RFI question, summarizes impact | ❌ |
| **Submittal review assistant** | Pre-screens shop drawings vs. spec section | Spec-section match, prior-rev diff, overdue math | Extracts deviations from doc text, drafts review comments | ❌ |
| **Schedule Monte Carlo + recovery + critical-path explainability** | P50/P80 completion, recovery options, "why this is the critical path" | **`monteCarloService` ✅** + CPM from `scheduleImport` | Narrates critical path + recovery trade-offs | 🟡 engine real; UI/explainability ❌ |
| **Cost intelligence** | EAC drivers, change-order leakage, recovery levers | `predictService` regression EAC ✅ + budget item ✅ | Explains the variance story (cited) | 🟡 |
| **Procurement predictive** | Long-lead exposure, submittal→procurement chain risk | Submittal due math + lead-time table | Drafts expediting notices | ❌ |
| **Safety predictive** | Incident leading indicators from daily logs/observations | Frequency/severity trending (deterministic) | Summarizes the pattern | ❌ (`SafetyView.tsx` exists but unwired — see SCREEN_INVENTORY) |
| **Quality predictive** | Punch/inspection failure clustering by trade/location | Failure-rate aggregation | Names the systemic cause | ❌ |

**Build rule for all:** ship the deterministic scorer + endpoint + tests **first** (like Focus); add the LLM language layer only after the numbers are trustworthy and grounded.

---

## 5. Phase 12 — Autonomous Coordination ❌ (foundation ✅)

The end-state: the platform doesn't just triage — it **acts**, under guardrails. The loop:

```
MONITOR  → continuously read cross-module state (the Focus signal sources)
DETECT   → deterministic rules flag a coordination break (e.g. overdue RFI on critical path)
RECOMMEND→ generate a QueuedRecommendation: action + reason + dataSignals + impact + rollbackPlan
EXECUTE  → ONLY after human approval; mutation runs; immutable decision logged
```

**Foundation already shipped:**
- **Monitor/Detect** = the `synthesizeFocus` signal sources + `predict` anomaly heuristics.
- **Recommend** = `aiGovernance.QueuedRecommendation` (confidence/impact/urgency/reason/dataSignals/rollbackPlan) ✅.
- **Execute-with-approval** = `aiGovernance` queue + `agentOrchestrator` governance-before-tasks gate ✅.
- **Immutable decision log** = `agentExecutionLedger.AgentDecisionTrace` (rationale, confidence, alternatives, chosenAction) ✅.

**Guardrails (non-negotiable, mostly built):**
- `approval_required` defaults true; sub-threshold confidence auto-rejects; preview never mutates; execution gated on `approved`.
- Every decision carries a `rollbackPlan` and rejected `alternatives`.
- Governance check runs **before** any task is created (`orchestrate`).
- Per-tenant policy + role gating on who may approve.

**Gaps ❌:** the continuous monitor loop, the detection-rule catalogue, and wiring recommendations to real construction mutations (create action / nudge reviewer / propose re-baseline) are not yet built. **No step writes without an approved, logged decision** — autonomy here means *faster human-approved coordination*, not unattended mutation.

---

## 6. Honesty — what is NOT trustworthy ⚠️

Per [FEATURES.md](./FEATURES.md): the engineering **calculation** tools (WWTP, PWTP, HVAC/MEP, NEC, stormwater, process equipment, O&G) are **front-end shells**. Their in-browser math is placeholder (synthetic / random-noise multipliers) and they route over MCP to an Ava orchestrator that is a chat/skills dispatcher, **not** a calculation engine. **Do not present any number from these tools as engineering output.** The genuinely real items are: Project Copilot Focus, Ask Jarvis (grounded RAG), Predict (statistical), Monte Carlo simulation, P&ID/PFD SVG generation, and the governance/agent spine. `src/config/systemPrompt.ts` over-advertises calc tools and should be corrected so Ask Jarvis doesn't hallucinate engineering answers.

---

## 7. Grounding, safety & governance summary

| Control | Mechanism | Status |
|---|---|---|
| No hallucinated numbers | Deterministic scorers (`synthesizeFocus`, `predictService`, `monteCarloService`) | ✅ |
| Grounded language | `record_answer` tool-schema forcing + citations (Ask Jarvis) | ✅ |
| Prompt-injection defense | Regex guard + length cap (`ask.ts`) | ✅ |
| No autonomous writes | `aiGovernance` approval queue, default approval_required | ✅ |
| Immutable decisions | `AgentDecisionTrace` ledger, audit events | ✅ |
| Tenant isolation | `requireTenant` + RLS on every query | ✅ |
| Secrets boundary | Model key backend-only; SSRF allowlist on `http_fetch` | ✅ |
| Reproducibility | Pure functions pinned on `now`; full unit tests | ✅ |

---

## 8. Metrics that prove it works

- **Focus:** % of sessions that start on Focus; click-through to deep-linked record; median time-to-first-action; critical items resolved within SLA.
- **Predict:** EAC forecast error vs. actual at close; anomaly precision/recall.
- **Ask Jarvis:** answer-with-citation rate; session→work-order resolution rate; injection-block rate.
- **Phase 12 readiness:** recommendation approval rate; rollback invocation rate; **zero unapproved mutations** (hard gate).

---

## 9. Build order

1. ✅ **Project Copilot Focus** (engine + endpoints + UI + deep-linking + tests) — **done**.
2. 🟡 **Portfolio + Executive Copilot screens** over existing `buildPortfolioFocus` / `executive.ts` / `predictService`.
3. 🟡 **Schedule Monte Carlo UI + critical-path explainability** over the real `monteCarloService`.
4. ❌ **Coordination Copilot** (dependency chains, missing approvals) over the dependency-graph services.
5. ❌ **Embedded assistants** (RFI → submittal → cost → procurement → safety/quality) — deterministic scorer first, LLM language second.
6. ❌ **Phase 12 autonomous loop** — monitor + detection-rule catalogue wired to `aiGovernance` recommendations with rollback.
7. ⚠️ **Fix calc honesty** — correct `systemPrompt.ts`; integrate real engines (`ava-math-engine`, `MEPPro`) before any calc tool is presented as working.

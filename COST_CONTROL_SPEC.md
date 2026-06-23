# Cost & Commercial Control — Build-Ready Specification

**Phase 6 · Cost & Commercial** · Denver Engineering — the AI-native project operating system
(understands → predicts → decides)

> Positioning vs. Procore: this module targets parity with **Procore Financials** (Budget, Commitments,
> Prime/Owner Contracts, Change Management, Invoicing/Pay Apps, Forecasting) and then surpasses it with a
> **Cost Intelligence layer** that *explains* drift, *predicts* overrun, and *decides* recovery actions —
> feeding the [AI Project Intelligence](AI_PROJECT_INTELLIGENCE_SPEC.md) Project Copilot.

Cross-links: [Domain Model](DOMAIN_MODEL.md) · [AI Project Intelligence](AI_PROJECT_INTELLIGENCE_SPEC.md) ·
[Procurement](PROCUREMENT_SPEC.md) · [Document Control](DOCUMENT_CONTROL_SPEC.md) ·
[Mobile Field Execution](MOBILE_FIELD_EXECUTION_SPEC.md) · [Features](FEATURES.md)

Legend: ✅ shipped · 🟡 partial / shell · ❌ not built · ⚠️ caveat

---

## 1. Current State (grounded in the codebase)

### 1.1 What exists today

| Capability | Status | Evidence (real files / tables / routes) |
|---|---|---|
| **Project budget** (one per project) — original / revised / committed / actual / forecast totals | ✅ | `budgets` table — `api/db/migrations/007_pm_modules.sql:164`; routes `api/routes/budgets.ts` (`GET/POST /projects/:projectId/budget`, `PATCH /budgets/:id`) |
| **Budget line items** by cost code (qty/unit/unit_cost, original/revised/committed/actual/forecast) | ✅ | `budget_items` — `007_pm_modules.sql:190`; `api/routes/budgets.ts:81–149` |
| **Budget rollup view** (SUM of items per budget) | ✅ | `budget_rollup` view — `007_pm_modules.sql:250`; `GET /projects/:projectId/budget/rollup` |
| **Change orders** — number, type (PCO/OCO), amount, schedule_days, status lifecycle | ✅ | Two implementations: legacy `change_orders` in `007_pm_modules.sql:220` (served by `api/routes/budgets.ts`) **and** the canonical `change_orders` in `058_change_orders.sql:25` with `co_status`/`co_type` enums, `change_order_tasks` link table, service `api/services/changeOrders/changeOrderService.ts`, routes `api/routes/changeOrders.ts` |
| **CO workflow** draft → submitted → approved \| rejected → void; approval intended to bump EVM BAC | ✅ | `changeOrderService.ts` (`submitChangeOrder`/`approveChangeOrder`/`rejectChangeOrder`, transitions guarded by `WHERE status=…`); header comment "Approved COs update the project's EVM baseline BAC via cost_impact." |
| **Field cost entry** — date, type enum (labor/material/equipment/subcontract/other), wbs_code, amount, qty/unit/unit_cost, post→void | ✅ | `cost_entries` + `cost_entry_type`/`cost_entry_status` enums — `061_cost_entries.sql`; service `api/services/costEntry/costEntryService.ts`; routes `api/routes/costEntry.ts`. Posting links to `evm_actuals` via `evm_actual_id`. |
| **Cost-control snapshot** — budget vs committed vs actual, monthly trend, top subs, CO summary | ✅ | `api/services/costControl/costControlService.ts` (`getCostControlSnapshot`, `MonthlyTrend`, `TopSubcontractor`, `ChangeOrderSummary`); route `api/routes/costControl.ts` |
| **Earned Value Management** — baseline, WBS entries, actuals, progress, snapshots; full index set | ✅ | `evm_baselines` / `evm_wbs_entries` / `evm_actuals` / `evm_progress` / `evm_snapshots` — `053_evm.sql`; unique guard `057_evm_wbs_unique.sql`; service `api/services/evm/evmService.ts`; routes `api/routes/evm.ts`; tested `api/__tests__/evmFormulas.test.ts` |
| **EVM formulas** BCWS/BCWP/ACWP → CPI/SPI/CV/SV/EAC/ETC/VAC/TCPI + green/yellow/red health | ✅ | `evmService.ts` `deriveIndices()` / `plannedValue()` / `healthStatus()` / `computeEvmMetrics()` / `takeSnapshot()` / `getScurveData()`; same formulas asserted in `evmFormulas.test.ts:10–73` |
| **Portfolio rollup / forecast / anomalies** (cross-project) | ✅ | `api/routes/portfolio.ts` (`/readiness`, `/forecast`, `/bottlenecks`, `/anomalies`) |
| **Copilot budget signal** — surfaces "Cost forecast exceeds budget" with a cited why-string | ✅ | `api/services/copilot/projectCopilotService.ts` `budgetItem()` (`projectCopilotService.ts:252`): computes `worst = max(forecast, committed+actual)`, % over budget, basis string |

### 1.2 EVM formulas as implemented (authoritative)

From `evmService.ts` / `evmFormulas.test.ts` — these are the live equations; reuse them verbatim:

```
BCWS (PV) = Σ over WBS of plannedValue(bac, planned_start, planned_finish, statusDate)
            where plannedValue = linear ramp: 0 before start, BAC after finish,
            else BAC × (statusDate − start)/(finish − start)
BCWP (EV) = Σ over WBS of bac × percent_complete/100   (latest evm_progress ≤ statusDate)
ACWP (AC) = Σ evm_actuals.amount with period_date ≤ statusDate
CPI  = BCWP / ACWP                 (null if ACWP = 0)
SPI  = BCWP / BCWS                 (null if BCWS = 0)
CV   = BCWP − ACWP                 (+ = under budget)
SV   = BCWP − BCWS                 (+ = ahead of schedule)
EAC  = BAC / CPI                   (CPI-trend method; null if CPI ≤ 0)
ETC  = EAC − ACWP
VAC  = BAC − EAC
TCPI = (BAC − BCWP) / (BAC − ACWP) (only when ACWP < BAC and BCWP < BAC)
health = red if min(CPI,SPI) < 0.9, yellow if < 0.95, else green   (see healthStatus())
```

### 1.3 Honest gaps vs. Procore Financials

| Missing capability | Status | Why it matters |
|---|---|---|
| **Prime / Owner contract + Schedule of Values (SOV)** as first-class billing structure | ❌ | `contracts` exists (`002_epc_core.sql:118`) but is a flat header (original/approved/invoiced/paid scalars) — no SOV line breakdown, no billing periods. Owner billing (AIA G702/G703) impossible today. |
| **Commitments** as a ledger distinct from budget (POs + subcontracts rolled into committed cost with line detail) | 🟡 | `purchase_orders` (`002_epc_core.sql:161`), `subcontracts` (`059_subcontracts.sql:97`) exist but `budget_items.committed_amount` is a manually-set scalar — no automatic commitment rollup or line mapping to cost codes. |
| **Invoices / Pay Applications** (owner-facing, AIA-style) — period, % complete, retention, stored materials, lien waivers | 🟡/❌ | `subcontract_invoices` (`059_subcontracts.sql:129`) covers *sub* billing (gross/retention/net) but there is **no owner pay-app**, no stored-materials, no lien-waiver tracking, no G703 continuation sheet. |
| **Payments** (disbursement ledger, retention release) | ❌ | `contracts.paid_amount` / `subcontract` retention are scalars only; no payment records, no retention-release events. |
| **Contingency / management-reserve ledger** | ❌ | No table tracks contingency draws against COs. |
| **Claims / disputes** register | ❌ | No model. |
| **Forecasting beyond EAC = BAC/CPI** — manual cost-to-complete overrides, multiple EAC methods, forecast-to-complete by line | 🟡 | Only the single CPI-trend EAC exists; `budget_items.forecast_amount` is a manual scalar with no method/audit. |
| **AI cost intelligence** — explainable drift/overrun with cited drivers, predictive overrun probability | 🟡 | Copilot `budgetItem()` emits one heuristic signal; no driver attribution, no trend prediction, no Predict-module overrun model wired to cost. |

---

## 2. Target Architecture — Procore-parity + Cost Intelligence

```
                          ┌────────────────────────────────────────────┐
                          │           COST INTELLIGENCE (AI)            │
                          │  drift explainer · overrun predictor ·      │
                          │  EAC reconciler · recovery recommender      │
                          └───────────────▲────────────────────────────┘
                                          │ signals + drivers
   ┌──────────┐  ┌─────────────┐  ┌───────┴────────┐  ┌──────────────┐  ┌──────────┐
   │ Budget   │→ │ Commitments │→ │  Cost Ledger   │→ │  Forecast    │→ │   EVM    │
   │ + SOV    │  │ (PO/Subs/   │  │ (entries +     │  │  (EAC/ETC by │  │ snapshots│
   │          │  │  contracts) │  │  invoices)     │  │  method)     │  │ /S-curve │
   └────┬─────┘  └─────┬───────┘  └──────┬─────────┘  └──────┬───────┘  └────┬─────┘
        │              │                 │                   │               │
   ┌────┴──────────────┴─────────────────┴───────────────────┴───────────────┴────┐
   │  Owner Billing: Prime/Owner Contract → SOV → Pay Application (G702/G703) →     │
   │  Retention · Stored Materials · Lien Waivers → Payment → Contingency draw       │
   └───────────────────────────────────────────────────────────────────────────────┘
```

Every dollar threads through one **cost code** — the join key already present on `budget_items`,
`change_orders`, `cost_entries`, and EVM WBS. Cost codes remain the integration spine.

---

## 3. Data Model (new + extended entities)

> Convention matches the repo: `UUID` PKs (`gen_random_uuid()`), `tenant_id`/`project_id` on every row,
> RLS via `current_setting('app.current_tenant_id', true)::uuid`, `NUMERIC(18,2)` for money, `*_status`
> Postgres enums, `created_at`/`updated_at` + `set_updated_at()` trigger.

### 3.1 Prime / Owner Contracts + Schedule of Values

**`prime_contracts`** (extends the thin `contracts` header for owner-facing billing)
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, project_id | UUID | RLS |
| contract_id | UUID FK → contracts(id) | optional bridge to legacy header |
| number | TEXT | e.g. `PC-001` |
| title | TEXT | |
| owner_party_id | UUID FK → vendors(id) | the paying owner |
| original_value | NUMERIC(18,2) | |
| approved_co_value | NUMERIC(18,2) | Σ executed owner COs (cached) |
| revised_value | NUMERIC(18,2) | computed = original + approved_co |
| retention_pct | NUMERIC(5,2) DEFAULT 5 | default holdback |
| status | `prime_contract_status` enum: `draft, out_for_signature, executed, closed, terminated` | |
| executed_at | TIMESTAMPTZ | |

**`sov_lines`** (Schedule of Values — billing breakdown / G703 continuation sheet)
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, prime_contract_id | UUID FK | |
| line_number | TEXT | G703 item no. |
| cost_code | VARCHAR(40) | join to budget_items |
| description | TEXT | |
| scheduled_value | NUMERIC(18,2) | this line's contract value |
| from_previous | NUMERIC(18,2) | billed in prior apps (cached) |
| materials_stored | NUMERIC(18,2) | current stored-materials value |
| sort_order | INTEGER | |
| UNIQUE (prime_contract_id, line_number) | | |

### 3.2 Commitments ledger (PO + subcontract rollup)

**`commitments`** (normalized ledger over POs/subcontracts mapped to cost codes)
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, project_id | UUID | |
| source_type | `commitment_source` enum: `purchase_order, subcontract, prime_co` | |
| source_id | UUID | FK to `purchase_orders` / `subcontracts` / `change_orders` |
| vendor_id | UUID FK → vendors | |
| cost_code | VARCHAR(40) | |
| original_amount | NUMERIC(18,2) | |
| revised_amount | NUMERIC(18,2) | + approved commitment COs |
| invoiced_amount | NUMERIC(18,2) | Σ approved invoices |
| paid_amount | NUMERIC(18,2) | Σ payments |
| status | `commitment_status`: `draft, issued, partial, complete, closed` | |

Populated by a worker on PO issue + subcontract execution (see [Procurement](PROCUREMENT_SPEC.md)).
`budget_items.committed_amount` becomes a derived rollup, not a manual scalar.

### 3.3 Owner Pay Applications (AIA G702/G703)

**`pay_applications`**
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, prime_contract_id | UUID FK | |
| app_number | INTEGER | auto-seq per contract |
| period_start, period_end | DATE | |
| status | `pay_app_status` enum: `draft, submitted, under_review, approved, rejected, paid` | |
| total_completed_stored | NUMERIC(18,2) | Σ line work + stored |
| retention_amount | NUMERIC(18,2) | held this period |
| previous_payments | NUMERIC(18,2) | |
| current_payment_due | NUMERIC(18,2) | = completed − retention − previous |
| submitted_at, approved_at, paid_at | TIMESTAMPTZ | |
| UNIQUE (prime_contract_id, app_number) | | |

**`pay_app_lines`** (per SOV line, per period)
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, pay_application_id, sov_line_id | UUID FK | |
| work_completed_this_period | NUMERIC(18,2) | |
| materials_stored | NUMERIC(18,2) | |
| percent_complete | NUMERIC(5,2) | = (from_prev + this + stored)/scheduled_value |
| retention_pct | NUMERIC(5,2) | per-line override |

**`lien_waivers`**
| field | type | notes |
|---|---|---|
| id | UUID PK | |
| tenant_id, pay_application_id | UUID FK | |
| vendor_id | UUID FK | |
| waiver_type | `lien_waiver_type` enum: `conditional_progress, unconditional_progress, conditional_final, unconditional_final` | |
| amount | NUMERIC(18,2) | |
| status | `lien_waiver_status`: `pending, received, rejected` | |
| document_id | UUID FK → documents | |

### 3.4 Payments & retention

**`payments`**
| field | type | notes |
|---|---|---|
| id, tenant_id, project_id | | |
| payable_type | enum: `pay_application, subcontract_invoice, purchase_order` | polymorphic |
| payable_id | UUID | |
| amount | NUMERIC(18,2) | |
| retention_released | NUMERIC(18,2) DEFAULT 0 | |
| paid_at | TIMESTAMPTZ | |
| method | TEXT | check / ACH / wire |
| reference | TEXT | |

### 3.5 Contingency ledger

**`contingency_ledger`**
| field | type | notes |
|---|---|---|
| id, tenant_id, project_id | | |
| original_amount | NUMERIC(18,2) | management reserve at baseline |
| entry_type | enum: `allocation, draw, restore` | |
| change_order_id | UUID FK | draw cause (optional) |
| amount | NUMERIC(18,2) | signed |
| balance | NUMERIC(18,2) | running balance (cached) |
| reason | TEXT | |

### 3.6 Forecast (multi-method EAC + overrides)

**`cost_forecasts`** (one row per snapshot / method, audited)
| field | type | notes |
|---|---|---|
| id, tenant_id, project_id | | |
| cost_code | VARCHAR(40) | nullable = project-level |
| method | `eac_method` enum: `cpi_trend, cpi_spi_composite, manual_etc, budget_remaining` | |
| eac | NUMERIC(18,2) | |
| etc | NUMERIC(18,2) | |
| basis | JSONB | drivers/inputs snapshot for audit |
| override_etc | NUMERIC(18,2) | PM manual cost-to-complete |
| override_by, override_reason | UUID / TEXT | |
| created_at | TIMESTAMPTZ | |

**EAC method library** (extends the single live formula):
```
cpi_trend          EAC = BAC / CPI                                    (current — evmService)
cpi_spi_composite  EAC = ACWP + (BAC − BCWP) / (CPI × SPI)            (schedule-pressure aware)
manual_etc         EAC = ACWP + override_etc                          (PM judgment)
budget_remaining   EAC = ACWP + (BAC − BCWP)                          (optimistic; remainder on-budget)
```

### 3.7 Claims register

**`cost_claims`** — id, tenant/project, claim_number, type (`delay, acceleration, disruption, scope`),
amount_claimed, amount_settled, status (`draft, submitted, negotiation, settled, rejected, litigation`),
linked change_order_id, narrative, created/updated. (Phase 6c — lowest priority.)

---

## 4. API Contracts

Base: `/api/v1`. All routes tenant-scoped via existing middleware. New endpoints extend
`api/routes/{budgets,evm,costEntry,changeOrders}.ts`:

### 4.1 Contracts & SOV
```
POST   /projects/:projectId/prime-contracts
GET    /projects/:projectId/prime-contracts
GET    /prime-contracts/:id                       → header + revised_value rollup
POST   /prime-contracts/:id/sov                   → bulk upsert SOV lines
GET    /prime-contracts/:id/sov
POST   /prime-contracts/:id/execute               → status → executed
```

### 4.2 Commitments
```
GET    /projects/:projectId/commitments           → ledger, ?costCode= filter
GET    /projects/:projectId/commitments/rollup    → committed by cost code (feeds budget_items)
POST   /commitments/:id/sync                       → recompute invoiced/paid from sources
```

### 4.3 Pay Applications
```
POST   /prime-contracts/:id/pay-apps               → opens next period (auto app_number)
GET    /prime-contracts/:id/pay-apps
GET    /pay-apps/:id                               → G702 summary + G703 lines
PATCH  /pay-apps/:id/lines                          → set work-completed / stored per line
POST   /pay-apps/:id/submit
POST   /pay-apps/:id/review     {decision: approve|reject, notes}
POST   /pay-apps/:id/pay        {amount, retentionReleased, method, reference}
GET    /pay-apps/:id/g702       → printable certificate payload
POST   /pay-apps/:id/lien-waivers                  → attach waiver
```

### 4.4 Forecast & Cost Intelligence
```
GET    /projects/:projectId/forecast               → all methods + current selection
POST   /projects/:projectId/forecast/override  {costCode, etc, reason}
GET    /projects/:projectId/cost-intelligence      → drift explanation + drivers + overrun probability
GET    /projects/:projectId/contingency            → ledger + balance
POST   /projects/:projectId/contingency/draw   {amount, changeOrderId, reason}
```

**`GET /cost-intelligence` response shape**
```jsonc
{
  "projectId": "…",
  "asOf": "2026-06-22",
  "health": "yellow",                 // from EVM healthStatus()
  "overrunProbability": 0.62,         // predictive (see §6.2)
  "projectedEac": 4820000,
  "bac": 4500000,
  "vac": -320000,
  "drivers": [                        // ranked, cited — explainability
    { "costCode": "03-300", "label": "Concrete", "varianceUsd": -210000,
      "cpi": 0.84, "cause": "productivity",
      "narrative": "ACWP outpacing BCWP since 2026-04 (CPI 0.84)",
      "evidence": ["cost_entries:…", "evm_actuals:…"] },
    { "costCode": "16-100", "label": "Electrical", "varianceUsd": -90000,
      "cause": "unfunded_change",
      "narrative": "CO-014, CO-018 executed but not in revised budget",
      "evidence": ["change_orders:…"] }
  ],
  "recommendedActions": [
    { "type": "change_order",     "title": "Convert PCO-022 to OCO to recover $140k", "impactUsd": 140000 },
    { "type": "contingency_draw", "title": "Draw $80k contingency for concrete overrun" }
  ]
}
```

---

## 5. Lifecycles (state machines)

### 5.1 Change Order (live today — `changeOrderService.ts`; extend with execution posting)
```
draft ──submit──▶ submitted ──approve──▶ approved ──execute──▶ executed
  │                  │                                            │
  │                  └──reject──▶ rejected                        ▼
  └──────────────────────────────────────────────────▶ void   updates revised budget
                                                                 + EVM baseline BAC
                                                                 + contingency draw (if reserve-funded)
```
Guards (already enforced via `WHERE status=…`): edits only in `draft`; submit only from `draft`;
approve/reject only from `submitted`. **New:** `approved → executed` posts cost impact to
`budget_items.revised_amount` and bumps `evm_baselines.bac` (the current code only comments this — wire it on `execute`).

### 5.2 Pay Application (new)
```
draft ──submit──▶ submitted ──review──▶ under_review ──approve──▶ approved ──pay──▶ paid
                                            │
                                            └──reject──▶ rejected ──(revise)──▶ draft
```
On `approve`: lock `pay_app_lines`, roll `work_completed_this_period + materials_stored` into each
`sov_line.from_previous`, accrue `retention_amount`. On `pay`: create `payments` row, optionally release
retention. Block `submit` if required `lien_waivers` for the period are not `received` (configurable gate).

### 5.3 Cost Entry (live — `costEntryService.ts`)
```
draft ──post──▶ posted ──void──▶ void
```
`post` creates the matching `evm_actuals` row and stamps `cost_entries.evm_actual_id` (existing behavior);
`void` reverses the actual. Posted entries are immutable.

---

## 6. AI Cost Intelligence (the differentiator)

> Goal: move from "the budget is over" (today's single Copilot heuristic, `budgetItem()`) to
> "**here is why, ranked by driver, with citations, and here is what to do**."

### 6.1 Drift / overrun explainer (deterministic, citable)
For each cost code compute variance = `revised − max(forecast, committed+actual)` (matching the existing
`budgetItem()` "worst" basis at `projectCopilotService.ts:257`), attach CPI/SPI from EVM, classify cause:
- **`productivity`** — CPI < 0.95 and ACWP trend slope > BCWP slope (from `evm_actuals` / `evm_progress` series).
- **`unfunded_change`** — approved/executed `change_orders` not yet in `budget_items.revised_amount`.
- **`commitment_leakage`** — `commitments.invoiced_amount` > mapped `budget_items.committed_amount`.
- **`stored_materials_timing`** — pay-app stored value without corresponding progress.

Each driver carries `evidence: [table:id]` so the [Copilot](AI_PROJECT_INTELLIGENCE_SPEC.md) renders a
grounded "why," extending the existing `FocusItem.why` pattern (`projectCopilotService.ts:262`). The LLM
**narrates only** — classification and numbers are deterministic.

### 6.2 Overrun prediction
`overrunProbability` from the trajectory of CPI and EAC across `evm_snapshots` (already persisted by
`takeSnapshot()`): logistic on (CPI slope, current CPI, % complete, count of open unfunded COs). Honest
status: **🟡 to build** — the Predict module (`api/services/predict/`, see [Features](FEATURES.md)
"cost-overrun risk") is the home; this spec wires it to EVM snapshots rather than re-inventing.

### 6.3 Recovery recommender
Maps each driver to an action type (`change_order`, `contingency_draw`, `forecast_override`,
`re-sequence` → hands to schedule). Emitted as `recommendedActions` and surfaced as Copilot focus items +
optional cross-module actions (the `impacts:['cost']` action pattern already exists in the Copilot).

---

## 7. Acceptance Criteria

**Parity (must survive enterprise eval):**
1. A prime contract with an SOV bills a pay app; G702 summary = Σ G703 lines; `current_payment_due = completed − retention − previous`. Unit test asserts the arithmetic.
2. Pay-app lifecycle enforces guards: cannot `pay` before `approve`; cannot `submit` without required lien waivers (when gate on).
3. Commitments rollup: issuing a PO/subcontract increments `commitments` and the derived `budget_items.committed_amount` for its cost code; reversal decrements.
4. Contingency draw tied to a CO reduces `contingency_ledger.balance` and is reflected in revised budget.
5. EVM regression: `evmFormulas.test.ts` continues to pass; new EAC methods covered by tests with known fixtures (CPI=0.8, SPI=0.9 → composite EAC matches hand calc).
6. Executing a CO updates `revised_amount` and EVM `bac`; re-derived CPI/SPI reflect the new BAC.

**Cost Intelligence:**
7. `GET /cost-intelligence` returns ≥1 ranked driver with non-empty `evidence[]` for a seeded overrun project; the top driver matches the largest variance cost code.
8. Each driver's `cause` is one of the four classified types; no free-text hallucination (deterministic classifier; LLM only narrates).
9. Copilot surfaces the cost-intelligence summary in place of / enriching the current `budgetItem()` heuristic, preserving the cited-why contract.
10. Overrun probability is monotonic in CPI decline on a controlled fixture (lower CPI ⇒ higher probability).

**Non-functional:** RLS on every new table; money in `NUMERIC(18,2)`; all writes audited; pay-app and CO
transitions immutable once past approval.

---

## 8. Phased Build Plan

| Phase | Scope | Verify |
|---|---|---|
| **6a — Commitments + Forecast** | `commitments` + rollup worker; `cost_forecasts` with 4 EAC methods; derive `budget_items.committed_amount`/`forecast_amount` | Commitment & EAC unit tests; budget rollup reflects derived values |
| **6b — Owner Billing** | `prime_contracts` + `sov_lines` + `pay_applications`/`pay_app_lines` + `payments` + `lien_waivers`; G702/G703 endpoints; pay-app state machine | E2E: contract → SOV → 2 pay apps → payment; G702 arithmetic test |
| **6c — Contingency + Claims** | `contingency_ledger` (CO-funded draws), `cost_claims` register | Contingency balance test; CO-to-draw linkage |
| **6d — Cost Intelligence** | drift explainer (deterministic + citations), overrun predictor (Predict ↔ `evm_snapshots`), recovery recommender; Copilot integration | `/cost-intelligence` acceptance tests 7–10; Copilot focus-item snapshot |

Each phase ships behind the existing feature-gate service (`api/services/enterprise/featureGateService.ts`)
and is independently demoable.

# Cost & Commercial Control Spec — Denver Engineering

> Phase 6. Goal: compete with Procore Financials. v1, grounded in `api/db/migrations` (`007` budgets,
> `053/057` EVM, `058` change orders, `061` cost entries) and `api/routes/{budgets,costControl,costEntry,evm,changeOrders,portfolio}`.

## 1. Current state (✅/🟡/❌)
- ✅ **Budgets** — original / approved-change / revised by cost code & WBS (`007`).
- ✅ **Change orders** — pricing → approval → execution with cost + schedule impact (`058`).
- ✅ **Cost entry** — field/actual cost capture (`061`); budget vs committed vs actual.
- ✅ **EVM** — BCWS/BCWP/ACWP, SPI/CPI, EAC/ETC, S-curves (`053`, unique WBS `057`).
- ✅ **Portfolio rollup** — IRR/NPV/MOIC, scenario modeling.
- ❌ **Prime/owner contracts**, **commitments** as first-class, **invoices / pay applications**, **payments**, **claims**, **contingency ledger**.
- ❌ **AI cost intelligence** (drift/overrun/forecast explanations) — Copilot surfaces budget-overrun signal only.

## 2. Target data model (additions)
`contract` (prime/owner; SOV), `commitment` (PO/subcontract financial), `invoice` / `pay_application` (period, retention, stored materials, lien-waiver state), `payment`, `claim`, `contingency_ledger` (draws + restores), `forecast_snapshot`.

## 3. Workflows
- **Budget → Commitment → Cost** chain fully linked to the object graph (cost code ↔ WBS ↔ schedule task ↔ system).
- **Change order lifecycle:** initiate → price → route approvals → execute → roll into revised budget + schedule.
- **Billing:** pay-app generation from SOV + % complete, retention math, owner approval, payment tracking.
- **Forecasting:** EAC by CPI trend (have) + manual overrides + AI-explained drift.

## 4. AI cost intelligence (Phase 6 + 11)
Deterministic variance engine → LLM narration (cited): *"Forecast exceeds budget by 8% driven by CO-014 (steel) and a CPI decline on Area B since week 22."* Overrun signal already feeds the Project Copilot (`budgetItem` in `projectCopilotService`).

## 5. Acceptance criteria
Auditable budget→commitment→cost→billing chain; retention & lien-waiver tracking; EVM matches manual calc on reference dataset (`api/__tests__/evmFormulas.test.ts`); contingency draws reconcile; AI explanations cite source records.

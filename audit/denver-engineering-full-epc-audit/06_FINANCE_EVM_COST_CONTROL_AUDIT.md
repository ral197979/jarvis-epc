# 06 — Finance, EVM & Cost Control Audit

## Modules Covered
- Earned Value Management (EVM)
- Budget Management
- Change Orders
- Cost Control Dashboard
- Cost Entry (Field)
- Timesheets
- Proposals & Bid Pipeline
- Subcontracts (financial view)

---

## Earned Value Management (EVM)

**Frontend:** `src/components/evm/EVMDashboard.tsx` ✅  
**Backend:** `api/routes/evm.ts`, `api/services/evm/evmService.ts` ✅  
**Migration:** `053_evm.sql` ✅  
**RLS:** ✅ (migration 053)

### Formula Validation (ANSI/EIA-748)

| Formula | Implementation | Correct? |
|---|---|---|
| `BCWS (PV)` | Linear spread: `bac × (t−s)/(f−s)` | ✅ |
| `BCWP (EV)` | `bac × percent_complete` | ✅ |
| `ACWP (AC)` | Sum of `evm_actuals.amount` | ✅ |
| `CPI` | `bcwp / acwp` | ✅ |
| `SPI` | `bcwp / bcws` | ✅ |
| `CV` | `bcwp - acwp` | ✅ |
| `SV` | `bcwp - bcws` | ✅ |
| `EAC` | `bac / cpi` | ✅ |
| `ETC` | `eac - acwp` | ✅ |
| `VAC` | `bac - eac` | ✅ |
| `TCPI` | `(bac - bcwp) / (bac - acwp)` | ✅ |

**Assessment:** EVM formulas are correct and ANSI/EIA-748 compliant. Division-by-zero guards present (returns `null` when denominator is 0). `round2()` helper ensures 2 decimal place precision.

**Health Color Coding:**
- `green`: CPI ≥ 0.95 && SPI ≥ 0.95
- `yellow`: CPI ≥ 0.85 || SPI ≥ 0.85
- `red`: otherwise

**Gaps:**
- No EVM baseline freeze/lock enforcement (baseline can be modified after approval)
- No Period of Performance (PoP) validation
- BCWS uses linear spread only — non-linear loading not supported (acceptable for v1)
- S-curve visualization not confirmed in EVMDashboard

### EVM Data Model
```
evm_baselines       → project budget authorization record
evm_wbs_entries     → WBS hierarchy with BAC per element
evm_actuals         → actual cost entries per period
evm_progress        → percent complete per WBS per period
evm_snapshots       → point-in-time EVM snapshot for trending
```

Unique constraint on `(baseline_id, wbs_code)` via migration 057 ✅

---

## Budget Management

**Frontend:** `src/components/BudgetView.tsx` ✅  
**Backend:** `api/routes/budgets.ts` ✅  
**Migration:** `007_pm_modules.sql` — `budgets`, `budget_items` ✅  
**RLS:** ✅ (migration 007)

**Gaps:**
- Budget vs. EVM baseline integration: two separate systems (`budgets` and `evm_baselines`) — not confirmed as synchronized
- No budget approval workflow (draft → approved)
- No fund code / cost account structure

---

## Change Orders

**Frontend:** `src/components/changeOrders/ChangeOrdersView.tsx` ✅  
**Backend:** `api/routes/changeOrders.ts`, `api/services/changeOrders/changeOrderService.ts` ✅  
**Migration:** `058_change_orders.sql` ✅  
**RLS:** **NOT confirmed in migration 058 review** — **P1**

### Business Logic
- Change order CRUD with status workflow
- BAC (Budget at Completion) impact integration with EVM
- `changeOrderService.ts` manages budget impact calculation

**Gaps:**
- Change order approval workflow (draft → submitted → approved) — transitions not verified as server-enforced
- No automatic EVM BAC update on CO approval (manual re-baseline implied)
- No cost code allocation on COs
- Potential RLS gap on `change_orders` table in migration 058

---

## Cost Control Dashboard

**Frontend:** `src/components/costControl/CostControlDashboard.tsx` ✅  
**Backend:** `api/routes/costControl.ts`, `api/services/costControl/costControlService.ts` ✅  
**Migration:** `052_cost_db_seed.sql` (seed), `061_cost_entries.sql` ✅

**Assessment:** Dashboard aggregates cost data across budgets, actuals, change orders, and EVM. Provides CPI/SPI trend view. Appears to be a rollup view.

**Gaps:**
- Real-time cost data refresh rate unclear
- No confirmed WBS/cost code drill-down
- RLS not confirmed on `cost_entries` table (**P1**)

---

## Field Cost Entry

**Frontend:** `src/components/costEntry/CostEntryView.tsx` ✅  
**Backend:** `api/routes/costEntry.ts`, `api/services/costEntry/costEntryService.ts` ✅  
**Migration:** `061_cost_entries.sql` ✅

**Gaps:**
- Offline cost entry (important for field use) — offline queue module exists but integration point not confirmed
- No GPS location capture on cost entries
- Approval workflow for field entries not confirmed
- RLS on cost_entries not confirmed (**P1**)

---

## Timesheets

**Frontend:** `src/components/timesheets/TimesheetsView.tsx` ✅  
**Backend:** `api/routes/timesheets.ts` ✅  
**Migration:** `065_timesheets.sql` ✅  
**RLS:** **NOT confirmed** — **P1**

**Business Logic Expected:**
- Daily timesheet entry per employee
- Approval workflow (employee → supervisor → payroll)
- WBS/cost code allocation
- Overtime calculation

**Gaps:**
- Approval workflow not confirmed
- Integration with payroll systems not implemented
- RLS on timesheets/timesheet_entries not confirmed (**P1**)

---

## Proposals & Bid Pipeline

**Frontend:** `src/components/proposals/ProposalsView.tsx` ✅  
**Backend:** `api/routes/proposals.ts` ✅  
**Migration:** `062_proposals.sql` ✅  
**RLS:** **NOT confirmed** — **P2**

**Assessment:** CRM-side module for tracking bid opportunities. Connected to `CRMView` and `CRMLeads`.

**Gaps:**
- Win/loss analysis not confirmed
- No CPM/schedule integration for bid proposal delivery dates
- No bid package generation (export to PDF)

---

## Risk Summary

| Module | Finding | Severity |
|---|---|---|
| Change Orders | RLS not confirmed on migration 058 | P1 |
| Cost Control | RLS not confirmed on cost_entries | P1 |
| Timesheets | RLS not confirmed on timesheets | P1 |
| EVM | Baseline lock not enforced | P2 |
| Budget | No sync with EVM baselines | P2 |
| Field Cost Entry | Offline integration not confirmed | P2 |
| All Finance | Viewer role can read financial data | P2 |
| Proposals | RLS not confirmed | P2 |
| EVM | S-curve visualization not confirmed | P3 |

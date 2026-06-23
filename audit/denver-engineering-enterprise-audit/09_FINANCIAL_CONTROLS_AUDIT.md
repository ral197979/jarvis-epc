# 09 — FINANCIAL CONTROLS AUDIT

---

## Overview

Financial controls cover: budget management, change order workflow, EVM (Earned Value Management), cost control snapshots, proposals, subcontracts, and bid packages.

---

## Budget Module

**Implementation:** `api/routes/budgets.ts` (verified)

```
GET  /api/v1/projects/:projectId/budget       — fetch budget (one per project)
POST /api/v1/projects/:projectId/budget       — create/baseline (upserts on conflict)
PATCH /api/v1/budgets/:id                     — update metadata
GET/POST /api/v1/budgets/:id/items            — budget line items (cost codes)
PATCH /api/v1/budget-items/:itemId            — update line item
DELETE /api/v1/budget-items/:itemId           — remove line item
GET /api/v1/projects/:projectId/budget/rollup — aggregate by cost code
```

**Data model:**
- One budget per project (`UNIQUE (tenant_id, project_id)`)
- Budget line items with cost_code, original_amount, committed_amount, expended_amount
- Currency field (defaults to USD)
- Created_by tracked for audit

**Assessment:** Functional budget baseline. The ON CONFLICT upsert means budget creation is idempotent. No multi-currency conversion. No budget versioning (creating a revised budget overwrites). **Grade: B**

---

## Change Order Management

**Implementation:** `api/routes/changeOrders.ts` + `api/routes/budgets.ts` (lines 200+)

```
GET  /api/v1/projects/:projectId/change-orders
POST /api/v1/projects/:projectId/change-orders
PATCH /api/v1/change-orders/:id
```

**Workflow states:** `pending → approved/rejected → executed`

**Integration:** Change orders link to `budget_id` and can update the budget on approval. `createAction()` called on creation for workflow integration.

**Missing:** No automated budget rollup on change order approval. The route accepts a PATCH to update status but doesn't atomically update budget line items in the same transaction.

**Risk:** Race condition — two concurrent approvals of competing change orders could both update the budget without conflict detection.

**Grade: B-**

---

## Earned Value Management (EVM)

**Implementation:** `api/services/evm/evmService.ts` + `api/routes/evm.ts`

**Standard:** ANSI/EIA-748 compliant (verified from service comments)

### Formula Verification

```typescript
// BCWS (Planned Value): linear spread across planned_start → planned_finish
// BCWP (Earned Value): BAC × percent_complete (latest per WBS entry)
// ACWP (Actual Cost): sum of evm_actuals up to status_date

// Derived metrics (verified):
// CPI = BCWP / ACWP           (cost efficiency)
// SPI = BCWP / BCWS           (schedule efficiency)
// CV  = BCWP - ACWP           (cost variance)
// SV  = BCWP - BCWS           (schedule variance)
// EAC = BAC / CPI             (estimate at completion)
// ETC = EAC - ACWP            (estimate to complete)
// VAC = BAC - EAC             (variance at completion)
// TCPI = (BAC-BCWP)/(BAC-ACWP) (to-complete performance index)
```

**Health classification:**
```typescript
health: acwp > 0 && cpi !== null && spi !== null
  ? (cpi >= 0.9 && spi >= 0.9 ? 'green' : cpi >= 0.75 || spi >= 0.75 ? 'yellow' : 'red')
  : 'green'
```

**S-Curve:** `getScurveData()` returns time-series snapshots for cumulative BCWS/BCWP/ACWP — supports S-curve chart rendering.

**Snapshot system:** `takeSnapshot()` persists current metrics to `evm_snapshots` — preserves historical periods without recalculation.

### EVM Data Quality Risks

| Risk | Detail |
|------|--------|
| No baseline lock | Baseline can be updated after tracking begins — corrupts historical CPI |
| BCWS spread is linear | Does not support non-linear spending curves (typical in construction) |
| Percent complete is manual | No link to inspection completions or milestone achievement |
| No WBS roll-up | Metrics computed at WBS entry level; no automatic parent roll-up |
| No earned value technique | Only "percent complete" method; no 0/100, Milestone, or LOE |

**Grade: A- (formulas correct; data quality depends on user discipline)**

---

## Cost Control Module

**Implementation:** `api/services/costControl/costControlService.ts` + `api/routes/costControl.ts`

**What it returns:** A snapshot aggregating budget, committed costs, actual costs, and forecast.

```
GET /api/v1/projects/:projectId/cost-control
```

**Assessment:** Single-endpoint snapshot — clean interface. Depends on budget and EVM data quality.

**Grade: B+**

---

## Proposals

**Implementation:** `api/routes/proposals.ts` (verified from migration 070)

```
GET/POST  /api/v1/proposals
PATCH     /api/v1/proposals/:id
GET/POST  /api/v1/proposals/:id/line-items
```

**Data model:**
- `proposals` table: project_id, title, status, total_amount
- `proposal_line_items`: description, quantity, unit_price, amount

**Status lifecycle:** draft → submitted → approved/rejected

**Grade: B**

---

## Subcontracts

**Implementation:** `api/routes/subcontracts.ts` (verified from migration 070)

**Features:**
- Subcontract register linked to vendor and project
- Scope of work, contract value, retainage terms
- Status workflow

**Missing:** No payment application / progress billing for subcontractors (compare to Procore's Subcontractor Invoicing).

**Grade: B-**

---

## Bid Packages

**Implementation:** `api/routes/procurement.ts` + `bid_packages` table (migration 070)

**Features:**
- Bid package creation with invite list
- Status: draft → issued → bid_received → awarded → closed
- Vendor selection

**Missing:** No bid leveling (comparison matrix), no addendum tracking.

**Grade: C+**

---

## Timesheets

**Implementation:** `api/routes/timesheets.ts` + tables in migration 070

```
GET/POST  /api/v1/timesheets
POST      /api/v1/timesheets/:id/submit
POST      /api/v1/timesheets/:id/approve
GET/POST  /api/v1/timesheets/:id/entries
```

**Features:**
- Timesheet → timesheet_entries (per day, per cost code)
- Submit → approve workflow
- Labor cost linked to budget via cost codes

**Grade: B+**

---

## Cost Entry / Cost Codes

**Implementation:** `api/routes/costEntry.ts`

**Features:** Direct cost entries against projects with cost code classification, period tracking.

**Grade: B**

---

## Financial Controls Summary

| Module | Implementation | Grade | Key Gap |
|--------|---------------|-------|---------|
| Budget | Real | B | No versioning; no multi-currency |
| Change Orders | Real | B- | No atomic budget update on approval |
| EVM (ANSI/EIA-748) | Real — correct formulas | A- | Linear BCWS; no roll-up |
| Cost Control | Real | B+ | Depends on EVM data quality |
| Proposals | Real | B | No e-signature |
| Subcontracts | Real | B- | No payment applications |
| Bid Packages | Real | C+ | No bid leveling |
| Timesheets | Real | B+ | No overtime rules |
| Invoicing | ❌ Missing | F | No AP/AR functionality |
| Multi-currency | ❌ Missing | N/A | Single currency only |

**Financial Controls Score: 74/100**

**Critical gap:** No accounts payable / receivable. No invoice management. A general contractor managing $50M+ projects will need these before replacing Procore Financials.

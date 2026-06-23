# Procurement — Build-Ready Specification

**Phase 7 · Procurement** · Denver Engineering — the AI-native project operating system
(understands → predicts → decides)

> Positioning: parity with Procore's bidding / commitments / PO surface, then surpass it with a
> **Procurement Risk Engine** that *predicts* late equipment, supply-chain risk, and delivery blockers from
> PO lead times, vendor history, and schedule dependencies — feeding the Coordination and Project Copilots in
> [AI Project Intelligence](AI_PROJECT_INTELLIGENCE_SPEC.md).

Cross-links: [Domain Model](DOMAIN_MODEL.md) · [Cost & Commercial Control](COST_CONTROL_SPEC.md) ·
[AI Project Intelligence](AI_PROJECT_INTELLIGENCE_SPEC.md) · [Mobile Field Execution](MOBILE_FIELD_EXECUTION_SPEC.md) ·
[Features](FEATURES.md)

Legend: ✅ shipped · 🟡 partial / shell · ❌ not built · ⚠️ caveat

---

## 1. Current State (grounded in the codebase)

### 1.1 What exists today

| Capability | Status | Evidence (real files / tables / routes) |
|---|---|---|
| **Vendor directory** — code, type, status lifecycle, rating, categories[], approval | ✅ | `vendors` + `vendor_status` enum (`prospect, qualified, approved, preferred, suspended, blacklisted`) — `api/db/migrations/002_epc_core.sql:77,14`; routes in `api/routes/procurement.ts` (VENDORS section, `procurement.ts:34`) — `GET /` `GET /:id` `POST /` `PATCH /:id` |
| **Contracts** (vendor-facing header) | ✅ | `contracts` + `contract_status` enum — `002_epc_core.sql:118,13` |
| **Purchase orders** — line_items (JSONB), subtotal/tax/total, received_amount, required/issued/delivery dates, approval | ✅ | `purchase_orders` + `po_status` enum (`draft, pending_approval, approved, issued, partial_delivery, delivered, invoiced, closed, cancelled`) — `002_epc_core.sql:161,15`; routes `procurement.ts` (PURCHASE ORDERS, `procurement.ts:136`) incl. `POST /:id/approve` |
| **Bid packages** — number, scope, CSI code, budget_amount, bid_due_date, status lifecycle | ✅ | `bid_packages` + `bid_pkg_status` enum (`draft, issued, closed, awarded, cancelled`) — `059_subcontracts.sql:42,18`; service `api/services/procurement/subcontractService.ts` (`createBidPackage`/`issueBidPackage`/`closeBidPackage`/`cancelBidPackage`); routes `api/routes/subcontracts.ts` (`subcontracts.ts:58`) |
| **Bid submissions** — vendor_id, bid_amount, notes, reviewed_at; one per vendor per package | ✅ | `bid_submissions` + `bid_sub_status` enum (`pending, accepted, declined, withdrawn`) — `059_subcontracts.sql:72,24`; `submitBid`/`listBidSubmissions` |
| **Bid award** → subcontract | ✅ | `awardBid()` in `subcontractService.ts:213`; `subcontracts` table + `subcontract_status` enum (`active, suspended, complete, terminated`) — `059_subcontracts.sql:97,30`; retention_pct, contract_value |
| **Subcontract invoices** — period, gross/retention/net, review | ✅ | `subcontract_invoices` + `sc_invoice_status` enum (`draft, submitted, approved, rejected`) — `059_subcontracts.sql:129,36`; routes `subcontracts.ts:193` |
| **RFIs & Submittals** (procurement-adjacent) | ✅ | `rfis` — `002_epc_core.sql:206`; routes `procurement.ts` (RFIs `:260`, SUBMITTALS `:338`) |
| **Copilot procurement signal** — overdue submittal review flagged with `impacts:['schedule','procurement']` | ✅ | `submittalItem()` in `api/services/copilot/projectCopilotService.ts:163` ("Assign a reviewer to keep procurement on track.") |

### 1.2 Bid-package lifecycle as implemented (authoritative)

From `subcontractService.ts` (guards via `WHERE status=…`):
```
draft ──issue──▶ issued ──close──▶ closed ──award──▶ awarded
  │                 │                 │
  └─────────────────┴─────────────────┴──cancel──▶ cancelled   (from draft|issued|closed)
award: creates a subcontracts row from the winning bid_submission (links bid_package_id + bid_submission_id)
```
PO lifecycle is the richer `po_status` enum above (`draft → pending_approval → approved → issued →
partial_delivery → delivered → invoiced → closed`, plus `cancelled`).

### 1.3 Honest gaps vs. best-in-class procurement

| Missing capability | Status | Why it matters |
|---|---|---|
| **Formal tendering** — invite list, RFQ issuance, clarifications/addenda, scope/bid leveling sheet, sealed-bid open | 🟡 | Bid packages + submissions exist but there is no **invite list**, no addenda/clarification thread, no **leveling/normalization** (apples-to-apples comparison adjusting for inclusions/exclusions). |
| **Vendor evaluation scoring** — weighted multi-criteria (price, schedule, quality, safety, financial) with history | ❌ | `vendors.rating` is a single 0–5 scalar; no criteria, no per-project scorecards, no learned history. |
| **Material / equipment tracking & expediting** — line-item delivery status, submittal-to-fab-to-ship-to-site chain, expedite events | 🟡 | PO `line_items` are an opaque JSONB blob; `received_amount` is a scalar. No per-item delivery status, no expedite log, no stored-materials link to billing. |
| **Long-lead ↔ critical-path linkage** | ❌ | No table links a PO/material to a `schedule_task`; lead-time slip cannot propagate to the schedule. |
| **Procurement Risk Engine** — predict late equipment / supply-chain risk / blockers | ❌ | Nothing predicts delivery risk; the only procurement signal is the overdue-submittal heuristic. |

---

## 2. Target Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │          PROCUREMENT RISK ENGINE (AI)         │
                       │  late-equipment predictor · supply-chain risk │
                       │  · blocker detector · need-date breach alert  │
                       └──────────────▲────────────────▲───────────────┘
                                      │                 │ feeds
   ┌─────────┐  ┌──────────┐  ┌───────┴──────┐  ┌──────┴────────┐  ┌─────────────┐
   │ Tender  │→ │  Bid     │→ │   Award →     │→ │  PO + Material │→ │  Delivery + │
   │ (RFQ +  │  │ leveling │  │ Subcontract / │  │  line items +  │  │  expediting │
   │ invites)│  │ + eval   │  │ Commitment    │  │  lead times    │  │  + receipt  │
   └─────────┘  └──────────┘  └──────┬────────┘  └──────┬─────────┘  └──────┬──────┘
                                     │ commitment        │ long-lead         │ slip
                                     ▼                   ▼                   ▼
                        [Cost: commitments ledger]  [Schedule: task link]  [Copilot signal]
```

Award creates a **commitment** in [Cost Control](COST_CONTROL_SPEC.md) (§3.2). Material lead times link to
`schedule_tasks` so a delivery slip propagates to the critical path and surfaces in the Coordination Copilot.

---

## 3. Data Model (new + extended entities)

> Repo conventions: `UUID` PKs (`gen_random_uuid()`), `tenant_id`/`project_id` per row, RLS via
> `current_setting('app.current_tenant_id', true)::uuid`, `NUMERIC(18,2)` money, `*_status` enums,
> `created_at`/`updated_at` + `set_updated_at()`.

### 3.1 Tendering

**`bid_invites`** (who was asked to bid)
| field | type | notes |
|---|---|---|
| id, tenant_id, bid_package_id | UUID FK | |
| vendor_id | UUID FK → vendors | |
| status | `bid_invite_status` enum: `invited, viewed, intends_to_bid, declined, submitted` | |
| invited_at, responded_at | TIMESTAMPTZ | |

**`bid_addenda`** (clarifications / scope changes during tender)
| field | type | notes |
|---|---|---|
| id, tenant_id, bid_package_id | UUID FK | |
| addendum_number | INTEGER | auto-seq per package |
| description | TEXT | |
| document_id | UUID FK → documents | |
| issued_at | TIMESTAMPTZ | |

**`bid_leveling`** (normalized comparison line, per submission per scope item)
| field | type | notes |
|---|---|---|
| id, tenant_id, bid_package_id, bid_submission_id | UUID FK | |
| scope_item | TEXT | |
| raw_amount | NUMERIC(18,2) | as bid |
| adjustment | NUMERIC(18,2) | leveling add/deduct for exclusions |
| leveled_amount | NUMERIC(18,2) | raw + adjustment |
| inclusion | BOOLEAN | covered in this bid? |
| notes | TEXT | |

### 3.2 Vendor evaluation scoring

**`vendor_evaluations`** (per vendor, optionally per project / per bid)
| field | type | notes |
|---|---|---|
| id, tenant_id, vendor_id | UUID FK | |
| project_id, bid_submission_id | UUID FK | nullable |
| evaluator_id | UUID FK → users | |
| overall_score | NUMERIC(5,2) | weighted 0–100 (computed) |
| status | enum: `draft, final` | |
| created_at | TIMESTAMPTZ | |

**`vendor_evaluation_criteria`** (the weighted breakdown)
| field | type | notes |
|---|---|---|
| id, tenant_id, vendor_evaluation_id | UUID FK | |
| criterion | enum: `price, schedule, quality, safety, financial_health, past_performance` | |
| weight | NUMERIC(5,2) | Σ weights = 100 per evaluation |
| raw_score | NUMERIC(5,2) | 0–100 |
| weighted_score | NUMERIC(5,2) | = weight/100 × raw_score (cached) |

`overall_score = Σ weighted_score`. Feeds award decisions and updates a rolling `vendors.rating`
(derived, not the manual scalar).

### 3.3 Material / equipment tracking & expediting

**`material_items`** (PO line items promoted from JSONB to first-class rows)
| field | type | notes |
|---|---|---|
| id, tenant_id, project_id | | |
| purchase_order_id | UUID FK → purchase_orders | |
| schedule_task_id | UUID FK → schedule_tasks | **long-lead ↔ critical-path link** (nullable) |
| description | TEXT | |
| cost_code | VARCHAR(40) | join to budget / commitment |
| quantity, unit | NUMERIC / TEXT | |
| unit_cost, line_total | NUMERIC(18,2) | |
| lead_time_days | INTEGER | quoted lead time |
| required_on_site_date | DATE | the **need date** (often inherited from schedule_task) |
| promised_delivery_date | DATE | vendor's commitment |
| forecast_delivery_date | DATE | risk-adjusted (engine output) |
| status | `material_status` enum: `not_started, submittal, approved_for_fab, in_fabrication, shipped, on_site, installed, rejected` | |
| is_long_lead | BOOLEAN | flagged when lead_time_days ≥ threshold |

**`expedite_events`** (the expediting log)
| field | type | notes |
|---|---|---|
| id, tenant_id, material_item_id | UUID FK | |
| event_type | enum: `status_change, delay_reported, expedite_request, vendor_update, receipt` | |
| from_status, to_status | TEXT | for status_change |
| delay_days | INTEGER | reported slip (signed) |
| note | TEXT | |
| occurred_at, created_by | TIMESTAMPTZ / UUID | |

### 3.4 Procurement risk (engine output, persisted)

**`procurement_risks`**
| field | type | notes |
|---|---|---|
| id, tenant_id, project_id | | |
| material_item_id | UUID FK | nullable (PO-level risk) |
| risk_type | enum: `late_delivery, supply_chain, vendor_capacity, missing_submittal, need_date_breach` | |
| probability | NUMERIC(5,2) | 0–1 |
| projected_slip_days | INTEGER | forecast − promised |
| impacts_critical_path | BOOLEAN | true if linked task on CP / low float |
| drivers | JSONB | cited inputs (lead time, vendor history, float) |
| status | enum: `open, mitigated, resolved, false_positive` | mirrors portfolio anomaly pattern |
| detected_at | TIMESTAMPTZ | |

---

## 4. API Contracts

Base: `/api/v1`. Extends `api/routes/{procurement,subcontracts}.ts`.

### 4.1 Tendering
```
POST   /bid-packages/:id/invites          → add vendors to invite list
GET    /bid-packages/:id/invites
POST   /bid-packages/:id/addenda          → issue addendum
GET    /bid-packages/:id/leveling         → normalized comparison matrix (submissions × scope)
PATCH  /bid-leveling/:id                   → set adjustment / inclusion
```

### 4.2 Vendor evaluation
```
POST   /vendors/:id/evaluations           → create scorecard {projectId?, bidSubmissionId?, criteria[]}
GET    /vendors/:id/evaluations
GET    /bid-packages/:id/award-recommendation  → ranked vendors: leveled price + eval score
```

### 4.3 Material tracking & expediting
```
POST   /purchase-orders/:id/materials      → promote line items to material_items
GET    /projects/:projectId/materials      → ?status= &longLeadOnly=true
PATCH  /materials/:id/status   {toStatus, note}      → logs expedite_event
POST   /materials/:id/expedite {delayDays, note}     → logs delay/expedite
POST   /materials/:id/link-task {scheduleTaskId}     → long-lead ↔ critical-path link
GET    /materials/:id/timeline             → expedite_events history
```

### 4.4 Procurement Risk Engine
```
GET    /projects/:projectId/procurement-risk         → ranked risks + drivers
POST   /projects/:projectId/procurement-risk/detect   → run engine (idempotent per as-of)
POST   /procurement-risks/:id/resolve
POST   /procurement-risks/:id/false-positive
```

**`GET /procurement-risk` response shape** (mirrors portfolio anomaly + Copilot `FocusItem` patterns)
```jsonc
{
  "projectId": "…",
  "asOf": "2026-06-22",
  "risks": [
    {
      "materialItemId": "…",
      "reference": "PO-118 / Switchgear",
      "riskType": "late_delivery",
      "probability": 0.71,
      "projectedSlipDays": 12,
      "impactsCriticalPath": true,
      "why": "Promised 2026-09-10 vs need 2026-09-01; vendor avg 9-day slip over 4 prior POs; task SS-220 float 3d.",
      "drivers": [
        { "factor": "vendor_history",   "value": "+9d avg slip", "evidence": ["purchase_orders:…","expedite_events:…"] },
        { "factor": "lead_time_buffer", "value": "-9d vs need",   "evidence": ["material_items:…"] },
        { "factor": "schedule_float",   "value": "3d",            "evidence": ["schedule_tasks:…"] }
      ],
      "recommendedAction": "Expedite switchgear or re-sequence SS-220; alert PM."
    }
  ]
}
```

---

## 5. Bid → Award → PO → Delivery Workflow

```
1. TENDER     bid_package(draft) → invites → issue → vendors view/bid → addenda as needed → close
2. LEVEL      normalize submissions (bid_leveling) → apples-to-apples leveled_amount
3. EVALUATE   vendor_evaluations (weighted criteria) → award-recommendation = f(leveled price, eval score)
4. AWARD      awardBid() → subcontracts row  ──creates──▶ commitment  (Cost Control §3.2)
5. PO         issue purchase_orders → promote line_items to material_items → set lead_time, need_date
6. LINK       material_item.schedule_task_id ← long-lead items bound to critical-path tasks
7. EXPEDITE   status chain: submittal → approved_for_fab → in_fabrication → shipped → on_site → installed
              each transition logs expedite_event; delays update forecast_delivery_date
8. RISK       Procurement Risk Engine continuously scores slip vs need date + critical-path impact
9. RECEIPT    on_site receipt → PO received_amount + stored-materials value to billing (Cost Control)
```

**Lifecycles**
- Bid package: `draft → issued → closed → awarded` (+ `cancelled`) — **live** (`subcontractService.ts`).
- PO: `draft → pending_approval → approved → issued → partial_delivery → delivered → invoiced → closed` (+ `cancelled`) — **live** (`po_status`).
- Material item: `not_started → submittal → approved_for_fab → in_fabrication → shipped → on_site → installed` (+ `rejected`) — **new**.

---

## 6. Procurement Risk Engine (the differentiator)

> Predict **late equipment**, **supply-chain risk**, and **delivery blockers** before the need date —
> deterministic-first, learned later, always explainable.

### 6.1 Inputs (all from real tables)
- **Lead-time buffer** — `promised_delivery_date` (or `forecast`) vs `required_on_site_date` (need date).
- **Vendor history** — average historical slip = mean(`delivery_date − required_date`) across that vendor's
  prior `purchase_orders` + `expedite_events`.
- **Status lag** — current `material_status` vs expected status for elapsed lead time (e.g. still in
  `submittal` with 30% of lead time gone).
- **Schedule float** — float of the linked `schedule_task_id` (from the schedule/CPM module).

### 6.2 Scoring (deterministic baseline)
```
forecast_delivery = promised_delivery + vendor_avg_slip + status_lag_penalty
projected_slip    = forecast_delivery − required_on_site_date
probability       = logistic( w1·slip_ratio + w2·vendor_slip_z + w3·status_lag − w4·float )
impacts_critical_path = (linked task float ≤ projected_slip)
```
A material is a **blocker** when `projected_slip > 0` and `impacts_critical_path`. Honest status: the learned
model is **🟡 to build** (home in `api/services/predict/`, see [Features](FEATURES.md) "schedule-delay
probability, anomaly detection"); v1 ships the deterministic formula above. The detect/resolve/false-positive
lifecycle mirrors the existing portfolio anomaly endpoints (`api/routes/portfolio.ts` `/anomalies`).

### 6.3 Outputs & Copilot integration
Each risk emits drivers with `evidence: [table:id]` and a `why` string, surfaced as a Copilot `FocusItem`
with `impacts:['schedule','procurement']` — the exact contract `submittalItem()` already uses
(`projectCopilotService.ts:163`). Need-date breaches on the critical path escalate to the
**Coordination Copilot** as cross-module actions (re-sequence / expedite).

---

## 7. Acceptance Criteria

**Parity:**
1. Full bid→award→PO→delivery chain is auditable end to end; award creates exactly one `commitment` (Cost Control §3.2) and one `subcontracts` row.
2. Bid leveling produces an apples-to-apples matrix; `leveled_amount = raw + adjustment`; award-recommendation ranks by leveled price + eval score.
3. Vendor evaluation: `Σ weight = 100` enforced; `overall_score = Σ weighted_score`; two evaluators on the same vendor produce reproducible scores from the same inputs.
4. PO line items promote to `material_items`; status chain transitions each log an `expedite_event`; `material status` is immutable history (append-only log).

**Risk Engine:**
5. A long-lead material with `promised − need > 0` and linked to a low-float critical-path task is flagged `late_delivery` with `impacts_critical_path=true` **before** the need date.
6. Every risk carries ≥1 driver with non-empty `evidence[]`; `why` cites promised vs need date and vendor history (no hallucinated numbers — deterministic computation, LLM narrates only).
7. Probability is monotonic in slip: increasing `projected_slip` on a fixture increases `probability`.
8. Resolving / false-positiving a risk follows the portfolio-anomaly lifecycle and is audited.
9. A critical-path delivery risk surfaces as a Copilot `FocusItem` with `impacts:['schedule','procurement']`.

**Non-functional:** RLS on every new table; money in `NUMERIC(18,2)`; all status transitions guarded and audited; engine `detect` idempotent per as-of date.

---

## 8. Phased Build Plan

| Phase | Scope | Verify |
|---|---|---|
| **7a — Tendering + Leveling** | `bid_invites`, `bid_addenda`, `bid_leveling`; invite/addenda/leveling endpoints | E2E: invite 3 vendors → 3 bids → leveled matrix; leveling arithmetic test |
| **7b — Vendor Evaluation** | `vendor_evaluations` + `vendor_evaluation_criteria`; award-recommendation; derived `vendors.rating` | Weighted-score test; reproducibility test |
| **7c — Material Tracking & Expediting** | `material_items` (promote PO JSONB), `expedite_events`, schedule_task link; status state machine | Status-chain test; long-lead↔task link test; receipt → Cost Control stored-materials |
| **7d — Procurement Risk Engine** | deterministic late-delivery / blocker scorer; `procurement_risks` + detect/resolve lifecycle; Copilot integration | Acceptance tests 5–9; Copilot focus-item snapshot |

Each phase ships behind the existing feature-gate service (`api/services/enterprise/featureGateService.ts`)
and is independently demoable.

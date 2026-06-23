# Procurement Spec — Denver Engineering

> Phase 7. v1, grounded in `api/routes/{procurement,subcontracts}`, `059_subcontracts`, vendor/PO services.

## 1. Current state
- ✅ Vendor directory, **subcontracts** (`059`), bid packages, bid comparison, award, schedule of values.
- ✅ Purchase orders (`/api/v1/purchase-orders`).
- 🟡 Material tracking / expediting — partial.
- ❌ Tendering workflow, formal vendor evaluation scoring, **procurement risk engine**.

## 2. Target data model (additions)
`bid_package`, `tender` (invite → bid → clarification → award), `vendor_evaluation` (weighted criteria, history), `purchase_order` (line items, delivery milestones), `material_item` (tracking + status), `expedite_event`, `procurement_risk` (predicted).

## 3. Workflows
- **Bid → Award:** package scope, invite vendors, collect bids, normalize/compare, evaluate, award → commitment (links to Cost spec).
- **PO → Delivery:** issue PO, track material status, expedite, receive, link to schedule task (long-lead items drive critical path).
- **Long-lead management:** equipment lead times feed schedule + Coordination Copilot (procurement blockers).

## 4. Procurement Risk Engine (Phase 7 + 11)
Predict **late equipment**, **supply-chain risk**, **procurement blockers** from PO lead times, vendor history, and schedule dependencies. Feeds Coordination Copilot and Project Copilot risk signals. Deterministic lead-time/slack model first; learned models as data accumulates.

## 5. Acceptance criteria
Auditable bid→award→PO→delivery chain; long-lead items linked to schedule + Copilot; vendor evaluations reproducible; predicted-late equipment flagged before the need date with explanation.

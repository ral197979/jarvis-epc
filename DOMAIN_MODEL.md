# Domain Model — Denver Engineering

> v1, grounded in `api/db/migrations/*`. Entities below are **real tables** unless marked
> *(planned)*. The goal: every object AI-understandable, -searchable, -connected, -actionable.

---

## 1. Core / tenancy

- **tenant** (`tenants`) — org boundary; `max_users`, plan. Root of all RLS.
- **user** (`users`) — `email`, `display_name`, `role`, `is_active`, `password_hash` (SSO users get an unusable bcrypt hash). RBAC roles: owner, admin, project_manager, engineer, viewer.
- **scim_token** (`074`) / SAML config (`073`) — enterprise identity.
- **audit entry** — append-only action log (read API at `/api/v1/audit`).

## 2. Project structure (Phase 1)

- **project** (`projects`, mig 002) — `code`, `name`, `client_name`, `status`, `current_phase`, `contract_type`, `currency`, `budget`, `committed_cost`, `actual_cost`, `forecast_cost`, `contingency_pct`, `planned_start/finish`, `actual_start/finish`, `progress_pct`, `project_manager`, `lead_engineer`.
- **company / vendor** — owners, contractors, subcontractors, consultants, vendors (vendors + subcontracts).
- *(planned)* explicit **organization**, **location**, **WBS** as first-class entities (WBS partially via `wbs_code` on schedule tasks & EVM).
- **milestone / phase** — via `current_phase` + schedule milestones (`is_milestone`).

## 3. Document control (Phase 2)

- **drawing** (`drawings`) + revisions + markups; discipline, sheet number, IFC tracking.
- **bim_model** + coordination issues (`050`).
- **transmittal** (`051`/`069`) — formal issue/response, counters under RLS.
- *(planned)* **document** with superseded chains, **distribution_list**, **controlled_copy**, version-compare/overlay; **AI drawing intelligence** (equipment/tag/room/system extraction) and **spec intelligence** (testing/submittal/closeout requirement extraction).

## 4. Coordination (Phases 3–4)

- **rfi** (`rfis`, mig 002) — `rfi_number`, `title`, `status` (open/pending/answered/closed), `priority`, `discipline`, `assigned_to`, `due_date`, `response`, `responded_at`, `closed_at`.
- **submittal** (`submittals`) — `submittal_number`, `type`, `status` (draft→submitted→under_review→approved/approved_as_noted/revise_resubmit/rejected), `spec_section`, `reviewed_by`, `due_date`.
- *(planned)* **submittal_package**, **reviewer_chain**, RFI/submittal ↔ drawing/spec/system links for impact analysis.

## 5. Schedule (Phase 5)

- **schedule_task** (`014`) — `name`, `wbs_code`, `duration_days`, `is_milestone`, `actual_start/finish`, `status`; relationships/constraints for CPM.
- **baseline** (baselines routes) — planned snapshots.
- *(planned)* **monte_carlo_run** (route exists), **recovery_plan**, **critical_path_segment** with explainability.

## 6. Cost & commercial (Phase 6)

- **budget / budget_line** (`007`) — original/approved-change/revised by cost code & WBS.
- **change_order** (`058`) — pricing→approval→execution, cost+schedule impact.
- **cost_entry** (`061`) — field/actual costs.
- **evm** (`053`/`057`) — BCWS/BCWP/ACWP, SPI/CPI, EAC/ETC, S-curves.
- *(planned)* **contract** (prime/owner), **commitment**, **invoice / pay_application**, **payment**, **claim**, **contingency_ledger**, AI cost-drift explanations.

## 7. Procurement (Phase 7)

- **subcontract** (`059`), **vendor**, **purchase_order**, bid packages/comparison.
- *(planned)* **tender**, **vendor_evaluation**, **material_tracking**, **expediting**, procurement-risk predictions.

## 8. Field & quality & safety (Phases 8–10)

- **daily_log** (`dailyLogs`) — weather, crew, equipment, delay/safety flags.
- **inspection** (`008`) — template-driven checklist, pass/fail/na counts, `overall_result`, signatures, photos.
- **punch_list / punch_item** (`008`) — location, discipline, priority, `due_date`, drawing pin, verify/close stamps; **`punch_item.punch_list_id`** powers Copilot deep-linking.
- **deficiency** (`testResults`/deficiencies) — test-traced.
- **commissioning** item/pack — Cx workflow (note: Cx is supported but the product is *not* a commissioning platform).
- *(planned)* **NCR**, **corrective_action (CAPA)**, **root_cause**; **safety**: observation, incident, near_miss, permit, JSA, toolbox_talk (Phase 10 — currently absent).

## 9. Workflow & intelligence (Phases 11–12)

- **action** (`029`) — the cross-module work item: `action_type`, `source_module`, `source_id`, `priority`, `status`, `assigned_to`, `due_at`, SLA rules, escalations, relationships (blocks/caused_by/spawned_from). This is the spine that makes objects **AI-actionable**.
- **focus_item** *(derived, not stored)* — produced by the Project Copilot from RFIs/submittals/risks/inspections/punch/actions/cost/schedule with score + reason + recommended action + deep-link.
- **risk** (`066`/`067`) — probability×impact, residual, cost_exposure, mitigation/contingency, target_date.
- **knowledge chunk** (`071_pgvector`) — embedded docs for RAG; citations.
- *(planned)* **decision_log** (immutable), **recommendation**, **autonomous_action** (with approval state) for Phase 12.

## 10. The object graph (AI-connectedness)

Target invariant: any object can traverse to its related objects so AI can compute impact:

```
spec ─ defines ─> submittal_requirement ─> submittal
drawing ─ referenced_by ─> rfi ─ affects ─> system ─ scheduled_by ─> schedule_task ─ costs ─> cost_code
risk ─ threatens ─> milestone ;  inspection ─ verifies ─> system ;  punch_item ─ blocks ─> closeout
```

Today these links are partial (`geo_links`, knowledge-graph services, `action.source_module/source_id`). **Unifying them into one queryable graph is the key enabler for Phase 11/12** and is the highest-leverage data-model investment.

## 11. Cross-cutting fields

Every tenant table carries `tenant_id` (RLS), `created_at`, `updated_at`, and most carry `created_by`. Numeric money is `NUMERIC`; enums (status/priority/role) are Postgres enums where stable. UUID PKs throughout.

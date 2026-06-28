# Commissioning Extraction Plan — Denver as Orchestration Layer

**Status:** PLAN ONLY — no code changes yet.
**Goal:** Make Denver_Engineering the **orchestration / readiness / handoff** layer. Move all
commissioning **execution** (test running, witnessing, deficiency/NCR/punch lifecycle, baselines/
arbitration) into the separate **Commissioning** repo. Denver keeps *what needs commissioning*,
*readiness*, *handoff*, and *status mirrors* — never *how commissioning is performed*.

Grounded against current source (branch `audit/enterprise-remediation-2026-06-21`).

---

## 0. Guiding boundary rule

| Concern | Owner |
|---|---|
| What needs commissioning (systems/subsystems/tags/CX items scope) | **Denver** |
| Readiness % toward commissioning | **Denver** |
| Generating FAT/SAT procedure *documents* (deliverables) | **Denver** |
| Turnover package + handoff state machine | **Denver** |
| Read-only **status mirror** of commissioning/FAT/SAT/punch/NCR | **Denver** |
| Running tests, recording step results, witnessing, sign-off | **Commissioning** |
| Deficiency lifecycle (open→resolve→close) | **Commissioning** |
| NCR / CAPA disposition + verification | **Commissioning** |
| Punch verification + closure | **Commissioning** |
| Commissioning baselines, observations, autosign/arbitration | **Commissioning** |
| FPT / IST / PFC execution UI | **Commissioning** |

Mnemonic: **Denver decides *whether* it's ready and *hands it off*; Commissioning decides *how it passed*.**

---

## 1. File-by-file extraction plan

### 1a. Backend — STAYS in Denver (orchestration / readiness / handoff)

| File | Why it stays |
|---|---|
| `api/services/turnover/turnoverService.ts` | The canonical handoff state machine (`open → ready_for_commissioning → in_commissioning → ready_for_turnover → accepted`) + `commissioning_url`/`commissioning_status`. This is the model the whole extraction follows. |
| `api/routes/turnover.ts` | Turnover/handoff REST surface. |
| `api/routes/commissioning.ts` + `api/services/packWorker.ts` | **Document generation** of FAT/SAT procedures/checklists (a deliverable handed to Commissioning). Not execution. |
| `api/db/migrations/006_commissioning_packs.sql` | Backs pack generation (docs). Keep. |
| `api/routes/commissioningItems.ts` + `commissioning_items` CRUD in `epcCore.ts` | Readiness **scope** (what must be commissioned). KEEP table, but `status` becomes **event-driven/read-only** (see §1d). |
| `api/services/readiness/readinessEngine.ts`, `readinessSnapshots.ts`, `api/routes/readiness.ts`, `api/routes/agentReadiness.ts` | Readiness computation/rollups. Keep — but recompute from mirrored status, not local execution rows. |
| `systems / subsystems / tags` CRUD in `epcCore.ts` (+ `026_epc_core.sql` for those 4 tables) | Asset/scope register. Pure readiness scaffolding. Keep. |

### 1b. Backend — MOVES to Commissioning repo (execution)

| File / unit | What it does | Destination |
|---|---|---|
| `api/routes/testPacks.ts` | Test pack lifecycle (draft→review→active) | Commissioning |
| `api/routes/testResults.ts` | Per-step pass/fail, `performed_at`, `witnessed_by` | Commissioning |
| `api/routes/deficiencies.ts` | Deficiency open/resolve/close | Commissioning |
| `api/routes/ncr.ts` + `api/services/quality/ncrService.ts` | NCR disposition + CAPA | Commissioning |
| `api/routes/punchLists.ts` (`/verify`, `/close`) | Punch verification/closure | Commissioning |
| `api/routes/autosignRules.ts` | Autosign arbitration rules | Commissioning |
| `api/routes/baselinesRoutes.ts` | Baseline visibility | Commissioning |
| `api/services/ciArbiter.ts` | Autosign / z-score arbitration engine | Commissioning |
| `epcCore.ts` → `test_packs`, `test_results`, `deficiencies` functions | Execution data access | Commissioning (split out — see §4) |
| `api/db/migrations/019_commissioning_baselines.sql` (`commissioning_baselines`, `commissioning_observations`) | Baseline/observation capture | Commissioning (schema source-of-truth moves) |
| `api/db/migrations/027_cx_pack_test_pack_fk.sql` | Test-pack FK | Commissioning |
| `api/db/migrations/078_ncr_capa.sql` (`ncrs`, `corrective_actions`) | NCR/CAPA schema | Commissioning |
| `test_packs / test_results / deficiencies` tables in `026_epc_core.sql` | Execution tables | Commissioning (data exported, see §4) |
| `punch_lists / punch_items` in `008_tier1_modules.sql` | Execution tables | Commissioning (data exported) |

> Note: `epcCore.ts` is a **mixed** file (readiness scope + execution). It must be **split**, not
> moved wholesale — see §4 Phase B.

### 1c. Backend — DELETED (after data export + cutover, not before)

Nothing is deleted in the first PRs. After data is exported and tenants are flipped (§4 Phase E):
- Delete moved route files from Denver.
- Delete `ciArbiter.ts`, `ncrService.ts`.
- Delete execution functions from `epcCore.ts`.
- Migrations are **never deleted** (they are history). The execution **tables** are dropped only in a
  final dedicated migration after the verification window, replaced by the mirror tables in §1d.

### 1d. Backend — NEW stubs / adapters (the boundary)

| New file | Role |
|---|---|
| `api/services/integration/commissioningGateway.ts` | Outbound client to Commissioning API (launch handoff, request readiness exchange, fetch status). Typed, retried, idempotent. Behind feature flag `COMMISSIONING_EXTERNAL`. |
| `api/routes/commissioningWebhook.ts` | Inbound receiver for Commissioning → Denver events (HMAC-verified). Writes to mirror tables; republishes onto Denver event bus. |
| `api/services/integration/cxStatusMirror.ts` | Read-model service over mirror tables (status, counts). All Denver UI reads route here. |
| `api/db/migrations/0XX_cx_status_mirror.sql` | New **read-only mirror** tables: `cx_status_mirror`, `cx_deficiency_summary`, `cx_ncr_summary`, `cx_punch_summary` (keyed by tenant/project/system/subsystem). Populated only by webhook/poll — never user-written. |
| Old execution routes (transition shim) | During transition, `testPacks/testResults/deficiencies/ncr/punchLists` return **read-only** data from the mirror with `Deprecation` + `Sunset` headers; writes return `409 moved_to_commissioning` with the launch URL. |

### 1e. Frontend (`denver-engineering-next/frontend/src/modules/commissioning/`)

| Component | Action |
|---|---|
| `CommissioningPage.tsx` | **Restructure** — drop execution tabs; becomes a readiness + external-status command view. |
| `CompletionMatrix.tsx` | **Keep** — readiness/completion view (reads mirror). |
| `TurnoverBuilder.tsx` | **Keep** — handoff deliverable checklist + launch button. |
| `DeficiencyRegistry.tsx` | **Replace** with read-only reference list (counts + deep-link to Commissioning), no create/edit. |
| `LogDeficiencyDialog.tsx` | **Remove** — execution write. |
| `FptExecution.tsx` | **Remove** — execution. |
| `IstOrchestration.tsx` | **Remove** — execution. |
| `PfcManagement.tsx` | **Remove** — execution. |
| `mobile/MobileFptPage.tsx` | **Remove** — field execution belongs to Commissioning's field app. |
| NEW `ExternalCommissioningStatus.tsx` | Read-only panel: phase, FAT/SAT readiness, open deficiency/NCR/punch counts, "Open in Commissioning →" deep-link. |

---

## 2. Denver ↔ Commissioning API contract

Versioned under `/api/cx/v1`. Auth: service-to-service token + HMAC on webhooks. All calls carry
`tenant_id` and `idempotency_key`. Denver is the caller for outbound; Commissioning is the caller for
callbacks.

### 2.1 Handoff package creation (Denver → Commissioning)
```
POST {COMMISSIONING_BASE}/api/cx/v1/handoffs
Authorization: Bearer <svc-token>
Idempotency-Key: <uuid>
{
  "tenant_id": "t_123",
  "project_id": "p_456",
  "turnover_package_id": "tp_789",
  "name": "Area 200 — Filtration",
  "scope": {
    "systems":    [{ "id": "sys_1", "tag": "FIL-200" }],
    "subsystems": [{ "id": "sub_1", "system_id": "sys_1" }],
    "commissioning_items": [
      { "id": "ci_1", "phase": "func", "tag": "FIL-200-P01" }
    ]
  },
  "deliverables": {
    "fat_procedure_doc_url":  "https://denver/api/v1/commissioning/packs/pk_1/download/pdf",
    "sat_procedure_doc_url":  "https://denver/api/v1/commissioning/packs/pk_2/download/pdf",
    "as_built_index_url":     "https://denver/.../as-built"
  },
  "callback_base": "https://denver/api/v1/cx/webhook"
}
→ 201 { "handoff_id": "hx_abc", "workspace_url": "https://commissioning/ws/hx_abc", "status": "received" }
```
Denver stores `workspace_url` into `turnover_packages.commissioning_url` and advances status to
`ready_for_commissioning`.

### 2.2 Commissioning status sync (pull fallback; push is preferred via events §3)
```
GET {COMMISSIONING_BASE}/api/cx/v1/handoffs/{handoff_id}/status
→ 200 {
  "handoff_id": "hx_abc",
  "phase": "sat_testing",                 // not_started|pre_comm|fat_testing|sat_testing|accepted|rejected
  "fat": { "readiness_pct": 100, "status": "passed" },
  "sat": { "readiness_pct": 60,  "status": "in_progress" },
  "counts": { "deficiencies_open": 4, "ncr_open": 1, "punch_open": 12 },
  "updated_at": "2026-06-25T12:00:00Z"
}
```

### 2.3 FAT/SAT readiness exchange (Denver → Commissioning: readiness gate)
```
POST {COMMISSIONING_BASE}/api/cx/v1/handoffs/{handoff_id}/readiness
{
  "fat_ready": true,                      // Denver asserts engineering/construction readiness
  "sat_ready": false,
  "evidence": {
    "engineering_complete_pct": 100,
    "construction_complete_pct": 100,
    "materials_available": true
  }
}
→ 200 { "accepted": true, "blocking_items": [] }
```
Commissioning is free to reject (`accepted:false`, `blocking_items:[...]`) — Denver surfaces that on
the readiness screen, does **not** force the gate.

### 2.4 Punch / deficiency / NCR status references (read-only into Denver)
Denver never holds the records — only **references + counts** returned by 2.2 or pushed by events.
Deep links are opaque URLs owned by Commissioning:
```
"references": {
  "deficiencies_url": "https://commissioning/ws/hx_abc/deficiencies",
  "ncr_url":          "https://commissioning/ws/hx_abc/ncr",
  "punch_url":        "https://commissioning/ws/hx_abc/punch"
}
```

### 2.5 Document / report callback URLs (Commissioning → Denver, for turnover compilation)
When Commissioning produces FAT/SAT reports, it returns URLs Denver records against the turnover
package (so turnover compilation stays in Denver):
```
POST https://denver/api/v1/cx/webhook   (event: report.published — see §3)
{ "handoff_id":"hx_abc","report_type":"fat_report","url":"https://commissioning/.../fat.pdf" }
```

---

## 3. Event contract

Transport: existing Denver event bus (`realtime_event_log`) for internal fan-out; cross-system
delivery via signed webhooks (HMAC-SHA256, `X-CX-Signature`). All events carry `event_id`,
`tenant_id`, `handoff_id`, `occurred_at`, `correlation_id`.

### 3.1 Events Denver PUBLISHES (→ Commissioning)
| Event | When |
|---|---|
| `handoff.created` | Turnover package handed off / `ready_for_commissioning` |
| `handoff.readiness_updated` | FAT/SAT readiness asserted/changed |
| `handoff.scope_changed` | CX item scope added/removed |
| `handoff.deliverable_published` | A FAT/SAT procedure doc finalized |
| `handoff.cancelled` | Handoff withdrawn |

### 3.2 Events Commissioning PUBLISHES BACK (→ Denver webhook)
| Event | Effect in Denver |
|---|---|
| `cx.phase_changed` | Update `cx_status_mirror.phase`, mirror to `turnover_packages.commissioning_status` |
| `cx.fat_status_changed` | Update FAT readiness/status mirror |
| `cx.sat_status_changed` | Update SAT readiness/status mirror |
| `cx.counts_changed` | Update deficiency/NCR/punch summary counts |
| `cx.report_published` | Record report URL against turnover package |
| `cx.accepted` / `cx.rejected` | Advance/flag turnover handoff status |

### 3.3 Payload examples
```jsonc
// Denver → Commissioning
{
  "event_id": "evt_001", "event": "handoff.readiness_updated",
  "tenant_id": "t_123", "handoff_id": "hx_abc",
  "occurred_at": "2026-06-25T12:00:00Z", "correlation_id": "c_77",
  "data": { "fat_ready": true, "sat_ready": false,
            "engineering_complete_pct": 100, "construction_complete_pct": 100 }
}

// Commissioning → Denver
{
  "event_id": "evt_900", "event": "cx.phase_changed",
  "tenant_id": "t_123", "handoff_id": "hx_abc",
  "occurred_at": "2026-06-25T13:30:00Z", "correlation_id": "c_77",
  "data": { "phase": "sat_testing", "previous": "fat_testing",
            "counts": { "deficiencies_open": 4, "ncr_open": 1, "punch_open": 12 } }
}

// Commissioning → Denver (report)
{
  "event_id": "evt_901", "event": "cx.report_published",
  "tenant_id": "t_123", "handoff_id": "hx_abc",
  "occurred_at": "2026-06-25T18:00:00Z",
  "data": { "report_type": "fat_report", "url": "https://commissioning/.../fat.pdf",
            "sha256": "ab12…" }
}
```

---

## 4. Migration strategy

Principles: **additive first, never drop before export+verify, dual-read before write-cutover,
flag per tenant.**

**Phase A — Stand up the boundary (additive, zero behavior change).**
Add `commissioningGateway`, `commissioningWebhook`, `cxStatusMirror`, mirror-table migration, feature
flag `COMMISSIONING_EXTERNAL` (default **off**). Nothing reads from it yet. Fully reversible.

**Phase B — Split `epcCore.ts`.** Extract `test_packs / test_results / deficiencies` access into a
separate module so the readiness scope (systems/subsystems/tags/commissioning_items) is cleanly
isolated. No behavior change — pure refactor with tests green.

**Phase C — Export + parity.** One-time export script copies execution data (`test_packs`,
`test_results`, `deficiencies`, `ncrs`, `corrective_actions`, `punch_lists`, `punch_items`,
`commissioning_baselines`, `commissioning_observations`) to the Commissioning repo. Run a parity
report (row counts + checksums). No deletion.

**Phase D — Dual-read cutover (per tenant, flag on).** With flag on, Denver UI/readiness reads from
`cxStatusMirror` (fed by events/poll) instead of local execution tables. Old execution routes return
read-only mirror data with `Deprecation`/`Sunset` headers; write attempts return `409
moved_to_commissioning` + workspace URL. Keep flag off for un-migrated tenants → **backward
compatible**.

**Phase E — Freeze + remove.** After a verification window with all tenants flipped: delete moved
routes/services from Denver, drop execution functions from `epcCore.ts`, and a final migration drops
the execution tables (data already in Commissioning). Mirror tables remain.

Data preservation guarantees: (1) no `DROP TABLE` in the same PR as any cutover; (2) export verified
before any delete; (3) execution tables kept read-only through the window; (4) migrations append-only.

---

## 5. UI changes

- **Remove execution flows:** delete `FptExecution`, `IstOrchestration`, `PfcManagement`,
  `LogDeficiencyDialog`, and `mobile/MobileFptPage`. Remove the FPT/IST/PFC tabs from
  `CommissioningPage`.
- **Replace execution screens with readiness/status/handoff:**
  - `CommissioningPage` tabs become: **Readiness** (CompletionMatrix), **Handoff** (TurnoverBuilder +
    launch button), **External Status** (new `ExternalCommissioningStatus`), **Documents** (generated
    FAT/SAT packs).
  - `DeficiencyRegistry` → read-only counts + "Open in Commissioning →" deep-link (no writes).
- **Keep dashboards showing external commissioning status:** Dashboard tab + portfolio dashboards read
  `cxStatusMirror` for phase, FAT/SAT readiness, and open counts. KPI cards (Systems At Risk, Critical
  Deficiencies) source from mirror, with an "external / synced at <t>" indicator.
- **Adapter swap, not component rewrite:** point the commissioning data adapter at the mirror endpoints
  so kept components (CompletionMatrix, dashboard) need minimal change.

---

## 6. Safety rule & first implementation PR

- **No code is modified by this document.** This is the plan only.
- Execution code is **moved/deleted only after** export + parity + per-tenant flag cutover (Phases C–E).
- No table is dropped before its data is exported and verified.

### First implementation PR (after plan approval): **PR-1 — "Commissioning boundary scaffolding (additive, flag-off)"**
Scope (all additive, no removals, flag default off, fully reversible):
1. `api/db/migrations/0XX_cx_status_mirror.sql` — mirror tables (read-only).
2. `api/services/integration/commissioningGateway.ts` — typed outbound client (stubbed transport).
3. `api/routes/commissioningWebhook.ts` — HMAC-verified inbound receiver → writes mirror + republishes
   on event bus.
4. `api/services/integration/cxStatusMirror.ts` — read-model service.
5. Feature flag `COMMISSIONING_EXTERNAL` (default off) + config.
6. Tests: gateway contract (mocked), webhook signature + idempotency, mirror read-model.

PR-1 changes **no existing behavior** — it only erects the boundary. Subsequent PRs follow §4
Phases B → C → D → E.

# Readiness Engine Design
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Purpose

The Readiness Engine computes a deterministic, explainable score (0–100) representing how operationally ready a project, asset, or any entity is, based on five measurable dimensions. It enables supervisors to answer "Is this system ready to proceed?" without manual inspection.

## Scoring Model

### Component Weights

| Component | Weight | Measures |
|-----------|--------|----------|
| `open_actions` | 30% | Open action count vs. total (saturation) |
| `blockers` | 25% | Dependency blockers on the entity |
| `sla_health` | 20% | Breached + at-risk actions vs. total open |
| `inspections` | 15% | Failed inspections vs. total |
| `escalations` | 10% | Escalated actions vs. total open |

### Component Scoring Functions

**open_actions:** `max(0, 100 - (openCount / max(totalCount, 1)) * 100)`
Saturation approaches 0 as open actions fill the pipeline.

**blockers:** `max(0, 100 - blockerCount * 20)`
Each blocker deducts 20 points; 5 or more blockers → 0.

**sla_health:** `max(0, 100 - (breachCount * 30) - (atRiskCount * 15)) / max(totalOpen, 1) * 100`
Breached actions penalize more heavily than at-risk.

**inspections:** `max(0, 100 - (failCount / max(totalCount, 1)) * 100)`
Fully deducted when all inspections fail.

**escalations:** `max(0, 100 - (escalatedCount / max(totalOpen, 1)) * 100)`
Linear deduction proportional to escalation rate.

### Weighted Score

```
score = Σ (component_score × weight)
score = clamp(score, 0, 100)
```

## Readiness States

| State | Score Range | Meaning |
|-------|-------------|---------|
| `not_ready` | < 40 | Critical issues blocking progress |
| `at_risk` | 40–64 | Significant concerns, intervention needed |
| `conditionally_ready` | 65–84 | Proceed with monitoring |
| `ready` | ≥ 85 | Fully operational |

Thresholds are configurable per tenant per domain in `readiness_thresholds`. Default: `not_ready_below: 40, at_risk_below: 65, conditionally_ready_below: 85`.

## Blocking Factors

The engine builds human-readable blocking factors alongside the score:

| Factor Type | Severity | Triggered When |
|-------------|----------|----------------|
| `dependency_blockers` | `critical` | ≥ 3 blockers; `high` for 1–2 |
| `overdue_actions` | `critical` | ≥ 5 overdue; `medium` for 1–4 |
| `escalation_chain` | `high` | ≥ 1 escalated action |
| `inspection_failures` | `critical` | ≥ 1 failed inspection |

## Supported Domains

| Domain | Entity | Typical Use |
|--------|--------|-------------|
| `project` | project_id | Project-level dashboard |
| `asset` | asset_id | Equipment readiness before operation |
| `inspection` | inspection_id | Pre-inspection gate |
| `punch_list` | punch_list_id | Punch completion readiness |
| `system` | system_id | EPC system commissioning |
| `commissioning` | package_id | Commissioning package gate |
| `compliance` | compliance_task_id | Regulatory compliance gate |

## Data Flow

```
GET /api/v1/readiness/:entityType/:entityId
       │
       ▼
computeReadiness(tenantId, domain, entityId)
       │
       ├── tenantQuery: open/total counts
       ├── tenantQuery: blocker count (action_relations)
       ├── tenantQuery: SLA breach/at-risk counts
       ├── tenantQuery: inspection fail/total counts
       └── tenantQuery: escalation count
       │
       ▼
scoreOpenActions(), scoreBlockers(), scoreSlaHealth(),
scoreInspections(), scoreEscalations()
       │
       ▼
computeWeightedScore() → resolveState() → buildBlockingFactors()
       │
       ▼
persistReadinessScore()  [upserts readiness_scores]
       │
       ▼
ReadinessResult { score, state, components, blocking_factors }
```

## Snapshot History

A nightly job runs `snapshotReadinessForTenant()` via the scheduler. It iterates all active projects, computes readiness for each, and inserts into `readiness_snapshots` with `snapshot_date = today`. History is queryable via:

```
GET /api/v1/readiness/project/:projectId/history?days=30
```

The `RiskTrendChart` component plots this history as an SVG area chart with hover tooltips.

## Schema

```sql
-- readiness_thresholds: per-tenant, per-domain configuration
CREATE TABLE readiness_thresholds (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  domain                    readiness_domain NOT NULL,
  not_ready_below           numeric(5,2) DEFAULT 40,
  at_risk_below             numeric(5,2) DEFAULT 65,
  conditionally_ready_below numeric(5,2) DEFAULT 85,
  weight_open_actions       numeric(4,2) DEFAULT 0.30,
  weight_blockers           numeric(4,2) DEFAULT 0.25,
  weight_sla_health         numeric(4,2) DEFAULT 0.20,
  weight_inspections        numeric(4,2) DEFAULT 0.15,
  weight_escalations        numeric(4,2) DEFAULT 0.10,
  UNIQUE(tenant_id, domain)
);

-- readiness_scores: current state (upserted on each compute)
CREATE TABLE readiness_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  domain          readiness_domain NOT NULL,
  entity_id       uuid NOT NULL,
  entity_type     text NOT NULL,
  score           numeric(5,2) NOT NULL,
  state           readiness_state NOT NULL,
  components      jsonb NOT NULL DEFAULT '{}',
  blocking_factors jsonb NOT NULL DEFAULT '[]',
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, domain, entity_id)
);

-- readiness_snapshots: daily history
CREATE TABLE readiness_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  domain          readiness_domain NOT NULL,
  entity_id       uuid NOT NULL,
  entity_type     text NOT NULL,
  score           numeric(5,2) NOT NULL,
  state           readiness_state NOT NULL,
  components      jsonb NOT NULL DEFAULT '{}',
  snapshot_date   date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(tenant_id, snapshot_date, domain, entity_id)
);
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/readiness/:entityType/:entityId` | Compute + return current readiness |
| `GET` | `/readiness/project/:projectId/history` | Snapshot history (up to 90 days) |
| `GET` | `/readiness/thresholds` | Current tenant thresholds |
| `PUT` | `/readiness/thresholds` | Update thresholds |
| `POST` | `/readiness/snapshot` | Trigger manual snapshot |

## Explainability Guarantee

Every readiness response includes:
- `score`: the final 0–100 value
- `state`: human-readable state label
- `components`: each of the 5 sub-scores with their weights
- `blocking_factors`: ordered list of named factors with severity

No score is ever presented without its full breakdown.

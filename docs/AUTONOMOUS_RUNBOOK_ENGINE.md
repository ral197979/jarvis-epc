# Autonomous Runbook Engine

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Runbook Engine executes versioned operational playbooks step-by-step. It supports live execution, dry-run validation, simulation isolation, human approval checkpoints, idempotent retries, and full rollback. Every execution is auditable, replayable, and explainable.

## Core Principles

- **No unrestricted autonomous execution** — approval gates pause execution before high-impact steps
- **Idempotency enforced** — every step carries a unique `idempotency_key`; duplicate executions silently skip
- **Dry-run first** — mode=`dry_run` or `simulation` produces no mutations outside runbook tables
- **Rollback by design** — each step declares its `rollback_data`; rollback traverses steps in reverse order
- **Human-readable conditions** — `condition` fields use simple `key=value` string matching, never `eval()`

## Schema

### `operational_runbooks`
Master runbook record. Links to its current published version via `current_version_id` (deferred FK).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Runbook identifier |
| tenant_id | UUID | Tenant scope |
| name | TEXT | Human-readable name |
| current_version_id | UUID | FK → runbook_versions (DEFERRABLE) |
| status | TEXT | active / archived / draft |
| trigger_type | TEXT | manual / scheduled / webhook / threshold |

### `runbook_versions`
Immutable versioned step definitions. Publishing creates a new version; prior versions are preserved.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Version identifier |
| runbook_id | UUID FK | Parent runbook |
| version_number | INT | Monotonically increasing |
| steps | JSONB | Array of StepDefinition |
| rollback_steps | JSONB | Reverse rollback sequence |
| is_published | BOOL | True once promoted to current |

### `runbook_executions`
Runtime execution record. One row per `executeRunbook()` invocation.

### `runbook_steps` / `runbook_step_results`
Per-step state and output. Step results are insert-only (immutable).

## Execution Modes

| Mode | Production mutations | Step handlers called | Use case |
|------|---------------------|---------------------|----------|
| `live` | Yes | Full | Normal operation |
| `dry_run` | No | Returns dry_run result | Pre-flight validation |
| `simulation` | No | Returns dry_run result | Replay / what-if |

## Step Handler Registry

```
create_action       assign_action       escalate_action
freeze_workflow     request_approval    notify_users
trigger_integration generate_report     create_deficiency
create_inspection   update_readiness    wait
condition
```

## Approval Gate Flow

When `step.requires_approval === true` and `mode === 'live'`:

1. Engine marks step as `waiting_approval`
2. Sets execution status to `waiting_approval`
3. Returns immediately — does NOT advance to next step
4. Caller resumes via `POST /api/v1/runbooks/executions/:execId/approve/:stepIndex`
5. `approveRunbookStep()` marks step as `completed` and execution as `running`
6. Next `executeRunbook()` call resumes from `current_step`

## Idempotency

Each step carries an `idempotency_key`. Static keys prevent duplicate DB writes. Dynamic keys can reference context variables:

```json
"idempotency_key": "assign:{{action_id}}:{{tenant_id}}"
```

Template resolution uses `{{variable_name}}` pattern. Unknown variables fall back to the variable name itself.

## Rollback

`rollbackExecution(executionId, tenantId)` loads all successful step results in DESC `step_index` order and calls `_executeRollbackOp()` for each with a valid `rollback_op`.

Supported rollback ops:
- `cancel_action` — sets action status to `cancelled`
- `deescalate` — decrements `max_escalation_level`
- `unfreeze_workflow` — restores `sla_status = 'active'`

## Condition Evaluation

Step conditions use safe string comparison: `"env=prod"` checks `ctx.variables.env === 'prod'`. No eval() is ever called. Invalid expressions default to `true` (step executes).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/runbooks` | List tenant runbooks |
| POST | `/api/v1/runbooks` | Create runbook + initial version |
| POST | `/api/v1/runbooks/:id/execute` | Execute (live or dry_run) |
| POST | `/api/v1/runbooks/:id/simulate` | Execute in simulation mode |
| GET | `/api/v1/runbooks/:id/executions` | List executions |
| POST | `/api/v1/runbooks/executions/:execId/rollback` | Rollback execution |
| POST | `/api/v1/runbooks/executions/:execId/approve/:stepIndex` | Approve checkpoint |

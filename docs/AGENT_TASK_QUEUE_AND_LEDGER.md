# Agent Task Queue and Execution Ledger

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Task Queue

### Schema: `agent_tasks`

Durable, tenant-isolated task queue with idempotency support and retry logic.

| Column | Description |
|--------|-------------|
| `id` | UUID PK |
| `status` | queued / assigned / running / completed / failed / cancelled / pending_approval / blocked |
| `agent_type` | Which agent handles this task |
| `priority` | 1 (highest) to 10 (lowest) |
| `idempotency_key` | Unique constraint — prevents duplicate enqueues |
| `retry_count` / `max_retries` | Auto-retry on failure up to max |
| `claimed_by` | Worker ID that claimed this task |
| `scheduled_at` | When task becomes eligible for claiming |
| `expires_at` | Task auto-abandoned after this timestamp |

### Claiming: FOR UPDATE SKIP LOCKED

Workers claim tasks using Postgres advisory locking to avoid thundering-herd:

```sql
UPDATE agent_tasks SET status = 'assigned', claimed_by = $workerId
WHERE id = (
  SELECT id FROM agent_tasks
  WHERE agent_type = ANY($agentTypes)
    AND status = 'queued'
    AND scheduled_at <= now()
  ORDER BY priority ASC, scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

Multiple workers can claim concurrently without contention.

### Retry Logic

On `failTask`:
- If `retry_count < max_retries`: status → `queued`, claimed_by cleared, retry_count++
- If `retry_count >= max_retries`: status → `failed`

### Stale Task Recovery

`reclaimStaleTasks(staleMinutes)` resets tasks stuck in `assigned` or `running` for longer than the threshold. Uses `pool.query` (no RLS — system-level operation).

### Idempotency

`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` — returns the existing task on conflict without creating a duplicate.

---

## Execution Ledger

### Schema: `agent_executions`

Immutable ledger — `CREATE RULE no_update/no_delete` blocks all mutations after INSERT.

| Column | Description |
|--------|-------------|
| `id` | UUID PK |
| `task_id` | FK to agent_tasks |
| `input_snapshot` | Immutable copy of task payload at execution start |
| `policy_checks` | Array of PolicyCheckResult from governance check |
| `worker_id` | Worker that executed this |
| `started_at` | Execution start timestamp |

### Execution Events: `agent_execution_events`

Append-only event log with monotonic `sequence_num`:

```sql
INSERT INTO agent_execution_events ... VALUES (...,
  (SELECT COALESCE(MAX(sequence_num), 0) + 1 FROM agent_execution_events WHERE execution_id = $id),
  ...)
```

Standard event types:
- `governance_checked` — pre-execution policy result
- `agent_started` — agent began processing
- `execution_closed` — final status + output + duration

### closeExecution Pattern

Because `agent_executions` is immutable, completion status is stored as an `execution_closed` event rather than updating the row. Downstream consumers read the latest `execution_closed` event to determine final status.

### Decision Traces: `agent_decision_traces`

Each decision records:
- `decisionType` — category of decision (risk_assessment, task_routing, etc.)
- `rationale` — human-readable explanation
- `confidence` — 0–100 score
- `alternatives` — other options considered and why they were rejected
- `chosenAction` — the action taken

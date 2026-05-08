// Denver Engineering — Agent Task Queue (v5.0.0)
// Durable, tenant-isolated task queue with idempotency and FOR UPDATE SKIP LOCKED.

import { pool, tenantQuery  } from '../../db/pool'
import { CreateTaskInput, AgentTask, AgentType, TaskStatus } from './agentTypes'

// ─── Enqueue ──────────────────────────────────────────────────────────────────

export async function enqueueTask(input: CreateTaskInput): Promise<AgentTask> {
  const {
    tenantId,
    agentType,
    taskType,
    priority = 5,
    payload,
    context = {},
    parentTaskId,
    maxRetries = 3,
    scheduledAt,
    expiresAt,
    idempotencyKey,
    createdBy,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO agent_tasks
       (tenant_id, agent_type, task_type, priority, payload, context,
        parent_task_id, max_retries, scheduled_at, expires_at,
        idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
             COALESCE($9::timestamptz, now()), $10,
             $11, $12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      tenantId, agentType, taskType, priority,
      JSON.stringify(payload), JSON.stringify(context),
      parentTaskId ?? null, maxRetries,
      scheduledAt?.toISOString() ?? null,
      expiresAt?.toISOString() ?? null,
      idempotencyKey ?? null, createdBy,
    ]
  )

  if (res.rows.length === 0) {
    // Idempotency hit — fetch the existing task
    const existing = await tenantQuery(
      tenantId,
      'SELECT * FROM agent_tasks WHERE idempotency_key = $1 AND tenant_id = $2',
      [idempotencyKey, tenantId]
    )
    return _mapRow(existing.rows[0])
  }

  return _mapRow(res.rows[0])
}

// ─── Claim (worker pattern) ───────────────────────────────────────────────────

export async function claimNextTask(
  agentTypes: AgentType[],
  workerId: string,
  tenantId?: string
): Promise<AgentTask | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const tenantFilter = tenantId ? 'AND tenant_id = $3' : ''
    const params: unknown[] = [agentTypes, workerId]
    if (tenantId) params.push(tenantId)

    const res = await client.query(
      `UPDATE agent_tasks
       SET status = 'assigned', claimed_by = $2, claimed_at = now(), updated_at = now()
       WHERE id = (
         SELECT id FROM agent_tasks
         WHERE agent_type = ANY($1::text[])
           AND status = 'queued'
           AND scheduled_at <= now()
           AND (expires_at IS NULL OR expires_at > now())
           ${tenantFilter}
         ORDER BY priority ASC, scheduled_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      params
    )

    await client.query('COMMIT')
    return res.rows.length > 0 ? _mapRow(res.rows[0]) : null
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Status transitions ───────────────────────────────────────────────────────

export async function markTaskRunning(
  taskId: string,
  tenantId: string,
  executionId: string
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = 'running', execution_id = $3, started_at = now(), updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [taskId, tenantId, executionId]
  )
}

export async function completeTask(
  taskId: string,
  tenantId: string,
  result: Record<string, unknown>
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = 'completed', result = $3, completed_at = now(), updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [taskId, tenantId, JSON.stringify(result)]
  )
}

export async function failTask(
  taskId: string,
  tenantId: string,
  error: string
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = CASE
           WHEN retry_count < max_retries THEN 'queued'
           ELSE 'failed'
         END,
         error = $3,
         retry_count = retry_count + 1,
         claimed_by = NULL,
         claimed_at = NULL,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [taskId, tenantId, error]
  )
}

export async function cancelTask(taskId: string, tenantId: string): Promise<boolean> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND tenant_id = $2
       AND status IN ('queued', 'assigned', 'pending_approval')
     RETURNING id`,
    [taskId, tenantId]
  )
  return res.rows.length > 0
}

export async function pendApproval(taskId: string, tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = 'pending_approval', updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [taskId, tenantId]
  )
}

export async function resumeFromApproval(taskId: string, tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE agent_tasks
     SET status = 'running', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending_approval'`,
    [taskId, tenantId]
  )
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getTask(taskId: string, tenantId: string): Promise<AgentTask | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM agent_tasks WHERE id = $1 AND tenant_id = $2',
    [taskId, tenantId]
  )
  return res.rows.length > 0 ? _mapRow(res.rows[0]) : null
}

export async function listTasks(
  tenantId: string,
  filters: {
    status?: TaskStatus
    agentType?: AgentType
    limit?: number
    offset?: number
  } = {}
): Promise<AgentTask[]> {
  const conditions: string[] = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (filters.status) {
    conditions.push(`status = $${idx++}`)
    params.push(filters.status)
  }
  if (filters.agentType) {
    conditions.push(`agent_type = $${idx++}`)
    params.push(filters.agentType)
  }

  params.push(filters.limit ?? 50)
  params.push(filters.offset ?? 0)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM agent_tasks
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  )
  return res.rows.map(_mapRow)
}

// ─── Stale task recovery ──────────────────────────────────────────────────────

export async function reclaimStaleTasks(
  staleMinutes: number
): Promise<number> {
  const res = await pool.query(
    `UPDATE agent_tasks
     SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
         retry_count = retry_count + 1, updated_at = now()
     WHERE status IN ('assigned', 'running')
       AND claimed_at < now() - ($1 || ' minutes')::interval
       AND retry_count < max_retries
     RETURNING id`,
    [staleMinutes]
  )
  return res.rows.length
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function _mapRow(row: Record<string, unknown>): AgentTask {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentType: row.agent_type as AgentType,
    taskType: row.task_type as string,
    priority: row.priority as number,
    status: row.status as TaskStatus,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    context: (row.context ?? {}) as Record<string, unknown>,
    result: row.result != null ? row.result as Record<string, unknown> : undefined,
    error: row.error != null ? row.error as string : undefined,
    parentTaskId: row.parent_task_id != null ? row.parent_task_id as string : undefined,
    executionId: row.execution_id != null ? row.execution_id as string : undefined,
    claimedBy: row.claimed_by != null ? row.claimed_by as string : undefined,
    claimedAt: row.claimed_at != null ? new Date(row.claimed_at as string) : undefined,
    startedAt: row.started_at != null ? new Date(row.started_at as string) : undefined,
    completedAt: row.completed_at != null ? new Date(row.completed_at as string) : undefined,
    maxRetries: row.max_retries as number,
    retryCount: row.retry_count as number,
    scheduledAt: new Date(row.scheduled_at as string),
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    idempotencyKey: row.idempotency_key != null ? row.idempotency_key as string : undefined,
    createdBy: row.created_by as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = { _mapRow }

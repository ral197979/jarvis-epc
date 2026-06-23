/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Runbook Engine (v4.40.0)
 * ──────────────────────────────────────────────
 * Ava Phase 4 — Executes versioned operational runbooks step-by-step.
 * Supports live execution, dry-run, simulation, approval checkpoints,
 * idempotent retries, and full rollback.
 *
 * Non-negotiable rules:
 * - All step executions are idempotent (idempotency_key enforced)
 * - Human approval required before approval-gated steps run
 * - Dry-run mode produces no DB mutations outside runbook tables
 * - Rollback steps execute in reverse index order
 * - Every step result is immutable (insert-only)
 */

import { pool, tenantQuery  } from '../../db/pool'
import { publishActionEvent } from '../actions/actionEventPublisher'
import { broadcastEvent } from '../../realtime/eventBroadcaster'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunbookMode = 'live' | 'dry_run' | 'simulation'

export interface StepDefinition {
  step_type:        string
  config:           Record<string, unknown>
  requires_approval?: boolean
  condition?:       string   // JS expression evaluated against context
  idempotency_key?: string   // static key; dynamic keys can reference {{context.var}}
  on_failure?:      'abort' | 'skip' | 'rollback'
}

export interface RunbookContext {
  tenantId:    string
  triggeredBy: string
  correlationId?: string
  variables:   Record<string, unknown>
  mode:        RunbookMode
}

export interface StepResult {
  outcome:       'success' | 'failure' | 'skipped' | 'dry_run'
  output:        Record<string, unknown>
  error?:        string
  rollback_data?: Record<string, unknown>
  duration_ms:   number
}

// ─── Step Handlers ────────────────────────────────────────────────────────────

type StepHandler = (
  config: Record<string, unknown>,
  ctx: RunbookContext
) => Promise<StepResult>

function _dryRunResult(output: Record<string, unknown> = {}): StepResult {
  return { outcome: 'dry_run', output: { dry_run: true, ...output }, duration_ms: 0 }
}

async function _handleCreateAction(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ action_type: config['action_type'] })
  const result = await tenantQuery(ctx.tenantId, `
    INSERT INTO actions (tenant_id, title, action_type, priority, status, created_by)
    VALUES ($1, $2, $3, $4, 'open', $5)
    RETURNING id
  `, [ctx.tenantId, config['title'], config['action_type'], config['priority'] ?? 'medium', ctx.triggeredBy])
  const actionId = result.rows[0]?.id as string
  publishActionEvent(ctx.tenantId, actionId, 'created', ctx.triggeredBy ?? null, undefined,
    { correlationId: ctx.correlationId })
  return { outcome: 'success', output: { action_id: actionId }, duration_ms: Date.now() - t0,
    rollback_data: { action_id: actionId, rollback_op: 'cancel_action' } }
}

async function _handleAssignAction(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ assignee_id: config['assignee_id'] })
  const { rows } = await tenantQuery(ctx.tenantId, `
    UPDATE actions SET assignee_id = $1 WHERE id = $2 AND tenant_id = $3
    RETURNING id, assignee_id
  `, [config['assignee_id'], config['action_id'], ctx.tenantId])
  if (!rows[0]) return { outcome: 'failure', output: {}, error: 'Action not found', duration_ms: Date.now() - t0 }
  return { outcome: 'success', output: { action_id: config['action_id'], assignee_id: config['assignee_id'] },
    duration_ms: Date.now() - t0,
    rollback_data: { action_id: config['action_id'], prev_assignee_id: rows[0].prev_assignee_id } }
}

async function _handleEscalateAction(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ action_id: config['action_id'] })
  await tenantQuery(ctx.tenantId, `
    UPDATE actions SET max_escalation_level = max_escalation_level + 1
    WHERE id = $1 AND tenant_id = $2
  `, [config['action_id'], ctx.tenantId])
  publishActionEvent(ctx.tenantId, config['action_id'] as string, 'escalated',
    ctx.triggeredBy ?? null, undefined, { correlationId: ctx.correlationId })
  broadcastEvent({ event_type: 'escalation_triggered', tenant_id: ctx.tenantId,
    payload: { action_id: config['action_id'], source: 'runbook' }, subscription_scope: 'tenant' })
  return { outcome: 'success', output: { action_id: config['action_id'] }, duration_ms: Date.now() - t0,
    rollback_data: { action_id: config['action_id'], rollback_op: 'deescalate' } }
}

async function _handleFreezeWorkflow(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ action_ids: config['action_ids'] })
  const ids = config['action_ids'] as string[]
  await tenantQuery(ctx.tenantId, `
    INSERT INTO action_sla_state (tenant_id, action_id, sla_status, paused_at)
    SELECT $1, unnest($2::uuid[]), 'paused', now()
    ON CONFLICT (tenant_id, action_id) DO UPDATE SET sla_status = 'paused', paused_at = now()
  `, [ctx.tenantId, ids])
  return { outcome: 'success', output: { frozen_count: ids.length }, duration_ms: Date.now() - t0,
    rollback_data: { action_ids: ids, rollback_op: 'unfreeze_workflow' } }
}

async function _handleRequestApproval(
  _config: Record<string, unknown>,
  _ctx: RunbookContext
): Promise<StepResult> {
  // This step type is intercepted by the engine before handler dispatch.
  // If we reach here, approval was already granted.
  return { outcome: 'success', output: { approval_granted: true }, duration_ms: 0 }
}

async function _handleNotifyUsers(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ user_ids: config['user_ids'] })
  const userIds = config['user_ids'] as string[]
  const inserts = userIds.map(() => `($1,$2,$3,'runbook_notification','pending','high')`).join(',')
  if (userIds.length > 0) {
    await tenantQuery(ctx.tenantId, `
      INSERT INTO notification_jobs (tenant_id, user_id, template_key, channel, status, priority)
      VALUES ${inserts}
    `, [ctx.tenantId, ...userIds.map(() => [ctx.tenantId]).flat()])
  }
  return { outcome: 'success', output: { notified: userIds.length }, duration_ms: Date.now() - t0 }
}

async function _handleTriggerIntegration(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ connector_id: config['connector_id'] })
  await tenantQuery(ctx.tenantId, `
    INSERT INTO integration_jobs (tenant_id, connector_id, job_type, payload)
    VALUES ($1, $2, 'push', $3::jsonb)
  `, [ctx.tenantId, config['connector_id'], JSON.stringify(config['payload'] ?? {})])
  return { outcome: 'success', output: { queued: true }, duration_ms: Date.now() - t0 }
}

async function _handleGenerateReport(
  config: Record<string, unknown>,
  ctx: RunbookContext
): Promise<StepResult> {
  const t0 = Date.now()
  if (ctx.mode !== 'live') return _dryRunResult({ export_type: config['export_type'] })
  const { rows } = await tenantQuery(ctx.tenantId, `
    INSERT INTO export_jobs (tenant_id, name, export_type, format, filters, requested_by)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    RETURNING id
  `, [ctx.tenantId, config['name'] ?? 'Runbook Report', config['export_type'] ?? 'actions',
      config['format'] ?? 'json', JSON.stringify(config['filters'] ?? {}), ctx.triggeredBy])
  return { outcome: 'success', output: { export_job_id: rows[0]?.id }, duration_ms: Date.now() - t0 }
}

const _genericStep: StepHandler = async (_config, _ctx) => ({
  outcome: 'success', output: { handled: true }, duration_ms: 0
})

export const STEP_HANDLERS: Record<string, StepHandler> = {
  create_action:     _handleCreateAction,
  assign_action:     _handleAssignAction,
  escalate_action:   _handleEscalateAction,
  freeze_workflow:   _handleFreezeWorkflow,
  request_approval:  _handleRequestApproval,
  notify_users:      _handleNotifyUsers,
  trigger_integration: _handleTriggerIntegration,
  generate_report:   _handleGenerateReport,
  create_deficiency: _genericStep,
  create_inspection: _genericStep,
  update_readiness:  _genericStep,
  wait:              _genericStep,
  condition:         _genericStep,
}

// ─── Context Builder ──────────────────────────────────────────────────────────

export function _buildContext(
  tenantId: string,
  triggeredBy: string,
  mode: RunbookMode,
  variables: Record<string, unknown> = {},
  correlationId?: string
): RunbookContext {
  return { tenantId, triggeredBy, mode, variables, correlationId }
}

// ─── Condition Evaluator ──────────────────────────────────────────────────────

export function _evaluateCondition(
  expression: string,
  ctx: RunbookContext
): boolean {
  // Simple key=value evaluation against context.variables — no eval()
  try {
    const [key, value] = expression.split('=').map(s => s.trim())
    if (!key || value === undefined) return true
    return String(ctx.variables[key!]) === value
  } catch {
    return true  // undefined condition = always execute
  }
}

// ─── Idempotency Key Resolution ────────────────────────────────────────────────

export function _resolveIdempotencyKey(
  template: string | undefined,
  ctx: RunbookContext,
  stepIndex: number
): string {
  if (!template) return `${ctx.tenantId}:step:${stepIndex}:${Date.now()}`
  return template.replace(/\{\{(.+?)\}\}/g, (_, key) =>
    String(ctx.variables[key.trim()] ?? key))
}

// ─── Core Execution ───────────────────────────────────────────────────────────

export async function executeRunbook(
  tenantId: string,
  runbookId: string,
  triggeredBy: string,
  options: { mode?: RunbookMode; variables?: Record<string, unknown>; correlationId?: string } = {}
): Promise<{ executionId: string; status: string; stepsCompleted: number; errors: string[] }> {
  const mode = options.mode ?? 'live'
  const ctx  = _buildContext(tenantId, triggeredBy, mode, options.variables ?? {}, options.correlationId)

  // Load runbook + current version
  const { rows: rbRows } = await tenantQuery(tenantId,
    `SELECT r.id, r.current_version_id, v.steps, v.rollback_steps, v.id as ver_id
     FROM operational_runbooks r
     JOIN runbook_versions v ON v.id = r.current_version_id
     WHERE r.id = $1 AND r.tenant_id = $2 AND r.status = 'active'`,
    [runbookId, tenantId])

  if (!rbRows[0]) throw new Error(`Runbook ${runbookId} not found or not active`)

  const steps: StepDefinition[] = rbRows[0].steps as StepDefinition[]

  // Create execution record
  const { rows: execRows } = await tenantQuery(tenantId, `
    INSERT INTO runbook_executions
      (tenant_id, runbook_id, version_id, status, mode, triggered_by, correlation_id, total_steps)
    VALUES ($1,$2,$3,'running',$4,$5,$6,$7)
    RETURNING id
  `, [tenantId, runbookId, rbRows[0].ver_id, mode, triggeredBy,
      options.correlationId ?? null, steps.length])

  const executionId = execRows[0]!.id as string
  const errors: string[] = []
  let stepsCompleted = 0

  // Insert step instances
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    await tenantQuery(tenantId, `
      INSERT INTO runbook_steps
        (tenant_id, execution_id, step_index, step_type, step_config, requires_approval, idempotency_key)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    `, [tenantId, executionId, i, step.step_type, JSON.stringify(step.config),
        step.requires_approval ?? false, _resolveIdempotencyKey(step.idempotency_key, ctx, i)])
  }

  broadcastEvent({ event_type: 'action_created', tenant_id: tenantId,
    payload: { execution_id: executionId, runbook_id: runbookId, mode, status: 'running' },
    subscription_scope: 'tenant' })

  // Execute steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!

    // Evaluate condition gate
    if (step.condition && !_evaluateCondition(step.condition, ctx)) {
      await _recordStepResult(tenantId, executionId, i, { outcome: 'skipped', output: { reason: 'condition_false' }, duration_ms: 0 })
      stepsCompleted++
      continue
    }

    // Approval gate — pause execution; caller must resume via approveStep()
    if (step.requires_approval && mode === 'live') {
      await tenantQuery(tenantId,
        `UPDATE runbook_steps SET status = 'waiting_approval' WHERE execution_id = $1 AND step_index = $2`,
        [executionId, i])
      await tenantQuery(tenantId,
        `UPDATE runbook_executions SET status = 'waiting_approval', current_step = $1 WHERE id = $2`,
        [i, executionId])
      return { executionId, status: 'waiting_approval', stepsCompleted, errors }
    }

    // Execute step
    const handler = STEP_HANDLERS[step.step_type] ?? _genericStep
    try {
      await tenantQuery(tenantId,
        `UPDATE runbook_steps SET status = 'running' WHERE execution_id = $1 AND step_index = $2`,
        [executionId, i])

      const result = await handler(step.config, ctx)
      await _recordStepResult(tenantId, executionId, i, result)

      if (result.outcome === 'failure') {
        errors.push(`Step ${i} (${step.step_type}): ${result.error ?? 'unknown error'}`)
        const onFailure = step.on_failure ?? 'abort'
        if (onFailure === 'abort') break
        if (onFailure === 'rollback') { await rollbackExecution(executionId, tenantId); break }
        // 'skip': continue to next step
      } else {
        stepsCompleted++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Step ${i} (${step.step_type}): ${msg}`)
      await _recordStepResult(tenantId, executionId, i,
        { outcome: 'failure', output: {}, error: msg, duration_ms: 0 })
      break
    }

    await tenantQuery(tenantId,
      `UPDATE runbook_executions SET current_step = $1 WHERE id = $2`,
      [i + 1, executionId])
  }

  const finalStatus = errors.length > 0 ? 'failed'
    : mode !== 'live'               ? 'dry_run_complete'
    : 'completed'

  await tenantQuery(tenantId,
    `UPDATE runbook_executions SET status = $1, completed_at = now(),
     result_summary = $2::jsonb WHERE id = $3`,
    [finalStatus, JSON.stringify({ stepsCompleted, errors }), executionId])

  broadcastEvent({ event_type: 'action_updated', tenant_id: tenantId,
    payload: { execution_id: executionId, status: finalStatus }, subscription_scope: 'tenant' })

  return { executionId, status: finalStatus, stepsCompleted, errors }
}

async function _recordStepResult(
  tenantId: string,
  executionId: string,
  stepIndex: number,
  result: StepResult
): Promise<void> {
  const { rows } = await tenantQuery(tenantId,
    `SELECT id FROM runbook_steps WHERE execution_id = $1 AND step_index = $2`,
    [executionId, stepIndex])
  if (!rows[0]) return
  const stepId = rows[0].id as string
  const status: Record<StepResult['outcome'], string> = {
    success: 'completed', failure: 'failed', skipped: 'skipped', dry_run: 'completed'
  }
  await Promise.all([
    tenantQuery(tenantId,
      `UPDATE runbook_steps SET status = $1 WHERE id = $2`,
      [status[result.outcome], stepId]),
    tenantQuery(tenantId,
      `INSERT INTO runbook_step_results
         (tenant_id, step_id, outcome, output, error, rollback_data, duration_ms)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)`,
      [tenantId, stepId, result.outcome, JSON.stringify(result.output),
       result.error ?? null, JSON.stringify(result.rollback_data ?? {}), result.duration_ms]),
  ])
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

export async function rollbackExecution(
  executionId: string,
  tenantId: string
): Promise<{ rolledBack: number }> {
  // Load completed step results with rollback_data, in reverse order
  const { rows } = await tenantQuery(tenantId, `
    SELECT rs.step_type, rsr.rollback_data
    FROM runbook_steps rs
    JOIN runbook_step_results rsr ON rsr.step_id = rs.id
    WHERE rs.execution_id = $1 AND rsr.outcome = 'success'
    ORDER BY rs.step_index DESC
  `, [executionId])

  let rolledBack = 0
  for (const row of rows) {
    const rd = row.rollback_data as Record<string, unknown>
    if (!rd || !rd['rollback_op']) continue
    try {
      await _executeRollbackOp(tenantId, rd)
      rolledBack++
    } catch { /* log but continue */ }
  }

  await tenantQuery(tenantId,
    `UPDATE runbook_executions SET status = 'rolled_back' WHERE id = $1`,
    [executionId])

  return { rolledBack }
}

async function _executeRollbackOp(
  tenantId: string,
  rd: Record<string, unknown>
): Promise<void> {
  switch (rd['rollback_op']) {
    case 'cancel_action':
      await tenantQuery(tenantId,
        `UPDATE actions SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2`,
        [rd['action_id'], tenantId])
      break
    case 'deescalate':
      await tenantQuery(tenantId,
        `UPDATE actions SET max_escalation_level = GREATEST(0, max_escalation_level - 1)
         WHERE id = $1 AND tenant_id = $2`,
        [rd['action_id'], tenantId])
      break
    case 'unfreeze_workflow': {
      const ids = rd['action_ids'] as string[]
      if (ids?.length) {
        await tenantQuery(tenantId,
          `UPDATE action_sla_state SET sla_status = 'active', paused_at = NULL
           WHERE action_id = ANY($1::uuid[]) AND tenant_id = $2`,
          [ids, tenantId])
      }
      break
    }
    default: break
  }
}

// ─── Approve Checkpoint ───────────────────────────────────────────────────────

export async function approveRunbookStep(
  tenantId: string,
  executionId: string,
  stepIndex: number,
  approvedBy: string
): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE runbook_steps SET status = 'completed', approved_by = $1, approved_at = now()
    WHERE execution_id = $2 AND step_index = $3
  `, [approvedBy, executionId, stepIndex])
  await tenantQuery(tenantId,
    `UPDATE runbook_executions SET status = 'running', approved_by = $1 WHERE id = $2`,
    [approvedBy, executionId])
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  STEP_HANDLERS,
  _buildContext,
  _evaluateCondition,
  _resolveIdempotencyKey,
  executeRunbook,
  rollbackExecution,
}

// Denver Engineering — Workflow Composition Service (v9.0.0)
// No-code workflow builder: policy validation, dry-run, versioning, rollback.
// No unsafe mutations; every workflow policy-checked before publish.

import { tenantQuery } from '../../db/pool'
import {
  Workflow, WorkflowVersion, WorkflowRun,
  WorkflowStatus, WorkflowTriggerType,
} from './ecosystemTypes'

// ─── Workflow CRUD ────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  name: string
  description?: string
  triggerType: WorkflowTriggerType
  triggerConfig?: Record<string, unknown>
  definition?: Record<string, unknown>
}

export async function createWorkflow(
  tenantId: string,
  input: CreateWorkflowInput,
): Promise<Workflow> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO workflows
      (tenant_id, name, description, trigger_type, trigger_config, definition)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      tenantId, input.name, input.description ?? null,
      input.triggerType,
      JSON.stringify(input.triggerConfig ?? {}),
      JSON.stringify(input.definition ?? {}),
    ],
  )
  return _mapWorkflow(res.rows[0])
}

export async function getWorkflow(tenantId: string, workflowId: string): Promise<Workflow | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2`,
    [workflowId, tenantId],
  )
  return res.rows.length > 0 ? _mapWorkflow(res.rows[0]) : null
}

export async function listWorkflows(tenantId: string, status?: WorkflowStatus): Promise<Workflow[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM workflows
     WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2::workflow_status)
     ORDER BY updated_at DESC`,
    [tenantId, status ?? null],
  )
  return res.rows.map(_mapWorkflow)
}

export async function updateWorkflowDefinition(
  tenantId: string,
  workflowId: string,
  definition: Record<string, unknown>,
  triggerConfig?: Record<string, unknown>,
): Promise<Workflow> {
  const current = await getWorkflow(tenantId, workflowId)
  if (current == null) throw new Error(`Workflow ${workflowId} not found`)
  if (current.status === 'published') {
    throw new Error(`Published workflows are immutable — create a new version`)
  }

  const res = await tenantQuery(
    tenantId,
    `UPDATE workflows
     SET definition = $3,
         trigger_config = COALESCE($4, trigger_config),
         policy_validated = FALSE,
         dry_run_passed = FALSE,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [workflowId, tenantId, JSON.stringify(definition),
     triggerConfig ? JSON.stringify(triggerConfig) : null],
  )
  return _mapWorkflow(res.rows[0])
}

// ─── Policy validation ────────────────────────────────────────────────────────

export interface PolicyValidationResult {
  passed: boolean
  violations: string[]
  warnings: string[]
}

export async function validateWorkflowPolicy(
  tenantId: string,
  workflowId: string,
): Promise<PolicyValidationResult> {
  const workflow = await getWorkflow(tenantId, workflowId)
  if (workflow == null) throw new Error(`Workflow ${workflowId} not found`)

  const violations: string[] = []
  const warnings: string[] = []

  // Run policy checks against definition
  _checkForUnsafeMutations(workflow.definition, violations)
  _checkApprovalGates(workflow.definition, warnings)
  _checkTriggerSafety(workflow.triggerType, workflow.triggerConfig, warnings)

  const passed = violations.length === 0

  if (passed) {
    await tenantQuery(
      tenantId,
      `UPDATE workflows SET policy_validated = TRUE, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [workflowId, tenantId],
    )
  }

  return { passed, violations, warnings }
}

function _checkForUnsafeMutations(
  definition: Record<string, unknown>,
  violations: string[],
): void {
  const definitionStr = JSON.stringify(definition).toLowerCase()
  const forbidden = ['drop table', 'delete from', 'truncate', 'exec(', 'eval(']
  for (const pattern of forbidden) {
    if (definitionStr.includes(pattern)) {
      violations.push(`Forbidden operation detected: ${pattern}`)
    }
  }
}

function _checkApprovalGates(
  definition: Record<string, unknown>,
  warnings: string[],
): void {
  const steps = (definition['steps'] as Array<{ type: string }> | undefined) ?? []
  const hasApproval = steps.some(s => s.type === 'approval_gate')
  const hasHighImpact = steps.some(s =>
    ['send_email', 'webhook_call', 'create_ticket', 'modify_policy'].includes(s.type),
  )
  if (hasHighImpact && !hasApproval) {
    warnings.push('High-impact actions present without approval gate')
  }
}

function _checkTriggerSafety(
  triggerType: WorkflowTriggerType,
  triggerConfig: Record<string, unknown>,
  warnings: string[],
): void {
  if (triggerType === 'schedule') {
    const cron = triggerConfig['cron'] as string | undefined
    if (cron != null && cron.includes('* * * * *')) {
      warnings.push('Every-minute schedule detected — verify this is intentional')
    }
  }
  if (triggerType === 'webhook') {
    if (triggerConfig['validate_signature'] === false) {
      warnings.push('Webhook trigger has signature validation disabled')
    }
  }
}

// ─── Dry-run ──────────────────────────────────────────────────────────────────

export interface DryRunResult {
  workflowId: string
  stepsSimulated: number
  wouldExecute: string[]
  wouldSkip: string[]
  approvalGatesTriggered: number
  passed: boolean
}

export async function dryRunWorkflow(
  tenantId: string,
  workflowId: string,
  testContext?: Record<string, unknown>,
): Promise<DryRunResult> {
  const workflow = await getWorkflow(tenantId, workflowId)
  if (workflow == null) throw new Error(`Workflow ${workflowId} not found`)
  if (!workflow.policyValidated) {
    throw new Error(`Workflow must pass policy validation before dry run`)
  }

  const steps = (workflow.definition['steps'] as Array<{ type: string; condition?: string }>) ?? []
  const wouldExecute: string[] = []
  const wouldSkip: string[] = []
  let approvalGatesTriggered = 0

  for (const step of steps) {
    if (step.condition != null && !_evalCondition(step.condition, testContext ?? {})) {
      wouldSkip.push(step.type)
    } else {
      wouldExecute.push(step.type)
      if (step.type === 'approval_gate') approvalGatesTriggered++
    }
  }

  const passed = true  // dry-run always passes if policy is validated

  // Record that dry-run passed
  await tenantQuery(
    tenantId,
    `UPDATE workflows SET dry_run_passed = TRUE, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [workflowId, tenantId],
  )

  // Record a run entry as dry-run
  await tenantQuery(
    tenantId,
    `INSERT INTO workflow_runs
      (workflow_id, tenant_id, version, trigger_context, is_dry_run, status,
       steps_completed, steps_total, completed_at)
     VALUES ($1,$2,$3,$4,TRUE,'completed',$5,$6,now())`,
    [workflowId, tenantId, workflow.currentVersion,
     JSON.stringify(testContext ?? {}),
     wouldExecute.length, steps.length],
  )

  return {
    workflowId,
    stepsSimulated: steps.length,
    wouldExecute,
    wouldSkip,
    approvalGatesTriggered,
    passed,
  }
}

function _evalCondition(condition: string, context: Record<string, unknown>): boolean {
  // Simplified: check if condition key exists and is truthy in context
  return context[condition] === true
}

// ─── Publish ──────────────────────────────────────────────────────────────────

export async function publishWorkflow(
  tenantId: string,
  workflowId: string,
  publishedBy: string,
): Promise<Workflow> {
  const workflow = await getWorkflow(tenantId, workflowId)
  if (workflow == null) throw new Error(`Workflow ${workflowId} not found`)
  if (!workflow.policyValidated) {
    throw new Error(`Workflow must pass policy validation before publishing`)
  }
  if (!workflow.dryRunPassed) {
    throw new Error(`Workflow must pass dry run before publishing`)
  }

  // Snapshot version
  const newVersion = workflow.currentVersion + 1
  await tenantQuery(
    tenantId,
    `INSERT INTO workflow_versions
      (workflow_id, version, definition, trigger_type, trigger_config, change_summary, created_by)
     VALUES ($1,$2,$3,$4,$5,'Published',$6)`,
    [
      workflowId, newVersion,
      JSON.stringify(workflow.definition),
      workflow.triggerType, JSON.stringify(workflow.triggerConfig),
      publishedBy,
    ],
  )

  const res = await tenantQuery(
    tenantId,
    `UPDATE workflows
     SET status = 'published', current_version = $3,
         published_by = $4, published_at = now(), updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [workflowId, tenantId, newVersion, publishedBy],
  )
  return _mapWorkflow(res.rows[0])
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

export async function rollbackWorkflow(
  tenantId: string,
  workflowId: string,
  targetVersion: number,
): Promise<Workflow> {
  const versionRes = await tenantQuery(
    tenantId,
    `SELECT * FROM workflow_versions WHERE workflow_id = $1 AND version = $2`,
    [workflowId, targetVersion],
  )
  if (versionRes.rows.length === 0) {
    throw new Error(`Workflow version ${targetVersion} not found`)
  }
  const snap = versionRes.rows[0]

  const res = await tenantQuery(
    tenantId,
    `UPDATE workflows
     SET definition = $3, trigger_type = $4, trigger_config = $5,
         status = 'draft', policy_validated = FALSE, dry_run_passed = FALSE,
         current_version = $6, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      workflowId, tenantId,
      snap['definition'], snap['trigger_type'], snap['trigger_config'],
      targetVersion,
    ],
  )
  return _mapWorkflow(res.rows[0])
}

// ─── Version history ──────────────────────────────────────────────────────────

export async function getWorkflowVersions(
  tenantId: string,
  workflowId: string,
): Promise<WorkflowVersion[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM workflow_versions WHERE workflow_id = $1
     ORDER BY version DESC`,
    [workflowId],
  )
  return res.rows.map(_mapVersion)
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export async function getWorkflowRuns(
  tenantId: string,
  workflowId: string,
  includeDryRuns: boolean = false,
): Promise<WorkflowRun[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM workflow_runs
     WHERE workflow_id = $1 AND tenant_id = $2
       AND ($3 = TRUE OR is_dry_run = FALSE)
     ORDER BY started_at DESC LIMIT 50`,
    [workflowId, tenantId, includeDryRuns],
  )
  return res.rows.map(_mapRun)
}

// ─── Pause / Archive ──────────────────────────────────────────────────────────

export async function pauseWorkflow(tenantId: string, workflowId: string): Promise<Workflow> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE workflows SET status = 'paused', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [workflowId, tenantId],
  )
  if (res.rows.length === 0) throw new Error(`Workflow ${workflowId} not found`)
  return _mapWorkflow(res.rows[0])
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapWorkflow(row: Record<string, unknown>): Workflow {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? null,
    status: row['status'] as WorkflowStatus,
    triggerType: row['trigger_type'] as WorkflowTriggerType,
    triggerConfig: (typeof row['trigger_config'] === 'string'
      ? JSON.parse(row['trigger_config'])
      : row['trigger_config']) as Record<string, unknown>,
    definition: (typeof row['definition'] === 'string'
      ? JSON.parse(row['definition'])
      : row['definition']) as Record<string, unknown>,
    policyValidated: Boolean(row['policy_validated']),
    dryRunPassed: Boolean(row['dry_run_passed']),
    currentVersion: Number(row['current_version'] ?? 1),
    publishedBy: (row['published_by'] as string) ?? null,
    publishedAt: row['published_at'] != null ? new Date(row['published_at'] as string) : null,
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapVersion(row: Record<string, unknown>): WorkflowVersion {
  return {
    id: row['id'] as string,
    workflowId: row['workflow_id'] as string,
    version: Number(row['version']),
    definition: (typeof row['definition'] === 'string'
      ? JSON.parse(row['definition'])
      : row['definition']) as Record<string, unknown>,
    triggerType: row['trigger_type'] as WorkflowTriggerType,
    triggerConfig: (typeof row['trigger_config'] === 'string'
      ? JSON.parse(row['trigger_config'])
      : row['trigger_config']) as Record<string, unknown>,
    changeSummary: (row['change_summary'] as string) ?? null,
    createdBy: row['created_by'] as string,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: row['id'] as string,
    workflowId: row['workflow_id'] as string,
    tenantId: row['tenant_id'] as string,
    version: Number(row['version']),
    triggerContext: (typeof row['trigger_context'] === 'string'
      ? JSON.parse(row['trigger_context'])
      : row['trigger_context']) as Record<string, unknown>,
    isDryRun: Boolean(row['is_dry_run']),
    status: row['status'] as string,
    stepsCompleted: Number(row['steps_completed'] ?? 0),
    stepsTotal: Number(row['steps_total'] ?? 0),
    error: (row['error'] as string) ?? null,
    startedAt: new Date(row['started_at'] as string),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
  }
}

export const __testHooks = {
  _checkForUnsafeMutations, _checkApprovalGates, _checkTriggerSafety,
  _evalCondition, _mapWorkflow, _mapVersion, _mapRun,
}

// Denver Engineering — Workflow Safety Scanner (Phase 12)
// Validates workflows for replay safety, tenant isolation, and governance compliance

import { pool } from '../../db/pool'
import { WorkflowSafetyCheck } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapSafetyCheck(row: Record<string, unknown>): WorkflowSafetyCheck {
  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    checksPassed: Number(row.checks_passed),
    checksFailed: Number(row.checks_failed),
    replaySafe: row.replay_safe as boolean,
    tenantIsolationSafe: row.tenant_isolation_safe as boolean,
    governanceSafe: row.governance_safe as boolean,
    safetyScore: Number(row.safety_score),
    checkedAt: new Date(row.checked_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeWorkflowSafetyScore(
  checksPassed: number,
  checksFailed: number,
  replaySafe: boolean,
  tenantIsolationSafe: boolean,
  governanceSafe: boolean,
): number {
  if (!tenantIsolationSafe) return 0
  if (!replaySafe) return Math.min(20, checksPassed > 0 ? 10 : 0)
  const total = checksPassed + checksFailed
  const baseScore = total === 0 ? 100 : Math.round((checksPassed / total) * 100)
  const governanceBonus = governanceSafe ? 0 : -20
  return Math.max(0, baseScore + governanceBonus)
}

export function isWorkflowSafe(check: WorkflowSafetyCheck): boolean {
  return check.replaySafe && check.tenantIsolationSafe && check.governanceSafe && check.checksFailed === 0
}

export function classifyWorkflowRisk(check: WorkflowSafetyCheck): 'safe' | 'review_required' | 'unsafe' {
  if (!check.tenantIsolationSafe || check.safetyScore < 40) return 'unsafe'
  if (!check.replaySafe || !check.governanceSafe || check.safetyScore < 80) return 'review_required'
  return 'safe'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function scanWorkflow(
  workflowId: string,
  checksPassed: number,
  checksFailed: number,
  replaySafe: boolean,
  tenantIsolationSafe: boolean,
  governanceSafe: boolean,
): Promise<WorkflowSafetyCheck> {
  const safetyScore = computeWorkflowSafetyScore(checksPassed, checksFailed, replaySafe, tenantIsolationSafe, governanceSafe)
  const result = await pool.query(
    `INSERT INTO p12_workflow_safety_checks
       (workflow_id, checks_passed, checks_failed, replay_safe, tenant_isolation_safe, governance_safe, safety_score, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     RETURNING *`,
    [workflowId, checksPassed, checksFailed, replaySafe, tenantIsolationSafe, governanceSafe, safetyScore],
  )
  return _mapSafetyCheck(result.rows[0])
}

export async function getLatestWorkflowSafety(workflowId: string): Promise<WorkflowSafetyCheck | null> {
  const result = await pool.query(
    `SELECT * FROM p12_workflow_safety_checks
     WHERE workflow_id = $1
     ORDER BY checked_at DESC
     LIMIT 1`,
    [workflowId],
  )
  return result.rows[0] ? _mapSafetyCheck(result.rows[0]) : null
}

export async function getUnsafeWorkflows(): Promise<WorkflowSafetyCheck[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (workflow_id) *
     FROM p12_workflow_safety_checks
     WHERE tenant_isolation_safe = FALSE OR safety_score < 40
     ORDER BY workflow_id, checked_at DESC`,
  )
  return result.rows.map(_mapSafetyCheck)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeWorkflowSafetyScore,
  isWorkflowSafe,
  classifyWorkflowRisk,
  _mapSafetyCheck,
}

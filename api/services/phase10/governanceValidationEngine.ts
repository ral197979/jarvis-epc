// Denver Engineering — Governance Validation Engine (v10.0.0)
// Validates AI governance controls: audit completeness, policy coverage, traceability.

import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  GovernanceValidationRun, GovernanceValidationResult,
  GovernanceDimension, GovernanceOutcome,
} from './phase10Types'

// ─── Validation runs ──────────────────────────────────────────────────────────

export async function createGovernanceRun(
  environment: string,
  triggeredBy: string,
): Promise<GovernanceValidationRun> {
  const res = await pool.query(
    `INSERT INTO governance_validation_runs
      (environment, triggered_by, overall_outcome, dimension_count,
       passed_count, failed_count, warned_count)
     VALUES ($1,$2,'pending',0,0,0,0)
     RETURNING *`,
    [environment, triggeredBy],
  )
  return _mapRun(res.rows[0])
}

export async function recordGovernanceResult(
  runId: string,
  dimension: GovernanceDimension,
  outcome: GovernanceOutcome,
  score: number,
  detail: string,
  evidence: string[] = [],
  gaps: string[] = [],
): Promise<GovernanceValidationResult> {
  const res = await pool.query(
    `INSERT INTO governance_validation_results
      (run_id, dimension, outcome, score, detail, evidence, gaps, validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     RETURNING *`,
    [
      runId, dimension, outcome, score, detail,
      JSON.stringify(evidence), JSON.stringify(gaps),
    ],
  )
  return _mapResult(res.rows[0])
}

export async function finalizeGovernanceRun(
  runId: string,
): Promise<GovernanceValidationRun> {
  const countRes = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN outcome = 'pass' THEN 1 ELSE 0 END)::int AS passed,
       SUM(CASE WHEN outcome = 'fail' THEN 1 ELSE 0 END)::int AS failed,
       SUM(CASE WHEN outcome = 'warn' THEN 1 ELSE 0 END)::int AS warned
     FROM governance_validation_results WHERE run_id = $1`,
    [runId],
  )
  const r = countRes.rows[0]
  const failed = Number(r['failed'] ?? 0)
  const warned = Number(r['warned'] ?? 0)
  const overallOutcome: GovernanceOutcome =
    failed > 0 ? 'fail' : warned > 0 ? 'warn' : 'pass'

  const res = await pool.query(
    `UPDATE governance_validation_runs
     SET overall_outcome = $2, dimension_count = $3,
         passed_count = $4, failed_count = $5, warned_count = $6,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      runId, overallOutcome, Number(r['total']),
      Number(r['passed'] ?? 0), failed, warned,
    ],
  )
  return _mapRun(res.rows[0])
}

export async function getGovernanceRun(
  runId: string,
): Promise<GovernanceValidationRun | null> {
  const res = await pool.query(
    `SELECT * FROM governance_validation_runs WHERE id = $1`,
    [runId],
  )
  return res.rows.length > 0 ? _mapRun(res.rows[0]) : null
}

export async function getGovernanceResults(
  runId: string,
): Promise<GovernanceValidationResult[]> {
  const res = await pool.query(
    `SELECT * FROM governance_validation_results WHERE run_id = $1
     ORDER BY outcome DESC, dimension`,
    [runId],
  )
  return res.rows.map(_mapResult)
}

export async function listGovernanceRuns(
  environment?: string,
  limit = 10,
): Promise<GovernanceValidationRun[]> {
  const res = await pool.query(
    `SELECT * FROM governance_validation_runs
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapRun)
}

// ─── Built-in governance checks ───────────────────────────────────────────────

export async function checkAuditLogCompleteness(
  runId: string,
  tenantId: string,
): Promise<GovernanceValidationResult> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT COUNT(*) AS cnt FROM audit_log
       WHERE created_at > now() - interval '7 days'`,
      [],
    )
    const count = Number(res.rows[0]?.['cnt'] ?? 0)
    const outcome: GovernanceOutcome = count > 100 ? 'pass' : count > 0 ? 'warn' : 'fail'
    return recordGovernanceResult(
      runId, 'audit_completeness', outcome,
      outcome === 'pass' ? 95 : outcome === 'warn' ? 60 : 10,
      `${count} audit events in past 7 days`,
      count > 0 ? [`${count} audit events found`] : [],
      count === 0 ? ['No audit events recorded — audit pipeline may be broken'] : [],
    )
  } catch {
    return recordGovernanceResult(
      runId, 'audit_completeness', 'warn', 50,
      'Audit log check skipped — table unavailable', [], [],
    )
  }
}

export async function checkPolicyCoverage(
  runId: string,
): Promise<GovernanceValidationResult> {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM pg_policies
     WHERE schemaname = 'public'`,
  )
  const count = Number(res.rows[0]?.['cnt'] ?? 0)
  const outcome: GovernanceOutcome = count >= 10 ? 'pass' : count >= 5 ? 'warn' : 'fail'
  return recordGovernanceResult(
    runId, 'policy_coverage', outcome,
    outcome === 'pass' ? 100 : outcome === 'warn' ? 65 : 20,
    `${count} RLS policies active`,
    [`${count} active policies across public schema`],
    count < 10 ? ['Ensure all multi-tenant tables have RLS policies'] : [],
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeGovernanceScore(
  passedCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) return 100
  return Math.round((passedCount / totalCount) * 100)
}

export function isGovernanceCompliant(run: GovernanceValidationRun): boolean {
  return run.overallOutcome === 'pass' && run.failedCount === 0
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRun,
  _mapResult,
  computeGovernanceScore,
  isGovernanceCompliant,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapRun(row: Record<string, unknown>): GovernanceValidationRun {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    triggeredBy: row['triggered_by'] as string,
    overallOutcome: row['overall_outcome'] as GovernanceOutcome,
    dimensionCount: Number(row['dimension_count'] ?? 0),
    passedCount: Number(row['passed_count'] ?? 0),
    failedCount: Number(row['failed_count'] ?? 0),
    warnedCount: Number(row['warned_count'] ?? 0),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapResult(row: Record<string, unknown>): GovernanceValidationResult {
  return {
    id: row['id'] as string,
    runId: row['run_id'] as string,
    dimension: row['dimension'] as GovernanceDimension,
    outcome: row['outcome'] as GovernanceOutcome,
    score: Number(row['score']),
    detail: row['detail'] as string,
    evidence: (typeof row['evidence'] === 'string'
      ? JSON.parse(row['evidence'] as string)
      : row['evidence']) as string[],
    gaps: (typeof row['gaps'] === 'string'
      ? JSON.parse(row['gaps'] as string)
      : row['gaps']) as string[],
    validatedAt: new Date(row['validated_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}

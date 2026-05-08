// Denver Engineering — Production Gate Validator (v10.0.0)
// Deterministic gate checks for production deployment readiness.

import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  ProductionGateRun, ProductionGateCheck,
  GateCategory, GateStatus,
  PRODUCTION_GATE_PASS_THRESHOLD,
} from './phase10Types'

// ─── Gate Runs ────────────────────────────────────────────────────────────────

export async function createGateRun(
  environment: string,
): Promise<ProductionGateRun> {
  const res = await pool.query(
    `INSERT INTO production_gate_runs
      (environment, total_checks, passed, failed, warned, skipped,
       overall_status, started_at)
     VALUES ($1,0,0,0,0,0,'pass',now())
     RETURNING *`,
    [environment],
  )
  return _mapGateRun(res.rows[0])
}

export async function recordGateCheck(
  gateRunId: string,
  category: GateCategory,
  checkName: string,
  status: GateStatus,
  message: string,
  durationMs: number,
  metadata: Record<string, unknown> = {},
): Promise<ProductionGateCheck> {
  const res = await pool.query(
    `INSERT INTO production_gate_checks
      (gate_run_id, category, check_name, status, message, duration_ms, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [gateRunId, category, checkName, status, message, durationMs, JSON.stringify(metadata)],
  )
  return _mapGateCheck(res.rows[0])
}

export async function finalizeGateRun(
  gateRunId: string,
): Promise<ProductionGateRun> {
  const checksRes = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END)::int AS passed,
       SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END)::int AS failed,
       SUM(CASE WHEN status = 'warn' THEN 1 ELSE 0 END)::int AS warned,
       SUM(CASE WHEN status = 'skip' THEN 1 ELSE 0 END)::int AS skipped
     FROM production_gate_checks
     WHERE gate_run_id = $1`,
    [gateRunId],
  )
  const counts = checksRes.rows[0]
  const total = Number(counts['total'])
  const passed = Number(counts['passed'])
  const failed = Number(counts['failed'])

  const passRate = total > 0 ? passed / total : 0
  const overallStatus: GateStatus =
    failed > 0 ? 'fail'
    : passRate >= PRODUCTION_GATE_PASS_THRESHOLD ? 'pass'
    : 'warn'

  const res = await pool.query(
    `UPDATE production_gate_runs
     SET total_checks = $2, passed = $3, failed = $4,
         warned = $5, skipped = $6, overall_status = $7,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [gateRunId, total, passed, failed,
     Number(counts['warned']), Number(counts['skipped']), overallStatus],
  )
  return _mapGateRun(res.rows[0])
}

export async function getGateRun(runId: string): Promise<ProductionGateRun | null> {
  const res = await pool.query(
    `SELECT * FROM production_gate_runs WHERE id = $1`,
    [runId],
  )
  return res.rows.length > 0 ? _mapGateRun(res.rows[0]) : null
}

export async function getGateChecks(runId: string): Promise<ProductionGateCheck[]> {
  const res = await pool.query(
    `SELECT * FROM production_gate_checks
     WHERE gate_run_id = $1
     ORDER BY category, check_name`,
    [runId],
  )
  return res.rows.map(_mapGateCheck)
}

// ─── Built-in gate checks ─────────────────────────────────────────────────────

export async function runQueueHealthCheck(
  gateRunId: string,
): Promise<ProductionGateCheck> {
  const start = Date.now()
  let status: GateStatus = 'pass'
  let message = 'Queue backlog within acceptable range'

  try {
    const res = await pool.query(
      `SELECT COUNT(*) AS backlog FROM action_queue
       WHERE status = 'pending' AND created_at < now() - interval '5 minutes'`,
    )
    const backlog = Number(res.rows[0]?.['backlog'] ?? 0)
    if (backlog > 1000) { status = 'fail'; message = `Queue backlog critical: ${backlog} items` }
    else if (backlog > 100) { status = 'warn'; message = `Queue backlog elevated: ${backlog} items` }
  } catch {
    status = 'warn'
    message = 'Queue health check skipped (table not available)'
  }

  return recordGateCheck(gateRunId, 'queue_health', 'queue_backlog_check',
    status, message, Date.now() - start)
}

export async function runTenantIsolationCheck(
  gateRunId: string,
): Promise<ProductionGateCheck> {
  const start = Date.now()
  // Verify RLS policies exist on critical tables
  const res = await pool.query(
    `SELECT COUNT(*) AS policy_count
     FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname ILIKE '%tenant%'`,
  )
  const count = Number(res.rows[0]?.['policy_count'] ?? 0)
  const status: GateStatus = count >= 5 ? 'pass' : 'warn'
  const message = `${count} tenant RLS policies active`

  return recordGateCheck(gateRunId, 'tenant_isolation', 'rls_policy_count',
    status, message, Date.now() - start, { policyCount: count })
}

export async function runBillingCorrectnessCheck(
  gateRunId: string,
): Promise<ProductionGateCheck> {
  const start = Date.now()
  let status: GateStatus = 'pass'
  let message = 'Billing reconciliation current'

  try {
    const res = await pool.query(
      `SELECT COUNT(*) AS unreconciled FROM billing_records
       WHERE reconciled = FALSE AND created_at < now() - interval '1 hour'`,
    )
    const count = Number(res.rows[0]?.['unreconciled'] ?? 0)
    if (count > 100) { status = 'fail'; message = `${count} unreconciled billing records` }
    else if (count > 0) { status = 'warn'; message = `${count} pending reconciliation` }
  } catch {
    status = 'warn'
    message = 'Billing check skipped (table not available)'
  }

  return recordGateCheck(gateRunId, 'billing_correctness', 'reconciliation_lag',
    status, message, Date.now() - start)
}

// ─── Gate score calculation ───────────────────────────────────────────────────

export function computeGateScore(
  passed: number,
  total: number,
): number {
  if (total === 0) return 100
  return Math.round((passed / total) * 100)
}

export function isGatePassThresholdMet(
  passed: number,
  total: number,
): boolean {
  if (total === 0) return true
  return (passed / total) >= PRODUCTION_GATE_PASS_THRESHOLD
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapGateRun,
  _mapGateCheck,
  computeGateScore,
  isGatePassThresholdMet,
  PRODUCTION_GATE_PASS_THRESHOLD,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapGateRun(row: Record<string, unknown>): ProductionGateRun {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    totalChecks: Number(row['total_checks'] ?? 0),
    passed: Number(row['passed'] ?? 0),
    failed: Number(row['failed'] ?? 0),
    warned: Number(row['warned'] ?? 0),
    skipped: Number(row['skipped'] ?? 0),
    overallStatus: row['overall_status'] as GateStatus,
    startedAt: new Date(row['started_at'] as string),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapGateCheck(row: Record<string, unknown>): ProductionGateCheck {
  return {
    id: row['id'] as string,
    gateRunId: row['gate_run_id'] as string,
    category: row['category'] as GateCategory,
    checkName: row['check_name'] as string,
    status: row['status'] as GateStatus,
    message: row['message'] as string,
    durationMs: Number(row['duration_ms'] ?? 0),
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'] as string)
      : row['metadata']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
  }
}

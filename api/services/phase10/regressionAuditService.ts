/* eslint-disable @typescript-eslint/no-unused-vars */
// Denver Engineering — Regression Audit Service (v10.0.0)
// Tracks, classifies, and reports on test failures across CI runs.

import { createHash } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  RegressionAuditRun, RegressionFailure, FailureClassification,
  FLAKY_FLIP_THRESHOLD,
} from './phase10Types'

// ─── Audit Run CRUD ───────────────────────────────────────────────────────────

export interface CreateAuditRunInput {
  runLabel: string
  totalTests: number
  passed: number
  failed: number
  skipped?: number
  environment?: string
  commitSha?: string
}

export async function createAuditRun(
  input: CreateAuditRunInput,
): Promise<RegressionAuditRun> {
  const res = await pool.query(
    `INSERT INTO regression_audit_runs
      (run_label, total_tests, passed, failed, skipped,
       new_failures, pre_existing_failures, flaky_count,
       environment, commit_sha, started_at)
     VALUES ($1,$2,$3,$4,$5,0,0,0,$6,$7,now())
     RETURNING *`,
    [
      input.runLabel, input.totalTests, input.passed, input.failed,
      input.skipped ?? 0,
      input.environment ?? 'ci',
      input.commitSha ?? null,
    ],
  )
  return _mapRun(res.rows[0])
}

export async function completeAuditRun(runId: string): Promise<RegressionAuditRun> {
  const res = await pool.query(
    `UPDATE regression_audit_runs
     SET completed_at = now(),
         new_failures = (
           SELECT COUNT(*) FROM regression_failures
           WHERE audit_run_id = $1 AND is_new = TRUE
         ),
         pre_existing_failures = (
           SELECT COUNT(*) FROM regression_failures
           WHERE audit_run_id = $1 AND is_new = FALSE
         ),
         flaky_count = (
           SELECT COUNT(*) FROM regression_failures
           WHERE audit_run_id = $1 AND classification = 'environment_flaky'
         )
     WHERE id = $1
     RETURNING *`,
    [runId],
  )
  if (res.rows.length === 0) throw new Error(`Audit run ${runId} not found`)
  return _mapRun(res.rows[0])
}

export async function getAuditRun(runId: string): Promise<RegressionAuditRun | null> {
  const res = await pool.query(
    `SELECT * FROM regression_audit_runs WHERE id = $1`,
    [runId],
  )
  return res.rows.length > 0 ? _mapRun(res.rows[0]) : null
}

export async function listAuditRuns(
  environment?: string,
  limit = 20,
): Promise<RegressionAuditRun[]> {
  const res = await pool.query(
    `SELECT * FROM regression_audit_runs
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapRun)
}

// ─── Failure Recording ────────────────────────────────────────────────────────

export interface RecordFailureInput {
  testFile: string
  testName: string
  classification: FailureClassification
  errorMessage: string
  stackTrace?: string
}

export async function recordFailure(
  runId: string,
  input: RecordFailureInput,
): Promise<RegressionFailure> {
  // Check if this failure has been seen before (across runs)
  const priorRes = await pool.query(
    `SELECT id, occurrence_count FROM regression_failures
     WHERE test_file = $1 AND test_name = $2 AND is_new = FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [input.testFile, input.testName],
  )
  const isNew = priorRes.rows.length === 0

  const res = await pool.query(
    `INSERT INTO regression_failures
      (audit_run_id, test_file, test_name, classification,
       error_message, stack_trace, is_new, first_seen_at, occurrence_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)
     RETURNING *`,
    [
      runId, input.testFile, input.testName, input.classification,
      input.errorMessage, input.stackTrace ?? null,
      isNew, isNew ? 1 : (Number(priorRes.rows[0]?.occurrence_count ?? 0) + 1),
    ],
  )
  return _mapFailure(res.rows[0])
}

export async function resolveFailure(failureId: string): Promise<void> {
  await pool.query(
    `UPDATE regression_failures SET resolved_at = now() WHERE id = $1`,
    [failureId],
  )
}

export async function getRunFailures(runId: string): Promise<RegressionFailure[]> {
  const res = await pool.query(
    `SELECT * FROM regression_failures WHERE audit_run_id = $1
     ORDER BY classification, test_file, test_name`,
    [runId],
  )
  return res.rows.map(_mapFailure)
}

// ─── Classification helpers ───────────────────────────────────────────────────

export function classifyFailure(
  errorMessage: string,
  isRecurring: boolean,
): FailureClassification {
  const lower = errorMessage.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('cannot find module') || lower.includes('import')) return 'dependency_drift'
  if (lower.includes('setup') || lower.includes('before')) return 'setup_error'
  if (lower.includes('flaky') || lower.includes('nondeterministic')) return 'environment_flaky'
  if (isRecurring) return 'pre_existing'
  if (lower.includes('determinism') || lower.includes('replay')) return 'determinism_failure'
  return 'new_regression'
}

export function generateRegressionHash(testFile: string, testName: string): string {
  return createHash('sha256').update(`${testFile}::${testName}`).digest('hex').slice(0, 16)
}

// ─── Report generation ────────────────────────────────────────────────────────

export interface RegressionReport {
  run: RegressionAuditRun
  failures: RegressionFailure[]
  byClassification: Record<string, number>
  newFailureRate: number
  resolvedCount: number
}

export async function generateRegressionReport(
  runId: string,
): Promise<RegressionReport> {
  const run = await getAuditRun(runId)
  if (run == null) throw new Error(`Audit run ${runId} not found`)

  const failures = await getRunFailures(runId)

  const byClassification: Record<string, number> = {}
  for (const f of failures) {
    byClassification[f.classification] = (byClassification[f.classification] ?? 0) + 1
  }

  const resolvedCount = failures.filter(f => f.resolvedAt != null).length
  const newFailureRate = run.totalTests > 0
    ? run.newFailures / run.totalTests
    : 0

  return { run, failures, byClassification, newFailureRate, resolvedCount }
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRun,
  _mapFailure,
  classifyFailure,
  generateRegressionHash,
  FLAKY_FLIP_THRESHOLD,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapRun(row: Record<string, unknown>): RegressionAuditRun {
  return {
    id: row['id'] as string,
    runLabel: row['run_label'] as string,
    totalTests: Number(row['total_tests']),
    passed: Number(row['passed']),
    failed: Number(row['failed']),
    skipped: Number(row['skipped'] ?? 0),
    newFailures: Number(row['new_failures'] ?? 0),
    preExistingFailures: Number(row['pre_existing_failures'] ?? 0),
    flakyCount: Number(row['flaky_count'] ?? 0),
    startedAt: new Date(row['started_at'] as string),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    environment: row['environment'] as string,
    commitSha: (row['commit_sha'] as string) ?? null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapFailure(row: Record<string, unknown>): RegressionFailure {
  return {
    id: row['id'] as string,
    auditRunId: row['audit_run_id'] as string,
    testFile: row['test_file'] as string,
    testName: row['test_name'] as string,
    classification: row['classification'] as FailureClassification,
    errorMessage: row['error_message'] as string,
    stackTrace: (row['stack_trace'] as string) ?? null,
    isNew: Boolean(row['is_new']),
    firstSeenAt: new Date(row['first_seen_at'] as string),
    occurrenceCount: Number(row['occurrence_count'] ?? 1),
    resolvedAt: row['resolved_at'] != null ? new Date(row['resolved_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

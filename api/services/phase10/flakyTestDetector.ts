// Denver Engineering — Flaky Test Detector (v10.0.0)
// Detects non-deterministic tests by tracking outcome flips across runs.

import { pool } from '../../db/pool'
import {
  TestRunOutcome, FlakyTestReport, TestOutcome,
  FLAKY_FLIP_THRESHOLD,
} from './phase10Types'

// ─── Outcome Recording ────────────────────────────────────────────────────────

export interface RecordOutcomeInput {
  testFile: string
  testName: string
  outcome: TestOutcome
  durationMs: number
  runId: string
  environment?: string
}

export async function recordTestOutcome(
  input: RecordOutcomeInput,
): Promise<TestRunOutcome> {
  const res = await pool.query(
    `INSERT INTO test_run_outcomes
      (test_file, test_name, outcome, duration_ms, run_id, environment)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      input.testFile, input.testName, input.outcome,
      input.durationMs, input.runId,
      input.environment ?? 'ci',
    ],
  )
  return _mapOutcome(res.rows[0])
}

export async function getTestHistory(
  testFile: string,
  testName: string,
  limit = 20,
): Promise<TestRunOutcome[]> {
  const res = await pool.query(
    `SELECT * FROM test_run_outcomes
     WHERE test_file = $1 AND test_name = $2
     ORDER BY created_at DESC LIMIT $3`,
    [testFile, testName, limit],
  )
  return res.rows.map(_mapOutcome)
}

// ─── Flakiness Analysis ───────────────────────────────────────────────────────

export async function analyzeFlakiness(
  testFile: string,
  testName: string,
  windowRuns = 20,
): Promise<FlakyTestReport> {
  const outcomes = await getTestHistory(testFile, testName, windowRuns)
  const flips = countFlips(outcomes.map(o => o.outcome))
  const totalRuns = outcomes.length
  const passCount = outcomes.filter(o => o.outcome === 'pass').length
  const passRate = totalRuns > 0 ? passCount / totalRuns : 1.0
  const isFlaky = flips >= FLAKY_FLIP_THRESHOLD

  return {
    testFile,
    testName,
    flipCount: flips,
    totalRuns,
    passRate,
    lastSeen: outcomes[0]?.createdAt ?? new Date(),
    isFlaky,
  }
}

export async function listFlakyTests(
  environment?: string,
  minFlips = FLAKY_FLIP_THRESHOLD,
): Promise<FlakyTestReport[]> {
  const res = await pool.query(
    `SELECT
       test_file, test_name,
       COUNT(*) AS total_runs,
       SUM(CASE WHEN outcome = 'pass' THEN 1 ELSE 0 END)::int AS pass_count,
       MAX(created_at) AS last_seen
     FROM test_run_outcomes
     WHERE ($1::text IS NULL OR environment = $1)
     GROUP BY test_file, test_name
     HAVING COUNT(*) >= 2`,
    [environment ?? null],
  )

  const reports: FlakyTestReport[] = []
  for (const row of res.rows) {
    const testFile = row['test_file'] as string
    const testName = row['test_name'] as string
    const outcomes = await getTestHistory(testFile, testName, 20)
    const flips = countFlips(outcomes.map(o => o.outcome))
    if (flips >= minFlips) {
      const totalRuns = Number(row['total_runs'])
      const passCount = Number(row['pass_count'])
      reports.push({
        testFile,
        testName,
        flipCount: flips,
        totalRuns,
        passRate: totalRuns > 0 ? passCount / totalRuns : 1.0,
        lastSeen: new Date(row['last_seen'] as string),
        isFlaky: true,
      })
    }
  }
  return reports
}

export async function markFlakyResolved(
  testFile: string,
  testName: string,
): Promise<void> {
  await pool.query(
    `UPDATE test_run_outcomes SET resolved = TRUE
     WHERE test_file = $1 AND test_name = $2`,
    [testFile, testName],
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function countFlips(outcomes: TestOutcome[]): number {
  if (outcomes.length < 2) return 0
  let flips = 0
  for (let i = 1; i < outcomes.length; i++) {
    const prev = outcomes[i - 1]
    const curr = outcomes[i]
    const prevBinary = prev === 'pass' ? 'pass' : 'fail'
    const currBinary = curr === 'pass' ? 'pass' : 'fail'
    if (prevBinary !== currBinary) flips++
  }
  return flips
}

export function isConsistentlyFailing(outcomes: TestOutcome[]): boolean {
  if (outcomes.length === 0) return false
  return outcomes.every(o => o !== 'pass')
}

export function computePassRate(outcomes: TestOutcome[]): number {
  if (outcomes.length === 0) return 1.0
  return outcomes.filter(o => o === 'pass').length / outcomes.length
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapOutcome,
  countFlips,
  isConsistentlyFailing,
  computePassRate,
  FLAKY_FLIP_THRESHOLD,
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapOutcome(row: Record<string, unknown>): TestRunOutcome {
  return {
    id: row['id'] as string,
    testFile: row['test_file'] as string,
    testName: row['test_name'] as string,
    outcome: row['outcome'] as TestOutcome,
    durationMs: Number(row['duration_ms']),
    runId: row['run_id'] as string,
    environment: row['environment'] as string,
    createdAt: new Date(row['created_at'] as string),
  }
}

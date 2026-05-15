// Denver Engineering — Phase 10 Tests Part A (v10.0.0)
// Tests: regressionAuditService, flakyTestDetector, replayVerificationRunner,
//        productionGateValidator, operationalReadinessScanner, deploymentAuditEngine

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Static mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => {
  const mockPool = { query: vi.fn() }
  return {
    pool: mockPool,
    tenantQuery: vi.fn(),
  }
})

import { pool as mockPool, tenantQuery } from '../../../api/db/pool'
import {
  createAuditRun, completeAuditRun, getAuditRun, listAuditRuns,
  recordFailure, resolveFailure, getRunFailures,
  generateRegressionReport,
  __testHooks as regressionHooks,
} from '../../../api/services/phase10/regressionAuditService'

import {
  recordTestOutcome, getTestHistory, analyzeFlakiness, listFlakyTests,
  markFlakyResolved,
  __testHooks as flakyHooks,
} from '../../../api/services/phase10/flakyTestDetector'

import {
  startVerification, recordReplayPass, completeVerification,
  getVerificationRun, listVerificationRuns, verifyTenantReplay,
  __testHooks as replayHooks,
} from '../../../api/services/phase10/replayVerificationRunner'

import {
  createGateRun, recordGateCheck, finalizeGateRun, getGateRun, getGateChecks,
  runQueueHealthCheck, runTenantIsolationCheck, runBillingCorrectnessCheck,
  __testHooks as gateHooks,
} from '../../../api/services/phase10/productionGateValidator'

import {
  createScan, recordDimensionResult, finalizeScan, getScan, getScanResults, listScans,
  __testHooks as readinessHooks,
} from '../../../api/services/phase10/operationalReadinessScanner'

import {
  createDeploymentAudit, updateDeploymentStatus, getDeploymentAudit,
  listDeploymentAudits, getLatestDeployment, checkMigrationSafety,
  __testHooks as deploymentHooks,
} from '../../../api/services/phase10/deploymentAuditEngine'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mp = vi.mocked(mockPool)
const mTQ = vi.mocked(tenantQuery)

function mockRow<T>(row: T) {
  mp.query.mockResolvedValueOnce({ rows: [row] } as never)
}

function mockRows<T>(rows: T[]) {
  mp.query.mockResolvedValueOnce({ rows } as never)
}

function mockEmpty() {
  mp.query.mockResolvedValueOnce({ rows: [] } as never)
}

const NOW = '2026-01-01T00:00:00.000Z'

// ─── Suite 1: regressionAuditService ─────────────────────────────────────────

describe('regressionAuditService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifyFailure: new, non-recurring → new_regression', () => {
    const cls = regressionHooks.classifyFailure('AssertionError: expected 1 to equal 2', false)
    expect(cls).toBe('new_regression')
  })

  it('classifyFailure: timeout keyword → timeout', () => {
    const cls = regressionHooks.classifyFailure('Test timed out after 5000ms', false)
    expect(cls).toBe('timeout')
  })

  it('classifyFailure: recurring → pre_existing', () => {
    const cls = regressionHooks.classifyFailure('AssertionError', true)
    expect(cls).toBe('pre_existing')
  })

  it('classifyFailure: flaky/nondeterministic → environment_flaky', () => {
    const cls = regressionHooks.classifyFailure('flaky test detected', false)
    expect(cls).toBe('environment_flaky')
  })

  it('generateRegressionHash returns 16-char hex', () => {
    const h = regressionHooks.generateRegressionHash('auth.test.ts', 'login works')
    expect(h).toHaveLength(16)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('generateRegressionHash is deterministic', () => {
    const h1 = regressionHooks.generateRegressionHash('file.ts', 'test')
    const h2 = regressionHooks.generateRegressionHash('file.ts', 'test')
    expect(h1).toBe(h2)
  })

  it('createAuditRun inserts and maps run', async () => {
    mockRow({
      id: 'run-1', run_label: 'CI #42', total_tests: 100, passed: 90, failed: 10,
      skipped: 0, new_failures: 5, pre_existing_failures: 5, flaky_count: 2,
      started_at: NOW, completed_at: null, environment: 'ci', commit_sha: 'abc123',
      created_at: NOW,
    })
    const run = await createAuditRun({ runLabel: 'CI #42', totalTests: 100, passed: 90, failed: 10, environment: 'ci', commitSha: 'abc123' })
    expect(run.runLabel).toBe('CI #42')
    expect(run.totalTests).toBe(100)
    expect(mp.query).toHaveBeenCalledOnce()
  })

  it('completeAuditRun updates totals', async () => {
    mockRow({
      id: 'run-1', run_label: 'CI #42', total_tests: 171, passed: 171, failed: 0,
      skipped: 0, new_failures: 0, pre_existing_failures: 0, flaky_count: 0,
      started_at: NOW, completed_at: NOW, environment: 'ci', commit_sha: null,
      created_at: NOW,
    })
    const run = await completeAuditRun('run-1')
    expect(run.passed).toBe(171)
    expect(run.completedAt).not.toBeNull()
  })

  it('getAuditRun returns null when not found', async () => {
    mockEmpty()
    const run = await getAuditRun('unknown')
    expect(run).toBeNull()
  })

  it('listAuditRuns returns array', async () => {
    mockRows([
      {
        id: 'run-1', run_label: 'CI #42', total_tests: 100, passed: 90, failed: 10,
        skipped: 0, new_failures: 5, pre_existing_failures: 5, flaky_count: 2,
        started_at: NOW, completed_at: null, environment: 'ci', commit_sha: null,
        created_at: NOW,
      },
    ])
    const runs = await listAuditRuns('ci', 10)
    expect(runs).toHaveLength(1)
    expect(runs[0].runLabel).toBe('CI #42')
  })

  it('recordFailure inserts and maps failure', async () => {
    mockEmpty() // prior failure check
    mockRow({
      id: 'f-1', audit_run_id: 'run-1', test_file: 'auth.test.ts', test_name: 'login',
      classification: 'new_regression', error_message: 'expected true', stack_trace: null,
      is_new: true, first_seen_at: NOW, occurrence_count: 1, resolved_at: null,
      created_at: NOW,
    })
    const f = await recordFailure('run-1', { testFile: 'auth.test.ts', testName: 'login', classification: 'new_regression', errorMessage: 'expected true' })
    expect(f.testFile).toBe('auth.test.ts')
    expect(f.classification).toBe('new_regression')
  })

  it('resolveFailure marks resolved_at', async () => {
    mockEmpty()
    await resolveFailure('f-1')
    expect(mp.query).toHaveBeenCalledOnce()
  })

  it('getRunFailures returns failure list', async () => {
    mockRows([
      {
        id: 'f-1', audit_run_id: 'run-1', test_file: 'auth.test.ts', test_name: 'login',
        classification: 'new_regression', error_message: 'err', stack_trace: null,
        is_new: true, first_seen_at: NOW, occurrence_count: 1, resolved_at: null,
        created_at: NOW,
      },
    ])
    const failures = await getRunFailures('run-1')
    expect(failures).toHaveLength(1)
  })

  it('generateRegressionReport assembles full report', async () => {
    // getAuditRun
    mockRow({
      id: 'run-1', run_label: 'CI', total_tests: 10, passed: 8, failed: 2, skipped: 0,
      new_failures: 1, pre_existing_failures: 1, flaky_count: 0, started_at: NOW,
      completed_at: NOW, environment: 'ci', commit_sha: null, created_at: NOW,
    })
    // getRunFailures
    mockRows([
      {
        id: 'f-1', audit_run_id: 'run-1', test_file: 'auth.test.ts', test_name: 'login',
        classification: 'new_regression', error_message: 'err', stack_trace: null,
        is_new: true, first_seen_at: NOW, occurrence_count: 1, resolved_at: null, created_at: NOW,
      },
    ])
    const report = await generateRegressionReport('run-1')
    expect(report.run.id).toBe('run-1')
    expect(report.failures).toHaveLength(1)
  })
})

// ─── Suite 2: flakyTestDetector ───────────────────────────────────────────────

describe('flakyTestDetector', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('countFlips: no flips for consistent pass', () => {
    expect(flakyHooks.countFlips(['pass', 'pass', 'pass'])).toBe(0)
  })

  it('countFlips: counts transitions correctly', () => {
    expect(flakyHooks.countFlips(['pass', 'fail', 'pass', 'fail'])).toBe(3)
  })

  it('countFlips: empty/single returns 0', () => {
    expect(flakyHooks.countFlips([])).toBe(0)
    expect(flakyHooks.countFlips(['pass'])).toBe(0)
  })

  it('countFlips: skip treated as fail', () => {
    expect(flakyHooks.countFlips(['pass', 'skip'])).toBe(1)
  })

  it('isConsistentlyFailing: all failures', () => {
    expect(flakyHooks.isConsistentlyFailing(['fail', 'fail', 'timeout'])).toBe(true)
  })

  it('isConsistentlyFailing: has pass → false', () => {
    expect(flakyHooks.isConsistentlyFailing(['fail', 'pass'])).toBe(false)
  })

  it('isConsistentlyFailing: empty → false', () => {
    expect(flakyHooks.isConsistentlyFailing([])).toBe(false)
  })

  it('computePassRate: correct calculation', () => {
    expect(flakyHooks.computePassRate(['pass', 'fail', 'pass', 'pass'])).toBeCloseTo(0.75)
  })

  it('computePassRate: empty → 1.0', () => {
    expect(flakyHooks.computePassRate([])).toBe(1.0)
  })

  it('FLAKY_FLIP_THRESHOLD is 2', () => {
    expect(flakyHooks.FLAKY_FLIP_THRESHOLD).toBe(2)
  })

  it('recordTestOutcome inserts and maps', async () => {
    mockRow({
      id: 'o-1', test_file: 'auth.test.ts', test_name: 'login', outcome: 'pass',
      duration_ms: 120, run_id: 'run-1', environment: 'ci', created_at: NOW,
    })
    const o = await recordTestOutcome({
      testFile: 'auth.test.ts', testName: 'login', outcome: 'pass',
      durationMs: 120, runId: 'run-1',
    })
    expect(o.testFile).toBe('auth.test.ts')
    expect(o.outcome).toBe('pass')
  })

  it('getTestHistory returns outcomes in order', async () => {
    mockRows([
      { id: 'o-1', test_file: 'f.ts', test_name: 't', outcome: 'pass', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
      { id: 'o-2', test_file: 'f.ts', test_name: 't', outcome: 'fail', duration_ms: 200, run_id: 'r', environment: 'ci', created_at: NOW },
    ])
    const h = await getTestHistory('f.ts', 't')
    expect(h).toHaveLength(2)
  })

  it('analyzeFlakiness: 2 flips → isFlaky=true', async () => {
    mockRows([
      { id: 'o-1', test_file: 'f.ts', test_name: 't', outcome: 'pass', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
      { id: 'o-2', test_file: 'f.ts', test_name: 't', outcome: 'fail', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
      { id: 'o-3', test_file: 'f.ts', test_name: 't', outcome: 'pass', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
    ])
    const report = await analyzeFlakiness('f.ts', 't')
    expect(report.isFlaky).toBe(true)
    expect(report.flipCount).toBeGreaterThanOrEqual(2)
  })

  it('analyzeFlakiness: consistent pass → isFlaky=false', async () => {
    mockRows([
      { id: 'o-1', test_file: 'f.ts', test_name: 't', outcome: 'pass', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
      { id: 'o-2', test_file: 'f.ts', test_name: 't', outcome: 'pass', duration_ms: 100, run_id: 'r', environment: 'ci', created_at: NOW },
    ])
    const report = await analyzeFlakiness('f.ts', 't')
    expect(report.isFlaky).toBe(false)
  })

  it('markFlakyResolved calls UPDATE', async () => {
    mp.query.mockResolvedValueOnce({ rows: [] } as never)
    await markFlakyResolved('f.ts', 't')
    expect(mp.query).toHaveBeenCalledWith(
      expect.stringContaining('resolved = TRUE'),
      ['f.ts', 't'],
    )
  })
})

// ─── Suite 3: replayVerificationRunner ───────────────────────────────────────

describe('replayVerificationRunner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeReplayHash returns 64-char sha256', () => {
    const h = replayHooks.computeReplayHash({ a: 1, b: 2 })
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('computeReplayHash is deterministic', () => {
    const payload = { x: 'hello', y: 42 }
    expect(replayHooks.computeReplayHash(payload)).toBe(replayHooks.computeReplayHash(payload))
  })

  it('computeReplayHash differs for different payloads', () => {
    const h1 = replayHooks.computeReplayHash({ a: 1 })
    const h2 = replayHooks.computeReplayHash({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('isDeterministic: 0 failures → true', () => {
    expect(replayHooks.isDeterministic(3, 0)).toBe(true)
  })

  it('isDeterministic: 1 failure → false (tolerance = 0)', () => {
    expect(replayHooks.isDeterministic(2, 1)).toBe(false)
  })

  it('computeDeterminismRate: correct ratio', () => {
    expect(replayHooks.computeDeterminismRate(9, 10)).toBeCloseTo(0.9)
  })

  it('computeDeterminismRate: total=0 → 1.0', () => {
    expect(replayHooks.computeDeterminismRate(0, 0)).toBe(1.0)
  })

  it('MAX_REPLAY_DIVERGENCE_TOLERANCE is 0', () => {
    expect(replayHooks.MAX_REPLAY_DIVERGENCE_TOLERANCE).toBe(0)
  })

  it('startVerification inserts and maps', async () => {
    mockRow({
      id: 'vrun-1', workflow_id: 'wf-1', event_stream_id: null, replay_count: 3,
      deterministic_passes: 0, deterministic_failures: 0, status: 'pending',
      divergence_details: null, verified_at: null, created_at: NOW,
    })
    const vrun = await startVerification({ workflowId: 'wf-1', replayCount: 3 })
    expect(vrun.workflowId).toBe('wf-1')
    expect(vrun.status).toBe('pending')
  })

  it('recordReplayPass: identical checksums → deterministic=true', async () => {
    mp.query.mockResolvedValueOnce({ rows: [] } as never)
    const result = await recordReplayPass('vrun-1', 'hash-abc', 'hash-abc')
    expect(result.deterministic).toBe(true)
  })

  it('recordReplayPass: different checksums → deterministic=false', async () => {
    mp.query.mockResolvedValueOnce({ rows: [] } as never)
    const result = await recordReplayPass('vrun-1', 'hash-abc', 'hash-xyz')
    expect(result.deterministic).toBe(false)
  })

  it('completeVerification: 0 failures → passed', async () => {
    // getVerificationRun
    mockRow({
      id: 'vrun-1', workflow_id: null, event_stream_id: 'es-1', replay_count: 3,
      deterministic_passes: 3, deterministic_failures: 0, status: 'pending',
      divergence_details: null, verified_at: null, created_at: NOW,
    })
    // update
    mockRow({
      id: 'vrun-1', workflow_id: null, event_stream_id: 'es-1', replay_count: 3,
      deterministic_passes: 3, deterministic_failures: 0, status: 'passed',
      divergence_details: null, verified_at: NOW, created_at: NOW,
    })
    const run = await completeVerification('vrun-1')
    expect(run.status).toBe('passed')
  })

  it('completeVerification: 1 failure → failed', async () => {
    mockRow({
      id: 'vrun-1', workflow_id: null, event_stream_id: 'es-1', replay_count: 3,
      deterministic_passes: 2, deterministic_failures: 1, status: 'pending',
      divergence_details: null, verified_at: null, created_at: NOW,
    })
    mockRow({
      id: 'vrun-1', workflow_id: null, event_stream_id: 'es-1', replay_count: 3,
      deterministic_passes: 2, deterministic_failures: 1, status: 'failed',
      divergence_details: '{}', verified_at: NOW, created_at: NOW,
    })
    const run = await completeVerification('vrun-1')
    expect(run.status).toBe('failed')
  })

  it('getVerificationRun returns null when not found', async () => {
    mockEmpty()
    expect(await getVerificationRun('unknown')).toBeNull()
  })

  it('listVerificationRuns returns array', async () => {
    mockRows([
      {
        id: 'vrun-1', workflow_id: 'wf-1', event_stream_id: null, replay_count: 3,
        deterministic_passes: 3, deterministic_failures: 0, status: 'passed',
        divergence_details: null, verified_at: NOW, created_at: NOW,
      },
    ])
    const runs = await listVerificationRuns('wf-1')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('passed')
  })

  it('verifyTenantReplay: matching hashes → deterministic=true, divergenceHash=null', async () => {
    mTQ.mockResolvedValueOnce({ rows: [] } as never)
    const payload = { event: 'action', result: 42 }
    const result = await verifyTenantReplay('T1', 'es-1', payload, { ...payload })
    expect(result.deterministic).toBe(true)
    expect(result.divergenceHash).toBeNull()
  })

  it('verifyTenantReplay: different payloads → deterministic=false', async () => {
    mTQ.mockResolvedValueOnce({ rows: [] } as never)
    const result = await verifyTenantReplay('T1', 'es-1', { a: 1 }, { a: 2 })
    expect(result.deterministic).toBe(false)
    expect(result.divergenceHash).not.toBeNull()
  })
})

// ─── Suite 4: productionGateValidator ────────────────────────────────────────

describe('productionGateValidator', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeGateScore: all pass → 100', () => {
    expect(gateHooks.computeGateScore(10, 10)).toBe(100)
  })

  it('computeGateScore: 0 total → 100', () => {
    expect(gateHooks.computeGateScore(0, 0)).toBe(100)
  })

  it('computeGateScore: 9/10 → 90', () => {
    expect(gateHooks.computeGateScore(9, 10)).toBe(90)
  })

  it('isGatePassThresholdMet: 90% passes', () => {
    expect(gateHooks.isGatePassThresholdMet(9, 10)).toBe(true)
  })

  it('isGatePassThresholdMet: 89% fails', () => {
    expect(gateHooks.isGatePassThresholdMet(89, 100)).toBe(false)
  })

  it('isGatePassThresholdMet: 0 total → true', () => {
    expect(gateHooks.isGatePassThresholdMet(0, 0)).toBe(true)
  })

  it('PRODUCTION_GATE_PASS_THRESHOLD is 0.9', () => {
    expect(gateHooks.PRODUCTION_GATE_PASS_THRESHOLD).toBe(0.9)
  })

  it('createGateRun inserts and maps', async () => {
    mockRow({
      id: 'gr-1', environment: 'production', total_checks: 0, passed: 0, failed: 0,
      warned: 0, skipped: 0, overall_status: 'pass', started_at: NOW,
      completed_at: null, created_at: NOW,
    })
    const run = await createGateRun('production')
    expect(run.environment).toBe('production')
    expect(run.overallStatus).toBe('pass')
  })

  it('recordGateCheck inserts and maps', async () => {
    mockRow({
      id: 'gc-1', gate_run_id: 'gr-1', category: 'queue_health', check_name: 'queue_backlog',
      status: 'pass', message: 'OK', duration_ms: 50, metadata: '{}', created_at: NOW,
    })
    const check = await recordGateCheck('gr-1', 'queue_health', 'queue_backlog', 'pass', 'OK', 50)
    expect(check.status).toBe('pass')
    expect(check.category).toBe('queue_health')
  })

  it('finalizeGateRun: all pass → overall pass', async () => {
    // counts query
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 5, passed: 5, failed: 0, warned: 0, skipped: 0 }],
    } as never)
    // update
    mockRow({
      id: 'gr-1', environment: 'production', total_checks: 5, passed: 5, failed: 0,
      warned: 0, skipped: 0, overall_status: 'pass', started_at: NOW,
      completed_at: NOW, created_at: NOW,
    })
    const run = await finalizeGateRun('gr-1')
    expect(run.overallStatus).toBe('pass')
    expect(run.passed).toBe(5)
  })

  it('finalizeGateRun: any fail → overall fail', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 5, passed: 4, failed: 1, warned: 0, skipped: 0 }],
    } as never)
    mockRow({
      id: 'gr-1', environment: 'production', total_checks: 5, passed: 4, failed: 1,
      warned: 0, skipped: 0, overall_status: 'fail', started_at: NOW,
      completed_at: NOW, created_at: NOW,
    })
    const run = await finalizeGateRun('gr-1')
    expect(run.overallStatus).toBe('fail')
  })

  it('getGateRun returns null for missing', async () => {
    mockEmpty()
    expect(await getGateRun('missing')).toBeNull()
  })

  it('getGateChecks returns list', async () => {
    mockRows([
      {
        id: 'gc-1', gate_run_id: 'gr-1', category: 'tenant_isolation', check_name: 'rls',
        status: 'pass', message: 'OK', duration_ms: 10, metadata: '{}', created_at: NOW,
      },
    ])
    const checks = await getGateChecks('gr-1')
    expect(checks).toHaveLength(1)
  })

  it('runQueueHealthCheck: low backlog → pass', async () => {
    // backlog query
    mp.query.mockResolvedValueOnce({ rows: [{ backlog: 5 }] } as never)
    // insert
    mockRow({
      id: 'gc-1', gate_run_id: 'gr-1', category: 'queue_health', check_name: 'queue_backlog_check',
      status: 'pass', message: 'Queue backlog within acceptable range', duration_ms: 10,
      metadata: '{}', created_at: NOW,
    })
    const check = await runQueueHealthCheck('gr-1')
    expect(check.status).toBe('pass')
  })

  it('runQueueHealthCheck: backlog > 1000 → fail', async () => {
    mp.query.mockResolvedValueOnce({ rows: [{ backlog: 1500 }] } as never)
    mockRow({
      id: 'gc-1', gate_run_id: 'gr-1', category: 'queue_health', check_name: 'queue_backlog_check',
      status: 'fail', message: 'Queue backlog critical: 1500 items', duration_ms: 10,
      metadata: '{}', created_at: NOW,
    })
    const check = await runQueueHealthCheck('gr-1')
    expect(check.status).toBe('fail')
  })

  it('runTenantIsolationCheck: >= 5 policies → pass', async () => {
    mp.query.mockResolvedValueOnce({ rows: [{ policy_count: 8 }] } as never)
    mockRow({
      id: 'gc-1', gate_run_id: 'gr-1', category: 'tenant_isolation', check_name: 'rls_policy_count',
      status: 'pass', message: '8 tenant RLS policies active', duration_ms: 5,
      metadata: '{"policyCount":8}', created_at: NOW,
    })
    const check = await runTenantIsolationCheck('gr-1')
    expect(check.status).toBe('pass')
  })

  it('runBillingCorrectnessCheck: no unreconciled → pass', async () => {
    mp.query.mockResolvedValueOnce({ rows: [{ unreconciled: 0 }] } as never)
    mockRow({
      id: 'gc-1', gate_run_id: 'gr-1', category: 'billing_correctness', check_name: 'reconciliation_lag',
      status: 'pass', message: 'Billing reconciliation current', duration_ms: 8,
      metadata: '{}', created_at: NOW,
    })
    const check = await runBillingCorrectnessCheck('gr-1')
    expect(check.status).toBe('pass')
  })
})

// ─── Suite 5: operationalReadinessScanner ────────────────────────────────────

describe('operationalReadinessScanner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('scoreToDimensionLevel: >= 80 → ready', () => {
    expect(readinessHooks.scoreToDimensionLevel(80)).toBe('ready')
    expect(readinessHooks.scoreToDimensionLevel(100)).toBe('ready')
  })

  it('scoreToDimensionLevel: 50–79 → degraded', () => {
    expect(readinessHooks.scoreToDimensionLevel(50)).toBe('degraded')
    expect(readinessHooks.scoreToDimensionLevel(79)).toBe('degraded')
  })

  it('scoreToDimensionLevel: < 50 → not_ready', () => {
    expect(readinessHooks.scoreToDimensionLevel(0)).toBe('not_ready')
    expect(readinessHooks.scoreToDimensionLevel(49)).toBe('not_ready')
  })

  it('computeOverallScore: averages correctly', () => {
    expect(readinessHooks.computeOverallScore([80, 90, 70])).toBe(80)
  })

  it('computeOverallScore: empty → 0', () => {
    expect(readinessHooks.computeOverallScore([])).toBe(0)
  })

  it('isReadyForProduction: ready + notReadyCount=0 → true', () => {
    const scan = {
      id: 's-1', environment: 'prod', overallScore: 90, overallLevel: 'ready' as const,
      dimensionCount: 5, readyCount: 5, degradedCount: 0, notReadyCount: 0,
      completedAt: null, createdAt: new Date(),
    }
    expect(readinessHooks.isReadyForProduction(scan)).toBe(true)
  })

  it('isReadyForProduction: degraded → false', () => {
    const scan = {
      id: 's-1', environment: 'prod', overallScore: 70, overallLevel: 'degraded' as const,
      dimensionCount: 5, readyCount: 3, degradedCount: 2, notReadyCount: 0,
      completedAt: null, createdAt: new Date(),
    }
    expect(readinessHooks.isReadyForProduction(scan)).toBe(false)
  })

  it('READINESS_SCORE_THRESHOLD is 80', () => {
    expect(readinessHooks.READINESS_SCORE_THRESHOLD).toBe(80)
  })

  it('createScan inserts and maps', async () => {
    mockRow({
      id: 'sc-1', environment: 'production', overall_score: 0, overall_level: 'unknown',
      dimension_count: 0, ready_count: 0, degraded_count: 0, not_ready_count: 0,
      completed_at: null, created_at: NOW,
    })
    const scan = await createScan('production')
    expect(scan.overallLevel).toBe('unknown')
    expect(scan.overallScore).toBe(0)
  })

  it('recordDimensionResult inserts result with correct level', async () => {
    mockRow({
      id: 'sr-1', scan_id: 'sc-1', dimension: 'replay', level: 'ready', score: 90,
      details: 'All replays deterministic', blockers: '[]', warnings: '[]',
      checked_at: NOW, created_at: NOW,
    })
    const result = await recordDimensionResult('sc-1', 'replay', 90, 'All replays deterministic')
    expect(result.level).toBe('ready')
    expect(result.dimension).toBe('replay')
  })

  it('finalizeScan: all ready → overallLevel=ready', async () => {
    // aggregate query
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 3, avg_score: 90, ready: 3, degraded: 0, not_ready: 0 }],
    } as never)
    // update
    mockRow({
      id: 'sc-1', environment: 'production', overall_score: 90, overall_level: 'ready',
      dimension_count: 3, ready_count: 3, degraded_count: 0, not_ready_count: 0,
      completed_at: NOW, created_at: NOW,
    })
    const scan = await finalizeScan('sc-1')
    expect(scan.overallLevel).toBe('ready')
    expect(scan.overallScore).toBe(90)
  })

  it('finalizeScan: 1 not_ready → overallLevel=not_ready', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 3, avg_score: 60, ready: 1, degraded: 1, not_ready: 1 }],
    } as never)
    mockRow({
      id: 'sc-1', environment: 'production', overall_score: 60, overall_level: 'not_ready',
      dimension_count: 3, ready_count: 1, degraded_count: 1, not_ready_count: 1,
      completed_at: NOW, created_at: NOW,
    })
    const scan = await finalizeScan('sc-1')
    expect(scan.overallLevel).toBe('not_ready')
  })

  it('getScan returns null when not found', async () => {
    mockEmpty()
    expect(await getScan('unknown')).toBeNull()
  })

  it('getScanResults returns results', async () => {
    mockRows([
      {
        id: 'sr-1', scan_id: 'sc-1', dimension: 'queue', level: 'ready', score: 95,
        details: 'OK', blockers: '[]', warnings: '[]', checked_at: NOW, created_at: NOW,
      },
    ])
    const results = await getScanResults('sc-1')
    expect(results).toHaveLength(1)
    expect(results[0].dimension).toBe('queue')
  })

  it('listScans returns array', async () => {
    mockRows([
      {
        id: 'sc-1', environment: 'production', overall_score: 90, overall_level: 'ready',
        dimension_count: 5, ready_count: 5, degraded_count: 0, not_ready_count: 0,
        completed_at: NOW, created_at: NOW,
      },
    ])
    const scans = await listScans('production', 5)
    expect(scans).toHaveLength(1)
  })
})

// ─── Suite 6: deploymentAuditEngine ──────────────────────────────────────────

describe('deploymentAuditEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeDeploymentHash: returns 16-char hex', () => {
    const h = deploymentHooks.computeDeploymentHash('1.0.0', 'production', NOW)
    expect(h).toHaveLength(16)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('computeDeploymentHash: deterministic', () => {
    const h1 = deploymentHooks.computeDeploymentHash('1.0.0', 'prod', NOW)
    const h2 = deploymentHooks.computeDeploymentHash('1.0.0', 'prod', NOW)
    expect(h1).toBe(h2)
  })

  it('isRollbackSafe: all conditions met → true', () => {
    const audit = {
      id: 'a', deploymentId: 'd', environment: 'prod', version: '1.1.0',
      previousVersion: '1.0.0', status: 'passed' as const,
      migrationsApplied: 2, migrationsRolledBack: 0, servicesHealthy: 3,
      servicesDegraded: 0, rollbackAvailable: true,
      auditedAt: new Date(), completedAt: null, createdAt: new Date(),
    }
    expect(deploymentHooks.isRollbackSafe(audit)).toBe(true)
  })

  it('isRollbackSafe: no previousVersion → false', () => {
    const audit = {
      id: 'a', deploymentId: 'd', environment: 'prod', version: '1.0.0',
      previousVersion: null, status: 'passed' as const,
      migrationsApplied: 0, migrationsRolledBack: 0, servicesHealthy: 3,
      servicesDegraded: 0, rollbackAvailable: true,
      auditedAt: new Date(), completedAt: null, createdAt: new Date(),
    }
    expect(deploymentHooks.isRollbackSafe(audit)).toBe(false)
  })

  it('isRollbackSafe: migrationsRolledBack > 0 → false', () => {
    const audit = {
      id: 'a', deploymentId: 'd', environment: 'prod', version: '1.1.0',
      previousVersion: '1.0.0', status: 'rolled_back' as const,
      migrationsApplied: 2, migrationsRolledBack: 2, servicesHealthy: 0,
      servicesDegraded: 0, rollbackAvailable: false,
      auditedAt: new Date(), completedAt: null, createdAt: new Date(),
    }
    expect(deploymentHooks.isRollbackSafe(audit)).toBe(false)
  })

  it('isDeploymentHealthy: passed + healthy services → true', () => {
    const audit = {
      id: 'a', deploymentId: 'd', environment: 'prod', version: '1.0.0',
      previousVersion: null, status: 'passed' as const,
      migrationsApplied: 0, migrationsRolledBack: 0, servicesHealthy: 5,
      servicesDegraded: 0, rollbackAvailable: false,
      auditedAt: new Date(), completedAt: null, createdAt: new Date(),
    }
    expect(deploymentHooks.isDeploymentHealthy(audit)).toBe(true)
  })

  it('isDeploymentHealthy: degraded services → false', () => {
    const audit = {
      id: 'a', deploymentId: 'd', environment: 'prod', version: '1.0.0',
      previousVersion: null, status: 'passed' as const,
      migrationsApplied: 0, migrationsRolledBack: 0, servicesHealthy: 3,
      servicesDegraded: 2, rollbackAvailable: false,
      auditedAt: new Date(), completedAt: null, createdAt: new Date(),
    }
    expect(deploymentHooks.isDeploymentHealthy(audit)).toBe(false)
  })

  it('computeHealthScore: all healthy → 100', () => {
    expect(deploymentHooks.computeHealthScore(5, 0)).toBe(100)
  })

  it('computeHealthScore: 3 healthy, 2 degraded → 60', () => {
    expect(deploymentHooks.computeHealthScore(3, 2)).toBe(60)
  })

  it('computeHealthScore: 0 total → 100', () => {
    expect(deploymentHooks.computeHealthScore(0, 0)).toBe(100)
  })

  const baseRow = {
    id: 'da-1', deployment_id: 'dep-1', environment: 'production', version: '1.1.0',
    previous_version: '1.0.0', status: 'pending', migrations_applied: 2,
    migrations_rolled_back: 0, services_healthy: 0, services_degraded: 0,
    rollback_available: true, audited_at: NOW, completed_at: null, created_at: NOW,
  }

  it('createDeploymentAudit inserts and maps', async () => {
    mockRow(baseRow)
    const audit = await createDeploymentAudit({
      deploymentId: 'dep-1', environment: 'production',
      version: '1.1.0', previousVersion: '1.0.0',
      migrationsApplied: 2, rollbackAvailable: true,
    })
    expect(audit.deploymentId).toBe('dep-1')
    expect(audit.status).toBe('pending')
    expect(audit.rollbackAvailable).toBe(true)
  })

  it('updateDeploymentStatus: passed → completedAt set', async () => {
    mockRow({ ...baseRow, status: 'passed', services_healthy: 3, completed_at: NOW })
    const audit = await updateDeploymentStatus('da-1', 'passed', 3, 0)
    expect(audit.status).toBe('passed')
    expect(audit.servicesHealthy).toBe(3)
    expect(audit.completedAt).not.toBeNull()
  })

  it('updateDeploymentStatus: throws when not found', async () => {
    mockEmpty()
    await expect(updateDeploymentStatus('missing', 'failed')).rejects.toThrow('not found')
  })

  it('getDeploymentAudit returns null for missing', async () => {
    mockEmpty()
    expect(await getDeploymentAudit('missing')).toBeNull()
  })

  it('listDeploymentAudits returns array', async () => {
    mockRows([baseRow])
    const audits = await listDeploymentAudits('production', 10)
    expect(audits).toHaveLength(1)
  })

  it('getLatestDeployment returns most recent', async () => {
    mockRow(baseRow)
    const audit = await getLatestDeployment('production')
    expect(audit).not.toBeNull()
    expect(audit?.environment).toBe('production')
  })

  it('getLatestDeployment returns null when none', async () => {
    mockEmpty()
    expect(await getLatestDeployment('production')).toBeNull()
  })

  it('checkMigrationSafety: returns applied count', async () => {
    mockRow({ applied: 42 })
    const result = await checkMigrationSafety('production')
    expect(result.safe).toBe(true)
    expect(result.appliedCount).toBe(42)
  })

  it('checkMigrationSafety: graceful on DB error', async () => {
    mp.query.mockRejectedValueOnce(new Error('table not found') as never)
    const result = await checkMigrationSafety('production')
    expect(result.safe).toBe(true)
    expect(result.appliedCount).toBe(0)
  })
})

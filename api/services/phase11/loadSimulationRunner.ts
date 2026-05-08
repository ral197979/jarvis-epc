// Denver Engineering — Load Simulation Runner (Phase 11)
// Simulate production load patterns for scale and stress testing

import { pool } from '../../db/pool'
import { ScaleTestType, ScaleValidationRun } from './phase11Types'

// ─── Load Profile ─────────────────────────────────────────────────────────────

export interface LoadProfile {
  testType: ScaleTestType
  targetRps: number
  durationSeconds: number
  rampUpSeconds: number
  concurrency: number
}

export interface LoadSimulationResult {
  runId: string
  testType: ScaleTestType
  actualRps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  errorRate: number
  totalRequests: number
  successfulRequests: number
  simulatedAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapSimulationResult(row: Record<string, unknown>): LoadSimulationResult {
  return {
    runId: row.run_id as string,
    testType: row.test_type as ScaleTestType,
    actualRps: Number(row.actual_rps),
    p50Ms: Number(row.p50_ms),
    p95Ms: Number(row.p95_ms),
    p99Ms: Number(row.p99_ms),
    errorRate: Number(row.error_rate),
    totalRequests: Number(row.total_requests),
    successfulRequests: Number(row.successful_requests),
    simulatedAt: new Date(row.simulated_at as string),
  }
}

// ─── Record Load Simulation Result ───────────────────────────────────────────

export async function recordLoadSimulationResult(
  runId: string,
  result: Omit<LoadSimulationResult, 'runId' | 'simulatedAt'>
): Promise<LoadSimulationResult> {
  const stored = await pool.query(
    `INSERT INTO load_simulation_results
       (run_id, test_type, actual_rps, p50_ms, p95_ms, p99_ms,
        error_rate, total_requests, successful_requests, simulated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [
      runId, result.testType, result.actualRps, result.p50Ms, result.p95Ms,
      result.p99Ms, result.errorRate, result.totalRequests, result.successfulRequests,
    ]
  )
  return _mapSimulationResult(stored.rows[0])
}

// ─── Get Simulation Results ───────────────────────────────────────────────────

export async function getSimulationResults(runId: string): Promise<LoadSimulationResult | null> {
  const result = await pool.query(
    `SELECT * FROM load_simulation_results WHERE run_id = $1`,
    [runId]
  )
  return result.rows.length > 0 ? _mapSimulationResult(result.rows[0]) : null
}

// ─── List Simulation Results by Type ─────────────────────────────────────────

export async function listSimulationResultsByType(
  testType: ScaleTestType,
  limit: number = 10
): Promise<LoadSimulationResult[]> {
  const result = await pool.query(
    `SELECT * FROM load_simulation_results
     WHERE test_type = $1
     ORDER BY simulated_at DESC
     LIMIT $2`,
    [testType, limit]
  )
  return result.rows.map(_mapSimulationResult)
}

// ─── Compute Load Profile Targets ────────────────────────────────────────────

export function getDefaultLoadProfile(testType: ScaleTestType): LoadProfile {
  const profiles: Record<ScaleTestType, LoadProfile> = {
    tenant_count: {
      testType: 'tenant_count', targetRps: 100, durationSeconds: 300,
      rampUpSeconds: 60, concurrency: 50,
    },
    event_stream_size: {
      testType: 'event_stream_size', targetRps: 1000, durationSeconds: 300,
      rampUpSeconds: 60, concurrency: 200,
    },
    graph_nodes: {
      testType: 'graph_nodes', targetRps: 500, durationSeconds: 180,
      rampUpSeconds: 30, concurrency: 100,
    },
    websocket_fanout: {
      testType: 'websocket_fanout', targetRps: 2000, durationSeconds: 120,
      rampUpSeconds: 20, concurrency: 500,
    },
    edge_sync_load: {
      testType: 'edge_sync_load', targetRps: 200, durationSeconds: 300,
      rampUpSeconds: 60, concurrency: 50,
    },
    replay_reconstruction: {
      testType: 'replay_reconstruction', targetRps: 50, durationSeconds: 600,
      rampUpSeconds: 120, concurrency: 20,
    },
    queue_saturation: {
      testType: 'queue_saturation', targetRps: 5000, durationSeconds: 120,
      rampUpSeconds: 30, concurrency: 1000,
    },
    billing_load: {
      testType: 'billing_load', targetRps: 100, durationSeconds: 300,
      rampUpSeconds: 60, concurrency: 30,
    },
    export_concurrency: {
      testType: 'export_concurrency', targetRps: 20, durationSeconds: 300,
      rampUpSeconds: 60, concurrency: 10,
    },
  }
  return profiles[testType]
}

// ─── Compute Throughput ───────────────────────────────────────────────────────

export function computeThroughput(
  successfulRequests: number,
  durationSeconds: number
): number {
  if (durationSeconds === 0) return 0
  return successfulRequests / durationSeconds
}

// ─── Is Load Target Met ───────────────────────────────────────────────────────

export function isLoadTargetMet(
  result: LoadSimulationResult,
  profile: LoadProfile
): boolean {
  const achievedPct = profile.targetRps === 0
    ? 0
    : result.actualRps / profile.targetRps
  return achievedPct >= 0.95 && result.errorRate <= 0.01
}

// ─── Determine Run Status from Simulation ────────────────────────────────────

export function determineRunStatusFromSimulation(
  result: LoadSimulationResult,
  run: ScaleValidationRun
): 'passed' | 'failed' | 'degraded' {
  if (result.errorRate > 0.05) return 'failed'
  const achievedPct = run.targetLoad === 0 ? 0 : result.actualRps / run.targetLoad
  if (achievedPct < 0.9) return 'degraded'
  return 'passed'
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapSimulationResult,
  computeThroughput,
  isLoadTargetMet,
  determineRunStatusFromSimulation,
  getDefaultLoadProfile,
}

// Denver Engineering — Operational Tuning Service (Phase 11)
// Manage tuning configurations and track tune events for performance optimization

import { pool } from '../../db/pool'
import {
  TuningConfig,
  PerformanceTuneEvent,
  TuningParameter,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapTuningConfig(row: Record<string, unknown>): TuningConfig {
  return {
    id: row.id as string,
    parameter: row.parameter as TuningParameter,
    currentValue: Number(row.current_value),
    recommendedValue: Number(row.recommended_value),
    rationale: row.rationale as string,
    appliedAt: row.applied_at ? new Date(row.applied_at as string) : null,
    environment: row.environment as string,
    createdAt: new Date(row.created_at as string),
  }
}

function _mapTuneEvent(row: Record<string, unknown>): PerformanceTuneEvent {
  return {
    id: row.id as string,
    parameter: row.parameter as TuningParameter,
    oldValue: Number(row.old_value),
    newValue: Number(row.new_value),
    triggeredBy: row.triggered_by as string,
    deltaP95Ms: row.delta_p95_ms != null ? Number(row.delta_p95_ms) : null,
    environment: row.environment as string,
    tunedAt: new Date(row.tuned_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Tuning Config ─────────────────────────────────────────────────────

export async function createTuningConfig(
  parameter: TuningParameter,
  currentValue: number,
  recommendedValue: number,
  rationale: string,
  environment: string
): Promise<TuningConfig> {
  const result = await pool.query(
    `INSERT INTO tuning_configs
       (parameter, current_value, recommended_value, rationale,
        applied_at, environment, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5, NOW())
     RETURNING *`,
    [parameter, currentValue, recommendedValue, rationale, environment]
  )
  return _mapTuningConfig(result.rows[0])
}

// ─── Apply Tuning Config ──────────────────────────────────────────────────────

export async function applyTuningConfig(
  configId: string,
  triggeredBy: string,
  deltaP95Ms: number | null = null
): Promise<{ config: TuningConfig; tuneEvent: PerformanceTuneEvent }> {
  const configResult = await pool.query(
    `SELECT * FROM tuning_configs WHERE id = $1`,
    [configId]
  )
  if (configResult.rows.length === 0) {
    throw new Error(`TuningConfig ${configId} not found`)
  }
  const config = _mapTuningConfig(configResult.rows[0])

  const tuneEventResult = await pool.query(
    `INSERT INTO performance_tune_events
       (parameter, old_value, new_value, triggered_by, delta_p95_ms,
        environment, tuned_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [
      config.parameter, config.currentValue, config.recommendedValue,
      triggeredBy, deltaP95Ms, config.environment,
    ]
  )

  const updatedConfigResult = await pool.query(
    `UPDATE tuning_configs
     SET current_value = $1, applied_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [config.recommendedValue, configId]
  )

  return {
    config: _mapTuningConfig(updatedConfigResult.rows[0]),
    tuneEvent: _mapTuneEvent(tuneEventResult.rows[0]),
  }
}

// ─── Get Tuning Config ────────────────────────────────────────────────────────

export async function getTuningConfig(configId: string): Promise<TuningConfig | null> {
  const result = await pool.query(
    `SELECT * FROM tuning_configs WHERE id = $1`,
    [configId]
  )
  return result.rows.length > 0 ? _mapTuningConfig(result.rows[0]) : null
}

// ─── List Pending Tuning Configs ─────────────────────────────────────────────

export async function listPendingTuningConfigs(environment: string): Promise<TuningConfig[]> {
  const result = await pool.query(
    `SELECT * FROM tuning_configs
     WHERE applied_at IS NULL AND environment = $1
     ORDER BY created_at ASC`,
    [environment]
  )
  return result.rows.map(_mapTuningConfig)
}

// ─── Get Tune Events ──────────────────────────────────────────────────────────

export async function getTuneEventHistory(
  parameter: TuningParameter,
  environment: string
): Promise<PerformanceTuneEvent[]> {
  const result = await pool.query(
    `SELECT * FROM performance_tune_events
     WHERE parameter = $1 AND environment = $2
     ORDER BY tuned_at DESC`,
    [parameter, environment]
  )
  return result.rows.map(_mapTuneEvent)
}

// ─── Compute Tuning Impact ────────────────────────────────────────────────────

export function computeTuningImpact(events: PerformanceTuneEvent[]): number {
  const withDelta = events.filter(e => e.deltaP95Ms !== null)
  if (withDelta.length === 0) return 0
  const total = withDelta.reduce((acc, e) => acc + (e.deltaP95Ms as number), 0)
  return total / withDelta.length
}

// ─── Is Tuning Applied ────────────────────────────────────────────────────────

export function isTuningApplied(config: TuningConfig): boolean {
  return config.appliedAt !== null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapTuningConfig,
  _mapTuneEvent,
  computeTuningImpact,
  isTuningApplied,
}

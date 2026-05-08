// Denver Engineering — Scenario Simulation Engine (v6.0.0)
// Isolated what-if simulation with injection events and result projection.

import { randomUUID } from 'crypto'
import { tenantQuery } from '../../db/pool'
import {
  ScenarioSimulation, ScenarioEvent, ScenarioResult, RunScenarioInput,
  ScenarioStatus, TimeSeriesPoint,
} from './twinTypes'
import { getLatestSnapshot } from './twinSnapshotService'
import { _computeDiff } from './twinSnapshotService'

// ─── Create simulation ────────────────────────────────────────────────────────

export async function createScenario(input: RunScenarioInput): Promise<ScenarioSimulation> {
  const {
    tenantId, name, scenarioType, config, injectedEvents,
    baseSnapshotId, createdBy,
  } = input

  const isolationToken = randomUUID()

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO scenario_simulations
       (tenant_id, name, scenario_type, config, injected_events,
        base_snapshot_id, isolation_token, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId, name, scenarioType,
      JSON.stringify(config),
      JSON.stringify(injectedEvents),
      baseSnapshotId ?? null,
      isolationToken,
      createdBy,
    ]
  )
  return _mapScenario(res.rows[0])
}

// ─── Run simulation ───────────────────────────────────────────────────────────

export async function runScenario(
  scenarioId: string,
  tenantId: string
): Promise<ScenarioSimulation> {
  // Mark running
  await tenantQuery(
    tenantId,
    `UPDATE scenario_simulations SET status = 'running'
     WHERE id = $1 AND tenant_id = $2`,
    [scenarioId, tenantId]
  )

  try {
    const scenRes = await tenantQuery(
      tenantId,
      'SELECT * FROM scenario_simulations WHERE id = $1 AND tenant_id = $2',
      [scenarioId, tenantId]
    )
    if (scenRes.rows.length === 0) throw new Error(`Scenario not found: ${scenarioId}`)
    const scenario = _mapScenario(scenRes.rows[0])

    // Load base state
    const baseState = await _resolveBaseState(tenantId, scenario)

    // Apply injected events in offset order
    const sortedEvents = [...scenario.injectedEvents].sort((a, b) => a.offsetDays - b.offsetDays)
    const simulatedState = { ...baseState }
    for (const event of sortedEvents) {
      _applyEvent(simulatedState, event)
    }

    // Compute results
    const results = _computeResults(baseState, simulatedState, sortedEvents, scenario.config)

    // Persist results
    const updatedRes = await tenantQuery(
      tenantId,
      `UPDATE scenario_simulations
       SET status = 'completed',
           results = $3,
           projected_readiness_impact = $4,
           projected_sla_impact = $5,
           confidence_score = $6,
           completed_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [
        scenarioId, tenantId,
        JSON.stringify(results),
        results.readinessDelta,
        Math.min(100, results.slaBreachCount * 10),
        75,
      ]
    )
    return _mapScenario(updatedRes.rows[0])
  } catch (err) {
    await tenantQuery(
      tenantId,
      `UPDATE scenario_simulations SET status = 'failed' WHERE id = $1 AND tenant_id = $2`,
      [scenarioId, tenantId]
    )
    throw err
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getScenario(
  scenarioId: string,
  tenantId: string
): Promise<ScenarioSimulation | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM scenario_simulations WHERE id = $1 AND tenant_id = $2',
    [scenarioId, tenantId]
  )
  return res.rows.length > 0 ? _mapScenario(res.rows[0]) : null
}

export async function listScenarios(
  tenantId: string,
  status?: ScenarioStatus,
  limit = 50,
  offset = 0
): Promise<ScenarioSimulation[]> {
  const conditions = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  if (status) { conditions.push(`status = $${params.length + 1}`); params.push(status) }
  params.push(limit, offset)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM scenario_simulations
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return res.rows.map(_mapScenario)
}

export async function cancelScenario(scenarioId: string, tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE scenario_simulations SET status = 'cancelled'
     WHERE id = $1 AND tenant_id = $2 AND status IN ('pending','running')`,
    [scenarioId, tenantId]
  )
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _resolveBaseState(
  tenantId: string,
  scenario: ScenarioSimulation
): Promise<Record<string, unknown>> {
  if (scenario.baseSnapshotId) {
    const snapRes = await tenantQuery(
      tenantId,
      'SELECT state FROM twin_state_snapshots WHERE id = $1 AND tenant_id = $2',
      [scenario.baseSnapshotId, tenantId]
    )
    if (snapRes.rows.length > 0) return snapRes.rows[0].state as Record<string, unknown>
  }

  // Use current state from config target
  const targetId = scenario.config.targetTwinId as string | undefined
  if (targetId) {
    const snap = await getLatestSnapshot(targetId, tenantId)
    if (snap) return snap.state
  }

  // Fall back to portfolio aggregate
  const res = await tenantQuery(
    tenantId,
    `SELECT AVG(readiness_score) as avg_readiness, AVG(risk_score) as avg_risk
     FROM operational_twins WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  )
  return {
    readiness_score: Number(res.rows[0]?.avg_readiness ?? 70),
    risk_score: Number(res.rows[0]?.avg_risk ?? 30),
  }
}

function _applyEvent(state: Record<string, unknown>, event: ScenarioEvent): void {
  switch (event.eventType) {
    case 'readiness_drop':
      state.readiness_score = Math.max(0, Number(state.readiness_score ?? 70) - Number(event.payload.amount ?? 10))
      break
    case 'risk_spike':
      state.risk_score = Math.min(100, Number(state.risk_score ?? 30) + Number(event.payload.amount ?? 20))
      break
    case 'resource_reduction':
      state.resource_multiplier = (Number(state.resource_multiplier ?? 1)) * (1 - Number(event.payload.percent ?? 0.2))
      break
    case 'blocker_injection':
      state.active_blockers = Number(state.active_blockers ?? 0) + Number(event.payload.count ?? 1)
      break
    default:
      // Generic patch
      Object.assign(state, event.payload)
  }
}

function _computeResults(
  base: Record<string, unknown>,
  simulated: Record<string, unknown>,
  events: ScenarioEvent[],
  config: Record<string, unknown>
): ScenarioResult {
  const baseReadiness = Number(base.readiness_score ?? 70)
  const simReadiness = Number(simulated.readiness_score ?? baseReadiness)
  const readinessDelta = simReadiness - baseReadiness

  const slaBreachCount = events.filter(e => e.eventType === 'readiness_drop' || e.eventType === 'blocker_injection').length
  const estimatedDelayDays = Math.max(0, Math.round(-readinessDelta * 0.3))
  const resourceConflicts = Number(simulated.active_blockers ?? 0)

  const mitigationRecommendations: string[] = []
  if (readinessDelta < -10) mitigationRecommendations.push('Accelerate critical path actions')
  if (resourceConflicts > 0) mitigationRecommendations.push('Resolve blockers before proceeding')
  if (slaBreachCount > 0) mitigationRecommendations.push('Renegotiate SLA deadlines or add resources')

  const horizonDays = Number(config.horizonDays ?? 30)
  const simulatedTimeline: TimeSeriesPoint[] = Array.from({ length: horizonDays }, (_, i) => ({
    ts: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
    value: Math.max(0, simReadiness + i * (readinessDelta / horizonDays * 0.1)),
  }))

  const bottlenecks: string[] = events
    .filter(e => e.eventType === 'blocker_injection')
    .map(e => e.targetEntityId)

  return {
    readinessDelta,
    slaBreachCount,
    estimatedDelayDays,
    resourceConflicts,
    mitigationRecommendations,
    simulatedTimeline,
    bottlenecks,
  }
}

export function _mapScenario(row: Record<string, unknown>): ScenarioSimulation {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    scenarioType: row.scenario_type as string,
    status: row.status as ScenarioStatus,
    config: (row.config ?? {}) as Record<string, unknown>,
    baseSnapshotId: row.base_snapshot_id != null ? row.base_snapshot_id as string : undefined,
    injectedEvents: (row.injected_events ?? []) as ScenarioEvent[],
    results: row.results != null ? (row.results as ScenarioResult) : undefined,
    projectedReadinessImpact: row.projected_readiness_impact != null ? Number(row.projected_readiness_impact) : undefined,
    projectedSlaImpact: row.projected_sla_impact != null ? Number(row.projected_sla_impact) : undefined,
    confidenceScore: row.confidence_score != null ? Number(row.confidence_score) : undefined,
    isolationToken: row.isolation_token as string,
    createdBy: row.created_by as string,
    createdAt: new Date(row.created_at as string),
    completedAt: row.completed_at != null ? new Date(row.completed_at as string) : undefined,
  }
}

export const __testHooks = { _applyEvent, _computeResults, _mapScenario }

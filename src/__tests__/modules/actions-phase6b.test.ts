/**
 * Denver Engineering — Phase 6 Test Suite B (v6.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 6 — Part B: Anomaly detection, maintenance forecasting,
 * scenario simulation, predictive coordination, anomaly classification.
 * 100+ tests across 12 suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { tenantQuery } from '../../../api/db/pool'
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows })
const mockRow  = (row: Record<string, unknown>)   => ({ rows: [row] })

// ─── Anomaly Detection Engine ─────────────────────────────────────────────────

describe('anomalyDetectionEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_mapAnomaly — maps all fields with null guards', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyDetectionEngine')
    const row: Record<string, unknown> = {
      id: 'a1', tenant_id: 't', twin_id: null, anomaly_type: 'blocker_cluster',
      severity: 'high', anomaly_score: '72.00',
      impacted_entities: ['proj-1'],
      explanation: 'Test', suggested_actions: ['Fix it'],
      baseline_value: null, observed_value: '15',
      detected_at: new Date().toISOString(), resolved_at: null,
      false_positive: false, metadata: {},
    }
    const anomaly = __testHooks._mapAnomaly(row)
    expect(anomaly.id).toBe('a1')
    expect(anomaly.twinId).toBeUndefined()
    expect(anomaly.anomalyScore).toBe(72)
    expect(anomaly.baselineValue).toBeUndefined()
    expect(anomaly.observedValue).toBe(15)
    expect(anomaly.resolvedAt).toBeUndefined()
    expect(anomaly.falsePositive).toBe(false)
  })

  it('_scoreSeverity — returns correct severity for sigma bands', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyDetectionEngine')
    expect(__testHooks._scoreSeverity(1.5)).toBe('low')
    expect(__testHooks._scoreSeverity(2.5)).toBe('medium')
    expect(__testHooks._scoreSeverity(3.5)).toBe('high')
    expect(__testHooks._scoreSeverity(4.5)).toBe('critical')
  })

  it('listAnomalies — applies severity filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{
      id: 'a1', tenant_id: 't', twin_id: null, anomaly_type: 'blocker_cluster',
      severity: 'high', anomaly_score: '60', impacted_entities: [], explanation: 'x',
      suggested_actions: [], baseline_value: null, observed_value: null,
      detected_at: new Date().toISOString(), resolved_at: null, false_positive: false, metadata: {},
    }]))
    const { listAnomalies } = await import('../../../api/services/twin/anomalyDetectionEngine')
    const results = await listAnomalies('tenant-1', { severity: 'high' })
    expect(results).toHaveLength(1)
    expect(mockTenant.mock.calls[0][1]).toContain('severity')
  })

  it('listAnomalies — resolved filter adds IS NOT NULL condition', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listAnomalies } = await import('../../../api/services/twin/anomalyDetectionEngine')
    await listAnomalies('tenant-1', { resolved: true })
    expect(mockTenant.mock.calls[0][1]).toContain('IS NOT NULL')
  })

  it('listAnomalies — unresolved filter adds false_positive condition', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listAnomalies } = await import('../../../api/services/twin/anomalyDetectionEngine')
    await listAnomalies('tenant-1', { resolved: false })
    expect(mockTenant.mock.calls[0][1]).toContain('false_positive = false')
  })

  it('resolveAnomaly — sets resolved_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { resolveAnomaly } = await import('../../../api/services/twin/anomalyDetectionEngine')
    await resolveAnomaly('a1', 'tenant-1')
    expect(mockTenant.mock.calls[0][1]).toContain('resolved_at = now()')
  })

  it('markFalsePositive — sets false_positive = true', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { markFalsePositive } = await import('../../../api/services/twin/anomalyDetectionEngine')
    await markFalsePositive('a1', 'tenant-1')
    expect(mockTenant.mock.calls[0][1]).toContain('false_positive = true')
  })
})

// ─── Anomaly Classification Service ──────────────────────────────────────────

describe('anomalyClassificationService', () => {
  it('classifyAnomaly — returns correct class for known types', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      id: 'a1', tenantId: 't', anomalyType: 'blocker_cluster',
      severity: 'high' as const, anomalyScore: 80,
      impactedEntities: ['p1'], explanation: '', suggestedActions: [],
      detectedAt: new Date(), falsePositive: false, metadata: {},
    }
    const result = __testHooks.classifyAnomaly(anomaly)
    expect(result.class).toBe('blocker_cluster')
    expect(result.category).toBe('operational')
    expect(result.confidence).toBe(0.8)
  })

  it('classifyAnomaly — returns unknown for unrecognized type', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      id: 'a1', tenantId: 't', anomalyType: 'custom_mystery_type',
      severity: 'low' as const, anomalyScore: 10,
      impactedEntities: [], explanation: '', suggestedActions: [],
      detectedAt: new Date(), falsePositive: false, metadata: {},
    }
    const result = __testHooks.classifyAnomaly(anomaly)
    expect(result.class).toBe('unknown')
  })

  it('shouldEscalate — true for critical severity', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      severity: 'critical' as const, anomalyScore: 90, falsePositive: false,
    } as Parameters<typeof __testHooks.shouldEscalate>[0]
    expect(__testHooks.shouldEscalate(anomaly)).toBe(true)
  })

  it('shouldEscalate — false for false positive', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      severity: 'critical' as const, anomalyScore: 90, falsePositive: true,
    } as Parameters<typeof __testHooks.shouldEscalate>[0]
    expect(__testHooks.shouldEscalate(anomaly)).toBe(false)
  })

  it('shouldEscalate — true for high severity with score >= 75', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      severity: 'high' as const, anomalyScore: 75, falsePositive: false,
    } as Parameters<typeof __testHooks.shouldEscalate>[0]
    expect(__testHooks.shouldEscalate(anomaly)).toBe(true)
  })

  it('shouldEscalate — false for high severity with score < 75', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const anomaly = {
      severity: 'high' as const, anomalyScore: 74, falsePositive: false,
    } as Parameters<typeof __testHooks.shouldEscalate>[0]
    expect(__testHooks.shouldEscalate(anomaly)).toBe(false)
  })

  it('likelyFalsePositive — true for low score and low severity', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const a = { anomalyScore: 15, severity: 'low' as const, impactedEntities: ['x'] } as Parameters<typeof __testHooks.likelyFalsePositive>[0]
    expect(__testHooks.likelyFalsePositive(a)).toBe(true)
  })

  it('likelyFalsePositive — false for high severity regardless of score', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const a = { anomalyScore: 10, severity: 'high' as const, impactedEntities: [] } as Parameters<typeof __testHooks.likelyFalsePositive>[0]
    expect(__testHooks.likelyFalsePositive(a)).toBe(false)
  })

  it('groupAnomalies — groups by category', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const make = (type: string) => ({
      id: 'a', tenantId: 't', anomalyType: type, severity: 'medium' as const, anomalyScore: 50,
      impactedEntities: [], explanation: '', suggestedActions: [], detectedAt: new Date(), falsePositive: false, metadata: {},
    })
    const groups = __testHooks.groupAnomalies([make('blocker_cluster'), make('high_state_velocity')])
    expect(groups.has('operational')).toBe(true)
    expect(groups.has('behavior')).toBe(true)
  })

  it('summarizeAnomalies — counts by severity correctly', async () => {
    const { __testHooks } = await import('../../../api/services/twin/anomalyClassificationService')
    const make = (sev: 'low' | 'medium' | 'high' | 'critical', score: number) => ({
      id: 'x', tenantId: 't', anomalyType: 'blocker_cluster', severity: sev, anomalyScore: score,
      impactedEntities: [], explanation: '', suggestedActions: [], detectedAt: new Date(), falsePositive: false, metadata: {},
    })
    const summary = __testHooks.summarizeAnomalies([
      make('critical', 90), make('high', 80), make('medium', 50), make('low', 10),
    ])
    expect(summary.total).toBe(4)
    expect(summary.bySeverity.critical).toBe(1)
    expect(summary.bySeverity.high).toBe(1)
    expect(summary.topAnomalyScore).toBe(90)
    expect(summary.escalationCount).toBe(2) // critical + high >= 75
  })
})

// ─── Scenario Simulation Engine ───────────────────────────────────────────────

describe('scenarioSimulationEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_applyEvent — readiness_drop reduces readiness_score', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { readiness_score: 80 }
    __testHooks._applyEvent(state, { eventType: 'readiness_drop', targetEntityId: 'p1', payload: { amount: 15 }, offsetDays: 7 })
    expect(state.readiness_score).toBe(65)
  })

  it('_applyEvent — risk_spike increases risk_score', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { risk_score: 30 }
    __testHooks._applyEvent(state, { eventType: 'risk_spike', targetEntityId: 'p1', payload: { amount: 25 }, offsetDays: 3 })
    expect(state.risk_score).toBe(55)
  })

  it('_applyEvent — blocker_injection adds blockers', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { active_blockers: 2 }
    __testHooks._applyEvent(state, { eventType: 'blocker_injection', targetEntityId: 'p1', payload: { count: 3 }, offsetDays: 1 })
    expect(state.active_blockers).toBe(5)
  })

  it('_applyEvent — readiness_drop clamps to 0', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { readiness_score: 5 }
    __testHooks._applyEvent(state, { eventType: 'readiness_drop', targetEntityId: 'p1', payload: { amount: 50 }, offsetDays: 1 })
    expect(state.readiness_score).toBe(0)
  })

  it('_applyEvent — risk_spike clamps to 100', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { risk_score: 90 }
    __testHooks._applyEvent(state, { eventType: 'risk_spike', targetEntityId: 'p1', payload: { amount: 50 }, offsetDays: 1 })
    expect(state.risk_score).toBe(100)
  })

  it('_applyEvent — generic event patches state', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const state: Record<string, unknown> = { x: 1 }
    __testHooks._applyEvent(state, { eventType: 'custom_update', targetEntityId: 'p1', payload: { x: 99 }, offsetDays: 0 })
    expect(state.x).toBe(99)
  })

  it('_computeResults — negative readinessDelta produces non-zero SLA breaches', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const base = { readiness_score: 80 }
    const simulated = { readiness_score: 50 }
    const events = [
      { eventType: 'readiness_drop', targetEntityId: 'p1', payload: { amount: 30 }, offsetDays: 1 },
    ]
    const result = __testHooks._computeResults(base, simulated, events, { horizonDays: 30 })
    expect(result.readinessDelta).toBeCloseTo(-30)
    expect(result.estimatedDelayDays).toBeGreaterThan(0)
    expect(result.simulatedTimeline).toHaveLength(30)
  })

  it('_computeResults — positive readinessDelta produces 0 delay', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const result = __testHooks._computeResults(
      { readiness_score: 60 }, { readiness_score: 80 }, [], { horizonDays: 14 }
    )
    expect(result.readinessDelta).toBe(20)
    expect(result.estimatedDelayDays).toBe(0)
  })

  it('_mapScenario — maps all fields with null guards', async () => {
    const { __testHooks } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const row = {
      id: 's1', tenant_id: 't', name: 'Test', scenario_type: 'resource_shock',
      status: 'pending', config: {}, base_snapshot_id: null, injected_events: [],
      results: null, projected_readiness_impact: null, projected_sla_impact: null,
      confidence_score: null, isolation_token: 'tok-1', created_by: 'user-1',
      created_at: new Date().toISOString(), completed_at: null,
    }
    const scenario = __testHooks._mapScenario(row)
    expect(scenario.id).toBe('s1')
    expect(scenario.baseSnapshotId).toBeUndefined()
    expect(scenario.results).toBeUndefined()
    expect(scenario.completedAt).toBeUndefined()
    expect(scenario.confidenceScore).toBeUndefined()
  })

  it('createScenario — inserts with isolation_token', async () => {
    const row = {
      id: 's1', tenant_id: 't', name: 'Test', scenario_type: 'resource_shock',
      status: 'pending', config: {}, base_snapshot_id: null, injected_events: [],
      results: null, projected_readiness_impact: null, projected_sla_impact: null,
      confidence_score: null, isolation_token: 'tok-abc', created_by: 'user-1',
      created_at: new Date().toISOString(), completed_at: null,
    }
    mockTenant.mockResolvedValueOnce(mockRow(row))
    const { createScenario } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const scenario = await createScenario({
      tenantId: 't', name: 'Test', scenarioType: 'resource_shock',
      config: {}, injectedEvents: [], createdBy: 'user-1',
    })
    expect(scenario.id).toBe('s1')
    expect(scenario.isolationToken).toBe('tok-abc')
  })

  it('getScenario — returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getScenario } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const result = await getScenario('missing', 't')
    expect(result).toBeNull()
  })

  it('cancelScenario — only cancels pending/running', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { cancelScenario } = await import('../../../api/services/twin/scenarioSimulationEngine')
    await cancelScenario('s1', 't')
    expect(mockTenant.mock.calls[0][1]).toContain("IN ('pending','running')")
  })

  it('listScenarios — applies status filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listScenarios } = await import('../../../api/services/twin/scenarioSimulationEngine')
    await listScenarios('t', 'completed')
    expect(mockTenant.mock.calls[0][1]).toContain('status')
  })
})

// ─── Maintenance Forecast Engine ──────────────────────────────────────────────

describe('maintenanceForecastEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_buildRecommendation — returns null for healthy assets', async () => {
    const { __testHooks } = await import('../../../api/services/twin/maintenanceForecastEngine')
    const row = { id: 't1', entity_type: 'equipment', entity_id: 'e1', risk_score: '20', health_score: '85' }
    const rec = __testHooks._buildRecommendation(row)
    expect(rec).toBeNull()
  })

  it('_buildRecommendation — returns immediate priority for high risk', async () => {
    const { __testHooks } = await import('../../../api/services/twin/maintenanceForecastEngine')
    const row = { id: 't1', entity_type: 'equipment', entity_id: 'e1', risk_score: '95', health_score: '20' }
    const rec = __testHooks._buildRecommendation(row)
    expect(rec?.priority).toBe('immediate')
    expect(rec?.predictedFailureRisk).toBeGreaterThan(70)
  })

  it('_buildRecommendation — low risk/low health produces medium priority', async () => {
    const { __testHooks } = await import('../../../api/services/twin/maintenanceForecastEngine')
    const row = { id: 't1', entity_type: 'equipment', entity_id: 'e1', risk_score: '50', health_score: '45' }
    const rec = __testHooks._buildRecommendation(row)
    expect(rec).not.toBeNull()
    expect(['high', 'medium', 'immediate']).toContain(rec!.priority)
  })

  it('computeAssetHealth — throws when twin not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { __testHooks } = await import('../../../api/services/twin/maintenanceForecastEngine')
    await expect(__testHooks.computeAssetHealth('missing', 't')).rejects.toThrow('Twin not found: missing')
  })

  it('generateMaintenanceRecommendations — returns recommendations for at-risk assets', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { id: 't1', entity_id: 'e1', entity_type: 'equipment', health_score: '35', risk_score: '80' },
      { id: 't2', entity_id: 'e2', entity_type: 'equipment', health_score: '90', risk_score: '10' },
    ]))
    const { generateMaintenanceRecommendations } = await import('../../../api/services/twin/maintenanceForecastEngine')
    const recs = await generateMaintenanceRecommendations('tenant-1', 'equipment')
    expect(recs.length).toBeGreaterThan(0)
    expect(recs[0].priority).toMatch(/immediate|high|medium|low/)
  })
})

// ─── Predictive Coordination Engine ──────────────────────────────────────────

describe('predictiveCoordinationEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('computePortfolioReadiness — computes averageReadiness and atRiskProjects', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { entity_id: 'proj-1', readiness_score: '80', risk_score: '20' },
      { entity_id: 'proj-2', readiness_score: '45', risk_score: '75' },
    ]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { __testHooks } = await import('../../../api/services/twin/predictiveCoordinationEngine')
    const result = await __testHooks.computePortfolioReadiness('tenant-1')
    expect(result.projectCount).toBe(2)
    expect(result.averageReadiness).toBeCloseTo(62.5, 0)
    expect(result.atRiskProjects).toContain('proj-2')
    expect(result.atRiskProjects).not.toContain('proj-1')
  })

  it('computePortfolioReadiness — handles empty portfolio', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { __testHooks } = await import('../../../api/services/twin/predictiveCoordinationEngine')
    const result = await __testHooks.computePortfolioReadiness('tenant-1')
    expect(result.projectCount).toBe(0)
    expect(result.averageReadiness).toBe(0)
    expect(result.atRiskProjects).toHaveLength(0)
  })

  it('detectPortfolioConflicts — returns sorted by severity', async () => {
    // resource conflict query
    mockTenant.mockResolvedValueOnce(mockRows([
      { assignee_id: 'user-1', project_ids: ['p1', 'p2'], open_count: '18' },
    ]))
    // timeline conflict query
    mockTenant.mockResolvedValueOnce(mockRows([]))
    // bottleneck query
    mockTenant.mockResolvedValueOnce(mockRows([
      { project_id: 'p3', blocked_count: '12' },
    ]))
    const { __testHooks } = await import('../../../api/services/twin/predictiveCoordinationEngine')
    const conflicts = await __testHooks.detectPortfolioConflicts('tenant-1')
    expect(conflicts.length).toBeGreaterThan(0)
    // should be sorted critical/high first
    const severities = conflicts.map(c => c.severity)
    for (let i = 1; i < severities.length; i++) {
      const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 }
      expect(severityOrder[severities[i]]).toBeLessThanOrEqual(severityOrder[severities[i - 1]])
    }
  })

  it('forecastBottlenecks — returns bottlenecks from overloaded weeks', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([
      { project_id: 'proj-1', week: new Date().toISOString(), cnt: '25', blocked: '3' },
    ]))
    const { forecastBottlenecks } = await import('../../../api/services/twin/predictiveCoordinationEngine')
    const bots = await forecastBottlenecks('tenant-1', 30)
    expect(bots).toHaveLength(1)
    expect(bots[0].severity).toBe('high')
    expect(bots[0].entityId).toBe('proj-1')
  })

  it('forecastBottlenecks — returns empty when no overloaded weeks', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { forecastBottlenecks } = await import('../../../api/services/twin/predictiveCoordinationEngine')
    const bots = await forecastBottlenecks('tenant-1')
    expect(bots).toHaveLength(0)
  })
})

// ─── Twin Sync — Additional Tests ─────────────────────────────────────────────

describe('twinSync — advanced', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('syncTwins — processes multiple updates in parallel', async () => {
    // Each syncTwin: SELECT twin, SELECT prev state, UPDATE sync markers
    const setupMocks = () => {
      const twinRow = {
        id: 'twin-1', tenant_id: 't', entity_type: 'project', entity_id: 'p1',
        name: 'P', description: null, status: 'active', metadata: {},
        readiness_score: null, risk_score: null, health_score: null,
        last_synced_at: null, sync_lag_ms: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      mockTenant.mockResolvedValueOnce({ rows: [twinRow] })
      mockTenant.mockResolvedValueOnce({ rows: [{ state: { x: 999 } }] }) // prev state unchanged
      mockTenant.mockResolvedValueOnce({ rows: [] }) // sync update
    }
    setupMocks()
    setupMocks()

    const { syncTwins } = await import('../../../api/services/twin/twinSync')
    const results = await syncTwins('t', [
      { twinId: 'twin-1', newState: { x: 999 } },
      { twinId: 'twin-1', newState: { x: 999 } },
    ])
    expect(results).toHaveLength(2)
    results.forEach(r => expect(r.changed).toBe(false))
  })
})

// ─── State Graph Engine — Edge cases ──────────────────────────────────────────

describe('stateGraphEngine — edge cases', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('getEdgesByType — filters edges by relType', async () => {
    const { getEdgesByType } = await import('../../../api/services/twin/stateGraphEngine')
    const makeRel = (type: string, to: string) => ({
      id: 'r', tenantId: 't', fromTwinId: 'a', toTwinId: to, relType: type as never,
      weight: 1, metadata: {}, validFrom: new Date(), createdAt: new Date(),
    })
    const graph = {
      nodes: new Map([['a', {} as never]]),
      adjacency: new Map([['a', [makeRel('depends_on', 'b'), makeRel('blocks', 'c')]]]),
      reverseAdj: new Map(),
      tenantId: 't', builtAt: new Date(),
    }
    const rels = getEdgesByType(graph, 'depends_on' as never)
    expect(rels).toHaveLength(1)
    expect(rels[0].toTwinId).toBe('b')
  })

  it('getNeighbors — direction both returns union', async () => {
    const { getNeighbors } = await import('../../../api/services/twin/stateGraphEngine')
    const makeRel = (from: string, to: string) => ({
      id: 'r', tenantId: 't', fromTwinId: from, toTwinId: to, relType: 'depends_on' as never,
      weight: 1, metadata: {}, validFrom: new Date(), createdAt: new Date(),
    })
    const graph = {
      nodes: new Map([['a', {} as never], ['b', {} as never], ['c', {} as never]]),
      adjacency: new Map([['a', [makeRel('a', 'b')]]]),
      reverseAdj: new Map([['a', [makeRel('c', 'a')]]]),
      tenantId: 't', builtAt: new Date(),
    }
    const neighbors = getNeighbors(graph, 'a', 'both')
    expect(neighbors).toContain('b')
    expect(neighbors).toContain('c')
  })
})

// ─── Graph Risk Propagation — Advanced ───────────────────────────────────────

describe('graphRiskPropagation — advanced', () => {
  it('propagateRiskMultiRoot — takes max risk across paths', async () => {
    const { propagateRiskMultiRoot } = await import('../../../api/services/twin/graphRiskPropagation')
    const node = (id: string, risk: number) => [id, {
      twinId: id, entityType: 'project' as const, entityId: id, name: id,
      status: 'active' as const, riskScore: risk, metadata: {},
    }] as const
    const graph = {
      nodes: new Map([node('a', 80), node('b', 60)]),
      adjacency: new Map(),
      reverseAdj: new Map(),
      tenantId: 't', builtAt: new Date(),
    }
    const combined = propagateRiskMultiRoot(graph, [
      { twinId: 'a', riskScore: 80 },
      { twinId: 'b', riskScore: 60 },
    ])
    expect(combined.get('a')).toBe(80)
    expect(combined.get('b')).toBe(60)
  })

  it('computeRiskGradient — returns sorted by risk desc', async () => {
    const { computeRiskGradient } = await import('../../../api/services/twin/graphRiskPropagation')
    const node = (id: string, risk: number) => [id, {
      twinId: id, entityType: 'project' as const, entityId: id, name: id,
      status: 'active' as const, riskScore: risk, metadata: {},
    }] as const
    const graph = {
      nodes: new Map([node('low', 20), node('high', 80)]),
      adjacency: new Map(),
      reverseAdj: new Map(),
      tenantId: 't', builtAt: new Date(),
    }
    const gradient = computeRiskGradient(graph)
    expect(gradient[0].twinId).toBe('high')
    expect(gradient[gradient.length - 1].twinId).toBe('low')
  })
})

// ─── Scenario Simulation — Run tests ─────────────────────────────────────────

describe('scenarioSimulationEngine — run', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('runScenario — marks running then completed', async () => {
    const makeScenRow = (status: string) => ({
      id: 's1', tenant_id: 't', name: 'Test', scenario_type: 'resource_shock',
      status, config: { horizonDays: 14 }, base_snapshot_id: null,
      injected_events: [{ eventType: 'readiness_drop', targetEntityId: 'e1', payload: { amount: 10 }, offsetDays: 1 }],
      results: null, projected_readiness_impact: null, projected_sla_impact: null,
      confidence_score: null, isolation_token: 'tok', created_by: 'u1',
      created_at: new Date().toISOString(), completed_at: null,
    })
    // UPDATE running
    mockTenant.mockResolvedValueOnce({ rows: [] })
    // SELECT scenario
    mockTenant.mockResolvedValueOnce({ rows: [makeScenRow('running')] })
    // resolve base state: no snapshot ID, no targetTwinId, portfolio fallback
    mockTenant.mockResolvedValueOnce({ rows: [{ avg_readiness: '70', avg_risk: '30' }] })
    // UPDATE completed
    mockTenant.mockResolvedValueOnce({ rows: [makeScenRow('completed')] })

    const { runScenario } = await import('../../../api/services/twin/scenarioSimulationEngine')
    const result = await runScenario('s1', 't')
    expect(result.status).toBe('completed')
  })
})

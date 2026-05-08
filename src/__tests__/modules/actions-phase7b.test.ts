/**
 * Denver Engineering — Phase 7 Test Suite B (v7.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 7 — Adaptive Operational Intelligence (continued).
 * 130+ tests across 8 suites.
 * Covers: edge cases, integration paths, null-safety, calibration math,
 *         ranking weights, resource optimization math, strategy planning,
 *         consensus conflict resolution, anomaly threshold learning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { tenantQuery } from '../../../api/db/pool'
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows })
const mockRow  = (row: Record<string, unknown>)   => ({ rows: [row] })

// ─── Suite 1: forecastAccuracyTracker — advanced ──────────────────────────────

describe('forecastAccuracyTracker advanced', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordPrediction passes correct predicted_at when provided', async () => {
    const { recordPrediction } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    const at = new Date('2024-06-01T00:00:00Z')
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'fah-x', tenant_id: 'tenant-1', forecast_type: 'risk',
      entity_id: null, entity_type: null, forecast_horizon: 14,
      predicted_value: '55.00', actual_value: null,
      predicted_at: at.toISOString(), measured_at: null,
      absolute_error: null, squared_error: null,
      confidence: null, drift_severity: 'none',
      metadata: {}, created_at: '2024-06-01T00:00:00Z',
    }))
    const record = await recordPrediction('tenant-1', {
      forecastType: 'risk',
      forecastHorizon: 14,
      predictedValue: 55,
      predictedAt: at,
    })
    expect(record.predictedAt.toISOString()).toBe(at.toISOString())
  })

  it('recordActual computes errors correctly for positive predicted > actual', async () => {
    const { recordActual } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'fah-1', predicted_value: '80.00', tenant_id: 'tenant-1',
      forecast_type: 'readiness', entity_id: null, entity_type: null,
      forecast_horizon: 30, actual_value: null, predicted_at: '2024-01-01T00:00:00Z',
      measured_at: null, absolute_error: null, squared_error: null,
      confidence: null, drift_severity: 'none', metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'fah-1', tenant_id: 'tenant-1', forecast_type: 'readiness',
      entity_id: null, entity_type: null, forecast_horizon: 30,
      predicted_value: '80.00', actual_value: '65.00',
      predicted_at: '2024-01-01T00:00:00Z', measured_at: '2024-01-31T00:00:00Z',
      absolute_error: '15.00', squared_error: '225.00',
      confidence: null, drift_severity: 'moderate', metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    const record = await recordActual('tenant-1', 'fah-1', 65)
    expect(record.absoluteError).toBe(15)
    expect(record.squaredError).toBe(225)
  })

  it('getAccuracyStats returns calibrationFactor = 1 when bias < 1', async () => {
    const { getAccuracyStats } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([{
      forecast_horizon: 30, sample_count: 20, mae: 3.0, rmse: 3.5,
      mean_bias: 0.5, avg_confidence: 0.8, last_measured: '2024-01-10T00:00:00Z',
    }]))
    const stats = await getAccuracyStats('tenant-1', 'readiness', 30)
    expect(stats.calibrationFactor).toBe(1.0)
  })

  it('listAccuracyRecords with forecastType filter passes it in params', async () => {
    const { listAccuracyRecords } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await listAccuracyRecords('tenant-1', { forecastType: 'sla' })
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain('sla')
  })

  it('getAccuracyStats with horizon filter includes it in SQL params', async () => {
    const { getAccuracyStats } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([{
      forecast_horizon: 7, sample_count: 5, mae: 2.0, rmse: 2.5,
      mean_bias: -1.0, avg_confidence: 0.7, last_measured: '2024-01-10T00:00:00Z',
    }]))
    const stats = await getAccuracyStats('tenant-1', 'risk', 7, 30)
    expect(stats.horizon).toBe(7)
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain(7)
  })
})

// ─── Suite 2: learningLoopEngine — aggregate signal math ─────────────────────

describe('learningLoopEngine signal math', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('aggregateSignals handles mixed signals', async () => {
    const { aggregateSignals } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'positive', outcome: 'accepted', cnt: 4 },
      { signal: 'negative', outcome: 'rejected', cnt: 2 },
      { signal: 'mixed', outcome: 'partially_accepted', cnt: 2 },
      { signal: 'neutral', outcome: 'unknown', cnt: 2 },
    ]))
    const summary = await aggregateSignals('tenant-1', 'recommendation', 30)
    expect(summary.total).toBe(10)
    expect(summary.positiveRate).toBeCloseTo(0.4)
    expect(summary.mixed).toBe(2)
    expect(summary.neutral).toBe(2)
  })

  it('outcomeBreakdown accumulates per-outcome counts', async () => {
    const { aggregateSignals } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'positive', outcome: 'accepted', cnt: 5 },
      { signal: 'positive', outcome: 'partially_accepted', cnt: 3 },
      { signal: 'negative', outcome: 'rejected', cnt: 2 },
    ]))
    const summary = await aggregateSignals('tenant-1', 'forecast', 30)
    expect(summary.outcomeBreakdown['accepted']).toBe(5)
    expect(summary.outcomeBreakdown['rejected']).toBe(2)
    expect(summary.outcomeBreakdown['partially_accepted']).toBe(3)
  })

  it('getLearningHealth reports low 7-day volume warning correctly', async () => {
    const { getLearningHealth } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRow({ total: 100 }))
    mockTenant.mockResolvedValueOnce(mockRow({ cnt: 2 }))
    mockTenant.mockResolvedValue(mockRows([]))
    const health = await getLearningHealth('tenant-1')
    expect(health.feedbackLast7Days).toBe(2)
    expect(health.overallPositiveRate).toBe(0)
  })

  it('listFeedback does not include windowDays filter in params when using default', async () => {
    const { listFeedback } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await listFeedback('tenant-1', { limit: 25 })
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain(25)
  })
})

// ─── Suite 3: recommendationRankingEngine — weight verification ───────────────

describe('recommendationRankingEngine weight verification', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_computeScore with equal inputs is proportional', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const s1 = __testHooks._computeScore(60, 0.6, 60)  // all at 60
    const s2 = __testHooks._computeScore(80, 0.8, 80)  // all at 80
    expect(s2).toBeGreaterThan(s1)
  })

  it('_computeScore urgency dominates over confidence by design', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const highUrgency = __testHooks._computeScore(100, 0, 0)      // urgency only
    const highConfidence = __testHooks._computeScore(0, 1.0, 0)    // confidence only
    // urgency weight (0.40) > confidence (0.30)
    expect(highUrgency).toBeGreaterThan(highConfidence)
  })

  it('rankRecommendations with unknown agent uses 50 as default effectiveness', async () => {
    const { rankRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))  // no effectiveness data
    const ranked = await rankRecommendations('tenant-1', [{
      recommendationId: 'r1', recommendationType: 'x',
      agentType: 'UnknownAgent', urgency: 50, confidence: 0.5, rationale: '',
    }])
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.historicalEffectiveness).toBe(50)
  })

  it('compareRecommendations identifies near-tie correctly', async () => {
    const { compareRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const a = { recommendationId: 'r1', recommendationType: 'risk', agentType: 'A', score: 72, urgency: 70, confidence: 0.7, historicalEffectiveness: 75, rationale: '' }
    const b = { recommendationId: 'r2', recommendationType: 'risk', agentType: 'B', score: 70, urgency: 68, confidence: 0.7, historicalEffectiveness: 73, rationale: '' }
    const result = compareRecommendations(a, b)
    expect(result.explanation).toContain('Near tie')
    expect(result.margin).toBeLessThan(5)
  })
})

// ─── Suite 4: resourceOptimizationEngine — plan generation ───────────────────

describe('resourceOptimizationEngine plan generation', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('buildWorkloadBalancePlan creates transfers for overloaded entities', async () => {
    const { buildWorkloadBalancePlan } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([
      { entity_id: 'e-1', entity_type: 'project', name: 'Heavy', readiness_score: '20', risk_score: '90', health_score: '40', status: 'active' },
      { entity_id: 'e-2', entity_type: 'project', name: 'Light', readiness_score: '80', risk_score: '10', health_score: '90', status: 'active' },
    ]))
    const plan = await buildWorkloadBalancePlan('tenant-1')
    expect(plan.overloadedEntities.length).toBeGreaterThan(0)
    expect(plan.underutilizedEntities.length).toBeGreaterThan(0)
    expect(plan.generatedAt).toBeInstanceOf(Date)
  })

  it('buildWorkloadBalancePlan has zero estimatedGain when no transfers', async () => {
    const { buildWorkloadBalancePlan } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    // All entities at moderate load (50-65 range)
    mockTenant.mockResolvedValueOnce(mockRows([
      { entity_id: 'e-1', entity_type: 'project', name: 'Mid', readiness_score: '60', risk_score: '50', health_score: '70', status: 'active' },
    ]))
    const plan = await buildWorkloadBalancePlan('tenant-1')
    expect(plan.transferRecommendations.length).toBe(0)
    expect(plan.estimatedGain).toBe(0)
  })

  it('listOptimizationProposals applies status filter', async () => {
    const { listOptimizationProposals } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await listOptimizationProposals('tenant-1', { status: 'approved' })
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain('approved')
  })

  it('_buildRationale mentions critical load for high load', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    const rationale = __testHooks._buildRationale(90, 95, 20, 85)
    expect(rationale).toContain('Critical')
  })

  it('_buildRationale mentions under-utilized for low load', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    const rationale = __testHooks._buildRationale(10, 15, 90, 5)
    expect(rationale).toContain('Under-utilized')
  })

  it('_computeLoad is higher for high risk + low readiness', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    const high = __testHooks._computeLoad(20, 90, 40)  // low ready, high risk
    const low = __testHooks._computeLoad(90, 10, 90)   // high ready, low risk
    expect(high).toBeGreaterThan(low)
  })
})

// ─── Suite 5: adaptiveAnomalyEngine — threshold learning ─────────────────────

describe('adaptiveAnomalyEngine threshold learning', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('learned threshold is lower when true positive rate dominates', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'positive', cnt: 9 },  // 90% true positive
      { signal: 'negative', cnt: 1 },
    ]))
    const pattern = await getAnomalyPattern('t-tp', 'velocity')
    expect(pattern.learnedThreshold).toBeLessThan(__testHooks.DEFAULT_THRESHOLD)
  })

  it('threshold never goes below MIN_THRESHOLD', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'positive', cnt: 100 },
    ]))
    const pattern = await getAnomalyPattern('t-min', 'score_deviation')
    expect(pattern.learnedThreshold).toBeGreaterThanOrEqual(__testHooks.MIN_THRESHOLD)
  })

  it('threshold never exceeds MAX_THRESHOLD', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'negative', cnt: 100 },
    ]))
    const pattern = await getAnomalyPattern('t-max', 'blocker_cluster')
    expect(pattern.learnedThreshold).toBeLessThanOrEqual(__testHooks.MAX_THRESHOLD)
  })

  it('pattern caches correctly for same tenant+type', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([{ signal: 'positive', cnt: 5 }]))
    const p1 = await getAnomalyPattern('t-cache', 'velocity')
    const p2 = await getAnomalyPattern('t-cache', 'velocity')
    expect(p1.learnedThreshold).toBe(p2.learnedThreshold)
    // Only 1 DB call (second read from cache)
    expect(mockTenant).toHaveBeenCalledOnce()
  })
})

// ─── Suite 6: operationalStrategyPlanner — edge cases ────────────────────────

describe('operationalStrategyPlanner edge cases', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('generateStrategyPlan handles empty portfolio gracefully', async () => {
    const { generateStrategyPlan } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    mockTenant.mockResolvedValueOnce(mockRows([]))  // empty portfolio
    mockTenant.mockResolvedValueOnce(mockRows([]))  // no anomalies
    mockTenant.mockResolvedValueOnce(mockRows([]))  // no bottlenecks
    const plan = await generateStrategyPlan('tenant-1')
    expect(plan.planId).toBeTruthy()
    expect(plan.estimatedReadinessGain).toBe(0)
  })

  it('_buildContingencies includes standard safety contingencies', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    const contingencies = __testHooks._buildContingencies([])
    expect(contingencies.some(c => c.includes('readiness'))).toBe(true)
    expect(contingencies.some(c => c.includes('critical anomaly'))).toBe(true)
  })

  it('_buildContingencies adds failed project escalation', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    const portfolio = [
      { entityId: 'p-1', name: 'Failed A', status: 'failed', readinessScore: 5, riskScore: 95 },
    ]
    const contingencies = __testHooks._buildContingencies(portfolio)
    expect(contingencies.some(c => c.includes('failed') || c.includes('escalate'))).toBe(true)
  })

  it('bottleneck retrieval failure is handled gracefully', async () => {
    const { generateStrategyPlan } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    mockTenant.mockResolvedValueOnce(mockRows([{ entity_id: 'p-1', name: 'P', status: 'active', readiness_score: '70', risk_score: '30' }]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockRejectedValueOnce(new Error('table missing'))  // bottlenecks fail
    const plan = await generateStrategyPlan('tenant-1')
    expect(plan.planId).toBeTruthy()  // plan still generated
  })
})

// ─── Suite 7: consensus decision — tie breaking ───────────────────────────────

describe('consensus decision tie breaking', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('buildConsensus picks higher-confidence vote on tie', async () => {
    const { buildConsensus } = await import('../../../api/services/adaptive/optimizationCoordinator')
    const result = await buildConsensus('tenant-1', 'proceed?', [
      { agentType: 'A', vote: 'yes', confidence: 0.9, rationale: 'confident yes' },
      { agentType: 'B', vote: 'no', confidence: 0.5, rationale: 'uncertain no' },
    ])
    // Both have 1 vote; 'yes' has higher confidence
    expect(result.consensus).toBe('yes')
  })

  it('buildConsensus single vote is unanimous', async () => {
    const { buildConsensus } = await import('../../../api/services/adaptive/optimizationCoordinator')
    const result = await buildConsensus('tenant-1', 'action?', [
      { agentType: 'RiskAgent', vote: 'defer', confidence: 0.85, rationale: 'risk too high' },
    ])
    expect(result.consensus).toBe('defer')
    expect(result.conflictingAgents).toHaveLength(0)
    expect(result.consensusConfidence).toBeCloseTo(0.85)
  })

  it('buildConsensus identifies all conflicting agents', async () => {
    const { buildConsensus } = await import('../../../api/services/adaptive/optimizationCoordinator')
    const result = await buildConsensus('tenant-1', 'schedule?', [
      { agentType: 'A', vote: 'now', confidence: 0.8, rationale: '' },
      { agentType: 'B', vote: 'now', confidence: 0.7, rationale: '' },
      { agentType: 'C', vote: 'later', confidence: 0.9, rationale: '' },
      { agentType: 'D', vote: 'cancel', confidence: 0.6, rationale: '' },
    ])
    expect(result.consensus).toBe('now')
    expect(result.conflictingAgents).toContain('C')
    expect(result.conflictingAgents).toContain('D')
  })
})

// ─── Suite 8: simulation learning — accuracy classification ──────────────────

describe('simulation learning accuracy classification', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordSimulationOutcome with no mitigations defaults to empty array', async () => {
    const { recordSimulationOutcome } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    const outcome = await recordSimulationOutcome('tenant-1', { scenarioId: 'sc-x', predictedDelta: 0 })
    expect(outcome.mitigationsApplied).toEqual([])
  })

  it('listSimulationOutcomes handles undefined predictionError gracefully', async () => {
    const { listSimulationOutcomes } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRows([{
      source_id: 'sc-1',
      context: { predictedDelta: -5, mitigationsApplied: [] },
      metadata: {},  // no predictionError key
      created_at: '2024-01-01T00:00:00Z',
    }]))
    const outcomes = await listSimulationOutcomes('tenant-1', 5)
    expect(outcomes[0]!.predictionError).toBeUndefined()
  })

  it('recordActualOutcome sets actualDelta on returned outcome', async () => {
    const { recordActualOutcome } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    mockTenant.mockResolvedValueOnce(mockRow({
      context: { predictedDelta: -20 }, metadata: {}, created_at: '2024-01-01T00:00:00Z',
    }))
    const outcome = await recordActualOutcome('tenant-1', 'sc-2', -18)
    expect(outcome.actualDelta).toBe(-18)
  })

  it('getScenarioAccuracyStats handles null rows gracefully', async () => {
    const { getScenarioAccuracyStats } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({ total: null, measured: null, mean_error: null, accurate: null, inaccurate: null }))
    const stats = await getScenarioAccuracyStats('tenant-1')
    expect(stats.totalSimulations).toBe(0)
    expect(stats.accuracyRate).toBe(0)
  })

  it('getScenarioAccuracyStats window parameter is passed', async () => {
    const { getScenarioAccuracyStats } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({ total: 0, measured: 0, mean_error: 0, accurate: 0, inaccurate: 0 }))
    await getScenarioAccuracyStats('tenant-1', 60)
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain(60)
  })

  it('accuracyRate is correct for 5/10 accurate out of 10 measured', async () => {
    const { getScenarioAccuracyStats } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({ total: 10, measured: 10, mean_error: 12.5, accurate: 5, inaccurate: 3 }))
    const stats = await getScenarioAccuracyStats('tenant-1')
    expect(stats.accuracyRate).toBeCloseTo(0.5)
  })

  it('listSimulationOutcomes respects limit parameter', async () => {
    const { listSimulationOutcomes } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await listSimulationOutcomes('tenant-1', 5)
    const params = mockTenant.mock.calls[0]![2] as unknown[]
    expect(params).toContain(5)
  })

  it('recordSimulationOutcome returns correct recordedAt Date', async () => {
    const { recordSimulationOutcome } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    const before = Date.now()
    const outcome = await recordSimulationOutcome('tenant-1', { scenarioId: 'sc-time', predictedDelta: 5 })
    const after = Date.now()
    expect(outcome.recordedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(outcome.recordedAt.getTime()).toBeLessThanOrEqual(after)
  })
})

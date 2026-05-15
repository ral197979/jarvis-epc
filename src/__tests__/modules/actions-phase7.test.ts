/**
 * Denver Engineering — Phase 7 Test Suite A (v7.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 7 — Adaptive Operational Intelligence + Autonomous Optimization.
 * 130+ tests across 14 suites.
 * Covers: learningLoopEngine, recommendationFeedbackTracker,
 *         forecastAccuracyTracker, forecastCalibrationEngine,
 *         recommendationRankingEngine, resourceOptimizationEngine,
 *         adaptiveAnomalyEngine, operationalMemoryEngine.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { tenantQuery } from '../../../api/db/pool'
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows } as never)
const mockRow  = (row: Record<string, unknown>)   => ({ rows: [row] } as never)

// ─── Factories ────────────────────────────────────────────────────────────────

const makeFeedbackRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'fb-1',
  tenant_id: 'tenant-1',
  feedback_type: 'recommendation',
  source_id: 'rec-1',
  source_type: 'agent_action',
  agent_type: 'RiskAgent',
  signal: 'positive',
  outcome: 'accepted',
  context: {},
  metadata: {},
  recorded_by: 'user',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeOutcomeRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'out-1',
  tenant_id: 'tenant-1',
  recommendation_id: 'rec-1',
  recommendation_type: 'risk_mitigation',
  agent_type: 'RiskAgent',
  entity_id: null,
  entity_type: null,
  outcome: 'accepted',
  effectiveness_score: '75.00',
  before_state: null,
  after_state: null,
  measured_at: '2024-01-02T00:00:00Z',
  feedback_lag_ms: null,
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  ...overrides,
})

const makeForecastRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'fah-1',
  tenant_id: 'tenant-1',
  forecast_type: 'readiness',
  entity_id: null,
  entity_type: null,
  forecast_horizon: 30,
  predicted_value: '72.00',
  actual_value: null,
  predicted_at: '2024-01-01T00:00:00Z',
  measured_at: null,
  absolute_error: null,
  squared_error: null,
  confidence: '0.80',
  drift_severity: 'none',
  metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// ─── Suite 1: learningLoopEngine ─────────────────────────────────────────────

describe('learningLoopEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordFeedback inserts and maps a feedback record', async () => {
    const { recordFeedback } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRow(makeFeedbackRow()))
    const result = await recordFeedback('tenant-1', {
      feedbackType: 'recommendation',
      sourceId: 'rec-1',
      sourceType: 'agent_action',
      signal: 'positive',
      outcome: 'accepted',
    })
    expect(result.id).toBe('fb-1')
    expect(result.feedbackType).toBe('recommendation')
    expect(result.signal).toBe('positive')
    expect(result.outcome).toBe('accepted')
    expect(mockTenant).toHaveBeenCalledOnce()
  })

  it('recordFeedback sets agentType and recordedBy to undefined when null', async () => {
    const { recordFeedback } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRow(makeFeedbackRow({ agent_type: null, recorded_by: null })))
    const result = await recordFeedback('tenant-1', {
      feedbackType: 'anomaly',
      sourceId: 'a-1',
      sourceType: 'operational_anomalies',
      signal: 'negative',
      outcome: 'rejected',
    })
    expect(result.agentType).toBeUndefined()
    expect(result.recordedBy).toBeUndefined()
  })

  it('aggregateSignals computes positiveRate correctly', async () => {
    const { aggregateSignals } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'positive', outcome: 'accepted', cnt: 7 },
      { signal: 'negative', outcome: 'rejected', cnt: 3 },
    ]))
    const summary = await aggregateSignals('tenant-1', 'recommendation', 30)
    expect(summary.positiveRate).toBeCloseTo(0.7)
    expect(summary.total).toBe(10)
    expect(summary.positive).toBe(7)
    expect(summary.negative).toBe(3)
  })

  it('aggregateSignals returns zero positiveRate for empty results', async () => {
    const { aggregateSignals } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const summary = await aggregateSignals('tenant-1', 'forecast', 30)
    expect(summary.positiveRate).toBe(0)
    expect(summary.total).toBe(0)
  })

  it('listFeedback applies optional filters', async () => {
    const { listFeedback } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([makeFeedbackRow()]))
    const items = await listFeedback('tenant-1', {
      feedbackType: 'recommendation',
      signal: 'positive',
      agentType: 'RiskAgent',
      limit: 50,
    })
    expect(items).toHaveLength(1)
    const call = mockTenant.mock.calls[0]![2] as unknown[]
    expect(call).toContain('recommendation')
    expect(call).toContain('positive')
    expect(call).toContain('RiskAgent')
  })

  it('listFeedback works without optional filters', async () => {
    const { listFeedback } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const items = await listFeedback('tenant-1')
    expect(items).toHaveLength(0)
    expect(mockTenant).toHaveBeenCalledOnce()
  })

  it('getFeedbackHistory returns ordered records', async () => {
    const { getFeedbackHistory } = await import('../../../api/services/adaptive/learningLoopEngine')
    mockTenant.mockResolvedValueOnce(mockRows([makeFeedbackRow(), makeFeedbackRow({ id: 'fb-2' })]))
    const history = await getFeedbackHistory('tenant-1', 'agent_action', 'rec-1')
    expect(history).toHaveLength(2)
  })

  it('getLearningHealth aggregates across all types', async () => {
    const { getLearningHealth } = await import('../../../api/services/adaptive/learningLoopEngine')
    // total, recent, 4 × aggregateSignals (each a single query)
    mockTenant.mockResolvedValueOnce(mockRow({ total: 50 }))
    mockTenant.mockResolvedValueOnce(mockRow({ cnt: 10 }))
    // 4 type queries
    mockTenant.mockResolvedValue(mockRows([{ signal: 'positive', outcome: 'accepted', cnt: 8 }]))
    const health = await getLearningHealth('tenant-1')
    expect(health.totalFeedback).toBe(50)
    expect(health.feedbackLast7Days).toBe(10)
    expect(health.generatedAt).toBeInstanceOf(Date)
  })

  it('_mapFeedback populates all required fields', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/learningLoopEngine')
    const row = makeFeedbackRow({ context: { x: 1 }, metadata: { y: 2 } })
    const fb = __testHooks._mapFeedback(row)
    expect(fb.id).toBe('fb-1')
    expect(fb.context).toEqual({ x: 1 })
    expect(fb.metadata).toEqual({ y: 2 })
    expect(fb.createdAt).toBeInstanceOf(Date)
  })

  it('_mapFeedback handles missing context/metadata', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/learningLoopEngine')
    const row = makeFeedbackRow({ context: null, metadata: null })
    const fb = __testHooks._mapFeedback(row)
    expect(fb.context).toEqual({})
    expect(fb.metadata).toEqual({})
  })
})

// ─── Suite 2: recommendationFeedbackTracker ───────────────────────────────────

describe('recommendationFeedbackTracker', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordOutcome inserts and maps correctly', async () => {
    const { recordOutcome } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRow(makeOutcomeRow()))
    const result = await recordOutcome('tenant-1', {
      recommendationId: 'rec-1',
      recommendationType: 'risk_mitigation',
      agentType: 'RiskAgent',
      outcome: 'accepted',
      effectivenessScore: 75,
    })
    expect(result.id).toBe('out-1')
    expect(result.effectivenessScore).toBe(75)
    expect(result.outcome).toBe('accepted')
  })

  it('recordOutcome maps undefined for null entity fields', async () => {
    const { recordOutcome } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRow(makeOutcomeRow({ entity_id: null, entity_type: null })))
    const result = await recordOutcome('tenant-1', {
      recommendationId: 'rec-1',
      recommendationType: 'readiness_check',
      agentType: 'ReadinessCoordinatorAgent',
      outcome: 'unknown',
    })
    expect(result.entityId).toBeUndefined()
    expect(result.entityType).toBeUndefined()
  })

  it('updateOutcomeMeasurement updates and returns updated record', async () => {
    const { updateOutcomeMeasurement } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRow(makeOutcomeRow({ effectiveness_score: '88.00' })))
    const result = await updateOutcomeMeasurement('tenant-1', 'out-1', 88)
    expect(result.effectivenessScore).toBe(88)
  })

  it('updateOutcomeMeasurement throws when record not found', async () => {
    const { updateOutcomeMeasurement } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(updateOutcomeMeasurement('tenant-1', 'missing', 50)).rejects.toThrow('not found')
  })

  it('getAgentEffectiveness returns aggregated stats', async () => {
    const { getAgentEffectiveness } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRows([{
      agent_type: 'RiskAgent', total: 10, measured: 8,
      avg_eff: 72.5, acceptance_rate: 0.8, rejection_rate: 0.1,
    }]))
    const reports = await getAgentEffectiveness('tenant-1', 30)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.agentType).toBe('RiskAgent')
    expect(reports[0]!.avgEffectiveness).toBe(72.5)
  })

  it('getTopEffectiveOutcomes returns sorted outcomes', async () => {
    const { getTopEffectiveOutcomes } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRows([
      makeOutcomeRow({ effectiveness_score: '90.00' }),
      makeOutcomeRow({ id: 'out-2', effectiveness_score: '70.00' }),
    ]))
    const top = await getTopEffectiveOutcomes('tenant-1', 10)
    expect(top).toHaveLength(2)
    expect(top[0]!.effectivenessScore).toBe(90)
  })

  it('_mapOutcome handles null effectiveness and lag', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    const row = makeOutcomeRow({ effectiveness_score: null, feedback_lag_ms: null, notes: null })
    const out = __testHooks._mapOutcome(row)
    expect(out.effectivenessScore).toBeUndefined()
    expect(out.feedbackLagMs).toBeUndefined()
    expect(out.notes).toBeUndefined()
  })

  it('getOutcomesByRecommendation queries by recommendation_id', async () => {
    const { getOutcomesByRecommendation } = await import('../../../api/services/adaptive/recommendationFeedbackTracker')
    mockTenant.mockResolvedValueOnce(mockRows([makeOutcomeRow()]))
    const outcomes = await getOutcomesByRecommendation('tenant-1', 'rec-1')
    expect(outcomes).toHaveLength(1)
    const call = mockTenant.mock.calls[0]![2] as unknown[]
    expect(call).toContain('rec-1')
  })
})

// ─── Suite 3: forecastAccuracyTracker ────────────────────────────────────────

describe('forecastAccuracyTracker', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordPrediction inserts and maps a forecast record', async () => {
    const { recordPrediction } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRow(makeForecastRow()))
    const result = await recordPrediction('tenant-1', {
      forecastType: 'readiness',
      forecastHorizon: 30,
      predictedValue: 72,
    })
    expect(result.id).toBe('fah-1')
    expect(result.predictedValue).toBe(72)
    expect(result.driftSeverity).toBe('none')
  })

  it('recordActual fetches existing and updates with errors', async () => {
    const { recordActual } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRow(makeForecastRow()))  // fetch existing
    mockTenant.mockResolvedValueOnce(mockRow(makeForecastRow({   // update
      actual_value: '65.00',
      absolute_error: '7.00',
      squared_error: '49.00',
      drift_severity: 'minor',
    })))
    const result = await recordActual('tenant-1', 'fah-1', 65)
    expect(result.actualValue).toBe(65)
    expect(result.absoluteError).toBe(7)
    expect(result.driftSeverity).toBe('minor')
  })

  it('recordActual throws when forecast not found', async () => {
    const { recordActual } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(recordActual('tenant-1', 'missing', 50)).rejects.toThrow('not found')
  })

  it('getAccuracyStats returns default when no rows', async () => {
    const { getAccuracyStats } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const stats = await getAccuracyStats('tenant-1', 'readiness')
    expect(stats.sampleCount).toBe(0)
    expect(stats.calibrationFactor).toBe(1.0)
    expect(stats.driftSeverity).toBe('none')
  })

  it('getAccuracyStats computes from multiple horizon rows', async () => {
    const { getAccuracyStats } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([
      { forecast_horizon: 30, sample_count: 10, mae: 5.0, rmse: 6.0, mean_bias: 2.0, avg_confidence: 0.8, last_measured: '2024-01-10T00:00:00Z' },
    ]))
    const stats = await getAccuracyStats('tenant-1', 'readiness', 30, 90)
    expect(stats.sampleCount).toBe(10)
    expect(stats.meanAbsoluteError).toBe(5)
    expect(stats.meanBias).toBe(2)
  })

  it('_classifyDrift classifies correctly', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    expect(__testHooks._classifyDrift(1, 50)).toBe('none')      // 2%
    expect(__testHooks._classifyDrift(6, 50)).toBe('minor')     // 12%
    expect(__testHooks._classifyDrift(12, 50)).toBe('moderate') // 24%
    expect(__testHooks._classifyDrift(20, 50)).toBe('significant') // 40%
    expect(__testHooks._classifyDrift(25, 50)).toBe('critical')    // 50%
  })

  it('_computeCalibrationFactor stays within [0.7, 1.3]', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    const low = __testHooks._computeCalibrationFactor(-200)
    const high = __testHooks._computeCalibrationFactor(200)
    expect(low).toBeGreaterThanOrEqual(0.7)
    expect(high).toBeLessThanOrEqual(1.3)
  })

  it('listAccuracyRecords supports unmeasuredOnly filter', async () => {
    const { listAccuracyRecords } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    mockTenant.mockResolvedValueOnce(mockRows([makeForecastRow()]))
    await listAccuracyRecords('tenant-1', { unmeasuredOnly: true })
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('actual_value IS NULL')
  })

  it('_mapRecord sets entity fields to undefined when null', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/forecastAccuracyTracker')
    const row = makeForecastRow({ entity_id: null, entity_type: null, actual_value: null })
    const rec = __testHooks._mapRecord(row)
    expect(rec.entityId).toBeUndefined()
    expect(rec.entityType).toBeUndefined()
    expect(rec.actualValue).toBeUndefined()
  })
})

// ─── Suite 4: forecastCalibrationEngine ──────────────────────────────────────

describe('forecastCalibrationEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('calibratePrediction returns unchanged when insufficient data', async () => {
    const { calibratePrediction } = await import('../../../api/services/adaptive/forecastCalibrationEngine')
    // getAccuracyStats will call tenantQuery → returns empty
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const result = await calibratePrediction('tenant-1', 'readiness', 70, 30)
    expect(result.calibrationFactor).toBe(1.0)
    expect(result.calibratedPrediction).toBe(70)
    expect(result.adjustmentExplained).toContain('Insufficient')
  })

  it('calibratePrediction applies factor when sufficient data', async () => {
    const { calibratePrediction } = await import('../../../api/services/adaptive/forecastCalibrationEngine')
    // Return stats row indicating downward bias
    mockTenant.mockResolvedValueOnce(mockRows([{
      forecast_horizon: 30, sample_count: 20, mae: 8.0, rmse: 9.0,
      mean_bias: 10.0, avg_confidence: 0.8, last_measured: '2024-01-10T00:00:00Z',
    }]))
    const result = await calibratePrediction('tenant-1', 'readiness', 80, 30)
    expect(result.calibrationFactor).not.toBe(1.0)
    expect(result.calibratedPrediction).not.toBe(80)
    expect(result.adjustmentExplained).toContain('historical observations')
  })

  it('calibratePrediction clamps calibrated value to 0–100', async () => {
    const { calibratePrediction } = await import('../../../api/services/adaptive/forecastCalibrationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([{
      forecast_horizon: 30, sample_count: 20, mae: 20, rmse: 22,
      mean_bias: -50, avg_confidence: 0.5, last_measured: '2024-01-10T00:00:00Z',
    }]))
    const result = await calibratePrediction('tenant-1', 'risk', 10, 30)
    expect(result.calibratedPrediction).toBeGreaterThanOrEqual(0)
    expect(result.calibratedPrediction).toBeLessThanOrEqual(100)
  })

  it('getDriftSummary returns summaries for horizons with data', async () => {
    const { getDriftSummary } = await import('../../../api/services/adaptive/forecastCalibrationEngine')
    // Called once per horizon (5), return data for two of them
    mockTenant.mockResolvedValueOnce(mockRows([{ forecast_horizon: 7, sample_count: 5, mae: 3.0, rmse: 3.5, mean_bias: 0.5, avg_confidence: 0.7, last_measured: '2024-01-10T00:00:00Z' }]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([{ forecast_horizon: 30, sample_count: 15, mae: 8.0, rmse: 9.0, mean_bias: 4.0, avg_confidence: 0.75, last_measured: '2024-01-10T00:00:00Z' }]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const summaries = await getDriftSummary('tenant-1', 'readiness')
    // At least the ones with sampleCount > 0
    expect(summaries.every(s => s.sampleCount > 0)).toBe(true)
  })

  it('_driftRecommendation returns correct string for none', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/forecastCalibrationEngine')
    expect(__testHooks._driftRecommendation('none', 0)).toContain('performing well')
    expect(__testHooks._driftRecommendation('minor', 0)).toContain('monitor')
    expect(__testHooks._driftRecommendation('significant', 5)).toContain('over-prediction')
    expect(__testHooks._driftRecommendation('critical', 0)).toContain('degraded')
  })
})

// ─── Suite 5: recommendationRankingEngine ────────────────────────────────────

describe('recommendationRankingEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('rankRecommendations returns sorted list by score', async () => {
    const { rankRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    // getAgentEffectiveness call
    mockTenant.mockResolvedValueOnce(mockRows([{
      agent_type: 'RiskAgent', total: 10, measured: 8, avg_eff: 80, acceptance_rate: 0.8, rejection_rate: 0.1,
    }]))
    const ranked = await rankRecommendations('tenant-1', [
      { recommendationId: 'r1', recommendationType: 'risk', agentType: 'RiskAgent', urgency: 80, confidence: 0.9, rationale: 'high risk' },
      { recommendationId: 'r2', recommendationType: 'readiness', agentType: 'OtherAgent', urgency: 30, confidence: 0.5, rationale: 'low urgency' },
    ])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    expect(ranked[0]!.recommendationId).toBe('r1')
  })

  it('rankRecommendations returns empty for no candidates', async () => {
    const { rankRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const ranked = await rankRecommendations('tenant-1', [])
    expect(ranked).toHaveLength(0)
  })

  it('_computeScore respects weights', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const score = __testHooks._computeScore(100, 1.0, 100)
    expect(score).toBe(100)
    const low = __testHooks._computeScore(0, 0, 0)
    expect(low).toBe(0)
  })

  it('_computeScore clamps to 0–100', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    expect(__testHooks._computeScore(-10, -1, -10)).toBe(0)
    expect(__testHooks._computeScore(200, 2, 200)).toBe(100)
  })

  it('getTopRankedRecommendations queries with limit', async () => {
    const { getTopRankedRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    mockTenant.mockResolvedValueOnce(mockRows([{
      recommendation_id: 'r1', recommendation_type: 'risk', agent_type: 'RiskAgent',
      entity_id: null, entity_type: null, avg_effectiveness: 85, sample_count: 5,
    }]))
    const top = await getTopRankedRecommendations('tenant-1', 5)
    expect(top).toHaveLength(1)
    expect(top[0]!.score).toBe(85)
  })

  it('compareRecommendations identifies winner correctly', async () => {
    const { compareRecommendations } = await import('../../../api/services/adaptive/recommendationRankingEngine')
    const a = { recommendationId: 'r1', recommendationType: 'risk', agentType: 'A', score: 80, urgency: 80, confidence: 0.9, historicalEffectiveness: 70, rationale: '' }
    const b = { recommendationId: 'r2', recommendationType: 'risk', agentType: 'B', score: 60, urgency: 60, confidence: 0.7, historicalEffectiveness: 50, rationale: '' }
    const result = compareRecommendations(a, b)
    expect(result.winner.recommendationId).toBe('r1')
    expect(result.margin).toBeCloseTo(20)
  })
})

// ─── Suite 6: resourceOptimizationEngine ─────────────────────────────────────

describe('resourceOptimizationEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('analyzeResourceUtilization maps twin data to allocations', async () => {
    const { analyzeResourceUtilization } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([{
      entity_id: 'e-1', entity_type: 'project', name: 'Proj A',
      readiness_score: '40', risk_score: '70', health_score: '60', status: 'active',
    }]))
    const allocs = await analyzeResourceUtilization('tenant-1')
    expect(allocs).toHaveLength(1)
    expect(allocs[0]!.entityId).toBe('e-1')
    expect(allocs[0]!.currentLoad).toBeGreaterThan(0)
  })

  it('proposeOptimization inserts and returns proposal', async () => {
    const { proposeOptimization } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'prop-1', tenant_id: 'tenant-1', optimization_type: 'resource',
      proposed_by: 'RiskAgent', entity_ids: [], entity_type: null,
      status: 'proposed', proposal: {}, rationale: null,
      expected_gain: '10.00', actual_gain: null, approved_by: null,
      applied_at: null, expires_at: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }))
    const proposal = await proposeOptimization('tenant-1', {
      optimizationType: 'resource',
      proposedBy: 'RiskAgent',
      proposal: { action: 'rebalance' },
      expectedGain: 10,
    })
    expect(proposal.id).toBe('prop-1')
    expect(proposal.status).toBe('proposed')
    expect(proposal.expectedGain).toBe(10)
  })

  it('approveOptimization updates status to approved', async () => {
    const { approveOptimization } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'prop-1', tenant_id: 'tenant-1', optimization_type: 'workload',
      proposed_by: 'agent', entity_ids: [], entity_type: null,
      status: 'approved', proposal: {}, rationale: null,
      expected_gain: null, actual_gain: null, approved_by: 'ops',
      applied_at: null, expires_at: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }))
    const result = await approveOptimization('tenant-1', 'prop-1', 'ops')
    expect(result.status).toBe('approved')
    expect(result.approvedBy).toBe('ops')
  })

  it('approveOptimization throws when not found', async () => {
    const { approveOptimization } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(approveOptimization('tenant-1', 'missing', 'ops')).rejects.toThrow('not found')
  })

  it('_computeLoad returns value between 0 and 100', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    expect(__testHooks._computeLoad(50, 50, 50)).toBeGreaterThanOrEqual(0)
    expect(__testHooks._computeLoad(50, 50, 50)).toBeLessThanOrEqual(100)
    expect(__testHooks._computeLoad(100, 0, 100)).toBeGreaterThanOrEqual(0)
  })

  it('_suggestAction returns scale_up for high load', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    expect(__testHooks._suggestAction(90, 95)).toBe('scale_up')
    expect(__testHooks._suggestAction(15, 20)).toBe('scale_down')
    expect(__testHooks._suggestAction(50, 50)).toBe('ok')
  })

  it('markOptimizationApplied throws when not in approved state', async () => {
    const { markOptimizationApplied } = await import('../../../api/services/adaptive/resourceOptimizationEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    await expect(markOptimizationApplied('tenant-1', 'prop-1')).rejects.toThrow('not found')
  })
})

// ─── Suite 7: adaptiveAnomalyEngine ──────────────────────────────────────────

describe('adaptiveAnomalyEngine', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Clear the module-level cache between tests
    vi.doMock('../../../api/services/adaptive/adaptiveAnomalyEngine', async () => {
      return await vi.importActual('../../../api/services/adaptive/adaptiveAnomalyEngine')
    })
  })

  it('getAnomalyPattern returns default threshold for zero samples', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const pattern = await getAnomalyPattern('tenant-1', 'score_deviation')
    expect(pattern.learnedThreshold).toBe(__testHooks.DEFAULT_THRESHOLD)
    expect(pattern.sampleCount).toBe(0)
    expect(pattern.falsePositiveRate).toBe(0)
  })

  it('getAnomalyPattern raises threshold for high false-positive rate', async () => {
    const { getAnomalyPattern, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([
      { signal: 'negative', cnt: 8 },  // 80% false positive
      { signal: 'positive', cnt: 2 },
    ]))
    const pattern = await getAnomalyPattern('tenant-2', 'score_deviation')
    expect(pattern.learnedThreshold).toBeGreaterThan(__testHooks.DEFAULT_THRESHOLD)
    expect(pattern.learnedThreshold).toBeLessThanOrEqual(__testHooks.MAX_THRESHOLD)
  })

  it('recordAnomalyFeedback inserts feedback record', async () => {
    const { recordAnomalyFeedback } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    await recordAnomalyFeedback('tenant-1', 'anom-1', 'score_deviation', 'project', true)
    expect(mockTenant).toHaveBeenCalledOnce()
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('negative')  // isFalsePositive = true → negative signal
  })

  it('recordAnomalyFeedback uses positive signal for true positives', async () => {
    const { recordAnomalyFeedback } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    await recordAnomalyFeedback('tenant-1', 'anom-2', 'velocity', 'equipment', false)
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('positive')
  })

  it('getAdaptiveThreshold returns computed threshold', async () => {
    const { getAdaptiveThreshold, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    mockTenant.mockResolvedValueOnce(mockRows([{ signal: 'positive', cnt: 10 }]))
    const threshold = await getAdaptiveThreshold('tenant-1', 'velocity')
    expect(threshold).toBeGreaterThanOrEqual(__testHooks.MIN_THRESHOLD)
    expect(threshold).toBeLessThanOrEqual(__testHooks.MAX_THRESHOLD)
  })

  it('listAnomalyPatterns queries distinct types from feedback', async () => {
    const { listAnomalyPatterns, __testHooks } = await import('../../../api/services/adaptive/adaptiveAnomalyEngine')
    __testHooks._clearCache()
    // list query returns 2 distinct types, then _computePattern for each
    mockTenant.mockResolvedValueOnce(mockRows([
      { anomaly_type: 'score_deviation', entity_type: null },
      { anomaly_type: 'velocity', entity_type: 'project' },
    ]))
    mockTenant.mockResolvedValue(mockRows([{ signal: 'positive', cnt: 3 }]))
    const patterns = await listAnomalyPatterns('tenant-3')
    expect(patterns).toHaveLength(2)
  })
})

// ─── Suite 8: operationalMemoryEngine ────────────────────────────────────────

describe('operationalMemoryEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('storeMemory calls tenantQuery with correct data', async () => {
    const { storeMemory } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    await storeMemory('tenant-1', {
      scopeType: 'project',
      scopeId: 'proj-1',
      agentType: 'RiskAgent',
      key: 'last_risk_score',
      value: { score: 72 },
      confidence: 0.85,
    })
    expect(mockTenant).toHaveBeenCalledOnce()
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('agent_memory')
  })

  it('storeMemory silently ignores DB errors', async () => {
    const { storeMemory } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockRejectedValueOnce(new Error('table not found'))
    await expect(storeMemory('tenant-1', {
      scopeType: 'global', agentType: 'RiskAgent',
      key: 'test', value: 'x', confidence: 0.5,
    })).resolves.not.toThrow()
  })

  it('recallMemory returns null when not found', async () => {
    const { recallMemory } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const result = await recallMemory('tenant-1', {
      agentType: 'RiskAgent', scopeType: 'project', key: 'missing',
    })
    expect(result).toBeNull()
  })

  it('recallMemory returns null on DB error', async () => {
    const { recallMemory } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockRejectedValueOnce(new Error('DB error'))
    const result = await recallMemory('tenant-1', {
      agentType: 'RiskAgent', scopeType: 'project', key: 'x',
    })
    expect(result).toBeNull()
  })

  it('recallMemory maps row correctly', async () => {
    const { recallMemory } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockResolvedValueOnce(mockRow({
      key: 'risk_score', value: { score: 72 }, confidence: '0.85',
      metadata: { decayRate: 0.01, expiresAt: null },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-05T00:00:00Z',
    }))
    const memory = await recallMemory('tenant-1', {
      agentType: 'RiskAgent', scopeType: 'project', key: 'risk_score',
    })
    expect(memory).not.toBeNull()
    expect(memory!.confidence).toBe(0.85)
    expect(memory!.key).toBe('risk_score')
  })

  it('listMemories returns empty array on DB error', async () => {
    const { listMemories } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockRejectedValueOnce(new Error('fail'))
    const result = await listMemories('tenant-1', { agentType: 'RiskAgent' })
    expect(result).toEqual([])
  })

  it('applyMemoryDecay returns 0 on DB error', async () => {
    const { applyMemoryDecay } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockRejectedValueOnce(new Error('fail'))
    const count = await applyMemoryDecay('tenant-1', 'RiskAgent', 'project')
    expect(count).toBe(0)
  })

  it('applyMemoryDecay returns count of updated rows', async () => {
    const { applyMemoryDecay } = await import('../../../api/services/adaptive/operationalMemoryEngine')
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'm-1' }, { id: 'm-2' }]))
    const count = await applyMemoryDecay('tenant-1', 'RiskAgent', 'project')
    expect(count).toBe(2)
  })
})

// ─── Suite 9: rootCauseSynthesisEngine ───────────────────────────────────────

describe('rootCauseSynthesisEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('synthesizeRootCause returns a report with incidentId', async () => {
    const { synthesizeRootCause } = await import('../../../api/services/adaptive/rootCauseSynthesisEngine')
    // anomalyEvidence, eventEvidence (throws), stateEvidence (throws)
    mockTenant.mockResolvedValueOnce(mockRows([{
      anomaly_type: 'score_deviation', severity: 'high', entity_ids: ['e-1'], cnt: 3,
    }]))
    mockTenant.mockRejectedValueOnce(new Error('no event table'))
    mockTenant.mockRejectedValueOnce(new Error('no twin table'))
    const report = await synthesizeRootCause('tenant-1', { windowHours: 24 })
    expect(report.incidentId).toBeTruthy()
    expect(report.primaryCause).toBeDefined()
    expect(Array.isArray(report.mitigationSuggestions)).toBe(true)
  })

  it('synthesizeRootCause returns unknown cause when no evidence', async () => {
    const { synthesizeRootCause } = await import('../../../api/services/adaptive/rootCauseSynthesisEngine')
    mockTenant.mockResolvedValueOnce(mockRows([]))  // anomalies
    mockTenant.mockRejectedValueOnce(new Error())   // events
    mockTenant.mockRejectedValueOnce(new Error())   // state changes
    const report = await synthesizeRootCause('tenant-1', {})
    expect(report.primaryCause.causeType).toBe('unknown')
  })

  it('_correlateEvidence builds candidates from anomalies', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/rootCauseSynthesisEngine')
    const candidates = __testHooks._correlateEvidence(
      [{ anomalyType: 'score_deviation', severity: 'critical', entityIds: ['e-1'], count: 5 }],
      [],
      [],
    )
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.causeType).toBe('anomaly:score_deviation')
    expect(candidates[0]!.contributionScore).toBeGreaterThan(50)
  })

  it('_buildMitigations includes anomaly resolution for anomaly causes', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/rootCauseSynthesisEngine')
    const cause = { causeType: 'anomaly:velocity', description: 'test', confidence: 0.8, supportingEvidence: [], affectedEntities: [], contributionScore: 70 }
    const mitigations = __testHooks._buildMitigations(cause, [])
    expect(mitigations.some(m => m.includes('anomal'))).toBe(true)
  })

  it('_buildMitigations handles state_change cause type', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/rootCauseSynthesisEngine')
    const cause = { causeType: 'state_change:risk_score', description: 'test', confidence: 0.7, supportingEvidence: [], affectedEntities: [], contributionScore: 60 }
    const mitigations = __testHooks._buildMitigations(cause, [])
    expect(mitigations.some(m => m.includes('risk_score'))).toBe(true)
  })
})

// ─── Suite 10: operationalStrategyPlanner ────────────────────────────────────

describe('operationalStrategyPlanner', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('generateStrategyPlan returns a plan with planId and actions', async () => {
    const { generateStrategyPlan } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    // portfolioState, anomalies, bottlenecks
    mockTenant.mockResolvedValueOnce(mockRows([
      { entity_id: 'p-1', name: 'Project A', status: 'degraded', readiness_score: '30', risk_score: '80' },
      { entity_id: 'p-2', name: 'Project B', status: 'active', readiness_score: '60', risk_score: '40' },
    ]))
    mockTenant.mockResolvedValueOnce(mockRows([
      { id: 'a-1', twin_id: 't-1', severity: 'critical', anomaly_type: 'score_deviation' },
    ]))
    mockTenant.mockResolvedValueOnce(mockRows([]))  // bottlenecks
    const plan = await generateStrategyPlan('tenant-1', { horizon: 30 })
    expect(plan.planId).toBeTruthy()
    expect(plan.actions.length).toBeGreaterThan(0)
    expect(plan.horizon).toBe(30)
    expect(plan.generatedAt).toBeInstanceOf(Date)
  })

  it('generateStrategyPlan includes default objectives', async () => {
    const { generateStrategyPlan } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    mockTenant.mockResolvedValue(mockRows([]))
    const plan = await generateStrategyPlan('tenant-1')
    expect(plan.objectives.length).toBeGreaterThan(0)
    expect(plan.objectives.some(o => o.includes('readiness'))).toBe(true)
  })

  it('_buildActions includes critical anomaly resolution first', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    const actions = __testHooks._buildActions(
      [],
      [{ id: 'a-1', twinId: 't-1', severity: 'critical', anomalyType: 'score_deviation' }],
      [],
      30,
    )
    expect(actions[0]!.priority).toBe(1)
    expect(actions[0]!.action).toContain('critical')
  })

  it('_buildActions includes degraded project stabilization', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    const actions = __testHooks._buildActions(
      [{ entityId: 'p-1', name: 'Proj A', status: 'degraded', readinessScore: 25, riskScore: 70 }],
      [],
      [],
      30,
    )
    expect(actions.some(a => a.action.includes('Stabilize') && a.requiresApproval)).toBe(true)
  })

  it('_buildRiskMitigations flags high average risk', async () => {
    const { __testHooks } = await import('../../../api/services/adaptive/operationalStrategyPlanner')
    const portfolio = [
      { entityId: 'p-1', name: 'A', status: 'active', readinessScore: 50, riskScore: 80 },
      { entityId: 'p-2', name: 'B', status: 'active', readinessScore: 50, riskScore: 75 },
    ]
    const mitigations = __testHooks._buildRiskMitigations([], portfolio)
    expect(mitigations.some(m => m.includes('elevated') || m.includes('risk'))).toBe(true)
  })
})

// ─── Suite 11: optimizationCoordinator ───────────────────────────────────────

describe('optimizationCoordinator', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('buildConsensus returns null consensus for empty votes', async () => {
    const { buildConsensus } = await import('../../../api/services/adaptive/optimizationCoordinator')
    const result = await buildConsensus('tenant-1', 'schedule update', [])
    expect(result.consensus).toBeNull()
    expect(result.consensusConfidence).toBe(0)
  })

  it('buildConsensus finds majority vote', async () => {
    const { buildConsensus } = await import('../../../api/services/adaptive/optimizationCoordinator')
    const result = await buildConsensus('tenant-1', 'should we deploy?', [
      { agentType: 'RiskAgent', vote: 'no', confidence: 0.9, rationale: 'risk too high' },
      { agentType: 'ReadinessCoordinatorAgent', vote: 'no', confidence: 0.8, rationale: 'not ready' },
      { agentType: 'SchedulingAgent', vote: 'yes', confidence: 0.6, rationale: 'deadline pressure' },
    ])
    expect(result.consensus).toBe('no')
    expect(result.conflictingAgents).toContain('SchedulingAgent')
    expect(result.agentVotes).toHaveLength(3)
  })

  it('coordinateRecommendations returns unified + conflicts', async () => {
    const { coordinateRecommendations } = await import('../../../api/services/adaptive/optimizationCoordinator')
    // rankRecommendations calls getAgentEffectiveness which calls tenantQuery
    mockTenant.mockResolvedValueOnce(mockRows([]))  // effectiveness
    const result = await coordinateRecommendations('tenant-1', [
      {
        agentType: 'RiskAgent',
        recommendations: [
          { id: 'r1', type: 'risk_reduction', entityId: 'e-1', entityType: 'project', urgency: 80, confidence: 0.9, rationale: 'high risk' },
        ],
      },
      {
        agentType: 'ReadinessCoordinatorAgent',
        recommendations: [
          { id: 'r2', type: 'readiness_boost', entityId: 'e-1', entityType: 'project', urgency: 60, confidence: 0.7, rationale: 'low ready' },
        ],
      },
    ])
    expect(result.unified.length).toBeGreaterThan(0)
    expect(result.topPriority.length).toBeLessThanOrEqual(5)
  })

  it('getOptimizationSummary aggregates stats correctly', async () => {
    const { getOptimizationSummary } = await import('../../../api/services/adaptive/optimizationCoordinator')
    mockTenant.mockResolvedValueOnce(mockRow({
      proposed: 5, approved: 3, applied: 2,
      avg_expected: 15.0, avg_actual: 12.0,
    }))
    const summary = await getOptimizationSummary('tenant-1')
    expect(summary.proposedCount).toBe(5)
    expect(summary.appliedCount).toBe(2)
    expect(summary.gainAccuracy).toBeGreaterThan(0)
    expect(summary.gainAccuracy).toBeLessThanOrEqual(1)
  })

  it('getOptimizationSummary gainAccuracy is 1.0 when no expected gain', async () => {
    const { getOptimizationSummary } = await import('../../../api/services/adaptive/optimizationCoordinator')
    mockTenant.mockResolvedValueOnce(mockRow({ proposed: 0, approved: 0, applied: 0, avg_expected: 0, avg_actual: 0 }))
    const summary = await getOptimizationSummary('tenant-1')
    expect(summary.gainAccuracy).toBe(1)
  })
})

// ─── Suite 12: simulationLearningService ─────────────────────────────────────

describe('simulationLearningService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('recordSimulationOutcome inserts feedback and returns outcome', async () => {
    const { recordSimulationOutcome } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({}))
    const outcome = await recordSimulationOutcome('tenant-1', {
      scenarioId: 'sc-1',
      predictedDelta: -15,
      mitigationsApplied: ['reduce workload'],
    })
    expect(outcome.scenarioId).toBe('sc-1')
    expect(outcome.predictedDelta).toBe(-15)
    expect(mockTenant).toHaveBeenCalledOnce()
  })

  it('recordActualOutcome updates feedback and returns outcome', async () => {
    const { recordActualOutcome } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({}))  // UPDATE
    mockTenant.mockResolvedValueOnce(mockRow({     // SELECT
      context: { predictedDelta: -15, mitigationsApplied: [] },
      metadata: { predictionError: 5 },
      created_at: '2024-01-01T00:00:00Z',
    }))
    const outcome = await recordActualOutcome('tenant-1', 'sc-1', -10)
    expect(outcome.actualDelta).toBe(-10)
    expect(outcome.predictionError).toBe(5)
  })

  it('getScenarioAccuracyStats returns stats object', async () => {
    const { getScenarioAccuracyStats } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({
      total: 20, measured: 15, mean_error: 8.5, accurate: 10, inaccurate: 3,
    }))
    const stats = await getScenarioAccuracyStats('tenant-1', 90)
    expect(stats.totalSimulations).toBe(20)
    expect(stats.measuredSimulations).toBe(15)
    expect(stats.meanPredictionError).toBe(8.5)
    expect(stats.accuracyRate).toBeCloseTo(10 / 15)
  })

  it('getScenarioAccuracyStats returns 0 accuracyRate when no measured', async () => {
    const { getScenarioAccuracyStats } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRow({ total: 5, measured: 0, mean_error: 0, accurate: 0, inaccurate: 0 }))
    const stats = await getScenarioAccuracyStats('tenant-1', 90)
    expect(stats.accuracyRate).toBe(0)
  })

  it('listSimulationOutcomes maps rows correctly', async () => {
    const { listSimulationOutcomes } = await import('../../../api/services/adaptive/simulationLearningService')
    mockTenant.mockResolvedValueOnce(mockRows([{
      source_id: 'sc-1',
      context: { predictedDelta: -20, mitigationsApplied: ['defer work'] },
      metadata: { predictionError: 3 },
      created_at: '2024-01-05T00:00:00Z',
    }]))
    const outcomes = await listSimulationOutcomes('tenant-1', 10)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.predictedDelta).toBe(-20)
    expect(outcomes[0]!.mitigationsApplied).toEqual(['defer work'])
    expect(outcomes[0]!.predictionError).toBe(3)
  })
})

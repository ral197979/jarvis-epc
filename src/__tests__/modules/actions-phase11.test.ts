// Denver Engineering — Phase 11 Tests Part A (v11.0.0)
// Tests: productionTelemetryEngine, operationalMetricsAggregator, telemetryTrendAnalyzer,
//        scaleValidationEngine, loadSimulationRunner, performanceRegressionAnalyzer,
//        operationalTuningService, adaptivePerformanceTuner

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
  recordTelemetryEvent, getTelemetryEvents, getLatestTelemetryEvent,
  getTenantMetricSummary, purgeOldTelemetryEvents, getGlobalMetricStats,
  __testHooks as telemetryHooks,
} from '../../../api/services/phase11/productionTelemetryEngine'

import {
  createTelemetryAggregate, getTelemetryAggregate, listTelemetryAggregates,
  runAggregationJob, getLatestAggregate,
  __testHooks as aggregatorHooks,
} from '../../../api/services/phase11/operationalMetricsAggregator'

import {
  analyzeTrend, storeTrendAnalysis, getLatestTrends,
  detectDegradingMetrics, runFullTrendAnalysis,
  __testHooks as trendHooks,
} from '../../../api/services/phase11/telemetryTrendAnalyzer'

import {
  createScaleValidationRun, completeScaleValidationRun, getScaleValidationRun,
  listScaleValidationRuns, createPerformanceBaseline, getPerformanceBaseline,
  __testHooks as scaleHooks,
} from '../../../api/services/phase11/scaleValidationEngine'

import {
  recordLoadSimulationResult, getSimulationResults, listSimulationResultsByType,
  __testHooks as simHooks,
} from '../../../api/services/phase11/loadSimulationRunner'

import {
  recordPerformanceRegression, resolveRegression, getActiveRegressions,
  getAllRegressions,
  __testHooks as regressionHooks,
} from '../../../api/services/phase11/performanceRegressionAnalyzer'

import {
  createTuningConfig, applyTuningConfig, getTuningConfig,
  listPendingTuningConfigs, getTuneEventHistory,
  __testHooks as tuningHooks,
} from '../../../api/services/phase11/operationalTuningService'

import {
  __testHooks as adaptiveHooks,
} from '../../../api/services/phase11/adaptivePerformanceTuner'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mPool = vi.mocked(mockPool as unknown as { query: ReturnType<typeof vi.fn> })
const mTQ = vi.mocked(tenantQuery as ReturnType<typeof vi.fn>)

function mockRow(data: Record<string, unknown>) {
  mPool.query.mockResolvedValueOnce({ rows: [data], rowCount: 1 })
}
function mockRows(data: Record<string, unknown>[]) {
  mPool.query.mockResolvedValueOnce({ rows: data, rowCount: data.length })
}
function mockEmpty() {
  mPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
}
function mockTQRows(data: Record<string, unknown>[]) {
  mTQ.mockResolvedValueOnce(data)
}

const now = new Date()
const nowStr = now.toISOString()

function telRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1', tenant_id: 'ten1', metric_type: 'feature_adoption',
    value: 75, dimensions: {}, environment: 'production',
    recorded_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function aggRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1', metric_type: 'feature_adoption', environment: 'production',
    period_start: nowStr, period_end: nowStr,
    p50: 70, p95: 90, p99: 98, avg: 75, min: 50, max: 100, sample_count: 1000,
    created_at: nowStr, ...overrides,
  }
}

function scaleRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sr1', test_type: 'tenant_count', target_load: 1000, actual_load: 950,
    status: 'passed', p50_ms: 50, p95_ms: 150, p99_ms: 300,
    error_rate: 0.001, throughput: 900, environment: 'production',
    started_at: nowStr, completed_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function baselineRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1', test_type: 'tenant_count', baseline_load: 1000,
    baseline_p50_ms: 50, baseline_p95_ms: 150, baseline_p99_ms: 300,
    baseline_error_rate: 0.001, baseline_throughput: 900,
    established_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function tuningConfigRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tc1', parameter: 'queue_concurrency', current_value: 10,
    recommended_value: 20, rationale: 'Queue saturation detected',
    applied_at: null, environment: 'production', created_at: nowStr, ...overrides,
  }
}

function tuneEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'te1', parameter: 'queue_concurrency', old_value: 10, new_value: 20,
    triggered_by: 'adaptive_tuner', delta_p95_ms: -50,
    environment: 'production', tuned_at: nowStr, created_at: nowStr, ...overrides,
  }
}

// ─── productionTelemetryEngine ────────────────────────────────────────────────

describe('productionTelemetryEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('recordTelemetryEvent inserts and returns mapped event', async () => {
    mockRow(telRow())
    const event = await recordTelemetryEvent('ten1', 'feature_adoption', 75, {}, 'production')
    expect(event.tenantId).toBe('ten1')
    expect(event.metricType).toBe('feature_adoption')
    expect(event.value).toBe(75)
    expect(event.environment).toBe('production')
    expect(mPool.query).toHaveBeenCalledTimes(1)
  })

  it('getTelemetryEvents uses tenantQuery and returns mapped events', async () => {
    mockTQRows([telRow(), telRow({ id: 't2', value: 80 })])
    const events = await getTelemetryEvents('ten1', 'feature_adoption', new Date())
    expect(events).toHaveLength(2)
    expect(events[0].metricType).toBe('feature_adoption')
    expect(mTQ).toHaveBeenCalledWith('ten1', expect.any(String), expect.any(Array))
  })

  it('getLatestTelemetryEvent returns null when no events', async () => {
    mockTQRows([])
    const event = await getLatestTelemetryEvent('ten1', 'workflow_completion')
    expect(event).toBeNull()
  })

  it('getLatestTelemetryEvent returns event when found', async () => {
    mockTQRows([telRow({ metric_type: 'workflow_completion', value: 90 })])
    const event = await getLatestTelemetryEvent('ten1', 'workflow_completion')
    expect(event?.metricType).toBe('workflow_completion')
    expect(event?.value).toBe(90)
  })

  it('computeMetricAverage returns 0 for empty events', () => {
    expect(telemetryHooks.computeMetricAverage([])).toBe(0)
  })

  it('computeMetricAverage calculates correct average', () => {
    const events = [
      { value: 60 }, { value: 80 }, { value: 100 },
    ] as any[]
    expect(telemetryHooks.computeMetricAverage(events)).toBe(80)
  })

  it('computeMetricPercentile returns 0 for empty events', () => {
    expect(telemetryHooks.computeMetricPercentile([], 95)).toBe(0)
  })

  it('computeMetricPercentile computes p50 correctly', () => {
    const events = [
      { value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }, { value: 50 },
    ] as any[]
    const p50 = telemetryHooks.computeMetricPercentile(events, 50)
    expect(p50).toBe(30)
  })

  it('getTenantMetricSummary uses tenantQuery with correct params', async () => {
    mockTQRows([{ avg: 75, min: 50, max: 100, count: 500 }])
    const summary = await getTenantMetricSummary('ten1', 'ai_acceptance', new Date())
    expect(summary.avg).toBe(75)
    expect(summary.min).toBe(50)
    expect(summary.max).toBe(100)
    expect(summary.count).toBe(500)
  })

  it('purgeOldTelemetryEvents calls pool.query with retention days', async () => {
    mPool.query.mockResolvedValueOnce({ rowCount: 42 })
    const count = await purgeOldTelemetryEvents(90)
    expect(count).toBe(42)
    expect(mPool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE'), [90])
  })

  it('getGlobalMetricStats uses pool.query and returns stats', async () => {
    mockRow({ avg: 70, p95: 88, p99: 97, sample_count: 5000 })
    const stats = await getGlobalMetricStats('feature_adoption', 'production', new Date())
    expect(stats.avg).toBe(70)
    expect(stats.p95).toBe(88)
    expect(stats.sampleCount).toBe(5000)
  })
})

// ─── operationalMetricsAggregator ─────────────────────────────────────────────

describe('operationalMetricsAggregator', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createTelemetryAggregate computes stats and inserts', async () => {
    // First call: stats from telemetry_events
    mockRow({ sample_count: 1000, avg: 75, min: 50, max: 100, p50: 72, p95: 90, p99: 98 })
    // Second call: INSERT
    mockRow(aggRow())
    const agg = await createTelemetryAggregate(
      'feature_adoption', 'production', new Date(), new Date()
    )
    expect(agg.metricType).toBe('feature_adoption')
    expect(agg.sampleCount).toBe(1000)
    expect(mPool.query).toHaveBeenCalledTimes(2)
  })

  it('getTelemetryAggregate returns null when not found', async () => {
    mockEmpty()
    const agg = await getTelemetryAggregate('feature_adoption', 'production', new Date())
    expect(agg).toBeNull()
  })

  it('getTelemetryAggregate returns aggregate when found', async () => {
    mockRow(aggRow())
    const agg = await getTelemetryAggregate('feature_adoption', 'production', new Date())
    expect(agg?.metricType).toBe('feature_adoption')
    expect(agg?.avg).toBe(75)
  })

  it('listTelemetryAggregates returns array', async () => {
    mockRows([aggRow(), aggRow({ id: 'a2' })])
    const aggs = await listTelemetryAggregates('feature_adoption', 'production', new Date())
    expect(aggs).toHaveLength(2)
  })

  it('getLatestAggregate returns null when empty', async () => {
    mockEmpty()
    const agg = await getLatestAggregate('feature_adoption', 'production')
    expect(agg).toBeNull()
  })

  it('computeAggregrateDelta computes percent change', () => {
    const current = { avg: 80, p95: 90 } as any
    const previous = { avg: 100, p95: 100 } as any
    const delta = aggregatorHooks.computeAggregrateDelta(current, previous)
    expect(delta.avgDeltaPct).toBeCloseTo(-20)
    expect(delta.p95DeltaPct).toBeCloseTo(-10)
  })

  it('computeAggregrateDelta returns 0 when previous avg is 0', () => {
    const current = { avg: 80, p95: 90 } as any
    const previous = { avg: 0, p95: 100 } as any
    const delta = aggregatorHooks.computeAggregrateDelta(current, previous)
    expect(delta.avgDeltaPct).toBe(0)
  })
})

// ─── telemetryTrendAnalyzer ───────────────────────────────────────────────────

describe('telemetryTrendAnalyzer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('analyzeTrend: improving when higher-is-better metric increases', () => {
    const current = { metricType: 'feature_adoption', avg: 80, sampleCount: 100 } as any
    const previous = { metricType: 'feature_adoption', avg: 70, sampleCount: 100 } as any
    const trend = trendHooks.analyzeTrend(current, previous)
    expect(trend.direction).toBe('improving')
    expect(trend.changePercent).toBeCloseTo(14.28, 0)
  })

  it('analyzeTrend: degrading when higher-is-better metric decreases', () => {
    const current = { metricType: 'feature_adoption', avg: 60, sampleCount: 100 } as any
    const previous = { metricType: 'feature_adoption', avg: 80, sampleCount: 100 } as any
    const trend = trendHooks.analyzeTrend(current, previous)
    expect(trend.direction).toBe('degrading')
  })

  it('analyzeTrend: improving when lower-is-better metric decreases', () => {
    const current = { metricType: 'replay_latency', avg: 100, sampleCount: 100 } as any
    const previous = { metricType: 'replay_latency', avg: 200, sampleCount: 100 } as any
    const trend = trendHooks.analyzeTrend(current, previous)
    expect(trend.direction).toBe('improving')
  })

  it('analyzeTrend: degrading when lower-is-better metric increases', () => {
    const current = { metricType: 'sync_lag', avg: 300, sampleCount: 100 } as any
    const previous = { metricType: 'sync_lag', avg: 100, sampleCount: 100 } as any
    const trend = trendHooks.analyzeTrend(current, previous)
    expect(trend.direction).toBe('degrading')
  })

  it('analyzeTrend: stable when change < 2%', () => {
    const current = { metricType: 'feature_adoption', avg: 80.5, sampleCount: 100 } as any
    const previous = { metricType: 'feature_adoption', avg: 80, sampleCount: 100 } as any
    const trend = trendHooks.analyzeTrend(current, previous)
    expect(trend.direction).toBe('stable')
  })

  it('computeTrendConfidence: 0 for no samples', () => {
    expect(trendHooks.computeTrendConfidence(0, 100)).toBe(0)
  })

  it('computeTrendConfidence: 1.0 for >= 1000 samples', () => {
    expect(trendHooks.computeTrendConfidence(1000, 2000)).toBe(1.0)
  })

  it('computeTrendConfidence: 0.9 for 100-999 samples', () => {
    expect(trendHooks.computeTrendConfidence(100, 200)).toBe(0.9)
  })

  it('computeTrendConfidence: 0.75 for 50-99 samples', () => {
    expect(trendHooks.computeTrendConfidence(50, 60)).toBe(0.75)
  })

  it('computeTrendConfidence: 0.5 for 10-49 samples', () => {
    expect(trendHooks.computeTrendConfidence(10, 20)).toBe(0.5)
  })

  it('computeTrendConfidence: 0.25 for < 10 samples', () => {
    expect(trendHooks.computeTrendConfidence(5, 8)).toBe(0.25)
  })

  it('detectDegradingMetrics filters by direction and confidence', () => {
    const trends = [
      { direction: 'degrading', confidence: 0.8 },
      { direction: 'degrading', confidence: 0.3 },
      { direction: 'improving', confidence: 0.9 },
    ] as any[]
    const degrading = trendHooks.detectDegradingMetrics(trends)
    expect(degrading).toHaveLength(1)
    expect(degrading[0].confidence).toBe(0.8)
  })

  it('storeTrendAnalysis calls pool.query with correct params', async () => {
    mPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const trend = {
      metricType: 'feature_adoption',
      direction: 'improving', changePercent: 10,
      currentAvg: 80, previousAvg: 70, confidence: 0.9, analyzedAt: new Date(),
    } as any
    await storeTrendAnalysis(trend, 'production')
    expect(mPool.query).toHaveBeenCalledTimes(1)
  })
})

// ─── scaleValidationEngine ────────────────────────────────────────────────────

describe('scaleValidationEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createScaleValidationRun inserts and maps correctly', async () => {
    mockRow(scaleRunRow({ status: 'pending', actual_load: 0 }))
    const run = await createScaleValidationRun('tenant_count', 1000, 'production')
    expect(run.testType).toBe('tenant_count')
    expect(run.targetLoad).toBe(1000)
    expect(run.status).toBe('pending')
  })

  it('completeScaleValidationRun updates and returns run', async () => {
    mockRow(scaleRunRow({ status: 'passed', actual_load: 950 }))
    const run = await completeScaleValidationRun('sr1', 950, 50, 150, 300, 0.001, 900, 'passed')
    expect(run.status).toBe('passed')
    expect(run.actualLoad).toBe(950)
  })

  it('getScaleValidationRun returns null when not found', async () => {
    mockEmpty()
    const run = await getScaleValidationRun('sr1')
    expect(run).toBeNull()
  })

  it('getScaleValidationRun returns run when found', async () => {
    mockRow(scaleRunRow())
    const run = await getScaleValidationRun('sr1')
    expect(run?.id).toBe('sr1')
    expect(run?.p95Ms).toBe(150)
  })

  it('listScaleValidationRuns returns array', async () => {
    mockRows([scaleRunRow(), scaleRunRow({ id: 'sr2' })])
    const runs = await listScaleValidationRuns('tenant_count', 'production')
    expect(runs).toHaveLength(2)
  })

  it('detectP95Regression: no regression when within threshold', () => {
    const run = { p95Ms: 160 } as any
    const baseline = { baselineP95Ms: 150 } as any
    // 6.7% < 15% threshold
    expect(scaleHooks.detectP95Regression(run, baseline)).toBe(false)
  })

  it('detectP95Regression: regression when exceeds threshold', () => {
    const run = { p95Ms: 200 } as any
    const baseline = { baselineP95Ms: 150 } as any
    // 33% > 15% threshold
    expect(scaleHooks.detectP95Regression(run, baseline)).toBe(true)
  })

  it('detectP95Regression: false when baseline is 0', () => {
    const run = { p95Ms: 200 } as any
    const baseline = { baselineP95Ms: 0 } as any
    expect(scaleHooks.detectP95Regression(run, baseline)).toBe(false)
  })

  it('detectThroughputRegression: regression when throughput drops 20%', () => {
    const run = { throughput: 700 } as any
    const baseline = { baselineThroughput: 900 } as any
    // 22% > 15% threshold
    expect(scaleHooks.detectThroughputRegression(run, baseline)).toBe(true)
  })

  it('computeRegressionPercent: correct calculation', () => {
    expect(scaleHooks.computeRegressionPercent(200, 150)).toBeCloseTo(33.33, 1)
  })

  it('computeRegressionPercent: 0 when baseline is 0', () => {
    expect(scaleHooks.computeRegressionPercent(200, 0)).toBe(0)
  })

  it('determineScaleTestStatus: failed when error rate > 5%', () => {
    const run = { errorRate: 0.06, p95Ms: 100, throughput: 900 } as any
    expect(scaleHooks.determineScaleTestStatus(run, null)).toBe('failed')
  })

  it('determineScaleTestStatus: passed when no baseline', () => {
    const run = { errorRate: 0.001, p95Ms: 100, throughput: 900 } as any
    expect(scaleHooks.determineScaleTestStatus(run, null)).toBe('passed')
  })

  it('determineScaleTestStatus: degraded when p95 regresses', () => {
    const run = { errorRate: 0.001, p95Ms: 250, throughput: 900 } as any
    const baseline = { baselineP95Ms: 150, baselineThroughput: 900, baselineErrorRate: 0.001 } as any
    expect(scaleHooks.determineScaleTestStatus(run, baseline)).toBe('degraded')
  })

  it('createPerformanceBaseline inserts and returns baseline', async () => {
    mockRow(baselineRow())
    const run = { actualLoad: 1000, p50Ms: 50, p95Ms: 150, p99Ms: 300, errorRate: 0.001, throughput: 900 } as any
    const baseline = await createPerformanceBaseline('tenant_count', run)
    expect(baseline.testType).toBe('tenant_count')
    expect(baseline.baselineP95Ms).toBe(150)
  })

  it('getPerformanceBaseline returns null when not found', async () => {
    mockEmpty()
    const baseline = await getPerformanceBaseline('tenant_count')
    expect(baseline).toBeNull()
  })
})

// ─── loadSimulationRunner ─────────────────────────────────────────────────────

describe('loadSimulationRunner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('recordLoadSimulationResult inserts and returns result', async () => {
    mockRow({
      id: 'ls1', run_id: 'sr1', test_type: 'tenant_count',
      actual_rps: 950, p50_ms: 50, p95_ms: 150, p99_ms: 300,
      error_rate: 0.001, total_requests: 100000, successful_requests: 99900,
      simulated_at: nowStr, created_at: nowStr,
    })
    const result = await recordLoadSimulationResult('sr1', {
      testType: 'tenant_count', actualRps: 950, p50Ms: 50, p95Ms: 150,
      p99Ms: 300, errorRate: 0.001, totalRequests: 100000, successfulRequests: 99900,
    })
    expect(result.runId).toBe('sr1')
    expect(result.actualRps).toBe(950)
  })

  it('getSimulationResults returns null when not found', async () => {
    mockEmpty()
    const result = await getSimulationResults('sr1')
    expect(result).toBeNull()
  })

  it('computeThroughput: correct calculation', () => {
    expect(simHooks.computeThroughput(9000, 100)).toBe(90)
  })

  it('computeThroughput: 0 when duration is 0', () => {
    expect(simHooks.computeThroughput(9000, 0)).toBe(0)
  })

  it('isLoadTargetMet: true when rps >= 95% and error rate <= 1%', () => {
    const result = { actualRps: 950, errorRate: 0.005 } as any
    const profile = { targetRps: 1000, durationSeconds: 300 } as any
    expect(simHooks.isLoadTargetMet(result, profile)).toBe(true)
  })

  it('isLoadTargetMet: false when rps < 95%', () => {
    const result = { actualRps: 800, errorRate: 0.005 } as any
    const profile = { targetRps: 1000, durationSeconds: 300 } as any
    expect(simHooks.isLoadTargetMet(result, profile)).toBe(false)
  })

  it('isLoadTargetMet: false when error rate > 1%', () => {
    const result = { actualRps: 980, errorRate: 0.02 } as any
    const profile = { targetRps: 1000, durationSeconds: 300 } as any
    expect(simHooks.isLoadTargetMet(result, profile)).toBe(false)
  })

  it('determineRunStatusFromSimulation: failed when error > 5%', () => {
    const result = { errorRate: 0.06, actualRps: 900 } as any
    const run = { targetLoad: 1000 } as any
    expect(simHooks.determineRunStatusFromSimulation(result, run)).toBe('failed')
  })

  it('determineRunStatusFromSimulation: degraded when < 90% of target', () => {
    const result = { errorRate: 0.001, actualRps: 800 } as any
    const run = { targetLoad: 1000 } as any
    expect(simHooks.determineRunStatusFromSimulation(result, run)).toBe('degraded')
  })

  it('determineRunStatusFromSimulation: passed when meeting target', () => {
    const result = { errorRate: 0.001, actualRps: 950 } as any
    const run = { targetLoad: 1000 } as any
    expect(simHooks.determineRunStatusFromSimulation(result, run)).toBe('passed')
  })

  it('getDefaultLoadProfile returns correct profile for queue_saturation', () => {
    const profile = simHooks.getDefaultLoadProfile('queue_saturation')
    expect(profile.targetRps).toBe(5000)
    expect(profile.concurrency).toBe(1000)
  })
})

// ─── performanceRegressionAnalyzer ───────────────────────────────────────────

describe('performanceRegressionAnalyzer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifyRegressionSeverity: minor for < 25%', () => {
    expect(regressionHooks.classifyRegressionSeverity(20)).toBe('minor')
  })

  it('classifyRegressionSeverity: moderate for 25-49%', () => {
    expect(regressionHooks.classifyRegressionSeverity(30)).toBe('moderate')
  })

  it('classifyRegressionSeverity: critical for >= 50%', () => {
    expect(regressionHooks.classifyRegressionSeverity(50)).toBe('critical')
    expect(regressionHooks.classifyRegressionSeverity(75)).toBe('critical')
  })

  it('analyzeRunAgainstBaseline: detects p95 regression', () => {
    const run = { p50Ms: 50, p95Ms: 200, p99Ms: 300, errorRate: 0.001, throughput: 900 } as any
    const baseline = {
      baselineP50Ms: 50, baselineP95Ms: 150, baselineP99Ms: 300,
      baselineErrorRate: 0.001, baselineThroughput: 900,
    } as any
    const regressions = regressionHooks.analyzeRunAgainstBaseline(run, baseline)
    expect(regressions.length).toBeGreaterThan(0)
    expect(regressions.some(r => r.metric === 'p95')).toBe(true)
  })

  it('analyzeRunAgainstBaseline: no regressions within threshold', () => {
    const run = { p50Ms: 51, p95Ms: 155, p99Ms: 305, errorRate: 0.001, throughput: 890 } as any
    const baseline = {
      baselineP50Ms: 50, baselineP95Ms: 150, baselineP99Ms: 300,
      baselineErrorRate: 0.001, baselineThroughput: 900,
    } as any
    const regressions = regressionHooks.analyzeRunAgainstBaseline(run, baseline)
    expect(regressions).toHaveLength(0)
  })

  it('hasCriticalRegression: true when critical unresolved exists', () => {
    const regressions = [
      { severity: 'critical', resolvedAt: null },
      { severity: 'minor', resolvedAt: null },
    ] as any[]
    expect(regressionHooks.hasCriticalRegression(regressions)).toBe(true)
  })

  it('hasCriticalRegression: false when critical is resolved', () => {
    const regressions = [{ severity: 'critical', resolvedAt: new Date() }] as any[]
    expect(regressionHooks.hasCriticalRegression(regressions)).toBe(false)
  })

  it('hasCriticalRegression: false when no critical', () => {
    const regressions = [{ severity: 'minor', resolvedAt: null }] as any[]
    expect(regressionHooks.hasCriticalRegression(regressions)).toBe(false)
  })

  it('recordPerformanceRegression inserts and returns regression', async () => {
    mockRow({
      id: 'pr1', test_type: 'tenant_count', baseline_id: 'b1',
      regression_percent: 30, affected_metric: 'p95', severity: 'moderate',
      detected_at: nowStr, resolved_at: null, created_at: nowStr,
    })
    const reg = await recordPerformanceRegression('tenant_count', 'b1', 'p95', 30)
    expect(reg.affectedMetric).toBe('p95')
    expect(reg.severity).toBe('moderate')
  })

  it('resolveRegression throws when not found', async () => {
    mockEmpty()
    await expect(resolveRegression('pr1')).rejects.toThrow()
  })

  it('getActiveRegressions returns array', async () => {
    mockRows([])
    const regressions = await getActiveRegressions('tenant_count')
    expect(regressions).toHaveLength(0)
  })
})

// ─── operationalTuningService ─────────────────────────────────────────────────

describe('operationalTuningService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createTuningConfig inserts and maps correctly', async () => {
    mockRow(tuningConfigRow())
    const config = await createTuningConfig(
      'queue_concurrency', 10, 20, 'Queue saturation detected', 'production'
    )
    expect(config.parameter).toBe('queue_concurrency')
    expect(config.currentValue).toBe(10)
    expect(config.recommendedValue).toBe(20)
    expect(config.appliedAt).toBeNull()
  })

  it('getTuningConfig returns null when not found', async () => {
    mockEmpty()
    const config = await getTuningConfig('tc1')
    expect(config).toBeNull()
  })

  it('applyTuningConfig creates tune event and updates config', async () => {
    // SELECT config
    mockRow(tuningConfigRow())
    // INSERT tune event
    mockRow(tuneEventRow())
    // UPDATE config
    mockRow(tuningConfigRow({ applied_at: nowStr, current_value: 20 }))

    const result = await applyTuningConfig('tc1', 'adaptive_tuner', -50)
    expect(result.config.currentValue).toBe(20)
    expect(result.config.appliedAt).not.toBeNull()
    expect(result.tuneEvent.deltaP95Ms).toBe(-50)
    expect(mPool.query).toHaveBeenCalledTimes(3)
  })

  it('applyTuningConfig throws when config not found', async () => {
    mockEmpty()
    await expect(applyTuningConfig('tc1', 'manual')).rejects.toThrow()
  })

  it('listPendingTuningConfigs uses environment filter', async () => {
    mockRows([tuningConfigRow()])
    const configs = await listPendingTuningConfigs('production')
    expect(configs).toHaveLength(1)
    expect(mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('applied_at IS NULL'), ['production']
    )
  })

  it('getTuneEventHistory returns events for parameter', async () => {
    mockRows([tuneEventRow(), tuneEventRow({ id: 'te2' })])
    const events = await getTuneEventHistory('queue_concurrency', 'production')
    expect(events).toHaveLength(2)
    expect(events[0].parameter).toBe('queue_concurrency')
  })

  it('computeTuningImpact: 0 when no events with delta', () => {
    const events = [{ deltaP95Ms: null }] as any[]
    expect(tuningHooks.computeTuningImpact(events)).toBe(0)
  })

  it('computeTuningImpact: averages delta values', () => {
    const events = [{ deltaP95Ms: -50 }, { deltaP95Ms: -30 }] as any[]
    expect(tuningHooks.computeTuningImpact(events)).toBe(-40)
  })

  it('isTuningApplied: false when appliedAt is null', () => {
    expect(tuningHooks.isTuningApplied({ appliedAt: null } as any)).toBe(false)
  })

  it('isTuningApplied: true when appliedAt is set', () => {
    expect(tuningHooks.isTuningApplied({ appliedAt: new Date() } as any)).toBe(true)
  })
})

// ─── adaptivePerformanceTuner ─────────────────────────────────────────────────

describe('adaptivePerformanceTuner', () => {
  it('recommendQueueConcurrency: null when below threshold', () => {
    const rec = adaptiveHooks.recommendQueueConcurrency(10, 0.7)
    expect(rec).toBeNull()
  })

  it('recommendQueueConcurrency: recommendation when >= 0.8', () => {
    const rec = adaptiveHooks.recommendQueueConcurrency(10, 0.85)
    expect(rec).not.toBeNull()
    expect(rec?.parameter).toBe('queue_concurrency')
    expect(rec?.recommendedValue).toBeGreaterThan(10)
  })

  it('recommendQueueConcurrency: high confidence at 95%', () => {
    const rec = adaptiveHooks.recommendQueueConcurrency(10, 0.95)
    expect(rec?.confidence).toBe(0.9)
  })

  it('recommendReplayCacheTtl: null when below threshold', () => {
    const rec = adaptiveHooks.recommendReplayCacheTtl(300, 1000)
    expect(rec).toBeNull()
  })

  it('recommendReplayCacheTtl: recommendation when >= 2000ms', () => {
    const rec = adaptiveHooks.recommendReplayCacheTtl(300, 2500)
    expect(rec).not.toBeNull()
    expect(rec?.parameter).toBe('replay_cache_ttl')
    expect(rec?.recommendedValue).toBe(600)
  })

  it('recommendSyncBatchInterval: null when below threshold', () => {
    const rec = adaptiveHooks.recommendSyncBatchInterval(1000, 300)
    expect(rec).toBeNull()
  })

  it('recommendSyncBatchInterval: recommendation when >= 500ms lag', () => {
    const rec = adaptiveHooks.recommendSyncBatchInterval(1000, 600)
    expect(rec).not.toBeNull()
    expect(rec?.parameter).toBe('sync_batch_interval')
    expect(rec?.recommendedValue).toBeLessThan(1000)
  })

  it('recommendAnomalyThreshold: null when below 10% anomaly rate', () => {
    const rec = adaptiveHooks.recommendAnomalyThreshold(0.5, 0.05)
    expect(rec).toBeNull()
  })

  it('recommendAnomalyThreshold: recommendation when >= 10%', () => {
    const rec = adaptiveHooks.recommendAnomalyThreshold(0.5, 0.15)
    expect(rec).not.toBeNull()
    expect(rec?.recommendedValue).toBeLessThan(0.5)
  })

  it('filterHighConfidenceRecommendations: filters below min confidence', () => {
    const recs = [
      { confidence: 0.9 }, { confidence: 0.5 }, { confidence: 0.7 },
    ] as any[]
    const filtered = adaptiveHooks.filterHighConfidenceRecommendations(recs, 0.7)
    expect(filtered).toHaveLength(2)
  })

  it('CONSTANTS: correct threshold values', () => {
    expect(adaptiveHooks.QUEUE_SATURATION_THRESHOLD).toBe(0.8)
    expect(adaptiveHooks.REPLAY_LATENCY_HIGH_MS).toBe(2000)
    expect(adaptiveHooks.SYNC_LAG_HIGH_MS).toBe(500)
    expect(adaptiveHooks.ANOMALY_HIGH_RATE).toBe(0.1)
  })
})

// Denver Engineering — Adaptive Performance Tuner (Phase 11)
// Automatically recommend tuning parameter adjustments based on telemetry signals

import { pool } from '../../db/pool'
import {
  TuningParameter,
  TelemetryMetricType,
} from './phase11Types'

// ─── Tuning Recommendation ───────────────────────────────────────────────────

export interface TuningRecommendation {
  parameter: TuningParameter
  currentValue: number
  recommendedValue: number
  rationale: string
  confidence: number
  triggerMetric: TelemetryMetricType | null
}

// ─── Signal Thresholds ────────────────────────────────────────────────────────

const QUEUE_SATURATION_THRESHOLD = 0.8   // 80% queue fill → increase concurrency
const REPLAY_LATENCY_HIGH_MS = 2000      // >2s replay → increase cache TTL
const SYNC_LAG_HIGH_MS = 500             // >500ms sync lag → reduce batch interval
const ANOMALY_HIGH_RATE = 0.1            // >10% anomaly rate → lower threshold

// ─── Analyze Queue Telemetry ──────────────────────────────────────────────────

export function recommendQueueConcurrency(
  currentValue: number,
  queueFillRate: number
): TuningRecommendation | null {
  if (queueFillRate < QUEUE_SATURATION_THRESHOLD) return null

  const recommendedValue = Math.min(currentValue * 1.5, 200)
  return {
    parameter: 'queue_concurrency',
    currentValue,
    recommendedValue: Math.round(recommendedValue),
    rationale: `Queue fill rate ${(queueFillRate * 100).toFixed(1)}% exceeds ${QUEUE_SATURATION_THRESHOLD * 100}% threshold`,
    confidence: queueFillRate >= 0.95 ? 0.9 : 0.7,
    triggerMetric: 'anomaly_frequency',
  }
}

// ─── Analyze Replay Latency ───────────────────────────────────────────────────

export function recommendReplayCacheTtl(
  currentValue: number,
  avgReplayLatencyMs: number
): TuningRecommendation | null {
  if (avgReplayLatencyMs < REPLAY_LATENCY_HIGH_MS) return null

  const recommendedValue = currentValue * 2
  return {
    parameter: 'replay_cache_ttl',
    currentValue,
    recommendedValue,
    rationale: `Average replay latency ${avgReplayLatencyMs}ms exceeds ${REPLAY_LATENCY_HIGH_MS}ms threshold`,
    confidence: 0.75,
    triggerMetric: 'replay_latency',
  }
}

// ─── Analyze Sync Lag ─────────────────────────────────────────────────────────

export function recommendSyncBatchInterval(
  currentValue: number,
  avgSyncLagMs: number
): TuningRecommendation | null {
  if (avgSyncLagMs < SYNC_LAG_HIGH_MS) return null

  const recommendedValue = Math.max(currentValue * 0.75, 100)
  return {
    parameter: 'sync_batch_interval',
    currentValue,
    recommendedValue: Math.round(recommendedValue),
    rationale: `Average sync lag ${avgSyncLagMs}ms exceeds ${SYNC_LAG_HIGH_MS}ms threshold`,
    confidence: 0.8,
    triggerMetric: 'sync_lag',
  }
}

// ─── Analyze Anomaly Rate ─────────────────────────────────────────────────────

export function recommendAnomalyThreshold(
  currentValue: number,
  anomalyRate: number
): TuningRecommendation | null {
  if (anomalyRate < ANOMALY_HIGH_RATE) return null

  // Lower threshold to catch anomalies earlier
  const recommendedValue = currentValue * 0.8
  return {
    parameter: 'anomaly_threshold',
    currentValue,
    recommendedValue,
    rationale: `Anomaly rate ${(anomalyRate * 100).toFixed(1)}% exceeds ${ANOMALY_HIGH_RATE * 100}% threshold`,
    confidence: 0.65,
    triggerMetric: 'anomaly_frequency',
  }
}

// ─── Generate All Recommendations ────────────────────────────────────────────

export async function generateTuningRecommendations(
  environment: string
): Promise<TuningRecommendation[]> {
  // Pull current tuning values
  const configResult = await pool.query(
    `SELECT parameter, current_value FROM tuning_configs
     WHERE environment = $1 AND applied_at IS NOT NULL
     ORDER BY created_at DESC`,
    [environment]
  )

  const currentValues: Partial<Record<TuningParameter, number>> = {}
  for (const row of configResult.rows as Record<string, unknown>[]) {
    currentValues[row.parameter as TuningParameter] = Number(row.current_value)
  }

  // Pull recent telemetry averages
  const telemetryResult = await pool.query(
    `SELECT metric_type, AVG(value) as avg_value
     FROM telemetry_events
     WHERE environment = $1 AND recorded_at >= NOW() - INTERVAL '1 hour'
     GROUP BY metric_type`,
    [environment]
  )

  const telemetryAvgs: Partial<Record<TelemetryMetricType, number>> = {}
  for (const row of telemetryResult.rows as Record<string, unknown>[]) {
    telemetryAvgs[row.metric_type as TelemetryMetricType] = Number(row.avg_value)
  }

  const recommendations: TuningRecommendation[] = []

  const queueRec = recommendQueueConcurrency(
    currentValues.queue_concurrency ?? 10,
    telemetryAvgs.anomaly_frequency ?? 0
  )
  if (queueRec) recommendations.push(queueRec)

  const replayRec = recommendReplayCacheTtl(
    currentValues.replay_cache_ttl ?? 300,
    telemetryAvgs.replay_latency ?? 0
  )
  if (replayRec) recommendations.push(replayRec)

  const syncRec = recommendSyncBatchInterval(
    currentValues.sync_batch_interval ?? 1000,
    telemetryAvgs.sync_lag ?? 0
  )
  if (syncRec) recommendations.push(syncRec)

  return recommendations
}

// ─── Store Recommendations ────────────────────────────────────────────────────

export async function storeRecommendations(
  recommendations: TuningRecommendation[],
  environment: string
): Promise<void> {
  for (const rec of recommendations) {
    await pool.query(
      `INSERT INTO tuning_configs
         (parameter, current_value, recommended_value, rationale, applied_at, environment, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5, NOW())`,
      [rec.parameter, rec.currentValue, rec.recommendedValue, rec.rationale, environment]
    )
  }
}

// ─── Filter High-Confidence Recommendations ──────────────────────────────────

export function filterHighConfidenceRecommendations(
  recommendations: TuningRecommendation[],
  minConfidence: number = 0.7
): TuningRecommendation[] {
  return recommendations.filter(r => r.confidence >= minConfidence)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  recommendQueueConcurrency,
  recommendReplayCacheTtl,
  recommendSyncBatchInterval,
  recommendAnomalyThreshold,
  filterHighConfidenceRecommendations,
  QUEUE_SATURATION_THRESHOLD,
  REPLAY_LATENCY_HIGH_MS,
  SYNC_LAG_HIGH_MS,
  ANOMALY_HIGH_RATE,
}

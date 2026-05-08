// Denver Engineering — Adaptive Anomaly Engine (v7.0.0)
// Learns detection thresholds from false-positive and true-positive feedback.

import { tenantQuery } from '../../db/pool'
import { AnomalyPattern } from './adaptiveTypes'

// ─── Default thresholds ───────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 2.0      // σ multiplier
const MIN_THRESHOLD = 1.5
const MAX_THRESHOLD = 4.0
const LEARNING_RATE = 0.1

// ─── Get or create pattern ────────────────────────────────────────────────────

// Patterns are computed from feedback stored in learning_feedback table.
// We don't have a separate patterns table, so we compute on the fly and
// cache the result in-memory (per process, short TTL).

const _patternCache = new Map<string, { pattern: AnomalyPattern; cachedAt: number }>()
const PATTERN_TTL_MS = 5 * 60 * 1000  // 5 minutes

export async function getAnomalyPattern(
  tenantId: string,
  anomalyType: string,
  entityType?: string,
): Promise<AnomalyPattern> {
  const cacheKey = `${tenantId}:${anomalyType}:${entityType ?? ''}`
  const cached = _patternCache.get(cacheKey)
  if (cached != null && Date.now() - cached.cachedAt < PATTERN_TTL_MS) {
    return cached.pattern
  }

  const pattern = await _computePattern(tenantId, anomalyType, entityType)
  _patternCache.set(cacheKey, { pattern, cachedAt: Date.now() })
  return pattern
}

// ─── Compute pattern from feedback ───────────────────────────────────────────

async function _computePattern(
  tenantId: string,
  anomalyType: string,
  entityType?: string,
): Promise<AnomalyPattern> {
  const params: unknown[] = [tenantId, anomalyType]
  const clauses = [
    'tenant_id = $1',
    'feedback_type = \'anomaly\'',
    `context->>'anomalyType' = $2`,
  ]
  if (entityType != null) {
    params.push(entityType)
    clauses.push(`context->>'entityType' = $${params.length}`)
  }

  const res = await tenantQuery(
    tenantId,
    `SELECT
       signal,
       COUNT(*)::int AS cnt
     FROM learning_feedback
     WHERE ${clauses.join(' AND ')}
     GROUP BY signal`,
    params,
  )

  let totalTrue = 0
  let totalFalse = 0
  let total = 0

  for (const row of res.rows) {
    const cnt = Number(row.cnt)
    total += cnt
    if (row.signal === 'positive')  totalTrue += cnt
    if (row.signal === 'negative')  totalFalse += cnt
  }

  const fpRate = total > 0 ? totalFalse / total : 0
  const tpRate = total > 0 ? totalTrue / total : 0

  // Adjust threshold: more false positives → raise threshold
  const adjustment = fpRate * 0.5 - tpRate * 0.2
  const learnedThreshold = Math.max(
    MIN_THRESHOLD,
    Math.min(MAX_THRESHOLD, DEFAULT_THRESHOLD + adjustment),
  )

  return {
    patternId: `${tenantId}:${anomalyType}:${entityType ?? 'any'}`,
    tenantId,
    anomalyType,
    entityType,
    learnedThreshold,
    falsePositiveRate: fpRate,
    truePositiveRate: tpRate,
    sampleCount: total,
    lastAdjusted: new Date(),
  }
}

// ─── Record anomaly feedback ──────────────────────────────────────────────────

export async function recordAnomalyFeedback(
  tenantId: string,
  anomalyId: string,
  anomalyType: string,
  entityType: string | undefined,
  isFalsePositive: boolean,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `INSERT INTO learning_feedback
      (tenant_id, feedback_type, source_id, source_type, signal, outcome, context, recorded_by)
     VALUES ($1, 'anomaly', $2, 'operational_anomalies', $3, $4, $5, 'system')`,
    [
      tenantId,
      anomalyId,
      isFalsePositive ? 'negative' : 'positive',
      isFalsePositive ? 'rejected' : 'accepted',
      JSON.stringify({ anomalyType, entityType: entityType ?? null }),
    ],
  )

  // Invalidate cache
  const cacheKey = `${tenantId}:${anomalyType}:${entityType ?? ''}`
  _patternCache.delete(cacheKey)
}

// ─── Apply adaptive threshold ─────────────────────────────────────────────────

export async function getAdaptiveThreshold(
  tenantId: string,
  anomalyType: string,
  entityType?: string,
): Promise<number> {
  const pattern = await getAnomalyPattern(tenantId, anomalyType, entityType)
  return pattern.learnedThreshold
}

// ─── List all patterns ────────────────────────────────────────────────────────

export async function listAnomalyPatterns(
  tenantId: string,
): Promise<AnomalyPattern[]> {
  // Discover distinct anomaly types from feedback
  const res = await tenantQuery(
    tenantId,
    `SELECT DISTINCT
       context->>'anomalyType' AS anomaly_type,
       context->>'entityType' AS entity_type
     FROM learning_feedback
     WHERE tenant_id = $1
       AND feedback_type = 'anomaly'
       AND context->>'anomalyType' IS NOT NULL`,
    [tenantId],
  )

  return Promise.all(
    res.rows.map(row =>
      getAnomalyPattern(
        tenantId,
        row.anomaly_type as string,
        row.entity_type != null ? String(row.entity_type) : undefined,
      ),
    ),
  )
}

// ─── Internal exports for tests ───────────────────────────────────────────────

export const __testHooks = {
  _computePattern,
  DEFAULT_THRESHOLD,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  _clearCache: () => _patternCache.clear(),
}

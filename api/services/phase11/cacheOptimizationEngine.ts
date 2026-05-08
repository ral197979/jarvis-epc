// Denver Engineering — Cache Optimization Engine (Phase 11)
// Analyze cache hit rates and recommend cache size / TTL optimizations

import { pool } from '../../db/pool'
import { TuningParameter } from './phase11Types'

// ─── Cache Stats ─────────────────────────────────────────────────────────────

export interface CacheStats {
  cacheKey: string
  hitCount: number
  missCount: number
  hitRate: number
  avgLatencyMs: number
  recordedAt: Date
}

export interface CacheOptimizationRecommendation {
  parameter: TuningParameter
  currentValue: number
  recommendedValue: number
  expectedHitRateGain: number
  rationale: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapCacheStats(row: Record<string, unknown>): CacheStats {
  const hitCount = Number(row.hit_count)
  const missCount = Number(row.miss_count)
  const total = hitCount + missCount
  return {
    cacheKey: row.cache_key as string,
    hitCount,
    missCount,
    hitRate: total === 0 ? 0 : hitCount / total,
    avgLatencyMs: Number(row.avg_latency_ms),
    recordedAt: new Date(row.recorded_at as string),
  }
}

// ─── Record Cache Stats ───────────────────────────────────────────────────────

export async function recordCacheStats(
  cacheKey: string,
  hitCount: number,
  missCount: number,
  avgLatencyMs: number
): Promise<CacheStats> {
  const result = await pool.query(
    `INSERT INTO cache_stats
       (cache_key, hit_count, miss_count, avg_latency_ms, recorded_at, created_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [cacheKey, hitCount, missCount, avgLatencyMs]
  )
  return _mapCacheStats(result.rows[0])
}

// ─── Get Cache Stats ──────────────────────────────────────────────────────────

export async function getCacheStats(cacheKey: string, since: Date): Promise<CacheStats[]> {
  const result = await pool.query(
    `SELECT * FROM cache_stats
     WHERE cache_key = $1 AND recorded_at >= $2
     ORDER BY recorded_at DESC`,
    [cacheKey, since]
  )
  return result.rows.map(_mapCacheStats)
}

// ─── Compute Aggregate Hit Rate ───────────────────────────────────────────────

export function computeAggregateHitRate(stats: CacheStats[]): number {
  if (stats.length === 0) return 0
  const totalHits = stats.reduce((acc, s) => acc + s.hitCount, 0)
  const totalMisses = stats.reduce((acc, s) => acc + s.missCount, 0)
  const total = totalHits + totalMisses
  return total === 0 ? 0 : totalHits / total
}

// ─── Recommend Graph Cache Size ───────────────────────────────────────────────

export function recommendGraphCacheSize(
  currentSize: number,
  hitRate: number
): CacheOptimizationRecommendation | null {
  // If hit rate < 70%, recommend increasing cache size
  if (hitRate >= 0.7) return null

  const multiplier = hitRate < 0.4 ? 3 : 2
  const recommendedValue = currentSize * multiplier

  return {
    parameter: 'graph_cache_size',
    currentValue: currentSize,
    recommendedValue,
    expectedHitRateGain: (0.85 - hitRate) * 100,
    rationale: `Graph cache hit rate ${(hitRate * 100).toFixed(1)}% is below 70% threshold. Increasing size should improve hit rate to ~85%.`,
  }
}

// ─── Recommend Replay Cache TTL ───────────────────────────────────────────────

export function recommendReplayCacheTtlFromHitRate(
  currentTtl: number,
  hitRate: number
): CacheOptimizationRecommendation | null {
  if (hitRate >= 0.8) return null

  const recommendedValue = currentTtl * 1.5

  return {
    parameter: 'replay_cache_ttl',
    currentValue: currentTtl,
    recommendedValue: Math.round(recommendedValue),
    expectedHitRateGain: (0.9 - hitRate) * 100,
    rationale: `Replay cache hit rate ${(hitRate * 100).toFixed(1)}% is below 80% threshold. Increasing TTL should reduce replay reconstruction overhead.`,
  }
}

// ─── Get All Cache Keys ───────────────────────────────────────────────────────

export async function getAllActiveCacheKeys(): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT cache_key FROM cache_stats
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'`
  )
  return result.rows.map((r: Record<string, unknown>) => r.cache_key as string)
}

// ─── Run Cache Optimization Analysis ─────────────────────────────────────────

export async function runCacheOptimizationAnalysis(
  currentGraphCacheSize: number,
  currentReplayCacheTtl: number
): Promise<CacheOptimizationRecommendation[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recommendations: CacheOptimizationRecommendation[] = []

  const [graphStats, replayStats] = await Promise.all([
    getCacheStats('graph_cache', since),
    getCacheStats('replay_cache', since),
  ])

  const graphHitRate = computeAggregateHitRate(graphStats)
  const replayHitRate = computeAggregateHitRate(replayStats)

  const graphRec = recommendGraphCacheSize(currentGraphCacheSize, graphHitRate)
  if (graphRec) recommendations.push(graphRec)

  const replayRec = recommendReplayCacheTtlFromHitRate(currentReplayCacheTtl, replayHitRate)
  if (replayRec) recommendations.push(replayRec)

  return recommendations
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapCacheStats,
  computeAggregateHitRate,
  recommendGraphCacheSize,
  recommendReplayCacheTtlFromHitRate,
}

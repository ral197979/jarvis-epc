// Denver Engineering — Queue Rebalancer (Phase 12)
// Monitors queue depths and recommends/executes consumer rebalancing

import { pool } from '../../db/pool'
import { QueueBalance } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapQueueBalance(row: Record<string, unknown>): QueueBalance {
  return {
    id: row.id as string,
    queueName: row.queue_name as string,
    depth: Number(row.depth),
    consumerCount: Number(row.consumer_count),
    targetConsumerCount: Number(row.target_consumer_count),
    rebalanceNeeded: row.rebalance_needed as boolean,
    rebalancedAt: row.rebalanced_at ? new Date(row.rebalanced_at as string) : null,
    measuredAt: new Date(row.measured_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeTargetConsumerCount(depth: number, currentConsumers: number): number {
  if (depth <= 100) return Math.max(1, currentConsumers)
  if (depth <= 500) return Math.max(currentConsumers, 4)
  if (depth <= 2000) return Math.max(currentConsumers, 8)
  return Math.max(currentConsumers, 16)
}

export function isRebalanceNeeded(depth: number, consumerCount: number): boolean {
  const target = computeTargetConsumerCount(depth, consumerCount)
  return target > consumerCount
}

export function computeQueueHealthScore(depth: number, consumerCount: number): number {
  if (consumerCount === 0) return 0
  const ratio = depth / consumerCount
  if (ratio <= 10) return 100
  if (ratio <= 50) return 80
  if (ratio <= 200) return 60
  if (ratio <= 500) return 40
  return 20
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordQueueMeasurement(
  queueName: string,
  depth: number,
  consumerCount: number,
): Promise<QueueBalance> {
  const targetConsumerCount = computeTargetConsumerCount(depth, consumerCount)
  const rebalanceNeeded = isRebalanceNeeded(depth, consumerCount)

  const result = await pool.query(
    `INSERT INTO p12_queue_balance
       (queue_name, depth, consumer_count, target_consumer_count, rebalance_needed, measured_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING *`,
    [queueName, depth, consumerCount, targetConsumerCount, rebalanceNeeded],
  )
  return _mapQueueBalance(result.rows[0])
}

export async function markRebalanced(balanceId: string): Promise<QueueBalance> {
  const result = await pool.query(
    `UPDATE p12_queue_balance
     SET rebalanced_at = NOW(), rebalance_needed = FALSE
     WHERE id = $1
     RETURNING *`,
    [balanceId],
  )
  if (!result.rows[0]) throw new Error(`QueueBalance ${balanceId} not found`)
  return _mapQueueBalance(result.rows[0])
}

export async function getQueuesNeedingRebalance(): Promise<QueueBalance[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (queue_name) *
     FROM p12_queue_balance
     WHERE rebalance_needed = TRUE AND rebalanced_at IS NULL
     ORDER BY queue_name, measured_at DESC`,
  )
  return result.rows.map(_mapQueueBalance)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeTargetConsumerCount,
  isRebalanceNeeded,
  computeQueueHealthScore,
  _mapQueueBalance,
}

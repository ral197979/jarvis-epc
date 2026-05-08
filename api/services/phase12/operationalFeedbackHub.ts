// Denver Engineering — Operational Feedback Hub (Phase 12)
// Collects and routes operational feedback from all sources

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { FeedbackRecord, FeedbackSource, FeedbackSentiment } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapFeedbackRecord(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    source: row.source as FeedbackSource,
    category: row.category as string,
    sentiment: row.sentiment as FeedbackSentiment,
    detail: row.detail as string,
    actionable: row.actionable as boolean,
    processedAt: row.processed_at ? new Date(row.processed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function classifyFeedbackSentiment(text: string): FeedbackSentiment {
  const lower = text.toLowerCase()
  const positive = ['great', 'excellent', 'love', 'easy', 'helpful', 'smooth', 'fast', 'good']
  const negative = ['slow', 'broken', 'difficult', 'confusing', 'error', 'failed', 'terrible', 'hate']
  const posScore = positive.filter(w => lower.includes(w)).length
  const negScore = negative.filter(w => lower.includes(w)).length
  if (posScore > negScore) return 'positive'
  if (negScore > posScore) return 'negative'
  return 'neutral'
}

export function isActionableFeedback(sentiment: FeedbackSentiment, category: string): boolean {
  if (sentiment === 'negative') return true
  if (category === 'feature_request' || category === 'usability') return true
  return false
}

export function computeSentimentScore(records: FeedbackRecord[]): number {
  if (records.length === 0) return 0.5
  const positive = records.filter(r => r.sentiment === 'positive').length
  const negative = records.filter(r => r.sentiment === 'negative').length
  return (positive - negative * 0.5) / records.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function submitFeedback(
  source: FeedbackSource,
  category: string,
  detail: string,
  tenantId?: string,
): Promise<FeedbackRecord> {
  const sentiment = classifyFeedbackSentiment(detail)
  const actionable = isActionableFeedback(sentiment, category)
  const result = await pool.query(
    `INSERT INTO p12_feedback_records
       (tenant_id, source, category, sentiment, detail, actionable)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tenantId ?? null, source, category, sentiment, detail, actionable],
  )
  return _mapFeedbackRecord(result.rows[0])
}

export async function getFeedback(source?: FeedbackSource, actionableOnly = false): Promise<FeedbackRecord[]> {
  const result = await pool.query(
    `SELECT * FROM p12_feedback_records
     WHERE ($1::text IS NULL OR source = $1)
       AND (NOT $2 OR actionable = TRUE)
     ORDER BY created_at DESC
     LIMIT 200`,
    [source ?? null, actionableOnly],
  )
  return result.rows.map(_mapFeedbackRecord)
}

export async function getTenantFeedback(tenantId: string): Promise<FeedbackRecord[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_feedback_records
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  )
  return result.rows.map(_mapFeedbackRecord)
}

export async function markFeedbackProcessed(feedbackId: string): Promise<FeedbackRecord> {
  const result = await pool.query(
    `UPDATE p12_feedback_records
     SET processed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [feedbackId],
  )
  if (!result.rows[0]) throw new Error(`FeedbackRecord ${feedbackId} not found`)
  return _mapFeedbackRecord(result.rows[0])
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  classifyFeedbackSentiment,
  isActionableFeedback,
  computeSentimentScore,
  _mapFeedbackRecord,
}

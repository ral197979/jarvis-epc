// Denver Engineering — Plugin Trust Scorer (Phase 12)
// Computes and stores trust scores for marketplace plugins

import { pool } from '../../db/pool'
import { PluginTrustScore, PLUGIN_TRUST_SCORE_THRESHOLD } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapPluginTrustScore(row: Record<string, unknown>): PluginTrustScore {
  return {
    id: row.id as string,
    pluginId: row.plugin_id as string,
    score: Number(row.score),
    apiScopeRisk: Number(row.api_scope_risk),
    dataAccessRisk: Number(row.data_access_risk),
    sandboxPassRate: Number(row.sandbox_pass_rate),
    abuseFlags: Number(row.abuse_flags),
    authorReputation: Number(row.author_reputation),
    computedAt: new Date(row.computed_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computePluginTrustScore(
  apiScopeRisk: number,
  dataAccessRisk: number,
  sandboxPassRate: number,
  abuseFlags: number,
  authorReputation: number,
): number {
  const riskPenalty = (apiScopeRisk * 20) + (dataAccessRisk * 20)
  const abusePenalty = Math.min(abuseFlags * 15, 40)
  const positiveScore = (sandboxPassRate * 40) + (authorReputation * 20)
  return Math.max(0, Math.min(100, Math.round(positiveScore - riskPenalty - abusePenalty)))
}

export function isPluginTrusted(score: PluginTrustScore): boolean {
  return score.score >= PLUGIN_TRUST_SCORE_THRESHOLD && score.abuseFlags === 0
}

export function requiresManualReview(score: PluginTrustScore): boolean {
  return score.abuseFlags > 0 || score.score < PLUGIN_TRUST_SCORE_THRESHOLD
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function computeAndStorePluginTrust(
  pluginId: string,
  apiScopeRisk: number,
  dataAccessRisk: number,
  sandboxPassRate: number,
  abuseFlags: number,
  authorReputation: number,
): Promise<PluginTrustScore> {
  const score = computePluginTrustScore(apiScopeRisk, dataAccessRisk, sandboxPassRate, abuseFlags, authorReputation)
  const result = await pool.query(
    `INSERT INTO p12_plugin_trust_scores
       (plugin_id, score, api_scope_risk, data_access_risk, sandbox_pass_rate, abuse_flags, author_reputation, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     RETURNING *`,
    [pluginId, score, apiScopeRisk, dataAccessRisk, sandboxPassRate, abuseFlags, authorReputation],
  )
  return _mapPluginTrustScore(result.rows[0])
}

export async function getLatestPluginTrustScore(pluginId: string): Promise<PluginTrustScore | null> {
  const result = await pool.query(
    `SELECT * FROM p12_plugin_trust_scores
     WHERE plugin_id = $1
     ORDER BY computed_at DESC
     LIMIT 1`,
    [pluginId],
  )
  return result.rows[0] ? _mapPluginTrustScore(result.rows[0]) : null
}

export async function getLowTrustPlugins(threshold = PLUGIN_TRUST_SCORE_THRESHOLD): Promise<PluginTrustScore[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (plugin_id) *
     FROM p12_plugin_trust_scores
     WHERE score < $1
     ORDER BY plugin_id, computed_at DESC`,
    [threshold],
  )
  return result.rows.map(_mapPluginTrustScore)
}

export async function getPluginsTrustHistory(pluginId: string, limit = 10): Promise<PluginTrustScore[]> {
  const result = await pool.query(
    `SELECT * FROM p12_plugin_trust_scores
     WHERE plugin_id = $1
     ORDER BY computed_at DESC
     LIMIT $2`,
    [pluginId, limit],
  )
  return result.rows.map(_mapPluginTrustScore)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computePluginTrustScore,
  isPluginTrusted,
  requiresManualReview,
  _mapPluginTrustScore,
}

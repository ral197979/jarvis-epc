// Denver Engineering — Operational Maturity Scorer (Phase 12)
// Scores tenant operational maturity across 5 dimensions

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { OperationalMaturityScore, MaturityLevel } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapMaturityScore(row: Record<string, unknown>): OperationalMaturityScore {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    workflowMaturity: Number(row.workflow_maturity),
    governanceMaturity: Number(row.governance_maturity),
    integrationMaturity: Number(row.integration_maturity),
    aiMaturity: Number(row.ai_maturity),
    supportMaturity: Number(row.support_maturity),
    overallMaturity: Number(row.overall_maturity),
    level: row.level as MaturityLevel,
    scoredAt: new Date(row.scored_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeOverallMaturity(
  workflowMaturity: number,
  governanceMaturity: number,
  integrationMaturity: number,
  aiMaturity: number,
  supportMaturity: number,
): number {
  return Math.round(
    workflowMaturity * 0.25 +
    governanceMaturity * 0.25 +
    integrationMaturity * 0.20 +
    aiMaturity * 0.15 +
    supportMaturity * 0.15,
  )
}

export function classifyMaturityLevel(overall: number): MaturityLevel {
  if (overall >= 90) return 'optimized'
  if (overall >= 75) return 'advanced'
  if (overall >= 60) return 'proficient'
  if (overall >= 40) return 'developing'
  return 'starter'
}

export function isOperationallyMature(score: OperationalMaturityScore): boolean {
  return score.overallMaturity >= 65 && score.governanceMaturity >= 70
}

export function getWeakestDimension(score: OperationalMaturityScore): string {
  const dims = {
    workflow: score.workflowMaturity,
    governance: score.governanceMaturity,
    integration: score.integrationMaturity,
    ai: score.aiMaturity,
    support: score.supportMaturity,
  }
  return Object.entries(dims).reduce((a, b) => (a[1] < b[1] ? a : b))[0]
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function scoreOperationalMaturity(
  tenantId: string,
  workflowMaturity: number,
  governanceMaturity: number,
  integrationMaturity: number,
  aiMaturity: number,
  supportMaturity: number,
): Promise<OperationalMaturityScore> {
  const overallMaturity = computeOverallMaturity(workflowMaturity, governanceMaturity, integrationMaturity, aiMaturity, supportMaturity)
  const level = classifyMaturityLevel(overallMaturity)

  const result = await pool.query(
    `INSERT INTO p12_maturity_scores
       (tenant_id, workflow_maturity, governance_maturity, integration_maturity,
        ai_maturity, support_maturity, overall_maturity, level, scored_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING *`,
    [tenantId, workflowMaturity, governanceMaturity, integrationMaturity, aiMaturity, supportMaturity, overallMaturity, level],
  )
  return _mapMaturityScore(result.rows[0])
}

export async function getLatestMaturityScore(tenantId: string): Promise<OperationalMaturityScore | null> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM p12_maturity_scores
     WHERE tenant_id = $1
     ORDER BY scored_at DESC
     LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapMaturityScore(result.rows[0]) : null
}

export async function getMaturityDistribution(): Promise<Record<MaturityLevel, number>> {
  const result = await pool.query(
    `SELECT level, COUNT(*)::int AS cnt
     FROM (
       SELECT DISTINCT ON (tenant_id) level
       FROM p12_maturity_scores
       ORDER BY tenant_id, scored_at DESC
     ) latest
     GROUP BY level`,
  )
  const dist = {} as Record<MaturityLevel, number>
  for (const row of result.rows) {
    dist[row.level as MaturityLevel] = row.cnt
  }
  return dist
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOverallMaturity,
  classifyMaturityLevel,
  isOperationallyMature,
  getWeakestDimension,
  _mapMaturityScore,
}

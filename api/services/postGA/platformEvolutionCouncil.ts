// Denver Engineering — Platform Evolution Council (Post-GA)
// Governs controlled platform evolution with complexity and replay surface budgets

import { pool } from '../../db/pool'
import {
  EvolutionProposal,
  ComplexityTrendRecord,
  EvolutionProposalStatus,
  ComplexityTrend,
  COMPLEXITY_GROWTH_LIMIT_PCT,
} from './postGATypes'

// ─── Mappers ─────────────────────────────────────────────────────────────────

function _mapEvolutionProposal(row: Record<string, unknown>): EvolutionProposal {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    complexityImpact: Number(row.complexity_impact),
    replaySurfaceImpact: Number(row.replay_surface_impact),
    governanceRisk: row.governance_risk as EvolutionProposal['governanceRisk'],
    status: row.status as EvolutionProposalStatus,
    approvedBy: row.approved_by as string | null,
    proposedAt: new Date(row.proposed_at as string),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at as string) : null,
  }
}

function _mapComplexityTrend(row: Record<string, unknown>): ComplexityTrendRecord {
  return {
    id: row.id as string,
    environment: row.environment as string,
    currentScore: Number(row.current_score),
    previousScore: Number(row.previous_score),
    growthPct: Number(row.growth_pct),
    trend: row.trend as ComplexityTrend,
    isOverLimit: row.is_over_limit as boolean,
    measuredAt: new Date(row.measured_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeComplexityGrowthPct(previousScore: number, currentScore: number): number {
  if (previousScore === 0) return currentScore > 0 ? 1.0 : 0
  return (currentScore - previousScore) / previousScore
}

export function classifyComplexityTrend(growthPct: number): ComplexityTrend {
  if (growthPct < -0.01) return 'decreasing'
  if (growthPct <= 0.02) return 'stable'
  if (growthPct <= COMPLEXITY_GROWTH_LIMIT_PCT) return 'growing'
  return 'accelerating'
}

export function isComplexityOverLimit(growthPct: number): boolean {
  return growthPct > COMPLEXITY_GROWTH_LIMIT_PCT
}

export function requiresCouncilApproval(proposal: EvolutionProposal): boolean {
  return proposal.governanceRisk === 'medium' || proposal.governanceRisk === 'high'
    || proposal.complexityImpact > 50
    || proposal.replaySurfaceImpact > 10
}

export function isProposalBlocked(proposal: EvolutionProposal): boolean {
  return proposal.governanceRisk === 'high' && proposal.approvedBy === null
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function submitProposal(
  title: string,
  description: string,
  complexityImpact: number,
  replaySurfaceImpact: number,
  governanceRisk: EvolutionProposal['governanceRisk'],
): Promise<EvolutionProposal> {
  const result = await pool.query(
    `INSERT INTO pga_evolution_proposals
       (title, description, complexity_impact, replay_surface_impact, governance_risk, status, proposed_at)
     VALUES ($1,$2,$3,$4,$5,'draft',NOW())
     RETURNING *`,
    [title, description, complexityImpact, replaySurfaceImpact, governanceRisk],
  )
  return _mapEvolutionProposal(result.rows[0])
}

export async function approveProposal(proposalId: string, approvedBy: string): Promise<EvolutionProposal> {
  const result = await pool.query(
    `UPDATE pga_evolution_proposals
     SET status='approved', approved_by=$2, reviewed_at=NOW()
     WHERE id=$1 AND status IN ('draft','under_review')
     RETURNING *`,
    [proposalId, approvedBy],
  )
  if (!result.rows[0]) throw new Error(`EvolutionProposal ${proposalId} not found or not reviewable`)
  return _mapEvolutionProposal(result.rows[0])
}

export async function recordComplexityTrend(
  environment: string,
  previousScore: number,
  currentScore: number,
): Promise<ComplexityTrendRecord> {
  const growthPct = computeComplexityGrowthPct(previousScore, currentScore)
  const trend = classifyComplexityTrend(growthPct)
  const isOverLimit = isComplexityOverLimit(growthPct)

  const result = await pool.query(
    `INSERT INTO pga_complexity_trends
       (environment, current_score, previous_score, growth_pct, trend, is_over_limit, measured_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [environment, currentScore, previousScore, growthPct, trend, isOverLimit],
  )
  return _mapComplexityTrend(result.rows[0])
}

export async function getBlockedProposals(): Promise<EvolutionProposal[]> {
  const result = await pool.query(
    `SELECT * FROM pga_evolution_proposals WHERE governance_risk='high' AND approved_by IS NULL ORDER BY proposed_at DESC`,
  )
  return result.rows.map(_mapEvolutionProposal)
}

export async function getComplexityTrends(environment: string, limit = 12): Promise<ComplexityTrendRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_complexity_trends WHERE environment=$1 ORDER BY measured_at DESC LIMIT $2`,
    [environment, limit],
  )
  return result.rows.map(_mapComplexityTrend)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeComplexityGrowthPct,
  classifyComplexityTrend,
  isComplexityOverLimit,
  requiresCouncilApproval,
  isProposalBlocked,
  _mapEvolutionProposal,
  _mapComplexityTrend,
}

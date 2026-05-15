// Denver Engineering — Resource Optimization Engine (v7.0.0)
// Analyzes workload distribution and proposes rebalancing actions.

import { tenantQuery } from '../../db/pool'
import {
  ResourceAllocation, WorkloadBalancePlan, OptimizationProposal,
  ProposeOptimizationInput, OptimizationType,
} from './adaptiveTypes'

// ─── Analyze resource utilization ─────────────────────────────────────────────

export async function analyzeResourceUtilization(
  tenantId: string,
): Promise<ResourceAllocation[]> {
  // Derive load from twin risk + inverse readiness for project-type twins
  const res = await tenantQuery(
    tenantId,
    `SELECT
       entity_id,
       entity_type,
       name,
       readiness_score,
       risk_score,
       health_score,
       status
     FROM operational_twins
     WHERE tenant_id = $1
       AND entity_type IN ('project', 'workforce', 'equipment', 'system')
       AND status NOT IN ('inactive', 'decommissioned')
     ORDER BY risk_score DESC`,
    [tenantId],
  )

  return res.rows.map(row => {
    const readiness = Number(row.readiness_score ?? 50)
    const risk = Number(row.risk_score ?? 50)
    const health = Number(row.health_score ?? 50)
    const currentLoad = _computeLoad(readiness, risk, health)
    const predictedPeak = Math.min(100, currentLoad * 1.15)

    return {
      entityId: row.entity_id as string,
      entityType: row.entity_type as string,
      currentLoad,
      predictedPeak,
      suggestedAction: _suggestAction(currentLoad, predictedPeak),
      actionRationale: _buildRationale(currentLoad, predictedPeak, readiness, risk),
      confidenceScore: health / 100,
    } satisfies ResourceAllocation
  })
}

// ─── Build workload balance plan ──────────────────────────────────────────────

export async function buildWorkloadBalancePlan(
  tenantId: string,
): Promise<WorkloadBalancePlan> {
  const allocations = await analyzeResourceUtilization(tenantId)

  const overloaded = allocations.filter(a => a.currentLoad >= 75)
  const underutilized = allocations.filter(a => a.currentLoad <= 30)

  const transfers: WorkloadBalancePlan['transferRecommendations'] = []

  for (const over of overloaded) {
    const target = underutilized[0]
    if (target == null) break
    const workloadPct = Math.round((over.currentLoad - 60) / 2)
    transfers.push({
      fromEntityId: over.entityId,
      toEntityId: target.entityId,
      workloadPct,
      rationale: `Move ~${workloadPct}% load from overloaded ${over.entityType} to underutilized ${target.entityType}`,
    })
  }

  const estimatedGain = transfers.length > 0
    ? Math.min(25, transfers.length * 5)
    : 0

  return {
    tenantId,
    generatedAt: new Date(),
    overloadedEntities: overloaded,
    underutilizedEntities: underutilized,
    transferRecommendations: transfers,
    estimatedGain,
  }
}

// ─── Propose optimization ─────────────────────────────────────────────────────

export async function proposeOptimization(
  tenantId: string,
  input: ProposeOptimizationInput,
): Promise<OptimizationProposal> {
  const {
    optimizationType, proposedBy, entityIds = [], entityType,
    proposal, rationale, expectedGain, expiresAt,
  } = input

  const defaultExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO optimization_feedback
      (tenant_id, optimization_type, proposed_by, entity_ids, entity_type,
       proposal, rationale, expected_gain, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      tenantId, optimizationType, proposedBy,
      entityIds, entityType ?? null,
      JSON.stringify(proposal), rationale ?? null,
      expectedGain ?? null,
      expiresAt ?? defaultExpiry,
    ],
  )
  return _mapProposal(res.rows[0])
}

// ─── Approve optimization ─────────────────────────────────────────────────────

export async function approveOptimization(
  tenantId: string,
  proposalId: string,
  approvedBy: string,
): Promise<OptimizationProposal> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE optimization_feedback
     SET status = 'approved', approved_by = $2, updated_at = now()
     WHERE tenant_id = $1 AND id = $3 AND status = 'proposed'
     RETURNING *`,
    [tenantId, approvedBy, proposalId],
  )
  if (res.rows.length === 0) throw new Error(`Proposal ${proposalId} not found or not in proposed state`)
  return _mapProposal(res.rows[0])
}

// ─── Mark applied ─────────────────────────────────────────────────────────────

export async function markOptimizationApplied(
  tenantId: string,
  proposalId: string,
  actualGain?: number,
): Promise<OptimizationProposal> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE optimization_feedback
     SET status = 'applied',
         applied_at = now(),
         actual_gain = COALESCE($2, actual_gain),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $3 AND status = 'approved'
     RETURNING *`,
    [tenantId, actualGain ?? null, proposalId],
  )
  if (res.rows.length === 0) throw new Error(`Proposal ${proposalId} not found or not in approved state`)
  return _mapProposal(res.rows[0])
}

// ─── List proposals ───────────────────────────────────────────────────────────

export async function listOptimizationProposals(
  tenantId: string,
  opts: { status?: string; optimizationType?: string; limit?: number } = {},
): Promise<OptimizationProposal[]> {
  const { status, optimizationType, limit = 50 } = opts
  const params: unknown[] = [tenantId]
  const clauses = ['tenant_id = $1', "(expires_at IS NULL OR expires_at > now())"]

  if (status != null)           { params.push(status);           clauses.push(`status = $${params.length}`) }
  if (optimizationType != null) { params.push(optimizationType); clauses.push(`optimization_type = $${params.length}`) }

  params.push(limit)
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM optimization_feedback
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapProposal)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _computeLoad(readiness: number, risk: number, health: number): number {
  // High risk + low readiness = high load; low health = additional strain
  const riskLoad = risk * 0.5
  const readinessStrain = (100 - readiness) * 0.3
  const healthStrain = (100 - health) * 0.2
  return Math.round(Math.min(100, riskLoad + readinessStrain + healthStrain))
}

function _suggestAction(
  load: number,
  predictedPeak: number,
): ResourceAllocation['suggestedAction'] {
  if (load >= 85 || predictedPeak >= 90) return 'scale_up'
  if (load <= 20)                        return 'scale_down'
  if (load >= 70 && predictedPeak >= 80) return 'rebalance'
  if (predictedPeak >= 80)              return 'defer'
  return 'ok'
}

function _buildRationale(
  load: number, peak: number, readiness: number, risk: number,
): string {
  if (load >= 85) return `Critical load at ${load}% — scale up immediately (risk: ${risk})`
  if (load >= 70) return `High load at ${load}% with peak ${peak}% — consider rebalancing (readiness: ${readiness})`
  if (load <= 20) return `Under-utilized at ${load}% — capacity available for absorption`
  return `Load at ${load}% — within normal operating range`
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapProposal(row: Record<string, unknown>): OptimizationProposal {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    optimizationType: row.optimization_type as OptimizationType,
    proposedBy: row.proposed_by as string,
    entityIds: (row.entity_ids as string[]) ?? [],
    entityType: row.entity_type != null ? String(row.entity_type) : undefined,
    status: row.status as OptimizationProposal['status'],
    proposal: (row.proposal ?? {}) as Record<string, unknown>,
    rationale: row.rationale != null ? String(row.rationale) : undefined,
    expectedGain: row.expected_gain != null ? Number(row.expected_gain) : undefined,
    actualGain: row.actual_gain != null ? Number(row.actual_gain) : undefined,
    approvedBy: row.approved_by != null ? String(row.approved_by) : undefined,
    appliedAt: row.applied_at != null ? new Date(row.applied_at as string) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = {
  _computeLoad,
  _suggestAction,
  _buildRationale,
  _mapProposal,
}

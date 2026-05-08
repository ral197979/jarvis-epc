// Denver Engineering — Support Operations Coordinator (Post-GA)
// Coordinates replay-assisted diagnostics, incident clustering, and support analytics

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  SupportOperationsRecord,
  IncidentCluster,
  IncidentClusterType,
  SUPPORT_RESOLUTION_TARGET_MS,
} from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapSupportRecord(row: Record<string, unknown>): SupportOperationsRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    incidentId: row.incident_id as string | null,
    clusterType: row.cluster_type as IncidentClusterType | null,
    replayAssisted: row.replay_assisted as boolean,
    resolutionTimeMs: row.resolution_time_ms != null ? Number(row.resolution_time_ms) : null,
    rootCauseIdentified: row.root_cause_identified as boolean,
    escalationTier: row.escalation_tier as SupportOperationsRecord['escalationTier'],
    satisfactionScore: row.satisfaction_score != null ? Number(row.satisfaction_score) : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isSLABreached(resolutionTimeMs: number | null): boolean {
  if (resolutionTimeMs === null) return false
  return resolutionTimeMs > SUPPORT_RESOLUTION_TARGET_MS
}

export function computeReplayAssistedRate(records: SupportOperationsRecord[]): number {
  const resolved = records.filter(r => r.resolvedAt !== null)
  if (resolved.length === 0) return 0
  return resolved.filter(r => r.replayAssisted).length / resolved.length
}

export function computeRootCauseRate(records: SupportOperationsRecord[]): number {
  const resolved = records.filter(r => r.resolvedAt !== null)
  if (resolved.length === 0) return 0
  return resolved.filter(r => r.rootCauseIdentified).length / resolved.length
}

export function computeAverageSatisfaction(records: SupportOperationsRecord[]): number {
  const scored = records.filter(r => r.satisfactionScore !== null)
  if (scored.length === 0) return 0
  return scored.reduce((sum, r) => sum + (r.satisfactionScore ?? 0), 0) / scored.length
}

export function buildIncidentClusters(records: SupportOperationsRecord[]): IncidentCluster[] {
  const clusterMap = new Map<IncidentClusterType, SupportOperationsRecord[]>()
  for (const r of records) {
    if (!r.clusterType) continue
    const list = clusterMap.get(r.clusterType) ?? []
    list.push(r)
    clusterMap.set(r.clusterType, list)
  }
  return Array.from(clusterMap.entries()).map(([clusterType, recs]) => {
    const resolved = recs.filter(r => r.resolutionTimeMs !== null)
    const avgMs = resolved.length > 0
      ? resolved.reduce((sum, r) => sum + (r.resolutionTimeMs ?? 0), 0) / resolved.length
      : 0
    return {
      clusterType,
      count: recs.length,
      avgResolutionMs: avgMs,
      rootCauseRate: computeRootCauseRate(recs),
      replayAssistedRate: computeReplayAssistedRate(recs),
    }
  })
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createSupportOperation(
  tenantId: string,
  incidentId: string | null,
  clusterType: IncidentClusterType | null,
  escalationTier: SupportOperationsRecord['escalationTier'],
): Promise<SupportOperationsRecord> {
  const result = await pool.query(
    `INSERT INTO pga_support_operations
       (tenant_id, incident_id, cluster_type, replay_assisted, root_cause_identified, escalation_tier)
     VALUES ($1,$2,$3,FALSE,FALSE,$4)
     RETURNING *`,
    [tenantId, incidentId, clusterType, escalationTier],
  )
  return _mapSupportRecord(result.rows[0])
}

export async function resolveSupportOperation(
  recordId: string,
  resolutionTimeMs: number,
  replayAssisted: boolean,
  rootCauseIdentified: boolean,
  satisfactionScore: number | null,
): Promise<SupportOperationsRecord> {
  const result = await pool.query(
    `UPDATE pga_support_operations
     SET resolution_time_ms=$2, replay_assisted=$3, root_cause_identified=$4, satisfaction_score=$5, resolved_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [recordId, resolutionTimeMs, replayAssisted, rootCauseIdentified, satisfactionScore],
  )
  if (!result.rows[0]) throw new Error(`SupportOperation ${recordId} not found`)
  return _mapSupportRecord(result.rows[0])
}

export async function getTenantSupportHistory(tenantId: string, limit = 20): Promise<SupportOperationsRecord[]> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM pga_support_operations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit],
  )
  return result.rows.map(_mapSupportRecord)
}

export async function getOpenOperations(): Promise<SupportOperationsRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_support_operations WHERE resolved_at IS NULL ORDER BY created_at ASC`,
  )
  return result.rows.map(_mapSupportRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isSLABreached,
  computeReplayAssistedRate,
  computeRootCauseRate,
  computeAverageSatisfaction,
  buildIncidentClusters,
  _mapSupportRecord,
}

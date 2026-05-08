// Denver Engineering — Twin Registry (v6.0.0)
// Central registry of all operational digital twins.

import { tenantQuery } from '../../db/pool'
import {
  OperationalTwin, RegisterTwinInput,
  TwinEntityType, TwinStatus,
} from './twinTypes'

// ─── Register / upsert twin ───────────────────────────────────────────────────

export async function registerTwin(input: RegisterTwinInput): Promise<OperationalTwin> {
  const {
    tenantId, entityType, entityId, name, description,
    metadata = {}, readinessScore, riskScore, healthScore,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO operational_twins
       (tenant_id, entity_type, entity_id, name, description,
        metadata, readiness_score, risk_score, health_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, entity_type, entity_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       metadata = EXCLUDED.metadata,
       readiness_score = EXCLUDED.readiness_score,
       risk_score = EXCLUDED.risk_score,
       health_score = EXCLUDED.health_score,
       updated_at = now()
     RETURNING *`,
    [
      tenantId, entityType, entityId, name, description ?? null,
      JSON.stringify(metadata),
      readinessScore ?? null, riskScore ?? null, healthScore ?? null,
    ]
  )
  return _mapTwin(res.rows[0])
}

// ─── Update twin scores ───────────────────────────────────────────────────────

export async function updateTwinScores(
  twinId: string,
  tenantId: string,
  scores: { readinessScore?: number; riskScore?: number; healthScore?: number }
): Promise<OperationalTwin> {
  const sets: string[] = ['updated_at = now()']
  const params: unknown[] = [twinId, tenantId]
  let idx = 3

  if (scores.readinessScore !== undefined) {
    sets.push(`readiness_score = $${idx++}`)
    params.push(scores.readinessScore)
  }
  if (scores.riskScore !== undefined) {
    sets.push(`risk_score = $${idx++}`)
    params.push(scores.riskScore)
  }
  if (scores.healthScore !== undefined) {
    sets.push(`health_score = $${idx++}`)
    params.push(scores.healthScore)
  }

  const res = await tenantQuery(
    tenantId,
    `UPDATE operational_twins SET ${sets.join(', ')}
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    params
  )
  if (res.rows.length === 0) throw new Error(`Twin not found: ${twinId}`)
  return _mapTwin(res.rows[0])
}

export async function updateTwinStatus(
  twinId: string,
  tenantId: string,
  status: TwinStatus
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE operational_twins SET status = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [twinId, tenantId, status]
  )
}

export async function markTwinSynced(
  twinId: string,
  tenantId: string,
  syncLagMs: number
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE operational_twins
     SET last_synced_at = now(), sync_lag_ms = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [twinId, tenantId, syncLagMs]
  )
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getTwin(twinId: string, tenantId: string): Promise<OperationalTwin | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM operational_twins WHERE id = $1 AND tenant_id = $2',
    [twinId, tenantId]
  )
  return res.rows.length > 0 ? _mapTwin(res.rows[0]) : null
}

export async function getTwinByEntity(
  tenantId: string,
  entityType: TwinEntityType,
  entityId: string
): Promise<OperationalTwin | null> {
  const res = await tenantQuery(
    tenantId,
    'SELECT * FROM operational_twins WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3',
    [tenantId, entityType, entityId]
  )
  return res.rows.length > 0 ? _mapTwin(res.rows[0]) : null
}

export async function listTwins(
  tenantId: string,
  filters: { entityType?: TwinEntityType; status?: TwinStatus; limit?: number; offset?: number } = {}
): Promise<OperationalTwin[]> {
  const conditions: string[] = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (filters.entityType) { conditions.push(`entity_type = $${idx++}`); params.push(filters.entityType) }
  if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status) }

  params.push(filters.limit ?? 100)
  params.push(filters.offset ?? 0)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM operational_twins
     WHERE ${conditions.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  )
  return res.rows.map(_mapTwin)
}

export async function getTwinCount(tenantId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    'SELECT COUNT(*) as cnt FROM operational_twins WHERE tenant_id = $1',
    [tenantId]
  )
  return parseInt(res.rows[0]?.cnt ?? '0', 10)
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

export function _mapTwin(row: Record<string, unknown>): OperationalTwin {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    entityType: row.entity_type as TwinEntityType,
    entityId: row.entity_id as string,
    name: row.name as string,
    description: row.description != null ? row.description as string : undefined,
    status: row.status as TwinStatus,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    readinessScore: row.readiness_score != null ? Number(row.readiness_score) : undefined,
    riskScore: row.risk_score != null ? Number(row.risk_score) : undefined,
    healthScore: row.health_score != null ? Number(row.health_score) : undefined,
    lastSyncedAt: row.last_synced_at != null ? new Date(row.last_synced_at as string) : undefined,
    syncLagMs: row.sync_lag_ms != null ? row.sync_lag_ms as number : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = { _mapTwin }

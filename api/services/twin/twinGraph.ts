// Denver Engineering — Twin Graph (v6.0.0)
// Relationship CRUD for the twin dependency/relationship graph.

import { tenantQuery } from '../../db/pool'
import { TwinRelationship, AddRelationshipInput, TwinRelType } from './twinTypes'

// ─── Add relationship ─────────────────────────────────────────────────────────

export async function addRelationship(input: AddRelationshipInput): Promise<TwinRelationship> {
  const { tenantId, fromTwinId, toTwinId, relType, weight = 1.0, metadata = {} } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO twin_relationships
       (tenant_id, from_twin_id, to_twin_id, rel_type, weight, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (from_twin_id, to_twin_id, rel_type)
     DO UPDATE SET
       weight = EXCLUDED.weight,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    [tenantId, fromTwinId, toTwinId, relType, weight, JSON.stringify(metadata)]
  )
  return _mapRelationship(res.rows[0])
}

// ─── Remove relationship ──────────────────────────────────────────────────────

export async function removeRelationship(
  tenantId: string,
  fromTwinId: string,
  toTwinId: string,
  relType: TwinRelType
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE twin_relationships
     SET valid_to = now()
     WHERE tenant_id = $1 AND from_twin_id = $2 AND to_twin_id = $3 AND rel_type = $4
       AND valid_to IS NULL`,
    [tenantId, fromTwinId, toTwinId, relType]
  )
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getRelationship(
  tenantId: string,
  fromTwinId: string,
  toTwinId: string,
  relType: TwinRelType
): Promise<TwinRelationship | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_relationships
     WHERE tenant_id=$1 AND from_twin_id=$2 AND to_twin_id=$3 AND rel_type=$4
       AND valid_to IS NULL`,
    [tenantId, fromTwinId, toTwinId, relType]
  )
  return res.rows.length > 0 ? _mapRelationship(res.rows[0]) : null
}

export async function getOutboundRelationships(
  twinId: string,
  tenantId: string,
  relType?: TwinRelType
): Promise<TwinRelationship[]> {
  const conditions = ['tenant_id = $1', 'from_twin_id = $2', 'valid_to IS NULL']
  const params: unknown[] = [tenantId, twinId]
  if (relType) { conditions.push(`rel_type = $${params.length + 1}`); params.push(relType) }

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_relationships WHERE ${conditions.join(' AND ')} ORDER BY weight DESC`,
    params
  )
  return res.rows.map(_mapRelationship)
}

export async function getInboundRelationships(
  twinId: string,
  tenantId: string,
  relType?: TwinRelType
): Promise<TwinRelationship[]> {
  const conditions = ['tenant_id = $1', 'to_twin_id = $2', 'valid_to IS NULL']
  const params: unknown[] = [tenantId, twinId]
  if (relType) { conditions.push(`rel_type = $${params.length + 1}`); params.push(relType) }

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_relationships WHERE ${conditions.join(' AND ')} ORDER BY weight DESC`,
    params
  )
  return res.rows.map(_mapRelationship)
}

export async function getAllRelationshipsForTenant(
  tenantId: string,
  relType?: TwinRelType
): Promise<TwinRelationship[]> {
  const conditions = ['tenant_id = $1', 'valid_to IS NULL']
  const params: unknown[] = [tenantId]
  if (relType) { conditions.push(`rel_type = $${params.length + 1}`); params.push(relType) }

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM twin_relationships WHERE ${conditions.join(' AND ')}`,
    params
  )
  return res.rows.map(_mapRelationship)
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

export function _mapRelationship(row: Record<string, unknown>): TwinRelationship {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    fromTwinId: row.from_twin_id as string,
    toTwinId: row.to_twin_id as string,
    relType: row.rel_type as TwinRelType,
    weight: Number(row.weight),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    validFrom: new Date(row.valid_from as string),
    validTo: row.valid_to != null ? new Date(row.valid_to as string) : undefined,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapRelationship }

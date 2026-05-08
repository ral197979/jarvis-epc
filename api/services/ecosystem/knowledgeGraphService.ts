// Denver Engineering — Knowledge Graph Service (v9.0.0)
// Tenant-isolated operational knowledge graph with entity resolution,
// relationship management, and explainable graph paths.

import { tenantQuery } from '../../db/pool'
import { KgEntity, KgRelationship, KgEntityType } from './ecosystemTypes'

// ─── Entity management ────────────────────────────────────────────────────────

export interface UpsertEntityInput {
  entityType: KgEntityType
  entityRef: string
  label: string
  properties?: Record<string, unknown>
  embeddingId?: string
}

export async function upsertEntity(
  tenantId: string,
  input: UpsertEntityInput,
): Promise<KgEntity> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO kg_entities (tenant_id, entity_type, entity_ref, label, properties, embedding_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, entity_type, entity_ref)
     DO UPDATE SET
       label = EXCLUDED.label,
       properties = EXCLUDED.properties,
       embedding_id = COALESCE(EXCLUDED.embedding_id, kg_entities.embedding_id),
       updated_at = now()
     RETURNING *`,
    [
      tenantId, input.entityType, input.entityRef, input.label,
      JSON.stringify(input.properties ?? {}), input.embeddingId ?? null,
    ],
  )
  return _mapEntity(res.rows[0])
}

export async function getEntity(tenantId: string, entityId: string): Promise<KgEntity | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_entities WHERE id = $1 AND tenant_id = $2`,
    [entityId, tenantId],
  )
  return res.rows.length > 0 ? _mapEntity(res.rows[0]) : null
}

export async function findEntitiesByRef(
  tenantId: string,
  entityType: KgEntityType,
  entityRef: string,
): Promise<KgEntity | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_entities
     WHERE tenant_id = $1 AND entity_type = $2 AND entity_ref = $3`,
    [tenantId, entityType, entityRef],
  )
  return res.rows.length > 0 ? _mapEntity(res.rows[0]) : null
}

export async function searchEntities(
  tenantId: string,
  opts: {
    entityType?: KgEntityType
    labelContains?: string
    limit?: number
  } = {},
): Promise<KgEntity[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_entities
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR entity_type = $2)
       AND ($3::text IS NULL OR label ILIKE '%' || $3 || '%')
     ORDER BY updated_at DESC
     LIMIT $4`,
    [tenantId, opts.entityType ?? null, opts.labelContains ?? null, opts.limit ?? 100],
  )
  return res.rows.map(_mapEntity)
}

// ─── Relationship management ──────────────────────────────────────────────────

export interface AddRelationshipInput {
  fromEntityId: string
  toEntityId: string
  relationshipType: string
  weight?: number
  confidence?: number
  source?: 'inferred' | 'explicit' | 'federated'
  properties?: Record<string, unknown>
}

export async function addRelationship(
  tenantId: string,
  input: AddRelationshipInput,
): Promise<KgRelationship> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO kg_relationships
      (tenant_id, from_entity_id, to_entity_id, relationship_type, weight, confidence, source, properties)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId, input.fromEntityId, input.toEntityId,
      input.relationshipType,
      input.weight ?? 1.0, input.confidence ?? 1.0,
      input.source ?? 'explicit',
      JSON.stringify(input.properties ?? {}),
    ],
  )
  return _mapRelationship(res.rows[0])
}

export async function getNeighborhood(
  tenantId: string,
  entityId: string,
  depth: number = 1,
  limit: number = 50,
): Promise<{ entity: KgEntity; relationships: KgRelationship[] }> {
  const entity = await getEntity(tenantId, entityId)
  if (entity == null) throw new Error(`Entity ${entityId} not found`)

  const relRes = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_relationships
     WHERE tenant_id = $1 AND (from_entity_id = $2 OR to_entity_id = $2)
     ORDER BY weight DESC, confidence DESC
     LIMIT $3`,
    [tenantId, entityId, limit],
  )

  return {
    entity,
    relationships: relRes.rows.map(_mapRelationship),
  }
}

// ─── Graph query ──────────────────────────────────────────────────────────────

export interface GraphQueryInput {
  entityTypes?: KgEntityType[]
  relationshipTypes?: string[]
  minConfidence?: number
  source?: 'inferred' | 'explicit' | 'federated'
  limit?: number
}

export async function queryGraph(
  tenantId: string,
  query: GraphQueryInput,
): Promise<{ entities: KgEntity[]; relationships: KgRelationship[] }> {
  const entityRes = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_entities
     WHERE tenant_id = $1
       AND ($2::text[] IS NULL OR entity_type = ANY($2))
     ORDER BY updated_at DESC LIMIT $3`,
    [tenantId, query.entityTypes ?? null, query.limit ?? 100],
  )

  const relRes = await tenantQuery(
    tenantId,
    `SELECT * FROM kg_relationships
     WHERE tenant_id = $1
       AND ($2::text[] IS NULL OR relationship_type = ANY($2))
       AND confidence >= $3
       AND ($4::text IS NULL OR source = $4)
     ORDER BY weight DESC LIMIT $5`,
    [
      tenantId,
      query.relationshipTypes ?? null,
      query.minConfidence ?? 0,
      query.source ?? null,
      query.limit ?? 200,
    ],
  )

  return {
    entities: entityRes.rows.map(_mapEntity),
    relationships: relRes.rows.map(_mapRelationship),
  }
}

export async function getExplainablePath(
  tenantId: string,
  fromEntityId: string,
  toEntityId: string,
): Promise<KgRelationship[]> {
  // BFS with 2-hop depth using SQL join (simplified; production uses recursive CTE)
  const res = await tenantQuery(
    tenantId,
    `SELECT r1.* FROM kg_relationships r1
     WHERE r1.tenant_id = $1
       AND r1.from_entity_id = $2
       AND r1.to_entity_id = $3
     UNION
     SELECT r2.* FROM kg_relationships r1
     JOIN kg_relationships r2
       ON r1.tenant_id = r2.tenant_id AND r1.to_entity_id = r2.from_entity_id
     WHERE r1.tenant_id = $1
       AND r1.from_entity_id = $2
       AND r2.to_entity_id = $3`,
    [tenantId, fromEntityId, toEntityId],
  )
  return res.rows.map(_mapRelationship)
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapEntity(row: Record<string, unknown>): KgEntity {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    entityType: row['entity_type'] as KgEntityType,
    entityRef: row['entity_ref'] as string,
    label: row['label'] as string,
    properties: (typeof row['properties'] === 'string'
      ? JSON.parse(row['properties'])
      : row['properties']) as Record<string, unknown>,
    embeddingId: (row['embedding_id'] as string) ?? null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapRelationship(row: Record<string, unknown>): KgRelationship {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    fromEntityId: row['from_entity_id'] as string,
    toEntityId: row['to_entity_id'] as string,
    relationshipType: row['relationship_type'] as string,
    weight: Number(row['weight'] ?? 1.0),
    confidence: Number(row['confidence'] ?? 1.0),
    source: (row['source'] as string) ?? null,
    properties: (typeof row['properties'] === 'string'
      ? JSON.parse(row['properties'])
      : row['properties']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
  }
}

export const __testHooks = { _mapEntity, _mapRelationship }

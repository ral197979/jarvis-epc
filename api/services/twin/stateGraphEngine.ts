// Denver Engineering — State Graph Engine (v6.0.0)
// Constructs and maintains the in-memory state graph from DB relationships.

import { tenantQuery } from '../../db/pool'
import { TwinRelationship, TwinRelType, TwinStatus, TwinEntityType } from './twinTypes'
import { _mapRelationship } from './twinGraph'

// ─── Graph structures ─────────────────────────────────────────────────────────

export interface StateGraphNode {
  twinId: string
  entityType: TwinEntityType
  entityId: string
  name: string
  status: TwinStatus
  readinessScore?: number
  riskScore?: number
  healthScore?: number
  metadata: Record<string, unknown>
}

export interface StateGraph {
  nodes: Map<string, StateGraphNode>
  adjacency: Map<string, TwinRelationship[]>   // outbound edges per node
  reverseAdj: Map<string, TwinRelationship[]>  // inbound edges per node
  tenantId: string
  builtAt: Date
}

// ─── Build graph ──────────────────────────────────────────────────────────────

export async function buildStateGraph(tenantId: string): Promise<StateGraph> {
  const [twinsRes, relsRes] = await Promise.all([
    tenantQuery(tenantId, 'SELECT * FROM operational_twins WHERE tenant_id = $1', [tenantId]),
    tenantQuery(
      tenantId,
      'SELECT * FROM twin_relationships WHERE tenant_id = $1 AND valid_to IS NULL',
      [tenantId]
    ),
  ])

  const nodes = new Map<string, StateGraphNode>()
  for (const row of twinsRes.rows) {
    nodes.set(row.id as string, {
      twinId: row.id as string,
      entityType: row.entity_type as TwinEntityType,
      entityId: row.entity_id as string,
      name: row.name as string,
      status: row.status as TwinStatus,
      readinessScore: row.readiness_score != null ? Number(row.readiness_score) : undefined,
      riskScore: row.risk_score != null ? Number(row.risk_score) : undefined,
      healthScore: row.health_score != null ? Number(row.health_score) : undefined,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })
  }

  const adjacency = new Map<string, TwinRelationship[]>()
  const reverseAdj = new Map<string, TwinRelationship[]>()

  for (const row of relsRes.rows) {
    const rel = _mapRelationship(row)
    if (!adjacency.has(rel.fromTwinId)) adjacency.set(rel.fromTwinId, [])
    adjacency.get(rel.fromTwinId)!.push(rel)
    if (!reverseAdj.has(rel.toTwinId)) reverseAdj.set(rel.toTwinId, [])
    reverseAdj.get(rel.toTwinId)!.push(rel)
  }

  return { nodes, adjacency, reverseAdj, tenantId, builtAt: new Date() }
}

// ─── Subgraph extraction ──────────────────────────────────────────────────────

export function extractSubgraph(graph: StateGraph, rootTwinIds: string[]): StateGraph {
  const visited = new Set<string>()
  const queue = [...rootTwinIds]

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const rel of graph.adjacency.get(id) ?? []) {
      if (!visited.has(rel.toTwinId)) queue.push(rel.toTwinId)
    }
  }

  const nodes = new Map<string, StateGraphNode>()
  const adjacency = new Map<string, TwinRelationship[]>()
  const reverseAdj = new Map<string, TwinRelationship[]>()

  for (const id of visited) {
    const node = graph.nodes.get(id)
    if (node) nodes.set(id, node)

    const edges = (graph.adjacency.get(id) ?? []).filter(r => visited.has(r.toTwinId))
    if (edges.length > 0) adjacency.set(id, edges)

    const inbound = (graph.reverseAdj.get(id) ?? []).filter(r => visited.has(r.fromTwinId))
    if (inbound.length > 0) reverseAdj.set(id, inbound)
  }

  return { nodes, adjacency, reverseAdj, tenantId: graph.tenantId, builtAt: graph.builtAt }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getNeighbors(
  graph: StateGraph,
  twinId: string,
  direction: 'outbound' | 'inbound' | 'both' = 'both'
): string[] {
  const out = direction !== 'inbound'
    ? (graph.adjacency.get(twinId) ?? []).map(r => r.toTwinId)
    : []
  const inb = direction !== 'outbound'
    ? (graph.reverseAdj.get(twinId) ?? []).map(r => r.fromTwinId)
    : []
  return [...new Set([...out, ...inb])]
}

export function getEdgesByType(graph: StateGraph, relType: TwinRelType): TwinRelationship[] {
  const result: TwinRelationship[] = []
  for (const edges of graph.adjacency.values()) {
    for (const edge of edges) {
      if (edge.relType === relType) result.push(edge)
    }
  }
  return result
}

export function getDegradedNodes(graph: StateGraph): StateGraphNode[] {
  const degraded: StateGraphNode[] = []
  for (const node of graph.nodes.values()) {
    if (node.status === 'degraded' || node.status === 'failed' || node.status === 'maintenance') {
      degraded.push(node)
    }
  }
  return degraded
}

export const __testHooks = { extractSubgraph, getNeighbors }

// Denver Engineering — Graph Traversal Service (v6.0.0)
// BFS/DFS traversal, critical path, cycle detection, impact analysis.

import { StateGraph, StateGraphNode } from './stateGraphEngine'
import { GraphNode, GraphEdge, GraphTraversalResult, TwinEntityType, TwinStatus } from './twinTypes'

// ─── BFS traversal ────────────────────────────────────────────────────────────

export function bfsTraversal(
  graph: StateGraph,
  rootId: string,
  maxDepth = 10
): GraphTraversalResult {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const visited = new Map<string, number>() // twinId → depth
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]
  const impactedEntities: string[] = []
  const operationalRiskPath: string[] = []

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (visited.has(id) || depth > maxDepth) continue
    visited.set(id, depth)

    const node = graph.nodes.get(id)
    if (!node) continue

    nodes.push(_toGraphNode(node, depth))

    if (node.status === 'degraded' || node.status === 'failed') {
      impactedEntities.push(id)
      if (node.riskScore != null && node.riskScore > 50) {
        operationalRiskPath.push(id)
      }
    }

    for (const rel of graph.adjacency.get(id) ?? []) {
      edges.push({ fromTwinId: rel.fromTwinId, toTwinId: rel.toTwinId, relType: rel.relType, weight: rel.weight })
      if (!visited.has(rel.toTwinId)) {
        queue.push({ id: rel.toTwinId, depth: depth + 1 })
      }
    }
  }

  const hasCycles = detectCycles(graph)
  const criticalityScore = _computeCriticality(nodes)
  const dependencyDepth = visited.size > 0 ? Math.max(...visited.values()) : 0

  return { nodes, edges, criticalityScore, dependencyDepth, impactedEntities, operationalRiskPath, hasCycles }
}

// ─── DFS traversal ────────────────────────────────────────────────────────────

export function dfsTraversal(
  graph: StateGraph,
  rootId: string,
  maxDepth = 10
): GraphTraversalResult {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const visited = new Map<string, number>()
  const impactedEntities: string[] = []
  const operationalRiskPath: string[] = []

  function _dfs(id: string, depth: number): void {
    if (visited.has(id) || depth > maxDepth) return
    visited.set(id, depth)

    const node = graph.nodes.get(id)
    if (!node) return
    nodes.push(_toGraphNode(node, depth))

    if (node.status === 'degraded' || node.status === 'failed') {
      impactedEntities.push(id)
      if (node.riskScore != null && node.riskScore > 50) operationalRiskPath.push(id)
    }

    for (const rel of graph.adjacency.get(id) ?? []) {
      edges.push({ fromTwinId: rel.fromTwinId, toTwinId: rel.toTwinId, relType: rel.relType, weight: rel.weight })
      _dfs(rel.toTwinId, depth + 1)
    }
  }
  _dfs(rootId, 0)

  const hasCycles = detectCycles(graph)
  const criticalityScore = _computeCriticality(nodes)
  const dependencyDepth = visited.size > 0 ? Math.max(...visited.values()) : 0

  return { nodes, edges, criticalityScore, dependencyDepth, impactedEntities, operationalRiskPath, hasCycles }
}

// ─── Cycle detection ──────────────────────────────────────────────────────────

export function detectCycles(graph: StateGraph): boolean {
  const color = new Map<string, 'white' | 'gray' | 'black'>()
  for (const id of graph.nodes.keys()) color.set(id, 'white')

  function _visit(id: string): boolean {
    color.set(id, 'gray')
    for (const rel of graph.adjacency.get(id) ?? []) {
      const c = color.get(rel.toTwinId)
      if (c === 'gray') return true
      if (c === 'white' && _visit(rel.toTwinId)) return true
    }
    color.set(id, 'black')
    return false
  }

  for (const id of graph.nodes.keys()) {
    if (color.get(id) === 'white' && _visit(id)) return true
  }
  return false
}

// ─── Critical path ────────────────────────────────────────────────────────────

export function findCriticalPath(
  graph: StateGraph,
  fromId: string,
  toId: string
): string[] {
  // Dijkstra by risk weight (higher risk = shorter "distance" = prioritized)
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const unvisited = new Set<string>(graph.nodes.keys())

  for (const id of graph.nodes.keys()) dist.set(id, Infinity)
  dist.set(fromId, 0)

  while (unvisited.size > 0) {
    // Pick unvisited with smallest dist
    let curr: string | null = null
    let smallest = Infinity
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity
      if (d < smallest) { smallest = d; curr = id }
    }
    if (curr === null || curr === toId) break
    unvisited.delete(curr)

    for (const rel of graph.adjacency.get(curr) ?? []) {
      if (!unvisited.has(rel.toTwinId)) continue
      // Use inverted weight (higher weight = more critical = shorter path)
      const alt = (dist.get(curr) ?? Infinity) + (10 - rel.weight)
      if (alt < (dist.get(rel.toTwinId) ?? Infinity)) {
        dist.set(rel.toTwinId, alt)
        prev.set(rel.toTwinId, curr)
      }
    }
  }

  // Reconstruct path
  if (dist.get(toId) === Infinity) return []
  const path: string[] = []
  let cur: string | undefined = toId
  while (cur !== undefined) {
    path.unshift(cur)
    cur = prev.get(cur)
  }
  return path
}

// ─── Impact analysis ──────────────────────────────────────────────────────────

export function getImpactedByFailure(graph: StateGraph, twinId: string): string[] {
  // Walk reverse edges — who depends on this node?
  const impacted = new Set<string>()
  const queue = [twinId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const rel of graph.reverseAdj.get(id) ?? []) {
      if (!impacted.has(rel.fromTwinId)) {
        impacted.add(rel.fromTwinId)
        queue.push(rel.fromTwinId)
      }
    }
  }
  impacted.delete(twinId)
  return [...impacted]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _toGraphNode(node: StateGraphNode, depth: number): GraphNode {
  return {
    twinId: node.twinId,
    entityType: node.entityType,
    entityId: node.entityId,
    name: node.name,
    status: node.status,
    readinessScore: node.readinessScore,
    riskScore: node.riskScore,
    depth,
    metadata: node.metadata,
  }
}

function _computeCriticality(nodes: GraphNode[]): number {
  if (nodes.length === 0) return 0
  const degraded = nodes.filter(n => n.status === 'degraded' || n.status === 'failed').length
  const avgRisk = nodes.reduce((sum, n) => sum + (n.riskScore ?? 0), 0) / nodes.length
  return Math.min(100, degraded * 10 + avgRisk)
}

export const __testHooks = { detectCycles, findCriticalPath, getImpactedByFailure, _computeCriticality }

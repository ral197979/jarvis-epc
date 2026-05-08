// Denver Engineering — Graph Risk Propagation (v6.0.0)
// Propagates risk scores through the dependency graph using weighted decay.

import { StateGraph } from './stateGraphEngine'
import { RiskPropagationResult } from './twinTypes'

const PROPAGATION_DECAY = 0.7   // risk attenuates per hop
const MIN_PROPAGATION_RISK = 5  // below this threshold, stop propagating

// ─── Propagate risk ───────────────────────────────────────────────────────────

export function propagateRisk(
  graph: StateGraph,
  rootTwinId: string,
  initialRisk?: number
): RiskPropagationResult {
  const root = graph.nodes.get(rootTwinId)
  if (!root) {
    return {
      rootTwinId,
      propagatedRisk: new Map(),
      propagationPath: [],
      totalImpactScore: 0,
      criticalNodes: [],
    }
  }

  const sourceRisk = initialRisk ?? root.riskScore ?? 0
  const propagatedRisk = new Map<string, number>()
  const propagationPath: string[] = []
  const criticalNodes: string[] = []

  // BFS with exponential decay
  const queue: Array<{ id: string; risk: number; depth: number }> = [
    { id: rootTwinId, risk: sourceRisk, depth: 0 }
  ]

  while (queue.length > 0) {
    const { id, risk, depth } = queue.shift()!
    const existing = propagatedRisk.get(id) ?? 0
    if (risk <= existing) continue // already have higher risk from another path

    propagatedRisk.set(id, risk)
    propagationPath.push(id)

    const node = graph.nodes.get(id)
    if (node && risk >= 75) criticalNodes.push(id)

    if (risk < MIN_PROPAGATION_RISK) continue

    for (const rel of graph.adjacency.get(id) ?? []) {
      // Propagation weight: depends_on and blocks carry full weight; peer carries half
      const relMultiplier = rel.relType === 'peer' ? 0.5 : 1.0
      const propagated = risk * PROPAGATION_DECAY * relMultiplier * rel.weight
      const toExisting = propagatedRisk.get(rel.toTwinId) ?? 0
      if (propagated > toExisting) {
        queue.push({ id: rel.toTwinId, risk: propagated, depth: depth + 1 })
      }
    }
  }

  const totalImpactScore = Math.min(100,
    [...propagatedRisk.values()].reduce((sum, r) => sum + r, 0) / Math.max(1, propagatedRisk.size)
  )

  return {
    rootTwinId,
    propagatedRisk,
    propagationPath,
    totalImpactScore,
    criticalNodes,
  }
}

// ─── Multi-root propagation ───────────────────────────────────────────────────

export function propagateRiskMultiRoot(
  graph: StateGraph,
  roots: Array<{ twinId: string; riskScore: number }>
): Map<string, number> {
  const combined = new Map<string, number>()

  for (const root of roots) {
    const result = propagateRisk(graph, root.twinId, root.riskScore)
    for (const [id, risk] of result.propagatedRisk) {
      const existing = combined.get(id) ?? 0
      // Take max risk from all propagation paths
      if (risk > existing) combined.set(id, risk)
    }
  }

  return combined
}

// ─── Risk gradient ────────────────────────────────────────────────────────────

export function computeRiskGradient(
  graph: StateGraph
): Array<{ twinId: string; risk: number; trend: 'increasing' | 'stable' | 'decreasing' }> {
  const gradient: Array<{ twinId: string; risk: number; trend: 'increasing' | 'stable' | 'decreasing' }> = []

  for (const [id, node] of graph.nodes) {
    const baseRisk = node.riskScore ?? 0
    // Check if neighbors' risk is higher (incoming risk pressure)
    const inbound = graph.reverseAdj.get(id) ?? []
    const avgUpstreamRisk = inbound.length > 0
      ? inbound.reduce((sum, rel) => {
          const upstream = graph.nodes.get(rel.fromTwinId)
          return sum + (upstream?.riskScore ?? 0)
        }, 0) / inbound.length
      : baseRisk

    const trend: 'increasing' | 'stable' | 'decreasing' =
      avgUpstreamRisk > baseRisk + 10 ? 'increasing' :
      avgUpstreamRisk < baseRisk - 10 ? 'decreasing' : 'stable'

    gradient.push({ twinId: id, risk: baseRisk, trend })
  }

  return gradient.sort((a, b) => b.risk - a.risk)
}

export const __testHooks = { propagateRisk, PROPAGATION_DECAY, MIN_PROPAGATION_RISK }

# System State Graph Engine

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The State Graph Engine constructs and queries the operational dependency graph — a directed weighted graph where twins are nodes and their relationships (depends_on, blocks, contains, etc.) are edges. It powers impact analysis, critical path finding, and risk propagation.

## Graph Construction

```typescript
buildStateGraph(tenantId): Promise<StateGraph>
```

Builds in-memory graph from DB state:
1. Load all active twins for tenant → `nodes: Map<twinId, StateGraphNode>`
2. Load all active relationships (valid_to IS NULL) → build `adjacency` and `reverseAdj` maps
3. Return `StateGraph` with timestamp

## Data Structures

```typescript
interface StateGraph {
  nodes: Map<string, StateGraphNode>    // O(1) node lookup
  adjacency: Map<string, TwinRelationship[]>   // outbound edges per node
  reverseAdj: Map<string, TwinRelationship[]>  // inbound edges per node
  tenantId: string
  builtAt: Date
}
```

## Relationship Types

| Type | Meaning |
|------|---------|
| `depends_on` | Source requires target to be operational |
| `blocks` | Source is blocking target |
| `contains` | Source contains target (hierarchical) |
| `feeds_into` | Source output feeds into target |
| `peer` | Lateral relationship (half-weight propagation) |
| `owns` | Source owns target entity |
| `inspects` | Source inspects target |
| `permits` | Source permits target activity |
| `maintains` | Source maintains target |

## Traversal Algorithms

### BFS (`bfsTraversal`)
- Breadth-first, layer by layer
- Produces `GraphTraversalResult` with `dependencyDepth`
- Records impacted entities (degraded/failed nodes at any depth)
- Best for: impact blast radius analysis

### DFS (`dfsTraversal`)
- Depth-first, follows longest path first
- Useful for detecting deep dependency chains
- Best for: dependency chain inspection

### Critical Path (`findCriticalPath`)
- Dijkstra's algorithm with inverted weight (higher weight → shorter distance)
- Returns the highest-criticality path between two twins
- Best for: identifying what to prioritize

## Cycle Detection

Uses DFS coloring (white/gray/black):
- `white` = unvisited
- `gray` = in current DFS stack
- `black` = fully processed

A `gray` edge during DFS indicates a cycle. Cycles degrade predictability of impact analysis and are flagged in traversal results.

## Subgraph Extraction

`extractSubgraph(graph, rootIds)` performs BFS from root nodes and returns a subgraph containing only reachable nodes and their inter-edges. Used by the frontend TwinOperationsMap for focused views.

## Impact Analysis

`getImpactedByFailure(graph, twinId)` walks **reverse** edges — identifying all twins that depend on the failing twin, directly or transitively. Returns the set of impacted twin IDs.

## Performance Notes

- Graph is built fresh per request (no shared mutable state)
- For large tenants (>1000 twins), consider a TTL-based graph cache
- BFS/DFS are O(V+E) — linear in graph size

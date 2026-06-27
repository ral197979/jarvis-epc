/**
 * Denver Engineering — Knowledge Graph (R5)
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared semantic graph (ECOSYSTEM_INTEGRATION_CONTRACT.md §7). Nodes are
 * Universal Object Registry references (R4); edges are typed relationships
 * (subject --verb--> object), e.g. `instrument measures equipment`,
 * `test validates equipment`. Powers impact analysis, root-cause, and the digital
 * thread (digitalThread.ts).
 *
 * Pure, in-memory, pluggable store — no DB. Additive + flag-gated: the graph is a
 * usable data structure on its own; KNOWLEDGE_GRAPH gates future auto-contribution
 * wiring (apps emitting edges on events). Traversal directions are NEUTRAL and
 * explicit — `dependencies()` follows outgoing (subject→object) edges, `impacts()`
 * follows incoming edges — because the contract's verbs don't share one lifecycle
 * direction; the canonical lifecycle ordering lives in digitalThread.THREAD_STAGES.
 */
import { type ObjectRef, refKey, parseRef } from '../registry/objectRegistry'

export const EDGE_TYPES = [
  'belongs_to', 'feeds', 'measures', 'controls', 'defines',
  'validates', 'affects', 'supplied', 'derived_from',
] as const
export type EdgeType = typeof EDGE_TYPES[number]
const EDGE_SET = new Set<string>(EDGE_TYPES)
export function isEdgeType(t: string): t is EdgeType { return EDGE_SET.has(t) }

export class UnknownEdgeTypeError extends Error {
  constructor(t: string) { super(`unknown edge type: ${t}`); this.name = 'UnknownEdgeTypeError' }
}

export interface Edge { from: string; to: string; type: EdgeType }

/** Flag — reserved for future auto-contribution wiring. Default off. */
export function isKnowledgeGraphEnabled(): boolean {
  return process.env['KNOWLEDGE_GRAPH'] === 'true'
}

// ─── Pluggable store ───────────────────────────────────────────────────────────

export interface GraphStore {
  addNode(key: string, ref: ObjectRef): void
  addEdge(edge: Edge): void
  out(key: string): Edge[]
  in(key: string): Edge[]
  hasNode(key: string): boolean
  nodeCount(): number
  edgeCount(): number
}

export class InMemoryGraphStore implements GraphStore {
  private _nodes = new Map<string, ObjectRef>()
  private _out = new Map<string, Edge[]>()
  private _in = new Map<string, Edge[]>()
  private _edgeKeys = new Set<string>()

  addNode(key: string, ref: ObjectRef): void {
    if (!this._nodes.has(key)) this._nodes.set(key, ref)
  }
  addEdge(edge: Edge): void {
    const k = `${edge.from}|${edge.type}|${edge.to}`
    if (this._edgeKeys.has(k)) return            // dedupe
    this._edgeKeys.add(k)
    const o = this._out.get(edge.from) ?? []; o.push(edge); this._out.set(edge.from, o)
    const i = this._in.get(edge.to) ?? [];    i.push(edge); this._in.set(edge.to, i)
  }
  out(key: string): Edge[] { return this._out.get(key) ?? [] }
  in(key: string): Edge[] { return this._in.get(key) ?? [] }
  hasNode(key: string): boolean { return this._nodes.has(key) }
  nodeCount(): number { return this._nodes.size }
  edgeCount(): number { return this._edgeKeys.size }
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export type Direction = 'out' | 'in'

export interface TraverseOpts { direction?: Direction; type?: EdgeType }
export interface ReachOpts extends TraverseOpts { maxDepth?: number }

export class KnowledgeGraph {
  constructor(private store: GraphStore = new InMemoryGraphStore()) {}

  addNode(ref: ObjectRef): void { this.store.addNode(refKey(ref), ref) }

  addEdge(from: ObjectRef, to: ObjectRef, type: string): void {
    if (!isEdgeType(type)) throw new UnknownEdgeTypeError(type)
    this.addNode(from); this.addNode(to)
    this.store.addEdge({ from: refKey(from), to: refKey(to), type })
  }

  hasNode(ref: ObjectRef): boolean { return this.store.hasNode(refKey(ref)) }
  nodeCount(): number { return this.store.nodeCount() }
  edgeCount(): number { return this.store.edgeCount() }

  /** Direct neighbors of a node in one direction, optionally filtered by edge type. */
  neighbors(ref: ObjectRef, opts: TraverseOpts = {}): ObjectRef[] {
    const dir = opts.direction ?? 'out'
    const edges = dir === 'out' ? this.store.out(refKey(ref)) : this.store.in(refKey(ref))
    return edges
      .filter(e => !opts.type || e.type === opts.type)
      .map(e => parseRef(dir === 'out' ? e.to : e.from))
  }

  /** Transitive reach via repeated traversal (cycle-safe), excluding the start node. */
  reachable(ref: ObjectRef, opts: ReachOpts = {}): ObjectRef[] {
    const dir = opts.direction ?? 'out'
    const maxDepth = opts.maxDepth ?? Infinity
    const start = refKey(ref)
    const seen = new Set<string>([start])
    const out: ObjectRef[] = []
    let frontier: string[] = [start]
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = []
      for (const key of frontier) {
        const edges = dir === 'out' ? this.store.out(key) : this.store.in(key)
        for (const e of edges) {
          if (opts.type && e.type !== opts.type) continue
          const nbr = dir === 'out' ? e.to : e.from
          if (seen.has(nbr)) continue
          seen.add(nbr); next.push(nbr); out.push(parseRef(nbr))
        }
      }
      frontier = next
    }
    return out
  }

  /** What this object points at (outgoing subject→object edges), transitively. */
  dependencies(ref: ObjectRef, maxDepth?: number): ObjectRef[] {
    return this.reachable(ref, { direction: 'out', maxDepth })
  }

  /** What references this object (incoming edges), transitively — impact analysis. */
  impacts(ref: ObjectRef, maxDepth?: number): ObjectRef[] {
    return this.reachable(ref, { direction: 'in', maxDepth })
  }
}

/**
 * Tests: api/services/graph/knowledgeGraph.ts + digitalThread.ts
 *
 * Pure graph + thread traversal keyed by Universal Object Registry refs (R4).
 * Covers edge typing, dedupe, directional neighbors, transitive reach (impact /
 * dependency), cycle safety, thread-stage ordering, and trace.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeRef } from '../services/registry/objectRegistry'
import {
  KnowledgeGraph, isEdgeType, isKnowledgeGraphEnabled, UnknownEdgeTypeError,
} from '../services/graph/knowledgeGraph'
import {
  THREAD_STAGES, isThreadStage, stageIndex, compareStages, traceThread,
} from '../services/graph/digitalThread'

const U = (n: number) => `${String(n).repeat(8)}-2222-4333-8444-555555555555`
const sys  = makeRef('system', U(1))
const eq   = makeRef('equipment', U(2))
const inst = makeRef('instrument', U(3))
const dwg  = makeRef('drawing', U(4))
const test = makeRef('test', U(5))

/** Build the canonical example graph: subject --verb--> object. */
function exampleGraph(): KnowledgeGraph {
  const g = new KnowledgeGraph()
  g.addEdge(eq, sys, 'belongs_to')     // equipment belongs_to system
  g.addEdge(dwg, eq, 'defines')        // drawing defines equipment
  g.addEdge(inst, eq, 'measures')      // instrument measures equipment
  g.addEdge(test, eq, 'validates')     // test validates equipment
  return g
}

describe('knowledge graph — edges', () => {
  it('recognizes valid edge types', () => {
    expect(isEdgeType('measures')).toBe(true)
    expect(isEdgeType('frobnicates')).toBe(false)
  })
  it('rejects an unknown edge type', () => {
    expect(() => new KnowledgeGraph().addEdge(eq, sys, 'frobnicates')).toThrow(UnknownEdgeTypeError)
  })
  it('auto-adds nodes and dedupes identical edges', () => {
    const g = new KnowledgeGraph()
    g.addEdge(eq, sys, 'belongs_to')
    g.addEdge(eq, sys, 'belongs_to') // duplicate
    expect(g.nodeCount()).toBe(2)
    expect(g.edgeCount()).toBe(1)
    expect(g.hasNode(eq)).toBe(true)
  })
})

describe('knowledge graph — traversal', () => {
  it('neighbors out vs in', () => {
    const g = exampleGraph()
    expect(g.neighbors(eq, { direction: 'out' }).map(r => r.type)).toEqual(['system'])
    expect(g.neighbors(eq, { direction: 'in' }).map(r => r.type).sort()).toEqual(['drawing', 'instrument', 'test'])
  })
  it('filters neighbors by edge type', () => {
    const g = exampleGraph()
    expect(g.neighbors(eq, { direction: 'in', type: 'validates' }).map(r => r.type)).toEqual(['test'])
  })
  it('dependencies (outgoing) reach transitively', () => {
    const g = exampleGraph()
    // drawing → equipment → system
    expect(g.dependencies(dwg).map(r => r.type).sort()).toEqual(['equipment', 'system'])
  })
  it('impacts (incoming) = who references this object', () => {
    const g = exampleGraph()
    expect(g.impacts(eq).map(r => r.type).sort()).toEqual(['drawing', 'instrument', 'test'])
  })
  it('respects maxDepth', () => {
    const g = exampleGraph()
    expect(g.dependencies(dwg, 1).map(r => r.type)).toEqual(['equipment']) // one hop only
  })
  it('is cycle-safe (terminates; start node excluded)', () => {
    const g = new KnowledgeGraph()
    g.addEdge(eq, sys, 'belongs_to')
    g.addEdge(sys, eq, 'feeds') // cycle
    expect(g.dependencies(eq).map(r => r.type)).toEqual(['system'])
  })
  it('flag defaults off and reads live', () => {
    expect(isKnowledgeGraphEnabled()).toBe(false)
  })
})

describe('digital thread', () => {
  beforeEach(() => { delete process.env['KNOWLEDGE_GRAPH'] })
  afterEach(() => { delete process.env['KNOWLEDGE_GRAPH'] })

  it('stage vocabulary is ordered and recognized', () => {
    expect(THREAD_STAGES[0]).toBe('requirement')
    expect(THREAD_STAGES[THREAD_STAGES.length - 1]).toBe('operations')
    expect(isThreadStage('fat')).toBe(true)
    expect(isThreadStage('lunch')).toBe(false)
  })
  it('stageIndex and compareStages order by lifecycle position', () => {
    expect(stageIndex('requirement')).toBeLessThan(stageIndex('turnover'))
    expect(compareStages('drawing', 'equipment')).toBeLessThan(0)
    expect(stageIndex('nonsense')).toBe(-1)
  })
  it('traceThread returns upstream + downstream for a node', () => {
    const g = exampleGraph()
    const t = traceThread(g, eq)
    expect(t.node).toBe(eq)
    expect(t.upstream.map(r => r.type)).toEqual(['system'])
    expect(t.downstream.map(r => r.type).sort()).toEqual(['drawing', 'instrument', 'test'])
  })
})

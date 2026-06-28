/**
 * Denver Engineering — Digital Thread (R5)
 * ─────────────────────────────────────────────────────────────────────────────
 * The canonical EPC lifecycle ordering (ECOSYSTEM_INTEGRATION_CONTRACT.md §6) and
 * a thread trace over the knowledge graph: backward to origin (dependencies) and
 * forward to downstream artifacts (impacts). Pure — no DB.
 *
 * THREAD_STAGES is a vocabulary/ordering, separate from the graph's edge verbs;
 * `compareStages` lets callers order nodes by lifecycle position when desired.
 */
import { type ObjectRef } from '../registry/objectRegistry'
import { type KnowledgeGraph } from './knowledgeGraph'

export const THREAD_STAGES = [
  'requirement', 'calculation', 'drawing', 'equipment', 'purchase_order',
  'submittal', 'installation', 'inspection', 'loop_check', 'fat', 'sat',
  'ist', 'performance_test', 'punch', 'turnover', 'operations',
] as const
export type ThreadStage = typeof THREAD_STAGES[number]

const STAGE_INDEX = new Map<string, number>(THREAD_STAGES.map((s, i) => [s, i]))

export function isThreadStage(s: string): s is ThreadStage { return STAGE_INDEX.has(s) }

/** Lifecycle position of a stage, or -1 if not a thread stage. */
export function stageIndex(stage: string): number {
  return STAGE_INDEX.has(stage) ? (STAGE_INDEX.get(stage) as number) : -1
}

/** Order two stages by lifecycle position (<0 if a precedes b). Non-stages sort last. */
export function compareStages(a: string, b: string): number {
  const ia = stageIndex(a), ib = stageIndex(b)
  return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
}

export interface ThreadTrace {
  node: ObjectRef
  /** Upstream origin chain (what the node derives from / points at). */
  upstream: ObjectRef[]
  /** Downstream artifacts (what references the node) — forward traceability. */
  downstream: ObjectRef[]
}

/** Full backward + forward traceability for an object through the graph. */
export function traceThread(graph: KnowledgeGraph, ref: ObjectRef): ThreadTrace {
  return {
    node: ref,
    upstream: graph.dependencies(ref),
    downstream: graph.impacts(ref),
  }
}

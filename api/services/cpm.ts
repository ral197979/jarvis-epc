/**
 * Denver Engineering — Critical Path (CPM-lite)
 * ──────────────────────────────────────────
 * v4.31.0 | Pure computation — no DB, no IO.
 *
 * Inputs:
 *   tasks:        { id, duration_days }[]
 *   dependencies: { predecessor_id, successor_id, lag_days }[]
 *                 All dependencies are Finish-to-Start for v1.
 *
 * Output (per task):
 *   es / ef       — earliest start / earliest finish (days from project day 0)
 *   ls / lf       — latest start / latest finish
 *   total_float   — lf - ef (>= 0 in a valid network)
 *   is_critical   — total_float == 0
 *
 * The forward pass sets es/ef; the backward pass sets ls/lf anchoring
 * from the longest ef (project finish). Cycles in dependencies are
 * detected and rejected — a CPM pass over a cyclic graph is meaningless.
 */

export interface CpmTask {
  id:             string
  duration_days:  number
}

export interface CpmDependency {
  predecessor_id: string
  successor_id:   string
  lag_days:       number
}

export interface CpmResult {
  es:           number
  ef:           number
  ls:           number
  lf:           number
  total_float:  number
  is_critical:  boolean
}

export interface CpmOutput {
  results:         Record<string, CpmResult>
  project_finish:  number
  critical_path:   string[]     // task ids sorted in topological order
}

export class CpmCycleError extends Error {
  constructor(public cycle: string[]) {
    super(`Cycle detected in schedule dependencies: ${cycle.join(' → ')}`)
    this.name = 'CpmCycleError'
  }
}

export class CpmMissingTaskError extends Error {
  constructor(public taskId: string) {
    super(`Dependency references unknown task id: ${taskId}`)
    this.name = 'CpmMissingTaskError'
  }
}

export function computeCpm(
  tasks:        CpmTask[],
  dependencies: CpmDependency[],
): CpmOutput {
  if (tasks.length === 0) {
    return { results: {}, project_finish: 0, critical_path: [] }
  }

  // Lookups + adjacency
  const byId = new Map<string, CpmTask>()
  for (const t of tasks) byId.set(t.id, t)

  // Validate: every dependency must reference known tasks.
  for (const d of dependencies) {
    if (!byId.has(d.predecessor_id)) throw new CpmMissingTaskError(d.predecessor_id)
    if (!byId.has(d.successor_id))   throw new CpmMissingTaskError(d.successor_id)
  }

  const preds = new Map<string, CpmDependency[]>()
  const succs = new Map<string, CpmDependency[]>()
  for (const t of tasks) { preds.set(t.id, []); succs.set(t.id, []) }
  for (const d of dependencies) {
    preds.get(d.successor_id)!.push(d)
    succs.get(d.predecessor_id)!.push(d)
  }

  // Topological order via Kahn's algorithm. Detects cycles as a side-effect.
  const inDegree = new Map<string, number>()
  for (const t of tasks) inDegree.set(t.id, preds.get(t.id)!.length)
  const queue: string[] = tasks.filter(t => inDegree.get(t.id) === 0).map(t => t.id)
  const topo: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    topo.push(id)
    for (const d of succs.get(id)!) {
      const n = inDegree.get(d.successor_id)! - 1
      inDegree.set(d.successor_id, n)
      if (n === 0) queue.push(d.successor_id)
    }
  }
  if (topo.length !== tasks.length) {
    // Isolate one offending cycle for a readable error message.
    const remaining = tasks.filter(t => !topo.includes(t.id)).map(t => t.id)
    throw new CpmCycleError(remaining)
  }

  // ── Forward pass ──────────────────────────────────────────────────────
  // ES = max over predecessors of (pred.EF + lag), floor at 0.
  // EF = ES + duration.
  const es = new Map<string, number>()
  const ef = new Map<string, number>()
  for (const id of topo) {
    const task = byId.get(id)!
    let myEs = 0
    for (const dep of preds.get(id)!) {
      const candidate = ef.get(dep.predecessor_id)! + dep.lag_days
      if (candidate > myEs) myEs = candidate
    }
    if (myEs < 0) myEs = 0                   // leads can't push start before zero
    es.set(id, myEs)
    ef.set(id, myEs + task.duration_days)
  }

  const projectFinish = Math.max(...Array.from(ef.values()))

  // ── Backward pass ──────────────────────────────────────────────────────
  // LF = min over successors of (succ.LS - lag); terminal tasks' LF = project finish.
  // LS = LF - duration.
  const ls = new Map<string, number>()
  const lf = new Map<string, number>()
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i]!
    const task = byId.get(id)!
    const succList = succs.get(id)!
    let myLf: number
    if (succList.length === 0) {
      myLf = projectFinish
    } else {
      myLf = Infinity
      for (const dep of succList) {
        const candidate = ls.get(dep.successor_id)! - dep.lag_days
        if (candidate < myLf) myLf = candidate
      }
    }
    lf.set(id, myLf)
    ls.set(id, myLf - task.duration_days)
  }

  // ── Assemble results ──────────────────────────────────────────────────
  const results: Record<string, CpmResult> = {}
  const criticalIds: string[] = []
  for (const id of topo) {
    const r: CpmResult = {
      es:          es.get(id)!,
      ef:          ef.get(id)!,
      ls:          ls.get(id)!,
      lf:          lf.get(id)!,
      total_float: lf.get(id)! - ef.get(id)!,
      is_critical: false,
    }
    r.is_critical = r.total_float === 0
    results[id] = r
    if (r.is_critical) criticalIds.push(id)
  }

  return {
    results,
    project_finish: projectFinish,
    critical_path:  criticalIds,
  }
}

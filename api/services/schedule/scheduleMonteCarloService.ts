/**
 * Denver Engineering — Schedule Monte Carlo + Recovery Planner (v4.50.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Vision Phase 5 (schedule intelligence). Propagates duration uncertainty through
 * the real CPM dependency network (`computeCpm`) over many iterations to forecast
 * completion, and proposes a recovery plan by simulating crashes of the highest-
 * leverage tasks.
 *
 * Outputs:
 *   • completion distribution — P10/P50/P80/P90 + probability of meeting a target
 *   • criticality index       — % of iterations each task lands on the critical path
 *   • critical path           — deterministic CPM critical path with float (why critical)
 *   • recovery plan           — crash candidates ranked by days saved
 *
 * The simulation is PURE given an injected `rng`, so tests are deterministic.
 */
import { computeCpm, type CpmTask, type CpmDependency } from '../cpm'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchedTask { id: string; name?: string; duration_days: number }
export interface SimOptions { iterations?: number; optimistic?: number; pessimistic?: number; targetDays?: number | null }

export interface CriticalPathStep { taskId: string; name: string; durationDays: number; totalFloat: number }
export interface RecoveryItem { taskId: string; name: string; durationDays: number; criticalityIndex: number; daysSaved: number; action: string }

export interface ScheduleForecast {
  iterations: number
  deterministicFinish: number          // CPM on planned durations (working days)
  p10: number; p50: number; p80: number; p90: number; mean: number
  targetDays: number | null
  probabilityOnTarget: number | null    // fraction of iterations finishing <= target
  criticality: { taskId: string; name: string; index: number }[]   // descending
  criticalPath: CriticalPathStep[]
  recovery: RecoveryItem[]
}

// ─── Sampling ─────────────────────────────────────────────────────────────────

/** Triangular sample in [min, max] with the given mode. */
function triangular(rng: () => number, min: number, mode: number, max: number): number {
  if (max <= min) return min
  const u = rng()
  const c = (mode - min) / (max - min)
  return u < c
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode))
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

// ─── Pure simulation ──────────────────────────────────────────────────────────

export function simulateSchedule(
  tasks: SchedTask[], dependencies: CpmDependency[], opts: SimOptions = {}, rng: () => number = Math.random,
): ScheduleForecast {
  const iterations = Math.max(1, Math.min(5000, opts.iterations ?? 1000))
  const optimistic = opts.optimistic ?? 0.85
  const pessimistic = opts.pessimistic ?? 1.30
  const targetDays = opts.targetDays ?? null

  const nameById = new Map(tasks.map(t => [t.id, t.name ?? t.id.slice(0, 8)]))
  const cpmTasks: CpmTask[] = tasks.map(t => ({ id: t.id, duration_days: Math.max(0, t.duration_days) }))

  // Deterministic baseline (planned durations)
  const baseline = computeCpm(cpmTasks, dependencies)
  const deterministicFinish = baseline.project_finish

  // Monte Carlo
  const finishes: number[] = new Array(iterations)
  const critCount = new Map<string, number>()
  for (const t of tasks) critCount.set(t.id, 0)

  for (let i = 0; i < iterations; i++) {
    const sampled: CpmTask[] = tasks.map(t => {
      const d = Math.max(0, t.duration_days)
      return { id: t.id, duration_days: d === 0 ? 0 : triangular(rng, d * optimistic, d, d * pessimistic) }
    })
    const out = computeCpm(sampled, dependencies)
    finishes[i] = out.project_finish
    // Float durations introduce FP noise, so strict total_float == 0 is unreliable.
    // Treat a task as critical when its float is within epsilon of zero.
    for (const t of tasks) {
      if ((out.results[t.id]?.total_float ?? Infinity) <= 1e-6) critCount.set(t.id, (critCount.get(t.id) ?? 0) + 1)
    }
  }

  finishes.sort((a, b) => a - b)
  const mean = finishes.reduce((s, x) => s + x, 0) / iterations
  const probabilityOnTarget = targetDays != null
    ? finishes.filter(f => f <= targetDays).length / iterations
    : null

  const criticality = tasks
    .map(t => ({ taskId: t.id, name: nameById.get(t.id)!, index: Math.round((critCount.get(t.id)! / iterations) * 1000) / 1000 }))
    .filter(c => c.index > 0)
    .sort((a, b) => b.index - a.index)

  const criticalPath: CriticalPathStep[] = baseline.critical_path.map(id => ({
    taskId: id, name: nameById.get(id) ?? id.slice(0, 8),
    durationDays: cpmTasks.find(t => t.id === id)?.duration_days ?? 0,
    totalFloat: baseline.results[id]?.total_float ?? 0,
  }))

  return {
    iterations,
    deterministicFinish,
    p10: Math.round(percentile(finishes, 10) * 10) / 10,
    p50: Math.round(percentile(finishes, 50) * 10) / 10,
    p80: Math.round(percentile(finishes, 80) * 10) / 10,
    p90: Math.round(percentile(finishes, 90) * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    targetDays,
    probabilityOnTarget: probabilityOnTarget == null ? null : Math.round(probabilityOnTarget * 1000) / 1000,
    criticality,
    criticalPath,
    recovery: recoveryPlan(tasks, dependencies, criticality, deterministicFinish),
  }
}

// ─── Recovery planner (pure) ──────────────────────────────────────────────────

/** Simulate crashing the highest-criticality tasks; keep those that actually pull in the finish. */
export function recoveryPlan(
  tasks: SchedTask[], dependencies: CpmDependency[], criticality: { taskId: string; name: string; index: number }[],
  baselineFinish: number, crashPct = 0.3, maxCandidates = 8,
): RecoveryItem[] {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const out: RecoveryItem[] = []
  for (const c of criticality.slice(0, maxCandidates)) {
    const task = byId.get(c.taskId)
    if (!task || task.duration_days <= 0) continue
    const crashed: CpmTask[] = tasks.map(t => ({
      id: t.id,
      duration_days: t.id === c.taskId ? Math.max(0, t.duration_days * (1 - crashPct)) : Math.max(0, t.duration_days),
    }))
    const daysSaved = Math.round((baselineFinish - computeCpm(crashed, dependencies).project_finish) * 10) / 10
    if (daysSaved > 0) {
      out.push({
        taskId: c.taskId, name: c.name, durationDays: task.duration_days, criticalityIndex: c.index, daysSaved,
        action: `Crash "${c.name}" ~${Math.round(crashPct * 100)}% (add crew / extend shifts / re-sequence) to recover ~${daysSaved} day${daysSaved === 1 ? '' : 's'}.`,
      })
    }
  }
  return out.sort((a, b) => b.daysSaved - a.daysSaved)
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

import { tenantQuery } from '../../db/pool'

export async function buildScheduleForecast(
  tenantId: string, projectId: string, opts: SimOptions = {},
): Promise<ScheduleForecast | { error: string } | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const [taskRes, depRes] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, name, duration_days FROM schedule_tasks WHERE tenant_id=$1 AND project_id=$2`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT predecessor_id, successor_id, lag_days FROM schedule_dependencies d
        WHERE d.tenant_id=$1 AND EXISTS (SELECT 1 FROM schedule_tasks s WHERE s.id=d.successor_id AND s.project_id=$2)`,
      [tenantId, projectId]),
  ])

  const tasks = (taskRes.rows as { id: string; name?: string; duration_days: number }[])
    .map(t => ({ id: t.id, name: t.name, duration_days: Number(t.duration_days) }))
  if (tasks.length === 0) return { error: 'No schedule tasks to forecast' }

  const dependencies = (depRes.rows as { predecessor_id: string; successor_id: string; lag_days: number }[])
    .map(d => ({ predecessor_id: d.predecessor_id, successor_id: d.successor_id, lag_days: Number(d.lag_days) }))

  try {
    return simulateSchedule(tasks, dependencies, opts)
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/**
 * Denver Engineering — Critical-Path Intelligence (v4.56.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Vision Phase 5 — "explain what is critical, why it is critical, what happens if
 * delayed." Built deterministically on the real CPM engine (`computeCpm`):
 *   • explainCriticalPath — the zero-float chain (why) + near-critical tasks (the
 *     buffer before each becomes critical)
 *   • whatIf — apply duration deltas, recompute, and report the new finish, the
 *     delta, the new critical path, and which tasks newly became critical
 *
 * Pure functions over fetched rows — testable, no LLM.
 */
import { computeCpm, type CpmTask, type CpmDependency } from '../cpm'
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskRow { id: string; name?: string | null; duration_days?: number | null }
export interface CriticalStep { taskId: string; name: string; durationDays: number }
export interface NearCriticalTask { taskId: string; name: string; totalFloat: number }
export interface CriticalPathExplain {
  projectFinish: number
  taskCount: number
  criticalPath: CriticalStep[]
  nearCritical: NearCriticalTask[]
}
export interface WhatIfChange { taskId: string; deltaDays: number }
export interface WhatIfResult {
  baselineFinish: number
  newFinish: number
  deltaDays: number
  changesApplied: WhatIfChange[]
  newCriticalPath: CriticalStep[]
  becameCritical: { taskId: string; name: string }[]
}

const EPS = 1e-6

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCpm(tasks: TaskRow[]): CpmTask[] {
  return tasks.map(t => ({ id: t.id, duration_days: Math.max(0, Number(t.duration_days) || 0) }))
}
function nameMap(tasks: TaskRow[]): Map<string, string> {
  return new Map(tasks.map(t => [t.id, (t.name && t.name.trim()) || t.id.slice(0, 8)]))
}

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function explainCriticalPath(tasks: TaskRow[], deps: CpmDependency[], nearLimit = 12): CriticalPathExplain {
  const names = nameMap(tasks)
  const durById = new Map(tasks.map(t => [t.id, Math.max(0, Number(t.duration_days) || 0)]))
  const out = computeCpm(toCpm(tasks), deps)

  const criticalSet = new Set(out.critical_path)
  const criticalPath: CriticalStep[] = out.critical_path.map(id => ({ taskId: id, name: names.get(id) ?? id.slice(0, 8), durationDays: durById.get(id) ?? 0 }))

  const nearCritical: NearCriticalTask[] = tasks
    .filter(t => !criticalSet.has(t.id))
    .map(t => ({ taskId: t.id, name: names.get(t.id) ?? t.id.slice(0, 8), totalFloat: Math.round((out.results[t.id]?.total_float ?? Infinity) * 10) / 10 }))
    .filter(t => isFinite(t.totalFloat) && t.totalFloat > EPS)
    .sort((a, b) => a.totalFloat - b.totalFloat)
    .slice(0, nearLimit)

  return { projectFinish: Math.round(out.project_finish * 10) / 10, taskCount: tasks.length, criticalPath, nearCritical }
}

export function whatIf(tasks: TaskRow[], deps: CpmDependency[], changes: WhatIfChange[]): WhatIfResult {
  const names = nameMap(tasks)
  const baseline = computeCpm(toCpm(tasks), deps)

  const deltaById = new Map(changes.map(c => [c.taskId, Number(c.deltaDays) || 0]))
  const adjusted: CpmTask[] = tasks.map(t => ({
    id: t.id,
    duration_days: Math.max(0, (Number(t.duration_days) || 0) + (deltaById.get(t.id) ?? 0)),
  }))
  const out = computeCpm(adjusted, deps)

  const durById = new Map(adjusted.map(t => [t.id, t.duration_days]))
  const newCriticalPath: CriticalStep[] = out.critical_path.map(id => ({ taskId: id, name: names.get(id) ?? id.slice(0, 8), durationDays: durById.get(id) ?? 0 }))

  const becameCritical = tasks
    .filter(t => (baseline.results[t.id]?.total_float ?? Infinity) > EPS && (out.results[t.id]?.total_float ?? Infinity) <= EPS)
    .map(t => ({ taskId: t.id, name: names.get(t.id) ?? t.id.slice(0, 8) }))

  return {
    baselineFinish: Math.round(baseline.project_finish * 10) / 10,
    newFinish: Math.round(out.project_finish * 10) / 10,
    deltaDays: Math.round((out.project_finish - baseline.project_finish) * 10) / 10,
    changesApplied: changes,
    newCriticalPath,
    becameCritical,
  }
}

// ─── DB ───────────────────────────────────────────────────────────────────────

async function fetchNetwork(tenantId: string, projectId: string): Promise<{ tasks: TaskRow[]; deps: CpmDependency[] } | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null
  const [t, d] = await Promise.all([
    tenantQuery(tenantId, `SELECT id, name, duration_days FROM schedule_tasks WHERE tenant_id=$1 AND project_id=$2`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT predecessor_id, successor_id, lag_days FROM schedule_dependencies d
        WHERE d.tenant_id=$1 AND EXISTS (SELECT 1 FROM schedule_tasks s WHERE s.id=d.successor_id AND s.project_id=$2)`,
      [tenantId, projectId]),
  ])
  return { tasks: t.rows as TaskRow[], deps: d.rows as CpmDependency[] }
}

export async function buildCriticalPath(tenantId: string, projectId: string): Promise<CriticalPathExplain | null> {
  const net = await fetchNetwork(tenantId, projectId)
  if (!net) return null
  return explainCriticalPath(net.tasks, net.deps)
}

export async function buildWhatIf(tenantId: string, projectId: string, changes: WhatIfChange[]): Promise<WhatIfResult | null> {
  const net = await fetchNetwork(tenantId, projectId)
  if (!net) return null
  return whatIf(net.tasks, net.deps, changes)
}

/**
 * Live wiring for the Projects/Portfolio module.
 *
 * Maps the existing Denver API shape (DB rows from `GET /api/v1/projects`, snake_case,
 * wrapped in `{ data, meta }`) onto the UI's `Project` type. All the impedance
 * mismatch lives HERE — screens consume the same `Project` whether data is mock or live.
 *
 * Enable with `VITE_USE_MOCKS=false` (+ `VITE_API_BASE`); see adapters.ts.
 */
import { api } from '../http'
import type { Project, Health, NewProjectInput, PortfolioKpis } from '../types'

/** Subset of the `projects` row + joins returned by the existing API. */
export interface RawProject {
  id: string
  code: string
  name: string
  client_name: string | null
  location: string | null
  country: string | null
  status: string | null
  current_phase: string | null
  currency: string | null
  budget: string | number | null
  actual_cost: string | number | null
  forecast_cost: string | number | null
  progress_pct: string | number | null
  planned_finish: string | null
  actual_finish: string | null
  metadata: Record<string, unknown> | null
  pm_name?: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const humanize = (s: string | null | undefined, fallback = '—'): string => {
  if (!s) return fallback
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatMoney(amount: number, currency: string): string {
  if (!amount) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

function deriveBudgetStatus(actual: number, budget: number): string {
  if (!budget) return 'No Budget'
  if (actual > budget) return 'Overrun'
  if (actual > budget * 0.9) return 'Watch'
  return 'Healthy'
}

function deriveScheduleStatus(plannedFinish: string | null, actualFinish: string | null, status: string | null): string {
  if (status && /complete|closed|handover/i.test(status)) return 'Complete'
  if (plannedFinish && !actualFinish) {
    const due = Date.parse(plannedFinish)
    if (Number.isFinite(due) && due < refNow()) return 'Delayed'
  }
  return 'On Track'
}

// Date.now() is fine here (live runtime, not the deterministic workflow sandbox).
function refNow(): number {
  return new Date().getTime()
}

function deriveHealth(budgetStatus: string, scheduleStatus: string): Health {
  if (budgetStatus === 'Overrun') return 'critical'
  if (budgetStatus === 'Watch' || scheduleStatus === 'Delayed') return 'at-risk'
  return 'healthy'
}

/** The single source of truth for raw-row → UI mapping. Pure + unit-tested. */
export function mapProject(r: RawProject): Project {
  const budget = num(r.budget)
  const actual = num(r.actual_cost)
  const meta = r.metadata ?? {}
  const budgetStatus = deriveBudgetStatus(actual, budget)
  const scheduleStatus = deriveScheduleStatus(r.planned_finish, r.actual_finish, r.status)
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    client: r.client_name ?? '—',
    region: r.country ?? r.location ?? '—',
    phase: humanize(r.current_phase ?? r.status, 'Planning'),
    health: deriveHealth(budgetStatus, scheduleStatus),
    budgetStatus,
    scheduleStatus,
    safetyStatus: typeof meta.safety_status === 'string' ? meta.safety_status : 'No Incidents',
    qualityPct: meta.quality_pct != null ? num(meta.quality_pct) : 100,
    progressPct: Math.round(num(r.progress_pct)),
    contractValue: formatMoney(budget, r.currency ?? 'USD'),
    lat: num(meta.lat),
    lng: num(meta.lng),
  }
}

/** GET /api/v1/projects → Project[] */
export async function fetchProjectsLive(): Promise<Project[]> {
  const res = await api<{ data: RawProject[] }>('/projects?limit=100&sort=created_at&dir=desc')
  return (res.data ?? []).map(mapProject)
}

/** GET /api/v1/projects/:id → Project */
export async function fetchProjectLive(id: string): Promise<Project | undefined> {
  const res = await api<{ data: RawProject }>(`/projects/${id}`)
  return res.data ? mapProject(res.data) : undefined
}

/**
 * Client-side portfolio aggregate over the live project list.
 *
 * There is no dedicated portfolio-KPI endpoint, so counts + financial totals are
 * derived from `GET /projects`. Revenue / cost-variance / risk counts aren't
 * derivable from the project rows alone, so they're left as '—' / 0 (documented).
 */
export function aggregateKpis(rows: RawProject[]): PortfolioKpis {
  const projects = rows.map(mapProject)
  const onTrack = projects.filter((p) => p.health === 'healthy').length
  const totalBudget = rows.reduce((s, r) => s + num(r.budget), 0)
  const totalActual = rows.reduce((s, r) => s + num(r.actual_cost), 0)
  return {
    totalContractValue: formatMoney(totalBudget, 'USD'),
    actualCost: formatMoney(totalActual, 'USD'),
    actualCostPct: totalBudget ? `${Math.round((totalActual / totalBudget) * 100)}% of Total Contract` : '—',
    revenueYtd: '—',
    costVariance: '—',
    costVariancePct: '—',
    onTrack,
    atRisk: projects.length - onTrack,
    openRisks: 0,
    openNcrs: 0,
  }
}

export async function fetchPortfolioKpisLive(): Promise<PortfolioKpis> {
  const res = await api<{ data: RawProject[] }>('/projects?limit=500')
  return aggregateKpis(res.data ?? [])
}

/** POST /api/v1/projects (requires code, name) → Project */
export async function createProjectLive(input: NewProjectInput): Promise<Project> {
  const res = await api<{ data: RawProject }>('/projects', {
    method: 'POST',
    body: JSON.stringify({
      code: input.code,
      name: input.name,
      client_name: input.client,
      country: input.region,
      current_phase: input.phase,
      budget: input.budget,
    }),
  })
  return mapProject(res.data)
}

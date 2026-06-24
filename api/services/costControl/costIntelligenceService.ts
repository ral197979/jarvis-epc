/**
 * Denver Engineering — Cost Intelligence (v4.54.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Cost Intelligence (vision Phase 6 — "explain budget drift, overrun risks,
 * forecast changes"). For a project it produces, deterministically and grounded
 * in real data (project financials + change orders):
 *   • cost position — budget → revised budget (approved COs) → forecast → variance
 *   • drift drivers — the cited causes of the change (approved COs, forecast
 *                     overrun, pending COs, contingency pressure)
 *   • overrunRisk   — low / medium / high with recommendations
 *
 * `analyzeCostIntelligence` is a PURE function over fetched rows — the numbers and
 * the explanation are templated over real figures, never an LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectFin {
  id: string; code?: string | null; name?: string | null
  budget?: unknown; committed_cost?: unknown; actual_cost?: unknown; forecast_cost?: unknown; contingency_pct?: unknown
}
export interface ChangeOrderRow { co_number?: number; title?: string; status?: string; cost_impact?: unknown; schedule_impact_days?: number | null }

export interface CostDriver { label: string; amount: number; detail: string; tone: 'increase' | 'decrease' | 'neutral' }
export interface CostPosition {
  budget: number; approvedCoTotal: number; revisedBudget: number
  committed: number; actual: number; forecast: number
  variance: number; variancePct: number
  pendingCoTotal: number; contingency: number
}
export interface CostIntelligence {
  project: { id: string; code: string | null; name: string | null }
  generatedAt: string
  headline: string
  position: CostPosition
  drivers: CostDriver[]
  topChangeOrders: { coNumber: number | null; title: string; costImpact: number; status: string }[]
  overrunRisk: 'low' | 'medium' | 'high'
  recommendations: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number { if (v == null) return 0; const n = typeof v === 'number' ? v : Number(v); return isNaN(n) ? 0 : n }
const r2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeCostIntelligence(project: ProjectFin, changeOrders: ChangeOrderRow[]): CostIntelligence {
  const budget = num(project.budget)
  const approved = changeOrders.filter(c => (c.status ?? '').toLowerCase() === 'approved')
  const pending = changeOrders.filter(c => (c.status ?? '').toLowerCase() === 'submitted')
  const approvedCoTotal = r2(approved.reduce((s, c) => s + num(c.cost_impact), 0))
  const pendingCoTotal = r2(pending.reduce((s, c) => s + num(c.cost_impact), 0))
  const revisedBudget = r2(budget + approvedCoTotal)
  const committed = num(project.committed_cost)
  const actual = num(project.actual_cost)
  const forecast = num(project.forecast_cost) || revisedBudget
  const variance = r2(forecast - revisedBudget)
  const variancePct = revisedBudget > 0 ? r2((variance / revisedBudget) * 100) : 0
  const contingency = r2(budget * num(project.contingency_pct) / 100)

  const position: CostPosition = { budget: r2(budget), approvedCoTotal, revisedBudget, committed: r2(committed), actual: r2(actual), forecast: r2(forecast), variance, variancePct, pendingCoTotal, contingency }

  // ── Drift drivers (cited) ──
  const drivers: CostDriver[] = []
  const topChangeOrders = [...changeOrders]
    .filter(c => num(c.cost_impact) !== 0)
    .sort((a, b) => Math.abs(num(b.cost_impact)) - Math.abs(num(a.cost_impact)))
    .slice(0, 5)
    .map(c => ({ coNumber: c.co_number ?? null, title: c.title ?? '', costImpact: r2(num(c.cost_impact)), status: c.status ?? 'draft' }))

  if (approvedCoTotal !== 0) {
    const top = approved.slice().sort((a, b) => Math.abs(num(b.cost_impact)) - Math.abs(num(a.cost_impact))).slice(0, 3)
      .map(c => `CO-${c.co_number ?? '?'} ${money(num(c.cost_impact))}`).join(', ')
    drivers.push({ label: 'Approved change orders', amount: approvedCoTotal, tone: approvedCoTotal >= 0 ? 'increase' : 'decrease',
      detail: `${approved.length} approved CO${approved.length === 1 ? '' : 's'} moved the budget by ${money(approvedCoTotal)} (${top}).` })
  }
  if (variance > 0) {
    drivers.push({ label: 'Forecast over revised budget', amount: variance, tone: 'increase',
      detail: `Forecast ${money(forecast)} exceeds the revised budget ${money(revisedBudget)} by ${variancePct}%.` })
  } else if (variance < 0) {
    drivers.push({ label: 'Forecast under revised budget', amount: variance, tone: 'decrease',
      detail: `Forecast ${money(forecast)} is ${money(-variance)} under the revised budget.` })
  }
  if (pendingCoTotal !== 0) {
    drivers.push({ label: 'Pending change orders', amount: pendingCoTotal, tone: pendingCoTotal >= 0 ? 'increase' : 'decrease',
      detail: `${pending.length} unapproved CO${pending.length === 1 ? '' : 's'} worth ${money(pendingCoTotal)} are not yet in the budget.` })
  }
  const exposure = Math.max(0, variance) + Math.max(0, pendingCoTotal)
  if (contingency > 0 && exposure > 0) {
    drivers.push({ label: 'Contingency pressure', amount: r2(exposure), tone: exposure > contingency ? 'increase' : 'neutral',
      detail: exposure > contingency
        ? `Overrun + pending exposure ${money(exposure)} exceeds the ${money(contingency)} contingency.`
        : `Overrun + pending exposure ${money(exposure)} is within the ${money(contingency)} contingency.` })
  }

  // ── Overrun risk ──
  const overBudget = variancePct > 0
  const overrunRisk: CostIntelligence['overrunRisk'] =
    (variancePct >= 5 || (contingency > 0 && exposure > contingency)) ? 'high'
    : (overBudget || pendingCoTotal > 0) ? 'medium' : 'low'

  // ── Recommendations ──
  const recommendations: string[] = []
  if (variance > 0) recommendations.push('Build a cost-recovery plan or process a change order to fund the overrun.')
  if (pendingCoTotal > 0) recommendations.push('Resolve the pending change orders so the forecast reflects committed scope.')
  if (contingency > 0 && exposure > contingency) recommendations.push('Escalate — exposure exceeds available contingency.')
  if (recommendations.length === 0) recommendations.push('Cost is under control; continue tracking committed vs forecast.')

  const headline = overBudget
    ? `Forecast ${money(forecast)} is ${variancePct}% over the revised budget of ${money(revisedBudget)}` +
      (approvedCoTotal !== 0 ? `, after ${money(approvedCoTotal)} of approved change orders.` : '.')
    : budget > 0
      ? `Forecast ${money(forecast)} is within the revised budget of ${money(revisedBudget)}.`
      : 'No budget set for this project.'

  return {
    project: { id: project.id, code: project.code ?? null, name: project.name ?? null },
    generatedAt: new Date().toISOString(),
    headline, position, drivers, topChangeOrders, overrunRisk, recommendations,
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildCostIntelligence(tenantId: string, projectId: string): Promise<CostIntelligence | null> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id, code, name, budget, committed_cost, actual_cost, forecast_cost, contingency_pct
       FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  const project = projRes.rows[0] as ProjectFin | undefined
  if (!project) return null

  const cos = await tenantQuery(tenantId,
    `SELECT co_number, title, status, cost_impact, schedule_impact_days
       FROM change_orders WHERE tenant_id=$1 AND project_id=$2 LIMIT 2000`, [tenantId, projectId])

  return analyzeCostIntelligence(project, cos.rows as ChangeOrderRow[])
}

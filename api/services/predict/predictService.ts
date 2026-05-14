/**
 * Denver Engineering — Predict Service (v10.15.0)
 *
 * Statistical prediction engine over existing EVM + project data.
 * No ML models — uses linear regression on time-series snapshots,
 * composite health scoring, and anomaly detection heuristics.
 *
 * Health score (0–100):
 *   CPI component    40%  — cpi >= 1.0 → 100, cpi <= 0.7 → 0, linear between
 *   SPI component    30%  — same scale
 *   Budget burn      20%  — (acwp/revisedBudget) vs expected at this point
 *   CO risk          10%  — pending CO value as % of budget
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'green' | 'amber' | 'red' | 'unknown'

export interface SnapshotPoint {
  date:  string
  acwp:  number
  bcwp:  number
  bcws:  number
  eac:   number
  cpi:   number
  spi:   number
}

export interface EacForecast {
  slope:          number   // $ per day
  r2:             number   // goodness of fit (0-1)
  projectedEac:   number   // extrapolated 30d out
  trend:          'improving' | 'worsening' | 'stable' | 'insufficient_data'
  forecastPoints: { date: string; eac: number }[]  // last 12 actuals + 4 future
}

export interface ProjectHealth {
  projectId:       string
  projectName:     string
  status:          string
  healthScore:     number      // 0–100
  riskLevel:       RiskLevel
  cpi:             number | null
  spi:             number | null
  cpiTrend:        'improving' | 'worsening' | 'stable' | 'insufficient_data'
  acwp:            number
  revisedBudget:   number
  burnPct:         number
  pendingCoValue:  number
  overdueActions:  number
  snapshotCount:   number
  lastSnapshot:    string | null
  forecast:        EacForecast | null
  anomalies:       string[]
}

export interface PredictSummary {
  projects:       ProjectHealth[]
  portfolioScore: number
  atRisk:         number    // red
  watchlist:      number    // amber
  healthy:        number    // green
  avgCpi:         number
  avgSpi:         number
}

// ─── Linear regression ────────────────────────────────────────────────────────

function linReg(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }

  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)

  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  const yMean  = sumY / n
  const ssTot  = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0)
  const ssRes  = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0)
  const r2     = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0

  return { slope, intercept, r2 }
}

// ─── EAC forecast ─────────────────────────────────────────────────────────────

function buildForecast(snaps: SnapshotPoint[]): EacForecast | null {
  if (snaps.length < 2) return null

  const t0 = new Date(snaps[0].date).getTime()
  const pts = snaps.map(s => ({
    x: (new Date(s.date).getTime() - t0) / 86_400_000,
    y: s.eac,
  }))

  const { slope, intercept, r2 } = linReg(pts)

  // trend: compare first half avg CPI vs second half avg CPI
  const half   = Math.floor(snaps.length / 2)
  const cpiEarly = snaps.slice(0, half).reduce((s, p) => s + p.cpi, 0) / half
  const cpiLate  = snaps.slice(half).reduce((s, p) => s + p.cpi, 0) / (snaps.length - half)
  const delta    = cpiLate - cpiEarly
  const trend: EacForecast['trend'] =
    snaps.length < 3      ? 'insufficient_data'
    : Math.abs(delta) < 0.02 ? 'stable'
    : delta > 0              ? 'improving'
    :                          'worsening'

  const lastX   = pts[pts.length - 1].x
  const proj30  = slope * (lastX + 30) + intercept

  // Build forecast points: last 12 actuals + 4 projected (every 7d)
  const forecastPoints: { date: string; eac: number }[] = snaps.slice(-12).map(s => ({
    date: s.date,
    eac:  s.eac,
  }))
  const lastDate = new Date(snaps[snaps.length - 1].date)
  for (let i = 1; i <= 4; i++) {
    const d = new Date(lastDate)
    d.setDate(d.getDate() + i * 7)
    const xFuture = (d.getTime() - t0) / 86_400_000
    forecastPoints.push({ date: d.toISOString().slice(0,10), eac: Math.max(0, slope * xFuture + intercept) })
  }

  return { slope, r2, projectedEac: Math.max(0, proj30), trend, forecastPoints }
}

// ─── Health score ─────────────────────────────────────────────────────────────

function calcHealthScore(
  cpi: number | null, spi: number | null,
  burnPct: number, pendingCoPct: number, overdueActions: number,
): number {
  // CPI component (40 pts)
  let cpiScore = 50
  if (cpi !== null) {
    cpiScore = cpi >= 1.0 ? 100 : cpi <= 0.70 ? 0 : ((cpi - 0.70) / 0.30) * 100
  }

  // SPI component (30 pts)
  let spiScore = 50
  if (spi !== null) {
    spiScore = spi >= 1.0 ? 100 : spi <= 0.70 ? 0 : ((spi - 0.70) / 0.30) * 100
  }

  // Burn rate component (20 pts) — penalise if burning faster than linear expectation
  // Simple proxy: if burnPct > 100 → 0, if < 80 → 100, linear between
  const burnScore = burnPct >= 100 ? 0 : burnPct <= 80 ? 100 : ((100 - burnPct) / 20) * 100

  // CO risk component (10 pts) — pending COs as % of budget
  const coScore = pendingCoPct >= 15 ? 0 : pendingCoPct <= 0 ? 100 : ((15 - pendingCoPct) / 15) * 100

  // Overdue actions penalty (up to -15 pts)
  const actionPenalty = Math.min(overdueActions * 3, 15)

  const raw = 0.40 * cpiScore + 0.30 * spiScore + 0.20 * burnScore + 0.10 * coScore - actionPenalty
  return Math.max(0, Math.min(100, Math.round(raw)))
}

function riskLevel(score: number): RiskLevel {
  if (score >= 70) return 'green'
  if (score >= 45) return 'amber'
  return 'red'
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

function detectAnomalies(snaps: SnapshotPoint[], overdueActions: number, pendingCoPct: number): string[] {
  const flags: string[] = []

  if (snaps.length >= 2) {
    // ACWP spike: last period increase > 2× average weekly increase
    const acwpDiffs = snaps.slice(1).map((s, i) => s.acwp - snaps[i].acwp)
    const avgDiff   = acwpDiffs.slice(0, -1).reduce((s, d) => s + d, 0) / Math.max(acwpDiffs.length - 1, 1)
    const lastDiff  = acwpDiffs[acwpDiffs.length - 1]
    if (avgDiff > 0 && lastDiff > avgDiff * 2.5) flags.push('ACWP spike detected in latest period')

    // CPI declining 3+ consecutive snapshots
    const cpis = snaps.slice(-4).map(s => s.cpi)
    if (cpis.length >= 3 && cpis.every((c, i) => i === 0 || c < cpis[i-1])) {
      flags.push('CPI declining for 3+ consecutive periods')
    }

    // EAC growing faster than budget
    const latest = snaps[snaps.length - 1]
    if (latest.eac > 0 && latest.cpi < 0.85) flags.push('CPI below 0.85 — cost overrun likely')
    if (latest.spi < 0.85) flags.push('SPI below 0.85 — schedule slippage likely')
  }

  if (overdueActions >= 5)  flags.push(`${overdueActions} overdue action items`)
  if (pendingCoPct >= 10)   flags.push(`Pending change orders = ${Math.round(pendingCoPct)}% of budget`)

  return flags
}

// ─── Main query ───────────────────────────────────────────────────────────────

export async function getProjectHealth(tenantId: string, projectId: string): Promise<ProjectHealth | null> {
  // Project info
  const projRes = await tenantQuery(tenantId, `
    SELECT id, name, status FROM projects WHERE tenant_id=$1 AND id=$2
  `, [tenantId, projectId])
  if (!projRes.rows.length) return null
  const proj = projRes.rows[0] as Record<string, unknown>

  // EVM snapshots (chronological)
  const snapRes = await tenantQuery(tenantId, `
    SELECT snapshot_date, acwp, bcwp, bcws, eac, cpi, spi
    FROM   evm_snapshots
    WHERE  tenant_id=$1 AND project_id=$2
    ORDER  BY snapshot_date ASC
    LIMIT  24
  `, [tenantId, projectId])

  const snaps: SnapshotPoint[] = (snapRes.rows as Record<string, unknown>[]).map(r => ({
    date: r['snapshot_date'] as string,
    acwp: Number(r['acwp']),
    bcwp: Number(r['bcwp']),
    bcws: Number(r['bcws']),
    eac:  Number(r['eac']),
    cpi:  Number(r['cpi']),
    spi:  Number(r['spi']),
  }))

  const latest = snaps.length ? snaps[snaps.length - 1] : null

  // Revised budget
  const budgetRes = await tenantQuery(tenantId, `
    SELECT
      COALESCE((SELECT bac FROM evm_baselines WHERE tenant_id=$1 AND project_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1), 0) AS bac,
      COALESCE(SUM(cost_impact) FILTER (WHERE status='approved'), 0)  AS approved_co,
      COALESCE(SUM(cost_impact) FILTER (WHERE status='submitted'), 0) AS pending_co
    FROM change_orders
    WHERE tenant_id=$1 AND project_id=$2 AND status NOT IN ('void','rejected')
  `, [tenantId, projectId])

  const bRow          = budgetRes.rows[0] as Record<string, unknown>
  const bac           = Number(bRow['bac'])
  const approvedCo    = Number(bRow['approved_co'])
  const pendingCoVal  = Number(bRow['pending_co'])
  const revisedBudget = bac + approvedCo
  const acwp          = latest?.acwp ?? 0
  const burnPct       = revisedBudget > 0 ? (acwp / revisedBudget) * 100 : 0
  const pendingCoPct  = revisedBudget > 0 ? (pendingCoVal / revisedBudget) * 100 : 0

  // Overdue actions
  const actionRes = await tenantQuery(tenantId, `
    SELECT COUNT(*)::int AS cnt FROM action_items
    WHERE tenant_id=$1 AND project_id=$2
      AND due_date < CURRENT_DATE AND status NOT IN ('done','closed','cancelled')
  `, [tenantId, projectId])
  const overdueActions = Number((actionRes.rows[0] as Record<string, unknown>)['cnt'] ?? 0)

  const cpi = latest?.cpi ?? null
  const spi = latest?.spi ?? null
  const healthScore = calcHealthScore(cpi, spi, burnPct, pendingCoPct, overdueActions)
  const forecast    = buildForecast(snaps)

  // CPI trend
  let cpiTrend: ProjectHealth['cpiTrend'] = 'insufficient_data'
  if (snaps.length >= 3) {
    const half     = Math.floor(snaps.length / 2)
    const early    = snaps.slice(0, half).reduce((s, p) => s + p.cpi, 0) / half
    const late     = snaps.slice(half).reduce((s, p) => s + p.cpi, 0) / (snaps.length - half)
    const d        = late - early
    cpiTrend = Math.abs(d) < 0.02 ? 'stable' : d > 0 ? 'improving' : 'worsening'
  }

  const anomalies = detectAnomalies(snaps, overdueActions, pendingCoPct)

  return {
    projectId:      projectId,
    projectName:    proj['name'] as string,
    status:         proj['status'] as string,
    healthScore,
    riskLevel:      riskLevel(healthScore),
    cpi:            cpi !== null ? Math.round(cpi * 1000) / 1000 : null,
    spi:            spi !== null ? Math.round(spi * 1000) / 1000 : null,
    cpiTrend,
    acwp,
    revisedBudget,
    burnPct:        Math.round(burnPct),
    pendingCoValue: pendingCoVal,
    overdueActions,
    snapshotCount:  snaps.length,
    lastSnapshot:   latest?.date ?? null,
    forecast,
    anomalies,
  }
}

export async function getAllProjectHealth(tenantId: string): Promise<PredictSummary> {
  const projRes = await tenantQuery(tenantId, `
    SELECT id FROM projects WHERE tenant_id=$1 AND status NOT IN ('closed','archived')
    ORDER BY created_at DESC LIMIT 30
  `, [tenantId])

  const projects: ProjectHealth[] = []
  for (const row of projRes.rows as Record<string, unknown>[]) {
    try {
      const h = await getProjectHealth(tenantId, row['id'] as string)
      if (h) projects.push(h)
    } catch { /* skip */ }
  }

  const scored = projects.filter(p => p.riskLevel !== 'unknown')
  const portfolioScore = scored.length
    ? Math.round(scored.reduce((s, p) => s + p.healthScore, 0) / scored.length)
    : 0

  const withCpi = projects.filter(p => p.cpi !== null)
  const withSpi = projects.filter(p => p.spi !== null)

  return {
    projects,
    portfolioScore,
    atRisk:    projects.filter(p => p.riskLevel === 'red').length,
    watchlist: projects.filter(p => p.riskLevel === 'amber').length,
    healthy:   projects.filter(p => p.riskLevel === 'green').length,
    avgCpi:    withCpi.length ? Math.round(withCpi.reduce((s, p) => s + p.cpi!, 0) / withCpi.length * 1000) / 1000 : 0,
    avgSpi:    withSpi.length ? Math.round(withSpi.reduce((s, p) => s + p.spi!, 0) / withSpi.length * 1000) / 1000 : 0,
  }
}

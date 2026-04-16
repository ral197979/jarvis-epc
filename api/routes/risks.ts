/**
 * JARVIS EPC — Risks API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.28.0 — Implements the risks table defined in 002_epc_core.sql.
 *
 * risk_score is computed in the DB as: likelihood_value × impact_value (1–25).
 * Risk band:  1–4 Low, 5–9 Medium, 10–16 High, 17–25 Critical.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/risks     — list (filterable)
 *   POST   /api/v1/projects/:projectId/risks     — create
 *   GET    /api/v1/risks/:id                     — fetch single
 *   PATCH  /api/v1/risks/:id                     — update
 *   DELETE /api/v1/risks/:id                     — close / delete
 *   GET    /api/v1/projects/:projectId/risks/matrix  — 5×5 heatmap data
 *   GET    /api/v1/projects/:projectId/risks/stats   — summary stats
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { tenantQuery }                             from '../db/pool'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant() as any)

// ─── Enums matching DB schema ─────────────────────────────────────────────────

const LIKELIHOOD_VALUES = ['rare','unlikely','possible','likely','almost_certain'] as const
const IMPACT_VALUES     = ['negligible','minor','moderate','major','catastrophic'] as const
type Likelihood = typeof LIKELIHOOD_VALUES[number]
type Impact     = typeof IMPACT_VALUES[number]

const LIKELIHOOD_SCORE: Record<Likelihood, number> = {
  rare: 1, unlikely: 2, possible: 3, likely: 4, almost_certain: 5,
}
const IMPACT_SCORE: Record<Impact, number> = {
  negligible: 1, minor: 2, moderate: 3, major: 4, catastrophic: 5,
}

function riskBand(score: number): string {
  if (score <= 4)  return 'low'
  if (score <= 9)  return 'medium'
  if (score <= 16) return 'high'
  return 'critical'
}

// ─── GET /api/v1/projects/:projectId/risks ────────────────────────────────────

router.get('/projects/:projectId/risks', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const {
    status,
    category,
    min_score,
    limit  = '50',
    offset = '0',
  } = req.query

  const params: unknown[] = [r.tenantId, projectId]
  const filters: string[] = []

  if (status)    { params.push(status);    filters.push(`r.status = $${params.length}`) }
  if (category)  { params.push(`%${category}%`); filters.push(`r.category ILIKE $${params.length}`) }
  if (min_score) { params.push(parseInt(min_score as string)); filters.push(`r.risk_score >= $${params.length}`) }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(parseInt(limit as string), parseInt(offset as string))

  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT r.id, r.risk_number, r.title, r.description, r.category,
              r.likelihood, r.impact, r.risk_score, r.mitigation, r.contingency,
              r.status, r.closed_at, r.created_at, r.updated_at, r.metadata,
              u.name AS owner_name
       FROM risks r
       LEFT JOIN users u ON u.id = r.owner
       WHERE r.tenant_id = $1 AND r.project_id = $2 ${where}
       ORDER BY r.risk_score DESC, r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const rows = result.rows.map(row => ({ ...row, band: riskBand(row.risk_score) }))
    res.json({ risks: rows, total: result.rowCount })
  } catch (e: unknown) {
    console.error('[risks] list error', e)
    res.status(500).json({ error: 'Failed to list risks' })
  }
})

// ─── POST /api/v1/projects/:projectId/risks ───────────────────────────────────

router.post('/projects/:projectId/risks', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const {
    title, description, category,
    likelihood = 'possible',
    impact     = 'moderate',
    mitigation, contingency, owner, metadata,
  } = req.body

  if (!title) return res.status(400).json({ error: 'title required' })
  if (!LIKELIHOOD_VALUES.includes(likelihood))
    return res.status(400).json({ error: `likelihood must be one of: ${LIKELIHOOD_VALUES.join(', ')}` })
  if (!IMPACT_VALUES.includes(impact))
    return res.status(400).json({ error: `impact must be one of: ${IMPACT_VALUES.join(', ')}` })

  // Auto-generate risk_number: RSK-001, RSK-002 …
  const countRes = await tenantQuery(r.tenantId,
    'SELECT COUNT(*) AS n FROM risks WHERE tenant_id=$1 AND project_id=$2',
    [r.tenantId, projectId]
  )
  const n = parseInt(countRes.rows[0]?.n ?? '0') + 1
  const risk_number = `RSK-${String(n).padStart(3, '0')}`

  try {
    const result = await tenantQuery(r.tenantId,
      `INSERT INTO risks
         (tenant_id, project_id, risk_number, title, description, category,
          likelihood, impact, mitigation, contingency, owner, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, risk_number, title, likelihood, impact, risk_score, status, created_at`,
      [r.tenantId, projectId, risk_number, title,
       description ?? null, category ?? null,
       likelihood, impact,
       mitigation ?? null, contingency ?? null,
       owner ?? null,
       metadata ? JSON.stringify(metadata) : '{}']
    )
    const row = result.rows[0]
    res.status(201).json({ risk: { ...row, band: riskBand(row.risk_score) } })
  } catch (e: unknown) {
    console.error('[risks] create error', e)
    res.status(500).json({ error: 'Failed to create risk' })
  }
})

// ─── GET /api/v1/risks/:id ────────────────────────────────────────────────────

router.get('/risks/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT r.*, u.name AS owner_name
       FROM risks r LEFT JOIN users u ON u.id = r.owner
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [req.params.id, r.tenantId]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Risk not found' })
    res.json({ risk: { ...result.rows[0], band: riskBand(result.rows[0].risk_score) } })
  } catch (e: unknown) {
    res.status(500).json({ error: 'Failed to fetch risk' })
  }
})

// ─── PATCH /api/v1/risks/:id ──────────────────────────────────────────────────

router.patch('/risks/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title','description','category','likelihood','impact','mitigation','contingency','status','owner','metadata']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields provided' })

  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values     = updates.map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : v)

  // Close timestamp if status → closed
  const statusUpdate = updates.find(([k]) => k === 'status')
  if (statusUpdate && statusUpdate[1] === 'closed') {
    setClauses.push(`closed_at = NOW()`)
  }
  setClauses.push(`updated_at = NOW()`)

  try {
    const result = await tenantQuery(r.tenantId,
      `UPDATE risks SET ${setClauses.join(', ')}
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, risk_number, title, likelihood, impact, risk_score, status, updated_at`,
      [req.params.id, r.tenantId, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Risk not found' })
    res.json({ risk: { ...result.rows[0], band: riskBand(result.rows[0].risk_score) } })
  } catch (e: unknown) {
    res.status(500).json({ error: 'Failed to update risk' })
  }
})

// ─── DELETE /api/v1/risks/:id ─────────────────────────────────────────────────

router.delete('/risks/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId,
      'DELETE FROM risks WHERE id=$1 AND tenant_id=$2',
      [req.params.id, r.tenantId]
    )
    res.json({ deleted: true })
  } catch (e: unknown) {
    res.status(500).json({ error: 'Failed to delete risk' })
  }
})

// ─── GET /api/v1/projects/:projectId/risks/matrix — 5×5 heatmap data ─────────

router.get('/projects/:projectId/risks/matrix', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params

  try {
    const result = await tenantQuery(r.tenantId,
      `SELECT likelihood, impact, COUNT(*) AS count, AVG(risk_score)::numeric(5,1) AS avg_score
       FROM risks
       WHERE tenant_id=$1 AND project_id=$2 AND status != 'closed'
       GROUP BY likelihood, impact`,
      [r.tenantId, projectId]
    )

    // Build 5×5 matrix: matrix[likelihood][impact] = { count, avg_score }
    const matrix: Record<string, Record<string, { count: number; avg_score: number }>> = {}
    for (const l of LIKELIHOOD_VALUES) {
      matrix[l] = {}
      for (const im of IMPACT_VALUES) matrix[l][im] = { count: 0, avg_score: 0 }
    }
    for (const row of result.rows) {
      if (matrix[row.likelihood]?.[row.impact]) {
        matrix[row.likelihood][row.impact] = {
          count: parseInt(row.count),
          avg_score: parseFloat(row.avg_score),
        }
      }
    }

    // Compute risk band scores for cell colouring
    const scoredMatrix = LIKELIHOOD_VALUES.map(l =>
      IMPACT_VALUES.map(im => ({
        likelihood: l,
        impact:     im,
        score:      LIKELIHOOD_SCORE[l] * IMPACT_SCORE[im],
        band:       riskBand(LIKELIHOOD_SCORE[l] * IMPACT_SCORE[im]),
        ...matrix[l][im],
      }))
    )

    res.json({
      matrix: scoredMatrix,
      likelihood_labels: LIKELIHOOD_VALUES,
      impact_labels:     IMPACT_VALUES,
    })
  } catch (e: unknown) {
    res.status(500).json({ error: 'Failed to build risk matrix' })
  }
})

// ─── GET /api/v1/projects/:projectId/risks/stats ──────────────────────────────

router.get('/projects/:projectId/risks/stats', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params

  try {
    const [summary, byBand, recent] = await Promise.all([
      tenantQuery(r.tenantId,
        `SELECT COUNT(*) FILTER (WHERE status='open') AS open,
                COUNT(*) FILTER (WHERE status='closed') AS closed,
                COUNT(*) FILTER (WHERE risk_score >= 17) AS critical,
                COUNT(*) FILTER (WHERE risk_score BETWEEN 10 AND 16) AS high,
                AVG(risk_score)::numeric(5,1) AS avg_score
         FROM risks WHERE tenant_id=$1 AND project_id=$2`,
        [r.tenantId, projectId]
      ),
      tenantQuery(r.tenantId,
        `SELECT
           COUNT(*) FILTER (WHERE risk_score <= 4)  AS low,
           COUNT(*) FILTER (WHERE risk_score BETWEEN 5 AND 9) AS medium,
           COUNT(*) FILTER (WHERE risk_score BETWEEN 10 AND 16) AS high,
           COUNT(*) FILTER (WHERE risk_score >= 17) AS critical
         FROM risks WHERE tenant_id=$1 AND project_id=$2 AND status='open'`,
        [r.tenantId, projectId]
      ),
      tenantQuery(r.tenantId,
        `SELECT id, risk_number, title, risk_score, likelihood, impact, status, updated_at
         FROM risks WHERE tenant_id=$1 AND project_id=$2
         ORDER BY risk_score DESC, updated_at DESC LIMIT 5`,
        [r.tenantId, projectId]
      ),
    ])

    res.json({
      summary:     summary.rows[0],
      by_band:     byBand.rows[0],
      top_risks:   recent.rows.map(r => ({ ...r, band: riskBand(r.risk_score) })),
    })
  } catch (e: unknown) {
    res.status(500).json({ error: 'Failed to fetch risk stats' })
  }
})

export { router as risksRouter }

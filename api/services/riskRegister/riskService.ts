/**
 * Denver Engineering — Risk Register Service (v10.17.0)
 */
import { tenantQuery } from '../../db/pool'

export type RiskStatus   = 'open' | 'mitigating' | 'accepted' | 'closed' | 'occurred'
export type RiskCategory =
  | 'schedule' | 'cost' | 'scope' | 'safety' | 'technical'
  | 'regulatory' | 'environmental' | 'procurement' | 'force_majeure' | 'other'

export interface Risk {
  id:                    string
  tenantId:              string
  projectId:             string
  riskNumber:            number
  title:                 string
  description:           string | null
  category:              RiskCategory
  status:                RiskStatus
  probability:           number
  impact:                number
  riskScore:             number
  residualProbability:   number | null
  residualImpact:        number | null
  residualScore:         number
  costExposure:          number | null
  owner:                 string | null
  mitigationPlan:        string | null
  contingencyPlan:       string | null
  identifiedDate:        string
  targetDate:            string | null
  closedDate:            string | null
  createdBy:             string | null
  createdAt:             string
  updatedAt:             string
}

export interface RiskSummary {
  total:      number
  open:       number
  mitigating: number
  accepted:   number
  closed:     number
  occurred:   number
  critical:   number   // score >= 15
  high:       number   // score 9-14
  medium:     number   // score 4-8
  low:        number   // score 1-3
  totalExposure: number
}

function rowToRisk(r: Record<string, unknown>): Risk {
  return {
    id:                    r['id']                    as string,
    tenantId:              r['tenant_id']              as string,
    projectId:             r['project_id']             as string,
    riskNumber:            Number(r['risk_number']),
    title:                 r['title']                  as string,
    description:           r['description']            as string | null,
    category:              r['category']               as RiskCategory,
    status:                r['status']                 as RiskStatus,
    probability:           Number(r['probability']),
    impact:                Number(r['impact']),
    riskScore:             Number(r['risk_score']),
    residualProbability:   r['residual_probability'] !== null ? Number(r['residual_probability']) : null,
    residualImpact:        r['residual_impact']      !== null ? Number(r['residual_impact'])      : null,
    residualScore:         Number(r['residual_score']),
    costExposure:          r['cost_exposure'] !== null ? Number(r['cost_exposure']) : null,
    owner:                 r['owner']                  as string | null,
    mitigationPlan:        r['mitigation_plan']        as string | null,
    contingencyPlan:       r['contingency_plan']       as string | null,
    identifiedDate:        r['identified_date']        as string,
    targetDate:            r['target_date']            as string | null,
    closedDate:            r['closed_date']            as string | null,
    createdBy:             r['created_by']             as string | null,
    createdAt:             r['created_at']             as string,
    updatedAt:             r['updated_at']             as string,
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateRiskInput {
  title:               string
  description?:        string
  category:            RiskCategory
  probability:         number
  impact:              number
  costExposure?:       number
  owner?:              string
  mitigationPlan?:     string
  contingencyPlan?:    string
  identifiedDate?:     string
  targetDate?:         string
  createdBy?:          string
}

export async function createRisk(tenantId: string, projectId: string, input: CreateRiskInput): Promise<Risk> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO risks
      (tenant_id, project_id, risk_number, title, description, category,
       probability, impact, cost_exposure, owner, mitigation_plan, contingency_plan,
       identified_date, target_date, created_by)
    VALUES (
      $1, $2,
      COALESCE((SELECT MAX(risk_number) FROM risks WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
      $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    )
    RETURNING *
  `, [tenantId, projectId,
      input.title, input.description ?? null, input.category,
      input.probability, input.impact,
      input.costExposure    ?? null, input.owner           ?? null,
      input.mitigationPlan  ?? null, input.contingencyPlan ?? null,
      input.identifiedDate  ?? null, input.targetDate       ?? null,
      input.createdBy       ?? null])
  return rowToRisk(res.rows[0] as Record<string, unknown>)
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listRisks(
  tenantId:  string,
  projectId: string,
  opts:      { status?: RiskStatus; category?: RiskCategory } = {},
): Promise<Risk[]> {
  const conditions = ['tenant_id = $1', 'project_id = $2']
  const params: unknown[] = [tenantId, projectId]
  let idx = 3

  if (opts.status)   { conditions.push(`status   = $${idx++}`); params.push(opts.status)   }
  if (opts.category) { conditions.push(`category = $${idx++}`); params.push(opts.category) }

  const res = await tenantQuery(tenantId, `
    SELECT * FROM risks
    WHERE ${conditions.join(' AND ')}
    ORDER BY risk_score DESC, risk_number ASC
  `, params)
  return res.rows.map(r => rowToRisk(r as Record<string, unknown>))
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getRisk(tenantId: string, id: string): Promise<Risk | null> {
  const res = await tenantQuery(tenantId, `SELECT * FROM risks WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
  return res.rows.length ? rowToRisk(res.rows[0] as Record<string, unknown>) : null
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateRisk(
  tenantId: string,
  id:       string,
  patch:    Partial<CreateRiskInput & {
    status:              RiskStatus
    residualProbability: number
    residualImpact:      number
    closedDate:          string
  }>,
): Promise<Risk | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE risks SET
      title                = COALESCE($3,  title),
      description          = COALESCE($4,  description),
      category             = COALESCE($5::risk_category, category),
      status               = COALESCE($6::risk_status,   status),
      probability          = COALESCE($7,  probability),
      impact               = COALESCE($8,  impact),
      residual_probability = COALESCE($9,  residual_probability),
      residual_impact      = COALESCE($10, residual_impact),
      cost_exposure        = COALESCE($11, cost_exposure),
      owner                = COALESCE($12, owner),
      mitigation_plan      = COALESCE($13, mitigation_plan),
      contingency_plan     = COALESCE($14, contingency_plan),
      target_date          = COALESCE($15, target_date),
      closed_date          = COALESCE($16, closed_date),
      updated_at           = NOW()
    WHERE tenant_id=$1 AND id=$2
    RETURNING *
  `, [tenantId, id,
      patch.title               ?? null, patch.description        ?? null,
      patch.category            ?? null, patch.status             ?? null,
      patch.probability         ?? null, patch.impact             ?? null,
      patch.residualProbability ?? null, patch.residualImpact     ?? null,
      patch.costExposure        ?? null, patch.owner              ?? null,
      patch.mitigationPlan      ?? null, patch.contingencyPlan    ?? null,
      patch.targetDate          ?? null, patch.closedDate         ?? null])
  return res.rows.length ? rowToRisk(res.rows[0] as Record<string, unknown>) : null
}

// ─── Quick status transitions ─────────────────────────────────────────────────

export async function closeRisk(tenantId: string, id: string): Promise<Risk | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE risks SET status='closed', closed_date=CURRENT_DATE, updated_at=NOW()
    WHERE tenant_id=$1 AND id=$2 AND status NOT IN ('closed','occurred')
    RETURNING *
  `, [tenantId, id])
  return res.rows.length ? rowToRisk(res.rows[0] as Record<string, unknown>) : null
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getRiskSummary(tenantId: string, projectId: string): Promise<RiskSummary> {
  const res = await tenantQuery(tenantId, `
    SELECT
      COUNT(*)::int                                                    AS total,
      COUNT(*) FILTER (WHERE status='open')::int                      AS open,
      COUNT(*) FILTER (WHERE status='mitigating')::int                AS mitigating,
      COUNT(*) FILTER (WHERE status='accepted')::int                  AS accepted,
      COUNT(*) FILTER (WHERE status='closed')::int                    AS closed,
      COUNT(*) FILTER (WHERE status='occurred')::int                  AS occurred,
      COUNT(*) FILTER (WHERE risk_score >= 15)::int                   AS critical,
      COUNT(*) FILTER (WHERE risk_score BETWEEN 9 AND 14)::int        AS high,
      COUNT(*) FILTER (WHERE risk_score BETWEEN 4 AND 8)::int         AS medium,
      COUNT(*) FILTER (WHERE risk_score BETWEEN 1 AND 3)::int         AS low,
      COALESCE(SUM(cost_exposure) FILTER (WHERE status NOT IN ('closed')), 0) AS total_exposure
    FROM risks
    WHERE tenant_id=$1 AND project_id=$2
  `, [tenantId, projectId])

  const r = res.rows[0] as Record<string, unknown>
  return {
    total:         Number(r['total']),
    open:          Number(r['open']),
    mitigating:    Number(r['mitigating']),
    accepted:      Number(r['accepted']),
    closed:        Number(r['closed']),
    occurred:      Number(r['occurred']),
    critical:      Number(r['critical']),
    high:          Number(r['high']),
    medium:        Number(r['medium']),
    low:           Number(r['low']),
    totalExposure: Number(r['total_exposure']),
  }
}

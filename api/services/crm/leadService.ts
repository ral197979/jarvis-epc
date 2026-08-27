/**
 * Denver Engineering — CRM leads (pre-award pipeline)
 * ─────────────────────────────────────────────────────────────────────────────
 * What the audit found, before any of this was written
 * ────────────────────────────────────────────────────
 * `crm_leads` (migration 002) is a real table with tenant RLS. It carries
 * `value NUMERIC` and `probability NUMERIC`, both NULLABLE, and
 * `project_id` nullable with ON DELETE SET NULL — a lead is pre-award and
 * usually precedes any project, so it outlives one.
 *
 * Two findings shape everything below.
 *
 *   `stage` IS NOT A GOVERNED LIFECYCLE. It is a bare VARCHAR(50) with NO CHECK
 *   constraint and no enum — only NOT NULL DEFAULT 'prospecting'. Any string is
 *   a valid stage. This is the decisive difference from `contracts`, whose
 *   `contract_status` enum let Phase 3M define "active" from the schema itself.
 *   Here the schema cannot tell us which stages mean "in the pipeline", so this
 *   module does not pretend otherwise: it never filters by stage, and it
 *   reports `stageGoverned: false` beside the observed distribution.
 *
 *   The dashboard's funnel invents five stages — new, qualified, proposal,
 *   negotiation, won — none of which is in the schema, and none of which is the
 *   table's own default. That funnel is snapshot-derived and is labelled as
 *   such; it is not fed from here.
 *
 *   NO WRITER EXISTS. Nothing in the API inserts or updates a lead, and nothing
 *   reads one either — this is the first reader. So the totals are truthfully
 *   zero until a create surface exists, and `writable: false` says why rather
 *   than letting a zero imply an empty pipeline.
 *
 * Unknown is not zero
 * ───────────────────
 * A weighted pipeline is `Σ value × probability / 100`. A lead with a NULL
 * value or a NULL probability has an UNKNOWN contribution, not a zero one —
 * and the previous dashboard coerced both with `?? 0`, which understates the
 * pipeline by exactly the leads nobody has estimated. The same rule TRIR
 * established applies: the total is withheld while any lead is unvalued, and
 * the count of unvalued leads is always reported so the gap is visible.
 */
import { tenantQuery } from '../../db/pool'

/**
 * The caller's authorization predicate, built at the ROUTE.
 * See the contracts service for why this is not composed here.
 */
export interface CollectionScope {
  sql: string
  params: unknown[]
  nextIndex: number
}

export interface LeadRow {
  id: string
  company: string
  contact_name: string | null
  email: string | null
  stage: string
  value: string | null
  probability: string | null
  source: string | null
  expected_close: string | null
  project_id: string | null
  created_at: string
}

export type PipelineUnavailableReason =
  /** At least one lead has no value or no probability recorded. */
  | 'incomplete_valuation'

export interface LeadSummary {
  /** Σ value × probability / 100, or null while any lead is unvalued. */
  pipelineWeighted: number | null
  reason?: PipelineUnavailableReason
  detail?: string

  /** Leads carrying BOTH a value and a probability. */
  valued: number
  /** Leads missing one or both. Always reported, so the gap is visible. */
  unvalued: number
  total: number

  /**
   * Observed `stage` values and their counts.
   *
   * Descriptive, not authoritative: see `stageGoverned`.
   */
  byStage: Record<string, number>
  /**
   * False — `crm_leads.stage` is an unconstrained VARCHAR. Consumers must not
   * present these as lifecycle states or build a funnel implying an order.
   */
  stageGoverned: boolean

  /** No API route can create a lead. Verified across api/ 2026-08-25. */
  writable: boolean
}

/** `crm_leads.stage` has no CHECK and no enum — any string is valid. */
export const LEAD_STAGE_GOVERNED = false
/** No route creates or updates a `crm_leads` row. */
export const LEADS_WRITABLE = false

const DETAIL: Record<PipelineUnavailableReason, string> = {
  incomplete_valuation:
    'Some leads have no value or no probability recorded.',
}

export async function listLeads(
  tenantId: string,
  scope: CollectionScope,
  opts: { stage?: string; limit?: number } = {},
): Promise<LeadRow[]> {
  const vals: unknown[] = []
  let i = scope.nextIndex
  let where = ''
  // Stage is matched exactly if asked for, but it is never REQUIRED and never
  // defaulted: an ungoverned column cannot carry an implied filter.
  if (opts.stage) { where = `AND l.stage = $${i++}`; vals.push(opts.stage) }
  const j = i

  const res = await tenantQuery<LeadRow>(tenantId, `
    SELECT l.id, l.company, l.contact_name, l.email, l.stage,
           l.value::text, l.probability::text, l.source,
           l.expected_close::text, l.project_id, l.created_at::text
      FROM crm_leads l
     WHERE l.tenant_id = current_setting('app.current_tenant_id', true)::uuid ${where}
     ${scope.sql}
     ORDER BY l.created_at DESC
     LIMIT $${j}
  `, [...scope.params, ...vals, Math.min(500, Math.max(1, opts.limit ?? 200))])

  return res.rows
}

export async function getLead(tenantId: string, id: string): Promise<LeadRow | null> {
  const res = await tenantQuery<LeadRow>(tenantId, `
    SELECT l.id, l.company, l.contact_name, l.email, l.stage,
           l.value::text, l.probability::text, l.source,
           l.expected_close::text, l.project_id, l.created_at::text
      FROM crm_leads l
     WHERE l.id = $1
       AND l.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  return res.rows[0] ?? null
}

/**
 * The dashboard's source for Pipeline (Weighted).
 *
 * `value` and `probability` are counted as PRESENT only when both are non-null.
 * The weighted total is computed over those rows alone and is withheld entirely
 * while any lead is unvalued, because a partial sum reads as a complete one and
 * understates in the direction that flatters the pipeline.
 */
export async function leadSummary(
  tenantId: string, scope: CollectionScope,
): Promise<LeadSummary> {
  const res = await tenantQuery<{
    stage: string; n: string; valued: string; weighted: string
  }>(tenantId, `
    SELECT l.stage,
           COUNT(*)::text AS n,
           COUNT(*) FILTER (WHERE l.value IS NOT NULL AND l.probability IS NOT NULL)::text AS valued,
           -- Honest note: this FILTER is defence in depth, not an independent
           -- control, and the mutation run records it as the one mutant that
           -- stays green. Removing it changes nothing observable — a NULL row
           -- zero-filled contributes 0 to the SUM anyway, and if any lead is
           -- unvalued the refusal below fires before the total is used at all.
           -- It is kept because it states the intent in the query rather than
           -- relying on arithmetic coincidence, and because it stays correct if
           -- the refusal rule is ever relaxed.
           COALESCE(SUM(l.value * l.probability / 100.0)
                    FILTER (WHERE l.value IS NOT NULL AND l.probability IS NOT NULL), 0)::text AS weighted
      FROM crm_leads l
     WHERE l.tenant_id = current_setting('app.current_tenant_id', true)::uuid
     ${scope.sql}
     GROUP BY l.stage
  `, scope.params)

  const byStage: Record<string, number> = {}
  let total = 0
  let valued = 0
  let weighted = 0

  for (const row of res.rows) {
    const n = Number(row.n)
    byStage[row.stage] = n
    total += n
    valued += Number(row.valued)
    weighted += Number(row.weighted)
  }

  const unvalued = total - valued
  const base = {
    valued, unvalued, total, byStage,
    stageGoverned: LEAD_STAGE_GOVERNED,
    writable: LEADS_WRITABLE,
  }

  if (unvalued > 0) {
    return { ...base, pipelineWeighted: null, reason: 'incomplete_valuation', detail: DETAIL.incomplete_valuation }
  }
  return { ...base, pipelineWeighted: weighted }
}

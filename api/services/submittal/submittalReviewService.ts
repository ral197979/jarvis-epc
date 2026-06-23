/**
 * Denver Engineering — Submittal Review Assistant (v4.47.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AI submittal review assistant (vision Phase 4). For a submittal it produces,
 * deterministically and grounded in real data:
 *   • readiness checks — missing data the reviewer needs (spec section, type, …)
 *   • precedent        — similar prior submittals + their review outcome
 *   • suggested reviewer — by discipline/spec-section review history
 *   • deviation risk   — elevated when prior submittals in the spec section were returned
 *
 * NOTE on scope: a true document-vs-spec comparison needs the submitted file and
 * the parsed spec content (not yet modeled). This assistant does the part that is
 * grounded today — readiness, precedent, routing, and risk — without overclaiming.
 * The checks/similarity/risk logic is PURE and unit-tested.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmittalLite {
  id: string; submittal_number?: string; title?: string; type?: string | null
  discipline?: string | null; spec_section?: string | null; status?: string
  submitted_by?: string | null; reviewed_by?: string | null; review_notes?: string | null
  due_date?: string | Date | null
}
export interface ReviewCheck { label: string; status: 'ok' | 'warn' | 'missing'; detail: string }
export interface SimilarSubmittal { id: string; number: string; title: string; status: string; similarity: number; wasReturned: boolean }
export interface SuggestedReviewer { userId: string; reviewed: number }
export interface SubmittalRisk { level: 'high' | 'medium' | 'low'; reasons: string[] }

export interface SubmittalReviewResult {
  submittal: { id: string; number: string; title: string; discipline: string | null; specSection: string | null; status: string }
  checks: ReviewCheck[]
  similar: SimilarSubmittal[]
  suggestedReviewers: SuggestedReviewer[]
  risk: SubmittalRisk
}

const RETURNED = new Set(['revise_resubmit', 'rejected'])
const ACTIVE_REVIEW = new Set(['submitted', 'under_review'])

// ─── Text similarity (pure, local to keep the module self-contained) ──────────

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'shop', 'drawing', 'submittal', 'data', 'product', 'sample'])
function tokenize(text: string | null | undefined): Set<string> {
  if (!text) return new Set()
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w)))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// ─── Pure logic ───────────────────────────────────────────────────────────────

export function reviewChecks(s: SubmittalLite, priorReturnedInSpec: number, now: Date): ReviewCheck[] {
  const checks: ReviewCheck[] = []
  checks.push(s.spec_section
    ? { label: 'Spec section', status: 'ok', detail: `Linked to spec ${s.spec_section}.` }
    : { label: 'Spec section', status: 'missing', detail: 'No spec section — submittal requirements cannot be traced.' })
  checks.push(s.type
    ? { label: 'Submittal type', status: 'ok', detail: `${s.type}.` }
    : { label: 'Submittal type', status: 'warn', detail: 'No type set (shop drawing / product data / sample…).' })
  checks.push(s.submitted_by
    ? { label: 'Submitter', status: 'ok', detail: 'Submitter recorded.' }
    : { label: 'Submitter', status: 'warn', detail: 'No submitter recorded.' })

  const due = s.due_date ? new Date(s.due_date) : null
  const overdue = due && !isNaN(due.getTime()) && ACTIVE_REVIEW.has(s.status ?? '') ? Math.floor((now.getTime() - due.getTime()) / 86_400_000) : null
  checks.push(overdue != null && overdue > 0
    ? { label: 'Review timeliness', status: 'warn', detail: `Review is ${overdue} day${overdue === 1 ? '' : 's'} overdue.` }
    : { label: 'Review timeliness', status: 'ok', detail: 'Within review window.' })

  checks.push(priorReturnedInSpec > 0
    ? { label: 'Spec-section history', status: 'warn', detail: `${priorReturnedInSpec} prior submittal${priorReturnedInSpec === 1 ? '' : 's'} in this spec section ${priorReturnedInSpec === 1 ? 'was' : 'were'} returned — review against those comments.` }
    : { label: 'Spec-section history', status: 'ok', detail: 'No prior returns in this spec section.' })

  return checks
}

export function findSimilarSubmittals(target: SubmittalLite, candidates: SubmittalLite[], limit = 5, minScore = 0.12): SimilarSubmittal[] {
  const tTokens = tokenize(`${target.title ?? ''} ${target.type ?? ''}`)
  return candidates
    .filter(c => c.id !== target.id)
    .map(c => {
      const textSim = jaccard(tTokens, tokenize(`${c.title ?? ''} ${c.type ?? ''}`))
      const specBoost = target.spec_section && c.spec_section === target.spec_section ? 0.3 : 0
      return {
        id: c.id,
        number: c.submittal_number ?? c.id.slice(0, 8),
        title: c.title ?? '',
        status: c.status ?? 'draft',
        similarity: Math.round(Math.min(1, textSim + specBoost) * 100) / 100,
        wasReturned: RETURNED.has(c.status ?? ''),
      }
    })
    .filter(s => s.similarity >= minScore)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export function assessSubmittalRisk(checks: ReviewCheck[], priorReturnedInSpec: number): SubmittalRisk {
  const reasons: string[] = []
  let weight = 0
  for (const c of checks) {
    if (c.status === 'missing') { weight += 2; reasons.push(c.label.toLowerCase() + ' missing') }
    else if (c.status === 'warn') { weight += 1 }
  }
  if (priorReturnedInSpec > 0) { weight += 1; reasons.push('prior returns in this spec section') }
  const level: SubmittalRisk['level'] = weight >= 4 ? 'high' : weight >= 2 ? 'medium' : 'low'
  if (reasons.length === 0) reasons.push('no obvious gaps detected')
  return { level, reasons }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildSubmittalReview(tenantId: string, submittalId: string, now: Date = new Date()): Promise<SubmittalReviewResult | null> {
  const subRes = await tenantQuery(tenantId,
    `SELECT id, project_id, submittal_number, title, type, discipline, spec_section, status,
            submitted_by, reviewed_by, review_notes, due_date
       FROM submittals WHERE tenant_id=$1 AND id=$2`, [tenantId, submittalId])
  const s = subRes.rows[0] as (SubmittalLite & { project_id: string }) | undefined
  if (!s) return null

  const [candidates, reviewers, priorReturned] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, submittal_number, title, type, spec_section, status
         FROM submittals WHERE tenant_id=$1 AND project_id=$2 AND id<>$3 LIMIT 500`, [tenantId, s.project_id, submittalId]),
    tenantQuery(tenantId,
      `SELECT reviewed_by AS user_id, COUNT(*)::int AS reviewed
         FROM submittals
        WHERE tenant_id=$1 AND project_id=$2 AND reviewed_by IS NOT NULL
          AND status IN ('approved','approved_as_noted','revise_resubmit','rejected')
          ${s.discipline ? 'AND discipline=$3' : ''}
        GROUP BY reviewed_by ORDER BY reviewed DESC LIMIT 5`,
      s.discipline ? [tenantId, s.project_id, s.discipline] : [tenantId, s.project_id]),
    s.spec_section
      ? tenantQuery(tenantId,
          `SELECT COUNT(*)::int AS returned FROM submittals
            WHERE tenant_id=$1 AND project_id=$2 AND id<>$3 AND spec_section=$4
              AND status IN ('revise_resubmit','rejected')`, [tenantId, s.project_id, submittalId, s.spec_section])
      : Promise.resolve({ rows: [{ returned: 0 }] } as { rows: { returned: number }[] }),
  ])

  const priorReturnedInSpec = Number((priorReturned.rows[0] as { returned?: number })?.returned ?? 0)
  const checks = reviewChecks(s, priorReturnedInSpec, now)

  return {
    submittal: {
      id: s.id, number: s.submittal_number ?? s.id.slice(0, 8), title: s.title ?? '',
      discipline: s.discipline ?? null, specSection: s.spec_section ?? null, status: s.status ?? 'draft',
    },
    checks,
    similar: findSimilarSubmittals(s, candidates.rows as SubmittalLite[]),
    suggestedReviewers: (reviewers.rows as { user_id: string; reviewed: number }[]).map(r => ({ userId: r.user_id, reviewed: Number(r.reviewed) })),
    risk: assessSubmittalRisk(checks, priorReturnedInSpec),
  }
}

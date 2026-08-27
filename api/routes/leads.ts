/**
 * Denver Engineering — CRM leads read API (pre-award pipeline)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/leads/summary   — the dashboard's Pipeline (Weighted) source
 *   GET /api/v1/leads           — list, optionally filtered by observed stage
 *   GET /api/v1/leads/:id       — one lead
 *
 * READ ONLY. The audit found no INSERT or UPDATE against `crm_leads` anywhere
 * in the API, and no reader either — this is the first. `summary.writable`
 * reports that absence rather than letting a zero imply an empty pipeline.
 *
 * `stage` is an unconstrained VARCHAR(50), not a lifecycle enum, so no route
 * here filters by stage implicitly and the summary reports
 * `stageGoverned: false` beside the observed distribution. A caller may filter
 * by an exact stage it has seen; nothing validates that string against a
 * governed set, because no governed set exists to validate against.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, collectionScopeSql, collectionScopeParams } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
import { listLeads, getLead, leadSummary, type CollectionScope } from '../services/crm/leadService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

export const leadsRouter = Router()
leadsRouter.use(requireAuth as never)
leadsRouter.use(requireTenant() as never)

// The authorization predicate is built INSIDE each handler, not in a shared
// helper: ADR-014's collection ratchet reads the route body and requires
// `collectionScopeSql(` on the declaration itself, because a predicate an
// auditor cannot see on the route is one nobody can confirm is applied.
//
// `crm_leads` is DUAL_PROJECT_OR_TENANT — `project_id` is nullable with ON
// DELETE SET NULL, so an unlinked lead is a designed state (a lead is pre-award
// and usually precedes any project). The registry-driven predicate therefore
// keeps project-less leads visible to any crm.view holder in the tenant while
// still requiring live membership for a lead that names a project.

// `/summary` before `/:id`, or the parameter route swallows it.
leadsRouter.get('/summary', requireCapability('crm.view') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    const scopeParams = collectionScopeParams(principal, 'crm_leads')
    const scope: CollectionScope = {
      sql: collectionScopeSql(principal, 'crm_leads', 'l.project_id', '$1'),
      params: scopeParams,
      nextIndex: scopeParams.length + 1,
    }
    res.json({ data: await leadSummary(principal.tenantId, scope) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarise leads', detail: (err as Error).message })
  }
})

leadsRouter.get('/', requireCapability('crm.view') as never, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    const scopeParams = collectionScopeParams(principal, 'crm_leads')
    const scope: CollectionScope = {
      sql: collectionScopeSql(principal, 'crm_leads', 'l.project_id', '$1'),
      params: scopeParams,
      nextIndex: scopeParams.length + 1,
    }
    res.json({ data: await listLeads(principal.tenantId, scope, {
      stage: q.stage, limit: q.limit ? Number(q.limit) : undefined,
    }) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to list leads', detail: (err as Error).message })
  }
})

leadsRouter.get('/:id', requireCapability('crm.view') as never, requireRecordScope('crm_leads') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const row = await getLead(r.tenantId!, String(req.params.id))
    if (!row) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ data: row })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get lead', detail: (err as Error).message })
  }
})

export default leadsRouter

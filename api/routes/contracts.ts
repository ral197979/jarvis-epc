/**
 * Denver Engineering — Contracts read API (vendor commitments)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/contracts/summary    — the dashboard's Active Contracts source
 *   GET /api/v1/contracts            — list, filterable by status and project
 *   GET /api/v1/contracts/:id        — one contract
 *
 * READ ONLY, and deliberately so. The audit found no INSERT or UPDATE against
 * `contracts` anywhere in the API, so there is no write path to govern yet;
 * inventing one to make the dashboard look busier is exactly the move this
 * work exists to stop. `summary.writable` reports that absence rather than
 * letting a zero imply an empty order book.
 *
 * A contract is a commitment to a VENDOR delivered on a project. It is not a
 * project. `/api/v1/projects` returns the delivery entity and has never been a
 * substitute — the dashboard tile that counted projects as contracts is the
 * defect this closes — and `subcontracts` (migration 059) is a different table
 * with a different lifecycle that is equally not folded in here.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, collectionScopeSql, collectionScopeParams } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
import {
  listContracts, getContract, contractSummary, CONTRACT_STATUSES,
  type CollectionScope,
} from '../services/contracts/contractService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

export const contractsRouter = Router()
contractsRouter.use(requireAuth as never)
contractsRouter.use(requireTenant() as never)

const STATUSES = new Set<string>(CONTRACT_STATUSES)

// The authorization predicate is built INSIDE each handler, not in a shared
// helper. ADR-014's collection ratchet reads the route body and requires
// `collectionScopeSql(` to appear on the declaration itself: a predicate an
// auditor cannot see on the route is one nobody can confirm is applied, and a
// helper one level up is exactly that. The small duplication is the point.
//
// `contracts` is PROJECT_REQUIRED in the record-scope registry (project_id NOT
// NULL), so the predicate is the ordinary project-membership one. It is ANDed
// outside any caller filter and applied before LIMIT, so a filter can only
// narrow the authorized set.

// `/summary` is declared BEFORE `/:id`, or the parameter route swallows it and
// the dashboard silently asks for a contract whose id is the word "summary".
contractsRouter.get('/summary', requireCapability('procurement.view') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    const scopeParams = collectionScopeParams(principal, 'contracts')
    const scope: CollectionScope = {
      sql: collectionScopeSql(principal, 'contracts', 'c.project_id', '$1'),
      params: scopeParams,
      nextIndex: scopeParams.length + 1,
    }
    res.json({ data: await contractSummary(principal.tenantId, scope) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to summarise contracts', detail: (err as Error).message })
  }
})

contractsRouter.get('/', requireCapability('procurement.view') as never, async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>
  // An unrecognised status is refused rather than ignored: silently dropping
  // the filter would return every contract to a caller who asked for one state.
  if (q.status && !STATUSES.has(q.status)) {
    res.status(400).json({ error: 'invalid_status', allowed: [...STATUSES] })
    return
  }
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    const scopeParams = collectionScopeParams(principal, 'contracts')
    const scope: CollectionScope = {
      sql: collectionScopeSql(principal, 'contracts', 'c.project_id', '$1'),
      params: scopeParams,
      nextIndex: scopeParams.length + 1,
    }
    res.json({ data: await listContracts(principal.tenantId, scope, {
      status: q.status, projectId: q.project_id,
      limit: q.limit ? Number(q.limit) : undefined,
    }) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to list contracts', detail: (err as Error).message })
  }
})

contractsRouter.get('/:id', requireCapability('procurement.view') as never, requireRecordScope('contracts') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const row = await getContract(r.tenantId!, String(req.params.id))
    if (!row) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ data: row })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get contract', detail: (err as Error).message })
  }
})

export default contractsRouter

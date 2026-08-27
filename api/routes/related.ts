/**
 * Denver Engineering — Related records API (v4.35.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /api/v1/related/:source/:id   → records connected to this record
 *
 * See WORKFLOW_REDESIGN.md §9. Only real (FK / shared-key / Action-spine) links.
 *
 * ADR-014 Phase 3A — record-scope authorization.
 * ─────────────────────────────────────────────
 * This was one of the two endpoints Phase 2 deliberately left pending. Before
 * Phase 3A it carried no capability guard and no record scope: any
 * authenticated principal could name any record id in the tenant and receive
 * the identifiers, titles and statuses of everything linked to it, across
 * construction, engineering, quality, commercial and personal domains.
 *
 * Two independent gates now apply, in order:
 *
 *   SOURCE  the caller must be able to read the record being asked about.
 *           Relationships are information about a record, so a caller who
 *           cannot open it must not be able to enumerate what it touches.
 *           Refusal is a 404 — the same answer as an id that does not exist.
 *
 *   TARGET  every related record is authorized on its own terms: its domain's
 *           functional capability AND its own record scope. Reading an RFI does
 *           not confer the change order it produced.
 *
 * Unauthorized targets are removed before the response is assembled, so they
 * contribute no id, type, title, status, identifier — and no group. Groups that
 * become empty are dropped, so the group list itself cannot be used to count
 * what was filtered out (Phase 3A §22, §23).
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { getRelated, RELATED_SOURCES, type RelatedItem, type RelatedGroup } from '../services/related/relatedService'
import { resolveCurrentUser } from '../authz/currentUser'
import { authorizeSource, filterAuthorizedTargets } from '../authz/relatedRecordScope'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

/** Authorization input that must not travel to the client. */
function publicItem(item: RelatedItem): RelatedItem {
  const { assignedToUserId: _internal, ...rest } = item
  return rest
}

router.get('/related/:source/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const source = String(req.params.source)
  const id     = String(req.params.id)

  // An unrecognised source is refused before anything is loaded. There is no
  // permissive branch: a source added without a record-scope policy fails in
  // `authorizeSource` below for the same reason.
  if (!RELATED_SOURCES.has(source)) return res.status(400).json({ error: `unknown source: ${source}` })

  // Live principal — a revoked membership takes effect on this request, not
  // when the token expires.
  const principal = await resolveCurrentUser(r)
  if (!principal) return res.status(401).json({ error: 'unauthenticated' })

  try {
    const sourceAuth = await authorizeSource(principal, source, id)
    if (!sourceAuth.ok) {
      // Uniform 404 across every refusal reason. Distinguishing "you may not
      // read this" from "this does not exist" would confirm the record exists.
      return res.status(404).json({ error: 'not_found' })
    }

    const related = await getRelated(r.tenantId!, source, id)

    const groups: RelatedGroup[] = []
    for (const g of related.groups) {
      const permitted = await filterAuthorizedTargets(
        principal, g.items, i => i.assignedToUserId ?? null,
      )
      // A group whose every member was filtered out is dropped entirely: an
      // empty "Change orders from this RFI" group would still disclose that
      // change orders exist.
      if (permitted.length > 0) {
        groups.push({ ...g, items: permitted.map(publicItem) })
      }
    }

    res.json({ data: { source: related.source, id: related.id, groups } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load related records', detail: (err as Error).message })
  }
})

export const relatedRouter = router

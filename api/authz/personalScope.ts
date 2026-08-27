/**
 * Denver Engineering — Personal Inbox scope enforcement (ADR-014 Phase 2C-4A)
 * ─────────────────────────────────────────────────────────────────────────────
 * `requireCapability('personal.write')` answers "may this principal change
 * Personal Inbox state at all". It cannot answer "is this record theirs", and
 * that second question is where the Personal Inbox actually fails closed:
 * `personal.write` is held by five of seven roles, so a capability check alone
 * would let any project manager complete, reassign or delegate any other user's
 * work simply because they share a tenant.
 *
 * ADR-014 Phase 2C-4A D12: **same tenant is not mine.** Every self-scoped route
 * proves record ownership against the live principal in addition to its
 * capability guard, and the two checks are deliberately separate concerns.
 *
 * Why one helper rather than a check per route
 * ───────────────────────────────────────────
 * `actions.ts` has 23 in-scope endpoints touching the same ownership column.
 * Written out route by route, the rules drift — one forgets the tenant
 * predicate, another trusts a body field, a third resolves the parent record
 * differently. `resolveActionAccess` is the single place that decides, so a
 * change to the ownership rule cannot apply to only some of the routes.
 *
 * The principal is ALWAYS the live database row
 * ─────────────────────────────────────────────
 * Never `req.auth.sub`, never `req.auth.role`, and never a body field. The
 * blocked Phase 2C-4 analysis found `req.auth?.userId` used throughout
 * `actions.ts` — a field the token does not carry — which silently made the
 * delegation surface dead and wrote `null` audit actors. Reading through
 * `resolveCurrentUser` fixes that and inherits its closures for free: a deleted
 * user, a deactivated account, an unrecognised role and a token whose tenant
 * claim contradicts the stored row all fail before any ownership question is
 * asked.
 */
import type { RequestHandler, Response, NextFunction } from 'express'
import { tenantQuery } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { roleHasCapability, type ServerCapability } from './capabilities'
import { resolveCurrentUser, type AuthorizedRequest, type CurrentUser } from './currentUser'

/** How a caller relates to a Personal Inbox record. */
export type PersonalAccess =
  /** The live principal owns the record. */
  | 'SELF'
  /** Not the owner, but holds `personal.admin` — cross-user administration. */
  | 'ADMIN'
  /** Neither. The route must refuse before any side effect. */
  | 'DENIED'

/** The capability that authorizes acting on someone else's Personal Inbox. */
export const PERSONAL_ADMIN_CAPABILITY = 'personal.admin' as const
/** The capability that authorizes acting on your own. */
export const PERSONAL_WRITE_CAPABILITY = 'personal.write' as const

/**
 * The live principal, or `null` when the caller no longer resolves to an active
 * account in the tenant their token claims.
 *
 * Routes reached through `requireCapability` have already resolved it; the
 * result is memoised on the request, so calling this again costs nothing.
 */
export async function personalPrincipal(req: unknown): Promise<CurrentUser | null> {
  return resolveCurrentUser(req as AuthorizedRequest)
}

/** True when the live principal holds tenant-wide Personal Inbox authority. */
export function isPersonalAdmin(principal: CurrentUser | null): boolean {
  return principal != null && roleHasCapability(principal.role, PERSONAL_ADMIN_CAPABILITY)
}

/**
 * Decide how `principal` may act on one action.
 *
 * Tenant-bound by construction: the lookup goes through `tenantQuery` with the
 * principal's own tenant, so an action belonging to another tenant is not
 * "someone else's action", it simply does not exist. A missing row is reported
 * as `null` so the caller can answer 404 without leaking whether the id exists
 * in a tenant the caller cannot see.
 */
export async function resolveActionAccess(
  actionId:  string,
  principal: CurrentUser | null,
): Promise<{ access: PersonalAccess; found: boolean }> {
  if (!principal) return { access: 'DENIED', found: false }

  const res = await tenantQuery<{ assigned_to_user_id: string | null }>(
    principal.tenantId,
    `SELECT assigned_to_user_id FROM actions
     WHERE id = $1 AND tenant_id = $2`,
    [actionId, principal.tenantId],
  )
  const row = res.rows[0]
  if (!row) return { access: 'DENIED', found: false }

  if (row.assigned_to_user_id != null && row.assigned_to_user_id === principal.id) {
    return { access: 'SELF', found: true }
  }
  if (isPersonalAdmin(principal)) return { access: 'ADMIN', found: true }
  return { access: 'DENIED', found: true }
}

/**
 * Guard one action route. Returns the principal when the caller may proceed, and
 * `null` after it has already written the refusal — so a handler reads:
 *
 *   const principal = await requireActionAccess(req, res, id)
 *   if (!principal) return
 *
 * Refusals happen before the handler does any work, which is what makes the
 * "denied requests cause no side effect" assertions in the behavioural suite
 * meaningful rather than incidental.
 *
 * An unowned action that the caller cannot administer answers 404, not 403:
 * whether a given action id exists is itself information about another user's
 * queue.
 */
export async function requireActionAccess(
  req: unknown,
  res: Response,
  actionId: string,
): Promise<CurrentUser | null> {
  const principal = await personalPrincipal(req)
  if (!principal) {
    res.status(401).json({ error: 'unauthenticated' })
    return null
  }

  const { access, found } = await resolveActionAccess(actionId, principal)
  if (access === 'DENIED') {
    if (found) {
      slog('WARN', 'authz', '[personal-inbox denied]', {
        userId: principal.id, tenantId: principal.tenantId, role: principal.role,
        actionId, reason: 'not_owner_and_not_personal_admin',
      })
    }
    res.status(404).json({ error: 'not_found' })
    return null
  }
  return principal
}

/**
 * Refuse a request whose body carries a field the caller is not authorized to
 * write, before the handler runs.
 *
 * Used for the Personal Inbox fields that decide *ownership* rather than
 * workflow — `assigned_to_user_id` and `assigned_to_role` on `PATCH
 * /actions/:id`. Reassigning work is cross-user administration even when the
 * action currently belongs to the caller, so it needs `personal.admin` and not
 * the `personal.write` that opens the rest of the route.
 *
 * Deliberately a 403 rather than a silent drop: ignoring the field and
 * answering 200 would tell the caller their reassignment succeeded when it did
 * not, which is a worse failure than refusing.
 */
export function requireCapabilityForFields(
  fields: readonly string[],
  capability: ServerCapability,
): RequestHandler {
  return async (req, res: Response, next: NextFunction): Promise<void> => {
    const body = (req as { body?: Record<string, unknown> }).body
    const present = body && typeof body === 'object'
      ? fields.filter(f => Object.prototype.hasOwnProperty.call(body, f))
      : []

    if (present.length === 0) { next(); return }

    const principal = await personalPrincipal(req)
    if (!principal) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    if (!roleHasCapability(principal.role, capability)) {
      slog('WARN', 'authz', '[denied]', {
        userId: principal.id, tenantId: principal.tenantId, role: principal.role,
        capability, restrictedFields: present,
        method: (req as { method?: string }).method,
      })
      res.status(403).json({ error: 'forbidden', restricted_fields: present })
      return
    }
    next()
  }
}

/**
 * Confirm a user id names an active member of the caller's tenant.
 *
 * Needed wherever a Personal Inbox operation nominates *another* user — the
 * reassignment target of `PATCH /actions/:id`, the delegate of `POST
 * /delegations`. Holding `personal.admin` authorizes administering this
 * tenant's inbox; it must not become a way to attach this tenant's work to a
 * principal from another one.
 */
export async function isTenantMember(tenantId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const res = await tenantQuery<{ id: string }>(
    tenantId,
    `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
    [userId, tenantId],
  )
  return res.rows.length > 0
}

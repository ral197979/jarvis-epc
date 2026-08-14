/**
 * Denver Engineering — current-user resolution (ADR-014 Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Closes the JWT role-staleness gap.
 *
 * `requireAuth` verifies the token signature and trusts `payload.role`. That
 * role was true when the token was issued and may not be true now: an
 * administrator who demotes or disables a user had no effect until the token
 * expired. Phase 2 therefore resolves the user's **current** role and active
 * status from the database on each protected request, and authorizes against
 * that rather than against the claim.
 *
 * The token is still the identity proof — only the *authorization* attributes
 * are re-read. `sub` and `tid` are taken from the verified token and are never
 * accepted from the client.
 *
 * Cost: exactly one indexed primary-key lookup per protected request, memoised
 * on the request object so several capability checks on one route share it.
 * There is deliberately no cross-request cache: a cache would reintroduce a
 * revocation window, which is the defect this closes.
 */
import { Response, NextFunction } from 'express'
import { query } from '../db/pool'
import { AuthenticatedRequest } from '../auth'
import { isUserRole, type UserRole } from './capabilities'

export interface CurrentUser {
  id:       string
  tenantId: string
  role:     UserRole
}

export interface AuthorizedRequest extends AuthenticatedRequest {
  currentUser?: CurrentUser
  /** Set once the lookup has run, so a failed resolution is not retried per capability. */
  currentUserResolved?: boolean
}

interface UserAuthRow {
  id:        string
  tenant_id: string
  role:      string
  is_active: boolean
}

/**
 * Resolve the authenticated user's current authorization attributes.
 *
 * Returns `null` — and therefore denies — when the token carries no subject,
 * the user no longer exists, the account is deactivated, the stored role is not
 * a recognised `user_role`, or the row belongs to a different tenant than the
 * token claims. Every one of those is a fail-closed outcome; none falls back to
 * the token's own role.
 */
export async function resolveCurrentUser(req: AuthorizedRequest): Promise<CurrentUser | null> {
  if (req.currentUserResolved) return req.currentUser ?? null
  req.currentUserResolved = true

  const subject = req.auth?.sub
  if (!subject) return null

  let row: UserAuthRow | undefined
  try {
    const result = await query<UserAuthRow>(
      'SELECT id, tenant_id, role, is_active FROM users WHERE id = $1',
      [subject],
    )
    row = result?.rows?.[0]
  } catch {
    // A failed lookup must not become an implicit grant.
    return null
  }

  if (!row) return null
  if (row.is_active === false) return null
  if (!isUserRole(row.role)) return null

  // Defence in depth: the token's tenant claim and the stored tenant must agree.
  // A mismatch means the token no longer describes this user.
  const claimedTenant = req.auth?.tid
  if (claimedTenant && row.tenant_id && claimedTenant !== row.tenant_id) return null

  req.currentUser = { id: row.id, tenantId: row.tenant_id, role: row.role }
  return req.currentUser
}

/**
 * Express middleware form. Attaches `req.currentUser` when the user is still
 * authorized to act, and 401s when the authenticated identity no longer resolves
 * to an active account — the token is valid but the principal behind it is gone.
 */
export function requireCurrentUser() {
  return async (req: AuthorizedRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = await resolveCurrentUser(req)
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    next()
  }
}

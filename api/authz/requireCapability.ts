/**
 * Denver Engineering — the canonical server authorization primitive (ADR-014 Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * One function decides every functional authorization question on the API. It
 * replaces `requireRole(...)` and the scattered
 * `['owner','admin'].includes(req.auth?.role ?? '')` checks, which were three
 * parallel systems disagreeing about the same question.
 *
 * Contract
 * ────────
 *   401  no valid authentication, or the authenticated principal no longer
 *        resolves to an active user
 *   403  authenticated, but the current role does not hold the capability
 *
 * The denial body is a bare `{ error: 'forbidden' }`. It deliberately does not
 * echo the required capability or the caller's role: ordinary API responses
 * should not disclose the policy structure.
 *
 * Fails closed on every uncertain input — absent user, unknown role,
 * unregistered capability, ungranted capability. There is no owner fallback and
 * no "unmapped means allow" branch.
 *
 * Ordering (ADR-014 §Phase 2): authentication → tenant context → current-user
 * resolution → capability → handler. Capability runs after tenant context so a
 * cross-tenant record keeps whatever existence-hiding behaviour Denver already
 * gives it, and authorization never becomes an existence oracle.
 */
import { Response, NextFunction, RequestHandler } from 'express'
import { slog } from '../../src/modules/observability/index'
import { roleHasCapability, isServerCapability, type ServerCapability } from './capabilities'
import { resolveCurrentUser, type AuthorizedRequest } from './currentUser'

/**
 * Require a capability of the authenticated caller's **current** role.
 *
 * @example
 *   router.post('/timesheets/:id/approve', requireCapability('team.approve'), handler)
 */
export function requireCapability(capability: ServerCapability): RequestHandler {
  // A typo in a capability name must not silently authorize the route. Detected
  // at registration so it surfaces at boot and in the coverage test, not on a
  // production request.
  if (!isServerCapability(capability)) {
    throw new Error(`[authz] unknown capability: ${String(capability)}`)
  }

  return async (req, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthorizedRequest

    const user = await resolveCurrentUser(authReq)
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }

    if (!roleHasCapability(user.role, capability)) {
      slog('WARN', 'authz', '[denied]', {
        userId:     user.id,
        tenantId:   user.tenantId,
        role:       user.role,
        capability,
        method:     req.method,
        path:       req.originalUrl ?? req.url,
      })
      res.status(403).json({ error: 'forbidden' })
      return
    }

    next()
  }
}

/**
 * Require *any* of several capabilities. For endpoints that legitimately serve
 * more than one authority — e.g. a queue readable by both its domain owner and
 * the platform administrator. Still fails closed: an empty list denies.
 */
export function requireAnyCapability(...capabilities: ServerCapability[]): RequestHandler {
  for (const capability of capabilities) {
    if (!isServerCapability(capability)) {
      throw new Error(`[authz] unknown capability: ${String(capability)}`)
    }
  }

  return async (req, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthorizedRequest

    const user = await resolveCurrentUser(authReq)
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }

    if (!capabilities.some(capability => roleHasCapability(user.role, capability))) {
      slog('WARN', 'authz', '[denied]', {
        userId:     user.id,
        tenantId:   user.tenantId,
        role:       user.role,
        capability: capabilities.join('|'),
        method:     req.method,
        path:       req.originalUrl ?? req.url,
      })
      res.status(403).json({ error: 'forbidden' })
      return
    }

    next()
  }
}

/**
 * Require *all* of several capabilities (ADR-014 Phase 2B-3).
 *
 * Why this exists rather than stacking `requireCapability` calls
 * ─────────────────────────────────────────────────────────────
 * Stacking is functionally equivalent — `resolveCurrentUser` memoises per
 * request, so N guards still cost one lookup. But an AI endpoint that
 * synthesises across five domains needs five capabilities on one route, and
 * with stacking the coverage census reads only the first: a dropped
 * requirement would be invisible to the ratchet. One call keeps the whole
 * requirement in a single parseable token, so removing a capability is a
 * detectable change.
 *
 * This is AND, and the distinction from `requireAnyCapability` is the point.
 * A response containing both engineering and cost data must not be opened by
 * `requireAnyCapability('engineering.view', 'cost.view')`: that hands the cost
 * half to an engineering-only caller and the engineering half to a cost-only
 * one. Fails closed on an empty list, an unknown capability, or any missing
 * grant. The denial names no capability — the log records which one was short.
 */
export function requireAllCapabilities(...capabilities: ServerCapability[]): RequestHandler {
  if (!capabilities.length) {
    throw new Error('[authz] requireAllCapabilities needs at least one capability')
  }
  for (const capability of capabilities) {
    if (!isServerCapability(capability)) {
      throw new Error(`[authz] unknown capability: ${String(capability)}`)
    }
  }

  return async (req, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthorizedRequest

    const user = await resolveCurrentUser(authReq)
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }

    const missing = capabilities.filter(capability => !roleHasCapability(user.role, capability))
    if (missing.length) {
      slog('WARN', 'authz', '[denied]', {
        userId:     user.id,
        tenantId:   user.tenantId,
        role:       user.role,
        capability: capabilities.join('&'),
        missing:    missing.join(','),
        method:     req.method,
        path:       req.originalUrl ?? req.url,
      })
      res.status(403).json({ error: 'forbidden' })
      return
    }

    next()
  }
}

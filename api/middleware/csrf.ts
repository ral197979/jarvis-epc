/**
 * Denver Engineering — CSRF Protection Middleware (P2-8)
 * ────────────────────────────────────────────────────────
 * Double-submit cookie pattern for endpoints that accept httpOnly cookie auth.
 *
 * Flow:
 *   1. GET /api/v1/auth/csrf  → sets a non-httpOnly `csrf_token` cookie and
 *      returns the same token in the response body so the SPA can read it.
 *   2. On every mutating request (POST/PUT/PATCH/DELETE) the SPA sends the
 *      token in the `X-CSRF-Token` header.
 *   3. `requireCsrf` middleware validates the header matches the cookie.
 *
 * JWT-only clients (Bearer token, no cookies) are exempt because CSRF attacks
 * rely on the browser automatically attaching credentials — which only happens
 * for cookies, not Authorization headers.
 *
 * Exemptions:
 *   - Requests with a valid `Authorization: Bearer …` header skip CSRF check.
 *   - /api/v1/auth/login is exempt (session not yet established).
 *   - /api/v1/auth/refresh uses sameSite:strict + httpOnly cookie (no SPA
 *     access to cookie value) — checked separately.
 */

import { randomBytes } from 'node:crypto'
import { Request, Response, NextFunction } from 'express'

const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'x-csrf-token'
const IS_PROD     = process.env['NODE_ENV'] === 'production'

/** Cookie options for the CSRF token — NOT httpOnly so JS can read it. */
function _csrfCookieOpts(maxAge: number) {
  return {
    httpOnly: false,          // intentionally readable by the SPA
    secure:   IS_PROD,
    sameSite: 'strict' as const,
    path:     '/',
    maxAge:   maxAge * 1000,
  }
}

// ─── Issue CSRF token ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/csrf
 * Returns a fresh CSRF token both as a cookie and in the response body.
 * The SPA should call this once after login and store the token for
 * subsequent mutating requests.
 */
export function handleCsrfToken(_req: Request, res: Response) {
  const token = randomBytes(32).toString('hex')
  res.cookie(CSRF_COOKIE, token, _csrfCookieOpts(8 * 60 * 60)) // 8 h
  res.json({ csrf_token: token })
}

// ─── Validation middleware ────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Middleware: validate CSRF token for cookie-authenticated mutating requests.
 * Bearer-token requests are automatically exempt.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  // Bearer-token clients are immune to CSRF; skip.
  if (req.headers['authorization']?.startsWith('Bearer ')) {
    next(); return
  }

  // Only mutating methods need the check.
  if (SAFE_METHODS.has(req.method)) {
    next(); return
  }

  const cookieToken  = req.cookies?.[CSRF_COOKIE] as string | undefined
  const headerToken  = req.headers[CSRF_HEADER]  as string | undefined

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: 'csrf_validation_failed', message: 'CSRF token missing or invalid.' })
    return
  }

  next()
}

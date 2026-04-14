/**
 * JARVIS EPC — JWT Authentication Module (v4.26.0)
 * ──────────────────────────────────────────────────
 * Extends v4.23 auth with multi-tenant support.
 *
 * Changes from v4.23.0:
 *   - Login validates user against PostgreSQL users table
 *   - JWT payload includes `tid` (tenant_id) and `role` from DB
 *   - requireRole accepts DB-level roles (owner, admin, project_manager, etc.)
 *   - Refresh tokens stored in PostgreSQL refresh_tokens table (+ Redis revocation)
 *   - Single-owner PIN mode removed — full user/password auth
 *
 * Token design:
 *   Access token:  15 min TTL, { sub, tid, role, jti, iat, exp }
 *   Refresh token: 7 day TTL, stored in DB refresh_tokens + Redis revocation
 */

import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'
import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { query, tenantQuery } from './db/pool'
import { getTokenStore } from './tokenStore'
import { slog } from '../src/modules/observability/index'

// ─── Config ───────────────────────────────────────────────────────────────────

const _rawJwtSecret = process.env['JWT_SECRET']

if (!_rawJwtSecret) {
  if (process.env['NODE_ENV'] === 'production') {
    console.error('[JARVIS:Auth] FATAL — JWT_SECRET not set')
    process.exit(1)
  } else {
    console.warn('[JARVIS:Auth] ⚠  JWT_SECRET not set — using insecure dev fallback')
  }
}

const JWT_SECRET          = _rawJwtSecret ?? '__dev-only-insecure-fallback__'
const ACCESS_TOKEN_TTL    = '15m'
const REFRESH_TOKEN_TTL   = '7d'
const ACCESS_TTL_SECONDS  = 15 * 60
const REFRESH_TTL_SECONDS = 7  * 24 * 3600
const IS_PROD             = process.env['NODE_ENV'] === 'production'

export const COOKIE_AT_NAME = 'jarvis_at'
export const COOKIE_RT_NAME = 'jarvis_rt'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JarvisTokenPayload extends JwtPayload {
  sub:  string   // user UUID
  tid:  string   // tenant UUID
  role: string   // user_role enum value
  jti:  string
}

export interface AuthenticatedRequest extends Request {
  auth?: JarvisTokenPayload
}

// ─── Token issuance ───────────────────────────────────────────────────────────

function _issueAccess(userId: string, tenantId: string, role: string): string {
  const jti     = randomBytes(16).toString('hex')
  const payload = { sub: userId, tid: tenantId, role, jti }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as SignOptions)
}

function _issueRefresh(userId: string, tenantId: string, role: string): { token: string; jti: string; hash: string } {
  const jti   = randomBytes(16).toString('hex')
  const token = jwt.sign({ sub: userId, tid: tenantId, role, jti }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL } as SignOptions)
  const hash  = createHash('sha256').update(token).digest('hex')
  return { token, jti, hash }
}

function _cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict' as const,
    maxAge:   maxAge * 1000,
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const { email, password, tenantSlug } = req.body as {
    email?: string; password?: string; tenantSlug?: string
  }

  if (!email || !password) {
    res.status(400).json({ error: 'validation', message: 'email and password required' })
    return
  }

  // Lookup user. If tenantSlug provided, scope to that tenant.
  const userQuery = tenantSlug
    ? `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.is_active,
              u.failed_attempts, u.locked_until, t.status AS tenant_status
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 AND t.slug = $2 LIMIT 1`
    : `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.is_active,
              u.failed_attempts, u.locked_until, t.status AS tenant_status
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 LIMIT 1`

  const params: unknown[] = tenantSlug ? [email.toLowerCase(), tenantSlug] : [email.toLowerCase()]
  const result = await query(userQuery, params)
  const user   = result.rows[0]

  // Constant-time invalid user
  if (!user) {
    await bcrypt.compare(password, '$2b$12$invalid.hash.padding.for.timing')
    slog('WARN', 'auth', '[login] Unknown email', { email })
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  // Account lock check
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    slog('WARN', 'auth', '[login] Account locked', { userId: user.id })
    res.status(423).json({ error: 'account_locked', message: 'Account temporarily locked. Try again later.' })
    return
  }

  if (!user.is_active) {
    res.status(403).json({ error: 'account_inactive', message: 'Account is inactive.' })
    return
  }

  if (user.tenant_status !== 'active') {
    res.status(403).json({ error: 'tenant_inactive', message: `Tenant account is ${user.tenant_status}.` })
    return
  }

  const valid = await bcrypt.compare(password, user.password_hash)

  if (!valid) {
    // Increment failed attempts; lock after 5
    const newAttempts = (user.failed_attempts ?? 0) + 1
    const lockUntil   = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
    await query(
      'UPDATE users SET failed_attempts=$1, locked_until=$2 WHERE id=$3',
      [newAttempts, lockUntil, user.id]
    )
    slog('WARN', 'auth', '[login] Invalid password', { userId: user.id, attempts: newAttempts })
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  // Reset failure counter + update last_login
  await query(
    'UPDATE users SET failed_attempts=0, locked_until=NULL, last_login=NOW(), login_count=login_count+1 WHERE id=$1',
    [user.id]
  )

  const accessToken  = _issueAccess(user.id, user.tenant_id, user.role)
  const { token: refreshToken, jti, hash } = _issueRefresh(user.id, user.tenant_id, user.role)

  // Store refresh token in DB
  await query(
    `INSERT INTO refresh_tokens (tenant_id,user_id,jti,token_hash,ip_address,user_agent,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW() + interval '7 days')`,
    [user.tenant_id, user.id, jti, hash,
     req.ip ?? null, req.headers['user-agent']?.slice(0,255) ?? null]
  )

  // Also register in Redis token store (revocation)
  const store = getTokenStore()
  await store.addRefreshToken(jti, Date.now() + REFRESH_TTL_SECONDS * 1000)

  res.cookie(COOKIE_AT_NAME, accessToken,  { ..._cookieOpts(ACCESS_TTL_SECONDS),  path: '/' })
  res.cookie(COOKIE_RT_NAME, refreshToken, { ..._cookieOpts(REFRESH_TTL_SECONDS), path: '/api/v1/auth/refresh' })

  slog('INFO', 'auth', '[login] Success', { userId: user.id, tenantId: user.tenant_id, role: user.role })

  res.json({
    data: {
      userId:   user.id,
      tenantId: user.tenant_id,
      role:     user.role,
      email:    user.email,
    },
  })
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[COOKIE_RT_NAME] as string | undefined
  if (!rawToken) { res.status(401).json({ error: 'no_refresh_token' }); return }

  let payload: JarvisTokenPayload
  try {
    payload = jwt.verify(rawToken, JWT_SECRET) as JarvisTokenPayload
  } catch {
    res.status(401).json({ error: 'invalid_refresh_token' }); return
  }

  const store   = getTokenStore()
  const revoked = await store.isRevoked(payload.jti)
  if (revoked) { res.status(401).json({ error: 'token_revoked' }); return }

  const hasToken = await store.hasRefreshToken(payload.jti)
  if (!hasToken) { res.status(401).json({ error: 'invalid_refresh_token' }); return }

  // Rotate: revoke old, issue new
  await store.revokeJti(payload.jti)
  await store.removeRefreshToken(payload.jti)

  // Revoke in DB too
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE jti=$1', [payload.jti])

  const newAccess  = _issueAccess(payload.sub, payload.tid, payload.role)
  const { token: newRefresh, jti: newJti, hash: newHash } = _issueRefresh(payload.sub, payload.tid, payload.role)

  await query(
    `INSERT INTO refresh_tokens (tenant_id,user_id,jti,token_hash,ip_address,user_agent,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW() + interval '7 days')`,
    [payload.tid, payload.sub, newJti, newHash, req.ip ?? null, req.headers['user-agent']?.slice(0,255) ?? null]
  )
  await store.addRefreshToken(newJti, Date.now() + REFRESH_TTL_SECONDS * 1000)

  res.cookie(COOKIE_AT_NAME, newAccess,  { ..._cookieOpts(ACCESS_TTL_SECONDS),  path: '/' })
  res.cookie(COOKIE_RT_NAME, newRefresh, { ..._cookieOpts(REFRESH_TTL_SECONDS), path: '/api/v1/auth/refresh' })

  res.json({ data: { userId: payload.sub, tenantId: payload.tid, role: payload.role } })
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function handleLogout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const rawRefresh = req.cookies?.[COOKIE_RT_NAME] as string | undefined

  if (req.auth?.jti) {
    const store = getTokenStore()
    await store.revokeJti(req.auth.jti)
    await store.removeRefreshToken(req.auth.jti)
    await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE jti=$1', [req.auth.jti])
  }

  if (rawRefresh) {
    try {
      const p = jwt.decode(rawRefresh) as JarvisTokenPayload | null
      if (p?.jti) {
        const store = getTokenStore()
        await store.revokeJti(p.jti)
        await store.removeRefreshToken(p.jti)
      }
    } catch { /* ignore */ }
  }

  const clearOpts = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const }
  res.clearCookie(COOKIE_AT_NAME, { ...clearOpts, path: '/' })
  res.clearCookie(COOKIE_RT_NAME, { ...clearOpts, path: '/api/v1/auth/refresh' })

  slog('INFO', 'auth', '[logout]', { userId: req.auth?.sub })
  res.json({ data: { message: 'Logged out.' } })
}

// ─── Me ───────────────────────────────────────────────────────────────────────

export async function handleMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.auth?.sub) { res.status(401).json({ error: 'unauthenticated' }); return }

  const result = await query(
    'SELECT id,email,display_name,role,avatar_url,preferences,last_login FROM users WHERE id=$1',
    [req.auth.sub]
  )
  const user = result.rows[0]
  if (!user) { res.status(404).json({ error: 'user_not_found' }); return }

  res.json({ data: { ...user, tenantId: req.auth.tid } })
}

// ─── Token verification ───────────────────────────────────────────────────────

export function verifyToken(token: string): JarvisTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JarvisTokenPayload
  } catch { return null }
}

// ─── requireAuth middleware ───────────────────────────────────────────────────

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Cookie-first
  let raw = req.cookies?.[COOKIE_AT_NAME] as string | undefined
  // Bearer fallback (API clients)
  if (!raw) {
    const auth = req.headers['authorization']
    if (auth?.startsWith('Bearer ')) raw = auth.slice(7)
  }

  if (!raw) { res.status(401).json({ error: 'unauthenticated' }); return }

  const payload = verifyToken(raw)
  if (!payload) { res.status(401).json({ error: 'invalid_token' }); return }

  req.auth = payload
  next()
}

// ─── requireRole middleware ───────────────────────────────────────────────────

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) { res.status(401).json({ error: 'unauthenticated' }); return }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'forbidden', required: roles, current: req.auth.role })
      return
    }
    next()
  }
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export async function purgeExpiredTokens(): Promise<number> {
  const store = getTokenStore()
  const mem   = await store.purgeExpired()

  // Also purge DB
  const dbRes = await query<{ count: string }>(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL RETURNING id`
  )
  const db = dbRes.rowCount ?? 0

  if (mem + db > 0) {
    slog('INFO', 'auth', '[purge] Expired tokens cleaned', { memory: mem, db })
  }
  return mem + db
}

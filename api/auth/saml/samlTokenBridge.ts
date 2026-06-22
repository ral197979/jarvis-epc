/**
 * Denver Engineering — SAML Token Bridge
 * ────────────────────────────────────────
 * Re-exports the JWT issuance logic from auth.ts for use by the SAML provider.
 * Keeps samlProvider.ts from importing private auth.ts internals directly.
 *
 * After SAML assertion validation, we issue the same JWT access/refresh token
 * pair as password login — no special SAML session type.
 */

import jwt, { type SignOptions } from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'
import { query } from '../../db/pool'
import { getTokenStore } from '../../tokenStore'
import type { Response } from 'express'

const JWT_SECRET          = process.env['JWT_SECRET'] ?? '__dev-only-insecure-fallback__'
const ACCESS_TOKEN_TTL    = '15m'
const REFRESH_TOKEN_TTL   = '7d'
const ACCESS_TTL_SECONDS  = 15 * 60
const REFRESH_TTL_SECONDS = 7 * 24 * 3600
const IS_PROD             = process.env['NODE_ENV'] === 'production'

export const COOKIE_AT_NAME = 'jarvis_at'
export const COOKIE_RT_NAME = 'jarvis_rt'

function _cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict' as const,
    maxAge:   maxAge * 1000,
  }
}

/**
 * Issues JWT access + refresh tokens for a SAML-authenticated user
 * and sets cookies on the response.
 *
 * This mirrors handleLogin() from auth.ts exactly — same token shape,
 * same cookie names, same DB row.
 */
export async function _issueTokensForUser(
  res:      Response,
  userId:   string,
  tenantId: string,
  role:     string,
  ipAddress?: string,
  userAgent?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessJti = randomBytes(16).toString('hex')
  const accessToken = jwt.sign(
    { sub: userId, tid: tenantId, role, jti: accessJti },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL } as SignOptions
  )

  const refreshJti   = randomBytes(16).toString('hex')
  const refreshToken = jwt.sign(
    { sub: userId, tid: tenantId, role, jti: refreshJti },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL } as SignOptions
  )
  const refreshHash = createHash('sha256').update(refreshToken).digest('hex')

  // Persist refresh token
  await query(
    `INSERT INTO refresh_tokens (tenant_id,user_id,jti,token_hash,ip_address,user_agent,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '7 days')`,
    [tenantId, userId, refreshJti, refreshHash, ipAddress ?? null, userAgent?.slice(0, 255) ?? null]
  )

  // Register in Redis revocation store
  const store = getTokenStore()
  await store.addRefreshToken(refreshJti, Date.now() + REFRESH_TTL_SECONDS * 1000)

  // Set cookies
  res.cookie(COOKIE_AT_NAME, accessToken,  { ..._cookieOpts(ACCESS_TTL_SECONDS),  path: '/' })
  res.cookie(COOKIE_RT_NAME, refreshToken, { ..._cookieOpts(REFRESH_TTL_SECONDS), path: '/api/v1/auth/refresh' })

  return { accessToken, refreshToken }
}

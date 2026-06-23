/**
 * Denver Engineering — Tenant Resolution Middleware
 * ──────────────────────────────────────────
 * v4.26.0 — Extracts and validates tenant context on every request.
 *
 * Resolution order:
 *   1. JWT payload `tid` claim (preferred — set at login)
 *   2. X-Tenant-ID header (API clients / admin use)
 *   3. Host subdomain (e.g. acme.jarvis.app → slug = 'acme')
 *
 * After resolution the middleware:
 *   - Validates tenant is active
 *   - Attaches `req.tenantId` and `req.tenant` to the request
 *   - Caches tenant records for 60 seconds to avoid DB round-trips per request
 */

import { Request, Response, NextFunction } from 'express'
import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantRecord {
  id:             string
  slug:           string
  name:           string
  plan:           string
  status:         string
  settings:       Record<string, unknown>
  max_users:      number
  max_storage_gb: number
  used_storage_gb: number
}

export interface TenantRequest extends Request {
  tenantId?: string
  tenant?:   TenantRecord
}

// ─── In-process cache (60s TTL) ──────────────────────────────────────────────

const _cache = new Map<string, { tenant: TenantRecord; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

function _getCached(key: string): TenantRecord | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key)
    return null
  }
  return entry.tenant
}

function _setCache(key: string, tenant: TenantRecord): void {
  _cache.set(key, { tenant, expiresAt: Date.now() + CACHE_TTL_MS })
  // Evict old entries if cache grows large
  if (_cache.size > 1000) {
    const now = Date.now()
    for (const [k, v] of _cache.entries()) {
      if (v.expiresAt < now) _cache.delete(k)
    }
  }
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

async function _lookupById(id: string): Promise<TenantRecord | null> {
  const cached = _getCached(`id:${id}`)
  if (cached) return cached

  const result = await query<TenantRecord>(
    `SELECT id, slug, name, plan, status, settings,
            max_users, max_storage_gb, used_storage_gb
     FROM tenants WHERE id = $1 LIMIT 1`,
    [id],
  )
  const tenant = result.rows[0] ?? null
  if (tenant) {
    _setCache(`id:${id}`, tenant)
    _setCache(`slug:${tenant.slug}`, tenant)
  }
  return tenant
}

async function _lookupBySlug(slug: string): Promise<TenantRecord | null> {
  const cached = _getCached(`slug:${slug}`)
  if (cached) return cached

  const result = await query<TenantRecord>(
    `SELECT id, slug, name, plan, status, settings,
            max_users, max_storage_gb, used_storage_gb
     FROM tenants WHERE slug = $1 LIMIT 1`,
    [slug],
  )
  const tenant = result.rows[0] ?? null
  if (tenant) {
    _setCache(`id:${tenant.id}`, tenant)
    _setCache(`slug:${slug}`, tenant)
  }
  return tenant
}

// ─── Slug extraction from hostname ───────────────────────────────────────────

function _slugFromHost(host: string | undefined): string | null {
  if (!host) return null
  // acme.jarvis.app → 'acme'
  // localhost:3001  → null
  const parts = host.split('.')
  if (parts.length >= 3) return parts[0] ?? null
  return null
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * requireTenant: fails with 400/403 if tenant cannot be resolved or is inactive.
 * Use on all routes that need tenant context.
 */
export function requireTenant() {
  return async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenant: TenantRecord | null = null

      // 1 — JWT payload (set by requireAuth middleware on authenticated routes)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jwtTid = (req as any).auth?.tid as string | undefined
      if (jwtTid) {
        tenant = await _lookupById(jwtTid)
      }

      // Note: X-Tenant-ID header fallback removed (P1-B security hardening).
      // Tenant must be derived from the verified JWT tid claim on authenticated routes.
      // The header fallback created a footgun where routes without requireAuth could
      // accept an arbitrary tenant ID from the caller.

      // 2 — Subdomain (for multi-tenant SaaS routing, e.g. acme.jarvis.app)
      if (!tenant) {
        const slug = _slugFromHost(req.headers.host)
        if (slug) {
          tenant = await _lookupBySlug(slug)
        }
      }

      if (!tenant) {
        res.status(400).json({ error: 'tenant_required', message: 'Tenant context could not be resolved.' })
        return
      }

      if (tenant.status !== 'active') {
        slog('WARN', 'tenant', '[middleware] Rejected inactive tenant', { tenantId: tenant.id, status: tenant.status })
        res.status(403).json({ error: 'tenant_inactive', message: `Tenant account is ${tenant.status}.` })
        return
      }

      req.tenantId = tenant.id
      req.tenant   = tenant
      next()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      slog('ERROR', 'tenant', '[middleware] Tenant resolution error', { message: msg })
      res.status(500).json({ error: 'internal_error', message: 'Failed to resolve tenant context.' })
    }
  }
}

/**
 * optionalTenant: resolves tenant if possible but does not block the request.
 * Use on routes that may or may not need tenant context (e.g. public health).
 */
export function optionalTenant() {
  return async (req: TenantRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jwtTid = (req as any).auth?.tid as string | undefined
      if (jwtTid) {
        req.tenant   = (await _lookupById(jwtTid)) ?? undefined
        req.tenantId = req.tenant?.id
      }
    } catch { /* silent */ }
    next()
  }
}

/** Invalidate cached tenant entry (call after plan/status changes). */
export function invalidateTenantCache(tenantId: string): void {
  const cached = _getCached(`id:${tenantId}`)
  if (cached) _cache.delete(`slug:${cached.slug}`)
  _cache.delete(`id:${tenantId}`)
}

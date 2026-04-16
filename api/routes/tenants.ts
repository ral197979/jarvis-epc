/**
 * JARVIS EPC — Tenant Management Routes
 * ───────────────────────────────────────
 * v4.26.0 | Tenant registration, user management, settings
 *
 * Routes:
 *   POST   /api/v1/tenants                   — Register new tenant (public, rate-limited)
 *   GET    /api/v1/tenants/me                 — Current tenant info
 *   PATCH  /api/v1/tenants/me                 — Update tenant settings
 *   GET    /api/v1/tenants/me/users           — List users in tenant
 *   POST   /api/v1/tenants/me/users           — Invite/create user
 *   PATCH  /api/v1/tenants/me/users/:userId   — Update user role/status
 *   DELETE /api/v1/tenants/me/users/:userId   — Remove user
 *   GET    /api/v1/tenants/me/usage           — Storage + user count
 */

import { Router, Response, Request } from 'express'
import bcrypt from 'bcrypt'
import { query, tenantQuery, tenantTransaction } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest, invalidateTenantCache } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import rateLimit from 'express-rate-limit'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()

const _regEnv = parseInt(process.env.RATE_LIMIT_REGISTER_MAX ?? '', 10)
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max:      Number.isFinite(_regEnv) && _regEnv > 0 ? _regEnv : 60,
  message:  { error: 'rate_limited', message: 'Too many registration attempts.' },
})

// ─── POST /tenants — Public registration ────────────────────────────────────

router.post('/', registrationLimiter, async (req: Request, res: Response) => {
  const { companyName, slug, ownerName, ownerEmail, ownerPassword, plan = 'trial' } = req.body as Record<string, unknown>

  if (!companyName || !slug || !ownerName || !ownerEmail || !ownerPassword) {
    res.status(422).json({ error: 'validation', message: 'companyName, slug, ownerName, ownerEmail, ownerPassword all required.' })
    return
  }

  const slugStr = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slugStr)) {
    res.status(422).json({ error: 'validation', message: 'slug must be 3-63 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphens.' })
    return
  }
  if (String(ownerPassword).length < 8) {
    res.status(422).json({ error: 'validation', message: 'Password must be at least 8 characters.' })
    return
  }

  try {
    const passwordHash = await bcrypt.hash(String(ownerPassword), 12)

    const { tenant, user } = await (async () => {
      // Check slug uniqueness
      const slugCheck = await query('SELECT id FROM tenants WHERE slug=$1', [slugStr])
      if (slugCheck.rows.length > 0) {
        throw Object.assign(new Error('Slug already taken'), { status: 409, code: 'slug_taken' })
      }

      // Create tenant
      const tenantRes = await query<{ id: string; slug: string; name: string; plan: string; status: string }>(
        `INSERT INTO tenants (slug,name,plan,status) VALUES ($1,$2,$3,'active') RETURNING id,slug,name,plan,status`,
        [slugStr, String(companyName), String(plan)]
      )
      const tenant = tenantRes.rows[0]!

      // Create owner user (with tenant context for RLS)
      const userRes = await query(
        `INSERT INTO users (tenant_id,email,display_name,password_hash,role)
         VALUES ($1,$2,$3,$4,'owner') RETURNING id,email,display_name,role`,
        [tenant.id, String(ownerEmail).toLowerCase(), String(ownerName), passwordHash]
      )

      return { tenant, user: userRes.rows[0] }
    })()

    slog('INFO', 'tenants', '[register] New tenant registered', { tenantId: tenant.id, slug: tenant.slug })
    res.status(201).json({ data: { tenant, user } })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any
    if (e?.code === 'slug_taken' || e?.status === 409) {
      res.status(409).json({ error: 'slug_taken', message: 'That company slug is already taken.' })
      return
    }
    if (e?.code === '23505') {  // pg unique violation on email
      res.status(409).json({ error: 'email_taken', message: 'That email address is already registered.' })
      return
    }
    slog('ERROR', 'tenants', '[register] Failed', { message: e?.message })
    res.status(500).json({ error: 'internal_error' })
  }
})

// ─── Auth middleware for remaining routes ─────────────────────────────────────

router.use(requireAuth as never, requireTenant() as never)

// ─── GET /tenants/me ──────────────────────────────────────────────────────────

router.get('/me', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await query(
    `SELECT id,slug,name,plan,status,domain,settings,max_users,max_storage_gb,used_storage_gb,created_at
     FROM tenants WHERE id=$1`,
    [tenantId]
  )
  res.json({ data: result.rows[0] })
})

// ─── PATCH /tenants/me ────────────────────────────────────────────────────────

router.patch('/me', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  const fields = ['name','domain','settings']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f}=$${i++}`)
      vals.push(f === 'settings' ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }

  vals.push(tenantId)
  const result = await query(
    `UPDATE tenants SET ${sets.join(',')} WHERE id=$${i} RETURNING id,slug,name,plan,status,domain,settings,max_users`,
    vals
  )
  invalidateTenantCache(tenantId)
  res.json({ data: result.rows[0] })
})

// ─── GET /tenants/me/users ────────────────────────────────────────────────────

router.get('/me/users', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const data = await tenantQuery(tenantId, `
    SELECT id,email,display_name,role,is_active,last_login,login_count,avatar_url,created_at
    FROM users
    WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid
    ORDER BY display_name ASC
  `, [])
  res.json({ data: data.rows })
})

// ─── POST /tenants/me/users — Invite/create user ──────────────────────────────

router.post('/me/users', async (req: Req, res: Response) => {
  const { tenantId, tenant } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  const { email, displayName, role = 'viewer', password } = req.body as Record<string, unknown>
  if (!email || !displayName || !password) {
    res.status(422).json({ error: 'validation', message: 'email, displayName, password required' })
    return
  }

  // Check user limit
  const countRes = await tenantQuery<{ count: string }>(tenantId,
    'SELECT COUNT(*)::text AS count FROM users WHERE tenant_id=current_setting(\'app.current_tenant_id\',true)::uuid AND is_active=true',
    []
  )
  const userCount = parseInt(countRes.rows[0]?.count ?? '0', 10)
  if (userCount >= (tenant?.max_users ?? 5)) {
    res.status(429).json({ error: 'user_limit_reached', message: `Tenant is at maximum user limit (${tenant?.max_users}).` })
    return
  }

  const passwordHash = await bcrypt.hash(String(password), 12)

  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO users (tenant_id,email,display_name,password_hash,role)
      VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4)
      RETURNING id,email,display_name,role,is_active,created_at
    `, [String(email).toLowerCase(), String(displayName), passwordHash, String(role)])

    slog('INFO', 'tenants', '[users] User created', { tenantId, userId: result.rows[0].id, role })
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.code === '23505') {
      res.status(409).json({ error: 'email_taken', message: 'Email already exists in this tenant.' })
      return
    }
    throw err
  }
})

// ─── PATCH /tenants/me/users/:userId ─────────────────────────────────────────

router.patch('/me/users/:userId', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }

  // Cannot modify self via this endpoint
  if (req.params['userId'] === req.auth?.sub) {
    res.status(400).json({ error: 'self_modification', message: 'Use /api/v1/auth/me to update your own profile.' })
    return
  }

  const fields = ['display_name','role','is_active','avatar_url']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f}=$${i++}`)
      vals.push(req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }

  vals.push(req.params['userId'])
  const result = await tenantQuery(tenantId, `
    UPDATE users SET ${sets.join(',')}
    WHERE id=$${i} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
    RETURNING id,email,display_name,role,is_active,avatar_url
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── DELETE /tenants/me/users/:userId ────────────────────────────────────────

router.delete('/me/users/:userId', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin'].includes(req.auth?.role ?? '')) { res.status(403).json({ error: 'forbidden' }); return }
  if (req.params['userId'] === req.auth?.sub) {
    res.status(400).json({ error: 'self_deletion', message: 'Cannot delete your own account.' })
    return
  }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM users WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid RETURNING id
  `, [req.params['userId']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── GET /tenants/me/usage ────────────────────────────────────────────────────

router.get('/me/usage', async (req: Req, res: Response) => {
  const { tenantId, tenant } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [usersRes, storageRes] = await Promise.all([
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM users
      WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid AND is_active=true
    `, []),
    query<{ used: string; max: string }>(
      'SELECT used_storage_gb::text AS used, max_storage_gb::text AS max FROM tenants WHERE id=$1',
      [tenantId]
    ),
  ])

  const userCount  = parseInt(usersRes.rows[0]?.count ?? '0', 10)
  const storageUsed = parseFloat(storageRes.rows[0]?.used ?? '0')
  const storageMax  = parseFloat(storageRes.rows[0]?.max  ?? '10')

  res.json({
    data: {
      users:   { used: userCount,   max: tenant?.max_users ?? 5 },
      storage: { usedGb: storageUsed, maxGb: storageMax, percentUsed: (storageUsed / storageMax * 100).toFixed(1) },
    },
  })
})

export default router

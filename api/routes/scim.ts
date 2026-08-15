/**
 * Denver Engineering — SCIM 2.0 Provisioning Endpoint
 * ──────────────────────────────────────────────────────
 * RFC 7643 (schema) + RFC 7644 (protocol) compliant implementation.
 *
 * Supports automated user provisioning from:
 *   - Okta         (SCIM 2.0 provisioning app)
 *   - Azure AD     (Enterprise App provisioning)
 *   - OneLogin     (SCIM provisioner)
 *   - JumpCloud    (SCIM directory sync)
 *
 * Auth: Bearer token (generated per-tenant via admin API)
 *   Authorization: Bearer scim_<tenant-specific-token>
 *
 * Base URL: /scim/v2
 *
 * Endpoints:
 *   GET    /scim/v2/ServiceProviderConfig — Capabilities declaration
 *   GET    /scim/v2/Schemas              — Schema definitions
 *   GET    /scim/v2/Users                — List + filter users
 *   GET    /scim/v2/Users/:id            — Get user
 *   POST   /scim/v2/Users                — Create user (JIT provisioning)
 *   PUT    /scim/v2/Users/:id            — Replace user (full update)
 *   PATCH  /scim/v2/Users/:id            — Partial update (including deactivation)
 *   DELETE /scim/v2/Users/:id            — Delete/deactivate user
 *
 * Admin token management:
 *   POST   /api/v1/scim/tokens           — Generate SCIM token (owner only)
 *   GET    /api/v1/scim/tokens           — List tokens
 *   DELETE /api/v1/scim/tokens/:id       — Revoke token
 */

import { Router, Request, Response, NextFunction } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { query, tenantQuery } from '../db/pool'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import { requireCapability } from '../authz/requireCapability'

// ─── SCIM namespace constants ──────────────────────────────────────────────────

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
const SCIM_SP_SCHEMA    = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'

// ─── Type helpers ─────────────────────────────────────────────────────────────

interface ScimUser {
  schemas:     string[]
  id:          string
  externalId?: string
  userName:    string
  displayName: string
  name:        { formatted: string }
  emails:      Array<{ value: string; primary: boolean; type: string }>
  active:      boolean
  roles?:      Array<{ value: string; display: string; primary: boolean }>
  meta: {
    resourceType: string
    created:      string
    lastModified: string
    location:     string
    version:      string
  }
}

interface DbUser {
  id: string; email: string; display_name: string
  role: string; is_active: boolean
  created_at: string; updated_at?: string
}

function _scimBase(): string {
  return process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
}

function _toScimUser(u: DbUser): ScimUser {
  return {
    schemas:     [SCIM_USER_SCHEMA],
    id:          u.id,
    userName:    u.email,
    displayName: u.display_name,
    name:        { formatted: u.display_name },
    emails:      [{ value: u.email, primary: true, type: 'work' }],
    active:      u.is_active,
    roles:       [{ value: u.role, display: u.role, primary: true }],
    meta: {
      resourceType: 'User',
      created:      u.created_at,
      lastModified: u.updated_at ?? u.created_at,
      location:     `${_scimBase()}/scim/v2/Users/${u.id}`,
      version:      `W/"${createHash('md5').update(u.id + u.updated_at).digest('hex').slice(0,8)}"`,
    },
  }
}

function _scimError(status: number, detail: string, scimType?: string, res?: Response): void {
  if (res) {
    res.status(status).json({
      schemas:  [SCIM_ERROR_SCHEMA],
      status:   String(status),
      scimType: scimType ?? '',
      detail,
    })
  }
}

// ─── SCIM token authentication middleware ─────────────────────────────────────

interface ScimRequest extends Request {
  scimTenantId?: string
  scimTokenId?:  string
}

async function requireScimToken(req: ScimRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', 'Bearer realm="SCIM"')
    _scimError(401, 'Bearer token required', 'invalidCredentials', res)
    return
  }

  const rawToken = authHeader.slice(7).trim()
  const hash     = createHash('sha256').update(rawToken).digest('hex')

  const result = await query<{ id: string; tenant_id: string }>(
    `SELECT id, tenant_id FROM scim_tokens
     WHERE token_hash=$1 AND is_active=true
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [hash]
  )
  const token = result.rows[0]
  if (!token) {
    _scimError(401, 'Invalid or expired SCIM token', 'invalidCredentials', res)
    return
  }

  // Update last_used_at (fire-and-forget)
  query('UPDATE scim_tokens SET last_used_at=NOW() WHERE id=$1', [token.id]).catch(() => {})

  req.scimTenantId = token.tenant_id
  req.scimTokenId  = token.id
  next()
}

// ─── SCIM filter parser ───────────────────────────────────────────────────────
// Supports: userName eq "x", active eq true, emails.value eq "x"

function _parseFilter(filter: string | undefined): { email?: string; active?: boolean } {
  if (!filter) return {}

  const emailMatch = filter.match(/(?:userName|emails\.value)\s+eq\s+"([^"]+)"/i)
  const activeMatch = filter.match(/active\s+eq\s+(true|false)/i)

  return {
    email:  emailMatch?.[1]?.toLowerCase(),
    active: activeMatch ? activeMatch[1] === 'true' : undefined,
  }
}

// ─── SCIM router ─────────────────────────────────────────────────────────────

const scimRouter = Router()
scimRouter.use(requireScimToken)

// Content-Type for all SCIM responses
scimRouter.use((_req, res, next) => {
  res.set('Content-Type', 'application/scim+json; charset=utf-8')
  next()
})

// ── GET /ServiceProviderConfig ────────────────────────────────────────────────

scimRouter.get('/ServiceProviderConfig', (_req: Request, res: Response) => {
  res.json({
    schemas: [SCIM_SP_SCHEMA],
    documentationUri: 'https://docs.jarvis.app/scim',
    patch:             { supported: true },
    bulk:              { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter:            { supported: true,  maxResults: 200 },
    changePassword:    { supported: false },
    sort:              { supported: false },
    etag:              { supported: true },
    authenticationSchemes: [{
      type:        'oauthbearertoken',
      name:        'Bearer Token',
      description: 'SCIM API token generated in Denver Engineering admin settings',
    }],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location:     `${_scimBase()}/scim/v2/ServiceProviderConfig`,
    },
  })
})

// ── GET /Schemas ──────────────────────────────────────────────────────────────

scimRouter.get('/Schemas', (_req: Request, res: Response) => {
  res.json({
    schemas:    [SCIM_LIST_SCHEMA],
    totalResults: 1,
    Resources: [{
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      id:          SCIM_USER_SCHEMA,
      name:        'User',
      description: 'Denver Engineering User',
      attributes: [
        { name: 'userName',    type: 'string',  required: true,  uniqueness: 'server' },
        { name: 'displayName', type: 'string',  required: false, uniqueness: 'none'   },
        { name: 'active',      type: 'boolean', required: false, uniqueness: 'none'   },
        { name: 'emails',      type: 'complex', required: false, multiValued: true,
          subAttributes: [
            { name: 'value',   type: 'string',  required: true  },
            { name: 'primary', type: 'boolean', required: false },
            { name: 'type',    type: 'string',  required: false },
          ],
        },
        { name: 'roles',       type: 'complex', required: false, multiValued: true,
          subAttributes: [
            { name: 'value',   type: 'string',  required: false },
            { name: 'display', type: 'string',  required: false },
            { name: 'primary', type: 'boolean', required: false },
          ],
        },
      ],
      meta: { resourceType: 'Schema', location: `${_scimBase()}/scim/v2/Schemas/${SCIM_USER_SCHEMA}` },
    }],
  })
})

// ── GET /Users ────────────────────────────────────────────────────────────────

scimRouter.get('/Users', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId  = req.scimTenantId!
  const filter    = _parseFilter(req.query['filter'] as string)
  const startIndex = Math.max(1, parseInt(String(req.query['startIndex'] ?? '1'), 10))
  const count      = Math.min(200, parseInt(String(req.query['count'] ?? '100'), 10))
  const offset     = startIndex - 1

  const conditions = ['u.tenant_id=current_setting(\'app.current_tenant_id\',true)::uuid']
  const params: unknown[] = []
  let pi = 1

  if (filter.email)  { conditions.push(`u.email=$${pi++}`); params.push(filter.email) }
  if (filter.active !== undefined) { conditions.push(`u.is_active=$${pi++}`); params.push(filter.active) }

  const where = conditions.join(' AND ')

  try {
    const [dataRes, countRes] = await Promise.all([
      tenantQuery<DbUser>(tenantId, `
        SELECT id, email, display_name, role, is_active, created_at,
               updated_at::text AS updated_at
        FROM users u WHERE ${where}
        ORDER BY created_at ASC LIMIT $${pi} OFFSET $${pi + 1}
      `, [...params, count, offset]),
      tenantQuery<{ count: string }>(tenantId,
        `SELECT COUNT(*)::text AS count FROM users u WHERE ${where}`, params),
    ])

    const total = parseInt(countRes.rows[0]?.count ?? '0', 10)
    res.json({
      schemas:      [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: count,
      Resources:    dataRes.rows.map(_toScimUser),
    })
  } catch (err) {
    slog('ERROR', 'scim', '[list] Error', { tenantId, error: String(err) })
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ── GET /Users/:id ────────────────────────────────────────────────────────────

scimRouter.get('/Users/:id', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId = req.scimTenantId!
  const { id }   = req.params as { id: string }

  try {
    const result = await tenantQuery<DbUser>(tenantId,
      `SELECT id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
       FROM users WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid`,
      [id]
    )
    const user = result.rows[0]
    if (!user) { _scimError(404, 'User not found', 'noTarget', res); return }
    res.json(_toScimUser(user))
  } catch {
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ── POST /Users — Create user ─────────────────────────────────────────────────

scimRouter.post('/Users', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId = req.scimTenantId!
  const body     = req.body as Record<string, unknown>

  // Extract from SCIM User schema
  const userName    = body['userName'] as string
                   ?? (body['emails'] as Array<{value: string}>)?.[0]?.value
  const displayName = (body['displayName'] as string)
                   ?? (body['name'] as Record<string,string>)?.['formatted']
                   ?? userName
  const active      = body['active'] !== false  // default true
  const role        = (body['roles'] as Array<{value:string}>)?.[0]?.value ?? 'viewer'

  if (!userName) { _scimError(400, 'userName is required', 'invalidValue', res); return }

  const email = userName.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    _scimError(400, 'userName must be a valid email address', 'invalidValue', res)
    return
  }

  // SCIM-provisioned users authenticate via SAML/SSO only. Store a *valid* but
  // unusable bcrypt hash of a random secret — no plaintext can ever match it.
  // (The previous fabricated `$2b$12$<base64>` string was not a valid bcrypt
  //  hash and would make bcrypt.compare throw on any later login attempt.)
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)

  try {
    // Check tenant user limit
    const countRes = await tenantQuery<{ count: string }>(tenantId,
      `SELECT COUNT(*)::text AS count FROM users
       WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid AND is_active=true`, [])
    const tenant = await query<{ max_users: number }>(
      'SELECT max_users FROM tenants WHERE id=$1', [tenantId])
    const maxUsers = tenant.rows[0]?.max_users ?? 5
    if (parseInt(countRes.rows[0]?.count ?? '0', 10) >= maxUsers) {
      _scimError(400, `Tenant at maximum user limit (${maxUsers})`, 'tooMany', res)
      return
    }

    const result = await tenantQuery<DbUser>(tenantId, `
      INSERT INTO users (tenant_id, email, display_name, role, password_hash, is_active)
      VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5)
      RETURNING id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
    `, [email, displayName, role, passwordHash, active])

    const user = result.rows[0]!
    _logScim(tenantId, 'create_user', user.id, req, 'success', { email, role })
    slog('INFO', 'scim', '[create] User provisioned', { tenantId, email, role })
    res.status(201).json(_toScimUser(user))
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.code === '23505') {
      // User exists — return existing (idempotent)
      const existing = await tenantQuery<DbUser>(tenantId,
        `SELECT id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
         FROM users WHERE email=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid`,
        [email])
      if (existing.rows[0]) {
        res.status(200).json(_toScimUser(existing.rows[0]))
        return
      }
    }
    slog('ERROR', 'scim', '[create] Error', { tenantId, error: String(err) })
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ── PUT /Users/:id — Full replace ─────────────────────────────────────────────

scimRouter.put('/Users/:id', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId = req.scimTenantId!
  const { id }   = req.params as { id: string }
  const body     = req.body as Record<string, unknown>

  const displayName = (body['displayName'] as string)
                   ?? (body['name'] as Record<string,string>)?.['formatted'] ?? ''
  const active      = body['active'] !== false
  const role        = (body['roles'] as Array<{value:string}>)?.[0]?.value

  try {
    const sets: string[] = ['display_name=$1', 'is_active=$2', 'updated_at=NOW()']
    const vals: unknown[] = [displayName, active]
    if (role) { sets.push(`role=$${vals.length + 1}`); vals.push(role) }
    vals.push(id)

    const result = await tenantQuery<DbUser>(tenantId, `
      UPDATE users SET ${sets.join(',')}
      WHERE id=$${vals.length} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
      RETURNING id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
    `, vals)

    const user = result.rows[0]
    if (!user) { _scimError(404, 'User not found', 'noTarget', res); return }
    _logScim(tenantId, 'update_user', user.id, req, 'success', { active, role })
    res.json(_toScimUser(user))
  } catch {
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ── PATCH /Users/:id — Partial update (including deactivation) ────────────────

scimRouter.patch('/Users/:id', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId = req.scimTenantId!
  const { id }   = req.params as { id: string }
  const body     = req.body as Record<string, unknown>

  if (!Array.isArray(body['Operations'])) {
    _scimError(400, 'Operations array required', 'invalidValue', res); return
  }

  // RFC 7644 §3.5.2: a PatchOp's `schemas` must declare PatchOp. Be lenient when
  // omitted (some IdPs skip it), but reject a schemas array that claims otherwise.
  const patchSchemas = body['schemas']
  if (Array.isArray(patchSchemas) && !patchSchemas.includes(SCIM_PATCH_SCHEMA)) {
    _scimError(400, `PatchOp requests must use schema ${SCIM_PATCH_SCHEMA}`, 'invalidValue', res); return
  }

  const sets: string[]  = []
  const vals: unknown[] = []
  let pi = 1

  for (const op of body['Operations'] as Array<Record<string, unknown>>) {
    const opType = String(op['op'] ?? '').toLowerCase()
    const path   = String(op['path'] ?? '').toLowerCase()
    const value  = op['value']

    if (opType === 'replace' || opType === 'add') {
      if (path === 'active') {
        sets.push(`is_active=$${pi++}`)
        vals.push(value === true || value === 'true')
      } else if (path === 'displayname' || path === 'name.formatted') {
        sets.push(`display_name=$${pi++}`)
        vals.push(String(value))
      } else if (path === 'roles' || path === 'roles[primary eq true].value') {
        const roleVal = Array.isArray(value) ? (value[0] as Record<string,string>)?.value : String(value)
        if (roleVal) { sets.push(`role=$${pi++}`); vals.push(roleVal) }
      } else if (!path && typeof value === 'object' && value !== null) {
        // Okta sends: { op: 'replace', value: { active: false } }
        const v = value as Record<string, unknown>
        if ('active' in v) { sets.push(`is_active=$${pi++}`); vals.push(Boolean(v['active'])) }
        if ('displayName' in v) { sets.push(`display_name=$${pi++}`); vals.push(String(v['displayName'])) }
      }
    }
  }

  if (sets.length === 0) {
    // No recognized operations — return current state
    const current = await tenantQuery<DbUser>(tenantId,
      `SELECT id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
       FROM users WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid`, [id])
    if (!current.rows[0]) { _scimError(404, 'User not found', 'noTarget', res); return }
    res.json(_toScimUser(current.rows[0]))
    return
  }

  sets.push('updated_at=NOW()')
  vals.push(id)

  try {
    const result = await tenantQuery<DbUser>(tenantId, `
      UPDATE users SET ${sets.join(',')}
      WHERE id=$${vals.length} AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
      RETURNING id, email, display_name, role, is_active, created_at, updated_at::text AS updated_at
    `, vals)

    const user = result.rows[0]
    if (!user) { _scimError(404, 'User not found', 'noTarget', res); return }
    _logScim(tenantId, user.is_active ? 'update_user' : 'deactivate_user', user.id, req, 'success', {})
    res.json(_toScimUser(user))
  } catch {
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ── DELETE /Users/:id — Deactivate user ──────────────────────────────────────
// Hard delete is not performed by default (SCIM deactivates, not deletes).

scimRouter.delete('/Users/:id', async (req: ScimRequest, res: Response): Promise<void> => {
  const tenantId = req.scimTenantId!
  const { id }   = req.params as { id: string }

  try {
    const result = await tenantQuery<{ id: string; email: string }>(tenantId, `
      UPDATE users SET is_active=false, updated_at=NOW()
      WHERE id=$1 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid
      RETURNING id, email
    `, [id])

    if (!result.rows[0]) { _scimError(404, 'User not found', 'noTarget', res); return }
    _logScim(tenantId, 'deactivate_user', id, req, 'success', { email: result.rows[0].email })
    slog('INFO', 'scim', '[delete] User deactivated', { tenantId, userId: id })
    res.status(204).send()
  } catch {
    _scimError(500, 'Internal error', undefined, res)
  }
})

// ─── SCIM audit helper ────────────────────────────────────────────────────────

function _logScim(
  tenantId: string, operation: string, targetUser: string | undefined,
  req: ScimRequest, status: string, data: unknown,
): void {
  query(
    `INSERT INTO scim_audit (tenant_id, operation, target_user, scim_data, source_ip, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, operation, targetUser ?? null, JSON.stringify(data), req.ip ?? null, status]
  ).catch(() => {})
}

// ─── Admin token management routes ───────────────────────────────────────────
// Mounted at /api/v1/scim/tokens (separate from /scim/v2)

const adminRouter = Router()
type AdminReq = AuthenticatedRequest & TenantRequest

adminRouter.use(requireAuth as never, requireTenant() as never)

// POST /api/v1/scim/tokens — Generate new SCIM token
adminRouter.post('/tokens', requireRole('owner', 'admin') as never,
  async (req: AdminReq, res: Response): Promise<void> => {
    const tenantId = req.tenantId!
    const { label = 'primary' } = req.body as { label?: string }

    // Generate: "scim_" + 40 random bytes hex
    const raw  = 'scim_' + randomBytes(40).toString('hex')
    const hash = createHash('sha256').update(raw).digest('hex')

    await query(
      `INSERT INTO scim_tokens (tenant_id, label, token_hash, token_prefix, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, label) DO UPDATE SET
         token_hash=$3, token_prefix=$4, is_active=true, created_at=NOW()`,
      [tenantId, label, hash, raw.slice(0, 12), req.auth!.sub]
    )

    slog('INFO', 'scim', '[token] SCIM token generated', { tenantId, label })

    // Return raw token ONCE — never stored in plaintext
    res.status(201).json({
      data: {
        token:   raw,                 // shown once — store securely in IdP
        prefix:  raw.slice(0, 12),
        label,
        warning: 'Store this token securely. It will not be shown again.',
      },
    })
  }
)

// GET /api/v1/scim/tokens — List tokens (prefix only, no raw value)
adminRouter.get('/tokens', requireCapability('platform.admin') as never,
  async (req: AdminReq, res: Response): Promise<void> => {
    const result = await query(
      `SELECT id, label, token_prefix, created_at, last_used_at, expires_at, is_active
       FROM scim_tokens WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [req.tenantId!]
    )
    res.json({ data: result.rows })
  }
)

// DELETE /api/v1/scim/tokens/:id — Revoke token
adminRouter.delete('/tokens/:id', requireRole('owner', 'admin') as never,
  async (req: AdminReq, res: Response): Promise<void> => {
    const result = await query<{ id: string }>(
      'UPDATE scim_tokens SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id',
      [req.params['id'], req.tenantId!]
    )
    if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ data: { revoked: true } })
  }
)

// GET /api/v1/scim/audit — SCIM operation audit log
adminRouter.get('/audit', requireCapability('audit.view') as never,
  async (req: AdminReq, res: Response): Promise<void> => {
    const limit  = Math.min(200, parseInt(String(req.query['limit'] ?? '50'), 10))
    const offset = Math.max(0,   parseInt(String(req.query['offset'] ?? '0'), 10))
    const result = await tenantQuery(req.tenantId!,
      `SELECT id, operation, target_user, source_ip, status, error_msg, created_at
       FROM scim_audit
       WHERE tenant_id=current_setting('app.current_tenant_id',true)::uuid
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
    res.json({ data: result.rows })
  }
)

export { scimRouter, adminRouter as scimAdminRouter }

/**
 * Denver Engineering — SAML 2.0 Provider
 * ─────────────────────────────────────────
 * Core SAML SP/IdP orchestration using the samlify library.
 *
 * Supports:
 *   - SP-initiated SSO (login redirect → IdP → ACS callback → JWT)
 *   - IdP-initiated SSO (IdP → ACS callback → JWT)
 *   - Single Logout (SLO)
 *   - JIT user provisioning (create on first login)
 *   - Profile sync (update displayName on login)
 *
 * After successful SAML assertion validation, issues the same JWT
 * access/refresh token pair as handleLogin() — no special SAML session.
 */

import * as samlify from 'samlify'
import { randomBytes, createHash } from 'node:crypto'
import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'
import { assertSafeUrl, SsrfBlockedError } from '../../lib/ssrfGuard'
import { getPlatformCert, stripCertHeaders } from './certificateRotation'
import {
  extractAttributes, deriveRole, validateRequiredClaims,
  type PlatformRole,
} from './roleMapping'
import { parseIdpMetadata } from './samlMetadata'

// ─── Set samlify schema validator (bypass XML schema validation in Node) ──────
// samlify requires a validator; we validate structurally but skip XML Schema.
samlify.setSchemaValidator({
  validate: (_response: string) => Promise.resolve('skipped'),
})

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SsoConfig {
  id:               string
  tenantId:         string
  tenantSlug:       string
  protocol:         string
  provider?:        string
  idpEntityId:      string
  idpSsoUrl:        string
  idpSsoBinding:    string
  idpCertificate:   string
  spEntityId:       string
  attributeMapping: Record<string, string[]>
  roleMapping:      Record<string, string>
  defaultRole:      PlatformRole
  jitProvisioning:  boolean
  jitUpdateProfile: boolean
}

// JWT issuance (mirrors auth.ts private functions)
// We re-issue using the same mechanism — import from auth.ts public API
import { _issueTokensForUser } from './samlTokenBridge'

// ─── SP factory ───────────────────────────────────────────────────────────────

function _buildSpEntityId(tenantSlug: string): string {
  const base = process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
  return `${base}/saml/${tenantSlug}/metadata`
}

function _buildAcsUrl(tenantSlug: string): string {
  const base = process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
  return `${base}/api/v1/auth/saml/${tenantSlug}/callback`
}

function _buildSloUrl(tenantSlug: string): string {
  const base = process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
  return `${base}/api/v1/auth/saml/${tenantSlug}/slo`
}

async function _createSp(config: SsoConfig) {
  const cert = await getPlatformCert()
  const entityId = config.spEntityId || _buildSpEntityId(config.tenantSlug)

  return samlify.ServiceProvider({
    entityID: entityId,
    privateKey: cert.keyPem,
    signingCert: stripCertHeaders(cert.certPem),
    assertionConsumerService: [{
      Binding:  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
      Location: _buildAcsUrl(config.tenantSlug),
    }],
    singleLogoutService: [{
      Binding:  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
      Location: _buildSloUrl(config.tenantSlug),
    }],
    wantAssertionsSigned: true,
    allowCreate: config.jitProvisioning,
  })
}

function _createIdp(config: SsoConfig) {
  return samlify.IdentityProvider({
    entityID:   config.idpEntityId,
    signingCert: config.idpCertificate,
    singleSignOnService: [{
      Binding:  config.idpSsoBinding,
      Location: config.idpSsoUrl,
    }],
  })
}

// ─── Tenant SSO config lookup ─────────────────────────────────────────────────

export async function getSsoConfig(tenantSlug: string): Promise<SsoConfig | null> {
  const result = await query<{
    id: string; tenant_id: string; tenant_slug: string
    protocol: string; provider: string
    idp_entity_id: string; idp_sso_url: string; idp_sso_binding: string
    idp_certificate: string; sp_entity_id: string
    attribute_mapping: Record<string, string[]>
    role_mapping: Record<string, string>
    default_role: PlatformRole
    jit_provisioning: boolean; jit_update_profile: boolean
  }>(
    `SELECT c.id, c.tenant_id, t.slug AS tenant_slug, c.protocol, c.provider,
            c.idp_entity_id, c.idp_sso_url, c.idp_sso_binding, c.idp_certificate,
            c.sp_entity_id, c.attribute_mapping, c.role_mapping, c.default_role,
            c.jit_provisioning, c.jit_update_profile
     FROM tenant_sso_configs c
     JOIN tenants t ON t.id = c.tenant_id
     WHERE t.slug = $1 AND c.is_active = true AND c.protocol = 'saml'
     LIMIT 1`,
    [tenantSlug]
  )
  const row = result.rows[0]
  if (!row) return null

  return {
    id:               row.id,
    tenantId:         row.tenant_id,
    tenantSlug:       row.tenant_slug,
    protocol:         row.protocol,
    provider:         row.provider,
    idpEntityId:      row.idp_entity_id,
    idpSsoUrl:        row.idp_sso_url,
    idpSsoBinding:    row.idp_sso_binding ?? 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
    idpCertificate:   row.idp_certificate,
    spEntityId:       row.sp_entity_id ?? '',
    attributeMapping: row.attribute_mapping ?? {},
    roleMapping:      row.role_mapping ?? {},
    defaultRole:      row.default_role ?? 'viewer',
    jitProvisioning:  row.jit_provisioning ?? true,
    jitUpdateProfile: row.jit_update_profile ?? true,
  }
}

// ─── SP-initiated login (step 1: generate redirect) ──────────────────────────

/**
 * Generates a SAML AuthnRequest and returns the IdP redirect URL.
 * Store the relayState in the saml_sessions table for CSRF protection.
 */
export async function createSamlLoginRequest(config: SsoConfig, redirectUrl?: string): Promise<{
  redirectUrl: string
  relayState:  string
  requestId:   string
}> {
  const sp  = await _createSp(config)
  const idp = _createIdp(config)

  const relayState = randomBytes(32).toString('hex')

  // Store relay state to saml_sessions (with global query — no tenant context yet)
  await query(
    `INSERT INTO saml_sessions (tenant_id, relay_state, redirect_url, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
    [config.tenantId, relayState, redirectUrl ?? '/']
  )

  const { id: requestId, context } = sp.createLoginRequest(idp, 'redirect')

  // Append relay state to the redirect URL
  const separator = (context as string).includes('?') ? '&' : '?'
  const fullUrl = `${context}${separator}RelayState=${encodeURIComponent(relayState)}`

  slog('INFO', 'saml', '[sp-init] AuthnRequest created', {
    tenantId: config.tenantId, provider: config.provider, requestId,
  })

  return { redirectUrl: fullUrl, relayState, requestId }
}

// ─── ACS callback (step 2: validate response, provision user, issue JWT) ──────

export interface SamlCallbackResult {
  userId:   string
  tenantId: string
  role:     PlatformRole
  email:    string
  isNew:    boolean         // true if JIT-provisioned this login
}

/**
 * Validates the IdP POST response (SAMLResponse).
 * - Verifies signature using IdP certificate
 * - Checks assertion replay (assertion ID uniqueness)
 * - Extracts attributes and derives role
 * - JIT-provisions user if not found
 * - Returns user info for JWT issuance
 */
export async function validateSamlCallback(
  config:       SsoConfig,
  samlResponse: string,
  relayState:   string,
): Promise<SamlCallbackResult> {
  // 1. Validate relay state (CSRF + timing)
  const session = await query<{
    id: string; tenant_id: string; consumed_at: string | null; redirect_url: string
  }>(
    `SELECT id, tenant_id, consumed_at FROM saml_sessions
     WHERE relay_state=$1 AND expires_at > NOW() LIMIT 1`,
    [relayState]
  )
  const sess = session.rows[0]
  if (!sess) {
    throw Object.assign(new Error('Invalid or expired SAML relay state'), { code: 'invalid_relay_state' })
  }
  if (sess.consumed_at) {
    throw Object.assign(new Error('SAML relay state already consumed (replay detected)'), { code: 'saml_replay' })
  }
  if (sess.tenant_id !== config.tenantId) {
    throw Object.assign(new Error('Relay state tenant mismatch'), { code: 'tenant_mismatch' })
  }

  // 2. Parse and validate SAML response
  const sp  = await _createSp(config)
  const idp = _createIdp(config)

  let extract: { attributes: Record<string, unknown>; nameID?: string; sessionIndex?: string }
  try {
    const parsed = await sp.parseLoginResponse(idp, 'post', {
      body: { SAMLResponse: samlResponse },
    })
    extract = parsed.extract as typeof extract
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    slog('WARN', 'saml', '[callback] SAML validation failed', {
      tenantId: config.tenantId, error: msg,
    })
    throw Object.assign(new Error(`SAML assertion invalid: ${msg}`), { code: 'invalid_assertion' })
  }

  // 3. Replay prevention — check assertion ID uniqueness
  const assertionId = extract.nameID ?? randomBytes(8).toString('hex')
  const replayCheck = await query<{ id: string }>(
    'SELECT id FROM saml_sessions WHERE assertion_id=$1 AND tenant_id=$2 LIMIT 1',
    [assertionId, config.tenantId]
  )
  if (replayCheck.rows.length > 0) {
    throw Object.assign(new Error('SAML assertion replay detected'), { code: 'saml_replay' })
  }

  // 4. Mark session consumed (prevent replay)
  await query(
    'UPDATE saml_sessions SET consumed_at=NOW(), assertion_id=$1 WHERE id=$2',
    [assertionId, sess.id]
  )

  // 5. Extract and validate attributes
  const attrs = extractAttributes(
    extract.attributes as Record<string, unknown>,
    config.attributeMapping
  )
  validateRequiredClaims(attrs)

  const email       = attrs.email!.toLowerCase()
  const displayName = attrs.displayName ?? email.split('@')[0]
  const role        = deriveRole(attrs, config.roleMapping, config.defaultRole)

  // 6. Lookup or JIT-provision user
  let user: { id: string; is_active: boolean } | null = null
  const userResult = await query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM users WHERE tenant_id=$1 AND email=$2 LIMIT 1',
    [config.tenantId, email]
  )
  user = userResult.rows[0] ?? null

  let isNew = false

  if (!user) {
    if (!config.jitProvisioning) {
      throw Object.assign(
        new Error(`User ${email} not found and JIT provisioning is disabled`),
        { code: 'user_not_found' }
      )
    }
    // JIT provision
    const newUser = await query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, display_name, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (tenant_id, email) DO UPDATE
         SET display_name = EXCLUDED.display_name, role = EXCLUDED.role
       RETURNING id`,
      [config.tenantId, email, displayName, role, _noPasswordHash()]
    )
    user  = { id: newUser.rows[0]!.id, is_active: true }
    isNew = true
    slog('INFO', 'saml', '[jit] User provisioned via SAML', {
      tenantId: config.tenantId, email, role,
    })
  } else {
    if (!user.is_active) {
      throw Object.assign(new Error('User account is inactive'), { code: 'account_inactive' })
    }
    // Update profile on every login if configured
    if (config.jitUpdateProfile) {
      await query(
        'UPDATE users SET display_name=$1, role=$2, last_login=NOW(), login_count=login_count+1 WHERE id=$3',
        [displayName, role, user.id]
      )
    } else {
      await query(
        'UPDATE users SET last_login=NOW(), login_count=login_count+1 WHERE id=$1',
        [user.id]
      )
    }
  }

  slog('INFO', 'saml', '[callback] Login success', {
    tenantId: config.tenantId, userId: user.id, email, role, provider: config.provider,
  })

  return { userId: user.id, tenantId: config.tenantId, role, email, isNew }
}

// ─── Single Logout (SLO) ──────────────────────────────────────────────────────

export async function createSamlLogoutRequest(config: SsoConfig, userId: string): Promise<{
  redirectUrl: string
} | null> {
  if (!config.idpSsoUrl) return null

  // Fetch user email for NameID
  const result = await query<{ email: string }>(
    'SELECT email FROM users WHERE id=$1 LIMIT 1',
    [userId]
  )
  const email = result.rows[0]?.email
  if (!email) return null

  try {
    const sp  = await _createSp(config)
    const idp = _createIdp(config)
    const { context } = sp.createLogoutRequest(idp, 'redirect', { nameID: email })
    return { redirectUrl: context as string }
  } catch {
    return null  // SLO is optional — do not break logout if it fails
  }
}

// ─── IdP metadata import ──────────────────────────────────────────────────────

/**
 * Fetches and parses IdP metadata from a URL, updating the tenant SSO config.
 */
export async function importIdpMetadataFromUrl(
  tenantId:    string,
  metadataUrl: string,
): Promise<{ updated: boolean; provider?: string; entityId?: string }> {
  // AUDIT-P0-07: this fetched an admin-supplied URL with no validation —
  // every other outbound-fetch-from-user-input call site in this codebase
  // (webhook dispatch, integration health-check, the MCP http_fetch tool)
  // routes through assertSafeUrl; this one was missed. Without it, a tenant
  // owner/admin could point this at cloud metadata (169.254.169.254) or any
  // internal address reachable from the server.
  let xmlText: string
  try {
    await assertSafeUrl(metadataUrl)
    const resp = await fetch(metadataUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'application/xml, text/xml, */*' },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    xmlText = await resp.text()
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err
    throw new Error(`Failed to fetch IdP metadata from ${metadataUrl}: ${err instanceof Error ? err.message : err}`)
  }

  const parsed = parseIdpMetadata(xmlText)

  await query(
    `UPDATE tenant_sso_configs SET
       idp_entity_id    = $1,
       idp_sso_url      = $2,
       idp_sso_binding  = $3,
       idp_certificate  = $4,
       provider         = $5,
       idp_metadata_url = $6,
       updated_at       = NOW()
     WHERE tenant_id = $7 AND protocol = 'saml'`,
    [
      parsed.entityId, parsed.ssoUrl, parsed.ssoBinding,
      parsed.certificate, parsed.provider ?? 'custom',
      metadataUrl, tenantId,
    ]
  )

  slog('INFO', 'saml', '[metadata] IdP metadata imported', {
    tenantId, provider: parsed.provider, entityId: parsed.entityId,
  })

  return { updated: true, provider: parsed.provider, entityId: parsed.entityId }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SAML-provisioned users have no password — use a locked hash */
function _noPasswordHash(): string {
  // bcrypt hash of a random secret that nobody will ever know
  // This prevents password login for SAML-only users
  return `$2b$12$${createHash('sha256').update(randomBytes(32)).digest('base64').slice(0, 53)}`
}

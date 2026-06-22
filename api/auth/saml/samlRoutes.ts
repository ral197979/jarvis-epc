/**
 * Denver Engineering — SAML 2.0 Routes
 * ──────────────────────────────────────
 * Express router for all SAML SSO endpoints.
 *
 * Routes (all under /api/v1/auth/saml/:tenantSlug):
 *   GET  /login      — SP-initiated SSO: redirect to IdP
 *   POST /callback   — Assertion Consumer Service (ACS): IdP posts SAMLResponse here
 *   GET  /metadata   — SP metadata XML for IdP import
 *   GET  /slo        — Single Logout Service
 *   GET  /setup      — Setup guide for configured IdP provider
 *
 * Admin routes (require owner/admin role):
 *   POST /config          — Create/update SSO configuration
 *   POST /config/metadata — Import IdP metadata from URL
 *   POST /config/test     — Test SSO configuration (dry-run)
 *   DELETE /config        — Disable SSO
 *
 * Usage in server.ts:
 *   import samlRouter from './auth/saml/samlRoutes'
 *   app.use('/api/v1/auth/saml', samlRouter)
 *   app.use('/saml', samlRouter)   // for metadata URL
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../../auth'
import { requireRole } from '../../auth'
import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'
import { authSamlLoginTotal } from '../../services/observability/metrics'
import {
  getSsoConfig, createSamlLoginRequest, validateSamlCallback,
  importIdpMetadataFromUrl,
} from './samlProvider'
import { _issueTokensForUser } from './samlTokenBridge'
import {
  generateSpMetadata, IDP_SETUP_GUIDES,
} from './samlMetadata'
import { getPlatformCert, getActiveSpCerts, rotateSpCertificate } from './certificateRotation'

const router = Router({ mergeParams: true })

// ─── GET /:tenantSlug/metadata — SP Metadata XML ─────────────────────────────

router.get('/:tenantSlug/metadata', async (req: Request, res: Response): Promise<void> => {
  const { tenantSlug } = req.params as { tenantSlug: string }

  try {
    const config = await getSsoConfig(tenantSlug)
    const certs  = await getActiveSpCerts()

    if (certs.length === 0) {
      // Generate on-demand for dev
      const cert = await getPlatformCert()
      certs.push(cert)
    }

    const base = process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
    const xml  = generateSpMetadata({
      entityId: config?.spEntityId || `${base}/saml/${tenantSlug}/metadata`,
      acsUrl:   `${base}/api/v1/auth/saml/${tenantSlug}/callback`,
      sloUrl:   `${base}/api/v1/auth/saml/${tenantSlug}/slo`,
      certs,
      technicalContact: process.env['SAML_CONTACT_EMAIL']
        ? { name: 'Denver Engineering', email: process.env['SAML_CONTACT_EMAIL'] }
        : undefined,
    })

    res.set('Content-Type', 'application/xml; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(xml)
  } catch (err) {
    slog('ERROR', 'saml', '[metadata] Failed', { tenantSlug, error: String(err) })
    res.status(500).json({ error: 'metadata_error' })
  }
})

// ─── GET /:tenantSlug/login — SP-Initiated SSO ───────────────────────────────

router.get('/:tenantSlug/login', async (req: Request, res: Response): Promise<void> => {
  const { tenantSlug } = req.params as { tenantSlug: string }
  const redirectUrl    = (req.query['redirect'] as string) ?? '/'

  try {
    const config = await getSsoConfig(tenantSlug)
    if (!config) {
      res.status(404).json({
        error:   'sso_not_configured',
        message: `SSO is not configured for tenant "${tenantSlug}". Contact your administrator.`,
      })
      return
    }

    const { redirectUrl: idpUrl, relayState } = await createSamlLoginRequest(config, redirectUrl)

    slog('INFO', 'saml', '[login] Redirecting to IdP', {
      tenantSlug, provider: config.provider, relayState: relayState.slice(0, 8) + '...',
    })

    res.redirect(302, idpUrl)
  } catch (err) {
    slog('ERROR', 'saml', '[login] Error', { tenantSlug, error: String(err) })
    res.status(500).json({ error: 'sso_error', message: 'SSO login failed. Contact support.' })
  }
})

// ─── POST /:tenantSlug/callback — Assertion Consumer Service ─────────────────

router.post('/:tenantSlug/callback', async (req: Request, res: Response): Promise<void> => {
  const { tenantSlug } = req.params as { tenantSlug: string }

  const samlResponse = req.body?.SAMLResponse as string | undefined
  const relayState   = req.body?.RelayState   as string | undefined

  if (!samlResponse) {
    res.status(400).json({ error: 'missing_saml_response' })
    return
  }
  if (!relayState) {
    res.status(400).json({ error: 'missing_relay_state' })
    return
  }

  try {
    const config = await getSsoConfig(tenantSlug)
    if (!config) {
      res.status(404).json({ error: 'sso_not_configured' })
      return
    }

    const result = await validateSamlCallback(config, samlResponse, relayState)

    // Issue JWT tokens (same as password login)
    await _issueTokensForUser(
      res,
      result.userId,
      result.tenantId,
      result.role,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    )

    // Fetch post-login redirect from session
    const sessResult = await query<{ redirect_url: string }>(
      'SELECT redirect_url FROM saml_sessions WHERE relay_state=$1 LIMIT 1',
      [relayState]
    )
    const redirectUrl = sessResult.rows[0]?.redirect_url ?? '/'

    slog('INFO', 'saml', '[callback] SSO login complete', {
      tenantSlug, userId: result.userId, role: result.role, isNew: result.isNew,
    })
    authSamlLoginTotal.inc({ result: 'success', provider: config?.provider ?? 'unknown' })

    // Browser flow: redirect to app
    // API flow (Accept: application/json): return JSON
    const wantsJson = req.headers['accept']?.includes('application/json')
    if (wantsJson) {
      res.json({
        data: {
          userId:   result.userId,
          tenantId: result.tenantId,
          role:     result.role,
          email:    result.email,
          isNew:    result.isNew,
        },
      })
    } else {
      res.redirect(302, redirectUrl)
    }
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any
    slog('WARN', 'saml', '[callback] Validation failed', {
      tenantSlug, code: e?.code, message: e?.message,
    })
    authSamlLoginTotal.inc({ result: e?.code ?? 'error', provider: 'unknown' })

    const message = {
      invalid_relay_state: 'Login session expired. Please try again.',
      saml_replay:         'Assertion already used. Please try again.',
      tenant_mismatch:     'Invalid SSO session. Please try again.',
      invalid_assertion:   'Identity provider response could not be verified.',
      user_not_found:      'Your account has not been provisioned. Contact your administrator.',
      account_inactive:    'Your account is inactive. Contact your administrator.',
    }[e?.code as string] ?? 'SSO login failed. Contact support.'

    const wantsJson = req.headers['accept']?.includes('application/json')
    if (wantsJson) {
      res.status(401).json({ error: e?.code ?? 'sso_error', message })
    } else {
      const appBase = process.env['APP_BASE_URL'] ?? 'http://localhost:5173'
      res.redirect(302, `${appBase}/login?error=${encodeURIComponent(e?.code ?? 'sso_error')}`)
    }
  }
})

// ─── GET /:tenantSlug/slo — Single Logout ────────────────────────────────────

router.get('/:tenantSlug/slo', async (req: Request, res: Response): Promise<void> => {
  // Clear cookies regardless of SAML SLO success
  const IS_PROD = process.env['NODE_ENV'] === 'production'
  const clearOpts = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const }
  res.clearCookie('jarvis_at', { ...clearOpts, path: '/' })
  res.clearCookie('jarvis_rt', { ...clearOpts, path: '/api/v1/auth/refresh' })

  const appBase = process.env['APP_BASE_URL'] ?? 'http://localhost:5173'
  res.redirect(302, `${appBase}/login?message=logged_out`)
})

// ─── GET /:tenantSlug/setup — Setup Guide ────────────────────────────────────

router.get('/:tenantSlug/setup', requireAuth as never, requireRole('owner', 'admin') as never,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { tenantSlug } = req.params as { tenantSlug: string }

    try {
      const config = await getSsoConfig(tenantSlug)
      const base   = process.env['API_BASE_URL'] ?? 'https://api.jarvis.app'
      const provider = config?.provider ?? 'azure_ad'
      const guide  = IDP_SETUP_GUIDES[provider] ?? IDP_SETUP_GUIDES['azure_ad']!

      const certPem = (await getPlatformCert()).certPem

      res.json({
        data: {
          isConfigured: !!config,
          provider:     config?.provider,
          guide: {
            ...guide,
            steps: guide.steps.map(s =>
              s.replace('{acsUrl}', `${base}/api/v1/auth/saml/${tenantSlug}/callback`)
               .replace('{entityId}', `${base}/saml/${tenantSlug}/metadata`)
            ),
          },
          endpoints: {
            metadataUrl: `${base}/saml/${tenantSlug}/metadata`,
            acsUrl:      `${base}/api/v1/auth/saml/${tenantSlug}/callback`,
            sloUrl:      `${base}/api/v1/auth/saml/${tenantSlug}/slo`,
            loginUrl:    `${base}/api/v1/auth/saml/${tenantSlug}/login`,
          },
          spCertificate: certPem,
        },
      })
    } catch (err) {
      slog('ERROR', 'saml', '[setup] Error', { tenantSlug, error: String(err) })
      res.status(500).json({ error: 'internal_error' })
    }
  }
)

// ─── POST /:tenantSlug/config — Create/Update SSO config ─────────────────────

router.post('/:tenantSlug/config', requireAuth as never, requireRole('owner', 'admin') as never,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { tenantSlug } = req.params as { tenantSlug: string }
    const auth = req.auth!

    // Validate the authenticated user belongs to this tenant's slug
    const tenantResult = await query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug=$1 AND id=$2 LIMIT 1',
      [tenantSlug, auth.tid]
    )
    if (!tenantResult.rows[0]) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const {
      idpEntityId, idpSsoUrl, idpSsoBinding, idpCertificate,
      provider, defaultRole, roleMapping, attributeMapping,
      jitProvisioning, jitUpdateProfile, isActive,
    } = req.body as Record<string, unknown>

    if (!idpEntityId || !idpSsoUrl || !idpCertificate) {
      res.status(422).json({
        error: 'validation',
        message: 'idpEntityId, idpSsoUrl, and idpCertificate are required',
      })
      return
    }

    const tenantId = auth.tid

    await query(
      `INSERT INTO tenant_sso_configs
         (tenant_id, protocol, provider, idp_entity_id, idp_sso_url, idp_sso_binding,
          idp_certificate, default_role, role_mapping, attribute_mapping,
          jit_provisioning, jit_update_profile, is_active, created_by, updated_at)
       VALUES ($1,'saml',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (tenant_id, protocol) DO UPDATE SET
         provider          = EXCLUDED.provider,
         idp_entity_id     = EXCLUDED.idp_entity_id,
         idp_sso_url       = EXCLUDED.idp_sso_url,
         idp_sso_binding   = EXCLUDED.idp_sso_binding,
         idp_certificate   = EXCLUDED.idp_certificate,
         default_role      = EXCLUDED.default_role,
         role_mapping      = EXCLUDED.role_mapping,
         attribute_mapping = EXCLUDED.attribute_mapping,
         jit_provisioning  = EXCLUDED.jit_provisioning,
         jit_update_profile = EXCLUDED.jit_update_profile,
         is_active         = EXCLUDED.is_active,
         updated_at        = NOW()`,
      [
        tenantId,
        provider ?? 'custom',
        String(idpEntityId), String(idpSsoUrl),
        idpSsoBinding ?? 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
        String(idpCertificate),
        defaultRole ?? 'viewer',
        JSON.stringify(roleMapping ?? {}),
        JSON.stringify(attributeMapping ?? {}),
        jitProvisioning !== false,
        jitUpdateProfile !== false,
        isActive === true,
        auth.sub,
      ]
    )

    slog('INFO', 'saml', '[config] SSO config saved', { tenantId, provider })
    res.status(201).json({ data: { configured: true } })
  }
)

// ─── POST /:tenantSlug/config/metadata — Import from URL ─────────────────────

router.post('/:tenantSlug/config/metadata', requireAuth as never, requireRole('owner', 'admin') as never,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { tenantSlug } = req.params as { tenantSlug: string }
    const { metadataUrl } = req.body as { metadataUrl?: string }

    if (!metadataUrl) {
      res.status(422).json({ error: 'validation', message: 'metadataUrl required' })
      return
    }

    // Verify tenant ownership
    const tenantResult = await query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug=$1 AND id=$2 LIMIT 1',
      [tenantSlug, req.auth!.tid]
    )
    if (!tenantResult.rows[0]) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    try {
      // Ensure SSO config row exists before importing
      await query(
        `INSERT INTO tenant_sso_configs (tenant_id, protocol, idp_metadata_url)
         VALUES ($1,'saml',$2)
         ON CONFLICT (tenant_id, protocol) DO UPDATE SET idp_metadata_url=$2, updated_at=NOW()`,
        [req.auth!.tid, metadataUrl]
      )

      const result = await importIdpMetadataFromUrl(req.auth!.tid, metadataUrl)
      res.json({ data: result })
    } catch (err) {
      res.status(422).json({ error: 'metadata_import_failed', message: String(err) })
    }
  }
)

// ─── DELETE /:tenantSlug/config — Disable SSO ────────────────────────────────

router.delete('/:tenantSlug/config', requireAuth as never, requireRole('owner') as never,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const tenantResult = await query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug=$1 AND id=$2 LIMIT 1',
      [(req.params as { tenantSlug: string }).tenantSlug, req.auth!.tid]
    )
    if (!tenantResult.rows[0]) {
      res.status(403).json({ error: 'forbidden' }); return
    }

    await query(
      'UPDATE tenant_sso_configs SET is_active=false, updated_at=NOW() WHERE tenant_id=$1 AND protocol=\'saml\'',
      [req.auth!.tid]
    )

    slog('INFO', 'saml', '[config] SSO disabled', { tenantId: req.auth!.tid })
    res.json({ data: { disabled: true } })
  }
)

// ─── POST /admin/certificates/rotate — Certificate rotation ──────────────────

router.post('/admin/certificates/rotate', requireAuth as never, requireRole('owner') as never,
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const newCert = await rotateSpCertificate()
      res.json({
        data: {
          fingerprint: newCert.fingerprint,
          expiresAt:   newCert.expiresAt,
          message:     'Certificate rotated. Update your IdP with the new SP metadata.',
        },
      })
    } catch (err) {
      res.status(500).json({ error: 'rotation_failed', message: String(err) })
    }
  }
)

export default router
export { router as samlRouter }

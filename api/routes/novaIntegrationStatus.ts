/**
 * Denver Engineering — Nova integration status (ADR-001 §2.9, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tenant-authed read API + manual retry for the "Nova Integration" panel in
 * the Denver project workspace. This is the DENVER-USER-facing side of the
 * boundary — the service-to-service (HMAC) side lives in novaCommands.ts.
 *
 * Endpoints (mounted broad at /api/v1 in server.ts, budgets.ts pattern):
 *   GET  /api/v1/projects/:projectId/nova-integration
 *          → link row, connection status, per-project outbox delivery health,
 *            and a server-composed "Open in Nova" URL. Contract VALUE is never
 *            stored and never returned (ADR amendment 5); the contract NUMBER
 *            (a reference, not a commercial value) is.
 *   POST /api/v1/projects/:projectId/nova-integration/retry
 *          → re-queues dead/failed outbox rows for this project. Owner/admin
 *            only (inline role check per repo convention); audited.
 *
 * The "Open in Nova" URL is composed SERVER-side: connection.nova_base_url
 * (fallback NOVA_PUBLIC_URL) + the stored relative path, which is re-validated
 * against the relative-path-only rule (ADR amendment 7) before composition —
 * a non-conforming stored path yields openInNovaUrl: null, never a raw echo.
 */
import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { novaPublicUrl } from '../services/integration/novaConfig'
import { slog } from '../../src/modules/observability/index'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

// Relative-path-only rule (ADR amendment 7) — must match novaCommands.ts.
const RELATIVE_URL_RE = /^\/[A-Za-z0-9/_-]+$/

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _requireRole(req: Req, res: Response, ...roles: string[]): boolean {
  if (!req.auth?.role || !roles.includes(req.auth.role)) {
    res.status(403).json({ error: 'forbidden', message: `Requires one of: ${roles.join(', ')}` })
    return false
  }
  return true
}

function _iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString()
}

/**
 * Compose the "Open in Nova" deep link. Returns null unless BOTH a usable
 * http(s) base URL and a stored path that passes the relative-path-only rule
 * exist — an invalid stored path is dropped, never passed through.
 */
export function composeNovaUrl(baseUrl: string | null | undefined, relativePath: string | null | undefined): string | null {
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) return null
  if (typeof relativePath !== 'string' || !RELATIVE_URL_RE.test(relativePath)) return null
  return `${base}${relativePath}`
}

/** Pure: honest health rollup — failed/dead deliveries can never read healthy. */
export function deliveryHealth(input: {
  connectionStatus: string | null
  queued: number
  retrying: number
  dead: number
}): 'disconnected' | 'failed' | 'degraded' | 'pending' | 'healthy' {
  if (input.connectionStatus !== 'connected') return 'disconnected'
  if (input.dead > 0) return 'failed'
  if (input.retrying > 0) return 'degraded'
  if (input.queued > 0) return 'pending'
  return 'healthy'
}

interface LinkRow {
  nova_project_id:     string
  nova_project_number: string | null
  nova_project_url:    string | null
  nova_customer_name:  string | null
  contract_number:     string | null
  connection_id:       string
  commercial_pm:       string | null
  created_at:          Date | string
  last_event_at:       Date | string | null
}

interface ConnectionRow {
  connection_id:  string
  nova_tenant_id: string
  nova_base_url:  string | null
  status:         string
}

// ─── GET /projects/:projectId/nova-integration ───────────────────────────────

router.get('/projects/:projectId/nova-integration', async (req, res: Response) => {
  const r = req as unknown as Req
  const tenantId = r.tenantId
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const projectId = req.params['projectId'] as string

  try {
    // Explicit column list — the link's metadata blob is never passed through,
    // so a commercial value can never leak into this payload even if a future
    // producer stored one there.
    const linkRes = await tenantQuery<LinkRow>(tenantId, `
      SELECT nova_project_id, nova_project_number, nova_project_url,
             nova_customer_name, contract_number, connection_id,
             metadata->'nova'->>'commercialPm' AS commercial_pm,
             created_at, last_event_at
      FROM nova_project_links
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND project_id = $1
    `, [projectId])
    const link = linkRes.rows[0]
    if (!link) {
      res.json({ linked: false })
      return
    }

    const connRes = await tenantQuery<ConnectionRow>(tenantId, `
      SELECT connection_id, nova_tenant_id, nova_base_url, status
      FROM nova_connections
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND connection_id = $1
    `, [link.connection_id])
    const connection = connRes.rows[0] ?? null

    const countsRes = await tenantQuery<{ queued: string; retrying: string; dead: string }>(tenantId, `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','delivering') AND attempts = 0)::TEXT AS queued,
        COUNT(*) FILTER (WHERE status IN ('queued','delivering') AND attempts > 0)::TEXT AS retrying,
        COUNT(*) FILTER (WHERE status = 'dead')::TEXT AS dead
      FROM nova_outbox
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND payload->>'denverProjectId' = $1
    `, [projectId])
    const counts = countsRes.rows[0]
    const queued   = parseInt(counts?.queued   ?? '0', 10)
    const retrying = parseInt(counts?.retrying ?? '0', 10)
    const dead     = parseInt(counts?.dead     ?? '0', 10)

    const lastRes = await tenantQuery<{ event_type: string; delivered_at: Date | string }>(tenantId, `
      SELECT event_type, delivered_at
      FROM nova_outbox
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND payload->>'denverProjectId' = $1
        AND status = 'delivered'
      ORDER BY delivered_at DESC
      LIMIT 1
    `, [projectId])
    const lastDelivered = lastRes.rows[0] ?? null

    res.json({
      linked: true,
      link: {
        novaProjectId:     link.nova_project_id,
        novaProjectNumber: link.nova_project_number,
        novaCustomerName:  link.nova_customer_name,
        contractNumber:    link.contract_number,
        commercialPm:      link.commercial_pm,
        linkedAt:          _iso(link.created_at),
        lastEventAt:       _iso(link.last_event_at),
      },
      connection: connection ? {
        connectionId: connection.connection_id,
        novaTenantId: connection.nova_tenant_id,
        status:       connection.status,
      } : null,
      health: deliveryHealth({
        connectionStatus: connection?.status ?? null,
        queued, retrying, dead,
      }),
      delivery: {
        queuedCount:            queued,
        failedCount:            retrying,
        deadCount:              dead,
        lastDeliveredAt:        lastDelivered ? _iso(lastDelivered.delivered_at) : null,
        lastDeliveredEventType: lastDelivered?.event_type ?? null,
      },
      openInNovaUrl: composeNovaUrl(
        connection?.nova_base_url || novaPublicUrl(),
        link.nova_project_url,
      ),
    })
  } catch (err) {
    slog('ERROR', 'novaIntegrationStatus', '[get] Failed', {
      tenantId, projectId, message: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'internal', message: 'Failed to load Nova integration status.' })
  }
})

// ─── POST /projects/:projectId/nova-integration/retry ────────────────────────
// Re-queues this project's dead and failed (retrying) outbox rows for a fresh
// delivery ladder. Owner/admin only; every invocation is audited.

router.post('/projects/:projectId/nova-integration/retry', async (req, res: Response) => {
  const r = req as unknown as Req
  const tenantId = r.tenantId
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!_requireRole(r, res, 'owner', 'admin')) return
  const projectId = req.params['projectId'] as string

  try {
    const linkRes = await tenantQuery<{ id: string }>(tenantId, `
      SELECT id FROM nova_project_links
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND project_id = $1
    `, [projectId])
    if (!linkRes.rows.length) {
      res.status(404).json({ error: 'not_found', message: 'This project is not linked to Nova.' })
      return
    }

    // attempts reset to 0 so the row gets the full backoff ladder again rather
    // than dead-lettering on the first post-retry failure.
    const requeued = await tenantQuery<{ id: string }>(tenantId, `
      UPDATE nova_outbox
      SET status = 'queued', attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND payload->>'denverProjectId' = $1
        AND (status = 'dead' OR (status IN ('queued','delivering') AND attempts > 0))
      RETURNING id
    `, [projectId])

    await tenantQuery(tenantId, `
      INSERT INTO audit_log (tenant_id, user_id, action, resource, resource_id, new_data)
      VALUES (current_setting('app.current_tenant_id', true)::uuid, $1, 'integrate_push', 'nova_retry_requested', $2, $3::jsonb)
    `, [r.auth?.sub ?? null, projectId, JSON.stringify({ requeued: requeued.rows.length })])

    slog('INFO', 'novaIntegrationStatus', '[retry] Re-queued outbox rows', {
      tenantId, projectId, requeued: requeued.rows.length,
    })
    res.json({ requeued: requeued.rows.length })
  } catch (err) {
    slog('ERROR', 'novaIntegrationStatus', '[retry] Failed', {
      tenantId, projectId, message: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'internal', message: 'Failed to retry Nova deliveries.' })
  }
})

export const novaIntegrationStatusRouter = router

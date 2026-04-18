/**
 * JARVIS EPC — Audit Log Retention Handler
 * ────────────────────────────────────────────
 * v4.31.0 | Deletes audit_log rows older than the tenant's configured
 *          audit_retention_days window.
 *
 * Registers the 'purge_audit_logs' job type. Admins schedule it
 * per-tenant (typically daily at a quiet hour) from the Automation UI.
 *
 * Per-tenant retention lets contract-sensitive tenants set longer windows
 * (e.g. 7 years = 2555 days) via:
 *   UPDATE tenants SET audit_retention_days = 2555 WHERE id = '…';
 *
 * A retention_days value of 0 disables purging for that tenant — the
 * handler exits cleanly without touching audit_log.
 *
 * Payload is empty: the handler reads everything it needs from the
 * tenants row matching job.tenant_id.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import { registerHandler, type BackgroundJob } from './scheduler'

export function registerAuditRetentionHandler(): void {
  registerHandler('purge_audit_logs', _handlePurgeJob)
  slog('INFO', 'auditRetention', '[boot] Registered purge_audit_logs handler')
}

async function _handlePurgeJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  const tid = job.tenant_id

  // Read retention policy from tenants. Default 365 is enforced at the column
  // level, so a missing row means the tenant was deleted — fail loudly.
  const policyRes = await query<{ audit_retention_days: number }>(`
    SELECT audit_retention_days FROM tenants WHERE id = $1
  `, [tid])

  const row = policyRes.rows[0]
  if (!row) throw new Error(`Tenant not found: ${tid}`)

  const retentionDays = row.audit_retention_days
  if (retentionDays <= 0) {
    slog('INFO', 'auditRetention', '[purge] Retention disabled for tenant (days=0)', { tenantId: tid })
    return { purged: 0, retentionDays, skipped: true }
  }

  // Cap delete batch size so a very large backlog doesn't hold a long lock.
  // Next scheduled run will pick up the remainder; the scheduler's exponential
  // backoff isn't involved here because we return success regardless.
  const BATCH_LIMIT = 10_000

  const res = await query<{ id: string }>(`
    DELETE FROM audit_log
    WHERE  ctid IN (
      SELECT ctid FROM audit_log
      WHERE  tenant_id  = $1
        AND  created_at < NOW() - make_interval(days => $2)
      LIMIT  $3
    )
    RETURNING id
  `, [tid, retentionDays, BATCH_LIMIT])

  const purged = res.rowCount ?? res.rows.length
  slog('INFO', 'auditRetention', '[purge] Complete', {
    tenantId: tid, retentionDays, purged,
    batched: purged >= BATCH_LIMIT,
  })

  return { purged, retentionDays, batched: purged >= BATCH_LIMIT }
}

/** Test-only: direct access to the handler. */
export const __testHooks = { handlePurgeJob: _handlePurgeJob }

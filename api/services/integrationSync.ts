/**
 * Denver Engineering — Scheduled Integration Sync
 * ────────────────────────────────────────────
 * v4.31.0 | Periodic sync for external systems (Procore, SAP, etc.)
 *
 * Before this module, sync_jobs rows were only ever created by the
 * manual `POST /api/v1/integrations/:id/sync` route — nothing polled
 * them. This module wires integrations into the scheduler so rows with
 * sync_enabled=true fire on their own sync_interval cadence.
 *
 * Two registrations:
 *
 *   1. Promoter — runs every scheduler tick. Atomically claims due
 *      integrations via UPDATE ... FOR UPDATE SKIP LOCKED (safe under
 *      multi-process deployments) and enqueues one background_jobs row
 *      per due integration. Self-throttles so the DB scan only runs
 *      once per INTEGRATION_SCAN_MIN_INTERVAL_MS even though the
 *      scheduler ticks every 5s.
 *
 *   2. Handler — consumes those jobs. Creates a sync_jobs row (matches
 *      existing schema + /api/v1/sync-jobs list endpoint), dispatches
 *      to a per-type sync function, records results.
 *
 * Per-type sync dispatch (_performSync) is the extension point. For
 * each integration.type (procore, sap, oracle_primavera, custom_webhook,
 * email, slack, teams), add a case that calls the vendor API. The
 * scheduling / retry / observability plumbing is already complete —
 * adding a new integration type is purely vendor-API code.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'
import {
  registerHandler,
  registerPromoter,
  enqueue,
  type BackgroundJob,
} from './scheduler'

// ─── Config ───────────────────────────────────────────────────────────────────

// The scheduler ticks every 5s, but we don't need to scan integrations
// that often — a due row will still be picked up within this window.
const SCAN_MIN_INTERVAL_MS = Number(
  process.env['INTEGRATION_SCAN_MIN_INTERVAL_MS'] ?? '60000',
)
let _lastScanAt = 0

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntegrationRow {
  id:         string
  tenant_id:  string
  type:       string
  direction:  string
  base_url:   string | null
}

interface SyncResult {
  pushed: number
  pulled: number
  failed: number
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Call once at boot, after startScheduler(). */
export function registerIntegrationSync(): void {
  registerHandler('integration_sync', _handleIntegrationSyncJob)
  registerPromoter(_promoteDueIntegrations)
  slog('INFO', 'integrationSync', '[boot] Registered handler + promoter')
}

// ─── Promoter: atomic claim of due integrations ──────────────────────────────

async function _promoteDueIntegrations(): Promise<void> {
  const now = Date.now()
  if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
  _lastScanAt = now

  // Atomic claim: update last_sync_at on any due row and return it.
  // The inner SELECT FOR UPDATE SKIP LOCKED ensures that when two workers
  // tick simultaneously, each integration is promoted exactly once.
  // Setting last_sync_at=NOW() at promote time prevents re-enqueue if the
  // handler is slow — if the handler fails, backoff is sync_interval.
  const due = await query<{ id: string; tenant_id: string }>(`
    UPDATE integrations
    SET    last_sync_at = NOW()
    WHERE  id IN (
      SELECT id FROM integrations
      WHERE  sync_enabled = true
        AND  status       = 'active'
        AND  (last_sync_at IS NULL
              OR last_sync_at + make_interval(secs => sync_interval) < NOW())
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id
  `)

  if (due.rows.length === 0) return

  for (const row of due.rows) {
    await enqueue(row.tenant_id, 'integration_sync', { integrationId: row.id })
  }

  slog('INFO', 'integrationSync', `[scan] Promoted ${due.rows.length} due sync(s)`)
}

// ─── Handler: run one sync ────────────────────────────────────────────────────

async function _handleIntegrationSyncJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  const { integrationId } = job.payload_json as { integrationId?: string }
  if (!integrationId) throw new Error('integration_sync payload missing integrationId')

  const intRes = await query<IntegrationRow>(`
    SELECT id, tenant_id, type::text AS type, direction::text AS direction, base_url
    FROM integrations
    WHERE id = $1 AND tenant_id = $2
  `, [integrationId, job.tenant_id])

  const integration = intRes.rows[0]
  if (!integration) throw new Error(`Integration not found: ${integrationId}`)

  // Open a sync_jobs row to track this attempt (matches existing schema
  // so it shows up in /api/v1/sync-jobs without any UI changes).
  const syncRes = await query<{ id: string }>(`
    INSERT INTO sync_jobs
      (tenant_id, integration_id, status, direction, started_at)
    VALUES ($1, $2, 'running', $3::sync_direction, NOW())
    RETURNING id
  `, [integration.tenant_id, integration.id, integration.direction])

  const syncId = syncRes.rows[0]!.id

  try {
    const { pushed, pulled, failed } = await _performSync(integration)

    await query(`
      UPDATE sync_jobs
      SET    status = $1::sync_status,
             completed_at   = NOW(),
             records_pushed = $2,
             records_pulled = $3,
             records_failed = $4
      WHERE  id = $5
    `, [failed > 0 ? 'partial' : 'success', pushed, pulled, failed, syncId])

    await query(`UPDATE integrations SET last_error = NULL WHERE id = $1`, [integration.id])

    slog('INFO', 'integrationSync', '[sync] Complete', {
      integrationId, type: integration.type, pushed, pulled, failed,
    })

    return { syncId, pushed, pulled, failed }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    await query(`
      UPDATE sync_jobs
      SET    status       = 'failed',
             completed_at = NOW(),
             error_log    = jsonb_build_array(jsonb_build_object('message', $1::text, 'attempt', $2::int))
      WHERE  id = $3
    `, [msg, job.attempts, syncId])

    await query(
      `UPDATE integrations SET last_error = $1 WHERE id = $2`,
      [msg, integration.id],
    )

    // Re-throw so the scheduler's retry + backoff kicks in.
    throw err
  }
}

// ─── Per-type sync dispatch (extension point) ────────────────────────────────
//
// Add a case per integration.type. The scheduling, retry, observability,
// and sync_jobs accounting are already handled — each case just does the
// vendor-specific HTTP work and returns record counts.

async function _performSync(integration: IntegrationRow): Promise<SyncResult> {
  switch (integration.type) {
    // case 'procore':          return _syncProcore(integration)
    // case 'sap':              return _syncSap(integration)
    // case 'oracle_primavera': return _syncPrimavera(integration)
    // case 'ms_project':       return _syncMsProject(integration)
    // case 'aconex':           return _syncAconex(integration)
    // case 'autodesk_bim360':  return _syncBim360(integration)
    // case 'custom_webhook':   return _syncCustomWebhook(integration)
    // case 'email' | 'slack' | 'teams': notification digests, not sync — skip

    default: {
      // v1 stub: log the intent and return a clean no-op so existing
      // integrations can be enabled without type-specific code. Replace
      // with real logic above per type as vendor APIs are wired in.
      slog('INFO', 'integrationSync', '[stub] No-op sync (type has no handler yet)', {
        integrationId: integration.id,
        type:          integration.type,
        direction:     integration.direction,
      })
      return { pushed: 0, pulled: 0, failed: 0 }
    }
  }
}

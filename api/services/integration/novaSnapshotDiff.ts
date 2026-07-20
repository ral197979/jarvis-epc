/**
 * Denver Engineering — Nova snapshot diff job (ADR-001, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE deterministic code path for progress/turnover event emission (per the
 * ADR-001 security review — no scatter-shot per-route hooks): a recurring job
 * that, for every project with a nova_project_links row, rebuilds the progress
 * projection and the turnover package states, and enqueues outbox events ONLY
 * when the stable content hash changed since the last run.
 *
 *   - progress:  summaryHash(summary) vs nova_project_links.last_summary_hash
 *                → denver.project.progress.updated
 *   - turnover:  per-package state hash vs nova_project_links.last_turnover_state
 *                ({ packageId: hash }) → denver.turnover.package.updated
 *
 * The hash update and the outbox insert happen in the SAME transaction, so an
 * event is never recorded as emitted without an outbox row (and vice versa).
 *
 * Scheduling mirrors integrationSync.ts: a promoter (throttled to ~5 min)
 * enqueues one 'nova_snapshot_diff' background job per tenant that has links.
 */
import { query, tenantQuery, tenantTransaction } from '../../db/pool'
import { registerHandler, registerPromoter, enqueue, type BackgroundJob } from '../scheduler'
import { isNovaExternalEnabled } from './novaConfig'
import { insertOutboxEvent, type NovaEventPayload } from './novaOutbox'
import { buildProgressSummary, summaryHash } from './novaProgressProjection'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinkRow {
  id:                  string
  project_id:          string
  connection_id:       string
  nova_project_id:     string
  last_summary_hash:   string | null
  last_turnover_state: Record<string, string> | null
  nova_tenant_id:      string
}

interface PackageRow {
  id:     string
  name:   string
  area:   string | null
  status: string
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Pure: contract package shape from a turnover_packages row (computable fields only). */
export function toContractPackage(pkg: PackageRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    packageId: pkg.id,
    title:     pkg.name,
    status:    pkg.status,
  }
  if (pkg.area) out['systemOrArea'] = pkg.area
  return out
}

/** Pure: which packages changed vs the stored { packageId: hash } state. */
export function diffTurnoverState(
  packages: PackageRow[],
  lastState: Record<string, string>,
): { changed: PackageRow[]; nextState: Record<string, string> } {
  const changed: PackageRow[] = []
  const nextState: Record<string, string> = {}
  for (const pkg of packages) {
    const hash = summaryHash(toContractPackage(pkg))
    nextState[pkg.id] = hash
    if (lastState[pkg.id] !== hash) changed.push(pkg)
  }
  return { changed, nextState }
}

// ─── Handler: diff one tenant's linked projects ───────────────────────────────

async function _diffLink(tenantId: string, link: LinkRow): Promise<{ emitted: number }> {
  let emitted = 0

  const basePayload: Omit<NovaEventPayload, 'summary' | 'package'> = {
    connectionId:    link.connection_id,
    novaTenantId:    link.nova_tenant_id,
    novaProjectId:   link.nova_project_id,
    denverProjectId: link.project_id,
  }

  // 1. Progress summary diff
  const summary = await buildProgressSummary(tenantId, link.project_id)
  if (summary) {
    const hash = summaryHash(summary)
    if (hash !== link.last_summary_hash) {
      await tenantTransaction(tenantId, async (client) => {
        await insertOutboxEvent(client, tenantId, 'denver.project.progress.updated', {
          ...basePayload, summary: summary as unknown as Record<string, unknown>,
        })
        await client.query(`
          UPDATE nova_project_links
          SET last_summary_hash = $1, last_event_at = NOW(), updated_at = NOW()
          WHERE id = $2
        `, [hash, link.id])
      })
      emitted++
    }
  }

  // 2. Turnover package diff
  const pkgRes = await tenantQuery<PackageRow>(tenantId, `
    SELECT id, name, area, status FROM turnover_packages WHERE project_id = $1
  `, [link.project_id])
  const { changed, nextState } = diffTurnoverState(pkgRes.rows, link.last_turnover_state ?? {})
  if (changed.length > 0) {
    await tenantTransaction(tenantId, async (client) => {
      for (const pkg of changed) {
        await insertOutboxEvent(client, tenantId, 'denver.turnover.package.updated', {
          ...basePayload, package: toContractPackage(pkg),
        })
      }
      await client.query(`
        UPDATE nova_project_links
        SET last_turnover_state = $1::jsonb, last_event_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(nextState), link.id])
    })
    emitted += changed.length
  }

  return { emitted }
}

async function _handleSnapshotDiffJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  if (!isNovaExternalEnabled()) return { skipped: true, reason: 'NOVA_EXTERNAL off' }

  const links = await tenantQuery<LinkRow>(job.tenant_id, `
    SELECT l.id, l.project_id, l.connection_id, l.nova_project_id,
           l.last_summary_hash, l.last_turnover_state,
           c.nova_tenant_id
    FROM nova_project_links l
    JOIN nova_connections c ON c.connection_id = l.connection_id
    WHERE c.status = 'connected'
  `, [])

  let emitted = 0
  for (const link of links.rows) {
    try {
      emitted += (await _diffLink(job.tenant_id, link)).emitted
    } catch (err) {
      slog('ERROR', 'novaSnapshotDiff', '[diff] link failed', {
        tenantId: job.tenant_id, projectId: link.project_id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { links: links.rows.length, emitted }
}

// ─── Promoter: one job per tenant with links, every ~5 min ────────────────────

const SCAN_MIN_INTERVAL_MS = Number(process.env['NOVA_SNAPSHOT_INTERVAL_MS'] ?? '300000')
let _lastScanAt = 0

async function _promoteSnapshotDiffs(): Promise<void> {
  if (!isNovaExternalEnabled()) return
  const now = Date.now()
  if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
  _lastScanAt = now

  const due = await query<{ tenant_id: string }>(`
    SELECT DISTINCT l.tenant_id
    FROM nova_project_links l
    WHERE NOT EXISTS (
      SELECT 1 FROM background_jobs bj
      WHERE bj.tenant_id = l.tenant_id
        AND bj.job_type = 'nova_snapshot_diff'
        AND bj.status IN ('queued', 'running')
    )
    LIMIT 50
  `)
  for (const row of due.rows) {
    await enqueue(row.tenant_id, 'nova_snapshot_diff', {})
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Call once at boot from api/worker.ts, after startScheduler(). */
export function registerNovaSnapshotDiffHandler(): void {
  registerHandler('nova_snapshot_diff', _handleSnapshotDiffJob)
  registerPromoter(_promoteSnapshotDiffs)
  slog('INFO', 'novaSnapshotDiff', '[boot] Registered handler + promoter')
}

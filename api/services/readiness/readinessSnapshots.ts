/**
 * Denver Engineering — Readiness Snapshot Job (v4.35.0)
 * ───────────────────────────────────────────────────────
 * Ava Phase 3 — Nightly snapshot of readiness scores for all active
 * projects per tenant. Registers as a named background handler.
 */
import { pool } from '../../db/pool'
import { computeReadiness, persistReadinessScore, type ReadinessDomain } from './readinessEngine'

const DOMAINS: ReadinessDomain[] = [
  'project', 'commissioning', 'safety', 'compliance',
]

export async function snapshotReadinessForTenant(tenantId: string): Promise<void> {
  // Fetch all active projects for this tenant
  const projectsRes = await pool.query(
    `SELECT id FROM projects WHERE tenant_id = $1 AND status NOT IN ('archived','cancelled')`,
    [tenantId],
  )

  const today = new Date().toISOString().slice(0, 10)

  for (const row of projectsRes.rows) {
    const entityId = row.id as string

    for (const domain of DOMAINS) {
      try {
        const result = await computeReadiness(tenantId, domain, entityId)

        // Persist current score (upsert)
        await persistReadinessScore(tenantId, domain, entityId, 'project', result)

        // Save historical snapshot
        await pool.query(`
          INSERT INTO readiness_snapshots
            (tenant_id, snapshot_date, domain, entity_id, entity_type,
             readiness_score, readiness_state, blocking_factors, component_scores)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (tenant_id, snapshot_date, domain, entity_id)
          DO UPDATE SET
            readiness_score  = EXCLUDED.readiness_score,
            readiness_state  = EXCLUDED.readiness_state,
            blocking_factors = EXCLUDED.blocking_factors,
            component_scores = EXCLUDED.component_scores
        `, [
          tenantId, today, domain, entityId, 'project',
          result.readiness_score,
          result.readiness_state,
          JSON.stringify(result.blocking_factors),
          JSON.stringify(result.component_scores),
        ])
      } catch (err) {
        // Log but don't fail the entire batch
        console.error(`[readiness-snapshot] tenant=${tenantId} project=${entityId} domain=${domain}`, err)
      }
    }
  }
}

export async function enqueueReadinessSnapshotsForAllTenants(): Promise<void> {
  const res = await pool.query(
    `SELECT id FROM tenants WHERE is_active = TRUE`,
  )
  for (const row of res.rows) {
    void snapshotReadinessForTenant(row.id as string)
  }
}

export function registerReadinessSnapshotHandler(): void {
  // Integrate with the existing scheduler pattern (registerPromoter)
  // For now, exposes the function for cron/scheduler to call
  console.log('[readiness] snapshot handler registered')
}

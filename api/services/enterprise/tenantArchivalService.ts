// Denver Engineering — Tenant Archival Service (v8.0.0)
// Safe tenant archival pipeline with data preservation and recovery support.

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { TenantSubscription, TenantLifecycleEvent } from './enterpriseTypes'
import { transitionLifecycle, getSubscription } from './tenantProvisioningService'

// ─── Archival result ──────────────────────────────────────────────────────────

export interface ArchivalResult {
  tenantId: string
  previousStatus: string
  archivedAt: Date
  subscription: TenantSubscription
  lifecycleEvent: TenantLifecycleEvent
  preservedRecordCounts: Record<string, number>
}

// ─── Archive tenant ───────────────────────────────────────────────────────────

export async function archiveTenant(
  tenantId: string,
  opts: {
    actor?: string
    reason?: string
    preserveData?: boolean // default true — never delete, just mark
  } = {},
): Promise<ArchivalResult> {
  const { actor = 'system', reason, preserveData = true } = opts

  const current = await getSubscription(tenantId)
  if (current == null) throw new Error(`No subscription found for tenant ${tenantId}`)
  if (current.lifecycleStatus === 'archived') throw new Error(`Tenant ${tenantId} is already archived`)

  const previousStatus = current.lifecycleStatus

  // Count records before archiving (for audit trail)
  const preservedRecordCounts = await _countTenantRecords(tenantId)

  // Revoke all active API keys
  await tenantQuery(
    tenantId,
    `UPDATE api_keys SET status = 'revoked', revoked_at = now(), revoked_by = $2
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId, actor],
  ).catch(() => {})

  // Expire all feature flags
  await tenantQuery(
    tenantId,
    `UPDATE tenant_feature_flags SET enabled = false, updated_at = now() WHERE tenant_id = $1`,
    [tenantId],
  ).catch(() => {})

  // Transition to archived
  const { subscription, event } = await transitionLifecycle(tenantId, 'archived', {
    actor,
    reason: reason ?? 'Tenant archived',
    metadata: { previousStatus, preservedRecordCounts, preserveData },
  })

  return {
    tenantId,
    previousStatus,
    archivedAt: event.createdAt,
    subscription,
    lifecycleEvent: event,
    preservedRecordCounts,
  }
}

// ─── Suspend tenant ───────────────────────────────────────────────────────────

export async function suspendTenant(
  tenantId: string,
  opts: { actor?: string; reason?: string } = {},
): Promise<{ subscription: TenantSubscription; event: TenantLifecycleEvent }> {
  const current = await getSubscription(tenantId)
  if (current == null) throw new Error(`No subscription found for tenant ${tenantId}`)

  return transitionLifecycle(tenantId, 'suspended', {
    actor: opts.actor ?? 'system',
    reason: opts.reason ?? 'Account suspended',
  })
}

// ─── Reactivate tenant ────────────────────────────────────────────────────────

export async function reactivateTenant(
  tenantId: string,
  opts: { actor?: string; reason?: string } = {},
): Promise<{ subscription: TenantSubscription; event: TenantLifecycleEvent }> {
  const current = await getSubscription(tenantId)
  if (current == null) throw new Error(`No subscription found for tenant ${tenantId}`)
  if (current.lifecycleStatus === 'archived') {
    throw new Error(`Archived tenants cannot be reactivated — use recovery instead`)
  }

  return transitionLifecycle(tenantId, 'active', {
    actor: opts.actor ?? 'system',
    reason: opts.reason ?? 'Account reactivated',
  })
}

// ─── List archived tenants (admin) ────────────────────────────────────────────

export async function listArchivedTenants(limit = 100): Promise<TenantSubscription[]> {
  const res = await pool.query(
    `SELECT * FROM tenant_subscriptions WHERE lifecycle_status = 'archived'
     ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  )
  const { _mapSubscription } = await import('./tenantProvisioningService')
  return res.rows.map(_mapSubscription)
}

// ─── Count tenant records ─────────────────────────────────────────────────────

async function _countTenantRecords(tenantId: string): Promise<Record<string, number>> {
  const tables = [
    'tenant_usage',
    'tenant_feature_flags',
    'ai_usage_records',
    'support_tickets',
    'compliance_exports',
    'api_keys',
    'tenant_onboarding_tasks',
  ]

  const counts: Record<string, number> = {}
  await Promise.all(tables.map(async (table) => {
    try {
      const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE tenant_id = $1`, [tenantId])
      counts[table] = Number(res.rows[0]?.cnt ?? 0)
    } catch {
      counts[table] = -1 // table may not exist in older deployments
    }
  }))

  return counts
}

export const __testHooks = { _countTenantRecords }

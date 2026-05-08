// Denver Engineering — Deployment Readiness Checklist (Phase 11)
// Manage go-live checklist items for pilot tenants

import { pool } from '../../db/pool'
import { GoLiveChecklistItem } from './phase11Types'

// ─── Default Checklist Items ─────────────────────────────────────────────────

export const DEFAULT_CHECKLIST_KEYS: Array<{
  checkKey: string
  title: string
  required: boolean
}> = [
  { checkKey: 'data_migrated', title: 'Historical data migrated and validated', required: true },
  { checkKey: 'users_provisioned', title: 'All user accounts provisioned', required: true },
  { checkKey: 'integrations_tested', title: 'External integrations tested', required: true },
  { checkKey: 'training_complete', title: 'Operator training completed', required: true },
  { checkKey: 'runbook_reviewed', title: 'Incident runbook reviewed with team', required: true },
  { checkKey: 'sla_agreed', title: 'SLA terms signed off', required: true },
  { checkKey: 'backup_verified', title: 'Backup and recovery verified', required: false },
  { checkKey: 'monitoring_configured', title: 'Monitoring alerts configured', required: false },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapChecklistItem(row: Record<string, unknown>): GoLiveChecklistItem {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    checkKey: row.check_key as string,
    title: row.title as string,
    required: Boolean(row.required),
    completed: Boolean(row.completed),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    completedBy: row.completed_by as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Provision Default Checklist ──────────────────────────────────────────────

export async function provisionGoLiveChecklist(tenantId: string): Promise<GoLiveChecklistItem[]> {
  const items: GoLiveChecklistItem[] = []
  for (const item of DEFAULT_CHECKLIST_KEYS) {
    const result = await pool.query(
      `INSERT INTO go_live_checklist_items
         (tenant_id, check_key, title, required, completed, completed_at, completed_by, created_at)
       VALUES ($1, $2, $3, $4, false, NULL, NULL, NOW())
       ON CONFLICT (tenant_id, check_key) DO NOTHING
       RETURNING *`,
      [tenantId, item.checkKey, item.title, item.required]
    )
    if (result.rows.length > 0) {
      items.push(_mapChecklistItem(result.rows[0]))
    }
  }
  return items
}

// ─── Get Checklist ────────────────────────────────────────────────────────────

export async function getGoLiveChecklist(tenantId: string): Promise<GoLiveChecklistItem[]> {
  const result = await pool.query(
    `SELECT * FROM go_live_checklist_items
     WHERE tenant_id = $1
     ORDER BY required DESC, created_at ASC`,
    [tenantId]
  )
  return result.rows.map(_mapChecklistItem)
}

// ─── Complete Checklist Item ──────────────────────────────────────────────────

export async function completeChecklistItem(
  itemId: string,
  completedBy: string
): Promise<GoLiveChecklistItem> {
  const result = await pool.query(
    `UPDATE go_live_checklist_items
     SET completed = true, completed_at = NOW(), completed_by = $1
     WHERE id = $2
     RETURNING *`,
    [completedBy, itemId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Checklist item ${itemId} not found`)
  }
  return _mapChecklistItem(result.rows[0])
}

// ─── Uncomplete Checklist Item ────────────────────────────────────────────────

export async function uncompleteChecklistItem(itemId: string): Promise<GoLiveChecklistItem> {
  const result = await pool.query(
    `UPDATE go_live_checklist_items
     SET completed = false, completed_at = NULL, completed_by = NULL
     WHERE id = $1
     RETURNING *`,
    [itemId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Checklist item ${itemId} not found`)
  }
  return _mapChecklistItem(result.rows[0])
}

// ─── Compute Completion Pct ───────────────────────────────────────────────────

export function computeChecklistCompletionPct(items: GoLiveChecklistItem[]): number {
  if (items.length === 0) return 0
  const completed = items.filter(i => i.completed).length
  return Math.round((completed / items.length) * 100)
}

// ─── All Required Items Complete ─────────────────────────────────────────────

export function areAllRequiredItemsComplete(items: GoLiveChecklistItem[]): boolean {
  const required = items.filter(i => i.required)
  return required.length > 0 && required.every(i => i.completed)
}

// ─── Is Ready for Go Live ─────────────────────────────────────────────────────

export function isReadyForGoLive(items: GoLiveChecklistItem[]): boolean {
  return areAllRequiredItemsComplete(items)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapChecklistItem,
  computeChecklistCompletionPct,
  areAllRequiredItemsComplete,
  isReadyForGoLive,
  DEFAULT_CHECKLIST_KEYS,
}

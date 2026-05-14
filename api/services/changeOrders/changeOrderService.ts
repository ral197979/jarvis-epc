/**
 * Denver Engineering — Change Order Service (v10.7.0)
 * ─────────────────────────────────────────────────────
 * Change orders track scope/cost/time deviations from the original contract.
 * Approved COs update the project's EVM baseline BAC via cost_impact.
 *
 * Workflow: draft → submitted → approved | rejected → (void)
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'void'
export type CoType   = 'scope' | 'time' | 'cost' | 'scope_time_cost'

export interface ChangeOrder {
  id:                   string
  tenantId:             string
  projectId:            string
  coNumber:             number
  title:                string
  description:          string | null
  type:                 CoType
  status:               CoStatus
  costImpact:           number
  scheduleImpactDays:   number
  reason:               string | null
  rfiId:                string | null
  submittedBy:          string | null
  submittedAt:          string | null
  reviewedBy:           string | null
  reviewedAt:           string | null
  reviewNotes:          string | null
  createdBy:            string | null
  createdAt:            string
  updatedAt:            string
  linkedTaskCount?:     number
}

export interface ChangeOrderTask {
  id:              string
  changeOrderId:   string
  scheduleTaskId:  string
  impactNotes:     string | null
  createdAt:       string
}

export interface CreateChangeOrderInput {
  projectId:            string
  title:                string
  description?:         string
  type?:                CoType
  costImpact?:          number
  scheduleImpactDays?:  number
  reason?:              string
  rfiId?:               string
  createdBy?:           string
}

export interface ListChangeOrdersFilter {
  projectId:   string
  status?:     CoStatus
  type?:       CoType
  limit?:      number
  offset?:     number
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createChangeOrder(
  tenantId: string,
  input: CreateChangeOrderInput,
): Promise<ChangeOrder> {
  // Auto-assign next co_number per project (serialized by advisory lock)
  const res = await tenantQuery(tenantId,
    `INSERT INTO change_orders
       (tenant_id, project_id, co_number, title, description, type,
        cost_impact, schedule_impact_days, reason, rfi_id, created_by)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(co_number) FROM change_orders WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
       $3, $4, $5, $6, $7, $8, $9, $10
     )
     RETURNING *`,
    [
      tenantId, input.projectId, input.title,
      input.description ?? null,
      input.type ?? 'scope',
      input.costImpact ?? 0,
      input.scheduleImpactDays ?? 0,
      input.reason ?? null,
      input.rfiId ?? null,
      input.createdBy ?? null,
    ],
  )
  return _map(res.rows[0])
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getChangeOrder(
  tenantId: string,
  id: string,
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `SELECT co.*,
            (SELECT COUNT(*) FROM change_order_tasks cot WHERE cot.change_order_id=co.id) AS linked_task_count
     FROM change_orders co
     WHERE co.id=$1 AND co.tenant_id=$2`,
    [id, tenantId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function listChangeOrders(
  tenantId: string,
  filter: ListChangeOrdersFilter,
): Promise<{ items: ChangeOrder[]; total: number }> {
  const limit  = Math.min(filter.limit  ?? 50, 200)
  const offset = filter.offset ?? 0

  const res = await tenantQuery(tenantId,
    `SELECT co.*,
            (SELECT COUNT(*) FROM change_order_tasks cot WHERE cot.change_order_id=co.id) AS linked_task_count,
            COUNT(*) OVER() AS total_count
     FROM change_orders co
     WHERE co.tenant_id=$1
       AND co.project_id=$2
       AND ($3::co_status IS NULL OR co.status=$3)
       AND ($4::co_type   IS NULL OR co.type=$4)
     ORDER BY co.created_at DESC
     LIMIT $5 OFFSET $6`,
    [tenantId, filter.projectId, filter.status ?? null, filter.type ?? null, limit, offset],
  )

  const total = res.rows[0] ? Number(res.rows[0]['total_count']) : 0
  return { items: res.rows.map(_map), total }
}

// ─── Update (draft only) ──────────────────────────────────────────────────────

export async function updateChangeOrder(
  tenantId: string,
  id: string,
  patch: {
    title?:               string
    description?:         string | null
    type?:                CoType
    costImpact?:          number
    scheduleImpactDays?:  number
    reason?:              string | null
    rfiId?:               string | null
  },
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE change_orders SET
       title                = COALESCE($3, title),
       description          = COALESCE($4, description),
       type                 = COALESCE($5::co_type, type),
       cost_impact          = COALESCE($6, cost_impact),
       schedule_impact_days = COALESCE($7, schedule_impact_days),
       reason               = COALESCE($8, reason),
       rfi_id               = COALESCE($9, rfi_id),
       updated_at           = now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft'
     RETURNING *`,
    [
      id, tenantId,
      patch.title ?? null,
      patch.description !== undefined ? patch.description : null,
      patch.type ?? null,
      patch.costImpact ?? null,
      patch.scheduleImpactDays ?? null,
      patch.reason !== undefined ? patch.reason : null,
      patch.rfiId !== undefined ? patch.rfiId : null,
    ],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

// ─── Workflow transitions ─────────────────────────────────────────────────────

export async function submitChangeOrder(
  tenantId: string,
  id: string,
  userId: string,
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE change_orders SET
       status='submitted', submitted_by=$3, submitted_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft'
     RETURNING *`,
    [id, tenantId, userId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function approveChangeOrder(
  tenantId: string,
  id: string,
  userId: string,
  reviewNotes?: string,
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE change_orders SET
       status='approved', reviewed_by=$3, reviewed_at=now(),
       review_notes=$4, updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='submitted'
     RETURNING *`,
    [id, tenantId, userId, reviewNotes ?? null],
  )
  if (!res.rows[0]) return null
  const co = _map(res.rows[0])

  // Update EVM baseline BAC if there is a cost impact
  if (co.costImpact !== 0) {
    await _applyEvmBacAdjustment(tenantId, co.projectId, co.id, co.costImpact)
  }

  return co
}

export async function rejectChangeOrder(
  tenantId: string,
  id: string,
  userId: string,
  reviewNotes?: string,
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE change_orders SET
       status='rejected', reviewed_by=$3, reviewed_at=now(),
       review_notes=$4, updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='submitted'
     RETURNING *`,
    [id, tenantId, userId, reviewNotes ?? null],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

export async function voidChangeOrder(
  tenantId: string,
  id: string,
): Promise<ChangeOrder | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE change_orders SET status='void', updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status IN ('approved','rejected')
     RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _map(res.rows[0]) : null
}

// ─── Linked tasks ─────────────────────────────────────────────────────────────

export async function linkTasks(
  tenantId: string,
  changeOrderId: string,
  taskIds: string[],
): Promise<ChangeOrderTask[]> {
  if (taskIds.length === 0) return []
  const rows: ChangeOrderTask[] = []
  for (const taskId of taskIds) {
    const res = await tenantQuery(tenantId,
      `INSERT INTO change_order_tasks (tenant_id, change_order_id, schedule_task_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (change_order_id, schedule_task_id) DO NOTHING
       RETURNING *`,
      [tenantId, changeOrderId, taskId],
    )
    if (res.rows[0]) rows.push(_mapTask(res.rows[0]))
  }
  return rows
}

export async function unlinkTask(
  tenantId: string,
  changeOrderId: string,
  taskId: string,
): Promise<void> {
  await tenantQuery(tenantId,
    `DELETE FROM change_order_tasks
     WHERE tenant_id=$1 AND change_order_id=$2 AND schedule_task_id=$3`,
    [tenantId, changeOrderId, taskId],
  )
}

export async function listLinkedTasks(
  tenantId: string,
  changeOrderId: string,
): Promise<ChangeOrderTask[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM change_order_tasks
     WHERE tenant_id=$1 AND change_order_id=$2
     ORDER BY created_at`,
    [tenantId, changeOrderId],
  )
  return res.rows.map(_mapTask)
}

// ─── Project summary ──────────────────────────────────────────────────────────

export interface ChangeOrderSummary {
  total:                    number
  byStatus:                 Record<CoStatus, number>
  approvedCostImpact:       number
  pendingCostImpact:        number
  approvedScheduleImpact:   number
}

export async function getChangeOrderSummary(
  tenantId: string,
  projectId: string,
): Promise<ChangeOrderSummary> {
  const res = await tenantQuery(tenantId,
    `SELECT
       COUNT(*)                                                        AS total,
       COUNT(*) FILTER (WHERE status='draft')                         AS draft,
       COUNT(*) FILTER (WHERE status='submitted')                     AS submitted,
       COUNT(*) FILTER (WHERE status='approved')                      AS approved,
       COUNT(*) FILTER (WHERE status='rejected')                      AS rejected,
       COUNT(*) FILTER (WHERE status='void')                          AS void,
       COALESCE(SUM(cost_impact) FILTER (WHERE status='approved'), 0) AS approved_cost_impact,
       COALESCE(SUM(cost_impact) FILTER (WHERE status='submitted'), 0) AS pending_cost_impact,
       COALESCE(SUM(schedule_impact_days) FILTER (WHERE status='approved'), 0) AS approved_schedule_impact
     FROM change_orders
     WHERE tenant_id=$1 AND project_id=$2`,
    [tenantId, projectId],
  )
  const r = res.rows[0]
  return {
    total:                  Number(r['total']),
    byStatus: {
      draft:      Number(r['draft']),
      submitted:  Number(r['submitted']),
      approved:   Number(r['approved']),
      rejected:   Number(r['rejected']),
      void:       Number(r['void']),
    },
    approvedCostImpact:     Number(r['approved_cost_impact']),
    pendingCostImpact:      Number(r['pending_cost_impact']),
    approvedScheduleImpact: Number(r['approved_schedule_impact']),
  }
}

// ─── EVM BAC adjustment ───────────────────────────────────────────────────────

async function _applyEvmBacAdjustment(
  tenantId: string,
  projectId: string,
  changeOrderId: string,
  costImpact: number,
): Promise<void> {
  // Find the active (most recent) baseline for this project
  const baselineRes = await tenantQuery(tenantId,
    `SELECT id FROM evm_baselines
     WHERE tenant_id=$1 AND project_id=$2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, projectId],
  )
  if (!baselineRes.rows[0]) return

  const baselineId = baselineRes.rows[0]['id'] as string

  // Record the BAC adjustment as a cost actual with a synthetic WBS reference
  await tenantQuery(tenantId,
    `INSERT INTO evm_actuals
       (tenant_id, project_id, baseline_id, wbs_code, period_start, period_end, actual_cost, description)
     VALUES ($1,$2,$3,'CO-ADJUSTMENT',$4,$4,$5,$6)`,
    [
      tenantId, projectId, baselineId,
      new Date().toISOString().slice(0, 10),
      costImpact,
      `Change order adjustment (CO ID: ${changeOrderId})`,
    ],
  )
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _map(r: Record<string, unknown>): ChangeOrder {
  return {
    id:                   r['id'] as string,
    tenantId:             r['tenant_id'] as string,
    projectId:            r['project_id'] as string,
    coNumber:             Number(r['co_number']),
    title:                r['title'] as string,
    description:          (r['description'] as string) ?? null,
    type:                 r['type'] as CoType,
    status:               r['status'] as CoStatus,
    costImpact:           Number(r['cost_impact']),
    scheduleImpactDays:   Number(r['schedule_impact_days']),
    reason:               (r['reason'] as string) ?? null,
    rfiId:                (r['rfi_id'] as string) ?? null,
    submittedBy:          (r['submitted_by'] as string) ?? null,
    submittedAt:          r['submitted_at'] ? new Date(r['submitted_at'] as string).toISOString() : null,
    reviewedBy:           (r['reviewed_by'] as string) ?? null,
    reviewedAt:           r['reviewed_at'] ? new Date(r['reviewed_at'] as string).toISOString() : null,
    reviewNotes:          (r['review_notes'] as string) ?? null,
    createdBy:            (r['created_by'] as string) ?? null,
    createdAt:            new Date(r['created_at'] as string).toISOString(),
    updatedAt:            new Date(r['updated_at'] as string).toISOString(),
    linkedTaskCount:      r['linked_task_count'] != null ? Number(r['linked_task_count']) : undefined,
  }
}

function _mapTask(r: Record<string, unknown>): ChangeOrderTask {
  return {
    id:             r['id'] as string,
    changeOrderId:  r['change_order_id'] as string,
    scheduleTaskId: r['schedule_task_id'] as string,
    impactNotes:    (r['impact_notes'] as string) ?? null,
    createdAt:      new Date(r['created_at'] as string).toISOString(),
  }
}

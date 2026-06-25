/**
 * Denver Engineering — My Work service (v4.33.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign Wave 2 (see WORKFLOW_REDESIGN.md §7). The universal personal
 * queue: every actionable record assigned to / owned by the current user, unioned
 * across modules into lanes.
 *
 * Lanes backed by real data today:
 *   - assigned       — open work assigned to me (RFIs, punch, CAPA, actions, inspections)
 *   - approvals      — items awaiting my review (submittals, change orders)
 *   - overdue        — assigned/approval items past their due date (derived)
 *   - upcoming       — items due within the next 7 days (derived)
 *   - completedToday — actions I closed today (sense of progress)
 *
 * Deferred (no honest data source yet): "waiting on others" (needs created_by vs
 * assignee) and "blocked" (needs a blocker relation). Documented, not faked.
 *
 * The ranker/categorizer (`categorizeMyWork`) is a PURE, deterministic, unit-tested
 * function — same inputs always give the same lanes. The DB wrapper (`buildMyWork`)
 * only fetches and normalizes rows.
 */
import { tenantQuery } from '../../db/pool'

export type MyWorkKind = 'assigned' | 'approval' | 'completed'

export interface MyWorkItem {
  key:        string          // stable unique key: `${source}:${sourceId}`
  source:     string          // 'rfi' | 'submittal' | 'punch' | 'capa' | 'action' | 'inspection' | 'changeorder'
  sourceId:   string
  tab:        string          // nav tab id to deep-link into
  parentId:   string | null   // e.g. punch_list_id, ncr_id
  projectId:  string | null
  identifier: string | null   // e.g. "RFI 014", "CO 7"
  title:      string
  status:     string
  priority:   string | null
  dueDate:    string | null   // ISO date (YYYY-MM-DD) or null
  kind:       MyWorkKind
  // derived (filled by categorizeMyWork)
  daysOverdue: number
  overdue:     boolean
  upcoming:    boolean
}

export interface MyWorkLanes {
  assigned:       MyWorkItem[]
  approvals:      MyWorkItem[]
  overdue:        MyWorkItem[]
  upcoming:       MyWorkItem[]
  completedToday: MyWorkItem[]
}

export interface MyWorkResult {
  userId:      string
  generatedAt: string
  counts: {
    assigned:       number
    approvals:      number
    overdue:        number
    upcoming:       number
    completedToday: number
    total:          number
  }
  lanes: MyWorkLanes
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Whole-day difference (today − due) in UTC days. Positive ⇒ overdue. */
function dayDiff(dueISO: string, now: Date): number {
  const due   = Date.parse(dueISO.slice(0, 10) + 'T00:00:00Z')
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (Number.isNaN(due)) return 0
  return Math.floor((today - due) / 86_400_000)
}

function priorityRank(p: string | null): number {
  switch ((p ?? '').toLowerCase()) {
    case 'critical': return 4
    case 'high':     return 3
    case 'medium':   return 2
    case 'low':      return 1
    default:         return 0
  }
}

/** Earliest due first; undated last; ties broken by priority desc. */
function compareItems(a: MyWorkItem, b: MyWorkItem): number {
  const ad = a.dueDate ? Date.parse(a.dueDate.slice(0, 10)) : Number.POSITIVE_INFINITY
  const bd = b.dueDate ? Date.parse(b.dueDate.slice(0, 10)) : Number.POSITIVE_INFINITY
  if (ad !== bd) return ad - bd
  return priorityRank(b.priority) - priorityRank(a.priority)
}

/**
 * Pure categorizer: assign derived flags and bucket items into lanes.
 * An item can appear in more than one lane (e.g. an assigned RFI that is overdue
 * shows in both "assigned" and "overdue") — lanes are views, not exclusive owners.
 */
export function categorizeMyWork(items: MyWorkItem[], now: Date): MyWorkResult {
  const enriched = items.map((it) => {
    const diff = it.dueDate ? dayDiff(it.dueDate, now) : 0
    const isOpen = it.kind !== 'completed'
    return {
      ...it,
      daysOverdue: Math.max(0, diff),
      overdue:  isOpen && !!it.dueDate && diff > 0,
      upcoming: isOpen && !!it.dueDate && diff <= 0 && diff >= -7,
    }
  })

  const lanes: MyWorkLanes = {
    assigned:       enriched.filter(i => i.kind === 'assigned').sort(compareItems),
    approvals:      enriched.filter(i => i.kind === 'approval').sort(compareItems),
    overdue:        enriched.filter(i => i.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue),
    upcoming:       enriched.filter(i => i.upcoming).sort(compareItems),
    completedToday: enriched.filter(i => i.kind === 'completed'),
  }

  return {
    userId:      '',
    generatedAt: now.toISOString(),
    counts: {
      assigned:       lanes.assigned.length,
      approvals:      lanes.approvals.length,
      overdue:        lanes.overdue.length,
      upcoming:       lanes.upcoming.length,
      completedToday: lanes.completedToday.length,
      total:          enriched.length,
    },
    lanes,
  }
}

// ─── DB wrapper ───────────────────────────────────────────────────────────────

function toISODate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v)
  return s.length >= 10 ? s.slice(0, 10) : s
}

type Row = Record<string, unknown>
const str = (v: unknown): string => (v == null ? '' : String(v))
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v))

/**
 * Fetch + normalize the current user's work across modules, then categorize.
 * All reads are tenant-scoped (RLS-respecting) via tenantQuery.
 */
export async function buildMyWork(tenantId: string, userId: string, now: Date = new Date()): Promise<MyWorkResult> {
  const startOfTodayISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()

  const [rfis, punch, capa, actions, inspections, submittals, changeOrders, doneActions] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, rfi_number, title, status, priority, due_date, project_id
         FROM rfis WHERE tenant_id=$1 AND assigned_to=$2 AND status IN ('open','pending') LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, item_number, title, status, priority, due_date, punch_list_id, project_id
         FROM punch_items WHERE tenant_id=$1 AND assigned_to=$2 AND status='open' LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, ncr_id, project_id, description, status, due_date
         FROM corrective_actions WHERE tenant_id=$1 AND assigned_to=$2 AND status IN ('open','in_progress') LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, title, source_module, source_id, priority, status, due_at, project_id
         FROM actions WHERE tenant_id=$1 AND assigned_to_user_id=$2 AND status IN ('open','in_progress') LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, inspection_number, title, status, scheduled_date, project_id
         FROM inspections WHERE tenant_id=$1 AND inspector_id=$2 AND status='scheduled' LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, submittal_number, title, status, due_date, project_id
         FROM submittals WHERE tenant_id=$1 AND reviewed_by=$2 AND status IN ('submitted','under_review') LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, co_number, title, status, project_id
         FROM change_orders WHERE tenant_id=$1 AND reviewed_by=$2 AND status='submitted' LIMIT 500`, [tenantId, userId]),
    tenantQuery(tenantId,
      `SELECT id, title, source_module, source_id, status, project_id
         FROM actions WHERE tenant_id=$1 AND assigned_to_user_id=$2 AND status='completed' AND updated_at >= $3 LIMIT 500`,
      [tenantId, userId, startOfTodayISO]),
  ])

  const items: MyWorkItem[] = []

  for (const r of rfis.rows as Row[]) items.push({
    key: `rfi:${str(r.id)}`, source: 'rfi', sourceId: str(r.id), tab: 'rfis', parentId: null,
    projectId: strOrNull(r.project_id), identifier: r.rfi_number != null ? `RFI ${str(r.rfi_number)}` : null,
    title: str(r.title), status: str(r.status), priority: strOrNull(r.priority), dueDate: toISODate(r.due_date),
    kind: 'assigned', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of punch.rows as Row[]) items.push({
    key: `punch:${str(r.id)}`, source: 'punch', sourceId: str(r.id), tab: 'punch', parentId: strOrNull(r.punch_list_id),
    projectId: strOrNull(r.project_id), identifier: r.item_number != null ? `PL ${str(r.item_number)}` : null,
    title: str(r.title), status: str(r.status), priority: strOrNull(r.priority), dueDate: toISODate(r.due_date),
    kind: 'assigned', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of capa.rows as Row[]) items.push({
    key: `capa:${str(r.id)}`, source: 'capa', sourceId: str(r.id), tab: 'ncr', parentId: strOrNull(r.ncr_id),
    projectId: strOrNull(r.project_id), identifier: null,
    title: str(r.description), status: str(r.status), priority: null, dueDate: toISODate(r.due_date),
    kind: 'assigned', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of actions.rows as Row[]) items.push({
    key: `action:${str(r.id)}`, source: 'action', sourceId: str(r.id), tab: 'actions', parentId: null,
    projectId: strOrNull(r.project_id), identifier: null,
    title: str(r.title), status: str(r.status), priority: strOrNull(r.priority), dueDate: toISODate(r.due_at),
    kind: 'assigned', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of inspections.rows as Row[]) items.push({
    key: `inspection:${str(r.id)}`, source: 'inspection', sourceId: str(r.id), tab: 'inspections', parentId: null,
    projectId: strOrNull(r.project_id), identifier: r.inspection_number != null ? `INS ${str(r.inspection_number)}` : null,
    title: str(r.title), status: str(r.status), priority: null, dueDate: toISODate(r.scheduled_date),
    kind: 'assigned', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of submittals.rows as Row[]) items.push({
    key: `submittal:${str(r.id)}`, source: 'submittal', sourceId: str(r.id), tab: 'submittals', parentId: null,
    projectId: strOrNull(r.project_id), identifier: r.submittal_number != null ? `SUB ${str(r.submittal_number)}` : null,
    title: str(r.title), status: str(r.status), priority: null, dueDate: toISODate(r.due_date),
    kind: 'approval', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of changeOrders.rows as Row[]) items.push({
    key: `changeorder:${str(r.id)}`, source: 'changeorder', sourceId: str(r.id), tab: 'changeorders', parentId: null,
    projectId: strOrNull(r.project_id), identifier: r.co_number != null ? `CO ${str(r.co_number)}` : null,
    title: str(r.title), status: str(r.status), priority: null, dueDate: null,
    kind: 'approval', daysOverdue: 0, overdue: false, upcoming: false,
  })
  for (const r of doneActions.rows as Row[]) items.push({
    key: `action:${str(r.id)}`, source: 'action', sourceId: str(r.id), tab: 'actions', parentId: null,
    projectId: strOrNull(r.project_id), identifier: null,
    title: str(r.title), status: str(r.status), priority: null, dueDate: null,
    kind: 'completed', daysOverdue: 0, overdue: false, upcoming: false,
  })

  const result = categorizeMyWork(items, now)
  result.userId = userId
  return result
}

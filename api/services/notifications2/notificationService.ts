/**
 * Denver Engineering — Notification Service (ADR-014 Phase 2C-4B)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two layers, not one row (owner decision D13):
 *
 *   notifications             the shared ALERT EVENT — what happened, plus the
 *                             source authority required to see it
 *   notification_deliveries   PER-USER read/dismiss state
 *
 * Before this slice every function here took only a tenant id. `markRead` and
 * `dismiss` wrote shared columns, so one user marking an alert read marked it
 * read for the whole tenant, and `read-all`/`clear` wiped everybody's feed.
 * There was no recipient to authorize against.
 *
 * Two checks now guard every path, and BOTH are required:
 *
 *   delivery ownership   the row must belong to the live principal
 *   live source authority  the principal must STILL hold the event's
 *                        `required_capabilities` — a delivery is not permanent
 *                        authorization, so a demoted user stops seeing what
 *                        they were sent while authorized
 *
 * Responsibilities:
 *   1. scanAndGenerate(tenantId) — scan modules, create events, fan out
 *      deliveries to eligible recipients only
 *   2. per-user helpers — list, count, markRead, dismiss, markAllRead, clearAll
 *
 * Scan rules:
 *   budget      — ACWP > 90% or 100% of revised budget
 *   action_item — overdue action items (due_date < today, status != done)
 *   bid_deadline — proposals with bid_due_date within 3 days, status=draft/submitted
 *   meeting     — meetings scheduled today (entry_date = today)
 *   change_order — change orders in 'submitted' status for > 7 days
 *   invoice     — subcontract invoices in 'submitted' status for > 14 days
 *   compliance  — (placeholder: compliance items past due)
 */
import { tenantQuery, tenantTransaction } from '../../db/pool'
import { roleHasCapability, isUserRole, type ServerCapability } from '../../authz/capabilities'
import {
  sourcePolicy, recipientRequirement, DELIVERY_BASE_CAPABILITY,
  NOTIFICATION_SOURCE_POLICIES,
  type NotificationSourcePolicy,
} from '../../authz/notificationSourcePolicies'

export type NotifPriority = 'low' | 'medium' | 'high' | 'critical'
export type NotifCategory =
  | 'budget' | 'schedule' | 'action_item' | 'bid_deadline'
  | 'meeting' | 'compliance' | 'change_order' | 'invoice' | 'team' | 'system'

export interface Notification {
  id:          string
  tenantId:    string
  category:    NotifCategory
  priority:    NotifPriority
  title:       string
  body:        string | null
  sourceType:  string | null
  sourceId:    string | null
  linkTab:     string | null
  readAt:      string | null
  dismissedAt: string | null
  createdAt:   string
}

function rowToNotif(r: Record<string, unknown>): Notification {
  return {
    id:          r['id']           as string,
    tenantId:    r['tenant_id']    as string,
    category:    r['category']     as NotifCategory,
    priority:    r['priority']     as NotifPriority,
    title:       r['title']        as string,
    body:        r['body']         as string | null,
    sourceType:  r['source_type']  as string | null,
    sourceId:    r['source_id']    as string | null,
    linkTab:     r['link_tab']     as string | null,
    readAt:      r['read_at']      as string | null,
    dismissedAt: r['dismissed_at'] as string | null,
    createdAt:   r['created_at']   as string,
  }
}

// ─── Event creation + recipient fan-out ──────────────────────────────────────

interface InsertNotif {
  category:   NotifCategory
  priority:   NotifPriority
  title:      string
  body?:      string
  sourceType?: string
  sourceId?:  string
  linkTab?:   string
  /** Which source policy governs this alert. Server-side only — never from a request. */
  policyKey:  string
  /** For DIRECT_USER alerts: the user the source row names. */
  directUserId?: string | null
}

interface TenantUser { id: string; role: string }

/**
 * Active members of the tenant, with their CURRENT role.
 *
 * Eligibility is computed from `roleHasCapability` — the same projection the
 * request path authorizes with — so notifications cannot drift onto a parallel
 * role table of their own.
 */
async function activeTenantUsers(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: TenantUser[] }> },
  tenantId: string,
): Promise<TenantUser[]> {
  const res = await client.query(
    `SELECT id, role FROM users WHERE tenant_id = $1 AND is_active = TRUE`,
    [tenantId],
  )
  return res.rows
}

/** True when a role satisfies every capability a delivery of this event needs. */
function eligible(role: string, required: readonly ServerCapability[]): boolean {
  if (!isUserRole(role)) return false
  return required.every(c => roleHasCapability(role, c))
}

/**
 * Who should receive this event.
 *
 * Every strategy applies the same eligibility test; they differ only in the
 * candidate set. There is no branch that returns "everyone", and an ineligible
 * DIRECT_USER target yields zero recipients rather than falling back to the
 * owner — silently redirecting someone's alert to their supervisor would be a
 * disclosure, not a courtesy.
 */
async function resolveRecipients(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: TenantUser[] }> },
  tenantId: string,
  policy: NotificationSourcePolicy,
  directUserId?: string | null,
): Promise<string[]> {
  const required = recipientRequirement(policy)
  const users = await activeTenantUsers(client, tenantId)

  switch (policy.audienceStrategy) {
    case 'DIRECT_USER': {
      if (!directUserId) return []
      const target = users.find(u => u.id === directUserId)
      return target && eligible(target.role, required) ? [target.id] : []
    }
    case 'CAPABILITY_HOLDERS':
      return users.filter(u => eligible(u.role, required)).map(u => u.id)
    case 'LEGACY_OWNER_ONLY':
      return users.filter(u => u.role === 'owner' && eligible(u.role, required)).map(u => u.id)
  }
}

/**
 * Create one event and its deliveries as a single transaction.
 *
 * If any delivery insert fails the event rolls back with it, so there is never
 * an event nobody can see but which still occupies the feed. Zero eligible
 * recipients is a VALID result — the event is recorded, no delivery exists —
 * and is deliberately distinguishable from a failure.
 *
 * Returns the number of deliveries created.
 */
async function insertNotif(tenantId: string, n: InsertNotif): Promise<number> {
  // Throws for an unregistered generator rather than defaulting to broadcast.
  const policy = sourcePolicy(n.policyKey)

  return tenantTransaction(tenantId, async client => {
    const evt = await client.query(
      `INSERT INTO notifications
         (tenant_id, category, priority, title, body, source_type, source_id, link_tab,
          policy_key, required_capabilities, audience_strategy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [tenantId, n.category, n.priority, n.title,
       n.body ?? null, n.sourceType ?? null, n.sourceId ?? null, n.linkTab ?? null,
       policy.policyKey, policy.requiredCapabilities as unknown as string[],
       policy.audienceStrategy],
    )
    const notificationId = (evt.rows[0] as unknown as { id: string }).id

    const recipients = await resolveRecipients(
      client as never, tenantId, policy, n.directUserId,
    )
    for (const userId of recipients) {
      // ON CONFLICT complements the UNIQUE constraint; the constraint is what
      // actually makes a concurrent scan safe.
      await client.query(
        `INSERT INTO notification_deliveries (tenant_id, notification_id, user_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (notification_id, user_id) DO NOTHING`,
        [tenantId, notificationId, userId],
      )
    }
    return recipients.length
  })
}

// ─── Scan & generate ──────────────────────────────────────────────────────────

export async function scanAndGenerate(tenantId: string): Promise<number> {
  let inserted = 0

  // ── 1. Budget alerts: ACWP vs revised budget per project ─────────────────
  try {
    const budgetRes = await tenantQuery(tenantId, `
      SELECT
        p.id          AS project_id,
        p.name        AS project_name,
        b.bac         AS original_bac,
        COALESCE(SUM(co.cost_impact) FILTER (WHERE co.status='approved'), 0) AS approved_co,
        COALESCE(SUM(a.amount), 0)  AS acwp
      FROM projects p
      LEFT JOIN evm_baselines b   ON b.project_id = p.id AND b.tenant_id = p.tenant_id AND b.is_active=true
      LEFT JOIN change_orders co  ON co.project_id = p.id AND co.tenant_id = p.tenant_id
      LEFT JOIN evm_actuals a     ON a.project_id = p.id AND a.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1
      GROUP BY p.id, p.name, b.bac
      HAVING b.bac IS NOT NULL
    `, [tenantId])

    for (const row of budgetRes.rows as Record<string, unknown>[]) {
      const revised = Number(row['original_bac']) + Number(row['approved_co'])
      const acwp    = Number(row['acwp'])
      if (revised <= 0) continue
      const pct = acwp / revised

      if (pct >= 1.0) {
        await insertNotif(tenantId, {
          policyKey: 'budget.overrun',
          category: 'budget', priority: 'critical',
          title:   `Budget exceeded: ${row['project_name']}`,
          body:    `ACWP $${Math.round(acwp).toLocaleString()} has exceeded revised budget $${Math.round(revised).toLocaleString()} (${Math.round(pct*100)}%).`,
          sourceType: 'project', sourceId: row['project_id'] as string,
          linkTab: 'costcontrol',
        })
        inserted++
      } else if (pct >= 0.9) {
        await insertNotif(tenantId, {
          policyKey: 'budget.overrun',
          category: 'budget', priority: 'high',
          title:   `Budget at ${Math.round(pct*100)}%: ${row['project_name']}`,
          body:    `ACWP $${Math.round(acwp).toLocaleString()} is approaching revised budget $${Math.round(revised).toLocaleString()}.`,
          sourceType: 'project', sourceId: row['project_id'] as string,
          linkTab: 'costcontrol',
        })
        inserted++
      }
    }
  } catch { /* skip if tables missing */ }

  // ── 2. Overdue action items ───────────────────────────────────────────────
  try {
    const actionRes = await tenantQuery(tenantId, `
      SELECT id, title, due_date, assignee, assigned_to_user_id
      FROM   action_items
      WHERE  tenant_id = $1
        AND  due_date  < CURRENT_DATE
        AND  status NOT IN ('done','closed','cancelled')
      ORDER  BY due_date ASC
      LIMIT  20
    `, [tenantId])

    for (const row of actionRes.rows as Record<string, unknown>[]) {
      const daysOverdue = Math.round((Date.now() - new Date(row['due_date'] as string).getTime()) / 86_400_000)
      await insertNotif(tenantId, {
        policyKey: 'action.overdue',
        // The source row names its assignee — this is the one genuinely
        // personal alert, and it goes to that user alone.
        directUserId: (row['assigned_to_user_id'] as string | null) ?? null,
        category: 'action_item',
        priority: daysOverdue >= 7 ? 'high' : 'medium',
        title:   `Overdue: ${row['title']}`,
        body:    `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue${row['assignee'] ? ` · ${row['assignee']}` : ''}.`,
        sourceType: 'action_item', sourceId: row['id'] as string,
        linkTab: 'actions',
      })
      inserted++
    }
  } catch { /* skip */ }

  // ── 3. Bid deadlines within 3 days ───────────────────────────────────────
  try {
    const bidRes = await tenantQuery(tenantId, `
      SELECT id, title, client_name, bid_due_date
      FROM   proposals
      WHERE  tenant_id    = $1
        AND  status      IN ('draft','submitted')
        AND  bid_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
    `, [tenantId])

    for (const row of bidRes.rows as Record<string, unknown>[]) {
      const daysLeft = Math.round((new Date(row['bid_due_date'] as string).getTime() - Date.now()) / 86_400_000)
      await insertNotif(tenantId, {
        policyKey: 'bid.deadline',
        category: 'bid_deadline',
        priority: daysLeft === 0 ? 'critical' : daysLeft <= 1 ? 'high' : 'medium',
        title:   `Bid due ${daysLeft === 0 ? 'today' : `in ${daysLeft}d`}: ${row['title']}`,
        body:    `${row['client_name']} · Deadline: ${new Date(row['bid_due_date'] as string).toLocaleDateString()}.`,
        sourceType: 'proposal', sourceId: row['id'] as string,
        linkTab: 'proposals',
      })
      inserted++
    }
  } catch { /* skip */ }

  // ── 4. Meetings today ─────────────────────────────────────────────────────
  try {
    const mtgRes = await tenantQuery(tenantId, `
      SELECT id, title, meeting_type
      FROM   meetings
      WHERE  tenant_id    = $1
        AND  meeting_date = CURRENT_DATE
        AND  status      != 'archived'
    `, [tenantId])

    for (const row of mtgRes.rows as Record<string, unknown>[]) {
      await insertNotif(tenantId, {
        policyKey: 'meeting.today',
        category: 'meeting', priority: 'low',
        title:   `Meeting today: ${row['title']}`,
        body:    `Type: ${row['meeting_type']}.`,
        sourceType: 'meeting', sourceId: row['id'] as string,
        linkTab: 'meetings',
      })
      inserted++
    }
  } catch { /* skip */ }

  // ── 5. Stale submitted change orders (> 7 days) ───────────────────────────
  try {
    const coRes = await tenantQuery(tenantId, `
      SELECT id, title, co_number, submitted_at
      FROM   change_orders
      WHERE  tenant_id   = $1
        AND  status      = 'submitted'
        AND  submitted_at < NOW() - INTERVAL '7 days'
    `, [tenantId])

    for (const row of coRes.rows as Record<string, unknown>[]) {
      const days = Math.round((Date.now() - new Date(row['submitted_at'] as string).getTime()) / 86_400_000)
      await insertNotif(tenantId, {
        policyKey: 'change_order.stale',
        category: 'change_order', priority: 'medium',
        title:   `CO-${String(row['co_number']).padStart(3,'0')} awaiting approval (${days}d)`,
        body:    `"${row['title']}" has been submitted for ${days} days without a decision.`,
        sourceType: 'change_order', sourceId: row['id'] as string,
        linkTab: 'changeorders',
      })
      inserted++
    }
  } catch { /* skip */ }

  // ── 6. Stale submitted invoices (> 14 days) ───────────────────────────────
  try {
    const invRes = await tenantQuery(tenantId, `
      SELECT i.id, i.inv_number, i.gross_amount, i.submitted_at, v.name AS vendor_name
      FROM   subcontract_invoices i
      JOIN   subcontracts s ON s.id = i.subcontract_id AND s.tenant_id = i.tenant_id
      LEFT JOIN vendors v  ON v.id = s.vendor_id       AND v.tenant_id = s.tenant_id
      WHERE  i.tenant_id   = $1
        AND  i.status      = 'submitted'
        AND  i.submitted_at < NOW() - INTERVAL '14 days'
    `, [tenantId])

    for (const row of invRes.rows as Record<string, unknown>[]) {
      const days = Math.round((Date.now() - new Date(row['submitted_at'] as string).getTime()) / 86_400_000)
      await insertNotif(tenantId, {
        policyKey: 'invoice.stale',
        category: 'invoice', priority: 'medium',
        title:   `Invoice INV-${String(row['inv_number']).padStart(4,'0')} pending (${days}d)`,
        body:    `$${Number(row['gross_amount']).toLocaleString()} from ${row['vendor_name'] ?? 'vendor'} awaiting review.`,
        sourceType: 'invoice', sourceId: row['id'] as string,
        linkTab: 'subcontracts',
      })
      inserted++
    }
  } catch { /* skip */ }

  return inserted
}

// ─── Per-user access ─────────────────────────────────────────────────────────
//
// Every function below takes the LIVE principal's id and role. The role is not
// decoration: it re-evaluates `required_capabilities` on the event, so authority
// lost after delivery takes effect immediately. `$3::text[]` is the caller's
// current capability set, and `n.required_capabilities <@ $3` asks whether the
// event's requirement is contained in it.

/** Capabilities the principal currently holds, as a SQL array literal input. */
function heldCapabilities(role: string): string[] {
  if (!isUserRole(role)) return []
  // Only the capabilities an event may require need to be projected.
  return ALL_REQUIRABLE.filter(c => roleHasCapability(role, c))
}

/**
 * The closed set of capabilities an event can require: every source policy's
 * requirement plus the delivery base. Derived, so a new policy cannot be
 * forgotten here.
 */
const ALL_REQUIRABLE: ServerCapability[] = [...new Set<ServerCapability>([
  DELIVERY_BASE_CAPABILITY,
  ...NOTIFICATION_SOURCE_POLICIES.flatMap(p => p.requiredCapabilities),
])]

/** Shared predicate: my delivery, in my tenant, on an event I may still see. */
const ACCESSIBLE = `
  d.tenant_id = $1
  AND d.user_id = $2
  AND n.required_capabilities <@ $3::text[]
`

export async function listNotifications(
  tenantId: string,
  userId:   string,
  role:     string,
  opts:     { unreadOnly?: boolean; category?: NotifCategory; limit?: number } = {},
): Promise<Notification[]> {
  const conditions = [ACCESSIBLE, 'd.dismissed_at IS NULL']
  const params: unknown[] = [tenantId, userId, heldCapabilities(role)]
  let idx = 4

  if (opts.unreadOnly) conditions.push('d.read_at IS NULL')
  if (opts.category)  { conditions.push(`n.category = $${idx++}`); params.push(opts.category) }

  const res = await tenantQuery(tenantId, `
    SELECT n.id, n.tenant_id, n.category, n.priority, n.title, n.body,
           n.source_type, n.source_id, n.link_tab, n.created_at,
           d.read_at, d.dismissed_at
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE n.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      n.created_at DESC
    LIMIT ${opts.limit ?? 100}
  `, params)
  return res.rows.map(r => rowToNotif(r as Record<string, unknown>))
}

export async function unreadCount(
  tenantId: string, userId: string, role: string,
): Promise<number> {
  const res = await tenantQuery(tenantId, `
    SELECT COUNT(*)::int AS cnt
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    WHERE ${ACCESSIBLE} AND d.read_at IS NULL AND d.dismissed_at IS NULL
  `, [tenantId, userId, heldCapabilities(role)])
  return Number(res.rows[0]?.['cnt'] ?? 0)
}

/**
 * Mark one event read FOR THIS USER.
 *
 * The `id` is the event id — the public notification id the client already
 * uses — but the UPDATE targets the caller's own delivery row. A peer's
 * delivery is unreachable: there is no id a caller can supply that names it.
 * Returns false when the caller has no accessible delivery, so the route can
 * answer 404 without disclosing whether the event exists.
 */
export async function markRead(
  tenantId: string, userId: string, role: string, notificationId: string,
): Promise<boolean> {
  const res = await tenantQuery(tenantId, `
    UPDATE notification_deliveries d
    SET    read_at = NOW()
    FROM   notifications n
    WHERE  n.id = d.notification_id
      AND  d.notification_id = $4
      AND  ${ACCESSIBLE}
      AND  d.read_at IS NULL
    RETURNING d.id
  `, [tenantId, userId, heldCapabilities(role), notificationId])
  return (res.rowCount ?? 0) > 0
}

export async function dismiss(
  tenantId: string, userId: string, role: string, notificationId: string,
): Promise<boolean> {
  const res = await tenantQuery(tenantId, `
    UPDATE notification_deliveries d
    SET    dismissed_at = NOW()
    FROM   notifications n
    WHERE  n.id = d.notification_id
      AND  d.notification_id = $4
      AND  ${ACCESSIBLE}
      AND  d.dismissed_at IS NULL
    RETURNING d.id
  `, [tenantId, userId, heldCapabilities(role), notificationId])
  return (res.rowCount ?? 0) > 0
}

/** Mark every accessible delivery of THIS user read. Other users are untouched. */
export async function markAllRead(
  tenantId: string, userId: string, role: string,
): Promise<number> {
  const res = await tenantQuery(tenantId, `
    UPDATE notification_deliveries d
    SET    read_at = NOW()
    FROM   notifications n
    WHERE  n.id = d.notification_id
      AND  ${ACCESSIBLE}
      AND  d.read_at IS NULL
      AND  d.dismissed_at IS NULL
    RETURNING d.id
  `, [tenantId, userId, heldCapabilities(role)])
  return res.rowCount ?? 0
}

/**
 * "Clear my inbox" — dismisses this user's deliveries.
 *
 * The shared event survives, and so does every other user's delivery. Before
 * this slice `clear` dismissed the tenant's entire feed for everyone.
 */
export async function clearAll(
  tenantId: string, userId: string, role: string,
): Promise<number> {
  const res = await tenantQuery(tenantId, `
    UPDATE notification_deliveries d
    SET    dismissed_at = NOW()
    FROM   notifications n
    WHERE  n.id = d.notification_id
      AND  ${ACCESSIBLE}
      AND  d.dismissed_at IS NULL
    RETURNING d.id
  `, [tenantId, userId, heldCapabilities(role)])
  return res.rowCount ?? 0
}

/**
 * Denver Engineering — Notification Service (v10.14.0)
 *
 * Two responsibilities:
 *   1. scanAndGenerate(tenantId) — query all modules, insert new alerts
 *   2. CRUD helpers — list, markRead, dismiss, unreadCount
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
import { tenantQuery } from '../../db/pool'

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

// ─── Insert helper ────────────────────────────────────────────────────────────

interface InsertNotif {
  category:   NotifCategory
  priority:   NotifPriority
  title:      string
  body?:      string
  sourceType?: string
  sourceId?:  string
  linkTab?:   string
}

async function insertNotif(tenantId: string, n: InsertNotif): Promise<void> {
  await tenantQuery(tenantId, `
    INSERT INTO notifications
      (tenant_id, category, priority, title, body, source_type, source_id, link_tab)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [tenantId, n.category, n.priority, n.title,
      n.body       ?? null, n.sourceType ?? null,
      n.sourceId   ?? null, n.linkTab    ?? null])
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
      LEFT JOIN evm_baselines b   ON b.project_id = p.id AND b.tenant_id = p.tenant_id AND b.status='active'
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
          category: 'budget', priority: 'critical',
          title:   `Budget exceeded: ${row['project_name']}`,
          body:    `ACWP $${Math.round(acwp).toLocaleString()} has exceeded revised budget $${Math.round(revised).toLocaleString()} (${Math.round(pct*100)}%).`,
          sourceType: 'project', sourceId: row['project_id'] as string,
          linkTab: 'costcontrol',
        })
        inserted++
      } else if (pct >= 0.9) {
        await insertNotif(tenantId, {
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
      SELECT id, title, due_date, assignee
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

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listNotifications(
  tenantId: string,
  opts:     { unreadOnly?: boolean; category?: NotifCategory; limit?: number } = {},
): Promise<Notification[]> {
  const conditions = ['tenant_id = $1', 'dismissed_at IS NULL']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (opts.unreadOnly) conditions.push('read_at IS NULL')
  if (opts.category)  { conditions.push(`category = $${idx++}`); params.push(opts.category) }

  const res = await tenantQuery(tenantId, `
    SELECT * FROM notifications
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      created_at DESC
    LIMIT ${opts.limit ?? 100}
  `, params)
  return res.rows.map(r => rowToNotif(r as Record<string, unknown>))
}

export async function unreadCount(tenantId: string): Promise<number> {
  const res = await tenantQuery(tenantId, `
    SELECT COUNT(*)::int AS cnt FROM notifications
    WHERE tenant_id = $1 AND read_at IS NULL AND dismissed_at IS NULL
  `, [tenantId])
  return Number(res.rows[0]?.['cnt'] ?? 0)
}

export async function markRead(tenantId: string, id: string): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE notifications SET read_at = NOW()
    WHERE tenant_id = $1 AND id = $2 AND read_at IS NULL
  `, [tenantId, id])
}

export async function markAllRead(tenantId: string): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE notifications SET read_at = NOW()
    WHERE tenant_id = $1 AND read_at IS NULL AND dismissed_at IS NULL
  `, [tenantId])
}

export async function dismiss(tenantId: string, id: string): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE notifications SET dismissed_at = NOW()
    WHERE tenant_id = $1 AND id = $2
  `, [tenantId, id])
}

export async function clearAll(tenantId: string): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE notifications SET dismissed_at = NOW()
    WHERE tenant_id = $1 AND dismissed_at IS NULL
  `, [tenantId])
}

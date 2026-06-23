/**
 * Denver Engineering — Pay Applications (AIA G702/G703) (v4.45.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Progress billing against a Schedule of Values: computes the AIA G703
 * continuation sheet (per SOV line) and the G702 summary (retention, total
 * earned less retainage, current payment due) — the core financial-parity gap
 * vs Procore Financials.
 *
 * The math (`computeBilling`) is a PURE function over fetched rows, so it is
 * fully unit-testable and auditable. The DB builders wrap it.
 *
 * Reference (AIA G702):
 *   completed & stored to date  = previous + this period + materials stored
 *   total earned less retainage = total completed&stored − retainage
 *   current payment due         = total earned less retainage − previous certificates
 */
import { tenantQuery, tenantTransaction } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SovItemRow { id: string; item_no?: string; description?: string; scheduled_value?: unknown }
export interface LineAmountRow { sov_item_id: string; work_completed?: unknown; materials_stored?: unknown }
export interface PriorEntry { previousCompleted: number }

export interface G703Line {
  sovItemId: string
  itemNo: string
  description: string
  scheduledValue: number
  fromPrevious: number       // completed & stored in prior periods
  thisPeriod: number         // work completed this period
  materialsStored: number    // materials presently stored this period
  completedAndStored: number // G703 col G
  pctComplete: number        // G703 col G/C
  balanceToFinish: number    // G703 col H
  retainage: number          // G703 col I
}

export interface G702Summary {
  originalContractSum: number
  totalCompletedAndStored: number
  totalRetainage: number
  totalEarnedLessRetainage: number
  lessPreviousCertificates: number
  currentPaymentDue: number
  balanceToFinishPlusRetainage: number
}

export interface BillingComputation {
  retentionPct: number
  lines: G703Line[]
  summary: G702Summary
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return isNaN(n) ? 0 : n
}
const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10

// ─── Pure computation ─────────────────────────────────────────────────────────

/**
 * Compute the G703 lines and G702 summary for one pay application.
 * @param sovItems     the project's schedule of values
 * @param thisLines    this application's per-SOV amounts (work this period + materials stored)
 * @param priorBySov   completed-and-stored to date from PRIOR approved/paid applications, per SOV id
 * @param retentionPct retention percentage for this application (0–100)
 */
export function computeBilling(
  sovItems: SovItemRow[], thisLines: LineAmountRow[], priorBySov: Map<string, PriorEntry>, retentionPct: number,
): BillingComputation {
  const ret = Math.max(0, Math.min(100, num(retentionPct)))

  const lines: G703Line[] = sovItems.map(s => {
    const scheduledValue = num(s.scheduled_value)
    const l = thisLines.find(x => x.sov_item_id === s.id)
    const thisPeriod = num(l?.work_completed)
    const materialsStored = num(l?.materials_stored)
    const fromPrevious = num(priorBySov.get(s.id)?.previousCompleted)
    const completedAndStored = fromPrevious + thisPeriod + materialsStored
    const pctComplete = scheduledValue > 0 ? (completedAndStored / scheduledValue) * 100 : 0
    const retainage = completedAndStored * ret / 100
    return {
      sovItemId: s.id,
      itemNo: s.item_no ?? '',
      description: s.description ?? '',
      scheduledValue: r2(scheduledValue),
      fromPrevious: r2(fromPrevious),
      thisPeriod: r2(thisPeriod),
      materialsStored: r2(materialsStored),
      completedAndStored: r2(completedAndStored),
      pctComplete: r1(pctComplete),
      balanceToFinish: r2(scheduledValue - completedAndStored),
      retainage: r2(retainage),
    }
  })

  const sum = (pick: (l: G703Line) => number) => lines.reduce((acc, l) => acc + pick(l), 0)
  const originalContractSum = sum(l => l.scheduledValue)
  const totalCompletedAndStored = sum(l => l.completedAndStored)
  const totalRetainage = sum(l => l.retainage)
  const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage
  const sumPrevious = sum(l => l.fromPrevious)
  // Previous certificates = prior completed-and-stored, net of retention (constant-retention assumption).
  const lessPreviousCertificates = sumPrevious - (sumPrevious * ret / 100)
  const currentPaymentDue = totalEarnedLessRetainage - lessPreviousCertificates
  const balanceToFinishPlusRetainage = originalContractSum - totalEarnedLessRetainage

  return {
    retentionPct: ret,
    lines,
    summary: {
      originalContractSum: r2(originalContractSum),
      totalCompletedAndStored: r2(totalCompletedAndStored),
      totalRetainage: r2(totalRetainage),
      totalEarnedLessRetainage: r2(totalEarnedLessRetainage),
      lessPreviousCertificates: r2(lessPreviousCertificates),
      currentPaymentDue: r2(currentPaymentDue),
      balanceToFinishPlusRetainage: r2(balanceToFinishPlusRetainage),
    },
  }
}

// ─── Schedule of Values ───────────────────────────────────────────────────────

export async function listSovItems(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, item_no, description, scheduled_value, cost_code, sort_order
       FROM sov_items WHERE tenant_id=$1 AND project_id=$2
      ORDER BY sort_order, item_no`, [tenantId, projectId])
  return res.rows
}

export async function createSovItem(
  tenantId: string, projectId: string,
  body: { item_no: string; description: string; scheduled_value: number; cost_code?: string | null; sort_order?: number },
  userId: string | null,
) {
  const res = await tenantQuery(tenantId,
    `INSERT INTO sov_items (tenant_id, project_id, item_no, description, scheduled_value, cost_code, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, item_no, description, scheduled_value, cost_code, sort_order`,
    [tenantId, projectId, body.item_no, body.description, body.scheduled_value, body.cost_code ?? null, body.sort_order ?? 0, userId])
  return res.rows[0]
}

// ─── Pay applications ─────────────────────────────────────────────────────────

export async function listPayApplications(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, application_number, status, retention_pct, period_start, period_end, invoice_date, created_at
       FROM pay_applications WHERE tenant_id=$1 AND project_id=$2
      ORDER BY application_number DESC`, [tenantId, projectId])
  return res.rows
}

export async function createPayApplication(
  tenantId: string, projectId: string,
  body: { retention_pct?: number; period_start?: string; period_end?: string; invoice_date?: string; seed_from_sov?: boolean },
  userId: string | null,
) {
  return tenantTransaction(tenantId, async (client) => {
    const numRes = await client.query(
      `SELECT COALESCE(MAX(application_number),0)+1 AS next FROM pay_applications WHERE tenant_id=$1 AND project_id=$2`,
      [tenantId, projectId])
    const nextNo = numRes.rows[0].next as number
    const appRes = await client.query(
      `INSERT INTO pay_applications (tenant_id, project_id, application_number, retention_pct, period_start, period_end, invoice_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, application_number, status, retention_pct, period_start, period_end, invoice_date`,
      [tenantId, projectId, nextNo, body.retention_pct ?? 10, body.period_start ?? null, body.period_end ?? null, body.invoice_date ?? null, userId])
    const app = appRes.rows[0]
    if (body.seed_from_sov) {
      await client.query(
        `INSERT INTO pay_application_lines (tenant_id, pay_application_id, sov_item_id)
         SELECT $1, $2, id FROM sov_items WHERE tenant_id=$1 AND project_id=$3
         ON CONFLICT (pay_application_id, sov_item_id) DO NOTHING`,
        [tenantId, app.id, projectId])
    }
    return app
  })
}

/** Fetch a pay application and compute its full G702/G703 view. */
export async function getPayApplicationView(tenantId: string, payAppId: string) {
  const appRes = await tenantQuery(tenantId,
    `SELECT id, project_id, application_number, status, retention_pct, period_start, period_end, invoice_date
       FROM pay_applications WHERE tenant_id=$1 AND id=$2`, [tenantId, payAppId])
  const app = appRes.rows[0]
  if (!app) return null

  const [sov, lines, prior] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, item_no, description, scheduled_value FROM sov_items
        WHERE tenant_id=$1 AND project_id=$2 ORDER BY sort_order, item_no`, [tenantId, app.project_id]),
    tenantQuery(tenantId,
      `SELECT sov_item_id, work_completed, materials_stored FROM pay_application_lines
        WHERE tenant_id=$1 AND pay_application_id=$2`, [tenantId, payAppId]),
    tenantQuery(tenantId,
      `SELECT l.sov_item_id, SUM(l.work_completed + l.materials_stored) AS previous_completed
         FROM pay_application_lines l
         JOIN pay_applications a ON a.id = l.pay_application_id AND a.tenant_id = l.tenant_id
        WHERE l.tenant_id=$1 AND a.project_id=$2
          AND a.application_number < $3 AND a.status IN ('approved','paid')
        GROUP BY l.sov_item_id`, [tenantId, app.project_id, app.application_number]),
  ])

  const priorBySov = new Map<string, PriorEntry>()
  for (const row of prior.rows as { sov_item_id: string; previous_completed: unknown }[]) {
    priorBySov.set(row.sov_item_id, { previousCompleted: num(row.previous_completed) })
  }

  const computation = computeBilling(sov.rows as SovItemRow[], lines.rows as LineAmountRow[], priorBySov, num(app.retention_pct))
  return { application: app, ...computation }
}

/** Upsert this-period amounts for SOV lines (only when the app is editable). */
export async function upsertPayApplicationLines(
  tenantId: string, payAppId: string,
  lines: { sov_item_id: string; work_completed?: number; materials_stored?: number }[],
) {
  return tenantTransaction(tenantId, async (client) => {
    for (const l of lines) {
      await client.query(
        `INSERT INTO pay_application_lines (tenant_id, pay_application_id, sov_item_id, work_completed, materials_stored)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (pay_application_id, sov_item_id)
         DO UPDATE SET work_completed=EXCLUDED.work_completed, materials_stored=EXCLUDED.materials_stored, updated_at=NOW()`,
        [tenantId, payAppId, l.sov_item_id, l.work_completed ?? 0, l.materials_stored ?? 0])
    }
    return { updated: lines.length }
  })
}

const STATUS_STAMP: Record<string, string | null> = {
  submitted: 'submitted_at', approved: 'approved_at', paid: 'paid_at', draft: null, rejected: null,
}

export async function setPayApplicationStatus(tenantId: string, payAppId: string, status: string) {
  const stampCol = STATUS_STAMP[status]
  const stampSql = stampCol ? `, ${stampCol}=NOW()` : ''
  const res = await tenantQuery(tenantId,
    `UPDATE pay_applications SET status=$3, updated_at=NOW()${stampSql}
      WHERE tenant_id=$1 AND id=$2
      RETURNING id, application_number, status, retention_pct`, [tenantId, payAppId, status])
  return res.rows[0] ?? null
}

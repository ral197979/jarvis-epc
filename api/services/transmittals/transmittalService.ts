/**
 * Denver Engineering — Transmittal Service (v10.1.0)
 * ───────────────────────────────────────────────────
 * Aconex/Procore-parity document transmittal workflow.
 * Immutable send log with auto-numbering, response tracking,
 * and overdue alerting.
 */
import { pool, tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransmittalCreateInput {
  project_id?:      string
  subject:          string
  purpose:          'for_approval' | 'for_information' | 'for_construction' |
                    'for_record' | 'for_comment' | 'for_review' | 'as_built'
  from_party:       string
  to_party:         string
  from_user?:       string
  to_contacts:      { name: string; email: string; company?: string }[]
  cc_contacts?:     { name: string; email: string; company?: string }[]
  response_required?: boolean
  response_due_date?: string  // ISO date
  notes?:           string
  items:            TransmittalItemInput[]
}

export interface TransmittalItemInput {
  evidence_id?:  string
  document_id?:  string
  rev?:          string
  description?:  string
  copies?:       number
}

// ─── Auto-numbering ───────────────────────────────────────────────────────────

async function nextTransmittalNumber(tenantId: string, projectId: string | null): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)
    const pid = projectId ?? '00000000-0000-0000-0000-000000000000'

    // Upsert counter and increment atomically
    const res = await client.query(
      `INSERT INTO transmittal_counters (tenant_id, project_id, next_seq)
       VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id, project_id) DO UPDATE
         SET next_seq = transmittal_counters.next_seq + 1
       RETURNING next_seq - 1 AS seq`,
      [tenantId, pid],
    )
    const seq = res.rows[0].seq as number
    return `TRN-${String(seq).padStart(4, '0')}`
  } finally {
    client.release()
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createTransmittal(
  tenantId:  string,
  input:     TransmittalCreateInput,
  createdBy: string,
): Promise<{ id: string; transmittal_number: string }> {
  const number = await nextTransmittalNumber(tenantId, input.project_id ?? null)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)

    const res = await client.query(
      `INSERT INTO transmittals
         (tenant_id, project_id, transmittal_number, subject, purpose,
          from_party, to_party, from_user, to_contacts, cc_contacts,
          response_required, response_due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        tenantId, input.project_id ?? null, number, input.subject, input.purpose,
        input.from_party, input.to_party, input.from_user ?? createdBy,
        JSON.stringify(input.to_contacts),
        JSON.stringify(input.cc_contacts ?? []),
        input.response_required ?? false,
        input.response_due_date ?? null,
        input.notes ?? null,
        createdBy,
      ],
    )
    const id = res.rows[0].id as string

    // Insert items
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]!
      await client.query(
        `INSERT INTO transmittal_items
           (tenant_id, transmittal_id, evidence_id, document_id, rev, description, copies, sequence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, id, item.evidence_id ?? null, item.document_id ?? null,
         item.rev ?? null, item.description ?? null, item.copies ?? 1, i],
      )
    }

    // Audit event
    await client.query(
      `INSERT INTO transmittal_events
         (tenant_id, transmittal_id, event_type, to_status, actor, notes)
       VALUES ($1,$2,'created','draft',$3,'Transmittal created')`,
      [tenantId, id, createdBy],
    )

    await client.query('COMMIT')
    return { id, transmittal_number: number }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendTransmittal(
  tenantId:       string,
  transmittalId:  string,
  actor:          string,
): Promise<void> {
  await tenantQuery(tenantId,
    `UPDATE transmittals SET status='sent', sent_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft'`,
    [transmittalId, tenantId])

  await tenantQuery(tenantId,
    `INSERT INTO transmittal_events
       (tenant_id, transmittal_id, event_type, from_status, to_status, actor)
     VALUES ($1,$2,'sent','draft','sent',$3)`,
    [tenantId, transmittalId, actor])
}

// ─── Record response ──────────────────────────────────────────────────────────

export async function recordResponse(
  tenantId:      string,
  transmittalId: string,
  response:      'approved' | 'approved_with_comments' | 'revise_and_resubmit' |
                 'rejected' | 'received' | 'no_exception_taken',
  notes:         string | null,
  respondedBy:   string,
): Promise<void> {
  await tenantQuery(tenantId,
    `UPDATE transmittals SET
       response=$1, response_notes=$2, responded_by=$3, responded_at=now(),
       status='actioned', received_at=COALESCE(received_at, now()), updated_at=now()
     WHERE id=$4 AND tenant_id=$5 AND status IN ('sent','received','under_review')`,
    [response, notes, respondedBy, transmittalId, tenantId])

  await tenantQuery(tenantId,
    `INSERT INTO transmittal_events
       (tenant_id, transmittal_id, event_type, to_status, actor, notes)
     VALUES ($1,$2,'response','actioned',$3,$4)`,
    [tenantId, transmittalId, respondedBy, notes])
}

// ─── List / Get ───────────────────────────────────────────────────────────────

export async function listTransmittals(
  tenantId:  string,
  opts: { project_id?: string; status?: string; purpose?: string; overdue?: boolean } = {},
) {
  const params: unknown[] = [tenantId]
  const filters: string[] = []

  if (opts.project_id) { params.push(opts.project_id); filters.push(`project_id=$${params.length}`) }
  if (opts.status)     { params.push(opts.status);     filters.push(`status=$${params.length}`) }
  if (opts.purpose)    { params.push(opts.purpose);    filters.push(`purpose=$${params.length}`) }
  if (opts.overdue)    {
    filters.push(`response_due_date < CURRENT_DATE AND status NOT IN ('closed','voided','actioned')`)
  }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  const res = await tenantQuery(tenantId,
    `SELECT t.*,
            (SELECT count(*) FROM transmittal_items WHERE transmittal_id=t.id)::int AS item_count
     FROM transmittals t WHERE tenant_id=$1 ${where}
     ORDER BY created_at DESC`,
    params)
  return res.rows
}

export async function getTransmittal(tenantId: string, id: string) {
  const [tx, items, events] = await Promise.all([
    tenantQuery(tenantId, 'SELECT * FROM transmittals WHERE id=$1 AND tenant_id=$2', [id, tenantId]),
    tenantQuery(tenantId,
      `SELECT ti.*,
              ea.original_filename, ea.content_type, ea.file_size_bytes,
              d.title AS document_title, d.document_number
       FROM transmittal_items ti
       LEFT JOIN evidence_assets ea ON ea.id = ti.evidence_id
       LEFT JOIN documents d ON d.id = ti.document_id
       WHERE ti.transmittal_id=$1 ORDER BY sequence`,
      [id]),
    tenantQuery(tenantId,
      'SELECT * FROM transmittal_events WHERE transmittal_id=$1 ORDER BY created_at',
      [id]),
  ])
  if (!tx.rows[0]) return null
  return { transmittal: tx.rows[0], items: items.rows, events: events.rows }
}

// ─── Overdue check (called by scheduler) ─────────────────────────────────────

export async function getOverdueTransmittals(tenantId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, transmittal_number, subject, response_due_date, to_party, to_contacts
     FROM transmittals
     WHERE tenant_id=$1
       AND response_required = true
       AND response_due_date < CURRENT_DATE
       AND status NOT IN ('closed','voided','actioned')
     ORDER BY response_due_date`,
    [tenantId])
  return res.rows
}

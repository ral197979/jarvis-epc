/**
 * Denver Engineering — Turnover packages + Commissioning handoff (v4.38.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow Redesign W7 (see WORKFLOW_REDESIGN.md §17). A turnover package is a
 * named deliverable bundle moved through the handoff chain. Completeness is
 * computed from the deliverables checklist (pure). Commissioning runs in a
 * SEPARATE external workspace — we only record the boundary (a launch URL and the
 * status read back from it). No fabricated live sync.
 *
 * The pure helpers (`computeCompleteness`, `nextHandoffStatus`, `decorate`) are
 * unit-tested; the DB wrappers fetch/persist.
 */
import { tenantQuery } from '../../db/pool'

export const DELIVERABLES: { key: string; label: string }[] = [
  { key: 'as_built',      label: 'As-built drawings' },
  { key: 'om_manuals',    label: 'O&M manuals' },
  { key: 'warranties',    label: 'Warranties' },
  { key: 'test_records',  label: 'Test & inspection records' },
  { key: 'punch_signoff', label: 'Punch list sign-off' },
]

export const HANDOFF_FLOW = [
  'open', 'ready_for_commissioning', 'in_commissioning', 'ready_for_turnover', 'accepted',
] as const
export type HandoffStatus = typeof HANDOFF_FLOW[number]

export interface Completeness { done: number; total: number; pct: number }

/** Pure: how many deliverables are checked. */
export function computeCompleteness(deliverables: Record<string, unknown>): Completeness {
  const total = DELIVERABLES.length
  const done = DELIVERABLES.reduce((acc, d) => acc + (deliverables?.[d.key] === true ? 1 : 0), 0)
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Pure: the next status in the handoff chain, or null at the end. */
export function nextHandoffStatus(current: string): HandoffStatus | null {
  const i = (HANDOFF_FLOW as readonly string[]).indexOf(current)
  if (i < 0 || i >= HANDOFF_FLOW.length - 1) return null
  return HANDOFF_FLOW[i + 1]
}

export interface TurnoverPackage {
  id: string; projectId: string; name: string; area: string | null
  status: string; deliverables: Record<string, boolean>
  commissioningUrl: string | null; commissioningStatus: string | null
  ownerId: string | null; notes: string | null
  completeness: Completeness
  nextStatus: HandoffStatus | null
  canAdvance: boolean
}

/** Pure: attach derived completeness + handoff affordances to a raw row. */
export function decorate(raw: {
  id: string; project_id: string; name: string; area: string | null; status: string
  deliverables: Record<string, unknown> | null; commissioning_url: string | null
  commissioning_status: string | null; owner_id: string | null; notes: string | null
}): TurnoverPackage {
  const deliverables: Record<string, boolean> = {}
  for (const d of DELIVERABLES) deliverables[d.key] = raw.deliverables?.[d.key] === true
  const completeness = computeCompleteness(deliverables)
  const nextStatus = nextHandoffStatus(raw.status)
  // Gate the first hop on a complete deliverables checklist; later hops mirror the
  // external commissioning workspace, so they advance on the user's recorded decision.
  const canAdvance = nextStatus != null && (raw.status !== 'open' || completeness.pct === 100)
  return {
    id: raw.id, projectId: raw.project_id, name: raw.name, area: raw.area, status: raw.status,
    deliverables, commissioningUrl: raw.commissioning_url, commissioningStatus: raw.commissioning_status,
    ownerId: raw.owner_id, notes: raw.notes, completeness, nextStatus, canAdvance,
  }
}

// ─── DB wrappers ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
function rowToRaw(r: Row) {
  return {
    id: String(r.id), project_id: String(r.project_id), name: String(r.name),
    area: r.area == null ? null : String(r.area), status: String(r.status),
    deliverables: (r.deliverables as Record<string, unknown> | null) ?? {},
    commissioning_url: r.commissioning_url == null ? null : String(r.commissioning_url),
    commissioning_status: r.commissioning_status == null ? null : String(r.commissioning_status),
    owner_id: r.owner_id == null ? null : String(r.owner_id),
    notes: r.notes == null ? null : String(r.notes),
  }
}

export async function listPackages(tenantId: string, projectId: string): Promise<TurnoverPackage[]> {
  const r = await tenantQuery(tenantId,
    `SELECT id, project_id, name, area, status, deliverables, commissioning_url, commissioning_status, owner_id, notes
       FROM turnover_packages WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC`, [tenantId, projectId])
  return (r.rows as Row[]).map(row => decorate(rowToRaw(row)))
}

export async function createPackage(
  tenantId: string, projectId: string, body: { name?: string; area?: string }, userId: string | null,
): Promise<TurnoverPackage> {
  const r = await tenantQuery(tenantId,
    `INSERT INTO turnover_packages (tenant_id, project_id, name, area, created_by)
       VALUES ($1,$2,$3,$4,$5)
     RETURNING id, project_id, name, area, status, deliverables, commissioning_url, commissioning_status, owner_id, notes`,
    [tenantId, projectId, String(body.name).trim(), body.area ?? null, userId])
  return decorate(rowToRaw(r.rows[0] as Row))
}

/** Patch status / deliverables / commissioning fields. Returns null if not found. */
export async function updatePackage(
  tenantId: string, id: string,
  body: { status?: string; deliverables?: Record<string, boolean>; commissioning_url?: string; commissioning_status?: string; notes?: string },
): Promise<TurnoverPackage | null> {
  const sets: string[] = []
  const vals: unknown[] = [tenantId, id]
  let i = 3
  if (body.status !== undefined) { sets.push(`status=$${i++}`); vals.push(body.status) }
  if (body.deliverables !== undefined) { sets.push(`deliverables=$${i++}`); vals.push(JSON.stringify(body.deliverables)) }
  if (body.commissioning_url !== undefined) { sets.push(`commissioning_url=$${i++}`); vals.push(body.commissioning_url) }
  if (body.commissioning_status !== undefined) { sets.push(`commissioning_status=$${i++}`); vals.push(body.commissioning_status) }
  if (body.notes !== undefined) { sets.push(`notes=$${i++}`); vals.push(body.notes) }
  if (!sets.length) return null
  const r = await tenantQuery(tenantId,
    `UPDATE turnover_packages SET ${sets.join(', ')}, updated_at=NOW() WHERE tenant_id=$1 AND id=$2
     RETURNING id, project_id, name, area, status, deliverables, commissioning_url, commissioning_status, owner_id, notes`, vals)
  if (!r.rows.length) return null
  return decorate(rowToRaw(r.rows[0] as Row))
}

/**
 * Canonical turnover acceptance (ADR-014 Phase 2A-2).
 *
 * Acceptance transfers custody of the asset to the owner, so it is split out of
 * `updatePackage` — which now moves a package only along the pre-acceptance
 * handoff flow. Refuses an already-accepted package so acceptance is recorded once.
 */
export async function acceptPackage(tenantId: string, id: string): Promise<TurnoverPackage | null> {
  const r = await tenantQuery(tenantId,
    `UPDATE turnover_packages SET status='accepted', updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 AND status <> 'accepted'
     RETURNING id, project_id, name, area, status, deliverables, commissioning_url, commissioning_status, owner_id, notes`,
    [tenantId, id])
  if (!r.rows.length) return null
  return decorate(rowToRaw(r.rows[0] as Row))
}

const STATUSES = new Set(HANDOFF_FLOW as readonly string[])
export function isValidStatus(s: string): boolean { return STATUSES.has(s) }

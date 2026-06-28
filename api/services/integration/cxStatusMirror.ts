/**
 * Denver Engineering — Commissioning status mirror (PR-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-model over the cx_status_mirror / cx_inbound_events tables. The mirror
 * reflects state OWNED by the external Commissioning platform; Denver only reads
 * it. Two write paths feed it, both internal:
 *   - seedMirror():        outbound gateway, when a handoff is created
 *   - applyInboundEvent(): inbound webhook, when Commissioning reports a change
 *
 * The event→columns mapping is a PURE reducer (`reduceEvent`) so it is unit-tested
 * without a database, mirroring the turnoverService pure+wrapper style.
 *
 * See COMMISSIONING_EXTRACTION_PLAN.md §3 (event contract) and §1d.
 */
import { tenantQuery } from '../../db/pool'
import { toMirrorEvent, DELTA_FIELDS } from './cxEventMap'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Inbound event envelope (Commissioning → Denver). See plan §3.2. */
export interface InboundCxEvent {
  event_id:    string
  event:       string                       // e.g. 'cx.phase_changed'
  tenant_id:   string
  handoff_id?: string
  occurred_at?: string
  correlation_id?: string
  data?:       Record<string, unknown>
}

/** Partial column patch produced from one event. */
export interface MirrorPatch {
  phase?:             string
  fat_status?:        string | null
  fat_readiness_pct?: number | null
  sat_status?:        string | null
  sat_readiness_pct?: number | null
  deficiencies_open?: number
  ncr_open?:          number
  punch_open?:        number
  references?:        Record<string, unknown>   // merged (||) into existing references
}

export interface MirrorRow {
  handoffId: string
  projectId: string | null
  turnoverPackageId: string | null
  workspaceUrl: string | null
  phase: string
  fatStatus: string | null
  fatReadinessPct: number | null
  satStatus: string | null
  satReadinessPct: number | null
  deficienciesOpen: number
  ncrOpen: number
  punchOpen: number
  references: Record<string, unknown>
  syncedAt: string | null
}

// ─── Pure reducer ─────────────────────────────────────────────────────────────

function _num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function _str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined
}

/** Apply counts (used by both counts_changed and phase_changed.counts). */
function _counts(data: Record<string, unknown>, patch: MirrorPatch): void {
  const c = (data['counts'] as Record<string, unknown>) ?? data
  if (_num(c['deficiencies_open']) !== undefined) patch.deficiencies_open = _num(c['deficiencies_open'])
  if (_num(c['ncr_open']) !== undefined)          patch.ncr_open          = _num(c['ncr_open'])
  if (_num(c['punch_open']) !== undefined)        patch.punch_open        = _num(c['punch_open'])
}

/**
 * Pure: map a Commissioning event to the columns it changes. Unknown event types
 * return an empty patch (recorded for idempotency/audit, but no mirror change).
 */
export function reduceEvent(eventType: string, data: Record<string, unknown> = {}): MirrorPatch {
  const patch: MirrorPatch = {}
  switch (eventType) {
    case 'cx.phase_changed':
      if (_str(data['phase'])) patch.phase = _str(data['phase'])
      _counts(data, patch)
      break
    case 'cx.fat_status_changed':
      patch.fat_status = _str(data['status']) ?? null
      if (_num(data['readiness_pct']) !== undefined) patch.fat_readiness_pct = _num(data['readiness_pct'])
      break
    case 'cx.sat_status_changed':
      patch.sat_status = _str(data['status']) ?? null
      if (_num(data['readiness_pct']) !== undefined) patch.sat_readiness_pct = _num(data['readiness_pct'])
      break
    case 'cx.counts_changed':
      _counts(data, patch)
      break
    case 'cx.accepted':
      patch.phase = 'accepted'
      break
    case 'cx.rejected':
      patch.phase = 'rejected'
      break
    case 'cx.report_published': {
      const url = _str(data['url'])
      if (url) patch.references = { reports: [{ type: _str(data['report_type']) ?? 'report', url, sha256: _str(data['sha256']) ?? null }] }
      break
    }
    default:
      break
  }
  return patch
}

// ─── DB write paths (internal only) ───────────────────────────────────────────

/** Seed/update a mirror row from the OUTBOUND gateway (we know project linkage). */
export async function seedMirror(
  tenantId: string, handoffId: string,
  fields: { projectId?: string | null; turnoverPackageId?: string | null; workspaceUrl?: string | null; phase?: string },
): Promise<void> {
  await tenantQuery(tenantId, `
    INSERT INTO cx_status_mirror (tenant_id, handoff_id, project_id, turnover_package_id, workspace_url, phase, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT (tenant_id, handoff_id) DO UPDATE SET
      project_id          = COALESCE(EXCLUDED.project_id, cx_status_mirror.project_id),
      turnover_package_id = COALESCE(EXCLUDED.turnover_package_id, cx_status_mirror.turnover_package_id),
      workspace_url       = COALESCE(EXCLUDED.workspace_url, cx_status_mirror.workspace_url),
      updated_at          = NOW()
  `, [tenantId, handoffId, fields.projectId ?? null, fields.turnoverPackageId ?? null, fields.workspaceUrl ?? null, fields.phase ?? 'not_started'])
}

/** Apply a patch to the mirror, upserting by (tenant_id, handoff_id). */
async function _applyPatch(tenantId: string, handoffId: string, eventId: string, patch: MirrorPatch): Promise<void> {
  const cols: string[] = ['tenant_id', 'handoff_id', 'last_event_id']
  const ph:   string[] = ['$1', '$2', '$3']
  const vals: unknown[] = [tenantId, handoffId, eventId]
  const updates: string[] = ['last_event_id = EXCLUDED.last_event_id']
  let i = 4

  const simple: (keyof MirrorPatch)[] = [
    'phase', 'fat_status', 'fat_readiness_pct', 'sat_status', 'sat_readiness_pct',
    'deficiencies_open', 'ncr_open', 'punch_open',
  ]
  for (const k of simple) {
    if (patch[k] !== undefined) {
      cols.push(k); ph.push(`$${i}`); vals.push(patch[k])
      updates.push(`${k} = EXCLUDED.${k}`); i++
    }
  }
  if (patch.references !== undefined) {
    // DB column is `refs` ('references' is a reserved SQL keyword); TS field stays `references`.
    cols.push('refs'); ph.push(`$${i}`); vals.push(JSON.stringify(patch.references))
    updates.push(`refs = COALESCE(cx_status_mirror.refs, '{}'::jsonb) || EXCLUDED.refs`); i++
  }
  updates.push('synced_at = NOW()', 'updated_at = NOW()')

  await tenantQuery(tenantId, `
    INSERT INTO cx_status_mirror (${cols.join(', ')}) VALUES (${ph.join(', ')})
    ON CONFLICT (tenant_id, handoff_id) DO UPDATE SET ${updates.join(', ')}
  `, vals)
}

/** Apply a relative count adjustment to the mirror, clamped at zero. */
async function _applyDelta(tenantId: string, handoffId: string, eventId: string, delta: Record<string, number>): Promise<void> {
  const cols: string[] = ['tenant_id', 'handoff_id', 'last_event_id']
  const ph:   string[] = ['$1', '$2', '$3']
  const vals: unknown[] = [tenantId, handoffId, eventId]
  const updates: string[] = ['last_event_id = EXCLUDED.last_event_id']
  let i = 4
  for (const [field, d] of Object.entries(delta)) {
    if (!(DELTA_FIELDS as readonly string[]).includes(field)) continue  // identifier allowlist
    // Bound $i is reused in INSERT (new-row value, clamped) and UPDATE (existing + delta, clamped).
    cols.push(field); ph.push(`GREATEST(0, $${i})`); vals.push(d)
    updates.push(`${field} = GREATEST(0, cx_status_mirror.${field} + $${i})`)
    i++
  }
  if (cols.length === 3) return   // nothing valid to apply
  updates.push('synced_at = NOW()', 'updated_at = NOW()')
  await tenantQuery(tenantId, `
    INSERT INTO cx_status_mirror (${cols.join(', ')}) VALUES (${ph.join(', ')})
    ON CONFLICT (tenant_id, handoff_id) DO UPDATE SET ${updates.join(', ')}
  `, vals)
}

/**
 * Idempotently apply one inbound event. Records it in the idempotency ledger
 * first; a duplicate event_id is a no-op (returns processed:false). The event
 * name may be Menlo-internal, canonical, or already cx.* — it is normalized at
 * the edge (cxEventMap.toMirrorEvent) into a mirror instruction.
 */
export async function applyInboundEvent(
  tenantId: string, evt: InboundCxEvent,
): Promise<{ processed: boolean }> {
  const ins = await tenantQuery(tenantId, `
    INSERT INTO cx_inbound_events (tenant_id, event_id, event_type, handoff_id, payload)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, event_id) DO NOTHING
    RETURNING id
  `, [tenantId, evt.event_id, evt.event, evt.handoff_id ?? null, JSON.stringify(evt)])

  if (!ins.rows.length) return { processed: false }   // duplicate → idempotent no-op

  const norm = toMirrorEvent(evt.event, evt.data ?? {})
  if (norm && evt.handoff_id) {
    if (norm.delta) {
      await _applyDelta(tenantId, evt.handoff_id, evt.event_id, norm.delta)
    } else {
      const patch = reduceEvent(norm.event, norm.data ?? {})
      if (Object.keys(patch).length) await _applyPatch(tenantId, evt.handoff_id, evt.event_id, patch)
    }
  }
  return { processed: true }
}

// ─── Read paths (used by UI/readiness later) ──────────────────────────────────

function _rowToMirror(r: Record<string, unknown>): MirrorRow {
  return {
    handoffId:         String(r['handoff_id']),
    projectId:         r['project_id'] == null ? null : String(r['project_id']),
    turnoverPackageId: r['turnover_package_id'] == null ? null : String(r['turnover_package_id']),
    workspaceUrl:      r['workspace_url'] == null ? null : String(r['workspace_url']),
    phase:             String(r['phase']),
    fatStatus:         r['fat_status'] == null ? null : String(r['fat_status']),
    fatReadinessPct:   r['fat_readiness_pct'] == null ? null : Number(r['fat_readiness_pct']),
    satStatus:         r['sat_status'] == null ? null : String(r['sat_status']),
    satReadinessPct:   r['sat_readiness_pct'] == null ? null : Number(r['sat_readiness_pct']),
    deficienciesOpen:  Number(r['deficiencies_open'] ?? 0),
    ncrOpen:           Number(r['ncr_open'] ?? 0),
    punchOpen:         Number(r['punch_open'] ?? 0),
    references:        (r['references'] as Record<string, unknown>) ?? {},
    syncedAt:          r['synced_at'] instanceof Date ? (r['synced_at'] as Date).toISOString()
                         : (r['synced_at'] == null ? null : String(r['synced_at'])),
  }
}

const SELECT = `SELECT handoff_id, project_id, turnover_package_id, workspace_url, phase,
  fat_status, fat_readiness_pct, sat_status, sat_readiness_pct,
  deficiencies_open, ncr_open, punch_open, refs AS references, synced_at FROM cx_status_mirror`

export async function getStatusByHandoff(tenantId: string, handoffId: string): Promise<MirrorRow | null> {
  const r = await tenantQuery(tenantId, `${SELECT} WHERE tenant_id=$1 AND handoff_id=$2`, [tenantId, handoffId])
  return r.rows.length ? _rowToMirror(r.rows[0] as Record<string, unknown>) : null
}

export async function listStatusByProject(tenantId: string, projectId: string): Promise<MirrorRow[]> {
  const r = await tenantQuery(tenantId, `${SELECT} WHERE tenant_id=$1 AND project_id=$2 ORDER BY updated_at DESC`, [tenantId, projectId])
  return (r.rows as Record<string, unknown>[]).map(_rowToMirror)
}

/**
 * Live wiring for the Commissioning module — Deficiencies + Equipment.
 *
 * Both endpoints are PROJECT-SCOPED (`/api/v1/projects/:projectId/…`), so the
 * adapters take the active project id (threaded from the UI store; see
 * adapters.ts / hooks.ts). Mapping absorbs the API shape so the screens
 * (DeficiencyRegistry, EquipmentTab) consume the same UI types as in mock mode.
 *
 * NOTE — Completion Matrix is intentionally NOT wired: the `/systems` endpoint
 * exposes a single flat `status` per system, with no per-lifecycle-stage data
 * (DESIGN…TURNOVER). Faithfully building the matrix needs a backend endpoint that
 * returns stage-level status per system — see docs/ADAPTER_STRATEGY.md. We do not
 * fabricate stage cells from a flat status.
 */
import { api } from '../http'
import type { Deficiency, Equipment, NewDeficiencyInput, TestPack } from '../types'

const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'

const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—')

// ── Deficiencies ─────────────────────────────────────────────────────────────
export interface RawDeficiency {
  id: string
  code: string | null
  title: string | null
  description: string | null
  severity: string | null
  status: string | null
  tag_id: string | null
  assignee_user_id: string | null
  due_date: string | null
  closed_at: string | null
  created_at: string | null
}

/** EPC punch categories aren't a column; derive from severity (documented heuristic). */
export function severityToCategory(severity: string | null): Deficiency['category'] {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
      return 'A'
    case 'high':
    case 'medium':
      return 'B'
    default:
      return 'C'
  }
}

export function mapDeficiency(r: RawDeficiency): Deficiency {
  return {
    id: r.code ?? r.id,
    uuid: r.id,
    description: r.title ?? r.description ?? '—',
    category: severityToCategory(r.severity),
    severity: cap(r.severity),
    system: '—', // requires tag → subsystem → system join; not in this row
    contractor: '—', // not tracked on the deficiency entity
    status: cap(r.status),
    loggedAt: dateOnly(r.created_at),
  }
}

export async function fetchDeficienciesLive(projectId: string): Promise<Deficiency[]> {
  if (!projectId) return []
  const res = await api<{ items: RawDeficiency[] }>(`/projects/${projectId}/deficiencies`)
  return (res.items ?? []).map(mapDeficiency)
}

/** POST /api/v1/deficiencies (projectId in body; requires projectId, code, title). */
export async function createDeficiencyLive(input: NewDeficiencyInput): Promise<Deficiency> {
  const res = await api<{ item: RawDeficiency }>('/deficiencies', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return mapDeficiency(res.item)
}

/** PATCH /api/v1/deficiencies/:id — update status (id is the row UUID). */
export async function updateDeficiencyStatusLive(uuid: string, status: string): Promise<Deficiency> {
  const res = await api<{ item: RawDeficiency }>(`/deficiencies/${uuid}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return mapDeficiency(res.item)
}

// ── Equipment (tags) ─────────────────────────────────────────────────────────
export interface RawTag {
  id: string
  system_id: string | null
  tag_no: string
  equipment_name: string
  equipment_type: string | null
  manufacturer: string | null
  model_no: string | null
  serial_no: string | null
  status: string | null
}

/** Completion % isn't stored on the tag; derive from lifecycle status (documented). */
function statusToCompletion(status: string | null): number {
  switch ((status ?? '').toLowerCase()) {
    case 'operational':
    case 'commissioned':
    case 'complete':
    case 'completed':
      return 100
    case 'testing':
    case 'in_test':
      return 65
    case 'installed':
    case 'mechanical_complete':
      return 45
    case 'planned':
      return 10
    default:
      return 0
  }
}

export function mapEquipment(r: RawTag): Equipment {
  return {
    id: r.tag_no ?? r.id,
    tag: r.tag_no,
    name: r.equipment_name,
    system: r.equipment_type ?? '—', // system_id is a uuid; equipment_type is the useful display
    vendor: r.manufacturer ?? '—',
    model: r.model_no ?? '—',
    status: cap(r.status),
    completionPct: statusToCompletion(r.status),
    openPunch: 0, // requires a per-tag deficiency count; not in this row
  }
}

export async function fetchEquipmentLive(projectId: string): Promise<Equipment[]> {
  if (!projectId) return []
  const res = await api<{ items: RawTag[] }>(`/projects/${projectId}/tags`)
  return (res.items ?? []).map(mapEquipment)
}

// ── Test Packs ───────────────────────────────────────────────────────────────
export interface RawTestPack {
  id: string
  pack_no: string | null
  title: string | null
  pack_type: string | null
  status: string | null
  system_name?: string | null
  created_at: string | null
}

/** Progress isn't a column on the pack; derive from status (documented heuristic). */
function testPackProgress(status: string | null): number {
  switch ((status ?? '').toLowerCase()) {
    case 'signed':
    case 'approved':
    case 'complete':
    case 'completed':
      return 100
    case 'in_progress':
    case 'testing':
      return 50
    case 'draft':
      return 10
    default:
      return 0
  }
}

export function mapTestPack(r: RawTestPack): TestPack {
  return {
    id: r.pack_no ?? r.id,
    discipline: r.system_name ?? '—',
    testType: cap(r.pack_type),
    preparedBy: '—', // no prepared_by column on test_packs
    date: dateOnly(r.created_at),
    qaSignature: cap(r.status),
    progressPct: testPackProgress(r.status),
  }
}

export async function fetchTestPacksLive(projectId: string): Promise<TestPack[]> {
  if (!projectId) return []
  const res = await api<{ items: RawTestPack[] }>(`/projects/${projectId}/test-packs`)
  return (res.items ?? []).map(mapTestPack)
}

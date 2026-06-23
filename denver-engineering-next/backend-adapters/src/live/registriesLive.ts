/**
 * Live wiring for the register-style modules: Engineering (drawings),
 * Document Control (files), and Actions.
 *
 * Documents + Actions map cleanly. Drawings has no status/reviewer/due columns,
 * so those are derived/blank (documented) — RFIs and submittals live behind
 * separate endpoints (`/rfis`, `/submittals`) and would be merged in a later pass.
 */
import { api } from '../http'
import type { DrawingRecord, DocumentRecord, ActionItem } from '../types'

const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'
const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—')

// ── Engineering — drawings ───────────────────────────────────────────────────
export interface RawDrawing {
  id: string
  sheet_number: string | null
  title: string
  discipline: string | null
  current_rev: string | null
  issue_date: string | null
  metadata: Record<string, unknown> | null
}

export function mapDrawing(r: RawDrawing): DrawingRecord {
  const meta = r.metadata ?? {}
  return {
    id: r.sheet_number ?? r.id,
    title: r.title,
    discipline: r.discipline ?? '—',
    rev: r.current_rev ?? '—',
    status: typeof meta.status === 'string' ? cap(meta.status) : 'Issued',
    reviewer: typeof meta.reviewer === 'string' ? meta.reviewer : '—',
    due: dateOnly(r.issue_date),
  }
}

export async function fetchDrawingsLive(projectId: string): Promise<DrawingRecord[]> {
  if (!projectId) return []
  const res = await api<{ drawings: RawDrawing[] }>(`/projects/${projectId}/drawings`)
  return (res.drawings ?? []).map(mapDrawing)
}

// ── Document Control — files ─────────────────────────────────────────────────
export interface RawDocument {
  id: string
  document_number?: string | null
  title: string
  type: string | null
  current_version: number | string | null
  status: string | null
  created_at: string | null
  uploaded_at?: string | null
  uploaded_by_name?: string | null
}

export function mapDocument(r: RawDocument): DocumentRecord {
  return {
    id: r.document_number ?? r.id,
    title: r.title,
    type: cap(r.type),
    rev: String(r.current_version ?? '—'),
    status: cap(r.status),
    owner: r.uploaded_by_name ?? '—',
    updated: dateOnly(r.uploaded_at ?? r.created_at),
  }
}

export async function fetchDocumentsLive(): Promise<DocumentRecord[]> {
  const res = await api<{ data: RawDocument[] }>('/files/documents?limit=100')
  return (res.data ?? []).map(mapDocument)
}

// ── Actions ──────────────────────────────────────────────────────────────────
export interface RawAction {
  id: string
  action_number?: string | null
  title: string
  priority: string | null
  status: string | null
  action_type: string | null
  due_at: string | null
  source?: string | null
  assigned_user_email?: string | null
}

export function mapAction(r: RawAction): ActionItem {
  return {
    id: r.action_number ?? r.id,
    title: r.title,
    priority: cap(r.priority),
    assignee: r.assigned_user_email ?? '—',
    due: dateOnly(r.due_at),
    status: cap(r.status),
    source: r.source ?? cap(r.action_type),
  }
}

export async function fetchActionsLive(): Promise<ActionItem[]> {
  const res = await api<{ data: RawAction[] }>('/actions?limit=100')
  return (res.data ?? []).map(mapAction)
}

/**
 * JARVIS EPC — Persistence Module
 * ─────────────────────────────────
 * Universal CRUD layer, input sanitization, rate limiting,
 * undo/redo, collection inventory, validators, bulk actions.
 *
 * Dependencies: store, observability, auth, theme
 * TODO: Replace mutateBiz bridge with REST API mutations (see /api/v1/state).
 */

import {
  mutationWindow,
  undoStack, UNDO_MAX,
  maintenanceMode,
  sessionMetrics,
  type UndoEntry,
} from '../store/index.js'

import { slog, logError, logActivity, trackFreshness } from '../observability/index.js'
import { announce } from '../auth/index.js'
import { THEME as e } from '../theme/index.js'

import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
export type CrudOp = 'add' | 'update' | 'delete'

export interface BizRecord { id?: string; month?: string; [key: string]: unknown }

export type MutateBizFn = (
  mutator: (state: Record<string, BizRecord[]>) => void,
  label?: string,
) => void

export type ToastFn = (msg: string, type?: 'info' | 'success' | 'warn' | 'error') => void

export interface ValidatorFn { (value: unknown): string }

export interface BulkAction {
  label: string
  color: string
  fn:    (ids: string[], rows?: BizRecord[]) => void
}

export interface CollectionSummary {
  key:          string
  count:        number
  sizeKB:       number
  statuses:     Record<string, number>
  lastModified: string | null
  hasIds:       boolean
  sample:       string[]
}

// ─── Dependency Injection ─────────────────────────────────────────────────────
let _mutateBiz: MutateBizFn | null = null
let _toast:     ToastFn     | null = null

export function injectCrudDeps(deps: { mutateBiz: MutateBizFn; toast: ToastFn }): void {
  _mutateBiz = deps.mutateBiz
  _toast     = deps.toast
}

// ─── Input Sanitization ───────────────────────────────────────────────────────
export function sanitize<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  const clean: Record<string, unknown> = {}
  for (const k in obj) {
    let v: unknown = obj[k]
    if (typeof v === 'string') {
      v = (v as string)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/javascript\s*:/gi, '')
        .trim()
      if ((v as string).length > 10_240) v = (v as string).slice(0, 10_240)
    }
    clean[k] = v
  }
  return clean as T
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
const MUTATION_RATE_LIMIT = 120

export function rateLimitOk(): boolean {
  const now    = Date.now()
  const active = mutationWindow.filter(t => now - t < 60_000)
  mutationWindow.length = 0
  mutationWindow.push(...active)

  if (mutationWindow.length >= MUTATION_RATE_LIMIT) {
    console.warn(`[JARVIS:RateLimit] ${MUTATION_RATE_LIMIT} mutations/min exceeded`)
    logError('rate_limit', `Mutation rate limit exceeded: ${mutationWindow.length}/min`)
    return false
  }
  mutationWindow.push(now)
  return true
}

// ─── Undo Stack ───────────────────────────────────────────────────────────────
export function pushUndo(collection: string, op: CrudOp, snapshot: unknown): void {
  undoStack.push({ collection, op, snapshot, ts: Date.now() } as UndoEntry)
  if (undoStack.length > UNDO_MAX) undoStack.shift()
}

export function popUndo(): UndoEntry | null {
  return undoStack.length ? (undoStack.pop() ?? null) : null
}

// ─── Validators ───────────────────────────────────────────────────────────────
// Simple validators return a ValidatorFn directly.
// Factory validators (maxLen, dateRange) are typed separately.
export const simpleValidators = {
  email:    (v: unknown) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))  ? '' : 'Invalid email',
  phone:    (v: unknown) => !v || /^[+\d\s()-]{7,20}$/.test(String(v))             ? '' : 'Invalid phone',
  positive: (v: unknown) => !v || Number(v) >= 0                                      ? '' : 'Must be positive',
  notEmpty: (v: unknown) => v && String(v).trim()                                     ? '' : 'Required',
}

export const maxLen   = (max: number)                       => (v: unknown) => !v || String(v).length <= max ? '' : `Max ${max} chars`
export const dateRange = (min: string, max: string)         => (v: unknown) => {
  if (!v) return ''
  return (min && v < min) || (max && v > max) ? 'Date out of range' : ''
}

/** Backwards-compatible alias — spread-access pattern used in JarvisCore */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validators: Record<string, any> = {
  ...simpleValidators,
  maxLen,
  dateRange,
}

// ─── Collection Lock ─────────────────────────────────────────────────────────
export function isCollectionLocked(col: string, oCfg?: { lockedCollections?: Record<string, boolean> }): boolean {
  return !!(oCfg?.lockedCollections?.[col])
}

// ─── Universal CRUD ───────────────────────────────────────────────────────────
export function crud(op: CrudOp, collection: string, record?: BizRecord | null, id?: string): void {
  if (!_mutateBiz) {
    console.warn('[JARVIS:CRUD] mutateBiz not bound — call injectCrudDeps() first')
    return
  }
  if (!rateLimitOk()) return
  if (record && typeof record === 'object') record = sanitize(record)

  if (maintenanceMode) {
    slog('WARN', 'maintenance', `Write blocked (maintenance mode): ${op} ${collection}`)
    _toast?.('Maintenance mode — writes blocked', 'error')
    return
  }

  if (typeof window !== 'undefined') {
    const diag = (window as unknown as { __JARVIS_DIAG?: { _oCfg?: { lockedCollections?: Record<string, boolean> } } }).__JARVIS_DIAG
    if (diag?._oCfg && isCollectionLocked(collection, diag._oCfg)) {
      logError('security', `Write blocked: collection ${collection} is locked`)
      announce(`Write blocked: ${collection} is locked by owner`)
      return
    }
  }

  // Snapshot for undo
  try {
    const biz    = (window as unknown as { __JARVIS_DIAG?: { _biz?: Record<string, BizRecord[]> } }).__JARVIS_DIAG?._biz
    const target = id ?? record?.id
    const snap   = biz ? JSON.parse(JSON.stringify(biz[collection]?.find(r => r.id === target) ?? null)) : null
    pushUndo(collection, op, snap)
  } catch { /* best-effort */ }

  _mutateBiz(state => {
    state[collection] = state[collection] ?? []
    if (op === 'add' && record) {
      if (!state[collection].some(r => r.id === record!.id)) {
        state[collection].push(record)
      }
    } else if (op === 'update' && record && (id ?? record.id)) {
      const uid = id ?? record.id
      const idx = state[collection].findIndex(r => r.id === uid)
      if (idx >= 0) { Object.assign(state[collection][idx], record); _toast?.(`Updated ${collection} ${uid}`, 'info') }
    } else if (op === 'delete' && id) {
      state[collection] = state[collection].filter(r => r.id !== id)
      _toast?.(`Deleted ${id} from ${collection}`, 'warn')
    }
  }, `crud:${op}_${collection}`)

  sessionMetrics.crudOps[op] = (sessionMetrics.crudOps[op] ?? 0) + 1
  sessionMetrics.lastMutation = new Date().toISOString()
  sessionMetrics.persistOps++
  trackFreshness(collection)
  logActivity(op, collection, id ?? record?.id ?? '')
  slog('INFO', 'crud', `${op} ${collection} ${id ?? record?.id ?? ''}`)
}

// ─── Collection Inventory ─────────────────────────────────────────────────────
export function collectionInventory(biz: Record<string, unknown>): CollectionSummary[] {
  if (!biz) return []
  const inv: CollectionSummary[] = []
  for (const key in biz) {
    const col = biz[key]
    if (!Array.isArray(col) || col.length === 0 || typeof col[0] !== 'object' || col[0] === null) continue
    const statuses: Record<string, number> = {}
    col.forEach((r: BizRecord) => { const s = String(r.status ?? 'n/a'); statuses[s] = (statuses[s] ?? 0) + 1 })
    let lastMod: string | null = null
    col.forEach((r: BizRecord) => {
      const d = String(r.updated_at ?? r.created_at ?? r.date ?? '')
      if (d && (!lastMod || d > lastMod)) lastMod = d
    })
    inv.push({
      key, count: col.length,
      sizeKB:      Math.round(JSON.stringify(col).length / 1024),
      statuses, lastModified: lastMod,
      hasIds:      col.every((r: BizRecord) => !!r.id || !!r.month),
      sample:      col[0] ? Object.keys(col[0]).slice(0, 6) : [],
    })
  }
  return inv.sort((a, b) => b.count - a.count)
}

// ─── Filter Helper ────────────────────────────────────────────────────────────
export function filterItems<T extends Record<string, unknown>>(items: T[], query: string, keys: (keyof T)[]): T[] {
  if (!query?.trim()) return items
  const q = query.toLowerCase().trim()
  return items.filter(item => keys.some(k => {
    const v = item[k]
    return v != null && String(v).toLowerCase().includes(q)
  }))
}

// ─── Bulk Actions ─────────────────────────────────────────────────────────────
export function bulkDeleteAction(collection: string, arrSetter: React.Dispatch<React.SetStateAction<BizRecord[]>>): BulkAction {
  return {
    label: '🗑 Delete Selected',
    color: e.red,
    fn(ids) {
      if (!confirm(`Delete ${ids.length} ${collection} items? This cannot be undone.`)) return
      arrSetter(prev => prev.filter(r => !ids.includes(String(r.id ?? ''))))
      ids.forEach(id => crud('delete', collection, null, id))
      announce(`Deleted ${ids.length} ${collection} items`)
    },
  }
}

export function bulkStatusAction(
  collection: string,
  arrSetter: React.Dispatch<React.SetStateAction<BizRecord[]>>,
  status: string,
  label?: string,
): BulkAction {
  return {
    label: label ?? `▸ ${status}`,
    color: e.ac,
    fn(ids) {
      arrSetter(prev => prev.map(r => ids.includes(String(r.id ?? '')) ? { ...r, status } : r))
      ids.forEach(id => crud('update', collection, { id, status }))
      announce(`Updated ${ids.length} items to ${status}`)
    },
  }
}

// ─── Search Bar Component ─────────────────────────────────────────────────────
export interface SearchBarProps {
  value:    string
  onChange: (val: string) => void
  label?:   string
  count?:   number
  total?:   number
}

export function SearchBar({ value, onChange, label, count, total }: SearchBarProps): React.ReactElement {
  return React.createElement('div',
    { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
    React.createElement('input', {
      type:         'search',
      'aria-label': `Filter ${label ?? 'items'}`,
      placeholder:  `🔍 Filter ${label ?? 'items'}...`,
      value,
      onChange:     (ev: React.ChangeEvent<HTMLInputElement>) => onChange(ev.target.value),
      style: {
        flex: 1, background: e.bg, border: `1px solid ${e.bd}`,
        borderRadius: 6, padding: '6px 10px', color: e.tx, fontSize: 11,
      },
    }),
    count !== undefined && React.createElement('span', {
      'aria-live': 'polite',
      style: { fontSize: 9, color: e.ts, whiteSpace: 'nowrap' },
    }, `${count} / ${total ?? count} shown`)
  )
}

// ─── Legacy aliases ───────────────────────────────────────────────────────────
export const _crud               = crud
export const _sanitize           = sanitize
export const _rateLimitOk        = rateLimitOk
export const _pushUndo           = pushUndo
export const _popUndo            = popUndo
export const _filterItems        = filterItems
export const _SearchBar          = SearchBar
export const _collectionInventory = collectionInventory
export const _bulkDeleteAction   = bulkDeleteAction
export const _bulkStatusAction   = bulkStatusAction
export const _validators         = validators
export const _isCollectionLocked = isCollectionLocked

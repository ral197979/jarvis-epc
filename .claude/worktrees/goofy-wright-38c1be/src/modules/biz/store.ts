/**
 * JARVIS EPC — Zustand Biz Store
 * ────────────────────────────────
 * Phase 6: Reactive wrapper around bizReducer for React components.
 *
 * Features:
 *   - Immutable state via bizReducer (no direct mutations)
 *   - Undo/redo support (30 steps)
 *   - Optimistic updates with rollback
 *   - Typed selectors for every collection
 *   - Snapshot / restore for bulk operations
 *
 * Phase 7 migration target:
 *   JarvisCore.jsx currently uses:
 *     Z(function(v) { v.leads.push(newLead); })   ← inline mutation
 *   Replace with:
 *     useBizStore.getState().dispatch(JARVIS_ACTIONS.ADD_LEAD, newLead)
 */

import { create } from 'zustand'
import { subscribeWithSelector, devtools } from 'zustand/middleware'
import {
  bizReducer,
  applyActions,
  emptyBizState,
  getCollection,
  JARVIS_ACTIONS,
  type BizState,
  type BizAction,
  type BizRecord,
  type EVMRecord,
} from './reducer'

// ─── Types ────────────────────────────────────────────────────────────────────
interface UndoEntry {
  snapshot:    BizState
  action:      BizAction
  ts:          string
  description: string
}

interface BizStoreState {
  biz:       BizState
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  isDirty:   boolean
  lastMutatedAt: string | null

  // ── Dispatch ──────────────────────────────────────────────────────────────
  dispatch: (action: BizAction) => boolean
  dispatchMany: (actions: BizAction[]) => boolean

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  undo: () => boolean
  redo: () => boolean
  canUndo: boolean
  canRedo: boolean

  // ── Snapshot ──────────────────────────────────────────────────────────────
  snapshot:  () => BizState
  restore:   (snapshot: BizState) => void
  reset:     () => void

  // ── Helpers ───────────────────────────────────────────────────────────────
  getCollection: <T extends BizRecord>(collection: keyof BizState) => T[]
  markClean: () => void
}

const UNDO_LIMIT = 30

// ─── Store ────────────────────────────────────────────────────────────────────
export const useBizStore = create<BizStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      biz:            emptyBizState(),
      undoStack:      [],
      redoStack:      [],
      isDirty:        false,
      lastMutatedAt:  null,
      canUndo:        false,
      canRedo:        false,

      dispatch: (action: BizAction): boolean => {
        const { biz, undoStack } = get()
        const result = bizReducer(biz, action)

        if (!result.ok) {
          console.warn(`[JARVIS:BizStore] Dispatch failed: ${result.error}`)
          return false
        }

        const entry: UndoEntry = {
          snapshot:    biz,
          action,
          ts:          new Date().toISOString(),
          description: action.type,
        }

        const newUndo = [...undoStack, entry].slice(-UNDO_LIMIT)

        set({
          biz:           result.state,
          undoStack:     newUndo,
          redoStack:     [],  // clear redo on new action
          isDirty:       true,
          lastMutatedAt: new Date().toISOString(),
          canUndo:       true,
          canRedo:       false,
        })
        return true
      },

      dispatchMany: (actions: BizAction[]): boolean => {
        const { biz, undoStack } = get()
        const snapshot = biz
        const newState = applyActions(biz, actions)

        const entry: UndoEntry = {
          snapshot,
          action:      { type: 'raw/mutate', mutator: () => {} }, // batch marker
          ts:          new Date().toISOString(),
          description: `batch(${actions.length})`,
        }
        const newUndo = [...undoStack, entry].slice(-UNDO_LIMIT)

        set({
          biz:           newState,
          undoStack:     newUndo,
          redoStack:     [],
          isDirty:       true,
          lastMutatedAt: new Date().toISOString(),
          canUndo:       true,
          canRedo:       false,
        })
        return true
      },

      undo: (): boolean => {
        const { undoStack, biz, redoStack } = get()
        if (undoStack.length === 0) return false

        const entry   = undoStack[undoStack.length - 1]
        const newUndo = undoStack.slice(0, -1)
        const newRedo = [...redoStack, { ...entry, snapshot: biz }]

        set({
          biz:      entry.snapshot,
          undoStack: newUndo,
          redoStack: newRedo,
          canUndo:  newUndo.length > 0,
          canRedo:  true,
          isDirty:  true,
          lastMutatedAt: new Date().toISOString(),
        })
        return true
      },

      redo: (): boolean => {
        const { redoStack, biz, undoStack } = get()
        if (redoStack.length === 0) return false

        const entry   = redoStack[redoStack.length - 1]
        const result  = bizReducer(biz, entry.action)
        if (!result.ok) return false

        const newRedo  = redoStack.slice(0, -1)
        const newEntry: UndoEntry = { ...entry, snapshot: biz }
        const newUndo  = [...undoStack, newEntry].slice(-UNDO_LIMIT)

        set({
          biz:          result.state,
          undoStack:    newUndo,
          redoStack:    newRedo,
          canUndo:      true,
          canRedo:      newRedo.length > 0,
          isDirty:      true,
          lastMutatedAt: new Date().toISOString(),
        })
        return true
      },

      snapshot: (): BizState => {
        try { return structuredClone(get().biz) }
        catch { return JSON.parse(JSON.stringify(get().biz)) as BizState }
      },

      restore: (snapshot: BizState): void => {
        set({
          biz:           snapshot,
          isDirty:       true,
          lastMutatedAt: new Date().toISOString(),
          undoStack:     [],
          redoStack:     [],
          canUndo:       false,
          canRedo:       false,
        })
      },

      reset: (): void => {
        set({
          biz:           emptyBizState(),
          undoStack:     [],
          redoStack:     [],
          isDirty:       false,
          lastMutatedAt: null,
          canUndo:       false,
          canRedo:       false,
        })
      },

      getCollection: <T extends BizRecord>(collection: keyof BizState): T[] => {
        return getCollection<T>(get().biz, collection)
      },

      markClean: (): void => set({ isDirty: false }),
    })),
    { name: 'JARVIS:BizStore' }
  )
)

// ─── Typed collection selectors ────────────────────────────────────────────────
export const selectLeads         = (s: BizStoreState) => s.biz.leads                    as BizRecord[]
export const selectContracts     = (s: BizStoreState) => s.biz.contracts                as BizRecord[]
export const selectInvoices      = (s: BizStoreState) => s.biz.invoices                 as BizRecord[]
export const selectProjects      = (s: BizStoreState) => s.biz.projects                 as BizRecord[]
export const selectExpenses      = (s: BizStoreState) => s.biz.expenses                 as BizRecord[]
export const selectPurchaseOrders= (s: BizStoreState) => s.biz.purchase_orders          as BizRecord[]
export const selectRFQs          = (s: BizStoreState) => s.biz.rfqs                     as BizRecord[]
export const selectEVMProjects   = (s: BizStoreState) => s.biz.evm_projects             as EVMRecord[]
export const selectDocuments     = (s: BizStoreState) => s.biz.documents                as BizRecord[]
export const selectActionItems   = (s: BizStoreState) => s.biz.action_items             as BizRecord[]
export const selectPunchItems    = (s: BizStoreState) => s.biz.punch_items               as BizRecord[]
export const selectLessons       = (s: BizStoreState) => s.biz.lessons                   as BizRecord[]
export const selectCloseouts     = (s: BizStoreState) => s.biz.closeouts                 as BizRecord[]
export const selectVendors       = (s: BizStoreState) => s.biz.vendors                   as BizRecord[]
export const selectCustomers     = (s: BizStoreState) => s.biz.customers                 as BizRecord[]

// Phase 11: action-item derived KPIs (all primitives to avoid Zustand object-equality loops)
export const selectOpenActionCount    = (s: BizStoreState): number =>
  (s.biz.action_items ?? []).filter((a: BizRecord) => a['status'] === 'open').length
export const selectHighPriorityCount  = (s: BizStoreState): number =>
  (s.biz.action_items ?? []).filter((a: BizRecord) => a['priority'] === 'high' && a['status'] === 'open').length
export const selectOverdueCount       = (s: BizStoreState): number => {
  const today = new Date().toISOString().slice(0, 10)
  return (s.biz.action_items ?? []).filter(
    (a: BizRecord) => a['status'] === 'open' && typeof a['due'] === 'string' && (a['due'] as string) < today
  ).length
}
export const selectResolvedCount      = (s: BizStoreState): number =>
  (s.biz.action_items ?? []).filter((a: BizRecord) => a['status'] === 'resolved').length
export const selectIncidents     = (s: BizStoreState) => s.biz.incidents                as BizRecord[]
// Phase 8: new collections
export const selectNotifications = (s: BizStoreState) => (s.biz.notifications ?? [])   as BizRecord[]
export const selectProposals     = (s: BizStoreState) => (s.biz.proposals     ?? [])   as BizRecord[]
export const selectTickets       = (s: BizStoreState) => (s.biz.service_tickets ?? []) as BizRecord[]

// ─── Computed selectors ────────────────────────────────────────────────────────
/** Total unpaid invoice value */
export function selectUnpaidTotal(s: BizStoreState): number {
  return (s.biz.invoices as Array<{ status?: string; amount?: number }>)
    .filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + (i.amount ?? 0), 0)
}

/** Count of open leads */
export function selectOpenLeadCount(s: BizStoreState): number {
  return (s.biz.leads as Array<{ status?: string }>)
    .filter(l => l.status === 'open' || l.status === 'qualified').length
}

/** Average CPI across all EVM projects */
export function selectAverageCPI(s: BizStoreState): number {
  const evms = s.biz.evm_projects
  if (evms.length === 0) return 1
  return evms.reduce((sum, e) => sum + e.cpi, 0) / evms.length
}

/** Projects that are active */
export function selectActiveProjects(s: BizStoreState): BizRecord[] {
  return (s.biz.projects as Array<BizRecord & { status?: string }>)
    .filter(p => p.status === 'active' || p.status === 'in-progress')
}

/** Open safety incidents */
export function selectOpenIncidents(s: BizStoreState): BizRecord[] {
  return (s.biz.incidents as Array<BizRecord & { status?: string }>)
    .filter(i => i.status !== 'closed' && i.status !== 'resolved')
}

/** Phase 8: Unread notification count */
export function selectUnreadCount(s: BizStoreState): number {
  return ((s.biz.notifications ?? []) as Array<{ read?: boolean }>)
    .filter(n => !n.read).length
}

/** Phase 8: Open proposals (not won/lost/closed) */
export function selectOpenProposals(s: BizStoreState): BizRecord[] {
  return ((s.biz.proposals ?? []) as Array<BizRecord & { status?: string }>)
    .filter(p => p.status !== 'won' && p.status !== 'lost' && p.status !== 'closed')
}

/** Phase 8: Open service tickets */
export function selectOpenTickets(s: BizStoreState): BizRecord[] {
  return ((s.biz.service_tickets ?? []) as Array<BizRecord & { status?: string }>)
    .filter(t => t.status !== 'closed' && t.status !== 'resolved')
}

/** Phase 9: Permits by status */
export function selectPermitsByStatus(s: BizStoreState): { active: BizRecord[]; all: BizRecord[] } {
  const permits = (s.biz.permits ?? []) as Array<BizRecord & { status?: string }>
  return {
    active: permits.filter(p => p.status === 'active' || p.status === 'approved'),
    all:    permits,
  }
}

/** Phase 9: Safety KPIs — days since last incident */
export function selectDaysSinceLastIncident(s: BizStoreState): number {
  const incidents = (s.biz.incidents ?? []) as Array<BizRecord & { date?: string }>
  if (!incidents.length) return 365
  const sorted = [...incidents].sort((a, b) =>
    new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
  )
  const last = sorted[0]?.date
  if (!last) return 365
  return Math.max(0, Math.round((Date.now() - new Date(last).getTime()) / 86_400_000))
}

/** Phase 9: Safety KPIs — recordable incident rate */
export function selectRecordableRate(s: BizStoreState): number {
  const incidents   = (s.biz.incidents     ?? []) as Array<BizRecord & { recordable?: boolean }>
  const toolboxes   = (s.biz.toolbox_talks ?? []) as Array<BizRecord & { attendees?: number }>
  const manhours    = toolboxes.reduce((sum, t) => sum + (t.attendees ?? 0) * 2, 0) || 1
  const recordables = incidents.filter(i => i.recordable).length
  return parseFloat((recordables * 200_000 / manhours).toFixed(2))
}

/** Phase 9: Projects with EVM data joined */
export function selectProjectsWithEVM(s: BizStoreState) {
  const projects  = (s.biz.contracts    ?? []) as Array<BizRecord & { project?: string; status?: string }>
  const evmByProj = new Map((s.biz.evm_projects ?? []).map(e => [e.project, e]))
  return projects.map(p => ({
    ...p,
    evm: evmByProj.get(p.project ?? p.id ?? '') ?? null,
  }))
}

/** Phase 9: JHA count by status */
export function selectJHASummary(s: BizStoreState) {
  const jhas = (s.biz.jhas ?? []) as Array<BizRecord & { status?: string }>
  return {
    total:    jhas.length,
    approved: jhas.filter(j => j.status === 'approved').length,
    pending:  jhas.filter(j => j.status === 'pending' || j.status === 'draft').length,
    all:      jhas,
  }
}

// Re-export JARVIS_ACTIONS for component convenience
export { JARVIS_ACTIONS, type BizState, type BizAction, type BizRecord, type EVMRecord }

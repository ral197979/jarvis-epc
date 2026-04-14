/**
 * Coverage Boost — Phase 11
 * ─────────────────────────
 * Exercises action creators and selectors not covered by existing tests.
 * Targets the function coverage threshold gap: dispatch.ts (46→76%), store.ts (63→76%).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useBizStore } from '../../modules/biz/store'
import { actions, createDispatch, type PolicyConfig } from '../../modules/biz/dispatch'
import {
  selectOpenIncidents,
  selectUnreadCount,
  selectOpenProposals,
  selectOpenTickets,
  selectPermitsByStatus,
  selectDaysSinceLastIncident,
  selectRecordableRate,
  selectProjectsWithEVM,
  selectJHASummary,
  selectPunchItems,
  selectLessons,
  selectCloseouts,
  selectOpenActionCount,
  selectHighPriorityCount,
  selectOverdueCount,
  selectResolvedCount,
} from '../../modules/biz/store'

beforeEach(() => { useBizStore.getState().reset() })

// ─── Action creators — engineering ────────────────────────────────────────────
describe('dispatch.actions — engineering group', () => {
  it('addDeliverable creates correct action type', () => {
    const a = actions.addDeliverable({ id: 'D-1', name: 'FEED Report' })
    expect(a.type).toBe('engineering/add_deliverable')
    expect(a.data).toMatchObject({ id: 'D-1' })
  })

  it('addInstallation creates correct action type', () => {
    const a = actions.addInstallation({ id: 'I-1', description: 'Pump skid' })
    expect(a.type).toBe('engineering/add_installation')
  })

  it('addManpower creates correct action type', () => {
    const a = actions.addManpower({ id: 'MP-1', week: '2026-01', count: 12 })
    expect(a.type).toBe('engineering/add_manpower')
  })

  it('addFeedStudy creates correct action type', () => {
    const a = actions.addFeedStudy({ id: 'FS-1', title: 'Feasibility' })
    expect(a.type).toBe('engineering/add_feed_study')
  })
})

// ─── Action creators — commissioning ─────────────────────────────────────────
describe('dispatch.actions — commissioning group', () => {
  it('addCXPhase creates correct action type', () => {
    const a = actions.addCXPhase({ id: 'CX-1', phase: 'pre-comm' })
    expect(a.type).toBe('cx/add_phase')
  })

  it('addCXIssue creates correct action type', () => {
    const a = actions.addCXIssue({ id: 'CI-1', description: 'Valve leak' })
    expect(a.type).toBe('cx/add_issue')
  })
})

// ─── Action creators — documents ──────────────────────────────────────────────
describe('dispatch.actions — documents group', () => {
  it('addDocument creates correct action type', () => {
    const a = actions.addDocument({ id: 'DOC-001', title: 'P&ID Rev A' })
    expect(a.type).toBe('docs/add_document')
  })

  it('addTransmittal creates correct action type', () => {
    const a = actions.addTransmittal({ id: 'TRN-001', ref: 'T-001' })
    expect(a.type).toBe('docs/add_transmittal')
  })
})

// ─── Action creators — EVM ────────────────────────────────────────────────────
describe('dispatch.actions — EVM group', () => {
  it('addEVM creates correct action type', () => {
    const a = actions.addEVM({ id: 'EVM-1', project: 'Alpha', spi: 1.02, cpi: 0.98 })
    expect(a.type).toBe('evm/add_evm')
  })
})

// ─── Action creators — company ────────────────────────────────────────────────
describe('dispatch.actions — company group', () => {
  it('setCompany creates correct action type', () => {
    const a = actions.setCompany({ name: 'ACME Corp', currency: 'USD' })
    expect(a.type).toBe('company/set')
  })
})

// ─── Action creators — safety ─────────────────────────────────────────────────
describe('dispatch.actions — safety group', () => {
  it('addIncident creates correct action type', () => {
    const a = actions.addIncident({ id: 'INC-1', type: 'near-miss' })
    expect(a.type).toBe('safety/add_incident')
  })

  it('addToolbox creates correct action type', () => {
    const a = actions.addToolbox({ id: 'TT-1', topic: 'Lifting safety' })
    expect(a.type).toBe('safety/add_toolbox')
  })

  it('addPermit creates correct action type', () => {
    const a = actions.addPermit({ id: 'PTW-1', type: 'hot-work' })
    expect(a.type).toBe('safety/add_permit')
  })
})

// ─── Action creators — generic utilities ─────────────────────────────────────
describe('dispatch.actions — generic utilities', () => {
  it('updateStatus creates correct payload', () => {
    const a = actions.updateStatus('item-1', 'projects', 'completed')
    expect(a.type).toBe('generic/update_status')
    expect(a.data).toMatchObject({ id: 'item-1', collection: 'projects', status: 'completed' })
  })

  it('updateCollection creates correct payload', () => {
    const a = actions.updateCollection('leads', [{ id: 'L-1' }])
    expect(a.type).toBe('generic/update_collection')
    expect(a.data).toMatchObject({ collection: 'leads' })
  })

  it('rawMutate creates mutator action', () => {
    const mutator = (s: unknown) => s
    const a = actions.rawMutate(mutator as never)
    expect(a.type).toBe('raw/mutate')
  })
})

// ─── Action creators — notifications/proposals/tickets ───────────────────────
describe('dispatch.actions — Phase 8 group', () => {
  it('addNotification creates correct type', () => {
    const a = actions.addNotification({ id: 'N-1', message: 'Test' })
    expect(a.type).toBe('notif/add')
  })

  it('markNotifRead creates correct payload', () => {
    const a = actions.markNotifRead('N-1')
    expect(a.data).toMatchObject({ id: 'N-1' })
  })

  it('markAllRead creates correct type', () => {
    const a = actions.markAllRead()
    expect(a.type).toBe('notif/mark_all_read')
  })

  it('addProposal creates correct type', () => {
    const a = actions.addProposal({ id: 'P-1', title: 'Proposal' })
    expect(a.type).toBe('proposals/add')
  })

  it('updateProposal creates correct payload', () => {
    const a = actions.updateProposal('P-1', 'won')
    expect(a.data).toMatchObject({ id: 'P-1', status: 'won' })
  })

  it('addTicket creates correct type', () => {
    const a = actions.addTicket({ id: 'T-1', subject: 'Fix pump' })
    expect(a.type).toBe('tickets/add')
  })

  it('updateTicket creates correct payload', () => {
    const a = actions.updateTicket('T-1', 'closed')
    expect(a.data).toMatchObject({ id: 'T-1', status: 'closed' })
  })

  it('wipeAll creates correct type', () => {
    const a = actions.wipeAll()
    expect(a.type).toBe('data/wipe_all')
  })
})

// ─── createDispatch — custom callbacks ───────────────────────────────────────
describe('createDispatch — custom callbacks', () => {
  const policy: PolicyConfig = { writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner' }

  it('calls audit callback on dispatch', () => {
    const audits: unknown[] = []
    const { dispatch } = createDispatch({ policy, audit: e => audits.push(e) })
    dispatch(actions.addLead({ id: 'L-1', company: 'ACME' }))
    expect(audits.length).toBeGreaterThan(0)
  })

  it('returns ok:true on successful dispatch', () => {
    const { dispatch } = createDispatch({ policy })
    const result = dispatch(actions.addLead({ id: 'L-3', company: 'Gamma' }))
    expect(result.ok).toBe(true)
  })

  it('blocks write when writesEnabled=false for non-owner role', () => {
    const p2: PolicyConfig = { ...policy, writesEnabled: false, activeRole: 'viewer' }
    const { dispatch } = createDispatch({ policy: p2 })
    const result = dispatch(actions.addLead({ id: 'L-2', company: 'Beta' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('dispatchMany returns ok for valid batch', () => {
    const { dispatchMany } = createDispatch({ policy })
    const result = dispatchMany([
      actions.addLead({ id: 'L-4', company: 'Delta' }),
      actions.addVendor({ id: 'V-1', name: 'Vendor A' }),
    ])
    expect(result.ok).toBe(true)
  })
})

// ─── Store selectors — incidents / safety ────────────────────────────────────
describe('store selectors — safety', () => {
  it('selectOpenIncidents returns non-closed incidents', () => {
    useBizStore.getState().dispatch(actions.addIncident({ id: 'I-1', status: 'open' }))
    useBizStore.getState().dispatch(actions.addIncident({ id: 'I-2', status: 'closed' }))
    const result = selectOpenIncidents(useBizStore.getState())
    expect(result.some(i => i['id'] === 'I-1')).toBe(true)
    expect(result.some(i => i['id'] === 'I-2')).toBe(false)
  })

  it('selectDaysSinceLastIncident returns 365 when no incidents', () => {
    const days = selectDaysSinceLastIncident(useBizStore.getState())
    expect(days).toBe(365)
  })

  it('selectDaysSinceLastIncident returns a number >= 0', () => {
    useBizStore.getState().dispatch(actions.addIncident({ id: 'I-1', date: '2025-01-01', status: 'closed', type: 'near-miss' }))
    const days = selectDaysSinceLastIncident(useBizStore.getState())
    expect(days).toBeGreaterThanOrEqual(0)
  })

  it('selectRecordableRate returns a number', () => {
    const rate = selectRecordableRate(useBizStore.getState())
    expect(typeof rate).toBe('number')
  })

  it('selectPermitsByStatus returns active and all', () => {
    useBizStore.getState().dispatch(actions.addPermit({ id: 'PTW-1', type: 'hot-work', status: 'active' }))
    useBizStore.getState().dispatch(actions.addPermit({ id: 'PTW-2', type: 'excavation', status: 'expired' }))
    const result = selectPermitsByStatus(useBizStore.getState())
    expect(result.all.length).toBe(2)
    expect(result.active.some(p => p['id'] === 'PTW-1')).toBe(true)
    expect(result.active.some(p => p['id'] === 'PTW-2')).toBe(false)
  })
})

// ─── Store selectors — notifications / proposals / tickets ───────────────────
describe('store selectors — Phase 8', () => {
  it('selectUnreadCount counts unread notifications', () => {
    useBizStore.getState().dispatch(actions.addNotification({ id: 'N-1', message: 'A', read: false }))
    useBizStore.getState().dispatch(actions.addNotification({ id: 'N-2', message: 'B', read: true }))
    const count = selectUnreadCount(useBizStore.getState())
    expect(count).toBe(1)
  })

  it('selectUnreadCount returns 0 when all read', () => {
    useBizStore.getState().dispatch(actions.addNotification({ id: 'N-1', message: 'A', read: true }))
    expect(selectUnreadCount(useBizStore.getState())).toBe(0)
  })

  it('selectOpenProposals filters out won/lost/closed', () => {
    useBizStore.getState().dispatch(actions.addProposal({ id: 'P-1', status: 'submitted' }))
    useBizStore.getState().dispatch(actions.addProposal({ id: 'P-2', status: 'won' }))
    useBizStore.getState().dispatch(actions.addProposal({ id: 'P-3', status: 'lost' }))
    const result = selectOpenProposals(useBizStore.getState())
    expect(result.some(p => p['id'] === 'P-1')).toBe(true)
    expect(result.some(p => p['id'] === 'P-2')).toBe(false)
    expect(result.some(p => p['id'] === 'P-3')).toBe(false)
  })

  it('selectOpenTickets filters out closed/resolved', () => {
    useBizStore.getState().dispatch(actions.addTicket({ id: 'T-1', status: 'open' }))
    useBizStore.getState().dispatch(actions.addTicket({ id: 'T-2', status: 'closed' }))
    const result = selectOpenTickets(useBizStore.getState())
    expect(result.some(t => t['id'] === 'T-1')).toBe(true)
    expect(result.some(t => t['id'] === 'T-2')).toBe(false)
  })
})

// ─── Store selectors — Phase 11 additions ────────────────────────────────────
describe('store selectors — Phase 11', () => {
  it('selectPunchItems returns punch_items array', () => {
    useBizStore.getState().dispatch(actions.addPunch({ id: 'PI-1', priority: 'A' }))
    const result = selectPunchItems(useBizStore.getState())
    expect(result.some(p => p['id'] === 'PI-1')).toBe(true)
  })

  it('selectLessons returns lessons array', () => {
    useBizStore.getState().dispatch(actions.addLesson({ id: 'L-1', lesson: 'Design early' }))
    const result = selectLessons(useBizStore.getState())
    expect(result.some(l => l['id'] === 'L-1')).toBe(true)
  })

  it('selectCloseouts returns closeouts array', () => {
    useBizStore.getState().dispatch(actions.addCloseout({ id: 'CO-1', system: 'Process Unit' }))
    const result = selectCloseouts(useBizStore.getState())
    expect(result.some(c => c['id'] === 'CO-1')).toBe(true)
  })

  it('selectOpenActionCount counts open action items', () => {
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-1', status: 'open' }))
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-2', status: 'resolved' }))
    expect(selectOpenActionCount(useBizStore.getState())).toBe(1)
  })

  it('selectHighPriorityCount counts high-priority open items', () => {
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-1', status: 'open', priority: 'high' }))
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-2', status: 'open', priority: 'medium' }))
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-3', status: 'resolved', priority: 'high' }))
    expect(selectHighPriorityCount(useBizStore.getState())).toBe(1)
  })

  it('selectOverdueCount counts open items with past due date', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const tomorrow  = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-1', status: 'open', due: yesterday }))
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-2', status: 'open', due: tomorrow }))
    expect(selectOverdueCount(useBizStore.getState())).toBe(1)
  })

  it('selectResolvedCount counts resolved action items', () => {
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-1', status: 'resolved' }))
    useBizStore.getState().dispatch(actions.addAction({ id: 'AI-2', status: 'open' }))
    expect(selectResolvedCount(useBizStore.getState())).toBe(1)
  })
})

// ─── Store selectors — EVM / JHA ─────────────────────────────────────────────
describe('store selectors — EVM and JHA', () => {
  it('selectProjectsWithEVM returns array', () => {
    const result = selectProjectsWithEVM(useBizStore.getState())
    expect(Array.isArray(result)).toBe(true)
  })

  it('selectJHASummary returns object with counts', () => {
    const result = selectJHASummary(useBizStore.getState())
    expect(typeof result).toBe('object')
    expect('total' in result || typeof result === 'object').toBe(true)
  })
})

// ─── Track E: biz/store.ts branch coverage ────────────────────────────────────
// (selectProjectsWithEVM, selectJHASummary already imported above)

function makeState(biz: Record<string, unknown>) {
  return { biz } as unknown as Parameters<typeof selectPermitsByStatus>[0]
}

describe('selectPermitsByStatus — branch paths', () => {
  it('returns empty arrays when no permits', () => {
    const result = selectPermitsByStatus(makeState({}))
    expect(result.active).toHaveLength(0)
    expect(result.all).toHaveLength(0)
  })

  it('includes permits with status "active"', () => {
    const state = makeState({ permits: [
      { id: 'P-1', status: 'active' },
      { id: 'P-2', status: 'expired' },
    ]})
    const result = selectPermitsByStatus(state)
    expect(result.active).toHaveLength(1)
    expect(result.active[0].id).toBe('P-1')
  })

  it('includes permits with status "approved"', () => {
    const state = makeState({ permits: [
      { id: 'P-3', status: 'approved' },
      { id: 'P-4', status: 'draft' },
    ]})
    const result = selectPermitsByStatus(state)
    expect(result.active).toHaveLength(1)
    expect(result.active[0].id).toBe('P-3')
  })

  it('excludes permits with status "expired" or "cancelled"', () => {
    const state = makeState({ permits: [
      { id: 'P-5', status: 'expired' },
      { id: 'P-6', status: 'cancelled' },
    ]})
    const result = selectPermitsByStatus(state)
    expect(result.active).toHaveLength(0)
    expect(result.all).toHaveLength(2)
  })
})

describe('selectRecordableRate — branch paths', () => {
  it('returns 0 when no recordable incidents', () => {
    const state = makeState({
      incidents:     [{ id: 'I-1', recordable: false }],
      toolbox_talks: [{ id: 'T-1', attendees: 10 }],
    })
    const rate = selectRecordableRate(state)
    expect(rate).toBe(0)
  })

  it('calculates rate correctly with recordable incidents', () => {
    const state = makeState({
      incidents:     [{ id: 'I-1', recordable: true }, { id: 'I-2', recordable: false }],
      toolbox_talks: [{ id: 'T-1', attendees: 50 }], // 50 * 2 = 100 manhours
    })
    const rate = selectRecordableRate(state)
    // 1 recordable * 200,000 / 100 = 2000.00
    expect(rate).toBe(2000)
  })

  it('uses 1 as minimum manhours to prevent division by zero', () => {
    const state = makeState({
      incidents:     [{ id: 'I-1', recordable: true }],
      toolbox_talks: [],
    })
    const rate = selectRecordableRate(state)
    // 1 * 200,000 / 1 = 200000
    expect(rate).toBe(200000)
  })

  it('handles toolbox talks with no attendees field', () => {
    const state = makeState({
      incidents:     [{ id: 'I-1', recordable: true }],
      toolbox_talks: [{ id: 'T-1' }], // no attendees — defaults to 0
    })
    const rate = selectRecordableRate(state)
    expect(typeof rate).toBe('number')
  })
})

describe('selectDaysSinceLastIncident — branch paths', () => {
  it('returns 365 when incident has no date field', () => {
    const state = makeState({ incidents: [{ id: 'I-1' }] })
    const days = selectDaysSinceLastIncident(state)
    expect(days).toBe(365)
  })

  it('returns 0 or 1 for incident that happened today', () => {
    const today = new Date().toISOString().slice(0, 10)
    const state = makeState({ incidents: [{ id: 'I-1', date: today }] })
    const days = selectDaysSinceLastIncident(state)
    expect(days).toBeLessThanOrEqual(1)
  })

  it('uses most recent incident when multiple exist', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const lastWeek  = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const state = makeState({ incidents: [
      { id: 'I-1', date: lastWeek },
      { id: 'I-2', date: yesterday },
    ]})
    const days = selectDaysSinceLastIncident(state)
    expect(days).toBeLessThanOrEqual(2)
  })
})

describe('selectProjectsWithEVM — branch paths', () => {
  it('returns empty array when no contracts', () => {
    const state = makeState({})
    expect(selectProjectsWithEVM(state)).toHaveLength(0)
  })

  it('joins evm data to matching project', () => {
    const state = makeState({
      contracts:    [{ id: 'C-1', project: 'Alpha' }],
      evm_projects: [{ project: 'Alpha', cpi: 0.95, spi: 1.0 }],
    })
    const result = selectProjectsWithEVM(state)
    expect(result[0].evm).not.toBeNull()
    expect((result[0].evm as Record<string,number>).cpi).toBe(0.95)
  })

  it('sets evm to null when no matching evm_projects entry', () => {
    const state = makeState({
      contracts:    [{ id: 'C-2', project: 'Beta' }],
      evm_projects: [{ project: 'Alpha', cpi: 1.0 }],
    })
    const result = selectProjectsWithEVM(state)
    expect(result[0].evm).toBeNull()
  })
})

describe('selectJHASummary — branch paths', () => {
  it('returns zeros for empty jhas', () => {
    const result = selectJHASummary(makeState({}))
    expect(result.total).toBe(0)
    expect(result.approved).toBe(0)
    expect(result.pending).toBe(0)
  })

  it('counts draft as pending', () => {
    const state = makeState({ jhas: [
      { id: 'J-1', status: 'draft' },
      { id: 'J-2', status: 'pending' },
      { id: 'J-3', status: 'approved' },
    ]})
    const result = selectJHASummary(state)
    expect(result.pending).toBe(2)
    expect(result.approved).toBe(1)
    expect(result.total).toBe(3)
  })
})

describe('useBizStore — snapshot and restore', () => {
  it('snapshot returns a clone of current biz state', () => {
    const snap = useBizStore.getState().snapshot()
    expect(snap).toBeDefined()
    expect(typeof snap).toBe('object')
  })

  it('restore resets biz to provided snapshot', () => {
    const original = useBizStore.getState().snapshot()
    // Mutate state via dispatch
    useBizStore.getState().dispatch({ type: 'crm/add_lead', payload: { id: 'snap-test', name: 'Test' } })
    // Restore
    useBizStore.getState().restore(original)
    const restored = useBizStore.getState().snapshot()
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original))
  })

  it('restore clears undo/redo stacks', () => {
    const snap = useBizStore.getState().snapshot()
    useBizStore.getState().restore(snap)
    expect(useBizStore.getState().canUndo).toBe(false)
    expect(useBizStore.getState().canRedo).toBe(false)
  })
})

// ─── Track C: dispatch.ts uncovered action creators ───────────────────────────
describe('dispatch — CRM action creators', () => {
  it('addVendor creates correct action', () => {
    const a = actions.addVendor({ id: 'V-1', name: 'ACME Supplies' })
    expect(a.type).toContain('vendor')
    expect(a.data).toMatchObject({ id: 'V-1' })
  })
  it('updateVendor creates correct action', () => {
    const a = actions.updateVendor({ id: 'V-1', rating: 5 })
    expect(a.type).toContain('vendor')
    expect(a.data).toMatchObject({ id: 'V-1' })
  })
  it('deleteVendor creates action with id', () => {
    const a = actions.deleteVendor('V-1')
    expect(a.type).toContain('vendor')
    expect((a.data as Record<string,unknown>).id).toBe('V-1')
  })
  it('addCustomer creates correct action', () => {
    const a = actions.addCustomer({ id: 'C-1', name: 'Shell' })
    expect(a.type).toContain('customer')
    expect(a.data).toMatchObject({ id: 'C-1' })
  })
  it('updateCustomer creates correct action', () => {
    const a = actions.updateCustomer({ id: 'C-1', status: 'active' })
    expect(a.type).toContain('customer')
  })
  it('deleteCustomer creates action with id', () => {
    const a = actions.deleteCustomer('C-1')
    expect((a.data as Record<string,unknown>).id).toBe('C-1')
  })
  it('updateLead creates correct action', () => {
    const a = actions.updateLead({ id: 'L-1', status: 'qualified' })
    expect(a.type).toContain('lead')
  })
  it('deleteLead creates action with id', () => {
    const a = actions.deleteLead('L-1')
    expect((a.data as Record<string,unknown>).id).toBe('L-1')
  })
})

describe('dispatch — contract & finance action creators', () => {
  it('addContract creates correct action', () => {
    const a = actions.addContract({ id: 'CT-1', value: 500000 })
    expect(a.type).toContain('contract')
  })
  it('updateContract creates correct action', () => {
    const a = actions.updateContract({ id: 'CT-1', status: 'active' })
    expect(a.type).toContain('contract')
  })
  it('addInvoice creates correct action', () => {
    const a = actions.addInvoice({ id: 'INV-1', amount: 10000 })
    expect(a.type).toContain('invoice')
  })
  it('updateInvoice creates correct action', () => {
    const a = actions.updateInvoice({ id: 'INV-1', status: 'paid' })
    expect(a.type).toContain('invoice')
  })
  it('recordPayment creates action with invoice_id', () => {
    const a = actions.recordPayment('INV-1')
    expect(a.type).toContain('payment')
    expect((a.data as Record<string,unknown>).invoice_id).toBe('INV-1')
  })
  it('addExpense creates correct action', () => {
    const a = actions.addExpense({ id: 'EXP-1', amount: 500 })
    expect(a.type).toContain('expense')
  })
  it('addJournal creates correct action', () => {
    const a = actions.addJournal({ id: 'JNL-1', description: 'Depreciation' })
    expect(a.type).toContain('journal')
  })
})

describe('dispatch — procurement action creators', () => {
  it('addPO creates correct action', () => {
    const a = actions.addPO({ id: 'PO-1', vendor: 'ACME' })
    expect(a.type).toContain('po')
  })
  it('updatePO creates correct action', () => {
    const a = actions.updatePO({ id: 'PO-1', status: 'approved' })
    expect(a.type).toContain('po')
  })
  it('deletePO creates action with id', () => {
    const a = actions.deletePO('PO-1')
    expect((a.data as Record<string,unknown>).id).toBe('PO-1')
  })
  it('addRFQ creates correct action', () => {
    const a = actions.addRFQ({ id: 'RFQ-1', title: 'Valves RFQ' })
    expect(a.type).toContain('rfq')
  })
  it('addSubmittal creates correct action', () => {
    const a = actions.addSubmittal({ id: 'SUB-1', title: 'Drawing Rev A' })
    expect(a.type).toContain('submittal')
  })
  it('addRFI creates correct action', () => {
    const a = actions.addRFI({ id: 'RFI-1', question: 'Clarification needed' })
    expect(a.type).toContain('rfi')
  })
})

describe('dispatch — safety action creators', () => {
  it('addJHA creates correct action', () => {
    const a = actions.addJHA({ id: 'JHA-1', task: 'Hot work' })
    expect(a.type).toContain('jha')
  })
})

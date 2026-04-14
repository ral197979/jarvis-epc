/**
 * Tests: src/modules/biz/mutateBiz
 *
 * Covers:
 *   - createMutateBizBridge: add, update, delete, bulk, typed ops
 *   - Policy enforcement (writes blocked for viewer, allowed for owner)
 *   - mutateBizMany atomic batch
 *   - getMutateBiz convenience wrapper
 *   - createLegacyDispatch adapter (all legacy action strings)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useBizStore } from '../../modules/biz/store'
import {
  createMutateBizBridge,
  getMutateBiz,
  createLegacyDispatch,
  type MutateBizBridgeOptions,
} from '../../modules/biz/mutateBiz'
import { actions, type PolicyConfig } from '../../modules/biz/dispatch'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const OWNER_POLICY: PolicyConfig = {
  writesEnabled:  true,
  chatEnabled:    true,
  exportsEnabled: true,
  activeRole:     'owner',
}

const VIEWER_POLICY: PolicyConfig = {
  writesEnabled:  false,
  chatEnabled:    true,
  exportsEnabled: false,
  activeRole:     'viewer',
}

const OWNER_OPTS: MutateBizBridgeOptions = { policy: OWNER_POLICY }

function resetStore() {
  useBizStore.getState().reset()
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: createMutateBizBridge — op types
// ─────────────────────────────────────────────────────────────────────────────
describe('createMutateBizBridge — op: add', () => {
  beforeEach(resetStore)

  it('adds a record to the specified collection', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    const result = mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-1', name: 'Acme', status: 'new' } })
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-1')
  })

  it('returns ok:false and does not mutate when policy blocks writes', () => {
    const { mutateBiz } = createMutateBizBridge({ policy: VIEWER_POLICY })
    const result = mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-X' } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })

  it('calls onBlocked when policy blocks', () => {
    const onBlocked = vi.fn()
    const { mutateBiz } = createMutateBizBridge({ policy: VIEWER_POLICY, onBlocked })
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-X' } })
    expect(onBlocked).toHaveBeenCalledOnce()
  })
})

describe('createMutateBizBridge — op: update', () => {
  beforeEach(resetStore)

  it('updates matching record by id', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    mutateBiz({ op: 'add',    collection: 'leads', record:  { id: 'L-1', name: 'Acme', status: 'new' } })
    const result = mutateBiz({ op: 'update', collection: 'leads', id: 'L-1', changes: { status: 'qualified' } })
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads[0]?.status).toBe('qualified')
  })

  it('leaves non-matching records unchanged', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-1', name: 'A', status: 'new' } })
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-2', name: 'B', status: 'new' } })
    mutateBiz({ op: 'update', collection: 'leads', id: 'L-1', changes: { status: 'won' } })
    expect(useBizStore.getState().biz.leads[1]?.status).toBe('new')
  })
})

describe('createMutateBizBridge — op: delete', () => {
  beforeEach(resetStore)

  it('removes the record with matching id', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-1', name: 'A', status: 'new' } })
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-2', name: 'B', status: 'new' } })
    const result = mutateBiz({ op: 'delete', collection: 'leads', id: 'L-1' })
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-2')
  })

  it('is a no-op when id does not exist', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-1', name: 'A', status: 'new' } })
    mutateBiz({ op: 'delete', collection: 'leads', id: 'no-such-id' })
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })
})

describe('createMutateBizBridge — op: bulk', () => {
  beforeEach(resetStore)

  it('runs the mutator function against the state', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    const result = mutateBiz({
      op:      'bulk',
      mutator: (state) => { state.leads = [{ id: 'BULK-1', name: 'Bulk', status: 'new' }] },
    })
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('BULK-1')
  })
})

describe('createMutateBizBridge — op: typed', () => {
  beforeEach(resetStore)

  it('dispatches a typed BizAction', () => {
    const { mutateBiz } = createMutateBizBridge(OWNER_OPTS)
    const result = mutateBiz({
      op:     'typed',
      action: actions.addLead({ id: 'L-T1', name: 'TypedLead', status: 'new', estimated_value: 0, probability: 0 }),
    })
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: mutateBizMany — batch
// ─────────────────────────────────────────────────────────────────────────────
describe('createMutateBizBridge — mutateBizMany', () => {
  beforeEach(resetStore)

  it('applies multiple ops atomically', () => {
    const { mutateBizMany } = createMutateBizBridge(OWNER_OPTS)
    const result = mutateBizMany([
      { op: 'add', collection: 'leads', record: { id: 'L-1', name: 'A', status: 'new' } },
      { op: 'add', collection: 'leads', record: { id: 'L-2', name: 'B', status: 'new' } },
    ])
    expect(result.ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(2)
  })

  it('blocks all ops when policy disallows writes', () => {
    const { mutateBizMany } = createMutateBizBridge({ policy: VIEWER_POLICY })
    const result = mutateBizMany([
      { op: 'add', collection: 'leads', record: { id: 'L-1', name: 'A', status: 'new' } },
    ])
    expect(result.ok).toBe(false)
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: getMutateBiz convenience wrapper
// ─────────────────────────────────────────────────────────────────────────────
describe('getMutateBiz', () => {
  beforeEach(resetStore)

  it('returns a callable mutateBiz function', () => {
    const mutateBiz = getMutateBiz(OWNER_POLICY)
    const result = mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-G1', name: 'G', status: 'new' } })
    expect(result.ok).toBe(true)
  })

  it('forwards onBlocked callback', () => {
    const onBlocked = vi.fn()
    const mutateBiz = getMutateBiz(VIEWER_POLICY, onBlocked)
    mutateBiz({ op: 'add', collection: 'leads', record: { id: 'L-X' } })
    expect(onBlocked).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: createLegacyDispatch adapter
// ─────────────────────────────────────────────────────────────────────────────
describe('createLegacyDispatch', () => {
  beforeEach(resetStore)

  it('"add" string action adds a record', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('add', { collection: 'leads', record: { id: 'L-LD1', name: 'LD', status: 'new' } })
    expect(ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })

  it('"update" string action updates a record', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    dispatch('add', { collection: 'leads', record: { id: 'L-LD2', name: 'LD2', status: 'new' } })
    const ok = dispatch('update', { collection: 'leads', id: 'L-LD2', changes: { status: 'qualified' } })
    expect(ok).toBe(true)
    expect(useBizStore.getState().biz.leads[0]?.status).toBe('qualified')
  })

  it('"delete" string action removes a record', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    dispatch('add', { collection: 'leads', record: { id: 'L-LD3', name: 'LD3', status: 'new' } })
    const ok = dispatch('delete', { collection: 'leads', id: 'L-LD3' })
    expect(ok).toBe(true)
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })

  it('"bulk" string action runs mutator', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('bulk', {
      mutator: (state) => { state.leads = [{ id: 'L-BULK', name: 'B', status: 'new' }] },
    })
    expect(ok).toBe(true)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-BULK')
  })

  it('"add" returns false when collection is missing', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('add', { record: { id: 'L-X' } })
    expect(ok).toBe(false)
  })

  it('"update" returns false when id is missing', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('update', { collection: 'leads', changes: { status: 'new' } })
    expect(ok).toBe(false)
  })

  it('"delete" returns false when collection is missing', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('delete', { id: 'L-X' })
    expect(ok).toBe(false)
  })

  it('"bulk" returns false when mutator is missing', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('bulk', {})
    expect(ok).toBe(false)
  })

  it('typed object action passes through', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch(actions.addLead({ id: 'L-T', name: 'T', status: 'new', estimated_value: 0, probability: 0 }))
    expect(ok).toBe(true)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-T')
  })

  it('JARVIS_ACTIONS namespaced string is dispatched', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('crm/add_lead', { id: 'L-NS', name: 'NS', status: 'new', estimated_value: 0, probability: 0 })
    expect(ok).toBe(true)
  })

  it('unknown plain string returns false', () => {
    const dispatch = createLegacyDispatch(OWNER_OPTS)
    const ok = dispatch('unknown_action', {})
    expect(ok).toBe(false)
  })

  it('all ops blocked for viewer role', () => {
    const dispatch = createLegacyDispatch({ policy: VIEWER_POLICY })
    expect(dispatch('add',    { collection: 'leads', record: { id: 'L-V' } })).toBe(false)
    expect(dispatch('update', { collection: 'leads', id: 'L-V', changes: {} })).toBe(false)
    expect(dispatch('delete', { collection: 'leads', id: 'L-V' })).toBe(false)
  })
})

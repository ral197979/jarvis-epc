/**
 * Tests: modules/commissioning + biz/reducer CI actions
 * ───────────────────────────────────────────────────────
 * Coverage:
 *   - bizReducer CI action types (add, freeze, update guards, change status, evidence)
 *   - Commissioning Intelligence business logic (computeAssetTruth, computeDrift,
 *     buildAuditPackage, validateBaseline, checkAuditReadiness, computePortfolioHealth)
 *   - Helper functions (getActiveBaseline, nextBaselineVersion, canFreezeBaseline,
 *     scoreToCCABand, isBaselineFrozen)
 *   - Immutability invariants (frozen baseline cannot be updated)
 *   - Evidence write-once invariant (content_hash required)
 *   - State isolation (original state never mutated)
 */

import { describe, it, expect } from 'vitest'
import {
  bizReducer,
  emptyBizState,
  JARVIS_ACTIONS,
  type BizState,
} from '../../modules/biz/reducer'
import {
  isBaselineFrozen,
  validateBaseline,
  computeAssetTruth,
  computeDrift,
  buildAuditPackage,
  checkAuditReadiness,
  computePortfolioHealth,
  getActiveBaseline,
  nextBaselineVersion,
  canFreezeBaseline,
  scoreToCCABand,
  type CIAsset,
  type CIBaseline,
  type CITest,
  type CISetpoint,
  type CIPMTask,
  type CIChangeEvent,
  type CIEvidence,
} from '../../modules/commissioning'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function freshState(): BizState {
  return emptyBizState()
}

const NOW = '2026-02-22T10:00:00.000Z'
const LATER = '2026-02-23T10:00:00.000Z'

function makeAsset(overrides: Partial<CIAsset> = {}): CIAsset {
  return {
    id:         'ASSET-001',
    tag:        'P-101A',
    name:       'RO Feed Pump A',
    class:      'mechanical',
    system:     'RO Feed',
    status:     'active',
    created_at: NOW,
    created_by: 'engineer-1',
    ...overrides,
  }
}

function makeBaseline(overrides: Partial<CIBaseline> = {}): CIBaseline {
  return {
    id:           'BL-001',
    asset_id:     'ASSET-001',
    status:       'draft',
    version:      1,
    scope:        'Full functional performance test of RO feed pump and associated controls.',
    conditions:   'Normal operating conditions, 25°C, pH 7.2',
    test_ids:     ['TEST-001'],
    setpoint_ids: ['SP-001'],
    evidence_ids: ['EV-001'],
    created_at:   NOW,
    created_by:   'engineer-1',
    ...overrides,
  }
}

function makeFrozenBaseline(overrides: Partial<CIBaseline> = {}): CIBaseline {
  return makeBaseline({
    status:    'frozen',
    frozen_at: NOW,
    frozen_by: 'engineer-1',
    ...overrides,
  })
}

function makeTest(overrides: Partial<CITest> = {}): CITest {
  return {
    id:            'TEST-001',
    asset_id:      'ASSET-001',
    baseline_id:   'BL-001',
    type:          'FPT',
    tag:           'FPT-101-001',
    description:   'Verify pump starts on AUTO command and achieves rated flow.',
    procedure_ref: 'ITP-MEC-001 Rev B',
    result:        'pass',
    tested_at:     NOW,
    tested_by:     'engineer-1',
    evidence_ids:  ['EV-001'],
    created_at:    NOW,
    created_by:    'engineer-1',
    ...overrides,
  }
}

function makeSetpoint(overrides: Partial<CISetpoint> = {}): CISetpoint {
  return {
    id:          'SP-001',
    asset_id:    'ASSET-001',
    baseline_id: 'BL-001',
    tag:         'FIT-101',
    description: 'RO feed flow high alarm',
    category:    'alarm',
    parameter:   'Flow High',
    value:       120,
    unit:        'm3/hr',
    oem_default: 110,
    verified_at: NOW,
    verified_by: 'engineer-1',
    created_at:  NOW,
    created_by:  'engineer-1',
    ...overrides,
  }
}

function makePMTask(overrides: Partial<CIPMTask> = {}): CIPMTask {
  return {
    id:              'PM-001',
    asset_id:        'ASSET-001',
    baseline_id:     'BL-001',
    provenance:      'tested',
    provenance_note: 'Interval derived from bearing temperature observed during FPT — elevated at 4000hr interval.',
    title:           'Bearing Inspection',
    description:     'Inspect pump bearings for wear and lubrication adequacy.',
    frequency:       'quarterly',
    estimated_hours: 2,
    active:          true,
    created_at:      NOW,
    created_by:      'engineer-1',
    ...overrides,
  }
}

function makeChangeEvent(overrides: Partial<CIChangeEvent> = {}): CIChangeEvent {
  return {
    id:          'CE-001',
    asset_id:    'ASSET-001',
    baseline_id: 'BL-001',
    type:        'setpoint_change',
    status:      'proposed',
    impact:      'low',
    title:       'Flow High Alarm Adjustment',
    description: 'Increase flow high alarm from 120 to 125 m3/hr to reduce nuisance trips.',
    reason:      'Operational feedback — pump surges during startup causing false alarms.',
    requested_by: 'ops-lead-1',
    reversible:  true,
    evidence_ids: [],
    created_at:  LATER,
    created_by:  'ops-lead-1',
    ...overrides,
  }
}

function makeEvidence(overrides: Partial<CIEvidence> = {}): CIEvidence {
  return {
    id:             'EV-001',
    asset_id:       'ASSET-001',
    linked_to_id:   'TEST-001',
    linked_to_type: 'test',
    type:           'test_record',
    title:          'FPT-101-001 Signed Test Record',
    uri:            's3://jarvis-evidence/EV-001.pdf',
    content_hash:   'a'.repeat(64), // valid 64-char SHA-256 hex
    uploaded_by:    'engineer-1',
    uploaded_at:    NOW,
    created_at:     NOW,
    created_by:     'engineer-1',
    ...overrides,
  }
}

// ─── JARVIS_ACTIONS CI constants ──────────────────────────────────────────────

describe('JARVIS_ACTIONS — CI action constants', () => {
  it('defines all CI add actions', () => {
    expect(JARVIS_ACTIONS.CI_ADD_ASSET).toBe('ci/add_asset')
    expect(JARVIS_ACTIONS.CI_ADD_BASELINE).toBe('ci/add_baseline')
    expect(JARVIS_ACTIONS.CI_ADD_TEST).toBe('ci/add_test')
    expect(JARVIS_ACTIONS.CI_ADD_SETPOINT).toBe('ci/add_setpoint')
    expect(JARVIS_ACTIONS.CI_ADD_PM_TASK).toBe('ci/add_pm_task')
    expect(JARVIS_ACTIONS.CI_ADD_CHANGE_EVENT).toBe('ci/add_change_event')
    expect(JARVIS_ACTIONS.CI_ADD_EVIDENCE).toBe('ci/add_evidence')
  })

  it('defines all CI mutation actions', () => {
    expect(JARVIS_ACTIONS.CI_FREEZE_BASELINE).toBe('ci/freeze_baseline')
    expect(JARVIS_ACTIONS.CI_UPDATE_ASSET).toBe('ci/update_asset')
    expect(JARVIS_ACTIONS.CI_UPDATE_TEST).toBe('ci/update_test')
    expect(JARVIS_ACTIONS.CI_UPDATE_SETPOINT).toBe('ci/update_setpoint')
    expect(JARVIS_ACTIONS.CI_UPDATE_PM_TASK).toBe('ci/update_pm_task')
    expect(JARVIS_ACTIONS.CI_DEACTIVATE_PM_TASK).toBe('ci/deactivate_pm_task')
    expect(JARVIS_ACTIONS.CI_UPDATE_CHANGE_STATUS).toBe('ci/update_change_status')
    expect(JARVIS_ACTIONS.CI_DELETE_ASSET).toBe('ci/delete_asset')
  })

  it('has no duplicate CI values', () => {
    const ciKeys = Object.keys(JARVIS_ACTIONS).filter(k => k.startsWith('CI_'))
    const ciValues = ciKeys.map(k => JARVIS_ACTIONS[k as keyof typeof JARVIS_ACTIONS])
    const unique = new Set(ciValues)
    expect(unique.size).toBe(ciValues.length)
  })
})

// ─── emptyBizState CI collections ─────────────────────────────────────────────

describe('emptyBizState — CI collections', () => {
  it('includes all 7 CI collections as empty arrays', () => {
    const state = emptyBizState()
    const collections = [
      'ci_assets', 'ci_baselines', 'ci_tests',
      'ci_setpoints', 'ci_pm_tasks', 'ci_change_events', 'ci_evidence',
    ]
    for (const col of collections) {
      expect(Array.isArray(state[col])).toBe(true)
      expect((state[col] as unknown[]).length).toBe(0)
    }
  })
})

// ─── CI Add actions ───────────────────────────────────────────────────────────

describe('bizReducer — CI add actions', () => {
  const asset    = makeAsset()
  const baseline = makeBaseline()
  const test     = makeTest()
  const setpoint = makeSetpoint()
  const pmTask   = makePMTask()
  const change   = makeChangeEvent()

  it('ci/add_asset adds to ci_assets', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_asset', data: asset })
    expect(result.ok).toBe(true)
    expect((result.state.ci_assets as unknown[]).length).toBe(1)
    expect((result.state.ci_assets as unknown as CIAsset[])[0].tag).toBe('P-101A')
  })

  it('ci/add_baseline adds to ci_baselines', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_baseline', data: baseline })
    expect(result.ok).toBe(true)
    expect((result.state.ci_baselines as unknown[]).length).toBe(1)
  })

  it('ci/add_test adds to ci_tests', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_test', data: test })
    expect(result.ok).toBe(true)
    expect((result.state.ci_tests as unknown[]).length).toBe(1)
  })

  it('ci/add_setpoint adds to ci_setpoints', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_setpoint', data: setpoint })
    expect(result.ok).toBe(true)
    expect((result.state.ci_setpoints as unknown[]).length).toBe(1)
  })

  it('ci/add_pm_task adds to ci_pm_tasks', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_pm_task', data: pmTask })
    expect(result.ok).toBe(true)
    expect((result.state.ci_pm_tasks as unknown[]).length).toBe(1)
  })

  it('ci/add_change_event adds to ci_change_events', () => {
    const result = bizReducer(freshState(), { type: 'ci/add_change_event', data: change })
    expect(result.ok).toBe(true)
    expect((result.state.ci_change_events as unknown[]).length).toBe(1)
  })

  it('ci add actions do NOT mutate the original state', () => {
    const state  = freshState()
    const before = JSON.stringify(state.ci_assets)
    bizReducer(state, { type: 'ci/add_asset', data: asset })
    expect(JSON.stringify(state.ci_assets)).toBe(before)
  })

  it('multiple adds accumulate in collection', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_asset', data: makeAsset({ id: 'A-1', tag: 'P-101A' }) }).state
    state = bizReducer(state, { type: 'ci/add_asset', data: makeAsset({ id: 'A-2', tag: 'P-101B' }) }).state
    expect((state.ci_assets as unknown[]).length).toBe(2)
  })
})

// ─── ci/add_evidence (write-once guard) ───────────────────────────────────────

describe('bizReducer — ci/add_evidence (write-once guard)', () => {
  it('rejects evidence without content_hash', () => {
    const ev = makeEvidence({ content_hash: '' })
    const result = bizReducer(freshState(), { type: 'ci/add_evidence', data: ev })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/content_hash/)
  })

  it('rejects evidence when content_hash is undefined', () => {
    const ev = { ...makeEvidence() }
    delete (ev as Partial<CIEvidence>).content_hash
    const result = bizReducer(freshState(), { type: 'ci/add_evidence', data: ev })
    expect(result.ok).toBe(false)
  })

  it('accepts evidence with valid content_hash', () => {
    const ev     = makeEvidence()
    const result = bizReducer(freshState(), { type: 'ci/add_evidence', data: ev })
    expect(result.ok).toBe(true)
    expect((result.state.ci_evidence as unknown[]).length).toBe(1)
  })

  it('preserves content_hash exactly as provided', () => {
    const hash   = 'b'.repeat(64)
    const ev     = makeEvidence({ content_hash: hash })
    const result = bizReducer(freshState(), { type: 'ci/add_evidence', data: ev })
    expect((result.state.ci_evidence as unknown as CIEvidence[])[0].content_hash).toBe(hash)
  })

  it('accepts a second evidence record (no single-write-per-asset restriction)', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_evidence', data: makeEvidence({ id: 'EV-001' }) }).state
    state = bizReducer(state, { type: 'ci/add_evidence', data: makeEvidence({ id: 'EV-002' }) }).state
    expect((state.ci_evidence as unknown[]).length).toBe(2)
  })
})

// ─── ci/freeze_baseline ───────────────────────────────────────────────────────

describe('bizReducer — ci/freeze_baseline', () => {
  function stateWithDraftBaseline(): BizState {
    const state = freshState()
    return bizReducer(state, {
      type: 'ci/add_baseline',
      data: makeBaseline(),
    }).state
  }

  it('sets status to frozen', () => {
    const state  = stateWithDraftBaseline()
    const result = bizReducer(state, {
      type: 'ci/freeze_baseline',
      data: { id: 'BL-001', frozen_by: 'pm-1' },
    })
    expect(result.ok).toBe(true)
    const bl = (result.state.ci_baselines as unknown as CIBaseline[]).find(b => b.id === 'BL-001')!
    expect(bl.status).toBe('frozen')
  })

  it('stamps frozen_at as ISO timestamp', () => {
    const state  = stateWithDraftBaseline()
    const result = bizReducer(state, {
      type: 'ci/freeze_baseline',
      data: { id: 'BL-001', frozen_by: 'pm-1' },
    })
    const bl = (result.state.ci_baselines as unknown as CIBaseline[]).find(b => b.id === 'BL-001')!
    expect(bl.frozen_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stamps frozen_by', () => {
    const state  = stateWithDraftBaseline()
    const result = bizReducer(state, {
      type: 'ci/freeze_baseline',
      data: { id: 'BL-001', frozen_by: 'pm-jones' },
    })
    const bl = (result.state.ci_baselines as unknown as CIBaseline[]).find(b => b.id === 'BL-001')!
    expect(bl.frozen_by).toBe('pm-jones')
  })

  it('falls back to "system" when frozen_by not provided', () => {
    const state  = stateWithDraftBaseline()
    const result = bizReducer(state, {
      type: 'ci/freeze_baseline',
      data: { id: 'BL-001' },
    })
    const bl = (result.state.ci_baselines as unknown as CIBaseline[]).find(b => b.id === 'BL-001')!
    expect(bl.frozen_by).toBe('system')
  })

  it('rejects freeze on already-frozen baseline', () => {
    const state = {
      ...freshState(),
      ci_baselines: [makeFrozenBaseline()],
    }
    const result = bizReducer(state, {
      type: 'ci/freeze_baseline',
      data: { id: 'BL-001' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already frozen/)
  })

  it('rejects freeze when id is missing', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/freeze_baseline',
      data: {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires id/)
  })

  it('rejects freeze when baseline not found', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/freeze_baseline',
      data: { id: 'DOES-NOT-EXIST' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })

  it('does not mutate original state', () => {
    const state  = stateWithDraftBaseline()
    const before = (state.ci_baselines as unknown as CIBaseline[])[0].status
    bizReducer(state, { type: 'ci/freeze_baseline', data: { id: 'BL-001' } })
    expect((state.ci_baselines as unknown as CIBaseline[])[0].status).toBe(before)
  })
})

// ─── ci/update_test (freeze guard) ────────────────────────────────────────────

describe('bizReducer — ci/update_test (freeze guard)', () => {
  function stateWithFrozenBaselineAndTest(): BizState {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_baseline', data: makeFrozenBaseline() }).state
    state = bizReducer(state, { type: 'ci/add_test',     data: makeTest() }).state
    return state
  }

  function stateWithDraftBaselineAndTest(): BizState {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_baseline', data: makeBaseline() }).state
    state = bizReducer(state, { type: 'ci/add_test',     data: makeTest() }).state
    return state
  }

  it('rejects update when baseline is frozen', () => {
    const state  = stateWithFrozenBaselineAndTest()
    const result = bizReducer(state, {
      type: 'ci/update_test',
      data: { id: 'TEST-001', baseline_id: 'BL-001', result: 'fail' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/frozen/)
  })

  it('allows update when baseline is draft', () => {
    const state  = stateWithDraftBaselineAndTest()
    const result = bizReducer(state, {
      type: 'ci/update_test',
      data: { id: 'TEST-001', baseline_id: 'BL-001', result: 'conditional_pass' },
    })
    expect(result.ok).toBe(true)
    const test = (result.state.ci_tests as unknown as CITest[]).find(t => t.id === 'TEST-001')!
    expect(test.result).toBe('conditional_pass')
  })

  it('allows update when no baseline_id provided (unlinked test)', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_test', data: makeTest() }).state
    const result = bizReducer(state, {
      type: 'ci/update_test',
      data: { id: 'TEST-001', description: 'Updated description' },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects when id is missing', () => {
    const result = bizReducer(freshState(), { type: 'ci/update_test', data: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires id/)
  })
})

// ─── ci/update_setpoint (freeze guard) ───────────────────────────────────────

describe('bizReducer — ci/update_setpoint (freeze guard)', () => {
  it('rejects update when baseline is frozen', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_baseline', data: makeFrozenBaseline() }).state
    state = bizReducer(state, { type: 'ci/add_setpoint', data: makeSetpoint() }).state

    const result = bizReducer(state, {
      type: 'ci/update_setpoint',
      data: { id: 'SP-001', baseline_id: 'BL-001', value: 130 },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/frozen/)
  })

  it('allows update when baseline is draft', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_baseline', data: makeBaseline() }).state
    state = bizReducer(state, { type: 'ci/add_setpoint', data: makeSetpoint() }).state

    const result = bizReducer(state, {
      type: 'ci/update_setpoint',
      data: { id: 'SP-001', baseline_id: 'BL-001', value: 125 },
    })
    expect(result.ok).toBe(true)
    const sp = (result.state.ci_setpoints as unknown as CISetpoint[]).find(s => s.id === 'SP-001')!
    expect(sp.value).toBe(125)
  })

  it('rejects when id is missing', () => {
    const result = bizReducer(freshState(), { type: 'ci/update_setpoint', data: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires id/)
  })
})

// ─── ci/deactivate_pm_task ────────────────────────────────────────────────────

describe('bizReducer — ci/deactivate_pm_task', () => {
  it('sets active to false', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_pm_task', data: makePMTask() }).state
    const result = bizReducer(state, {
      type: 'ci/deactivate_pm_task',
      data: { id: 'PM-001' },
    })
    expect(result.ok).toBe(true)
    const task = (result.state.ci_pm_tasks as unknown as CIPMTask[]).find(p => p.id === 'PM-001')!
    expect(task.active).toBe(false)
  })

  it('does not hard-delete the record', () => {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_pm_task', data: makePMTask() }).state
    const result = bizReducer(state, {
      type: 'ci/deactivate_pm_task',
      data: { id: 'PM-001' },
    })
    expect((result.state.ci_pm_tasks as unknown[]).length).toBe(1)
  })

  it('rejects when id is missing', () => {
    const result = bizReducer(freshState(), { type: 'ci/deactivate_pm_task', data: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires id/)
  })

  it('is a no-op when PM task not found', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/deactivate_pm_task',
      data: { id: 'MISSING' },
    })
    expect(result.ok).toBe(true) // graceful no-op
  })
})

// ─── ci/update_change_status ──────────────────────────────────────────────────

describe('bizReducer — ci/update_change_status', () => {
  function stateWithChange(): BizState {
    let state = freshState()
    state = bizReducer(state, { type: 'ci/add_change_event', data: makeChangeEvent() }).state
    return state
  }

  it('updates status field', () => {
    const state  = stateWithChange()
    const result = bizReducer(state, {
      type: 'ci/update_change_status',
      data: { id: 'CE-001', status: 'approved', approved_by: 'pm-1', approved_at: LATER },
    })
    expect(result.ok).toBe(true)
    const ev = (result.state.ci_change_events as unknown as CIChangeEvent[]).find(c => c.id === 'CE-001')!
    expect(ev.status).toBe('approved')
    expect(ev.approved_by).toBe('pm-1')
  })

  it('does NOT update immutable fields (description, reason, impact)', () => {
    const state   = stateWithChange()
    const before  = (state.ci_change_events as unknown as CIChangeEvent[])[0]
    const result  = bizReducer(state, {
      type: 'ci/update_change_status',
      data: {
        id: 'CE-001', status: 'approved',
        description: 'HACKED', reason: 'HACKED', impact: 'critical',
      },
    })
    const after = (result.state.ci_change_events as unknown as CIChangeEvent[]).find(c => c.id === 'CE-001')!
    // immutable fields preserved
    expect(after.description).toBe(before.description)
    expect(after.reason).toBe(before.reason)
    expect(after.impact).toBe(before.impact)
    // only status changed
    expect(after.status).toBe('approved')
  })

  it('stamps implemented_at and implemented_by', () => {
    const state  = stateWithChange()
    const result = bizReducer(state, {
      type: 'ci/update_change_status',
      data: { id: 'CE-001', status: 'implemented', implemented_at: LATER, implemented_by: 'tech-1' },
    })
    const ev = (result.state.ci_change_events as unknown as CIChangeEvent[]).find(c => c.id === 'CE-001')!
    expect(ev.implemented_at).toBe(LATER)
    expect(ev.implemented_by).toBe('tech-1')
  })

  it('rejects when id is missing', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/update_change_status',
      data: { status: 'approved' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires id/)
  })

  it('rejects when status is missing', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/update_change_status',
      data: { id: 'CE-001' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/requires status/)
  })

  it('rejects when change event not found', () => {
    const result = bizReducer(freshState(), {
      type: 'ci/update_change_status',
      data: { id: 'MISSING', status: 'approved' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})

// ─── isBaselineFrozen ─────────────────────────────────────────────────────────

describe('isBaselineFrozen', () => {
  it('returns true for frozen baseline with frozen_at', () => {
    expect(isBaselineFrozen(makeFrozenBaseline())).toBe(true)
  })

  it('returns false for draft baseline', () => {
    expect(isBaselineFrozen(makeBaseline())).toBe(false)
  })

  it('returns false when status is frozen but frozen_at is missing', () => {
    const bl = makeBaseline({ status: 'frozen' }) // no frozen_at
    expect(isBaselineFrozen(bl)).toBe(false)
  })
})

// ─── validateBaseline ─────────────────────────────────────────────────────────

describe('validateBaseline', () => {
  it('passes with complete baseline, passing test, and hashed evidence', () => {
    const result = validateBaseline(
      makeBaseline(),
      [makeTest()],
      [makeSetpoint()],
      [makeEvidence()],
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('blocks freeze of already-frozen baseline', () => {
    const result = validateBaseline(makeFrozenBaseline(), [], [], [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/already frozen/))).toBe(true)
  })

  it('errors when scope is empty', () => {
    const result = validateBaseline(
      makeBaseline({ scope: '' }),
      [makeTest()],
      [makeSetpoint()],
      [makeEvidence()],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/scope/))).toBe(true)
  })

  it('errors when no tests linked', () => {
    const bl = makeBaseline({ test_ids: [] })
    const result = validateBaseline(bl, [], [makeSetpoint()], [makeEvidence()])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/test/))).toBe(true)
  })

  it('errors when a linked test has result=fail', () => {
    const result = validateBaseline(
      makeBaseline(),
      [makeTest({ result: 'fail' })],
      [makeSetpoint()],
      [makeEvidence()],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/fail/))).toBe(true)
  })

  it('warns (not errors) when a linked test is deferred', () => {
    const result = validateBaseline(
      makeBaseline(),
      [makeTest({ result: 'deferred' })],
      [makeSetpoint()],
      [makeEvidence()],
    )
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some(w => w.match(/deferred/))).toBe(true)
  })

  it('errors when no evidence linked', () => {
    const bl = makeBaseline({ evidence_ids: [] })
    const result = validateBaseline(bl, [makeTest()], [makeSetpoint()], [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/evidence/))).toBe(true)
  })

  it('errors when evidence is missing content_hash', () => {
    const result = validateBaseline(
      makeBaseline(),
      [makeTest()],
      [makeSetpoint()],
      [makeEvidence({ content_hash: '' })],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.match(/hash/))).toBe(true)
  })

  it('warns (not errors) when no setpoints linked', () => {
    const bl = makeBaseline({ setpoint_ids: [] })
    const result = validateBaseline(bl, [makeTest()], [], [makeEvidence()])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some(w => w.match(/setpoint/))).toBe(true)
  })
})

// ─── computeDrift ─────────────────────────────────────────────────────────────

describe('computeDrift', () => {
  it('returns drift_score=100 when no baseline', () => {
    const summary = computeDrift(makeAsset(), null, [])
    expect(summary.drift_score).toBe(100)
    expect(summary.flags.some(f => f.match(/No frozen baseline/))).toBe(true)
  })

  it('returns drift_score=0 with frozen baseline and no change events', () => {
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), [])
    expect(summary.drift_score).toBe(0)
    expect(summary.flags).toHaveLength(0)
  })

  it('increases score for open change events', () => {
    const changes = [makeChangeEvent({ status: 'proposed', impact: 'low' })]
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), changes)
    expect(summary.drift_score).toBeGreaterThan(0)
    expect(summary.open_changes).toBe(1)
  })

  it('penalises unapproved-but-implemented changes more heavily', () => {
    const approved = makeChangeEvent({
      id: 'CE-A', status: 'implemented', impact: 'low',
      approved_by: 'pm-1',
    })
    const unapproved = makeChangeEvent({
      id: 'CE-B', status: 'implemented', impact: 'low',
      approved_by: undefined,
    })
    const baseScore   = computeDrift(makeAsset(), makeFrozenBaseline(), [approved]).drift_score
    const penalised   = computeDrift(makeAsset(), makeFrozenBaseline(), [unapproved]).drift_score
    expect(penalised).toBeGreaterThan(baseScore)
  })

  it('does not count rejected or rolled_back changes', () => {
    const changes = [
      makeChangeEvent({ id: 'CE-1', status: 'rejected', impact: 'high' }),
      makeChangeEvent({ id: 'CE-2', status: 'rolled_back', impact: 'critical' }),
    ]
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), changes)
    expect(summary.drift_score).toBe(0)
  })

  it('caps drift_score at 100', () => {
    const changes = Array.from({ length: 20 }, (_, i) =>
      makeChangeEvent({ id: `CE-${i}`, status: 'implemented', impact: 'critical', approved_by: undefined })
    )
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), changes)
    expect(summary.drift_score).toBe(100)
  })

  it('flags high-impact changes', () => {
    const changes = [makeChangeEvent({ impact: 'high', status: 'implemented', approved_by: 'pm-1' })]
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), changes)
    expect(summary.flags.some(f => f.match(/high\/critical/))).toBe(true)
    expect(summary.high_impact_changes).toBe(1)
  })

  it('sets last_change_at from most recent implemented_at', () => {
    const changes = [
      makeChangeEvent({ id: 'CE-1', implemented_at: '2026-01-01T00:00:00Z' }),
      makeChangeEvent({ id: 'CE-2', implemented_at: '2026-02-01T00:00:00Z' }),
    ]
    const summary = computeDrift(makeAsset(), makeFrozenBaseline(), changes)
    expect(summary.last_change_at).toBe('2026-02-01T00:00:00Z')
  })

  it('returns asset_tag from asset', () => {
    const summary = computeDrift(makeAsset({ tag: 'V-202' }), makeFrozenBaseline(), [])
    expect(summary.asset_tag).toBe('V-202')
  })
})

// ─── checkAuditReadiness ──────────────────────────────────────────────────────

describe('checkAuditReadiness', () => {
  it('returns true for frozen baseline with hashed evidence and linked tests', () => {
    const baseline = makeFrozenBaseline()
    const test     = makeTest()
    const evidence = makeEvidence({ linked_to_id: 'TEST-001' })
    expect(checkAuditReadiness(baseline, [test], [evidence])).toBe(true)
  })

  it('returns false when baseline is null', () => {
    expect(checkAuditReadiness(null, [], [])).toBe(false)
  })

  it('returns false when baseline is draft', () => {
    expect(checkAuditReadiness(makeBaseline(), [], [])).toBe(false)
  })

  it('returns false when no evidence_ids linked to baseline', () => {
    const bl = makeFrozenBaseline({ evidence_ids: [] })
    expect(checkAuditReadiness(bl, [makeTest()], [makeEvidence()])).toBe(false)
  })

  it('returns false when an evidence record has no content_hash', () => {
    const ev = makeEvidence({ content_hash: '' })
    expect(checkAuditReadiness(makeFrozenBaseline(), [makeTest()], [ev])).toBe(false)
  })

  it('returns false when a linked test has no evidence', () => {
    // evidence is linked to something else, not to TEST-001
    const ev = makeEvidence({ linked_to_id: 'OTHER-ID' })
    expect(checkAuditReadiness(makeFrozenBaseline(), [makeTest()], [ev])).toBe(false)
  })

  it('returns true when a linked test is not_applicable (no evidence required)', () => {
    const test = makeTest({ result: 'not_applicable' })
    const ev   = makeEvidence({ linked_to_id: 'BL-001' }) // linked to baseline, not test
    // The test is N/A so we skip evidence check for it
    const bl   = makeFrozenBaseline({ test_ids: ['TEST-001'] })
    expect(checkAuditReadiness(bl, [test], [ev])).toBe(true)
  })
})

// ─── computeAssetTruth ────────────────────────────────────────────────────────

describe('computeAssetTruth', () => {
  it('returns all linked data for the asset', () => {
    const asset    = makeAsset()
    const baseline = makeFrozenBaseline()
    const test     = makeTest()
    const setpoint = makeSetpoint()
    const pm       = makePMTask()
    const change   = makeChangeEvent()
    const evidence = makeEvidence({ linked_to_id: 'TEST-001' })

    const truth = computeAssetTruth(asset, [baseline], [test], [setpoint], [pm], [change], [evidence])

    expect(truth.asset.id).toBe('ASSET-001')
    expect(truth.active_baseline?.id).toBe('BL-001')
    expect(truth.tests).toHaveLength(1)
    expect(truth.setpoints).toHaveLength(1)
    expect(truth.pm_tasks).toHaveLength(1)
    expect(truth.change_events).toHaveLength(1)
    expect(truth.evidence).toHaveLength(1)
  })

  it('sets active_baseline to highest version frozen baseline', () => {
    const asset = makeAsset()
    const bl_v1 = makeFrozenBaseline({ id: 'BL-001', version: 1 })
    const bl_v2 = makeFrozenBaseline({ id: 'BL-002', version: 2 })
    const draft = makeBaseline({ id: 'BL-003', version: 3 })

    const truth = computeAssetTruth(asset, [bl_v1, bl_v2, draft], [], [], [], [], [])
    expect(truth.active_baseline?.id).toBe('BL-002')
    expect(truth.baseline_history).toHaveLength(3)
  })

  it('sets active_baseline to null when no frozen baselines exist', () => {
    const truth = computeAssetTruth(makeAsset(), [makeBaseline()], [], [], [], [], [])
    expect(truth.active_baseline).toBeNull()
  })

  it('only includes active PM tasks', () => {
    const asset   = makeAsset()
    const active  = makePMTask({ id: 'PM-ACT', active: true })
    const inactive = makePMTask({ id: 'PM-INA', active: false })
    const truth = computeAssetTruth(asset, [], [], [], [active, inactive], [], [])
    expect(truth.pm_tasks).toHaveLength(1)
    expect(truth.pm_tasks[0].id).toBe('PM-ACT')
  })

  it('computes audit_ready correctly', () => {
    const baseline = makeFrozenBaseline()
    const test     = makeTest()
    const evidence = makeEvidence({ linked_to_id: 'TEST-001' })
    const truth = computeAssetTruth(makeAsset(), [baseline], [test], [], [], [], [evidence])
    expect(truth.audit_ready).toBe(true)
  })

  it('filters data to current asset only (no cross-asset leakage)', () => {
    const assetA = makeAsset({ id: 'A-001', tag: 'P-101A' })
    const assetB = makeAsset({ id: 'A-002', tag: 'P-102B' })
    const testA  = makeTest({ id: 'T-A', asset_id: 'A-001' })
    const testB  = makeTest({ id: 'T-B', asset_id: 'A-002' })

    const truth = computeAssetTruth(assetA, [], [testA, testB], [], [], [], [])
    expect(truth.tests).toHaveLength(1)
    expect(truth.tests[0].id).toBe('T-A')
  })
})

// ─── buildAuditPackage ────────────────────────────────────────────────────────

describe('buildAuditPackage', () => {
  function fullTruth() {
    const asset    = makeAsset()
    const baseline = makeFrozenBaseline()
    const test     = makeTest()
    const evidence = makeEvidence({ linked_to_id: 'TEST-001' })
    const change   = makeChangeEvent({ status: 'implemented', approved_by: 'pm-1' })
    return computeAssetTruth(asset, [baseline], [test], [], [], [change], [evidence])
  }

  it('returns generated_at as ISO timestamp', () => {
    const pkg = buildAuditPackage(fullTruth(), 'Prove this pump was commissioned', 'auditor-1')
    expect(pkg.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('includes all hashed evidence in chain', () => {
    const pkg = buildAuditPackage(fullTruth(), 'Show all evidence', 'auditor-1')
    expect(pkg.evidence_chain).toHaveLength(1)
    expect(pkg.evidence_chain[0].hash).toBe('a'.repeat(64))
  })

  it('excludes evidence without content_hash', () => {
    const truth = fullTruth()
    truth.evidence.push(makeEvidence({ id: 'EV-UNHASHED', content_hash: '' }))
    const pkg = buildAuditPackage(truth, 'Evidence check', 'auditor-1')
    const ids = pkg.evidence_chain.map(e => e.id)
    expect(ids).not.toContain('EV-UNHASHED')
  })

  it('includes change timeline sorted chronologically', () => {
    const truth = fullTruth()
    truth.change_events.push(
      makeChangeEvent({ id: 'CE-A', created_at: '2026-01-01T00:00:00Z' }),
      makeChangeEvent({ id: 'CE-B', created_at: '2026-03-01T00:00:00Z' }),
    )
    const pkg = buildAuditPackage(truth, 'Change history', 'auditor-1')
    expect(pkg.change_timeline[0].ts.localeCompare(pkg.change_timeline[1].ts)).toBeLessThanOrEqual(0)
  })

  it('includes asset_tag and baseline_ref', () => {
    const pkg = buildAuditPackage(fullTruth(), 'Baseline check', 'auditor-1')
    expect(pkg.asset_tag).toBe('P-101A')
    expect(pkg.baseline_ref).toMatch(/Baseline v1/)
  })

  it('warns in narrative when no frozen baseline', () => {
    const truth = computeAssetTruth(makeAsset(), [], [], [], [], [], [])
    const pkg   = buildAuditPackage(truth, 'Missing baseline', 'auditor-1')
    expect(pkg.narrative).toMatch(/WARNING/)
    expect(pkg.baseline_ref).toMatch(/NO FROZEN BASELINE/)
  })
})

// ─── computePortfolioHealth ───────────────────────────────────────────────────

describe('computePortfolioHealth', () => {
  it('returns 0 score and commissioned_in_name_only for empty portfolio', () => {
    const health = computePortfolioHealth([])
    expect(health.overall_score).toBe(0)
    expect(health.band).toBe('commissioned_in_name_only')
    expect(health.asset_count).toBe(0)
  })

  it('returns 100 score for all-zero drift portfolio', () => {
    const summaries = [
      { asset_id: 'A-1', asset_tag: 'P-101', baseline_version: 1, open_changes: 0, high_impact_changes: 0, unapproved_changes: 0, drift_score: 0, last_change_at: null, flags: [] },
      { asset_id: 'A-2', asset_tag: 'P-102', baseline_version: 1, open_changes: 0, high_impact_changes: 0, unapproved_changes: 0, drift_score: 0, last_change_at: null, flags: [] },
    ]
    const health = computePortfolioHealth(summaries)
    expect(health.overall_score).toBe(100)
    expect(health.band).toBe('operationally_defendable')
  })

  it('flags assets with no baseline (drift_score=100)', () => {
    const summaries = [
      { asset_id: 'A-1', asset_tag: 'P-101', baseline_version: 0, open_changes: 0, high_impact_changes: 0, unapproved_changes: 0, drift_score: 100, last_change_at: null, flags: [] },
    ]
    const health = computePortfolioHealth(summaries)
    expect(health.flags.some(f => f.match(/no frozen baseline/))).toBe(true)
  })

  it('correctly counts high_risk_count (drift >= 50)', () => {
    const summaries = [
      { asset_id: 'A-1', asset_tag: 'P-101', baseline_version: 1, open_changes: 0, high_impact_changes: 0, unapproved_changes: 0, drift_score: 20, last_change_at: null, flags: [] },
      { asset_id: 'A-2', asset_tag: 'P-102', baseline_version: 1, open_changes: 2, high_impact_changes: 1, unapproved_changes: 1, drift_score: 65, last_change_at: null, flags: [] },
      { asset_id: 'A-3', asset_tag: 'P-103', baseline_version: 0, open_changes: 0, high_impact_changes: 0, unapproved_changes: 0, drift_score: 100, last_change_at: null, flags: [] },
    ]
    const health = computePortfolioHealth(summaries)
    expect(health.high_risk_count).toBe(2)
    expect(health.asset_count).toBe(3)
  })
})

// ─── scoreToCCABand ───────────────────────────────────────────────────────────

describe('scoreToCCABand', () => {
  it('85+ = operationally_defendable', () => {
    expect(scoreToCCABand(100)).toBe('operationally_defendable')
    expect(scoreToCCABand(85)).toBe('operationally_defendable')
  })

  it('70–84 = latent_risk', () => {
    expect(scoreToCCABand(84)).toBe('latent_risk')
    expect(scoreToCCABand(70)).toBe('latent_risk')
  })

  it('50–69 = high_failure_probability', () => {
    expect(scoreToCCABand(69)).toBe('high_failure_probability')
    expect(scoreToCCABand(50)).toBe('high_failure_probability')
  })

  it('<50 = commissioned_in_name_only', () => {
    expect(scoreToCCABand(49)).toBe('commissioned_in_name_only')
    expect(scoreToCCABand(0)).toBe('commissioned_in_name_only')
  })
})

// ─── getActiveBaseline ────────────────────────────────────────────────────────

describe('getActiveBaseline', () => {
  it('returns null when no baselines exist', () => {
    expect(getActiveBaseline('ASSET-001', [])).toBeNull()
  })

  it('returns null when only draft baselines exist', () => {
    expect(getActiveBaseline('ASSET-001', [makeBaseline()])).toBeNull()
  })

  it('returns the frozen baseline', () => {
    const result = getActiveBaseline('ASSET-001', [makeFrozenBaseline()])
    expect(result?.id).toBe('BL-001')
  })

  it('returns the highest-version frozen baseline when multiple exist', () => {
    const v1 = makeFrozenBaseline({ id: 'BL-V1', version: 1 })
    const v2 = makeFrozenBaseline({ id: 'BL-V2', version: 2 })
    const result = getActiveBaseline('ASSET-001', [v1, v2])
    expect(result?.id).toBe('BL-V2')
  })

  it('filters by asset_id — no cross-asset leakage', () => {
    const bl = makeFrozenBaseline({ asset_id: 'ASSET-OTHER' })
    expect(getActiveBaseline('ASSET-001', [bl])).toBeNull()
  })
})

// ─── nextBaselineVersion ──────────────────────────────────────────────────────

describe('nextBaselineVersion', () => {
  it('returns 1 for first baseline on an asset', () => {
    expect(nextBaselineVersion('ASSET-001', [])).toBe(1)
  })

  it('returns max + 1 when baselines exist', () => {
    const baselines = [
      makeBaseline({ version: 1 }),
      makeFrozenBaseline({ version: 2 }),
    ]
    expect(nextBaselineVersion('ASSET-001', baselines)).toBe(3)
  })

  it('ignores baselines from other assets', () => {
    const other = makeBaseline({ asset_id: 'ASSET-OTHER', version: 99 })
    expect(nextBaselineVersion('ASSET-001', [other])).toBe(1)
  })
})

// ─── canFreezeBaseline ────────────────────────────────────────────────────────

describe('canFreezeBaseline', () => {
  it('returns ok=true for a lone draft baseline', () => {
    const result = canFreezeBaseline(makeBaseline(), [makeBaseline()])
    expect(result.ok).toBe(true)
  })

  it('returns ok=false for already-frozen baseline', () => {
    const result = canFreezeBaseline(makeFrozenBaseline(), [makeFrozenBaseline()])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/already frozen/)
  })

  it('returns ok=false when other draft baselines exist for the same asset', () => {
    const draft1 = makeBaseline({ id: 'BL-001' })
    const draft2 = makeBaseline({ id: 'BL-002' })
    const result = canFreezeBaseline(draft1, [draft1, draft2])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/other draft/)
  })

  it('ignores draft baselines from other assets', () => {
    const mine  = makeBaseline({ id: 'BL-001', asset_id: 'ASSET-001' })
    const other = makeBaseline({ id: 'BL-002', asset_id: 'ASSET-OTHER' })
    const result = canFreezeBaseline(mine, [mine, other])
    expect(result.ok).toBe(true)
  })
})

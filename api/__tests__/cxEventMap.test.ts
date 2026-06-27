/**
 * Tests: api/services/integration/cxEventMap.ts (event edge adapter)
 *
 * Pure mapping — no DB. Covers Menlo→canonical→cx normalization (status setters
 * vs count deltas vs audit-only), back-compat passthrough of cx.*, and the
 * outbound canonical→Menlo-inbound translation.
 */
import { describe, it, expect } from 'vitest'
import { toMirrorEvent, toMenloInboundEvent, MENLO_TO_CANONICAL } from '../services/integration/cxEventMap'

describe('toMirrorEvent — inbound normalization', () => {
  it('passes Denver-internal cx.* through unchanged (back-compat with PR-1)', () => {
    expect(toMirrorEvent('cx.phase_changed', { phase: 'in_commissioning' }))
      .toEqual({ event: 'cx.phase_changed', data: { phase: 'in_commissioning' } })
  })

  it('maps Menlo status events to cx setters', () => {
    expect(toMirrorEvent('CommissioningStarted'))
      .toEqual({ event: 'cx.phase_changed', data: { phase: 'in_commissioning' } })
    expect(toMirrorEvent('FATCompleted', { readiness_pct: 100 }))
      .toEqual({ event: 'cx.fat_status_changed', data: { status: 'passed', readiness_pct: 100 } })
    expect(toMirrorEvent('SATScheduled'))
      .toEqual({ event: 'cx.sat_status_changed', data: { status: 'scheduled' } })
    expect(toMirrorEvent('TurnoverReady'))
      .toEqual({ event: 'cx.phase_changed', data: { phase: 'ready_for_turnover' } })
    expect(toMirrorEvent('CommissioningCompleted')).toEqual({ event: 'cx.accepted' })
  })

  it('accepts canonical names directly (publisher already mapped)', () => {
    expect(toMirrorEvent('fat.completed'))
      .toEqual({ event: 'cx.fat_status_changed', data: { status: 'passed', readiness_pct: undefined } })
  })

  it('maps Menlo count events to clamped deltas', () => {
    expect(toMirrorEvent('PunchCreated')).toEqual({ event: 'punch.created', delta: { punch_open: 1 } })
    expect(toMirrorEvent('PunchClosed')).toEqual({ event: 'punch.closed', delta: { punch_open: -1 } })
    expect(toMirrorEvent('DeficiencyCreated')).toEqual({ event: 'deficiency.created', delta: { deficiencies_open: 1 } })
    expect(toMirrorEvent('DeficiencyResolved')).toEqual({ event: 'deficiency.closed', delta: { deficiencies_open: -1 } })
    expect(toMirrorEvent('NCRCreated')).toEqual({ event: 'ncr.created', delta: { ncr_open: 1 } })
    expect(toMirrorEvent('NCRClosed')).toEqual({ event: 'ncr.closed', delta: { ncr_open: -1 } })
  })

  it('returns null for audit-only events (no mirror column)', () => {
    expect(toMirrorEvent('LoopCheckCompleted')).toBeNull()
    expect(toMirrorEvent('EvidenceVerified')).toBeNull()
    expect(toMirrorEvent('WitnessSigned')).toBeNull()
    expect(toMirrorEvent('SomethingUnknown')).toBeNull()
  })
})

describe('toMenloInboundEvent — outbound translation', () => {
  it('maps canonical Denver signals to Menlo inbound names', () => {
    expect(toMenloInboundEvent('project.ready_for_commissioning')).toBe('ProjectReadyForCommissioning')
    expect(toMenloInboundEvent('construction.completed')).toBe('ConstructionCompleted')
    expect(toMenloInboundEvent('system.ready_for_testing')).toBe('SystemReadyForTesting')
  })
  it('passes unmapped names through', () => {
    expect(toMenloInboundEvent('custom.event')).toBe('custom.event')
  })
})

describe('mapping table coverage', () => {
  it('every Menlo→canonical entry is dotted lowercase', () => {
    for (const canonical of Object.values(MENLO_TO_CANONICAL)) {
      expect(canonical).toMatch(/^[a-z_]+(\.[a-z_]+)+$/)
    }
  })
})

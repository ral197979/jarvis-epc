/**
 * Guided workflow flows — config integrity + lookup (v4.36.0)
 * Every flow step must point to a real navigation id, and flowForTab must resolve
 * deterministically.
 */
import { describe, it, expect } from 'vitest'
import { WORKFLOWS, flowForTab } from '../../config/workflows'
import { NAVIGATION_ITEMS } from '../../config/navigation'

const NAV_IDS = new Set(NAVIGATION_ITEMS.map(n => n.id))

describe('WORKFLOWS config integrity', () => {
  it('every step.tab is a real navigation id', () => {
    for (const flow of WORKFLOWS) {
      for (const step of flow.steps) {
        expect(NAV_IDS.has(step.tab), `${flow.id} → ${step.tab}`).toBe(true)
      }
    }
  })

  it('every flow has at least two steps and a label', () => {
    for (const flow of WORKFLOWS) {
      expect(flow.steps.length).toBeGreaterThanOrEqual(2)
      expect(flow.label.length).toBeGreaterThan(0)
    }
  })
})

describe('flowForTab', () => {
  it('resolves a tab to its flow', () => {
    expect(flowForTab('inspections')?.id).toBe('quality')
    expect(flowForTab('subcontracts')?.id).toBe('procurement')
    expect(flowForTab('budget')?.id).toBe('commercial')
  })

  it('returns the first matching flow for a shared tab (deterministic)', () => {
    // 'inspections' is in both quality and construction; quality is declared first.
    expect(flowForTab('inspections')?.id).toBe('quality')
  })

  it('returns undefined for a tab not in any flow', () => {
    expect(flowForTab('focus')).toBeUndefined()
    expect(flowForTab('mywork')).toBeUndefined()
  })
})

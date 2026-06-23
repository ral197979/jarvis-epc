import { describe, it, expect } from 'vitest'
import { statusTone, priorityTone, cellStatusMeta, COMMISSIONING_STAGES } from '../tokens'

describe('statusTone', () => {
  it('maps healthy/complete states to success', () => {
    expect(statusTone('Healthy')).toBe('success')
    expect(statusTone('Complete')).toBe('success')
    expect(statusTone('On Track')).toBe('success')
  })
  it('maps risk states to warning', () => {
    expect(statusTone('At Risk')).toBe('warning')
    expect(statusTone('Delayed')).toBe('warning')
  })
  it('maps failure states to danger', () => {
    expect(statusTone('Critical')).toBe('danger')
    expect(statusTone('Overrun')).toBe('danger')
    expect(statusTone('Open')).toBe('danger')
  })
  it('maps active states to info', () => {
    expect(statusTone('In Progress')).toBe('info')
    expect(statusTone('Testing')).toBe('info')
  })
  it('falls back to neutral for unknown labels', () => {
    expect(statusTone('Some Unknown Label')).toBe('neutral')
  })
})

describe('priorityTone', () => {
  it('maps priority levels', () => {
    expect(priorityTone('Critical')).toBe('danger')
    expect(priorityTone('High')).toBe('warning')
    expect(priorityTone('Medium')).toBe('info')
    expect(priorityTone('Low')).toBe('neutral')
  })
})

describe('commissioning lifecycle', () => {
  it('has 9 ordered stages ending in TURNOVER', () => {
    expect(COMMISSIONING_STAGES).toHaveLength(9)
    expect(COMMISSIONING_STAGES[0]).toBe('DESIGN')
    expect(COMMISSIONING_STAGES.at(-1)).toBe('TURNOVER')
  })
  it('defines presentation for every cell status', () => {
    expect(cellStatusMeta.complete.label).toBe('Complete')
    expect(cellStatusMeta['not-started'].label).toBe('Not Started')
  })
})

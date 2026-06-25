/**
 * Setup Wizard model — validation + payload (v4.37.0)
 */
import { describe, it, expect } from 'vitest'
import { EMPTY_DRAFT, validateDraft, stepValid, buildProjectPayload, type SetupDraft } from '../../components/setup/wizardModel'

function draft(over: Partial<SetupDraft> = {}): SetupDraft {
  return { ...EMPTY_DRAFT, ...over }
}

describe('validateDraft', () => {
  it('requires code and name', () => {
    const v = validateDraft(draft())
    expect(v.ok).toBe(false)
    expect(v.errors.code).toBeTruthy()
    expect(v.errors.name).toBeTruthy()
  })

  it('passes with code + name', () => {
    expect(validateDraft(draft({ code: 'DC-1', name: 'Cactus DC' })).ok).toBe(true)
  })

  it('rejects a negative or non-numeric budget', () => {
    expect(validateDraft(draft({ code: 'a', name: 'b', budget: '-5' })).errors.budget).toBeTruthy()
    expect(validateDraft(draft({ code: 'a', name: 'b', budget: 'abc' })).errors.budget).toBeTruthy()
    expect(validateDraft(draft({ code: 'a', name: 'b', budget: '1000000' })).ok).toBe(true)
  })

  it('rejects a finish date before the start date', () => {
    const v = validateDraft(draft({ code: 'a', name: 'b', planned_start: '2026-06-01', planned_finish: '2026-05-01' }))
    expect(v.errors.planned_finish).toBeTruthy()
  })
})

describe('stepValid', () => {
  it('gates the info step on code + name', () => {
    expect(stepValid('info', draft())).toBe(false)
    expect(stepValid('info', draft({ code: 'a', name: 'b' }))).toBe(true)
  })
  it('gates contract on a valid budget but not on code/name', () => {
    expect(stepValid('contract', draft({ budget: 'oops' }))).toBe(false)
    expect(stepValid('contract', draft({ budget: '5' }))).toBe(true)
  })
})

describe('buildProjectPayload', () => {
  it('always sets planning / feasibility and trims required fields', () => {
    const p = buildProjectPayload(draft({ code: ' DC-1 ', name: ' Cactus ' }))
    expect(p).toMatchObject({ code: 'DC-1', name: 'Cactus', status: 'planning', current_phase: 'feasibility' })
  })

  it('omits empty optionals and coerces budget to a number', () => {
    const p = buildProjectPayload(draft({ code: 'a', name: 'b', budget: '2500000', client_name: '' }))
    expect(p.budget).toBe(2_500_000)
    expect('client_name' in p).toBe(false)
    expect('description' in p).toBe(false)
  })

  it('normalizes country to 2 chars and currency to 3, uppercased', () => {
    const p = buildProjectPayload(draft({ code: 'a', name: 'b', country: 'usa', currency: 'usd' }))
    expect(p.country).toBe('US')
    expect(p.currency).toBe('USD')
  })

  it('passes contract_type and dates through', () => {
    const p = buildProjectPayload(draft({ code: 'a', name: 'b', contract_type: 'epc', planned_start: '2026-06-01', planned_finish: '2027-06-01' }))
    expect(p.contract_type).toBe('epc')
    expect(p.planned_start).toBe('2026-06-01')
    expect(p.planned_finish).toBe('2027-06-01')
  })
})

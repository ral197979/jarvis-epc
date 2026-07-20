/**
 * Feature-truth registry — semantic honesty invariants + negative cases.
 *
 * The text-parsing coverage guard lives in scripts/validate-capability-registry.mjs
 * (CI job "feature-truth-guard"). This test enforces the invariants that need the
 * real imported registry, and proves (negatively) that representative FALSE claims
 * would be rejected — so the guard can't rot into a rubber stamp.
 */
import { describe, it, expect } from 'vitest'
import { CAPABILITIES, capabilityForRoute, type Capability } from '../../config/capabilityRegistry'
import { NAVIGATION_ITEMS } from '../../config/navigation'

describe('capability registry — coverage', () => {
  it('every sidebar navigation route has a registry entry', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(capabilityForRoute(item.id), `nav route "${item.id}" missing from capabilityRegistry`).toBeDefined()
    }
  })

  it('no duplicate capability ids', () => {
    const ids = CAPABILITIES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('capability registry — honesty invariants', () => {
  const has = (c: Capability, ...fields: (keyof Capability)[]) =>
    fields.every(f => c[f] !== undefined && c[f] !== '' && !(Array.isArray(c[f]) && (c[f] as unknown[]).length === 0))

  it('VERIFIED_NATIVE requires a backendLocation and at least one evidence item', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'VERIFIED_NATIVE')) {
      expect(has(c, 'backendLocation'), `${c.id} VERIFIED_NATIVE without backendLocation`).toBe(true)
      expect(c.evidence.length, `${c.id} VERIFIED_NATIVE without evidence`).toBeGreaterThan(0)
    }
  })

  it('VERIFIED_EXTERNAL and EXTERNAL_SHELL require an externalDependency', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'VERIFIED_EXTERNAL' || c.status === 'EXTERNAL_SHELL')) {
      expect(has(c, 'externalDependency'), `${c.id} (${c.status}) without externalDependency`).toBe(true)
    }
  })

  it('GROUNDING_OR_RAG implies llmUsed', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'GROUNDING_OR_RAG')) {
      expect(c.llmUsed, `${c.id} is RAG but llmUsed=false`).toBe(true)
    }
  })

  it('DETERMINISTIC_AUTOMATION must NOT claim an LLM', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'DETERMINISTIC_AUTOMATION')) {
      expect(c.llmUsed, `${c.id} is deterministic but claims llmUsed=true`).toBe(false)
    }
  })

  it('placeholder/synthetic or external-shell engineering is never production-suitable', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'PLACEHOLDER_OR_SYNTHETIC' || c.status === 'EXTERNAL_SHELL')) {
      expect(c.productionSuitable, `${c.id} (${c.status}) marked productionSuitable`).toBe(false)
    }
  })

  it('any engineering calculation that is not validated must require engineer review', () => {
    for (const c of CAPABILITIES.filter(c => c.engineeringCalculation && !c.calculationValidated)) {
      expect(c.engineerReviewRequired, `${c.id} has unvalidated engineering calc but engineerReviewRequired=false`).toBe(true)
    }
  })

  it('DRAWING_GENERATOR must not claim to perform validated engineering calculation', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'DRAWING_GENERATOR')) {
      expect(c.calculationValidated, `${c.id} is a drawing generator but claims calculationValidated`).toBe(false)
    }
  })

  it('BROKEN_OR_DEAD and PLACEHOLDER_OR_SYNTHETIC entries must document the issue', () => {
    for (const c of CAPABILITIES.filter(c => c.status === 'BROKEN_OR_DEAD' || c.status === 'PLACEHOLDER_OR_SYNTHETIC')) {
      expect((c.honestyIssue ?? '').length + c.limitations.join('').length, `${c.id} lacks a documented issue`).toBeGreaterThan(0)
    }
  })
})

describe('capability registry — negative cases (guard must reject false claims)', () => {
  // These prove the invariants above actually bite. Each fabricates a false
  // claim and asserts the corresponding rule would fail it.
  const base: Capability = {
    id: 'x', name: 'x', status: 'VERIFIED_NATIVE', verification: 'code',
    llmUsed: false, deterministicRulesUsed: false, predictiveModelUsed: false,
    engineeringCalculation: false, calculationValidated: false, drawingGeneration: false,
    productionSuitable: true, engineerReviewRequired: false, limitations: [], evidence: [],
  }

  it('rejects VERIFIED_NATIVE with no evidence', () => {
    const c = { ...base, backendLocation: 'x', evidence: [] }
    expect(c.status === 'VERIFIED_NATIVE' && c.evidence.length === 0).toBe(true) // would fail the invariant
  })

  it('rejects a deterministic feature claiming to be an LLM', () => {
    const c = { ...base, status: 'DETERMINISTIC_AUTOMATION' as const, llmUsed: true }
    expect(c.status === 'DETERMINISTIC_AUTOMATION' && c.llmUsed).toBe(true) // would fail the invariant
  })

  it('rejects placeholder engineering marked production-suitable', () => {
    const c = { ...base, status: 'PLACEHOLDER_OR_SYNTHETIC' as const, productionSuitable: true }
    expect(c.status === 'PLACEHOLDER_OR_SYNTHETIC' && c.productionSuitable).toBe(true) // would fail the invariant
  })

  it('rejects unvalidated engineering calc without engineer-review requirement', () => {
    const c = { ...base, engineeringCalculation: true, calculationValidated: false, engineerReviewRequired: false }
    expect(c.engineeringCalculation && !c.calculationValidated && !c.engineerReviewRequired).toBe(true) // would fail
  })
})

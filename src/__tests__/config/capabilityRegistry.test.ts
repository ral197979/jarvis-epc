/**
 * Feature-truth registry — semantic honesty invariants + negative cases.
 *
 * The text-parsing coverage guard lives in scripts/validate-capability-registry.mjs
 * (CI job "feature-truth-guard"). This test enforces the invariants that need the
 * real imported registry.
 *
 * Each invariant is a NAMED PREDICATE returning true when an entry is honest under
 * that rule (and true vacuously when the rule does not apply). The positive tests
 * run every predicate over the real CAPABILITIES; the negative tests assert the
 * SAME predicate REJECTS a fabricated false claim. Because both directions call the
 * one predicate, deleting or weakening a rule breaks the negative test — the block
 * cannot rot into a rubber stamp the way an assert-what-you-just-assigned test can.
 */
import { describe, it, expect } from 'vitest'
import { CAPABILITIES, capabilityForRoute, type Capability } from '../../config/capabilityRegistry'
import { NAVIGATION_ITEMS } from '../../config/navigation'

const present = (v: unknown) =>
  v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)

// ─── Honesty invariants as predicates (true = honest / rule satisfied) ──────────
export const INVARIANTS: Record<string, (c: Capability) => boolean> = {
  verifiedNativeHasEvidence: (c) =>
    c.status !== 'VERIFIED_NATIVE' || (present(c.backendLocation) && c.evidence.length > 0),
  externalStatusHasDependency: (c) =>
    (c.status !== 'VERIFIED_EXTERNAL' && c.status !== 'EXTERNAL_SHELL') || present(c.externalDependency),
  ragImpliesLlm: (c) =>
    c.status !== 'GROUNDING_OR_RAG' || c.llmUsed === true,
  deterministicIsNotLlm: (c) =>
    c.status !== 'DETERMINISTIC_AUTOMATION' || c.llmUsed === false,
  syntheticOrShellNotProduction: (c) =>
    (c.status !== 'PLACEHOLDER_OR_SYNTHETIC' && c.status !== 'EXTERNAL_SHELL') || c.productionSuitable === false,
  unvalidatedCalcNeedsReview: (c) =>
    !(c.engineeringCalculation && !c.calculationValidated) || c.engineerReviewRequired === true,
  drawingGeneratorNotValidatedCalc: (c) =>
    c.status !== 'DRAWING_GENERATOR' || c.calculationValidated === false,
  brokenOrSyntheticIsDocumented: (c) =>
    (c.status !== 'BROKEN_OR_DEAD' && c.status !== 'PLACEHOLDER_OR_SYNTHETIC') ||
    (c.honestyIssue ?? '').length + c.limitations.join('').length > 0,
}

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

describe('capability registry — honesty invariants (real registry)', () => {
  for (const [name, predicate] of Object.entries(INVARIANTS)) {
    it(`every entry satisfies: ${name}`, () => {
      for (const c of CAPABILITIES) {
        expect(predicate(c), `${c.id} violates ${name}`).toBe(true)
      }
    })
  }
})

describe('capability registry — negative cases (the same predicate must REJECT a false claim)', () => {
  // A minimal honest baseline. Each case mutates it into a specific lie and asserts
  // the corresponding predicate returns false. If a rule were deleted (predicate
  // hard-wired to true), the matching assertion here fails — that is the guard on
  // the guard.
  const base: Capability = {
    id: 'x', name: 'x', status: 'UI_ONLY', verification: 'code',
    llmUsed: false, deterministicRulesUsed: false, predictiveModelUsed: false,
    engineeringCalculation: false, calculationValidated: false, drawingGeneration: false,
    productionSuitable: false, engineerReviewRequired: false, limitations: [], evidence: [],
  }
  const reject = (name: keyof typeof INVARIANTS, bad: Partial<Capability>) =>
    expect(INVARIANTS[name]({ ...base, ...bad }), `${name} failed to reject a false claim`).toBe(false)

  it('rejects VERIFIED_NATIVE with no evidence', () =>
    reject('verifiedNativeHasEvidence', { status: 'VERIFIED_NATIVE', backendLocation: 'x', evidence: [] }))

  it('rejects an external-status entry with no externalDependency', () =>
    reject('externalStatusHasDependency', { status: 'EXTERNAL_SHELL', externalDependency: undefined }))

  it('rejects RAG that claims no LLM', () =>
    reject('ragImpliesLlm', { status: 'GROUNDING_OR_RAG', llmUsed: false }))

  it('rejects a deterministic feature claiming to be an LLM', () =>
    reject('deterministicIsNotLlm', { status: 'DETERMINISTIC_AUTOMATION', llmUsed: true }))

  it('rejects placeholder engineering marked production-suitable', () =>
    reject('syntheticOrShellNotProduction', { status: 'PLACEHOLDER_OR_SYNTHETIC', productionSuitable: true }))

  it('rejects unvalidated engineering calc without engineer-review requirement', () =>
    reject('unvalidatedCalcNeedsReview', { engineeringCalculation: true, calculationValidated: false, engineerReviewRequired: false }))

  it('rejects a drawing generator claiming validated calculation', () =>
    reject('drawingGeneratorNotValidatedCalc', { status: 'DRAWING_GENERATOR', calculationValidated: true }))

  it('rejects a BROKEN_OR_DEAD entry with no documented issue', () =>
    reject('brokenOrSyntheticIsDocumented', { status: 'BROKEN_OR_DEAD', honestyIssue: undefined, limitations: [] }))
})

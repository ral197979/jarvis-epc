/**
 * ADR-014 Phase 2 — API authorization coverage guard.
 *
 * Censuses the real route declarations and checks them against the manifest, so
 * a new business endpoint cannot be added without an explicit authorization
 * classification. The pending list is a ratchet: adding endpoints to an
 * unenforced file fails, and the list can only shrink deliberately.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CAPABILITY_PROTECTED, NON_USER_AUTH, PENDING_PHASE2, classificationFor,
} from '../authz/routeManifest'

const ROUTES_DIR = path.join(process.cwd(), 'api', 'routes')

interface FileCensus { file: string; endpoints: number; usesCapability: boolean }

function census(): FileCensus[] {
  return fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('.ts'))
    .sort()
    .map(file => {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
      return {
        file,
        endpoints: [...src.matchAll(/\w+\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'/g)].length,
        usesCapability: /requireCapability|requireAnyCapability/.test(src),
      }
    })
}

describe('ADR-014 Phase 2 — authorization coverage', () => {
  const files = census()
  const withEndpoints = files.filter(f => f.endpoints > 0)

  it('classifies every route file that declares endpoints', () => {
    // This is the guard: a new route file, or an existing one that grows
    // endpoints, must be given a classification before it can ship.
    const unclassified = withEndpoints.filter(f => !classificationFor(f.file)).map(f => f.file)
    expect(unclassified, `unclassified route files: ${unclassified.join(', ')}`).toEqual([])
  })

  it('holds no stale manifest entries', () => {
    const real = new Set(files.map(f => f.file))
    const declared = [
      ...Object.keys(CAPABILITY_PROTECTED),
      ...Object.keys(NON_USER_AUTH),
      ...Object.keys(PENDING_PHASE2),
    ]
    const stale = declared.filter(f => !real.has(f))
    expect(stale, `manifest names files that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('keeps every CAPABILITY-classified file actually enforced', () => {
    for (const file of Object.keys(CAPABILITY_PROTECTED)) {
      const entry = withEndpoints.find(f => f.file === file)
      expect(entry, `${file} is classified CAPABILITY but declares no endpoints`).toBeDefined()
      expect(entry!.usesCapability, `${file} is classified CAPABILITY but calls no capability guard`).toBe(true)
    }
  })

  it('requires a documented reason for every non-pending classification', () => {
    for (const [file, c] of [...Object.entries(CAPABILITY_PROTECTED), ...Object.entries(NON_USER_AUTH)]) {
      expect(c.reason, `${file} needs a reason`).toBeTruthy()
      expect(c.reason!.length, `${file} reason is too thin to review`).toBeGreaterThan(20)
    }
  })

  it('does not let the pending-authorization surface grow', () => {
    // The ratchet. If a pending file gains endpoints the recorded count no
    // longer matches and this fails, forcing a classification decision.
    const drift: string[] = []
    for (const [file, recorded] of Object.entries(PENDING_PHASE2)) {
      const actual = withEndpoints.find(f => f.file === file)?.endpoints ?? 0
      if (actual !== recorded) drift.push(`${file}: recorded ${recorded}, found ${actual}`)
    }
    expect(drift, `pending endpoint counts drifted:\n  ${drift.join('\n  ')}`).toEqual([])
  })

  it('never lists a file as both enforced and pending', () => {
    const both = Object.keys(CAPABILITY_PROTECTED).filter(f => f in PENDING_PHASE2)
    expect(both).toEqual([])
  })

  it('reports the exact coverage position', () => {
    const total    = withEndpoints.reduce((a, f) => a + f.endpoints, 0)
    const enforced = withEndpoints.filter(f => classificationFor(f.file)?.klass === 'CAPABILITY')
                                  .reduce((a, f) => a + f.endpoints, 0)
    const service  = withEndpoints.filter(f => {
      const k = classificationFor(f.file)?.klass
      return k === 'SERVICE_HMAC' || k === 'PUBLIC'
    }).reduce((a, f) => a + f.endpoints, 0)
    const pending  = Object.values(PENDING_PHASE2).reduce((a, n) => a + n, 0)

    // Every endpoint is accounted for in exactly one bucket. This is the
    // arithmetic ADR-014 Phase 2 must eventually close with pending = 0.
    expect(enforced + service + pending).toBe(total)
    expect(pending, 'Phase 2 is complete only when this reaches 0').toBeGreaterThan(0)
  })
})

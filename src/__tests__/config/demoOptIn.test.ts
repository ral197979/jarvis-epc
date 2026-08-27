/**
 * Demonstration data is opt-in, and a fresh session is empty.
 *
 * The app used to boot from the Lusaka WTP / Maputo PM sample: JarvisCore
 * initialised `biz` from DEFAULT_BIZ_STATE and every store-backed view rendered
 * it. Nothing in that path consults a domain API — `biz` is replaced only by a
 * persisted blob or a user's backup — so a new user was shown a $425,000
 * contract, $63,750 of invoices and two open incidents as if they were theirs.
 *
 * An empty screen understates and is obviously empty. A populated sample
 * overstates and is indistinguishable from real operations. So the sample is
 * preserved for demos and tests, and it now loads only when asked for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_BIZ_STATE, EMPTY_BIZ_STATE, getInitialBizState, getDefaultState,
  isDemoSeed, isDemoRequested, DEMO_SEED_MARKER, DEMO_OPT_IN_KEY,
} from '../../config/defaultState'

/** Drive the URL the way the app sees it, without navigating jsdom. */
function atUrl(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  atUrl('')
})
afterEach(() => { window.localStorage.clear() })

// ─── 1. Fresh sessions are empty ─────────────────────────────────────────────

describe('a fresh session starts empty', () => {
  it('boots the empty state, not the sample', () => {
    expect(getInitialBizState()).toBe(EMPTY_BIZ_STATE)
    expect(isDemoSeed(getInitialBizState())).toBe(false)
  })

  it('holds no rows in any collection', () => {
    const populated = Object.entries(EMPTY_BIZ_STATE as unknown as Record<string, unknown>)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([k]) => k)
    expect(populated).toEqual([])
  })

  it('carries no Lusaka figures anywhere in it', () => {
    // The blunt check: none of the sample's identifying values survive.
    const serialised = JSON.stringify(EMPTY_BIZ_STATE)
    for (const trace of ['Lusaka', 'Maputo', 'US DOS', '425000', 'C-001', 'LEAD-001']) {
      expect(serialised, `empty state must not contain ${trace}`).not.toContain(trace)
    }
  })
})

// ─── 2. The empty state cannot drift from the sample's shape ─────────────────

describe('the empty state matches the sample shape', () => {
  it('has exactly the sample keys, minus the marker', () => {
    // A hand-written twin would drift the first time a collection was added to
    // one and not the other, and the failure lands as `undefined.length` inside
    // a view. Derivation is what makes that impossible.
    const empty  = Object.keys(EMPTY_BIZ_STATE).sort()
    const sample = Object.keys(DEFAULT_BIZ_STATE).filter(k => k !== DEMO_SEED_MARKER).sort()
    expect(empty).toEqual(sample)
  })

  it('keeps every array field an array, so views can read .length', () => {
    for (const [key, value] of Object.entries(DEFAULT_BIZ_STATE as unknown as Record<string, unknown>)) {
      if (key === DEMO_SEED_MARKER) continue
      if (Array.isArray(value)) {
        expect(Array.isArray((EMPTY_BIZ_STATE as unknown as Record<string, unknown>)[key]),
          `${key} must still be an array`).toBe(true)
      }
    }
  })

  it('resets the company rather than carrying the sample identity', () => {
    expect((EMPTY_BIZ_STATE as unknown as { company: unknown }).company).toEqual({ name: '', type: '' })
  })
})

// ─── 3. Opt-in, and only opt-in, loads the sample ────────────────────────────

describe('the sample loads only when asked for', () => {
  it('does not load it by default', () => {
    expect(isDemoRequested()).toBe(false)
  })

  it('loads it for ?demo=1', () => {
    atUrl('?demo=1')
    expect(isDemoRequested()).toBe(true)
    expect(getInitialBizState()).toBe(DEFAULT_BIZ_STATE)
    expect(isDemoSeed(getInitialBizState())).toBe(true)
  })

  it('accepts ?demo=true as well', () => {
    atUrl('?demo=true')
    expect(isDemoRequested()).toBe(true)
  })

  it('remembers the opt-in across navigations', () => {
    atUrl('?demo=1')
    expect(isDemoRequested()).toBe(true)
    atUrl('')                       // navigated on; no param any more
    expect(isDemoRequested()).toBe(true)
    expect(window.localStorage.getItem(DEMO_OPT_IN_KEY)).toBe('1')
  })

  it('turns it off again for ?demo=0, and forgets', () => {
    atUrl('?demo=1')
    expect(isDemoRequested()).toBe(true)
    atUrl('?demo=0')
    expect(isDemoRequested()).toBe(false)
    atUrl('')
    expect(isDemoRequested()).toBe(false)
    expect(window.localStorage.getItem(DEMO_OPT_IN_KEY)).toBeNull()
  })

  it('ignores a value that is not an opt-in', () => {
    atUrl('?demo=maybe')
    expect(isDemoRequested()).toBe(false)
    atUrl('?other=1')
    expect(isDemoRequested()).toBe(false)
  })

  it('stays empty when localStorage is unavailable rather than throwing', () => {
    // Private browsing and locked-down embedders both do this. Failing closed
    // here means an empty app, never a crash on boot.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      expect(isDemoRequested()).toBe(false)
      expect(getInitialBizState()).toBe(EMPTY_BIZ_STATE)
    } finally { spy.mockRestore() }
  })
})

// ─── 4. The sample itself is preserved ───────────────────────────────────────

describe('the demonstration dataset is preserved intact', () => {
  it('still holds the sample project', () => {
    const contracts = (DEFAULT_BIZ_STATE as unknown as { contracts: Record<string, unknown>[] }).contracts
    expect(contracts.length).toBeGreaterThan(0)
    expect(JSON.stringify(contracts)).toContain('Lusaka WTP')
  })

  it('is still reachable for tenant-specific demos through getDefaultState', () => {
    const custom = getDefaultState({ company: { name: 'Acme', type: 'EPC' } })
    expect(custom.company).toEqual({ name: 'Acme', type: 'EPC' })
    expect(isDemoSeed(custom)).toBe(true)   // an override is still a demo
  })

  it('stays marked through a persist/restore round trip', () => {
    // JarvisCore persists with io.set('bizState', d) and restores with io.get.
    // If the marker did not survive that, restored sample data would look real.
    const restored = JSON.parse(JSON.stringify(DEFAULT_BIZ_STATE)) as unknown
    expect(isDemoSeed(restored)).toBe(true)
  })
})

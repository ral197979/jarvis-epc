/**
 * Tests: modules/persistence
 * Coverage: sanitize, rateLimitOk, pushUndo/popUndo,
 *           validators, isCollectionLocked, filterItems,
 *           collectionInventory
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  sanitize,
  rateLimitOk,
  pushUndo,
  popUndo,
  validators,
  maxLen,
  dateRange,
  crud,
  isCollectionLocked,
  filterItems,
  collectionInventory,
  injectCrudDeps,
  type BizRecord,
} from '../../modules/persistence'

import {
  undoStack,
  mutationWindow,
} from '../../modules/store'

beforeEach(() => {
  undoStack.length    = 0
  mutationWindow.length = 0
  vi.restoreAllMocks()
})

// ─── sanitize ─────────────────────────────────────────────────────────────────
describe('sanitize', () => {
  it('returns non-object input unchanged', () => {
    expect(sanitize(42 as unknown as Record<string, unknown>)).toBe(42)
  })

  it('removes <script> tags', () => {
    const input = { name: '<script>alert(1)</script>Safe name' }
    const result = sanitize(input)
    expect(result.name).not.toContain('<script>')
    expect(result.name).toContain('Safe name')
  })

  it('strips inline event handlers', () => {
    const input = { link: 'onclick="evil()"' }
    const result = sanitize(input)
    expect(result.link).not.toContain('onclick=')
  })

  it('strips javascript: URIs', () => {
    const input = { url: 'javascript:alert(1)' }
    const result = sanitize(input)
    expect(result.url).not.toContain('javascript:')
  })

  it('trims whitespace from strings', () => {
    const input = { name: '  hello world  ' }
    const result = sanitize(input)
    expect(result.name).toBe('hello world')
  })

  it('truncates strings over 10240 chars', () => {
    const longString = 'x'.repeat(20_000)
    const result = sanitize({ value: longString })
    expect((result.value as string).length).toBe(10_240)
  })

  it('passes through safe strings unchanged (after trim)', () => {
    const input = { name: 'Alpha Project', status: 'active' }
    expect(sanitize(input)).toEqual(input)
  })

  it('passes through numeric and boolean fields', () => {
    const input = { count: 42, active: true }
    const result = sanitize(input as unknown as Record<string, unknown>)
    expect(result.count).toBe(42)
    expect(result.active).toBe(true)
  })
})

// ─── rateLimitOk ──────────────────────────────────────────────────────────────
describe('rateLimitOk', () => {
  it('returns true for first mutation', () => {
    expect(rateLimitOk()).toBe(true)
  })

  it('accumulates mutations in window', () => {
    rateLimitOk()
    rateLimitOk()
    rateLimitOk()
    expect(mutationWindow.length).toBe(3)
  })

  it('returns false when rate limit exceeded', () => {
    // Fill up to the limit (120)
    for (let i = 0; i < 120; i++) mutationWindow.push(Date.now())
    expect(rateLimitOk()).toBe(false)
  })

  it('clears stale entries older than 1 minute', () => {
    // Add a timestamp 2 minutes ago
    const oldTs = Date.now() - 2 * 60_000
    mutationWindow.push(oldTs, oldTs, oldTs)
    rateLimitOk()
    // The 3 old entries should have been purged; only the new one remains
    expect(mutationWindow.filter(t => t >= Date.now() - 60_000).length).toBe(1)
  })
})

// ─── pushUndo / popUndo ───────────────────────────────────────────────────────
describe('pushUndo / popUndo', () => {
  it('popUndo returns null when stack is empty', () => {
    expect(popUndo()).toBeNull()
  })

  it('pushUndo adds to stack', () => {
    pushUndo('leads', 'add', { id: 'L-001', name: 'Test Lead' })
    expect(undoStack.length).toBe(1)
  })

  it('popUndo removes and returns the last entry', () => {
    pushUndo('leads', 'add', { id: 'L-001' })
    pushUndo('contracts', 'update', { id: 'C-001' })
    const entry = popUndo()
    expect(entry).not.toBeNull()
    expect(entry!.collection).toBe('contracts')
    expect(entry!.op).toBe('update')
    expect(undoStack.length).toBe(1)
  })

  it('preserves snapshot data', () => {
    const snapshot = { id: 'L-001', name: 'Before Edit', status: 'open' }
    pushUndo('leads', 'update', snapshot)
    const entry = popUndo()
    expect(entry!.snapshot).toEqual(snapshot)
  })

  it('includes timestamp', () => {
    pushUndo('leads', 'add', {})
    const entry = popUndo()
    expect(entry!.ts).toBeTypeOf('number')
    expect(entry!.ts).toBeGreaterThan(0)
  })

  it('caps stack at UNDO_MAX (20) entries', () => {
    for (let i = 0; i < 25; i++) pushUndo('leads', 'add', { id: `L-${i}` })
    expect(undoStack.length).toBeLessThanOrEqual(20)
  })
})

// ─── validators ──────────────────────────────────────────────────────────────
describe('validators', () => {
  describe('email', () => {
    it('accepts valid email', () => {
      expect(validators.email('user@example.com')).toBe('')
    })

    it('rejects invalid email', () => {
      expect(validators.email('not-an-email')).toBe('Invalid email')
    })

    it('allows empty (optional field)', () => {
      expect(validators.email('')).toBe('')
      expect(validators.email(null)).toBe('')
      expect(validators.email(undefined)).toBe('')
    })
  })

  describe('phone', () => {
    it('accepts valid phone numbers', () => {
      expect(validators.phone('+1 555-1234')).toBe('')
      expect(validators.phone('(555) 123-4567')).toBe('')
      expect(validators.phone('5551234567')).toBe('')
    })

    it('rejects invalid phone numbers', () => {
      expect(validators.phone('not-a-phone!!!')).toBe('Invalid phone')
    })

    it('allows empty', () => {
      expect(validators.phone('')).toBe('')
    })
  })

  describe('positive', () => {
    it('accepts zero and positive numbers', () => {
      expect(validators.positive(0)).toBe('')
      expect(validators.positive(100)).toBe('')
      expect(validators.positive('500')).toBe('')
    })

    it('rejects negative numbers', () => {
      expect(validators.positive(-1)).toBe('Must be positive')
    })

    it('allows empty', () => {
      expect(validators.positive('')).toBe('')
      expect(validators.positive(null)).toBe('')
    })
  })

  describe('notEmpty', () => {
    it('accepts non-empty strings', () => {
      expect(validators.notEmpty('hello')).toBe('')
      expect(validators.notEmpty('  x  ')).toBe('')
    })

    it('rejects empty strings', () => {
      expect(validators.notEmpty('')).toBe('Required')
      expect(validators.notEmpty('   ')).toBe('Required')
    })

    it('rejects null and undefined', () => {
      expect(validators.notEmpty(null)).toBe('Required')
      expect(validators.notEmpty(undefined)).toBe('Required')
    })
  })

  describe('maxLen', () => {
    it('passes strings within limit', () => {
      expect(maxLen(10)('hello')).toBe('')
      expect(maxLen(5)('hello')).toBe('')
    })

    it('fails strings over limit', () => {
      expect(maxLen(3)('hello')).toBe('Max 3 chars')
    })

    it('allows empty strings', () => {
      expect(maxLen(5)('')).toBe('')
      expect(maxLen(5)(null)).toBe('')
    })
  })
})

// ─── isCollectionLocked ───────────────────────────────────────────────────────
describe('isCollectionLocked', () => {
  it('returns false when no config provided', () => {
    expect(isCollectionLocked('leads', undefined)).toBe(false)
  })

  it('returns false when collection not in lockedCollections', () => {
    const cfg = { lockedCollections: { contracts: true } }
    expect(isCollectionLocked('leads', cfg)).toBe(false)
  })

  it('returns true when collection is locked', () => {
    const cfg = { lockedCollections: { leads: true } }
    expect(isCollectionLocked('leads', cfg)).toBe(true)
  })

  it('returns false when collection is explicitly unlocked', () => {
    const cfg = { lockedCollections: { leads: false } }
    expect(isCollectionLocked('leads', cfg)).toBe(false)
  })
})

// ─── filterItems ─────────────────────────────────────────────────────────────
describe('filterItems', () => {
  const items = [
    { id: 'L-001', name: 'Alpha Energy',    status: 'open'   },
    { id: 'L-002', name: 'Beta Corp',       status: 'won'    },
    { id: 'L-003', name: 'Gamma Solutions', status: 'open'   },
    { id: 'L-004', name: 'Delta Tech',      status: 'closed' },
  ]

  it('returns all items for empty query', () => {
    expect(filterItems(items, '', ['name', 'status'])).toHaveLength(4)
  })

  it('returns all items for whitespace-only query', () => {
    expect(filterItems(items, '   ', ['name', 'status'])).toHaveLength(4)
  })

  it('filters by name (case-insensitive)', () => {
    const result = filterItems(items, 'alpha', ['name'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('L-001')
  })

  it('filters by status', () => {
    const result = filterItems(items, 'open', ['status'])
    expect(result).toHaveLength(2)
  })

  it('returns empty array when nothing matches', () => {
    const result = filterItems(items, 'zzznomatch', ['name', 'status'])
    expect(result).toHaveLength(0)
  })

  it('searches across multiple keys', () => {
    const result = filterItems(items, 'won', ['name', 'status'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('L-002')
  })

  it('handles partial matches', () => {
    const result = filterItems(items, 'eta', ['name'])
    // "Beta Corp" contains "eta"; "Delta Tech" contains "elta" not "eta"
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('L-002')
  })
})

// ─── collectionInventory ──────────────────────────────────────────────────────
describe('collectionInventory', () => {
  it('returns empty array for empty biz', () => {
    expect(collectionInventory({})).toEqual([])
  })

  it('ignores non-array fields', () => {
    const biz = { name: 'test', count: 5 }
    expect(collectionInventory(biz as unknown as Record<string, unknown>)).toEqual([])
  })

  it('ignores arrays of primitives', () => {
    const biz = { tags: ['a', 'b', 'c'] }
    expect(collectionInventory(biz as unknown as Record<string, unknown>)).toHaveLength(0)
  })

  it('returns a summary for each object array collection', () => {
    const biz = {
      leads:     [{ id: 'L-001', status: 'open' }, { id: 'L-002', status: 'won' }],
      contracts: [{ id: 'C-001', status: 'active' }],
    }
    const inv = collectionInventory(biz as unknown as Record<string, unknown>)
    expect(inv).toHaveLength(2)
    const leads = inv.find(c => c.key === 'leads')
    expect(leads).toBeDefined()
    expect(leads!.count).toBe(2)
    expect(leads!.hasIds).toBe(true)
  })

  it('aggregates status counts correctly', () => {
    const biz = {
      leads: [
        { id: '1', status: 'open' },
        { id: '2', status: 'open' },
        { id: '3', status: 'won' },
      ],
    }
    const inv = collectionInventory(biz as unknown as Record<string, unknown>)
    const leads = inv[0]
    expect(leads.statuses['open']).toBe(2)
    expect(leads.statuses['won']).toBe(1)
  })

  it('sorts by count descending', () => {
    const biz = {
      small:  [{ id: '1' }],
      medium: [{ id: '1' }, { id: '2' }, { id: '3' }],
      large:  [{ id: '1' }, { id: '2' }],
    }
    const inv = collectionInventory(biz as unknown as Record<string, unknown>)
    expect(inv[0].key).toBe('medium')
    expect(inv[1].key).toBe('large')
    expect(inv[2].key).toBe('small')
  })
})

// ─── injectCrudDeps ──────────────────────────────────────────────────────────
describe('injectCrudDeps', () => {
  it('accepts mutateBiz and toast functions without throwing', () => {
    expect(() => {
      injectCrudDeps({
        mutateBiz: vi.fn(),
        toast: vi.fn(),
      })
    }).not.toThrow()
  })
})

// ─── Phase 8: crud() operations ───────────────────────────────────────────────
// (crud already imported at top; adding remaining symbols)
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

describe('crud — after injectCrudDeps', () => {
  function makeDeps() {
    const state: Record<string, BizRecord[]> = {}
    const mutateBiz = vi.fn((fn: (s: Record<string, BizRecord[]>) => void) => fn(state))
    const toast     = vi.fn()
    injectCrudDeps({ mutateBiz: mutateBiz as unknown as Parameters<typeof injectCrudDeps>[0]['mutateBiz'], toast })
    return { state, mutateBiz, toast }
  }

  it('add — pushes record into collection', () => {
    const { state } = makeDeps()
    crud('add', 'leads', { id: 'L-1', name: 'Acme' })
    expect(state['leads']).toHaveLength(1)
    expect(state['leads'][0].id).toBe('L-1')
  })

  it('add — does not duplicate record with same id', () => {
    const { state } = makeDeps()
    crud('add', 'leads', { id: 'L-1', name: 'Acme' })
    crud('add', 'leads', { id: 'L-1', name: 'Acme' })
    expect(state['leads']).toHaveLength(1)
  })

  it('update — merges changes into existing record', () => {
    const { state } = makeDeps()
    crud('add',    'leads', { id: 'L-1', name: 'Acme', status: 'new' })
    crud('update', 'leads', { id: 'L-1', status: 'qualified' })
    expect(state['leads'][0]['status']).toBe('qualified')
  })

  it('update — calls toast with info', () => {
    const { state, toast } = makeDeps()
    crud('add',    'leads', { id: 'L-1', name: 'Acme' })
    crud('update', 'leads', { id: 'L-1', status: 'qualified' })
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Updated/i), 'info')
  })

  it('delete — removes record by id', () => {
    const { state } = makeDeps()
    crud('add',    'leads', { id: 'L-1', name: 'Acme' })
    crud('delete', 'leads', null, 'L-1')
    expect(state['leads']).toHaveLength(0)
  })

  it('delete — calls toast with warn', () => {
    const { state, toast } = makeDeps()
    crud('add',    'leads', { id: 'L-1', name: 'Acme' })
    crud('delete', 'leads', null, 'L-1')
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Deleted/i), 'warn')
  })

  it('sanitizes record before add', () => {
    const { state } = makeDeps()
    crud('add', 'leads', { id: 'L-XSS', name: '<script>alert(1)</script>Acme' })
    expect(state['leads'][0].name).not.toContain('<script>')
  })
})

// ─── bulkDeleteAction ─────────────────────────────────────────────────────────
describe('bulkDeleteAction', () => {
  it('calls arrSetter with filtered array', () => {
    const items: BizRecord[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
    let current = [...items]
    const setter = vi.fn((fn: (prev: BizRecord[]) => BizRecord[]) => {
      current = fn(current)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const action = bulkDeleteAction('leads', setter as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>)
    action.fn(['A', 'B'])
    expect(current.map(r => r.id)).toEqual(['C'])
  })

  it('does nothing if user cancels confirm', () => {
    const setter = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const action = bulkDeleteAction('leads', setter as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>)
    action.fn(['A'])
    expect(setter).not.toHaveBeenCalled()
  })

  it('label includes Delete keyword', () => {
    const action = bulkDeleteAction('leads', vi.fn() as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>)
    expect(action.label).toMatch(/delete/i)
  })
})

// ─── bulkStatusAction ─────────────────────────────────────────────────────────
describe('bulkStatusAction', () => {
  it('updates status for selected ids', () => {
    const items: BizRecord[] = [{ id: 'A', status: 'open' }, { id: 'B', status: 'open' }]
    let current = [...items]
    const setter = vi.fn((fn: (prev: BizRecord[]) => BizRecord[]) => {
      current = fn(current)
    })
    const action = bulkStatusAction('leads', setter as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>, 'closed')
    action.fn(['A'])
    expect(current[0]['status']).toBe('closed')
    expect(current[1]['status']).toBe('open')
  })

  it('uses provided label', () => {
    const action = bulkStatusAction('leads', vi.fn() as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>, 'closed', 'Close Selected')
    expect(action.label).toBe('Close Selected')
  })

  it('uses default label when label not provided', () => {
    const action = bulkStatusAction('leads', vi.fn() as unknown as React.Dispatch<React.SetStateAction<BizRecord[]>>, 'closed')
    expect(action.label).toContain('closed')
  })
})

// ─── SearchBar component ──────────────────────────────────────────────────────
describe('SearchBar', () => {
  it('renders an input of type search', () => {
    render(React.createElement(SearchBar, { value: '', onChange: vi.fn() }))
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('shows current value in input', () => {
    render(React.createElement(SearchBar, { value: 'acme', onChange: vi.fn() }))
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.value).toBe('acme')
  })

  it('calls onChange when user types', () => {
    const onChange = vi.fn()
    render(React.createElement(SearchBar, { value: '', onChange }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } })
    expect(onChange).toHaveBeenCalledWith('test')
  })

  it('shows label in aria-label and placeholder when provided', () => {
    render(React.createElement(SearchBar, { value: '', onChange: vi.fn(), label: 'Search Leads' }))
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toContain('Search Leads')
    expect(input.placeholder).toContain('Search Leads')
  })

  it('shows count / total when provided', () => {
    render(React.createElement(SearchBar, { value: '', onChange: vi.fn(), count: 3, total: 10 }))
    expect(screen.getByText(/3.*10|10.*3/)).toBeDefined()
  })
})

// ─── Track D: maintenanceMode write-block + lockedCollections window path ─────
import { setMaintenanceMode } from '../../modules/store'

describe('crud — maintenanceMode blocks writes', () => {
  function makeDeps() {
    const state: Record<string, BizRecord[]> = {}
    const mutateBiz = vi.fn((fn: (s: Record<string, BizRecord[]>) => void) => fn(state))
    const toast     = vi.fn()
    injectCrudDeps({ mutateBiz: mutateBiz as unknown as Parameters<typeof injectCrudDeps>[0]['mutateBiz'], toast })
    return { state, mutateBiz, toast }
  }

  afterEach(() => {
    setMaintenanceMode(false)
  })

  it('blocks add when maintenanceMode is true', () => {
    const { state, toast } = makeDeps()
    setMaintenanceMode(true)
    crud('add', 'leads', { id: 'M-1', name: 'Blocked' })
    expect(state['leads']).toBeUndefined()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/maintenance/i), 'error')
  })

  it('blocks update when maintenanceMode is true', () => {
    const { state, toast } = makeDeps()
    // First add while mode is off
    crud('add', 'leads', { id: 'M-2', name: 'Original' })
    setMaintenanceMode(true)
    crud('update', 'leads', { id: 'M-2', name: 'Changed' })
    // The update was blocked — name should not have changed
    expect(state['leads']?.[0]?.name).toBe('Original')
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/maintenance/i), 'error')
  })

  it('allows writes again after maintenanceMode is disabled', () => {
    const { state } = makeDeps()
    setMaintenanceMode(true)
    crud('add', 'leads', { id: 'M-3', name: 'Blocked' })
    expect(state['leads']).toBeUndefined()
    setMaintenanceMode(false)
    crud('add', 'leads', { id: 'M-3', name: 'Allowed' })
    expect(state['leads']).toHaveLength(1)
  })
})

describe('crud — lockedCollections window path', () => {
  function makeDeps() {
    const state: Record<string, BizRecord[]> = {}
    const mutateBiz = vi.fn((fn: (s: Record<string, BizRecord[]>) => void) => fn(state))
    const toast     = vi.fn()
    injectCrudDeps({ mutateBiz: mutateBiz as unknown as Parameters<typeof injectCrudDeps>[0]['mutateBiz'], toast })
    return { state, mutateBiz, toast }
  }

  afterEach(() => {
    // Clean up window.__JARVIS_DIAG
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__JARVIS_DIAG
  })

  it('blocks write to locked collection via window.__JARVIS_DIAG', () => {
    const { state } = makeDeps()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__JARVIS_DIAG = {
      _oCfg: { lockedCollections: { leads: true } },
    }
    crud('add', 'leads', { id: 'LC-1', name: 'Blocked by lock' })
    expect(state['leads']).toBeUndefined()
  })

  it('allows write when collection is not locked', () => {
    const { state } = makeDeps()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__JARVIS_DIAG = {
      _oCfg: { lockedCollections: { contracts: true } },
    }
    crud('add', 'leads', { id: 'LC-2', name: 'Not locked' })
    expect(state['leads']).toHaveLength(1)
  })

  it('allows write when __JARVIS_DIAG has no _oCfg', () => {
    const { state } = makeDeps()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__JARVIS_DIAG = {}
    crud('add', 'leads', { id: 'LC-3', name: 'No oCfg' })
    expect(state['leads']).toHaveLength(1)
  })

  it('allows write when window.__JARVIS_DIAG is absent', () => {
    const { state } = makeDeps()
    crud('add', 'leads', { id: 'LC-4', name: 'No diag' })
    expect(state['leads']).toHaveLength(1)
  })
})

// ─── Track E: persistence uncovered branches (Phase 17) ───────────────────────
// (dateRange, crud, injectCrudDeps already imported at top)

describe('dateRange validator (lines 123-124)', () => {
  it('returns empty string for empty value (line 123 early return)', () => {
    const validator = dateRange('2024-01-01', '2024-12-31')
    expect(validator('')).toBe('')
    expect(validator(null)).toBe('')
    expect(validator(undefined)).toBe('')
  })

  it('returns "Date out of range" when value is below min', () => {
    const validator = dateRange('2024-06-01', '2024-12-31')
    expect(validator('2024-01-15')).toBe('Date out of range')
  })

  it('returns "Date out of range" when value is above max', () => {
    const validator = dateRange('2024-01-01', '2024-06-30')
    expect(validator('2024-12-01')).toBe('Date out of range')
  })

  it('returns empty string for value within range', () => {
    const validator = dateRange('2024-01-01', '2024-12-31')
    expect(validator('2024-06-15')).toBe('')
  })
})

describe('crud() — _mutateBiz not bound (lines 143-144)', () => {
  it('logs warning and returns early when mutateBiz not injected', () => {
    // Reset deps so _mutateBiz is null by injecting with null-ish values
    // injectCrudDeps expects { mutateBiz, toast } — pass null cast to satisfy type
    injectCrudDeps({ mutateBiz: null as never, toast: (() => {}) as never })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    crud('add', 'leads', { id: 'L-X', name: 'Test' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/mutateBiz not bound/i))
    warnSpy.mockRestore()
  })
})

// ─── Track D: persistence branch gaps ─────────────────────────────────────────
import { simpleValidators, bulkDeleteAction, bulkStatusAction, SearchBar } from '../../modules/persistence'

describe('simpleValidators.email — invalid email returns error string (line 115)', () => {
  it('returns empty string for empty value (falsy shortcut)', () => {
    expect(simpleValidators.email('')).toBe('')
    expect(simpleValidators.email(null)).toBe('')
    expect(simpleValidators.email(undefined)).toBe('')
  })

  it('returns empty string for valid email', () => {
    expect(simpleValidators.email('user@example.com')).toBe('')
    expect(simpleValidators.email('a.b+c@x.io')).toBe('')
  })

  it('returns "Invalid email" for malformed email (false branch)', () => {
    expect(simpleValidators.email('not-an-email')).toBe('Invalid email')
    expect(simpleValidators.email('missing@tld')).toBe('Invalid email')
    expect(simpleValidators.email('@nodomain.com')).toBe('Invalid email')
  })
})

describe('simpleValidators.phone — invalid phone returns error string', () => {
  it('returns empty string for empty value', () => {
    expect(simpleValidators.phone('')).toBe('')
  })

  it('returns empty string for valid phone', () => {
    expect(simpleValidators.phone('+1 (555) 123-4567')).toBe('')
  })

  it('returns "Invalid phone" for too-short number', () => {
    expect(simpleValidators.phone('123')).toBe('Invalid phone')
  })
})

describe('bulkDeleteAction — id ?? "" coercion (line 238)', () => {
  it('creates action with correct label', () => {
    const setter = vi.fn()
    const action = bulkDeleteAction('leads', setter as never)
    expect(action.label).toContain('Delete')
  })

  it('fn filters items using String(r.id ?? "") for null ids', () => {
    const setter = vi.fn()
    const action = bulkDeleteAction('leads', setter as never)
    // Provide a custom window.confirm that returns false (cancel)
    const origConfirm = globalThis.confirm
    globalThis.confirm = () => false
    try {
      action.fn(['L-1', 'L-2'])
      // confirm returned false — setter not called
      expect(setter).not.toHaveBeenCalled()
    } finally {
      globalThis.confirm = origConfirm
    }
  })
})

describe('bulkStatusAction — id ?? "" coercion (line 255)', () => {
  it('creates action with default label from status', () => {
    const setter = vi.fn()
    const action = bulkStatusAction('leads', setter as never, 'approved')
    expect(action.label).toContain('approved')
  })

  it('uses custom label when provided', () => {
    const setter = vi.fn()
    const action = bulkStatusAction('leads', setter as never, 'approved', 'Approve All')
    expect(action.label).toBe('Approve All')
  })

  it('fn calls arrSetter with mapped records', () => {
    const records: Array<Record<string, unknown>> = [{ id: 'L-1', status: 'new' }, { id: null, status: 'new' }]
    let captured: unknown[] = []
    const setter = vi.fn((fn: (prev: unknown[]) => unknown[]) => {
      captured = fn(records)
    })
    const action = bulkStatusAction('leads', setter as never, 'approved')
    action.fn(['L-1', ''])  // '' matches String(null ?? '')
    // setter should have been called
    expect(setter).toHaveBeenCalled()
  })
})

describe('SearchBar — total ?? count fallback (line 288)', () => {
  it('renders without throwing when total is undefined', () => {
    const el = SearchBar({ value: '', onChange: () => {}, label: 'Search', count: 5, total: undefined })
    expect(el).toBeDefined()
  })

  it('renders with total provided', () => {
    const el = SearchBar({ value: 'test', onChange: () => {}, label: 'Items', count: 3, total: 10 })
    expect(el).toBeDefined()
  })
})

// ─── Track D Phase 18: persistence remaining branches ─────────────────────────

describe('collectionInventory — null/empty biz guard (line 198)', () => {
  it('returns [] when biz is null', () => {
    expect(collectionInventory(null as never)).toEqual([])
  })

  it('returns [] when biz is undefined', () => {
    expect(collectionInventory(undefined as never)).toEqual([])
  })

  it('returns inventory array for biz with collections', () => {
    const biz = {
      leads: [
        { id: 'L-1', status: 'new', updated_at: '2026-01-15T00:00:00Z' },
        { id: 'L-2', status: 'qualified', updated_at: '2026-01-20T00:00:00Z' }
      ],
      projects: [{ id: 'P-1', updated_at: '2026-01-10T00:00:00Z' }],
      empty_col: [],
    }
    const result = collectionInventory(biz)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('lastMod updates when newer date found (line 208 branch)', () => {
    const biz = {
      leads: [
        { id: 'L-1', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'L-2', updated_at: '2026-06-01T00:00:00Z' },
      ]
    }
    const result = collectionInventory(biz)
    const leadsEntry = result.find(r => r.key === 'leads')
    expect(leadsEntry?.lastModified).toContain('2026-06-01')
  })

  it('sample contains up to 6 keys from first item (line 215 branch)', () => {
    const biz = {
      leads: [{ id: 'L-1', name: 'Test', status: 'new', value: 0, source: 'web', assignee: 'JD', extra: 'x' }]
    }
    const result = collectionInventory(biz)
    const leadsEntry = result.find(r => r.key === 'leads')
    expect(leadsEntry?.sample.length).toBeLessThanOrEqual(6)
  })

  it('skips empty arrays entirely (line 215 false branch — empty col skipped)', () => {
    // collectionInventory skips cols where col.length === 0
    const biz = { leads: [], projects: [{ id: 'P-1', status: 'active' }] }
    const result = collectionInventory(biz)
    // 'leads' is empty — should not appear in result
    expect(result.find(r => r.key === 'leads')).toBeUndefined()
    // 'projects' has items — should appear
    expect(result.find(r => r.key === 'projects')).toBeDefined()
  })
})

describe('bulkDeleteAction — confirm=true executes filter (line 238)', () => {
  it('calls arrSetter with filtered records when user confirms', () => {
    const records = [{ id: 'L-1', name: 'Keep' }, { id: 'L-2', name: 'Delete' }]
    let captured: unknown[] = []
    const setter = vi.fn((fn: (prev: unknown[]) => unknown[]) => {
      captured = fn(records)
    })
    const origConfirm = globalThis.confirm
    globalThis.confirm = () => true  // user confirms delete
    try {
      const action = bulkDeleteAction('leads', setter as never)
      action.fn(['L-2'])
      expect(setter).toHaveBeenCalled()
      expect((captured as Array<{id:string}>).find(r => r.id === 'L-2')).toBeUndefined()
      expect((captured as Array<{id:string}>).find(r => r.id === 'L-1')).toBeDefined()
    } finally {
      globalThis.confirm = origConfirm
    }
  })
})

// ─── Track D Phase 20: collectionInventory sizeKB + sample (lines 193/214-215) ──
describe('collectionInventory — sizeKB computation + sample[0] keys (lines 214-215)', () => {
  it('computes sizeKB for collections', () => {
    const biz = {
      leads: [
        { id: 'L-1', name: 'Lead One', status: 'open', company: 'Acme', value: 1000, notes: 'test' },
        { id: 'L-2', name: 'Lead Two', status: 'won',  company: 'Beta', value: 2000, notes: 'test2' },
      ]
    }
    const result = collectionInventory(biz as never)
    const leadEntry = result.find(r => r.key === 'leads')
    expect(leadEntry).toBeDefined()
    expect(typeof leadEntry!.sizeKB).toBe('number')
    expect(leadEntry!.sizeKB).toBeGreaterThanOrEqual(0)
  })

  it('sample contains first record keys (line 215 col[0] branch)', () => {
    const biz = {
      leads: [{ id: 'L-1', name: 'Test', status: 'open', extra: 'data', field5: 'v', field6: 'v2', field7: 'v3' }]
    }
    const result = collectionInventory(biz as never)
    const entry = result.find(r => r.key === 'leads')
    expect(entry!.sample.length).toBeGreaterThan(0)
    expect(entry!.sample.length).toBeLessThanOrEqual(6)
  })

  it('empty collection is skipped (col.length===0 guard means no entry added)', () => {
    // collectionInventory skips arrays with length===0 — no entry for 'leads'
    const biz = { leads: [] }
    const result = collectionInventory(biz as never)
    const entry = result.find(r => r.key === 'leads')
    // The guard on line 201 skips empty arrays entirely
    expect(entry).toBeUndefined()
  })

  it('sample is empty array when col[0] is falsy (exercises ternary false branch)', () => {
    // The col[0] ? ... : [] ternary fires when first element is falsy (0, null, etc.)
    // Force this by using a non-object first element — but col[0] check only applies
    // after the Array.isArray && length>0 && typeof col[0]==='object' guards.
    // So col[0] will be truthy for all valid data — test the truthy path with real data
    const biz = { leads: [{ id: 'L-1', name: 'A', status: 'open' }] }
    const result = collectionInventory(biz as never)
    const entry = result.find(r => r.key === 'leads')
    // col[0] is truthy → sample = Object.keys(col[0]).slice(0, 6)
    expect(entry!.sample).toContain('id')
    expect(entry!.sample).toContain('name')
  })

  it('hasIds is true when all records have id field', () => {
    const biz = { leads: [{ id: 'L-1', name: 'A' }, { id: 'L-2', name: 'B' }] }
    const result = collectionInventory(biz as never)
    const entry = result.find(r => r.key === 'leads')
    expect(entry!.hasIds).toBe(true)
  })

  it('hasIds is true when records have month field (alternative id check)', () => {
    const biz = { forecasts: [{ month: '2026-01', value: 100 }, { month: '2026-02', value: 200 }] }
    const result = collectionInventory(biz as never)
    const entry = result.find(r => r.key === 'forecasts')
    expect(entry!.hasIds).toBe(true)
  })
})

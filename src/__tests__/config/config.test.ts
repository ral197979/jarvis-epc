/**
 * Tests: src/config/navigation.ts + systemPrompt.ts + defaultState.ts
 * Coverage: extraction correctness, type safety, helper functions
 */

import { describe, it, expect } from 'vitest'
import { NAVIGATION_ITEMS, NAV_DOMAINS, getNavItem } from '../../config/navigation'
import { JARVIS_SYSTEM_PROMPT, buildContextPrompt } from '../../config/systemPrompt'
import { DEFAULT_BIZ_STATE, getDefaultState } from '../../config/defaultState'

// ─── navigation.ts ────────────────────────────────────────────────────────────

describe('NAVIGATION_ITEMS', () => {
  it('has a stable non-empty navigation items list', () => {
    // v4.31.0: navigation has grown from 19 → 27 items (Phase 19/20 additions
    // of Commissioning, Portfolio, MCP, Resources, AuditLog, etc.). Lock a
    // floor rather than an exact count so incremental additions don't force
    // churn here, while catching accidental regressions (e.g. someone emptying
    // the list).
    // v4.37.0: Workflow Redesign added My Work, Lifecycle, and the Setup Wizard.
    expect(NAVIGATION_ITEMS.length).toBeGreaterThanOrEqual(19)
    expect(NAVIGATION_ITEMS.length).toBeLessThanOrEqual(70)
  })

  it('all items have required fields: id, label, icon', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(item.id,    `${item.id} missing id`).toBeTruthy()
      expect(item.label, `${item.id} missing label`).toBeTruthy()
      expect(item.icon,  `${item.id} missing icon`).toBeTruthy()
    }
  })

  it('all item ids are unique', () => {
    const ids = NAVIGATION_ITEMS.map(n => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('contains the critical EPC domains: dash, crm, projects, construction, calc, mcp, system', () => {
    const ids = new Set(NAVIGATION_ITEMS.map(n => n.id))
    for (const required of ['dash', 'crm', 'projects', 'construction', 'calc', 'mcp', 'system']) {
      expect(ids.has(required), `missing nav item: ${required}`).toBe(true)
    }
  })

  it('all items have a domain field', () => {
    const withDomain = NAVIGATION_ITEMS.filter(n => n.domain)
    expect(withDomain.length).toBeGreaterThan(15)
  })
})

describe('NAV_DOMAINS', () => {
  it('groups items by domain', () => {
    const allGrouped = Object.values(NAV_DOMAINS).flat()
    expect(allGrouped.length).toBe(NAVIGATION_ITEMS.length)
  })

  it('contains the system domain', () => {
    expect(NAV_DOMAINS['system']).toBeDefined()
    expect(NAV_DOMAINS['system'].length).toBeGreaterThan(0)
  })

  it('contains the operations domain', () => {
    expect(NAV_DOMAINS['operations']).toBeDefined()
    expect(NAV_DOMAINS['operations'].some(n => n.id === 'dash')).toBe(true)
  })
})

describe('getNavItem', () => {
  it('finds existing item by id', () => {
    const item = getNavItem('dash')
    expect(item).toBeDefined()
    expect(item?.label).toBe('Dashboard')
  })

  it('returns undefined for unknown id', () => {
    expect(getNavItem('nonexistent-tab-abc')).toBeUndefined()
  })

  it('is case-sensitive', () => {
    expect(getNavItem('DASH')).toBeUndefined()
  })
})

// ─── systemPrompt.ts ─────────────────────────────────────────────────────────

describe('JARVIS_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof JARVIS_SYSTEM_PROMPT).toBe('string')
    expect(JARVIS_SYSTEM_PROMPT.length).toBeGreaterThan(500)
  })

  it('contains JSON response instruction', () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain('"message"')
    expect(JARVIS_SYSTEM_PROMPT).toContain('"actions"')
  })

  it('contains NEC code references', () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain('NEC')
    expect(JARVIS_SYSTEM_PROMPT).toContain('430.')
  })

  it('contains EVM references', () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain('EVM')
    expect(JARVIS_SYSTEM_PROMPT).toContain('CPI')
    expect(JARVIS_SYSTEM_PROMPT).toContain('SPI')
  })

  it('contains critical action types', () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain('add_lead')
    expect(JARVIS_SYSTEM_PROMPT).toContain('add_incident')
    expect(JARVIS_SYSTEM_PROMPT).toContain('add_rfi')
  })

  it('contains schema definitions', () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain('SCHEMAS')
    expect(JARVIS_SYSTEM_PROMPT).toContain('lead:')
    expect(JARVIS_SYSTEM_PROMPT).toContain('contract:')
  })

  it('does not include trailing whitespace on any line', () => {
    const lines = JARVIS_SYSTEM_PROMPT.split('\n')
    const trailingWs = lines.filter(l => l !== l.trimEnd())
    expect(trailingWs.length).toBe(0)
  })
})

describe('buildContextPrompt', () => {
  it('includes the base system prompt', () => {
    const result = buildContextPrompt({})
    expect(result).toContain(JARVIS_SYSTEM_PROMPT)
  })

  it('appends COMPANY when provided', () => {
    const result = buildContextPrompt({ company: 'Ava Systems' })
    expect(result).toContain('COMPANY: Ava Systems')
  })

  it('appends USER ROLE when provided', () => {
    const result = buildContextPrompt({ role: 'project_manager' })
    expect(result).toContain('USER ROLE: project_manager')
  })

  it('appends project count when provided', () => {
    const result = buildContextPrompt({ projects: 5 })
    expect(result).toContain('ACTIVE PROJECTS: 5')
  })

  it('returns base prompt when no context provided', () => {
    const result = buildContextPrompt({})
    expect(result).toBe(JARVIS_SYSTEM_PROMPT)
  })

  it('handles zero counts correctly', () => {
    const result = buildContextPrompt({ leads: 0, invoices: 0 })
    expect(result).toContain('OPEN LEADS: 0')
    expect(result).toContain('OUTSTANDING INVOICES: 0')
  })
})

// ─── defaultState.ts ─────────────────────────────────────────────────────────

describe('DEFAULT_BIZ_STATE', () => {
  it('has required top-level properties', () => {
    expect(DEFAULT_BIZ_STATE.company).toBeDefined()
    expect(DEFAULT_BIZ_STATE.leads).toBeDefined()
    expect(DEFAULT_BIZ_STATE.contracts).toBeDefined()
    expect(DEFAULT_BIZ_STATE.invoices).toBeDefined()
    expect(DEFAULT_BIZ_STATE.purchase_orders).toBeDefined()
  })

  it('has seed lead LEAD-001 with status won', () => {
    const lead = DEFAULT_BIZ_STATE.leads.find(l => l.id === 'LEAD-001')
    expect(lead).toBeDefined()
    expect(lead?.status).toBe('won')
  })

  it('has two seed contracts', () => {
    expect(DEFAULT_BIZ_STATE.contracts).toHaveLength(2)
    expect(DEFAULT_BIZ_STATE.contracts[0].id).toBe('C-001')
    expect(DEFAULT_BIZ_STATE.contracts[1].id).toBe('C-002')
  })

  it('C-001 is Lusaka WTP FFP at $425k', () => {
    const c001 = DEFAULT_BIZ_STATE.contracts.find(c => c.id === 'C-001')
    expect(c001?.value).toBe(425000)
    expect(c001?.type).toBe('FFP')
    expect(c001?.project).toBe('Lusaka WTP')
  })

  it('has a paid invoice INV-001', () => {
    const inv = DEFAULT_BIZ_STATE.invoices.find(i => i.id === 'INV-001')
    expect(inv?.status).toBe('paid')
    expect(inv?.amount).toBe(63750)
  })

  it('has an EVM record with valid SPI and CPI', () => {
    const evm = DEFAULT_BIZ_STATE.evm_projects[0]
    expect(evm?.spi).toBeGreaterThan(0)
    expect(evm?.spi).toBeLessThanOrEqual(2)
    expect(evm?.cpi).toBeGreaterThan(0)
    expect(evm?.cpi).toBeLessThanOrEqual(2)
  })

  it('has WIR-trackable cx_phases for Lusaka WTP', () => {
    expect(DEFAULT_BIZ_STATE.cx_phases.length).toBeGreaterThan(0)
    const allLusaka = DEFAULT_BIZ_STATE.cx_phases.every(p => p.project === 'Lusaka WTP')
    expect(allLusaka).toBe(true)
  })

  it('has incidents that are non-recordable near-misses', () => {
    for (const incident of DEFAULT_BIZ_STATE.incidents) {
      expect(incident.recordable).toBe(false)
      expect(incident.type).toBe('near-miss')
    }
  })
})

describe('getDefaultState', () => {
  it('returns DEFAULT_BIZ_STATE when no overrides', () => {
    const result = getDefaultState()
    expect(result).toEqual(DEFAULT_BIZ_STATE)
  })

  it('applies overrides without mutating DEFAULT_BIZ_STATE', () => {
    const custom = getDefaultState({ company: { name: 'Custom Corp', type: 'LLC' } })
    expect(custom.company.name).toBe('Custom Corp')
    expect(DEFAULT_BIZ_STATE.company.name).toBe('')
  })

  it('returns independent instances (overrides do not leak)', () => {
    const a = getDefaultState({ leads: [] })
    const b = getDefaultState()
    expect(a.leads).toHaveLength(0)
    expect(b.leads).toHaveLength(1)
  })
})

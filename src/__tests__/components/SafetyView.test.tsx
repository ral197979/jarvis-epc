/**
 * Tests: components/SafetyView
 * Coverage: tab navigation, dashboard KPIs, incident table + detail,
 *           JHA table + detail, permit table + detail, toolbox tab,
 *           search filtering, stage pipelines, accessibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { SafetyView, type SafetyViewProps } from '../../components/SafetyView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ownerPolicy: PolicyConfig = {
  writesEnabled:  true,
  chatEnabled:    true,
  exportsEnabled: true,
  activeRole:     'owner',
}

const incidents = [
  { id: 'INC-001', title: 'Worker slipped on wet floor', type: 'Near Miss',   date: '2025-10-01', location: 'Building A',   severity: 'Minor',    status: 'closed',   recordable: false, lti: false },
  { id: 'INC-002', title: 'Hand injury from grinder',    type: 'First Aid',   date: '2025-11-05', location: 'Workshop',      severity: 'Moderate', status: 'corrective', recordable: true, lti: false },
  { id: 'INC-003', title: 'Fall from scaffolding',       type: 'Recordable',  date: '2025-11-20', location: 'Block C',       severity: 'Serious',  status: 'investigation', recordable: true, lti: true },
]

const jhas = [
  { id: 'JHA-001', title: 'Scaffold erection',   task: 'Scaffold erection',   status: 'approved', risk: 'High',   hazards: ['Falls', 'Dropped objects'], controls: ['Full body harness', 'Toe boards'] },
  { id: 'JHA-002', title: 'Hot work permit',     task: 'Welding operations',  status: 'pending',  risk: 'High',   hazards: ['Fire', 'Burns'],            controls: ['Fire blanket', 'Extinguisher'] },
  { id: 'JHA-003', title: 'Excavation safety',   task: 'Excavation activities', status: 'approved', risk: 'Medium', hazards: ['Cave-in'], controls: ['Shoring', 'Standby'] },
]

const permits = [
  { id: 'PTW-001', type: 'Hot Work',    location: 'Block A', status: 'active',   date: '2025-11-01', issuer: 'Site HSE', valid_from: '2025-11-01', valid_to: '2025-11-30' },
  { id: 'PTW-002', type: 'Confined Space', location: 'Tank Farm', status: 'approved', date: '2025-11-15', issuer: 'Site HSE' },
  { id: 'PTW-003', type: 'Excavation', location: 'Zone B', status: 'closed',   date: '2025-10-01' },
]

const toolboxTalks = [
  { id: 'TBT-001', topic: 'Hand safety',        date: '2025-11-01', presenter: 'HSE Officer', location: 'Site Office', attendees: 25 },
  { id: 'TBT-002', topic: 'Working at heights', date: '2025-11-08', presenter: 'Supervisor',  location: 'Block A',    attendees: 12 },
  { id: 'TBT-003', topic: 'Fire prevention',    date: '2025-11-15', presenter: 'HSE Officer', location: 'Workshop',   attendees: 18 },
]

function defaultProps(overrides: Partial<SafetyViewProps> = {}): SafetyViewProps {
  return {
    policy:       ownerPolicy,
    incidents,
    jhas,
    permits,
    toolboxTalks,
    ...overrides,
  }
}

beforeEach(() => {
  useBizStore.getState().reset()
})

// ─── Tab navigation ───────────────────────────────────────────────────────────
describe('SafetyView — tab navigation', () => {
  it('renders all 5 tabs', () => {
    render(<SafetyView {...defaultProps()} />)
    const tablist = screen.getByRole('tablist')
    const tabs = tablist.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(5)
  })

  it('Dashboard tab is active by default', () => {
    render(<SafetyView {...defaultProps()} />)
    const dashTab = screen.getByRole('tab', { name: /Dashboard/i })
    expect(dashTab.getAttribute('aria-selected')).toBe('true')
  })

  it('clicking Incidents tab switches to incidents panel', () => {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Incidents/i }))
    expect(screen.getByRole('table', { name: /incidents/i })).toBeDefined()
  })

  it('clicking JHAs tab shows JHA table', () => {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /JHAs/i }))
    expect(screen.getByRole('table', { name: /job hazard/i })).toBeDefined()
  })

  it('clicking Permits tab shows permits table', () => {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Permits/i }))
    expect(screen.getByRole('table', { name: /work permits/i })).toBeDefined()
  })

  it('clicking Toolbox tab shows toolbox content', () => {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Toolbox/i }))
    expect(screen.getByRole('table', { name: /toolbox talks/i })).toBeDefined()
  })

  it('tab has badge count for open incidents', () => {
    render(<SafetyView {...defaultProps()} />)
    // 2 non-closed incidents
    const incTab = screen.getByRole('tab', { name: /Incidents/i })
    expect(incTab.textContent).toContain('2')
  })
})

// ─── Dashboard ────────────────────────────────────────────────────────────────
describe('SafetyView — dashboard', () => {
  it('renders dashboard KPI cards', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getAllByText('Days Since Incident').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TRIR').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Open Incidents').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active Permits').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Approved JHAs').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Toolbox Talks').length).toBeGreaterThan(0)
  })

  it('shows recent incidents section', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getByText('Recent Incidents')).toBeDefined()
  })

  it('shows active permits section', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getAllByText('Active Permits').length).toBeGreaterThan(0)
  })

  it('"View all" incidents navigates to incidents tab', () => {
    render(<SafetyView {...defaultProps()} />)
    const viewAllBtns = screen.getAllByRole('button', { name: /view all/i })
    fireEvent.click(viewAllBtns[0])
    expect(screen.getByRole('table', { name: /incidents/i })).toBeDefined()
  })

  it('shows incident title in recent incidents', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getByText('Worker slipped on wet floor')).toBeDefined()
  })

  it('shows active permit in active permits section', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getByText('Hot Work')).toBeDefined()
  })

  it('shows "No incidents recorded" when empty', () => {
    render(<SafetyView {...defaultProps({ incidents: [] })} />)
    expect(screen.getByText(/No incidents recorded/i)).toBeDefined()
  })
})

// ─── Incidents tab ────────────────────────────────────────────────────────────
describe('SafetyView — incidents tab', () => {
  function goToIncidents() {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Incidents/i }))
  }

  it('shows all incident IDs', () => {
    goToIncidents()
    expect(screen.getByText('INC-001')).toBeDefined()
    expect(screen.getByText('INC-002')).toBeDefined()
    expect(screen.getByText('INC-003')).toBeDefined()
  })

  it('search filters incidents', () => {
    goToIncidents()
    const input = screen.getByRole('searchbox', { name: /search incidents/i })
    fireEvent.change(input, { target: { value: 'grinder' } })
    expect(screen.getByText('INC-002')).toBeDefined()
    expect(screen.queryByText('INC-001')).toBeNull()
  })

  it('clicking incident row opens detail panel', () => {
    goToIncidents()
    const rows = screen.getAllByRole('row')
    fireEvent.click(rows[1]) // first data row
    expect(screen.getByText('← All Incidents')).toBeDefined()
  })
})

// ─── Incident detail ──────────────────────────────────────────────────────────
describe('SafetyView — incident detail', () => {
  function openIncident(title: string) {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Incidents/i }))
    fireEvent.click(screen.getByText(title))
  }

  it('shows incident title as heading', () => {
    openIncident('Hand injury from grinder')
    expect(screen.getAllByText('Hand injury from grinder').length).toBeGreaterThan(0)
  })

  it('shows incident ID', () => {
    openIncident('Hand injury from grinder')
    expect(screen.getByText('INC-002')).toBeDefined()
  })

  it('shows Recordable badge for recordable incident', () => {
    openIncident('Hand injury from grinder')
    expect(screen.getAllByText('Recordable').length).toBeGreaterThan(0)
  })

  it('shows LTI badge for LTI incident', () => {
    openIncident('Fall from scaffolding')
    expect(screen.getAllByText('LTI').length).toBeGreaterThan(0)
  })

  it('shows stage pipeline', () => {
    openIncident('Hand injury from grinder')
    expect(screen.getAllByText('corrective').length).toBeGreaterThan(0)
  })

  it('shows field grid with location', () => {
    openIncident('Hand injury from grinder')
    expect(screen.getByText('Workshop')).toBeDefined()
  })

  it('back button returns to incident list', () => {
    openIncident('Hand injury from grinder')
    fireEvent.click(screen.getByText('← All Incidents'))
    expect(screen.queryByText('← All Incidents')).toBeNull()
    expect(screen.getByRole('table', { name: /incidents/i })).toBeDefined()
  })
})

// ─── JHA tab ──────────────────────────────────────────────────────────────────
describe('SafetyView — JHAs tab', () => {
  function goToJHAs() {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /JHAs/i }))
  }

  it('shows all JHA IDs', () => {
    goToJHAs()
    expect(screen.getByText('JHA-001')).toBeDefined()
    expect(screen.getByText('JHA-002')).toBeDefined()
    expect(screen.getByText('JHA-003')).toBeDefined()
  })

  it('clicking JHA opens detail panel', () => {
    goToJHAs()
    fireEvent.click(screen.getByText('JHA-001'))
    expect(screen.getByText('← All JHAs')).toBeDefined()
  })
})

// ─── JHA detail ───────────────────────────────────────────────────────────────
describe('SafetyView — JHA detail', () => {
  function openJHA(id: string) {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /JHAs/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows JHA title', () => {
    openJHA('JHA-001')
    expect(screen.getAllByText('Scaffold erection').length).toBeGreaterThan(0)
  })

  it('shows hazard register', () => {
    openJHA('JHA-001')
    expect(screen.getByText('Hazard Register')).toBeDefined()
    expect(screen.getByText('Falls')).toBeDefined()
    expect(screen.getByText('Dropped objects')).toBeDefined()
  })

  it('shows controls section', () => {
    openJHA('JHA-001')
    expect(screen.getByText('Controls')).toBeDefined()
    expect(screen.getByText('Full body harness')).toBeDefined()
  })

  it('back button returns to JHA list', () => {
    openJHA('JHA-001')
    fireEvent.click(screen.getByText('← All JHAs'))
    expect(screen.queryByText('← All JHAs')).toBeNull()
  })
})

// ─── Permits tab ─────────────────────────────────────────────────────────────
describe('SafetyView — permits tab', () => {
  function goToPermits() {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Permits/i }))
  }

  it('shows all permits', () => {
    goToPermits()
    expect(screen.getByText('PTW-001')).toBeDefined()
    expect(screen.getByText('PTW-002')).toBeDefined()
    expect(screen.getByText('PTW-003')).toBeDefined()
  })

  it('clicking permit opens detail panel', () => {
    goToPermits()
    const rows = screen.getAllByRole('row')
    fireEvent.click(rows[1])
    expect(screen.getByText('← All Permits')).toBeDefined()
  })
})

// ─── Permit detail ────────────────────────────────────────────────────────────
describe('SafetyView — permit detail', () => {
  function openPermit(id: string) {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Permits/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows permit type in heading', () => {
    openPermit('PTW-001')
    expect(screen.getByText('Hot Work Permit')).toBeDefined()
  })

  it('shows permit stage pipeline', () => {
    openPermit('PTW-001')
    expect(screen.getAllByText('active').length).toBeGreaterThan(0)
  })

  it('shows issuer field', () => {
    openPermit('PTW-001')
    expect(screen.getAllByText('Site HSE').length).toBeGreaterThan(0)
  })
})

// ─── Toolbox tab ──────────────────────────────────────────────────────────────
describe('SafetyView — toolbox tab', () => {
  function goToToolbox() {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Toolbox/i }))
  }

  it('shows toolbox table', () => {
    goToToolbox()
    expect(screen.getByRole('table', { name: /toolbox talks/i })).toBeDefined()
  })

  it('shows all talk topics', () => {
    goToToolbox()
    expect(screen.getByText('Hand safety')).toBeDefined()
    expect(screen.getByText('Working at heights')).toBeDefined()
    expect(screen.getByText('Fire prevention')).toBeDefined()
  })

  it('shows KPI cards for toolbox', () => {
    goToToolbox()
    expect(screen.getAllByText('Total Talks').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Attendees').length).toBeGreaterThan(0)
  })

  it('says toolbox talks are not stored yet, rather than reporting none', () => {
    // "No toolbox talks recorded" was a claim about DATA. Migration 077 creates
    // safety_observations and safety_incidents and nothing else — there is no
    // toolbox_talks table and no route — so the only true statement is that the
    // domain is not stored. An empty register on a site that has never been able
    // to file a talk reads as "nobody held one", which is a different and
    // worse claim.
    render(<SafetyView {...defaultProps({ toolboxTalks: [] })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Toolbox/i }))
    expect(screen.getByText(/Toolbox talks are not stored yet/i)).toBeDefined()
    expect(screen.getByText(/no table and no API route/i)).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('SafetyView — accessibility', () => {
  it('main container has role=main', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /safety/i })).toBeDefined()
  })

  it('tab list has aria-label', () => {
    render(<SafetyView {...defaultProps()} />)
    expect(screen.getByRole('tablist', { name: /safety sections/i })).toBeDefined()
  })

  it('all tab buttons have role=tab', () => {
    render(<SafetyView {...defaultProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(5)
  })

  it('active tab has aria-selected=true', () => {
    render(<SafetyView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Incidents/i }))
    expect(screen.getByRole('tab', { name: /Incidents/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Dashboard/i }).getAttribute('aria-selected')).toBe('false')
  })
})

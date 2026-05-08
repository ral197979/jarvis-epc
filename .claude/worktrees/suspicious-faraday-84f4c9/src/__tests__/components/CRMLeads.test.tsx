/**
 * Tests: components/CRMLeads
 * Coverage: empty state, KPI calculations, funnel, search/filter,
 *           lead detail panel, stage transitions, sort, dispatch,
 *           accessibility, policy enforcement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { CRMLeads, type CRMLeadsProps } from '../../components/CRMLeads'
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

const viewerPolicy: PolicyConfig = {
  writesEnabled:  true,
  chatEnabled:    false,
  exportsEnabled: false,
  activeRole:     'viewer',
}

const leads = [
  { id: 'L-001', name: 'Acme Corp',    status: 'new',         estimated_value: 200_000, probability: 40, contact: 'Alice',    source: 'referral',  service: 'MEP' },
  { id: 'L-002', name: 'Beta Plant',   status: 'qualified',   estimated_value: 500_000, probability: 65, contact: 'Bob',      source: 'web',       service: 'EPC' },
  { id: 'L-003', name: 'Gamma Tower',  status: 'proposal',    estimated_value: 1_200_000, probability: 75, contact: 'Carol',  source: 'tender',    service: 'Civil' },
  { id: 'L-004', name: 'Delta Bridge', status: 'negotiation', estimated_value: 800_000, probability: 85, contact: 'Dave',     source: 'direct',    service: 'Structural' },
  { id: 'L-005', name: 'Echo Mall',    status: 'won',         estimated_value: 300_000, probability: 100, contact: 'Eve',    source: 'referral',  service: 'MEP' },
  { id: 'L-006', name: 'Foxtrot Hub',  status: 'lost',        estimated_value: 150_000, probability: 0, contact: 'Frank',    source: 'cold',      service: 'IT' },
]

const contracts = [
  { id: 'C-001', project: 'Gamma Tower', status: 'active' },
]

function seedStore(leadList = leads, contractList = contracts) {
  const store = useBizStore.getState()
  store.reset()
  leadList.forEach(l => store.dispatch(actions.addLead(l)))
  contractList.forEach(c => store.dispatch(actions.addContract(c)))
}

function defaultProps(overrides: Partial<CRMLeadsProps> = {}): CRMLeadsProps {
  return { policy: ownerPolicy, ...overrides }
}

beforeEach(() => {
  useBizStore.getState().reset()
})

// ─── Empty state ──────────────────────────────────────────────────────────────
describe('CRMLeads — empty state', () => {
  it('renders empty state when no leads', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByText(/No leads yet/i)).toBeDefined()
  })

  it('empty state includes AI prompt hint', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByText(/Embassy X/i)).toBeDefined()
  })
})

// ─── KPI row ──────────────────────────────────────────────────────────────────
describe('CRMLeads — KPI row', () => {
  beforeEach(() => seedStore())

  it('renders Total Leads KPI', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getAllByText('Total Leads').length).toBeGreaterThan(0)
  })

  it('renders Pipeline value KPI', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getAllByText('Pipeline').length).toBeGreaterThan(0)
  })

  it('renders Win Rate KPI', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getAllByText('Win Rate').length).toBeGreaterThan(0)
  })

  it('shows correct lead count', () => {
    render(<CRMLeads {...defaultProps()} />)
    // 6 leads in seed data
    expect(screen.getByText('6')).toBeDefined()
  })

  it('win rate shows correct percentage (1/6 = ~17%)', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByText('17%')).toBeDefined()
  })
})

// ─── Pipeline funnel ──────────────────────────────────────────────────────────
describe('CRMLeads — pipeline funnel', () => {
  beforeEach(() => seedStore())

  it('renders Pipeline Funnel heading', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByText('Pipeline Funnel')).toBeDefined()
  })

  it('does not render funnel when all leads have zero value', () => {
    useBizStore.getState().reset()
    useBizStore.getState().dispatch(actions.addLead({ id: 'L-Z', name: 'Z', status: 'new', estimated_value: 0, probability: 0 }))
    render(<CRMLeads {...defaultProps()} />)
    // Funnel heading should be absent when no stage has positive value
    const funnelHeadings = screen.queryAllByText('Pipeline Funnel')
    expect(funnelHeadings.length).toBe(0)
  })
})

// ─── Search / filter ──────────────────────────────────────────────────────────
describe('CRMLeads — search', () => {
  beforeEach(() => seedStore())

  it('renders search input', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('filters leads by name', () => {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Acme' } })
    expect(screen.getByText('Acme Corp')).toBeDefined()
    expect(screen.queryByText('Beta Plant')).toBeNull()
  })

  it('filters leads by contact', () => {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'carol' } })
    expect(screen.getByText('Gamma Tower')).toBeDefined()
    expect(screen.queryByText('Acme Corp')).toBeNull()
  })

  it('filters leads by service', () => {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'MEP' } })
    expect(screen.getByText('Acme Corp')).toBeDefined()
    expect(screen.getByText('Echo Mall')).toBeDefined()
    expect(screen.queryByText('Beta Plant')).toBeNull()
  })

  it('shows "No leads match" when nothing found', () => {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-nonexistent' } })
    expect(screen.getByText(/No leads match/i)).toBeDefined()
  })

  it('clearing search restores full list', () => {
    render(<CRMLeads {...defaultProps()} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Acme' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Beta Plant')).toBeDefined()
  })
})

// ─── Leads table ──────────────────────────────────────────────────────────────
describe('CRMLeads — table', () => {
  beforeEach(() => seedStore())

  it('renders all lead names in table', () => {
    render(<CRMLeads {...defaultProps()} />)
    leads.forEach(l => {
      expect(screen.getByText(l.name)).toBeDefined()
    })
  })

  it('renders status badges', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getAllByText('new').length).toBeGreaterThan(0)
    expect(screen.getAllByText('qualified').length).toBeGreaterThan(0)
  })

  it('table has accessible aria-label', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByRole('table', { name: /leads list/i })).toBeDefined()
  })

  it('clicking a lead navigates to detail view', () => {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Corp'))
    expect(screen.getByText('← All Leads')).toBeDefined()
  })
})

// ─── Lead detail panel ────────────────────────────────────────────────────────
describe('CRMLeads — detail panel', () => {
  beforeEach(() => seedStore())

  function openLead(name: string) {
    render(<CRMLeads {...defaultProps()} />)
    fireEvent.click(screen.getByText(name))
  }

  it('shows lead name as heading', () => {
    openLead('Acme Corp')
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })

  it('shows lead ID', () => {
    openLead('Acme Corp')
    expect(screen.getByText('L-001')).toBeDefined()
  })

  it('shows contact info in details card', () => {
    openLead('Acme Corp')
    expect(screen.getByText('Alice')).toBeDefined()
  })

  it('shows source in details card', () => {
    openLead('Acme Corp')
    expect(screen.getByText('referral')).toBeDefined()
  })

  it('shows service in details card', () => {
    openLead('Acme Corp')
    expect(screen.getByText('MEP')).toBeDefined()
  })

  it('shows linked contract for Gamma Tower', () => {
    openLead('Gamma Tower')
    expect(screen.getByText('C-001')).toBeDefined()
    expect(screen.getByText('active')).toBeDefined()
  })

  it('shows "No linked contract" for Acme Corp', () => {
    openLead('Acme Corp')
    expect(screen.getByText(/No linked contract/i)).toBeDefined()
  })

  it('back button returns to list view', () => {
    openLead('Acme Corp')
    fireEvent.click(screen.getByText('← All Leads'))
    expect(screen.queryByText('← All Leads')).toBeNull()
    expect(screen.getByText('Acme Corp')).toBeDefined()
  })

  it('renders 4 KPI cards in detail view', () => {
    openLead('Acme Corp')
    expect(screen.getAllByText('Est. Value').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Probability').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Weighted').length).toBeGreaterThan(0)
    // Status KPI label exists
    const statusEls = screen.getAllByText('Status')
    expect(statusEls.length).toBeGreaterThan(0)
  })

  it('stage pipeline renders all 5 stages', () => {
    openLead('Acme Corp')
    ;['New', 'Qualified', 'Proposal', 'Negotiation', 'Won'].forEach(stage => {
      expect(screen.getByRole('button', { name: new RegExp(stage, 'i') })).toBeDefined()
    })
  })
})

// ─── Stage transitions ────────────────────────────────────────────────────────
describe('CRMLeads — stage transitions', () => {
  beforeEach(() => seedStore())

  it('clicking a stage button dispatches updateLead', () => {
    const toast = vi.fn()
    render(<CRMLeads {...defaultProps({ onToast: toast })} />)
    fireEvent.click(screen.getByText('Acme Corp'))
    fireEvent.click(screen.getByRole('button', { name: /set stage to qualified/i }))
    const updated = useBizStore.getState().biz.leads.find(l => l.id === 'L-001')
    expect(updated?.['status']).toBe('qualified')
  })

  it('stage transition calls onToast', () => {
    const toast = vi.fn()
    render(<CRMLeads {...defaultProps({ onToast: toast })} />)
    fireEvent.click(screen.getByText('Acme Corp'))
    fireEvent.click(screen.getByRole('button', { name: /set stage to qualified/i }))
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Qualified/i), 'success')
  })

  it('stage buttons are disabled for viewer policy', () => {
    render(<CRMLeads policy={viewerPolicy} />)
    fireEvent.click(screen.getByText('Acme Corp'))
    const stageBtn = screen.getByRole('button', { name: /set stage to won/i })
    expect(stageBtn).toBeDefined()
    // Viewer stages should be disabled
    expect(stageBtn.hasAttribute('disabled')).toBe(true)
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('CRMLeads — accessibility', () => {
  beforeEach(() => seedStore())

  it('main container has role=main', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /CRM Leads/i })).toBeDefined()
  })

  it('search input has aria-label', () => {
    render(<CRMLeads {...defaultProps()} />)
    expect(screen.getByRole('searchbox', { name: /search leads/i })).toBeDefined()
  })

  it('table has sortable column headers with aria-sort', () => {
    render(<CRMLeads {...defaultProps()} />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(0)
    const sortableHeader = headers.find(h => h.getAttribute('aria-sort') !== null)
    expect(sortableHeader).toBeDefined()
  })
})

// ─── Sort ─────────────────────────────────────────────────────────────────────
describe('CRMLeads — sort', () => {
  beforeEach(() => seedStore())

  it('clicking "Lead Name" header sorts by name', () => {
    render(<CRMLeads {...defaultProps()} />)
    const nameHeader = screen.getByRole('columnheader', { name: /lead name/i })
    fireEvent.click(nameHeader)
    // After click, column should have sort indicator
    expect(nameHeader.textContent).toMatch(/↑|↓/)
  })

  it('clicking same header twice reverses sort direction', () => {
    render(<CRMLeads {...defaultProps()} />)
    const nameHeader = screen.getByRole('columnheader', { name: /lead name/i })
    fireEvent.click(nameHeader)
    const dir1 = nameHeader.textContent
    fireEvent.click(nameHeader)
    const dir2 = nameHeader.textContent
    expect(dir1).not.toBe(dir2)
  })
})

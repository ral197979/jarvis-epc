/**
 * Tests: components/ProjectsView
 * Coverage: empty state, KPI row, projects table, sort, search,
 *           project detail panel, EVM panel, action items,
 *           navigation, accessibility, policy enforcement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ProjectsView, type ProjectsViewProps } from '../../components/ProjectsView'
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

const contracts = [
  { id: 'C-001', project: 'Acme Refinery', client: 'Acme Corp',  value: 2_000_000, type: 'EPC',    status: 'active',   progress: 65 },
  { id: 'C-002', project: 'Beta Plant',    client: 'Beta Ltd',   value: 800_000,   type: 'FEED',   status: 'active',   progress: 30 },
  { id: 'C-003', project: 'Gamma Tower',   client: 'Gamma Corp', value: 3_500_000, type: 'Civil',  status: 'complete', progress: 100 },
  { id: 'C-004', project: 'Delta Bridge',  client: 'Delta Inc',  value: 1_200_000, type: 'Design', status: 'pending',  progress: 0 },
]

const evmData = [
  { id: 'E-001', project: 'Acme Refinery', period: '2025-Q4', budget: 2_000_000, ev: 1_300_000, ac: 1_200_000, pv: 1_200_000, cpi: 1.08, spi: 1.08, eac: 1_851_852, vac: 148_148, cv: 100_000, sv: 100_000 },
  { id: 'E-002', project: 'Beta Plant',    period: '2025-Q4', budget: 800_000,   ev: 200_000,   ac: 260_000,   pv: 240_000,   cpi: 0.77, spi: 0.83, eac: 1_038_961, vac: -238_961, cv: -60_000, sv: -40_000 },
]

const actionItems = [
  { id: 'A-001', subject: 'Submit IFC drawings', project: 'Acme Refinery', status: 'open',   priority: 'high', assigned: 'Alice', due: '2025-12-01' },
  { id: 'A-002', subject: 'Review structural calcs', project: 'Acme Refinery', status: 'closed', priority: 'med', assigned: 'Bob', due: '2025-11-15' },
]

function seedStore() {
  const store = useBizStore.getState()
  store.reset()
  contracts.forEach(c => store.dispatch(actions.addContract(c)))
  evmData.forEach(e => store.dispatch(actions.addEVM(e)))
  actionItems.forEach(a => store.dispatch(actions.addAction(a)))
}

function defaultProps(overrides: Partial<ProjectsViewProps> = {}): ProjectsViewProps {
  return { policy: ownerPolicy, ...overrides }
}

beforeEach(() => {
  useBizStore.getState().reset()
})

// ─── Empty state ──────────────────────────────────────────────────────────────
describe('ProjectsView — empty state', () => {
  it('renders empty state when no contracts exist', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByText(/No projects yet/i)).toBeDefined()
  })

  it('empty state shows "Go to Contracts" button for owner', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByRole('button', { name: /go to contracts/i })).toBeDefined()
  })

  it('"Go to Contracts" button triggers onNavigate', () => {
    const nav = vi.fn()
    render(<ProjectsView {...defaultProps({ onNavigate: nav })} />)
    fireEvent.click(screen.getByRole('button', { name: /go to contracts/i }))
    expect(nav).toHaveBeenCalledWith('contracts')
  })

  it('empty state hides "Go to Contracts" for viewer', () => {
    render(<ProjectsView policy={viewerPolicy} />)
    expect(screen.queryByRole('button', { name: /go to contracts/i })).toBeNull()
  })
})

// ─── KPI row ──────────────────────────────────────────────────────────────────
describe('ProjectsView — KPI row', () => {
  beforeEach(() => seedStore())

  it('renders Total Projects KPI', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getAllByText('Total Projects').length).toBeGreaterThan(0)
  })

  it('shows correct total project count (4)', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByText('4')).toBeDefined()
  })

  it('renders Portfolio Value KPI', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getAllByText('Portfolio Value').length).toBeGreaterThan(0)
  })

  it('renders Avg Progress KPI', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getAllByText('Avg Progress').length).toBeGreaterThan(0)
  })

  it('renders Avg CPI KPI', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getAllByText('Avg CPI').length).toBeGreaterThan(0)
  })
})

// ─── Projects table ───────────────────────────────────────────────────────────
describe('ProjectsView — table', () => {
  beforeEach(() => seedStore())

  it('renders all contract project names', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByText('Acme Refinery')).toBeDefined()
    expect(screen.getByText('Beta Plant')).toBeDefined()
    expect(screen.getByText('Gamma Tower')).toBeDefined()
    expect(screen.getByText('Delta Bridge')).toBeDefined()
  })

  it('table has aria-label', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByRole('table', { name: /projects list/i })).toBeDefined()
  })

  it('has sortable column headers', () => {
    render(<ProjectsView {...defaultProps()} />)
    const headers = screen.getAllByRole('columnheader')
    const sortable = headers.filter(h => h.getAttribute('aria-sort') !== null)
    expect(sortable.length).toBeGreaterThan(0)
  })

  it('clicking column header toggles sort direction', () => {
    render(<ProjectsView {...defaultProps()} />)
    const projectHeader = screen.getByRole('columnheader', { name: /^Project/i })
    fireEvent.click(projectHeader)
    const dir1 = projectHeader.textContent
    fireEvent.click(projectHeader)
    const dir2 = projectHeader.textContent
    expect(dir1).not.toBe(dir2)
  })

  it('clicking a project row opens detail view', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByText('← All Projects')).toBeDefined()
  })
})

// ─── Search ───────────────────────────────────────────────────────────────────
describe('ProjectsView — search', () => {
  beforeEach(() => seedStore())

  it('renders search input', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByRole('searchbox')).toBeDefined()
  })

  it('filters by project name', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Acme' } })
    expect(screen.getByText('Acme Refinery')).toBeDefined()
    expect(screen.queryByText('Beta Plant')).toBeNull()
  })

  it('filters by client name', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Beta Ltd' } })
    expect(screen.getByText('Beta Plant')).toBeDefined()
    expect(screen.queryByText('Acme Refinery')).toBeNull()
  })

  it('filters by type', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'FEED' } })
    expect(screen.getByText('Beta Plant')).toBeDefined()
    expect(screen.queryByText('Acme Refinery')).toBeNull()
  })

  it('shows "No projects found" when no match', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-no-match' } })
    expect(screen.getByText(/No projects found/i)).toBeDefined()
  })

  it('clearing search restores full list', () => {
    render(<ProjectsView {...defaultProps()} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Acme' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Beta Plant')).toBeDefined()
  })
})

// ─── Project detail ───────────────────────────────────────────────────────────
describe('ProjectsView — detail panel', () => {
  beforeEach(() => seedStore())

  function openProject(name: string) {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText(name))
  }

  it('back button returns to list', () => {
    openProject('Acme Refinery')
    fireEvent.click(screen.getByText('← All Projects'))
    expect(screen.queryByText('← All Projects')).toBeNull()
    expect(screen.getByText('Acme Refinery')).toBeDefined()
  })

  it('shows contract ID in detail', () => {
    openProject('Acme Refinery')
    expect(screen.getByText('C-001')).toBeDefined()
  })

  it('shows client in detail', () => {
    openProject('Acme Refinery')
    expect(screen.getByText('Acme Corp')).toBeDefined()
  })

  it('shows progress bar', () => {
    openProject('Acme Refinery')
    expect(screen.getByRole('progressbar')).toBeDefined()
  })

  it('shows progress percentage', () => {
    openProject('Acme Refinery')
    expect(screen.getAllByText('65%').length).toBeGreaterThan(0)
  })

  it('renders KPI cards in detail view', () => {
    openProject('Acme Refinery')
    expect(screen.getAllByText('Progress').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Contract Value').length).toBeGreaterThan(0)
  })
})

// ─── EVM panel ────────────────────────────────────────────────────────────────
describe('ProjectsView — EVM panel', () => {
  beforeEach(() => seedStore())

  it('shows EVM panel for project with EVM data', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByText(/EVM Performance/i)).toBeDefined()
  })

  it('shows CPI in EVM panel', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getAllByText('1.08').length).toBeGreaterThan(0)
  })

  it('does not show EVM panel for project without EVM data', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Gamma Tower'))
    expect(screen.queryByText(/EVM Performance/i)).toBeNull()
  })
})

// ─── Action items ─────────────────────────────────────────────────────────────
describe('ProjectsView — action items panel', () => {
  beforeEach(() => seedStore())

  it('shows action items panel in project detail', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByText(/Action Items/i)).toBeDefined()
  })

  it('shows action item subject', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByText('Submit IFC drawings')).toBeDefined()
  })

  it('shows open action count', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByText(/1 open/i)).toBeDefined()
  })

  it('shows Add button for owner policy', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    expect(screen.getByRole('button', { name: /^\+ add$/i })).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('ProjectsView — accessibility', () => {
  beforeEach(() => seedStore())

  it('main container has role=main', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /projects/i })).toBeDefined()
  })

  it('search input has aria-label', () => {
    render(<ProjectsView {...defaultProps()} />)
    expect(screen.getByRole('searchbox', { name: /search projects/i })).toBeDefined()
  })

  it('progress bars have aria attributes', () => {
    render(<ProjectsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Acme Refinery'))
    const pbar = screen.getByRole('progressbar')
    expect(pbar.getAttribute('aria-valuenow')).toBe('65')
    expect(pbar.getAttribute('aria-valuemin')).toBe('0')
    expect(pbar.getAttribute('aria-valuemax')).toBe('100')
  })
})

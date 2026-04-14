/**
 * Tests: components/CommissioningView
 * Coverage: 3 tabs (Completion/Punch/Lessons), KPI strip, filters,
 *           punch detail panel, stage pipeline, lessons, accessibility
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { CommissioningView, type CommissioningViewProps } from '../../components/CommissioningView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const punchItems = [
  { id: 'PI-001', description: 'Install safety valve PSV-101', priority: 'A', status: 'open',
    location: 'Area 1', assigned: 'John Tech', due: '2026-02-01', category: 'safety' },
  { id: 'PI-002', description: 'Insulation missing on pipe run 45C', priority: 'B', status: 'in-progress',
    location: 'Area 2', assigned: 'Mary Eng', due: '2026-02-15', ref_dwg: 'P&ID-001' },
  { id: 'PI-003', description: 'Label instruments per ITP', priority: 'C', status: 'resolved',
    location: 'Control Room', assigned: 'Dave Tech', due: '2026-01-20' },
  { id: 'PI-004', description: 'Flush cooling water lines', priority: 'A', status: 'assigned',
    location: 'Utility Area', assigned: 'John Tech', due: '2026-01-25' },
  { id: 'PI-005', description: 'Final electrical continuity test', priority: 'B', status: 'closed',
    location: 'MCC Room', assigned: 'Mary Eng', due: '2026-01-10' },
]

const closeouts = [
  {
    id: 'CO-001', system: 'Process Unit A', description: 'Mechanical completion',
    categories: {
      mechanical:     { total: 12, done: 12 },
      electrical:     { total: 8,  done: 6  },
      instrumentation:{ total: 10, done: 7  },
      civil:          { total: 5,  done: 5  },
    },
  },
]

const lessons = [
  { lesson: 'Engage commissioning team during detailed design',  category: 'engineering',  impact: 'positive' },
  { lesson: 'Procurement delays caused schedule overrun',         category: 'procurement',  impact: 'negative' },
  { lesson: 'Weekly punch-list reviews improved closure rate',    category: 'management',   impact: 'positive' },
  { lesson: 'HSE walk-down prior to pre-commissioning',          category: 'safety',       impact: 'positive' },
]

function seedStore() {
  useBizStore.getState().reset()
  punchItems.forEach(p => useBizStore.getState().dispatch(actions.addPunch(p)))
  closeouts.forEach(c => useBizStore.getState().dispatch(actions.addCloseout(c)))
  lessons.forEach(l => useBizStore.getState().dispatch(actions.addLesson(l)))
}

function defaultProps(overrides: Partial<CommissioningViewProps> = {}): CommissioningViewProps {
  return { policy: ownerPolicy, closeouts, punchItems, lessons, ...overrides }
}

beforeEach(() => { useBizStore.getState().reset() })

// ─── Tab navigation ───────────────────────────────────────────────────────────
describe('CommissioningView — tab navigation', () => {
  it('renders tablist with commissioning sections', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByRole('tablist', { name: /commissioning sections/i })).toBeDefined()
  })

  it('has 3 tabs: Completion, Punch List, Lessons Learned', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getAllByRole('tab').length).toBe(3)
  })

  it('Completion tab is selected by default', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByRole('tab', { name: /Completion/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking Punch List tab shows punch content', () => {
    render(<CommissioningView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Punch List/i }))
    expect(screen.getByRole('table', { name: /punch list/i })).toBeDefined()
  })

  it('clicking Lessons Learned tab shows lessons content', () => {
    render(<CommissioningView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Lessons Learned/i }))
    expect(screen.getByText(/Engage commissioning team/i)).toBeDefined()
  })

  it('Punch List tab shows open count badge when items are open', () => {
    render(<CommissioningView {...defaultProps()} />)
    const punchTab = screen.getByRole('tab', { name: /Punch List/i })
    // 3 open items (open, in-progress, assigned) should show a badge
    expect(punchTab.textContent).toMatch(/[1-9]/)
  })
})

// ─── Completion tab ───────────────────────────────────────────────────────────
describe('CommissioningView — completion tab', () => {
  it('shows system name', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByText('Process Unit A')).toBeDefined()
  })

  it('shows category names', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByText('Mechanical')).toBeDefined()
    expect(screen.getByText('Electrical')).toBeDefined()
    expect(screen.getByText('Instrumentation')).toBeDefined()
    expect(screen.getByText('Civil')).toBeDefined()
  })

  it('shows done/total for each category', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByText('12/12')).toBeDefined()
    expect(screen.getByText('6/8')).toBeDefined()
  })

  it('shows overall completion percentage', () => {
    render(<CommissioningView {...defaultProps()} />)
    // total 35, done 30 → 85%
    expect(screen.getByText(/86%/i)).toBeDefined()
  })

  it('empty state when no closeouts', () => {
    render(<CommissioningView {...defaultProps({ closeouts: [] })} />)
    expect(screen.getByText(/No closeout records/i)).toBeDefined()
  })
})

// ─── Punch List tab ───────────────────────────────────────────────────────────
describe('CommissioningView — punch list', () => {
  function goToPunch() {
    render(<CommissioningView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Punch List/i }))
  }

  it('shows all punch item IDs', () => {
    goToPunch()
    expect(screen.getByText('PI-001')).toBeDefined()
    expect(screen.getByText('PI-002')).toBeDefined()
    expect(screen.getByText('PI-005')).toBeDefined()
  })

  it('shows punch KPI strip', () => {
    goToPunch()
    expect(screen.getAllByText('Total').length).toBeGreaterThan(0)
    expect(screen.getAllByText('A-Items').length).toBeGreaterThan(0)
  })

  it('shows closure percentage', () => {
    goToPunch()
    expect(screen.getAllByText('Closure').length).toBeGreaterThan(0)
  })

  it('status filter shows matching items only', () => {
    goToPunch()
    fireEvent.change(screen.getByRole('combobox', { name: /filter punch by status/i }), { target: { value: 'open' } })
    expect(screen.getByText('PI-001')).toBeDefined()
    expect(screen.queryByText('PI-003')).toBeNull()
  })

  it('priority filter shows matching items only', () => {
    goToPunch()
    fireEvent.change(screen.getByRole('combobox', { name: /filter punch by priority/i }), { target: { value: 'A' } })
    expect(screen.getByText('PI-001')).toBeDefined()
    expect(screen.queryByText('PI-002')).toBeNull()
  })

  it('clicking punch row opens detail', () => {
    goToPunch()
    fireEvent.click(screen.getByText('PI-001'))
    expect(screen.getByText('← Punch List')).toBeDefined()
  })

  it('empty state when no punch items', () => {
    render(<CommissioningView {...defaultProps({ punchItems: [] })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Punch List/i }))
    expect(screen.getByText(/No punch items/i)).toBeDefined()
  })
})

// ─── Punch detail panel ───────────────────────────────────────────────────────
describe('CommissioningView — punch detail', () => {
  function openPunch(id: string) {
    render(<CommissioningView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Punch List/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows punch ID', () => {
    openPunch('PI-001')
    expect(screen.getAllByText('PI-001').length).toBeGreaterThan(0)
  })

  it('shows description', () => {
    openPunch('PI-001')
    expect(screen.getByText('Install safety valve PSV-101')).toBeDefined()
  })

  it('shows stage pipeline', () => {
    openPunch('PI-001')
    expect(screen.getAllByText(/open/i).length).toBeGreaterThan(0)
  })

  it('shows location field', () => {
    openPunch('PI-001')
    expect(screen.getByText('Area 1')).toBeDefined()
  })

  it('shows priority badge', () => {
    openPunch('PI-001')
    expect(screen.getAllByText(/A-Item/i).length).toBeGreaterThan(0)
  })

  it('back button returns to punch list', () => {
    openPunch('PI-001')
    fireEvent.click(screen.getByText('← Punch List'))
    expect(screen.queryByText('← Punch List')).toBeNull()
    expect(screen.getByRole('table', { name: /punch list/i })).toBeDefined()
  })
})

// ─── Lessons Learned tab ──────────────────────────────────────────────────────
describe('CommissioningView — lessons', () => {
  function goToLessons() {
    render(<CommissioningView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Lessons Learned/i }))
  }

  it('shows all lessons', () => {
    goToLessons()
    expect(screen.getByText(/Engage commissioning team/i)).toBeDefined()
    expect(screen.getByText(/Procurement delays/i)).toBeDefined()
    expect(screen.getByText(/Weekly punch-list/i)).toBeDefined()
  })

  it('shows lessons KPI strip with totals', () => {
    goToLessons()
    expect(screen.getAllByText('Total Lessons').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Positive').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Negative').length).toBeGreaterThan(0)
  })

  it('shows positive impact icon', () => {
    goToLessons()
    expect(screen.getAllByText('✅').length).toBeGreaterThan(0)
  })

  it('shows negative impact icon', () => {
    goToLessons()
    expect(screen.getAllByText('⚠️').length).toBeGreaterThan(0)
  })

  it('empty state when no lessons', () => {
    render(<CommissioningView {...defaultProps({ lessons: [] })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Lessons Learned/i }))
    expect(screen.getByText(/No lessons recorded yet/i)).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('CommissioningView — accessibility', () => {
  it('has role=main with aria-label', () => {
    render(<CommissioningView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /commissioning/i })).toBeDefined()
  })

  it('tab buttons have aria-selected', () => {
    render(<CommissioningView {...defaultProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.every(t => t.hasAttribute('aria-selected'))).toBe(true)
  })
})

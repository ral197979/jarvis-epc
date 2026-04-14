/**
 * Tests: components/ActionItemsView
 * Coverage: KPI strip, multi-filter table, detail panel, stage pipeline,
 *           empty state, accessibility, priority/category badges
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ActionItemsView, type ActionItemsViewProps } from '../../components/ActionItemsView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const actionItems = [
  { id: 'AI-001', subject: 'Review P&ID markup comments', project: 'Acme Refinery', priority: 'high',
    assigned: 'Jane Smith', due: '2026-01-15', status: 'open', category: 'engineering',
    notes: 'P&IDs require HAZOP response before finalising.', created: '2025-12-01', created_by: 'Bob Jones' },
  { id: 'AI-002', subject: 'Submit vendor evaluation report', project: 'Beta Plant', priority: 'medium',
    assigned: 'Dave Chen', due: '2026-02-01', status: 'in-progress', category: 'procurement',
    notes: 'Three vendors shortlisted.', created: '2025-12-10', created_by: 'Jane Smith' },
  { id: 'AI-003', subject: 'Update electrical load list', project: 'Acme Refinery', priority: 'low',
    assigned: 'Alice Lee', due: '2026-03-01', status: 'resolved', category: 'engineering',
    created: '2025-12-15', created_by: 'Dave Chen' },
  { id: 'AI-004', subject: 'Close out safety punch items', project: 'Beta Plant', priority: 'high',
    assigned: 'Jane Smith', due: '2026-01-20', status: 'assigned', category: 'safety',
    created: '2025-12-20', created_by: 'Alice Lee' },
  { id: 'AI-005', subject: 'Final documentation handover', project: 'Acme Refinery', priority: 'medium',
    assigned: 'Bob Jones', due: '2026-04-01', status: 'verified', category: 'commissioning',
    created: '2026-01-01', created_by: 'Jane Smith' },
]

function seedStore() {
  useBizStore.getState().reset()
  actionItems.forEach(a => useBizStore.getState().dispatch(actions.addAction(a)))
}

function defaultProps(overrides: Partial<ActionItemsViewProps> = {}): ActionItemsViewProps {
  return { policy: ownerPolicy, ...overrides }
}

beforeEach(() => { useBizStore.getState().reset() })

// ─── KPI strip ────────────────────────────────────────────────────────────────
describe('ActionItemsView — KPI strip', () => {
  beforeEach(() => seedStore())

  it('shows Total KPI', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('Total').length).toBeGreaterThan(0)
  })

  it('shows Open KPI', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
  })

  it('shows High Priority KPI', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('High Priority').length).toBeGreaterThan(0)
  })

  it('shows Overdue KPI', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
  })

  it('shows Resolved KPI', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0)
  })
})

// ─── Table rendering ──────────────────────────────────────────────────────────
describe('ActionItemsView — table', () => {
  beforeEach(() => seedStore())

  it('renders action items register table', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByRole('table', { name: /open items action items/i })).toBeDefined()
  })

  it('shows all action item IDs', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByText('AI-001')).toBeDefined()
    expect(screen.getByText('AI-002')).toBeDefined()
    expect(screen.getByText('AI-005')).toBeDefined()
  })

  it('shows item count', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByText(/5 of 5 items/i)).toBeDefined()
  })
})

// ─── Filters ──────────────────────────────────────────────────────────────────
describe('ActionItemsView — filters', () => {
  beforeEach(() => seedStore())

  it('search filters by subject', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search action items/i }), { target: { value: 'load list' } })
    expect(screen.getByText('AI-003')).toBeDefined()
    expect(screen.queryByText('AI-001')).toBeNull()
  })

  it('search filters by ID', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search action items/i }), { target: { value: 'AI-004' } })
    expect(screen.getByText('AI-004')).toBeDefined()
    expect(screen.queryByText('AI-002')).toBeNull()
  })

  it('status filter shows only matching items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by status/i }), { target: { value: 'resolved' } })
    expect(screen.getByText('AI-003')).toBeDefined()
    expect(screen.queryByText('AI-001')).toBeNull()
  })

  it('priority filter shows only matching items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by priority/i }), { target: { value: 'high' } })
    expect(screen.getByText('AI-001')).toBeDefined()
    expect(screen.queryByText('AI-003')).toBeNull()
  })

  it('project filter shows only matching items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by project/i }), { target: { value: 'Beta Plant' } })
    expect(screen.getByText('AI-002')).toBeDefined()
    expect(screen.queryByText('AI-001')).toBeNull()
  })

  it('assignee filter shows only matching items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by assignee/i }), { target: { value: 'Alice Lee' } })
    expect(screen.getByText('AI-003')).toBeDefined()
    expect(screen.queryByText('AI-001')).toBeNull()
  })

  it('category filter shows only matching items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by category/i }), { target: { value: 'safety' } })
    expect(screen.getByText('AI-004')).toBeDefined()
    expect(screen.queryByText('AI-001')).toBeNull()
  })

  it('shows "No action items match" when nothing passes filter', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search action items/i }), { target: { value: 'zzz-nothing' } })
    expect(screen.getByText(/No action items match/i)).toBeDefined()
  })
})

// ─── Detail panel ─────────────────────────────────────────────────────────────
describe('ActionItemsView — detail panel', () => {
  beforeEach(() => seedStore())

  it('clicking row opens detail view', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    expect(screen.getByText('← All Actions')).toBeDefined()
  })

  it('detail shows item ID', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    // ID + subject are combined in h2
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('AI-001')
  })

  it('detail shows subject', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Review P&ID markup comments')
  })

  it('detail shows stage pipeline', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    // Pipeline renders lifecycle stages
    expect(screen.getAllByText(/assigned/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0)
  })

  it('detail shows assigned field', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThan(0)
  })

  it('detail shows notes', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    expect(screen.getByText(/P&IDs require HAZOP response/i)).toBeDefined()
  })

  it('back button returns to list', () => {
    render(<ActionItemsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('AI-001'))
    fireEvent.click(screen.getByText('← All Actions'))
    expect(screen.queryByText('← All Actions')).toBeNull()
    expect(screen.getByRole('table', { name: /open items action items/i })).toBeDefined()
  })
})

// ─── Badges ───────────────────────────────────────────────────────────────────
describe('ActionItemsView — priority and category badges', () => {
  beforeEach(() => seedStore())

  it('renders priority badges in table', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('high').length).toBeGreaterThan(0)
    expect(screen.getAllByText('medium').length).toBeGreaterThan(0)
  })

  it('renders category text in table', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getAllByText('engineering').length).toBeGreaterThan(0)
    expect(screen.getAllByText('procurement').length).toBeGreaterThan(0)
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────
describe('ActionItemsView — empty state', () => {
  it('shows empty state when no items', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByText(/No action items/i)).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('ActionItemsView — accessibility', () => {
  beforeEach(() => seedStore())

  it('has role=main with aria-label', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /action items/i })).toBeDefined()
  })

  it('search input has aria-label', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByRole('searchbox', { name: /search action items/i })).toBeDefined()
  })

  it('filter dropdowns have aria-labels', () => {
    render(<ActionItemsView {...defaultProps()} />)
    expect(screen.getByRole('combobox', { name: /filter by status/i })).toBeDefined()
    expect(screen.getByRole('combobox', { name: /filter by priority/i })).toBeDefined()
    expect(screen.getByRole('combobox', { name: /filter by project/i })).toBeDefined()
  })
})

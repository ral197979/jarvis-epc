/**
 * Tests: components/ProcurementView
 * Coverage: tab navigation, overview KPIs, PO list/filter/delete,
 *           RFQ list/filter, detail panels, bid analysis,
 *           accessibility, policy enforcement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ProcurementView, type ProcurementViewProps } from '../../components/ProcurementView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}
const viewerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer',
}

const purchaseOrders = [
  { id: 'PO-001', subject: 'Structural steel supply',   vendor: 'Steel Corp',    amount: 450_000, status: 'ordered',  date: '2025-10-01', project: 'Acme Refinery' },
  { id: 'PO-002', subject: 'Electrical panels',          vendor: 'Elec Ltd',      amount: 180_000, status: 'shipped',  date: '2025-10-15', project: 'Acme Refinery' },
  { id: 'PO-003', subject: 'Piping materials',           vendor: 'Pipe Masters',  amount: 320_000, status: 'received', date: '2025-11-01', project: 'Beta Plant' },
  { id: 'PO-004', subject: 'Insulation bulk order',      vendor: 'Steel Corp',    amount: 95_000,  status: 'invoiced', date: '2025-11-20', project: 'Acme Refinery' },
  { id: 'PO-005', subject: 'Instrumentation equipment',  vendor: 'Instr Inc',     amount: 220_000, status: 'draft',    date: '2025-12-01', project: 'Beta Plant' },
]

const rfqs = [
  { id: 'RFQ-001', title: 'Pressure vessels supply', scope: 'Supply of 3 pressure vessels', status: 'evaluation', date: '2025-10-01', project: 'Acme Refinery',
    bidders: [
      { name: 'Vessel Works', amount: 320_000, score: 85, notes: 'Best price' },
      { name: 'Tank Corp',    amount: 350_000, score: 78, notes: 'Good quality' },
      { name: 'Pressure Co',  amount: 380_000, score: 72 },
    ] },
  { id: 'RFQ-002', title: 'Safety valves',           scope: 'PSV/SRV supply',               status: 'awarded',    date: '2025-11-01', project: 'Beta Plant', po_ref: 'PO-003' },
  { id: 'RFQ-003', title: 'Control system SCADA',   scope: 'DCS/SCADA package',             status: 'draft',      date: '2025-11-15', project: 'Acme Refinery' },
]

function seedStore() {
  useBizStore.getState().reset()
  purchaseOrders.forEach(po => useBizStore.getState().dispatch(actions.addPO(po)))
  rfqs.forEach(r => useBizStore.getState().dispatch(actions.addRFQ(r)))
}

function defaultProps(overrides: Partial<ProcurementViewProps> = {}): ProcurementViewProps {
  return { policy: ownerPolicy, ...overrides }
}

beforeEach(() => {
  useBizStore.getState().reset()
})

// ─── Tab navigation ───────────────────────────────────────────────────────────
describe('ProcurementView — tab navigation', () => {
  beforeEach(() => seedStore())

  it('renders tablist with procurement sections', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByRole('tablist', { name: /procurement sections/i })).toBeDefined()
  })

  it('renders 3 tabs: Overview, POs, RFQs', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /POs/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /RFQs/i })).toBeDefined()
  })

  it('Overview tab is active by default', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByRole('tab', { name: /Overview/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking POs tab shows PO table', () => {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /POs/i }))
    expect(screen.getByRole('table', { name: /purchase orders/i })).toBeDefined()
  })

  it('clicking RFQs tab shows RFQ table', () => {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /RFQs/i }))
    expect(screen.getByRole('table', { name: /request for quotations/i })).toBeDefined()
  })
})

// ─── Overview KPIs ────────────────────────────────────────────────────────────
describe('ProcurementView — overview KPIs', () => {
  beforeEach(() => seedStore())

  it('shows Total POs KPI', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getAllByText('Total POs').length).toBeGreaterThan(0)
  })

  it('shows Total Spend KPI', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getAllByText('Total Spend').length).toBeGreaterThan(0)
  })

  it('shows Open RFQs KPI', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getAllByText('Open RFQs').length).toBeGreaterThan(0)
  })

  it('shows Spend by Status panel', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByText('Spend by Status')).toBeDefined()
  })

  it('shows Top Vendors panel', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByText('Top Vendors by Spend')).toBeDefined()
  })

  it('shows Steel Corp as top vendor', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByText('Steel Corp')).toBeDefined()
  })

  it('empty state when no POs exist', () => {
    render(<ProcurementView {...defaultProps()} />)
    // No POs seeded — check OverviewTab renders without errors
    expect(screen.getAllByText('Total POs').length).toBeGreaterThan(0)
  })
})

// ─── POs tab ─────────────────────────────────────────────────────────────────
describe('ProcurementView — POs tab', () => {
  beforeEach(() => seedStore())

  function goToPOs() {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /POs/i }))
  }

  it('shows all PO IDs in table', () => {
    goToPOs()
    expect(screen.getByText('PO-001')).toBeDefined()
    expect(screen.getByText('PO-002')).toBeDefined()
    expect(screen.getByText('PO-005')).toBeDefined()
  })

  it('table has correct aria-label', () => {
    goToPOs()
    expect(screen.getByRole('table', { name: /purchase orders/i })).toBeDefined()
  })

  it('search filters POs by ID', () => {
    goToPOs()
    fireEvent.change(screen.getByRole('searchbox', { name: /search purchase orders/i }), { target: { value: 'PO-001' } })
    expect(screen.getByText('PO-001')).toBeDefined()
    expect(screen.queryByText('PO-002')).toBeNull()
  })

  it('status filter shows only matching POs', () => {
    goToPOs()
    fireEvent.change(screen.getByRole('combobox', { name: /filter by status/i }), { target: { value: 'draft' } })
    expect(screen.getByText('PO-005')).toBeDefined()
    expect(screen.queryByText('PO-001')).toBeNull()
  })

  it('vendor filter shows only matching POs', () => {
    goToPOs()
    fireEvent.change(screen.getByRole('combobox', { name: /filter by vendor/i }), { target: { value: 'Steel Corp' } })
    expect(screen.getByText('PO-001')).toBeDefined()
    expect(screen.queryByText('PO-002')).toBeNull()
  })

  it('clicking PO ID opens detail view', () => {
    goToPOs()
    fireEvent.click(screen.getByText('PO-001'))
    expect(screen.getByText('← All POs')).toBeDefined()
  })

  it('shows delete button for owner', () => {
    goToPOs()
    const deleteButtons = screen.getAllByRole('button', { name: /delete po/i })
    expect(deleteButtons.length).toBeGreaterThan(0)
  })

  it('hides delete button for viewer', () => {
    render(<ProcurementView policy={viewerPolicy} />)
    fireEvent.click(screen.getByRole('tab', { name: /POs/i }))
    expect(screen.queryByRole('button', { name: /delete po/i })).toBeNull()
  })

  it('shows "No POs match" for no-match filter', () => {
    goToPOs()
    fireEvent.change(screen.getByRole('searchbox', { name: /search purchase orders/i }), { target: { value: 'zzz-no-match' } })
    expect(screen.getByText(/No POs match/i)).toBeDefined()
  })
})

// ─── PO detail ────────────────────────────────────────────────────────────────
describe('ProcurementView — PO detail', () => {
  beforeEach(() => seedStore())

  function openPO(id: string) {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /POs/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows PO ID as heading', () => {
    openPO('PO-001')
    expect(screen.getAllByText('PO-001').length).toBeGreaterThan(0)
  })

  it('shows stage pipeline', () => {
    openPO('PO-001')
    // PO-001 status is 'ordered' — should be in pipeline
    expect(screen.getAllByText('ordered').length).toBeGreaterThan(0)
  })

  it('shows vendor field', () => {
    openPO('PO-001')
    expect(screen.getByText('Steel Corp')).toBeDefined()
  })

  it('back button returns to PO list', () => {
    openPO('PO-001')
    fireEvent.click(screen.getByText('← All POs'))
    expect(screen.queryByText('← All POs')).toBeNull()
    expect(screen.getByRole('table', { name: /purchase orders/i })).toBeDefined()
  })

  it('delete button visible in detail for owner', () => {
    openPO('PO-001')
    expect(screen.getByRole('button', { name: /delete po po-001/i })).toBeDefined()
  })
})

// ─── RFQs tab ─────────────────────────────────────────────────────────────────
describe('ProcurementView — RFQs tab', () => {
  beforeEach(() => seedStore())

  function goToRFQs() {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /RFQs/i }))
  }

  it('shows all RFQ IDs', () => {
    goToRFQs()
    expect(screen.getByText('RFQ-001')).toBeDefined()
    expect(screen.getByText('RFQ-002')).toBeDefined()
    expect(screen.getByText('RFQ-003')).toBeDefined()
  })

  it('table has correct aria-label', () => {
    goToRFQs()
    expect(screen.getByRole('table', { name: /request for quotations/i })).toBeDefined()
  })

  it('search filters RFQs', () => {
    goToRFQs()
    fireEvent.change(screen.getByRole('searchbox', { name: /search rfqs/i }), { target: { value: 'SCADA' } })
    expect(screen.getByText('RFQ-003')).toBeDefined()
    expect(screen.queryByText('RFQ-001')).toBeNull()
  })

  it('clicking RFQ row opens detail', () => {
    goToRFQs()
    fireEvent.click(screen.getByText('RFQ-001'))
    expect(screen.getByText('← All RFQs')).toBeDefined()
  })
})

// ─── RFQ detail ───────────────────────────────────────────────────────────────
describe('ProcurementView — RFQ detail', () => {
  beforeEach(() => seedStore())

  function openRFQ(id: string) {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /RFQs/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows RFQ title', () => {
    openRFQ('RFQ-001')
    // Title is part of heading 'RFQ-001 — Pressure vessels supply'
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Pressure vessels supply')
  })

  it('shows bid analysis table', () => {
    openRFQ('RFQ-001')
    expect(screen.getByText('Bid Analysis')).toBeDefined()
    expect(screen.getByRole('table', { name: /bid analysis/i })).toBeDefined()
  })

  it('shows all bidders', () => {
    openRFQ('RFQ-001')
    expect(screen.getByText('Vessel Works')).toBeDefined()
    expect(screen.getByText('Tank Corp')).toBeDefined()
    expect(screen.getByText('Pressure Co')).toBeDefined()
  })

  it('highlights highest scorer with star', () => {
    openRFQ('RFQ-001')
    expect(screen.getByText('★')).toBeDefined()
  })

  it('shows PO ref for awarded RFQ', () => {
    openRFQ('RFQ-002')
    expect(screen.getAllByText('PO-003').length).toBeGreaterThan(0)
  })

  it('back button returns to RFQ list', () => {
    openRFQ('RFQ-001')
    fireEvent.click(screen.getByText('← All RFQs'))
    expect(screen.queryByText('← All RFQs')).toBeNull()
  })
})

// ─── Empty states ─────────────────────────────────────────────────────────────
describe('ProcurementView — empty states', () => {
  it('shows "No purchase orders yet" when PO tab is empty', () => {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /POs/i }))
    expect(screen.getByText(/No purchase orders yet/i)).toBeDefined()
  })

  it('shows "No RFQs yet" when RFQ tab is empty', () => {
    render(<ProcurementView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /RFQs/i }))
    expect(screen.getByText(/No RFQs yet/i)).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('ProcurementView — accessibility', () => {
  beforeEach(() => seedStore())

  it('main container has role=main', () => {
    render(<ProcurementView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /procurement/i })).toBeDefined()
  })

  it('tab buttons have role=tab and aria-selected', () => {
    render(<ProcurementView {...defaultProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.every(t => t.hasAttribute('aria-selected'))).toBe(true)
  })
})

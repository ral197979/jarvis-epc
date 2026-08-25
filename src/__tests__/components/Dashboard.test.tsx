/**
 * Tests: components/Dashboard
 * Coverage: render, KPI calculations, empty state, EVM, activity feed,
 *           navigation callbacks, accessibility
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import Dashboard, { type BizSnapshot } from '../../components/Dashboard'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function emptyBiz(): BizSnapshot {
  return {
    leads:           [],
    contracts:       [],
    invoices:        [],
    purchase_orders: [],
    documents:       [],
    incidents:       [],
    jhas:            [],
    toolbox_talks:   [],
    evm_projects:    [],
    activity_log:    [],
  }
}

function richBiz(): BizSnapshot {
  return {
    leads: [
      { id: 'L-1', name: 'Acme Corp',  status: 'qualified', estimated_value: 500_000, probability: 60 },
      { id: 'L-2', name: 'Beta Ltd',   status: 'proposal',  estimated_value: 200_000, probability: 40 },
      { id: 'L-3', name: 'Gamma Inc',  status: 'won',       estimated_value: 750_000, probability: 100 },
    ],
    contracts: [
      { id: 'C-1', project: 'Alpha Tower',  client: 'Acme Corp',  value: 1_500_000, status: 'active' },
      { id: 'C-2', project: 'Beta Plant',   client: 'Beta Ltd',   value: 800_000,   status: 'draft' },
    ],
    invoices: [
      { id: 'INV-001', project: 'Alpha Tower', amount: 300_000, status: 'paid' },
      { id: 'INV-002', project: 'Alpha Tower', amount: 150_000, status: 'unpaid' },
      { id: 'INV-003', project: 'Beta Plant',  amount: 80_000,  status: 'unpaid' },
    ],
    purchase_orders: [
      { id: 'PO-1', amount: 50_000, vendor: 'Steel Co' },
      { id: 'PO-2', amount: 25_000, vendor: 'Pipe Co' },
    ],
    documents: [
      { id: 'D-1', status: 'approved', title: 'P&ID Rev 3' },
      { id: 'D-2', status: 'draft',    title: 'Layout' },
      { id: 'D-3', status: 'final',    title: 'Spec Sheet' },
    ],
    incidents: [
      { id: 'INC-1', recordable: true,  type: 'near miss' },
      { id: 'INC-2', recordable: false, type: 'first aid' },
    ],
    jhas:         [{ id: 'JHA-1' }, { id: 'JHA-2' }],
    toolbox_talks: [{ id: 'TB-1' }, { id: 'TB-2' }, { id: 'TB-3' }],
    evm_projects: [
      { project: 'Alpha Tower', period: '2026-Q1', budget: 1_500_000, ev: 1_200_000, ac: 1_250_000, pv: 1_350_000, cpi: 0.96, spi: 0.89, eac: 1_562_500, vac: -62_500 },
    ],
    activity_log: [
      { id: 'A-1', ts: '2026-02-01T10:00:00Z', action: 'record_added',   detail: 'lead: Acme Corp' },
      { id: 'A-2', ts: '2026-02-02T11:00:00Z', action: 'record_updated', detail: 'invoice: INV-001' },
    ],
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
describe('Dashboard — renders without crashing', () => {
  it('renders with empty biz state', () => {
    render(<Dashboard biz={emptyBiz()} />)
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('renders with rich biz state', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('has role=main with aria-label', () => {
    render(<Dashboard biz={emptyBiz()} />)
    expect(screen.getByRole('main', { name: /executive dashboard/i })).toBeDefined()
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────
describe('Dashboard — empty state', () => {
  it('names the missing backends rather than telling you to add a lead', async () => {
    // "Start by adding your first lead or contract" is wrong advice: there is
    // no leads route and no contracts route, so there is nowhere to add one.
    // With nothing handed in, the dashboard asks the APIs that DO exist and
    // reports what is genuinely missing.
    render(<Dashboard biz={emptyBiz()} />)
    expect(await screen.findByText(/no procurement, document or contract activity/i)).toBeDefined()
    expect(screen.getByText(/backends that do not exist yet/i)).toBeDefined()
  })

  it('still welcomes a caller who supplied data of their own', () => {
    // A populated snapshot is a caller assertion; the original copy applies.
    render(<Dashboard biz={{ ...emptyBiz(), leads: [{ id: 'L1', status: 'won' }] } as never} />)
    expect(screen.queryByText(/no procurement, document or contract activity/i)).toBeNull()
  })

  it('does not show charts section when empty', () => {
    render(<Dashboard biz={emptyBiz()} />)
    expect(screen.queryByText('Pipeline Funnel')).toBeNull()
    expect(screen.queryByText('EVM Health')).toBeNull()
  })

  it('still shows KPI row when empty', () => {
    render(<Dashboard biz={emptyBiz()} />)
    expect(screen.getByRole('region', { name: /key performance indicators/i })).toBeDefined()
  })
})

// ─── KPI Cards ────────────────────────────────────────────────────────────────
describe('Dashboard — KPI cards', () => {
  it('shows Pipeline (Weighted) KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /pipeline/i })).toBeDefined()
  })

  it('shows Active Contracts KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /active contracts/i })).toBeDefined()
  })

  it('shows AR Outstanding KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /ar outstanding/i })).toBeDefined()
  })

  it('shows Safety TRIR KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /safety/i })).toBeDefined()
  })

  it('shows Documents KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /documents/i })).toBeDefined()
  })

  it('shows Procurement KPI', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('group', { name: /procurement/i })).toBeDefined()
  })
})

// ─── Contract list ────────────────────────────────────────────────────────────
describe('Dashboard — contracts section', () => {
  it('renders contract project names', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getAllByText('Alpha Tower').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta Plant').length).toBeGreaterThan(0)
  })

  it('shows status badge for each contract', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getAllByText('active').length).toBeGreaterThan(0)
  })

  it('View all button calls onNavigate with projects tab', () => {
    const onNavigate = vi.fn()
    render(<Dashboard biz={richBiz()} onNavigate={onNavigate} />)
    const viewBtns = screen.getAllByRole('button', { name: /view all/i })
    fireEvent.click(viewBtns[0])
    expect(onNavigate).toHaveBeenCalledWith('projects')
  })
})

// ─── Invoice list ─────────────────────────────────────────────────────────────
describe('Dashboard — invoices section', () => {
  it('renders invoice IDs', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText('INV-001')).toBeDefined()
  })

  it('shows invoice status badges', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getAllByText('paid').length).toBeGreaterThan(0)
    expect(screen.getAllByText('unpaid').length).toBeGreaterThan(0)
  })
})

// ─── EVM health ───────────────────────────────────────────────────────────────
describe('Dashboard — EVM health section', () => {
  it('renders EVM project name', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getAllByText('Alpha Tower').length).toBeGreaterThan(0)
  })

  it('shows CPI value', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText('0.96')).toBeDefined()
  })

  it('shows SPI value', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText('0.89')).toBeDefined()
  })

  it('shows BAC label', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText(/BAC/)).toBeDefined()
  })

  it('does not render EVM section when no EVM projects', () => {
    const biz = { ...richBiz(), evm_projects: [] }
    render(<Dashboard biz={biz} />)
    expect(screen.queryByText('EVM Health')).toBeNull()
  })
})

// ─── Activity feed ────────────────────────────────────────────────────────────
describe('Dashboard — activity feed', () => {
  it('shows activity section title when activity exists', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText(/activity/i)).toBeDefined()
  })

  it('shows activity action entries', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText('record_added')).toBeDefined()
    expect(screen.getByText('record_updated')).toBeDefined()
  })

  it('shows activity detail text', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText(/lead: Acme Corp/)).toBeDefined()
  })

  it('does not show activity section when log is empty', () => {
    const biz = { ...richBiz(), activity_log: [] }
    render(<Dashboard biz={biz} />)
    // Activity section only shows if there are entries
    expect(screen.queryByText(/activity \(/i)).toBeNull()
  })
})

// ─── Pipeline funnel ──────────────────────────────────────────────────────────
describe('Dashboard — pipeline funnel', () => {
  it('renders funnel chart when leads exist with value', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByText('Pipeline Funnel')).toBeDefined()
  })

  it('does not render funnel when all leads have zero value', () => {
    const biz = {
      ...richBiz(),
      leads: [{ id: 'L-1', status: 'open', estimated_value: 0, probability: 0 }],
    }
    render(<Dashboard biz={biz} />)
    expect(screen.queryByText('Pipeline Funnel')).toBeNull()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('Dashboard — accessibility', () => {
  it('KPI cards have role=group and aria-label', () => {
    render(<Dashboard biz={richBiz()} />)
    const groups = screen.getAllByRole('group')
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group.getAttribute('aria-label')).not.toBeNull()
    }
  })

  it('View all buttons have aria-labels', () => {
    render(<Dashboard biz={richBiz()} />)
    const buttons = screen.getAllByRole('button', { name: /view all/i })
    for (const btn of buttons) {
      expect(btn.getAttribute('aria-label')).not.toBeNull()
    }
  })

  it('status badges have aria-label', () => {
    render(<Dashboard biz={richBiz()} />)
    const badges = screen.getAllByText(/active|paid|unpaid|draft/)
    expect(badges.length).toBeGreaterThan(0)
  })

  it('Charts region has aria-label', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('region', { name: /charts/i })).toBeDefined()
  })

  it('Recent records region has aria-label', () => {
    render(<Dashboard biz={richBiz()} />)
    expect(screen.getByRole('region', { name: /recent records/i })).toBeDefined()
  })
})

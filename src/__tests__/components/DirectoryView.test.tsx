/**
 * Tests: components/DirectoryView
 * Coverage: two tabs (vendors/customers), search, detail panels,
 *           KPI strips, star rating, PO/contract history, accessibility
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { DirectoryView, type DirectoryViewProps } from '../../components/DirectoryView'
import { useBizStore } from '../../modules/biz/store'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const vendors = [
  { id: 'V-001', name: 'Hydranautics', type: 'Equipment OEM', contact: 'Mike Chen',
    email: 'mchen@hydranautics.com', phone: '+1-760-555-0120', location: 'CA',
    specialty: 'RO Membranes', rating: 5, status: 'approved',
    notes: 'Preferred. 8-10 wk lead.', projects: ['Acme Refinery', 'Beta Plant'] },
  { id: 'V-002', name: 'Steel Masters', type: 'Supplier', contact: 'Sarah Lee',
    email: 'sarah@steelmasters.com', phone: '+1-213-555-0200', location: 'TX',
    specialty: 'Structural Steel', rating: 4, status: 'approved',
    notes: 'Competitive pricing.', projects: ['Acme Refinery'] },
  { id: 'V-003', name: 'PipePro Inc', type: 'Subcontractor', contact: 'Dave Brown',
    email: 'dave@pipepro.com', phone: '+1-713-555-0300', location: 'TX',
    specialty: 'Piping', rating: 3, status: 'pending',
    notes: 'Under review.', projects: ['Beta Plant'] },
]

const customers = [
  { id: 'CU-001', name: 'U.S. Department of State', short: 'DOS', type: 'Government',
    contact: 'Ambassador Jones', email: 'jones@state.gov', phone: '+1-202-555-0001',
    address: '2201 C Street NW, DC', contract_vehicle: 'IDIQ', billing: 'Office of PM',
    duns: '123456789', cage: 'ABCD1', projects: ['Acme Refinery'] },
  { id: 'CU-002', name: 'Acme Corporation', short: 'ACME', type: 'Private',
    contact: 'John Exec', email: 'john@acme.com', phone: '+1-310-555-0002',
    address: '100 Acme Blvd, CA', projects: ['Beta Plant'] },
]

const purchaseOrders = [
  { id: 'PO-001', vendor: 'Hydranautics', amount: 450000, status: 'ordered', project: 'Acme Refinery', subject: 'RO Membranes batch 1' },
  { id: 'PO-002', vendor: 'Hydranautics', amount: 180000, status: 'shipped', project: 'Beta Plant',    subject: 'RO Membranes batch 2' },
  { id: 'PO-003', vendor: 'Steel Masters', amount: 320000, status: 'received', project: 'Acme Refinery', subject: 'Structural steel' },
]

const contracts = [
  { id: 'CON-001', project: 'Acme Refinery', value: 5200000, type: 'Lump Sum', status: 'active', client: 'U.S. Department of State' },
  { id: 'CON-002', project: 'Beta Plant',    value: 3100000, type: 'Cost Plus', status: 'active', client: 'ACME' },
]

const invoices = [
  { id: 'INV-001', project: 'Acme Refinery', amount: 1000000, status: 'paid' },
  { id: 'INV-002', project: 'Acme Refinery', amount: 500000,  status: 'submitted' },
]

function defaultProps(overrides: Partial<DirectoryViewProps> = {}): DirectoryViewProps {
  return { policy: ownerPolicy, vendors, customers, purchaseOrders, contracts, invoices, ...overrides }
}

beforeEach(() => { useBizStore.getState().reset() })

// ─── Tab navigation ───────────────────────────────────────────────────────────
describe('DirectoryView — tab navigation', () => {
  it('renders tablist with directory sections', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByRole('tablist', { name: /directory sections/i })).toBeDefined()
  })

  it('has 2 tabs: Vendors and Customers', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getAllByRole('tab').length).toBe(2)
  })

  it('Vendors tab is selected by default', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByRole('tab', { name: /Vendors/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking Customers tab shows customer table', () => {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Customers/i }))
    expect(screen.getByRole('table', { name: /customer directory/i })).toBeDefined()
  })
})

// ─── Vendor list ──────────────────────────────────────────────────────────────
describe('DirectoryView — vendor list', () => {
  it('renders vendor directory table', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByRole('table', { name: /vendor directory/i })).toBeDefined()
  })

  it('shows all vendor names', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByText('Hydranautics')).toBeDefined()
    expect(screen.getByText('Steel Masters')).toBeDefined()
    expect(screen.getByText('PipePro Inc')).toBeDefined()
  })

  it('search filters vendors by name', () => {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search vendors/i }), { target: { value: 'hydra' } })
    expect(screen.getByText('Hydranautics')).toBeDefined()
    expect(screen.queryByText('Steel Masters')).toBeNull()
  })

  it('search filters vendors by specialty', () => {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search vendors/i }), { target: { value: 'piping' } })
    expect(screen.getByText('PipePro Inc')).toBeDefined()
    expect(screen.queryByText('Hydranautics')).toBeNull()
  })

  it('shows "No vendors match" for no-match search', () => {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search vendors/i }), { target: { value: 'zzz-nothing' } })
    expect(screen.getByText(/No vendors match/i)).toBeDefined()
  })

  it('clicking vendor row opens detail', () => {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.click(screen.getByText('Hydranautics'))
    expect(screen.getByText('← Vendors')).toBeDefined()
  })

  it('empty state when no vendors', () => {
    render(<DirectoryView {...defaultProps({ vendors: [] })} />)
    expect(screen.getByText(/No vendors in directory/i)).toBeDefined()
  })
})

// ─── Vendor detail ────────────────────────────────────────────────────────────
describe('DirectoryView — vendor detail', () => {
  function openVendor(name: string) {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.click(screen.getByText(name))
  }

  it('shows vendor name as heading', () => {
    openVendor('Hydranautics')
    expect(screen.getAllByText('Hydranautics').length).toBeGreaterThan(0)
  })

  it('shows vendor type and location', () => {
    openVendor('Hydranautics')
    expect(screen.getByText(/Equipment OEM/i)).toBeDefined()
  })

  it('shows KPI strip with rating', () => {
    openVendor('Hydranautics')
    expect(screen.getAllByText('Rating').length).toBeGreaterThan(0)
    expect(screen.getByText('5/5')).toBeDefined()
  })

  it('shows total spend KPI', () => {
    openVendor('Hydranautics')
    expect(screen.getAllByText('Total Spend').length).toBeGreaterThan(0)
  })

  it('shows contact information', () => {
    openVendor('Hydranautics')
    expect(screen.getByText('Mike Chen')).toBeDefined()
  })

  it('shows project badges', () => {
    openVendor('Hydranautics')
    expect(screen.getAllByText('Acme Refinery').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Beta Plant').length).toBeGreaterThan(0)
  })

  it('shows purchase orders table', () => {
    openVendor('Hydranautics')
    expect(screen.getByRole('table', { name: /vendor purchase orders/i })).toBeDefined()
  })

  it('shows vendor PO IDs', () => {
    openVendor('Hydranautics')
    expect(screen.getByText('PO-001')).toBeDefined()
    expect(screen.getByText('PO-002')).toBeDefined()
  })

  it('back button returns to vendor list', () => {
    openVendor('Hydranautics')
    fireEvent.click(screen.getByText('← Vendors'))
    expect(screen.queryByText('← Vendors')).toBeNull()
    expect(screen.getByRole('table', { name: /vendor directory/i })).toBeDefined()
  })
})

// ─── Customer list ────────────────────────────────────────────────────────────
describe('DirectoryView — customer list', () => {
  function goToCustomers() {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Customers/i }))
  }

  it('shows all customer names', () => {
    goToCustomers()
    expect(screen.getByText('U.S. Department of State')).toBeDefined()
    expect(screen.getByText('Acme Corporation')).toBeDefined()
  })

  it('shows customer short codes', () => {
    goToCustomers()
    expect(screen.getByText('DOS')).toBeDefined()
    expect(screen.getByText('ACME')).toBeDefined()
  })

  it('search filters customers', () => {
    goToCustomers()
    fireEvent.change(screen.getByRole('searchbox', { name: /search customers/i }), { target: { value: 'acme' } })
    expect(screen.getByText('Acme Corporation')).toBeDefined()
    expect(screen.queryByText('U.S. Department of State')).toBeNull()
  })

  it('clicking customer row opens detail', () => {
    goToCustomers()
    fireEvent.click(screen.getByText('U.S. Department of State'))
    expect(screen.getByText('← Customers')).toBeDefined()
  })

  it('says the customer domain has no backend, rather than reporting it empty', () => {
    // P0-11. "No customers in directory" was a claim about DATA. There is no
    // `customers` table in any migration and no customer route on the API, so
    // the only true statement is that the domain is not stored yet — and the
    // empty state has to say which, because the two look identical otherwise.
    render(<DirectoryView {...defaultProps({ customers: [] })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Customers/i }))
    expect(screen.getByText(/Customer directory not available/i)).toBeDefined()
    expect(screen.getByText(/this domain has no backend/i)).toBeDefined()
  })

  it('does not report a customer count it cannot know', () => {
    render(<DirectoryView {...defaultProps({ customers: [] })} />)
    // `0` would assert an empty domain; the domain is unstored, not empty.
    const kpi = screen.getByRole('group', { name: 'Active Customers' })
    expect(kpi.textContent).toContain('—')
    expect(kpi.textContent).not.toMatch(/\b0\b/)
  })
})

// ─── Customer detail ──────────────────────────────────────────────────────────
describe('DirectoryView — customer detail', () => {
  function openCustomer(name: string) {
    render(<DirectoryView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Customers/i }))
    fireEvent.click(screen.getByText(name))
  }

  it('shows customer name', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getAllByText('U.S. Department of State').length).toBeGreaterThan(0)
  })

  it('shows short code badge', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getAllByText('DOS').length).toBeGreaterThan(0)
  })

  it('shows KPI strip with contracts count', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getAllByText('Contracts').length).toBeGreaterThan(0)
  })

  it('shows financial KPIs', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getAllByText('Invoiced').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Collected').length).toBeGreaterThan(0)
  })

  it('shows contact information', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getByText('Ambassador Jones')).toBeDefined()
  })

  it('shows billing info', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getByText('IDIQ')).toBeDefined()
  })

  it('shows contracts table when contracts exist', () => {
    openCustomer('U.S. Department of State')
    expect(screen.getByRole('table', { name: /customer contracts/i })).toBeDefined()
    expect(screen.getByText('CON-001')).toBeDefined()
  })

  it('back button returns to customers list', () => {
    openCustomer('U.S. Department of State')
    fireEvent.click(screen.getByText('← Customers'))
    expect(screen.queryByText('← Customers')).toBeNull()
    expect(screen.getByRole('table', { name: /customer directory/i })).toBeDefined()
  })
})

// ─── KPI header ───────────────────────────────────────────────────────────────
describe('DirectoryView — KPI header', () => {
  it('shows Approved Vendors KPI', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getAllByText('Approved Vendors').length).toBeGreaterThan(0)
  })

  it('shows Active Customers KPI', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getAllByText('Active Customers').length).toBeGreaterThan(0)
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('DirectoryView — accessibility', () => {
  it('has role=main with aria-label', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /directory/i })).toBeDefined()
  })

  it('tab buttons have aria-selected', () => {
    render(<DirectoryView {...defaultProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.every(t => t.hasAttribute('aria-selected'))).toBe(true)
  })

  it('search inputs have aria-labels', () => {
    render(<DirectoryView {...defaultProps()} />)
    expect(screen.getByRole('searchbox', { name: /search vendors/i })).toBeDefined()
  })
})

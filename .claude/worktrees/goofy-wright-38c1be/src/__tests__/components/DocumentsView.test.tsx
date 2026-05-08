/**
 * Tests: components/DocumentsView
 * Coverage: tab navigation, document register filters, document detail,
 *           ISO 19650 ID builder, transmittal list/detail,
 *           CDE state badges, accessibility, empty states
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { DocumentsView, type DocumentsViewProps } from '../../components/DocumentsView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const documents = [
  {
    id: 'LWTP-JIP-XX-ZZ-DR-P-0001',
    title: 'P&ID Sheet 1 - Process Area',
    phase: 'design',
    author: 'Jane Smith',
    date: '2025-10-01',
    project: 'Acme Refinery',
    iso: { proj: 'LWTP', orig: 'JIP', func: 'XX', spatial: 'ZZ', form: 'DR', disc: 'P', num: '0001', suit: 'S4', rev: 'C01', cde: 'published' },
  },
  {
    id: 'LWTP-JIP-XX-ZZ-SP-E-0001',
    title: 'Electrical Equipment Schedule',
    phase: 'design',
    author: 'Bob Jones',
    date: '2025-10-15',
    project: 'Acme Refinery',
    iso: { proj: 'LWTP', orig: 'JIP', func: 'XX', spatial: 'ZZ', form: 'SP', disc: 'E', num: '0001', suit: 'S2', rev: 'P02', cde: 'shared' },
  },
  {
    id: 'LWTP-JIP-XX-ZZ-CA-C-0001',
    title: 'Structural Load Calculation',
    phase: 'design',
    author: 'Alice Lee',
    date: '2025-11-01',
    project: 'Beta Plant',
    iso: { proj: 'LWTP', orig: 'JIP', func: 'XX', spatial: 'ZZ', form: 'CA', disc: 'C', num: '0001', suit: 'S0', rev: 'P01', cde: 'wip' },
  },
  {
    id: 'LWTP-JIP-XX-ZZ-DR-I-0001',
    title: 'Instrument Index',
    phase: 'procurement',
    author: 'Dave Chen',
    date: '2025-11-15',
    project: 'Beta Plant',
    iso: { proj: 'LWTP', orig: 'JIP', func: 'XX', spatial: 'ZZ', form: 'DR', disc: 'I', num: '0001', suit: 'S3', rev: 'P03', cde: 'shared' },
  },
]

const transmittals = [
  {
    id: 'TRM-001',
    subject: 'Issue IFC P&IDs for Review',
    from: 'JIP Engineering',
    to: 'Client Review',
    date: '2025-10-05',
    status: 'sent',
    purpose: 'for-review',
    documents: [
      { id: 'LWTP-JIP-XX-ZZ-DR-P-0001', purpose: 'for-review' },
      { id: 'LWTP-JIP-XX-ZZ-SP-E-0001', purpose: 'for-review' },
    ],
  },
  {
    id: 'TRM-002',
    subject: 'Approved IFC Package',
    from: 'Client Review',
    to: 'JIP Engineering',
    date: '2025-10-20',
    status: 'acknowledged',
    purpose: 'for-construction',
    doc_count: 1,
  },
  {
    id: 'TRM-003',
    subject: 'Structural Calcs for Approval',
    from: 'JIP Engineering',
    to: 'Structural Checker',
    date: '2025-11-05',
    status: 'sent',
    purpose: 'for-approval',
    documents: [{ id: 'LWTP-JIP-XX-ZZ-CA-C-0001', purpose: 'for-approval' }],
  },
]

function seedStore() {
  useBizStore.getState().reset()
  documents.forEach(d => useBizStore.getState().dispatch(actions.addDocument(d)))
}

function defaultProps(overrides: Partial<DocumentsViewProps> = {}): DocumentsViewProps {
  return { policy: ownerPolicy, transmittals, ...overrides }
}

beforeEach(() => {
  useBizStore.getState().reset()
})

// ─── Tab navigation ───────────────────────────────────────────────────────────
describe('DocumentsView — tab navigation', () => {
  beforeEach(() => seedStore())

  it('renders tablist with document sections', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('tablist', { name: /document sections/i })).toBeDefined()
  })

  it('renders 2 tabs', () => {
    render(<DocumentsView {...defaultProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(2)
  })

  it('Document Register tab is active by default', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('tab', { name: /Document Register/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('clicking Transmittals tab shows transmittal table', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Transmittals/i }))
    expect(screen.getByRole('table', { name: /transmittal register/i })).toBeDefined()
  })

  it('shows ISO 19650 naming banner', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByText('ISO 19650-2')).toBeDefined()
  })
})

// ─── Document register ────────────────────────────────────────────────────────
describe('DocumentsView — document register', () => {
  beforeEach(() => seedStore())

  it('shows all document IDs', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeDefined()
    expect(screen.getByText('LWTP-JIP-XX-ZZ-SP-E-0001')).toBeDefined()
    expect(screen.getByText('LWTP-JIP-XX-ZZ-CA-C-0001')).toBeDefined()
  })

  it('table has correct aria-label', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('table', { name: /document register/i })).toBeDefined()
  })

  it('search filters by document ID', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search documents/i }), { target: { value: 'DR-P' } })
    expect(screen.getByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeDefined()
    expect(screen.queryByText('LWTP-JIP-XX-ZZ-SP-E-0001')).toBeNull()
  })

  it('search filters by title', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search documents/i }), { target: { value: 'structural' } })
    expect(screen.getByText('LWTP-JIP-XX-ZZ-CA-C-0001')).toBeDefined()
    expect(screen.queryByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeNull()
  })

  it('discipline filter works', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by discipline/i }), { target: { value: 'P' } })
    expect(screen.getByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeDefined()
    expect(screen.queryByText('LWTP-JIP-XX-ZZ-SP-E-0001')).toBeNull()
  })

  it('CDE state filter works', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by cde state/i }), { target: { value: 'published' } })
    expect(screen.getByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeDefined()
    expect(screen.queryByText('LWTP-JIP-XX-ZZ-CA-C-0001')).toBeNull()
  })

  it('phase filter works', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('combobox', { name: /filter by phase/i }), { target: { value: 'procurement' } })
    expect(screen.getByText('LWTP-JIP-XX-ZZ-DR-I-0001')).toBeDefined()
    expect(screen.queryByText('LWTP-JIP-XX-ZZ-DR-P-0001')).toBeNull()
  })

  it('shows "No documents match" for no-match search', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search documents/i }), { target: { value: 'zzz-no-match' } })
    expect(screen.getByText(/No documents match/i)).toBeDefined()
  })

  it('shows document count', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByText(/4 of 4 documents/i)).toBeDefined()
  })

  it('clicking document opens detail view', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByText('LWTP-JIP-XX-ZZ-DR-P-0001'))
    expect(screen.getByText('← Document Register')).toBeDefined()
  })

  it('shows KPI strip with Total Docs', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getAllByText('Total Docs').length).toBeGreaterThan(0)
  })
})

// ─── Document detail ──────────────────────────────────────────────────────────
describe('DocumentsView — document detail', () => {
  beforeEach(() => seedStore())

  function openDoc(id: string) {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByText(id))
  }

  it('shows ISO 19650 ID banner', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getByText('ISO 19650 CONTAINER ID')).toBeDefined()
  })

  it('shows the full ISO ID in banner', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getAllByText('LWTP-JIP-XX-ZZ-DR-P-0001').length).toBeGreaterThan(0)
  })

  it('shows document title', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getByText('P&ID Sheet 1 - Process Area')).toBeDefined()
  })

  it('shows discipline field', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getAllByText('P').length).toBeGreaterThan(0)
  })

  it('shows revision field', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getByText('C01')).toBeDefined()
  })

  it('shows author field', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    expect(screen.getByText('Jane Smith')).toBeDefined()
  })

  it('back button returns to register', () => {
    openDoc('LWTP-JIP-XX-ZZ-DR-P-0001')
    fireEvent.click(screen.getByText('← Document Register'))
    expect(screen.queryByText('← Document Register')).toBeNull()
    expect(screen.getByRole('table', { name: /document register/i })).toBeDefined()
  })
})

// ─── Transmittals tab ─────────────────────────────────────────────────────────
describe('DocumentsView — transmittals', () => {
  beforeEach(() => seedStore())

  function goToTransmittals() {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Transmittals/i }))
  }

  it('shows all transmittal IDs', () => {
    goToTransmittals()
    expect(screen.getByText('TRM-001')).toBeDefined()
    expect(screen.getByText('TRM-002')).toBeDefined()
    expect(screen.getByText('TRM-003')).toBeDefined()
  })

  it('shows sender (From) column', () => {
    goToTransmittals()
    expect(screen.getAllByText('JIP Engineering').length).toBeGreaterThan(0)
  })

  it('shows receiver (To) column', () => {
    goToTransmittals()
    expect(screen.getAllByText('Client Review').length).toBeGreaterThan(0)
  })

  it('search filters transmittals', () => {
    goToTransmittals()
    fireEvent.change(screen.getByRole('searchbox', { name: /search transmittals/i }), { target: { value: 'structural' } })
    expect(screen.getByText('TRM-003')).toBeDefined()
    expect(screen.queryByText('TRM-001')).toBeNull()
  })

  it('clicking transmittal opens detail', () => {
    goToTransmittals()
    fireEvent.click(screen.getByText('TRM-001'))
    expect(screen.getByText('← Transmittals')).toBeDefined()
  })
})

// ─── Transmittal detail ───────────────────────────────────────────────────────
describe('DocumentsView — transmittal detail', () => {
  beforeEach(() => seedStore())

  function openTransmittal(id: string) {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Transmittals/i }))
    fireEvent.click(screen.getByText(id))
  }

  it('shows transmittal ID heading', () => {
    openTransmittal('TRM-001')
    expect(screen.getAllByText('TRM-001').length).toBeGreaterThan(0)
  })

  it('shows transmittal subject', () => {
    openTransmittal('TRM-001')
    expect(screen.getByText('Issue IFC P&IDs for Review')).toBeDefined()
  })

  it('shows attached documents section', () => {
    openTransmittal('TRM-001')
    expect(screen.getByText(/Attached Documents/i)).toBeDefined()
  })

  it('shows attached document IDs', () => {
    openTransmittal('TRM-001')
    expect(screen.getAllByText('LWTP-JIP-XX-ZZ-DR-P-0001').length).toBeGreaterThan(0)
  })

  it('back button returns to transmittal list', () => {
    openTransmittal('TRM-001')
    fireEvent.click(screen.getByText('← Transmittals'))
    expect(screen.queryByText('← Transmittals')).toBeNull()
    expect(screen.getByRole('table', { name: /transmittal register/i })).toBeDefined()
  })
})

// ─── Empty states ─────────────────────────────────────────────────────────────
describe('DocumentsView — empty states', () => {
  it('shows "No documents yet" when register is empty', () => {
    render(<DocumentsView {...defaultProps({ transmittals: [] })} />)
    expect(screen.getByText(/No documents yet/i)).toBeDefined()
  })

  it('shows "No transmittals recorded" when transmittals list is empty', () => {
    seedStore()
    render(<DocumentsView {...defaultProps({ transmittals: [] })} />)
    fireEvent.click(screen.getByRole('tab', { name: /Transmittals/i }))
    expect(screen.getByText(/No transmittals recorded/i)).toBeDefined()
  })
})

// ─── Accessibility ────────────────────────────────────────────────────────────
describe('DocumentsView — accessibility', () => {
  beforeEach(() => seedStore())

  it('main container has role=main', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('main', { name: /documents/i })).toBeDefined()
  })

  it('tab buttons have role=tab', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getAllByRole('tab').length).toBe(2)
  })

  it('active tab has aria-selected=true', () => {
    render(<DocumentsView {...defaultProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Transmittals/i }))
    expect(screen.getByRole('tab', { name: /Transmittals/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Document Register/i }).getAttribute('aria-selected')).toBe('false')
  })

  it('search inputs have aria-labels', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('searchbox', { name: /search documents/i })).toBeDefined()
  })

  it('filter dropdowns have aria-labels', () => {
    render(<DocumentsView {...defaultProps()} />)
    expect(screen.getByRole('combobox', { name: /filter by discipline/i })).toBeDefined()
    expect(screen.getByRole('combobox', { name: /filter by cde state/i })).toBeDefined()
  })
})

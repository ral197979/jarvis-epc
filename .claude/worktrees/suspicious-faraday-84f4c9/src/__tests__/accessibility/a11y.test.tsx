/**
 * JARVIS EPC — Accessibility Tests (P1-D)
 * ─────────────────────────────────────────
 * Automated WCAG 2.1 / axe-core audit for key components.
 * Runs in CI via `npm test` — zero axe violations required.
 *
 * Coverage:
 *   - Dashboard (high-traffic, KPI-dense)
 *   - StatusBadge (widely used primitive)
 *   - KpiCard (widely used primitive)
 *   - DirectoryView (complex vendor/customer table)
 *
 * Axe rules applied: wcag2a, wcag2aa, best-practice
 * Exceptions documented inline with rationale.
 */

import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, it, expect, vi } from 'vitest'

expect.extend(toHaveNoViolations)

// ─── Shared mocks ─────────────────────────────────────────────────────────────
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'recharts-container' }, children),
  BarChart:   ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  LineChart:  ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  PieChart:   ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Bar:        () => null,
  Line:       () => null,
  Pie:        () => null,
  Cell:       () => null,
  XAxis:      () => null,
  YAxis:      () => null,
  CartesianGrid: () => null,
  Tooltip:    () => null,
}))

// ─── Axe config — shared across all tests ─────────────────────────────────────
const AXE_CONFIG = {
  rules: {
    // 'color-contrast' produces false positives with CSS vars in jsdom (resolve to transparent).
    // Validated manually against design tokens — WCAG AA ratios confirmed.
    'color-contrast': { enabled: false },
  },
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
import Dashboard, { type BizSnapshot } from '../../components/Dashboard'

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

describe('Accessibility — Dashboard', () => {
  it('has no axe violations in empty state', async () => {
    const { container } = render(
      React.createElement(Dashboard, {
        biz:        emptyBiz(),
        onNavigate: vi.fn(),
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations with data', async () => {
    const { container } = render(
      React.createElement(Dashboard, {
        biz: {
          ...emptyBiz(),
          leads:     [{ id: 'L-1', name: 'Acme', status: 'qualified', estimated_value: 500_000, probability: 60 }],
          contracts: [{ id: 'C-1', project: 'Tower', client: 'Acme', value: 1_000_000, status: 'active' }],
          invoices:  [{ id: 'I-1', project: 'Tower', amount: 100_000, status: 'paid' }],
        },
        onNavigate: vi.fn(),
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })
})

// ─── StatusBadge ──────────────────────────────────────────────────────────────
import { StatusBadge } from '../../components/StatusBadge'

describe('Accessibility — StatusBadge', () => {
  // Test a selection of status values (full list in StatusBadge.tsx)
  const statuses = ['active', 'draft', 'pending', 'approved', 'rejected', 'complete', 'in-progress', 'on-hold']

  statuses.forEach(status => {
    it(`has no axe violations for status="${status}"`, async () => {
      const { container } = render(
        React.createElement(StatusBadge, { status })
      )
      const results = await axe(container, AXE_CONFIG)
      expect(results).toHaveNoViolations()
    })
  })
})

// ─── KpiCard ──────────────────────────────────────────────────────────────────
import { KpiCard } from '../../components/KpiCard'

describe('Accessibility — KpiCard', () => {
  it('has no axe violations with label and value', async () => {
    const { container } = render(
      React.createElement(KpiCard, {
        label: 'Total Revenue',
        value: '$1.2M',
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations with sub text', async () => {
    const { container } = render(
      React.createElement(KpiCard, {
        label: 'Projects',
        value: 12,
        sub:   '3 active this month',
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })
})

// ─── DirectoryView ────────────────────────────────────────────────────────────
import { DirectoryView } from '../../components/DirectoryView'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const defaultPolicy: PolicyConfig = {
  writesEnabled:  false,
  chatEnabled:    true,
  exportsEnabled: true,
  activeRole:     'owner',
}

describe('Accessibility — DirectoryView', () => {
  it('has no axe violations with empty data', async () => {
    const { container } = render(
      React.createElement(DirectoryView, {
        policy: defaultPolicy,
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })

  it('has no axe violations with vendor and customer rows', async () => {
    const { container } = render(
      React.createElement(DirectoryView, {
        policy:   defaultPolicy,
        vendors:  [
          { id: 'V-1', name: 'Steel Corp', type: 'vendor',   status: 'active', contact: 'Jane', phone: '555-0100', email: 'j@steel.com' },
        ],
        customers: [
          { id: 'C-1', name: 'Acme Ltd',   type: 'customer', status: 'active', contact: 'Bob',  phone: '555-0200', email: 'b@acme.com'  },
        ],
        onNavigate: vi.fn(),
        onAudit:    vi.fn(),
        onToast:    vi.fn(),
      })
    )
    const results = await axe(container, AXE_CONFIG)
    expect(results).toHaveNoViolations()
  })
})

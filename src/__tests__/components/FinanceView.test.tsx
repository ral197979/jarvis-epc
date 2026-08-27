/**
 * FinanceView — the screen the nav calls "Portfolio".
 *
 * It renders six financial KPIs from three store collections — `invoices`,
 * `expenses`, `journal` — and NONE of the three has a backend. No migration
 * creates an invoices, expenses or journal table and no route serves one. The
 * only invoice table in the schema is `subcontract_invoices` (migration 059), a
 * project-scoped subcontractor payable nested under
 * GET /api/v1/subcontracts/:id/invoices: a different domain, and not a ledger.
 *
 * This is not the usual unwired-screen case, and the tests say why. An empty
 * LIST is a weak claim. "Collected $0" and "Net Position $0" are FINANCIAL
 * ASSERTIONS that a reader cannot distinguish from a company which genuinely
 * billed nothing — so an unstored total has to read `—`.
 *
 * And the Add controls really do write, into a store that never persists. A
 * user can enter a real invoice, watch it appear, and lose it on refresh. The
 * controls are kept — a session scratchpad is legitimate — but the tests hold
 * that the impermanence is stated up front rather than discovered afterwards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { FinanceView } from '../../components/FinanceView'
import { useBizStore } from '../../modules/biz/store'
import { JARVIS_ACTIONS } from '../../modules/biz/reducer'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const kpi = (name: string) => screen.getByRole('group', { name })

beforeEach(() => { useBizStore.getState().reset() })

describe('an unstored ledger does not report zero', () => {
  it('shows a dash, not $0, for every money KPI on a fresh session', () => {
    render(<FinanceView />)
    for (const label of ['Total Invoiced', 'Collected', 'Outstanding', 'Total Expenses', 'Net Position']) {
      expect(kpi(label).textContent, `${label} must not assert a figure`).toContain('—')
      expect(kpi(label).textContent, `${label} must not read $0`).not.toContain('$0')
    }
  })

  it('shows a dash for the journal entry count too', () => {
    render(<FinanceView />)
    expect(kpi('Journal Entries').textContent).toContain('—')
  })

  it('states that this is not connected to accounting', () => {
    render(<FinanceView />)
    expect(screen.getByRole('note')).toBeDefined()
    expect(screen.getByText(/Not connected to accounting/i)).toBeDefined()
  })

  it('warns that entries are not saved before any are made', () => {
    // The warning has to precede the data loss, not follow it.
    render(<FinanceView />)
    expect(screen.getByText(/not saved/i)).toBeDefined()
    expect(screen.getByText(/stays in this browser session/i)).toBeDefined()
  })

  it('keeps the warning up once entries exist', () => {
    useBizStore.getState().dispatch({
      type: JARVIS_ACTIONS.ADD_INVOICE,
      data: { id: 'INV-1', description: 'Session entry', amount: 5000, status: 'unpaid' },
    } as never)
    render(<FinanceView policy={ownerPolicy} />)
    expect(screen.getByRole('note')).toBeDefined()
  })
})

describe('a real figure appears the moment there is something to total', () => {
  it('reports session invoices honestly rather than staying dashed', () => {
    // The dash means "nothing stored", not "never show a number". For the
    // session in which they were entered, these totals are true.
    useBizStore.getState().dispatch({
      type: JARVIS_ACTIONS.ADD_INVOICE,
      data: { id: 'INV-1', description: 'Paid job', amount: 250000, status: 'paid' },
    } as never)
    render(<FinanceView policy={ownerPolicy} />)
    expect(kpi('Total Invoiced').textContent).toContain('250K')
    expect(kpi('Collected').textContent).toContain('250K')
    expect(kpi('Total Invoiced').textContent).not.toContain('—')
  })

  it('leaves expenses dashed while only invoices exist', () => {
    // Each total is dashed on its OWN collection. Bleeding one domain's
    // presence into another would re-assert a figure nobody entered.
    useBizStore.getState().dispatch({
      type: JARVIS_ACTIONS.ADD_INVOICE,
      data: { id: 'INV-1', description: 'Paid job', amount: 250000, status: 'paid' },
    } as never)
    render(<FinanceView policy={ownerPolicy} />)
    expect(kpi('Total Expenses').textContent).toContain('—')
  })

  it('computes Net Position once either side has data', () => {
    useBizStore.getState().dispatch({
      type: JARVIS_ACTIONS.ADD_EXPENSE,
      data: { id: 'EXP-1', description: 'Plant hire', amount: 40000 },
    } as never)
    render(<FinanceView policy={ownerPolicy} />)
    expect(kpi('Net Position').textContent).not.toContain('—')
    expect(kpi('Total Expenses').textContent).toContain('40K')
  })
})

describe('the screen still works as a session scratchpad', () => {
  it('renders its tabs', () => {
    render(<FinanceView />)
    expect(screen.getByRole('tab', { name: /Summary/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Invoices/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Journal/i })).toBeDefined()
  })

  it('switches to the invoices tab', () => {
    render(<FinanceView />)
    fireEvent.click(screen.getByRole('tab', { name: /Invoices/i }))
    expect(screen.getByRole('tab', { name: /Invoices/i }).getAttribute('aria-selected')).toBe('true')
  })
})

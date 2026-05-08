import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { CRMView } from '../../components/CRMView'

/**
 * v4.31.0 update: CRMView was migrated to Zustand (`useBizStore`) — it no longer
 * accepts a `biz` prop and uses `role="main" aria-label="CRM"` as its landmark
 * instead of a labelled `<h1>` heading. Tests updated to match current contract.
 */
describe('CRMView', () => {
  it('renders without crashing and exposes the CRM landmark', () => {
    render(React.createElement(CRMView))
    expect(screen.getByRole('main', { name: /CRM/i })).toBeInTheDocument()
  })

  it('shows the KPI grid with key labels', () => {
    render(React.createElement(CRMView))
    expect(screen.getByText('Total Leads')).toBeInTheDocument()
    expect(screen.getByText('Pipeline Value')).toBeInTheDocument()
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
  })

  it('renders the overview/leads tab switcher', () => {
    render(React.createElement(CRMView))
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leads/i })).toBeInTheDocument()
  })

  it('renders the Sales Pipeline section', () => {
    render(React.createElement(CRMView))
    expect(screen.getByText(/Sales Pipeline/i)).toBeInTheDocument()
  })

  it('shows a zero win rate when no leads are present', () => {
    render(React.createElement(CRMView))
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })
})

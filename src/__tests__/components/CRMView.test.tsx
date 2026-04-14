import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { CRMView } from '../../components/CRMView'

describe('CRMView', () => {
  it('renders the CRM heading', () => {
    render(React.createElement(CRMView))
    expect(screen.getByRole('heading', { name: /CRM/i })).toBeInTheDocument()
  })

  it('sets data-view attribute', () => {
    const { container } = render(React.createElement(CRMView))
    expect(container.querySelector('[data-view="crm"]')).toBeTruthy()
  })

  it('shows zero counts with empty biz', () => {
    render(React.createElement(CRMView, { biz: {} }))
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })

  it('shows populated counts', () => {
    render(React.createElement(CRMView, {
      biz: { leads: [{}, {}, {}], contracts: [{}] }
    }))
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders KPI labels', () => {
    render(React.createElement(CRMView))
    expect(screen.getByText('Leads')).toBeInTheDocument()
    expect(screen.getByText('Contracts')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ConstructionView } from '../../components/ConstructionView'

describe('ConstructionView', () => {
  it('renders the heading', () => {
    render(React.createElement(ConstructionView))
    expect(screen.getByRole('heading', { name: /Construction Management/i })).toBeInTheDocument()
  })

  it('sets data-view attribute', () => {
    const { container } = render(React.createElement(ConstructionView))
    expect(container.querySelector('[data-view="construction"]')).toBeTruthy()
  })

  it('shows zero counts when biz is empty', () => {
    render(React.createElement(ConstructionView, { biz: {} }))
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(3)
  })

  it('renders populated counts from biz prop', () => {
    render(React.createElement(ConstructionView, {
      biz: { subcontracts: [{}, {}], rfis: [{}], submittals: [{}, {}, {}] }
    }))
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders KPI labels', () => {
    render(React.createElement(ConstructionView))
    expect(screen.getByText('Subcontracts')).toBeInTheDocument()
    expect(screen.getByText('Open RFIs')).toBeInTheDocument()
    expect(screen.getByText('Submittals')).toBeInTheDocument()
  })
})

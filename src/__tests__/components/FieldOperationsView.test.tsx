import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { FieldOperationsView } from '../../components/FieldOperationsView'

describe('FieldOperationsView', () => {
  it('renders the Field Operations heading', () => {
    render(React.createElement(FieldOperationsView))
    expect(screen.getByRole('heading', { name: /Field Operations/i })).toBeInTheDocument()
  })

  it('sets data-view attribute', () => {
    const { container } = render(React.createElement(FieldOperationsView))
    expect(container.querySelector('[data-view="field-operations"]')).toBeTruthy()
  })

  it('shows zero counts with empty biz', () => {
    render(React.createElement(FieldOperationsView, { biz: {} }))
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(3)
  })

  it('reflects populated biz data in KPIs', () => {
    render(React.createElement(FieldOperationsView, {
      biz: { installations: [{}, {}], manpower: [{}, {}, {}], field_reports: [{}] }
    }))
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders KPI labels', () => {
    render(React.createElement(FieldOperationsView))
    expect(screen.getByText('Installations')).toBeInTheDocument()
    expect(screen.getByText('Manpower Records')).toBeInTheDocument()
    expect(screen.getByText('Field Reports')).toBeInTheDocument()
  })
})

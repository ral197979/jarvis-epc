import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { FieldOperationsView } from '../../components/FieldOperationsView'

/**
 * v4.31.0 update: FieldOperationsView is a tabbed shell (Field | Tracking) that
 * wraps child views which may render their own `role="main"` landmark. We query
 * with getAllByRole where multiple landmarks are expected.
 */
describe('FieldOperationsView', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(FieldOperationsView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Field Operations landmark', () => {
    render(React.createElement(FieldOperationsView))
    const landmarks = screen.getAllByRole('main', { name: /Field Operations/i })
    expect(landmarks.length).toBeGreaterThanOrEqual(1)
  })

  it('accepts optional biz prop without erroring', () => {
    const { container } = render(React.createElement(FieldOperationsView, {
      biz: { installations: [{}, {}] },
    }))
    expect(container.firstChild).toBeTruthy()
  })

  it('accepts optional policy prop without erroring', () => {
    const { container } = render(React.createElement(FieldOperationsView, {
      policy: { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' },
    }))
    expect(container.firstChild).toBeTruthy()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ConstructionView } from '../../components/ConstructionView'

/**
 * v4.31.0 update: ConstructionView now uses `role="main" aria-label="Construction"`,
 * has a tabbed layout (Overview | Jobs | Equipment | Tracking) where each tab is
 * `role="tab"` inside a `role="tablist"`, and its children (WView/JobsView/...) may
 * themselves render `role="main"` landmarks. Queries use getAllByRole where needed.
 */
describe('ConstructionView', () => {
  it('renders without crashing', () => {
    const { container } = render(React.createElement(ConstructionView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Construction landmark', () => {
    render(React.createElement(ConstructionView))
    const landmarks = screen.getAllByRole('main', { name: /Construction/i })
    expect(landmarks.length).toBeGreaterThanOrEqual(1)
  })

  it('renders all four tab buttons with correct labels', () => {
    render(React.createElement(ConstructionView))
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Jobs/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Equipment/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Tracking/i })).toBeInTheDocument()
  })

  it('has exactly one tablist', () => {
    render(React.createElement(ConstructionView))
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('accepts optional biz prop and callbacks without erroring', () => {
    const onNavigate = () => undefined
    const onToast = () => undefined
    const { container } = render(React.createElement(ConstructionView, {
      biz: { subcontracts: [{}, {}] }, onNavigate, onToast,
    }))
    expect(container.firstChild).toBeTruthy()
  })
})

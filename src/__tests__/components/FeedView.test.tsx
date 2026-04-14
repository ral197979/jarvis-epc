import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { FeedView } from '../../components/FeedView'

describe('FeedView', () => {
  it('renders the FEED Study heading', () => {
    render(React.createElement(FeedView))
    expect(screen.getByRole('heading', { name: /FEED Study/i })).toBeInTheDocument()
  })

  it('sets data-view attribute', () => {
    const { container } = render(React.createElement(FeedView))
    expect(container.querySelector('[data-view="feed"]')).toBeTruthy()
  })

  it('shows zero counts with empty biz', () => {
    render(React.createElement(FeedView, { biz: {} }))
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(3)
  })

  it('reflects populated biz data in KPIs', () => {
    render(React.createElement(FeedView, {
      biz: { feed_studies: [{}, {}], deliverables: [{}], tech_selections: [{}, {}, {}] }
    }))
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders KPI labels', () => {
    render(React.createElement(FeedView))
    expect(screen.getByText('FEED Studies')).toBeInTheDocument()
    expect(screen.getByText('Deliverables')).toBeInTheDocument()
    expect(screen.getByText('Tech Selections')).toBeInTheDocument()
  })
})

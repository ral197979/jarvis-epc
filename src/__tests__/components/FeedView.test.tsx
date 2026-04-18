import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { FeedView } from '../../components/FeedView'

/**
 * v4.31.0 update: FeedView was migrated to Zustand (`useBizStore`) and is now a
 * finance-feed (journal/transaction stream), not a FEED-Studies register.
 * It uses `role="main" aria-label="Finance Feed"` as its landmark. Tests
 * updated to match current contract.
 */
describe('FeedView', () => {
  it('renders without crashing and exposes the Finance Feed landmark', () => {
    render(React.createElement(FeedView))
    expect(screen.getByRole('main', { name: /Finance Feed/i })).toBeInTheDocument()
  })

  it('accepts optional policy prop without erroring', () => {
    render(React.createElement(FeedView, {
      policy: { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer' },
    }))
    expect(screen.getByRole('main', { name: /Finance Feed/i })).toBeInTheDocument()
  })

  it('accepts onAudit and onToast callbacks without erroring', () => {
    const onAudit = () => undefined
    const onToast = () => undefined
    render(React.createElement(FeedView, { onAudit, onToast }))
    expect(screen.getByRole('main', { name: /Finance Feed/i })).toBeInTheDocument()
  })
})

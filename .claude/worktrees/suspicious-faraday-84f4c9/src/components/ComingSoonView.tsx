/**
 * JARVIS EPC — ComingSoonView
 * ─────────────────────────────
 * Shared "Coming Soon" placeholder for views under active extraction.
 * Replaces opaque "Panel Xx view — Phase Xb" stubs with owner-communicative UX.
 *
 * Audit P1: All extraction stubs must communicate intent, not confusion.
 * v4.23.0
 */
import React from 'react'

export interface ComingSoonViewProps {
  /** Short display name of the view (e.g. "Build Notes") */
  label: string
  /** EPC domain category (e.g. "Construction", "Finance") */
  domain: string
  /** Emoji icon representing the domain */
  icon?: string
  /** Internal view ID for data-view attribute */
  viewId: string
  /** Optional extra context shown in the sub-heading */
  context?: string
}

export function ComingSoonView({
  label,
  domain,
  icon = '🔧',
  viewId,
  context,
}: ComingSoonViewProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-view': viewId,
      role: 'main',
      'aria-label': `${label} — Coming Soon`,
      style: {
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        minHeight:      '320px',
        padding:        '2rem',
        textAlign:      'center',
        gap:            '1rem',
      },
    },
    // Icon
    React.createElement(
      'div',
      {
        'aria-hidden': 'true',
        style: { fontSize: '2.5rem', lineHeight: 1 },
      },
      icon,
    ),
    // Domain badge
    React.createElement(
      'span',
      {
        style: {
          fontSize:        '0.7rem',
          fontWeight:      700,
          letterSpacing:   '0.12em',
          textTransform:   'uppercase',
          color:           'var(--jarvis-acc, #38bdf8)',
          background:      'rgba(56,189,248,0.08)',
          border:          '1px solid rgba(56,189,248,0.2)',
          borderRadius:    '4px',
          padding:         '2px 8px',
        },
      },
      domain,
    ),
    // View label
    React.createElement(
      'h2',
      {
        style: {
          fontSize:   '1.25rem',
          fontWeight: 700,
          margin:     0,
          color:      'var(--jarvis-tx, #f1f5f9)',
        },
      },
      label,
    ),
    // Status message
    React.createElement(
      'p',
      {
        style: {
          fontSize:  '0.875rem',
          color:     'var(--jarvis-td, #94a3b8)',
          maxWidth:  '380px',
          margin:    0,
          lineHeight: 1.5,
        },
      },
      context ?? 'This module is being extracted from the core and will be available in a forthcoming release.',
    ),
    // Status pill
    React.createElement(
      'div',
      {
        style: {
          display:      'flex',
          alignItems:   'center',
          gap:          '6px',
          fontSize:     '0.75rem',
          color:        'var(--jarvis-amb, #f59e0b)',
          background:   'rgba(245,158,11,0.08)',
          border:       '1px solid rgba(245,158,11,0.2)',
          borderRadius: '6px',
          padding:      '4px 12px',
          marginTop:    '0.5rem',
        },
      },
      React.createElement('span', { 'aria-hidden': 'true' }, '🚧'),
      React.createElement('span', null, 'In Active Development'),
    ),
  )
}

export default ComingSoonView

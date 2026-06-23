/**
 * Denver Engineering — ErrorBoundary (P2-2)
 * ──────────────────────────────────────────
 * Catches unhandled React render errors in child view components and shows
 * a recoverable error card instead of crashing the whole application shell.
 *
 * Usage (already wired into ContentRouter):
 *   <ViewErrorBoundary viewId="crm">
 *     <CRMView />
 *   </ViewErrorBoundary>
 */

import React from 'react'

interface Props {
  viewId:    string
  children:  React.ReactNode
}

interface State {
  hasError:  boolean
  error:     Error | null
}

export class ViewErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production a real observability sink (Sentry, Datadog) would go here.
    console.error(`[ViewErrorBoundary] view="${this.props.viewId}"`, error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const msg = this.state.error?.message ?? 'Unknown render error'
    const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV

    return (
      <div style={{
        padding:        32,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        minHeight:      300,
        gap:            16,
        color:          'var(--jarvis-text, #e2e8f0)',
        fontFamily:     'var(--jarvis-font, system-ui)',
      }}>
        <span style={{ fontSize: 36 }} aria-hidden>⚠️</span>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
            Something went wrong in the {this.props.viewId} view.
          </p>
          {isDev && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--jarvis-ts, #94a3b8)', maxWidth: 480 }}>
              {msg}
            </p>
          )}
        </div>
        <button
          onClick={this.handleReset}
          style={{
            padding:      '8px 20px',
            background:   '#1e40af',
            color:        '#fff',
            border:       'none',
            borderRadius: 6,
            cursor:       'pointer',
            fontSize:     13,
            fontWeight:   600,
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}

/**
 * JARVIS EPC — ErrorBoundary component
 * ──────────────────────────────────────
 * Sprint 8 (v4.31.0): Extracted from JarvisCore.jsx (_JarvisErrorBoundary class).
 *
 * Catches unhandled React render errors and displays a recovery UI.
 * Preserves all original behavior including the _logError / _sessionMetrics
 * side-effects (callers can wire those in via onError prop if needed;
 * the default implementation logs to the console, matching the original).
 */

import React from 'react'

interface State {
  hasError:  boolean
  error:     Error | null
  errorInfo: React.ErrorInfo | null
}

interface Props {
  children:   React.ReactNode
  /** Optional callback — called with (error, info) after componentDidCatch */
  onError?:   (error: Error, info: React.ErrorInfo) => void
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ errorInfo: info })
    console.error('[JARVIS] Unhandled error caught by ErrorBoundary:', error, info)
    this.props.onError?.(error, info)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          background: 'var(--jarvis-bg)', color: 'var(--jarvis-tx)', height: '100vh',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
          padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--jarvis-red)' }}>
            JARVIS — Runtime Error
          </h1>
          <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', marginBottom: 20, maxWidth: 500 }}>
            An unhandled error occurred. Your data has been preserved in local storage. Click below to reload.
          </p>
          <pre style={{
            fontSize: 10, color: 'var(--jarvis-amb)', background: 'var(--jarvis-cd)',
            padding: 12, borderRadius: 8,
            border: 'var(--jarvis-border-width, 1px) solid var(--jarvis-bd)',
            maxWidth: 600, overflow: 'auto', marginBottom: 20,
            textAlign: 'left', maxHeight: 200,
          }}>
            {String(this.state.error)}
          </pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--jarvis-ac)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ↻ Reload App
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              style={{
                background: 'var(--jarvis-cd)', color: 'var(--jarvis-ts)',
                border: 'var(--jarvis-border-width, 1px) solid var(--jarvis-bd)',
                borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Try to Recover
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

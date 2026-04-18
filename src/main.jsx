import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// ─── Phase 5: CSS entry point — tokens + utilities ────────────────────────────
// Provides var(--jarvis-bg), .jarvis-card, .jarvis-btn etc.
import './styles/index.css'

// ─── P0-A: Gateway mode initialisation from build-time env vars ───────────────
// VITE_GATEWAY_MODE and VITE_BACKEND_URL are injected at build time by Vite.
// They must be read HERE — before any module that consumes gatewayMode.
// In production: set VITE_GATEWAY_MODE=proxied in deployment env vars.
// In development: .env.local defaults to proxied; set to 'direct' only for local-only dev.
import { setGatewayMode, setBackendBase } from './modules/store'
import { installAutoFlush } from './modules/offlineQueue'

// v4.31.0: PWA offline queue — install 'online' + SW listeners so that
// pending mutations captured while offline auto-replay on reconnection.
// Safe to call unconditionally; installAutoFlush short-circuits in SSR
// or when IndexedDB is unavailable.
installAutoFlush()

const _rawGatewayMode = import.meta.env.VITE_GATEWAY_MODE
const _rawBackendUrl  = import.meta.env.VITE_BACKEND_URL ?? ''

if (_rawGatewayMode === 'proxied' || _rawGatewayMode === 'direct') {
  setGatewayMode(_rawGatewayMode)
  if (_rawGatewayMode === 'proxied') {
    setBackendBase(_rawBackendUrl)
  }
} else if (_rawGatewayMode) {
  console.warn(`[JARVIS] Unknown VITE_GATEWAY_MODE="${_rawGatewayMode}" — defaulting to "direct". Set to "proxied" for production.`)
} else {
  // No env var set — warn loudly in production builds
  if (import.meta.env.PROD) {
    console.warn('[JARVIS] ⚠  VITE_GATEWAY_MODE not set — defaulting to "direct". Set VITE_GATEWAY_MODE=proxied in production.')
  }
}

// ─── Error boundary for top-level crash recovery ──────────────────────────
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo })
    // Log to console for debugging — replace with proper logging in Phase 3
    console.error('[JARVIS] Root error boundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#08090d',
          color: '#e8ecf4',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }
      },
        React.createElement('h1', { style: { color: '#ef4444', marginBottom: '1rem' } }, '⚠ JARVIS — Critical Error'),
        React.createElement('p', { style: { color: '#8892a6', marginBottom: '2rem' } },
          'The application encountered an unrecoverable error.'
        ),
        React.createElement('pre', {
          style: {
            background: '#0e1015',
            border: '1px solid #1e2230',
            borderRadius: '8px',
            padding: '1rem',
            fontSize: '12px',
            color: '#f59e0b',
            textAlign: 'left',
            maxWidth: '800px',
            overflow: 'auto',
          }
        }, String(this.state.error)),
        React.createElement('button', {
          onClick: () => window.location.reload(),
          style: {
            marginTop: '2rem',
            padding: '0.75rem 2rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }
        }, 'Reload Application')
      )
    }
    return this.props.children
  }
}

// ─── Mount ─────────────────────────────────────────────────────────────────
const container = document.getElementById('root')

if (!container) {
  throw new Error('[JARVIS] Root element #root not found in DOM')
}

const root = createRoot(container)

root.render(
  React.createElement(RootErrorBoundary, null,
    React.createElement(App)
  )
)

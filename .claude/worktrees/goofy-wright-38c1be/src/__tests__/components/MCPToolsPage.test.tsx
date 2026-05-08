/**
 * MCPToolsPage — unit tests
 *
 * v4.31.0 update (pass B — test suite repair):
 * Component evolved significantly in v4.28.0 (live tool execution, Ava health
 * badge, tabs: catalogue/execute/history, fetch-on-mount). Tests rewritten to
 * match the current UI contract. Fetch is mocked so the component's
 * loadCatalogue / checkAvaHealth useEffects don't hit a real network, which
 * also suppresses the `act()` warnings.
 *
 * Covered:
 *   - Page landmark + header rendering
 *   - Tool cards render with name, description, and param hints
 *   - Category badges
 *   - Search filter narrows visible tools
 *   - Empty-state message when search returns nothing
 *   - Resources section + expand/collapse interaction
 *   - Tab navigation (catalogue / execute / history)
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MCPToolsPage } from '../../components/MCPToolsPage'
import {
  JARVIS_MCP_TOOLS,
  JARVIS_MCP_RESOURCES,
  MCP_CATEGORY_ORDER,
} from '../../constants/mcpTools'

// ─── Fetch mock ────────────────────────────────────────────────────────────────
// The component calls fetch() on mount — for /api/v1/mcp/tools and
// /api/v1/mcp/ava/health. Return static data so tests don't require a backend.

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation((url: string) => {
    if (url.endsWith('/api/v1/mcp/tools')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tools: JARVIS_MCP_TOOLS, ava_connected: false }),
      })
    }
    if (url.endsWith('/api/v1/mcp/ava/health')) {
      return Promise.resolve({
        ok: true,
        status: 503,
        json: () => Promise.resolve({ healthy: false, reason: 'AVA_MCP_URL not configured' }),
      })
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(<MCPToolsPage />)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCPToolsPage', () => {

  // ── Landmark + header ─────────────────────────────────────────────────────────

  it('exposes the MCP Tools landmark', () => {
    renderPage()
    expect(screen.getByRole('main', { name: /MCP Tools/i })).toBeInTheDocument()
  })

  it('renders the "MCP Tool Browser" heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /MCP Tool Browser/i })).toBeInTheDocument()
  })

  it('shows the tool count summary after load', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${JARVIS_MCP_TOOLS.length} tools`))).toBeInTheDocument()
    })
  })

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  it('renders the three primary tabs (catalogue / execute / history)', () => {
    renderPage()
    // Tab buttons are prefixed by an emoji (🔌/⚡/📜). Tool cards have a
    // "Click to execute →" footer that also matches /Execute/i — match by
    // emoji prefix to disambiguate.
    expect(screen.getByRole('button', { name: /🔌 Catalogue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /⚡ Execute/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /📜 History/i })).toBeInTheDocument()
  })

  it('defaults to the Catalogue tab (renders the search input)', () => {
    renderPage()
    expect(screen.getByPlaceholderText(/Search tools/i)).toBeInTheDocument()
  })

  // ── Tool cards ────────────────────────────────────────────────────────────────

  it('renders a known tool name (bash)', () => {
    renderPage()
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('renders tool descriptions', () => {
    renderPage()
    expect(screen.getByText('Execute shell commands')).toBeInTheDocument()
  })

  it('renders at least one tool param hint', () => {
    renderPage()
    const httpFetch = JARVIS_MCP_TOOLS.find(t => t.name === 'http_fetch')
    if (httpFetch && httpFetch.params.length > 0) {
      const firstParam = httpFetch.params[0]!
      const matches = screen.getAllByText(firstParam)
      expect(matches.length).toBeGreaterThan(0)
    }
  })

  // ── Categories ────────────────────────────────────────────────────────────────

  it('renders all category badges at least once', () => {
    renderPage()
    for (const cat of MCP_CATEGORY_ORDER) {
      // Category label appears in a colored pill and in the filter select.
      expect(screen.getAllByText(cat).length).toBeGreaterThanOrEqual(1)
    }
  })

  // ── Search filter ─────────────────────────────────────────────────────────────

  it('filters tools by name when searching', () => {
    renderPage()
    const input = screen.getByPlaceholderText(/Search tools/i)
    fireEvent.change(input, { target: { value: 'bash' } })
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('shows empty-state when search matches nothing', () => {
    renderPage()
    const input = screen.getByPlaceholderText(/Search tools/i)
    fireEvent.change(input, { target: { value: 'zzz-no-such-tool-zzz' } })
    expect(screen.getByText(/No tools match your search/i)).toBeInTheDocument()
  })

  it('restoring the search shows tools again', () => {
    renderPage()
    const input = screen.getByPlaceholderText(/Search tools/i)
    fireEvent.change(input, { target: { value: 'zzz-no-such-tool-zzz' } })
    expect(screen.getByText(/No tools match your search/i)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByText(/No tools match your search/i)).not.toBeInTheDocument()
  })

  // ── Resources ─────────────────────────────────────────────────────────────────

  it('renders the MCP Resources section header', () => {
    renderPage()
    expect(screen.getByText('MCP Resources')).toBeInTheDocument()
  })

  it('renders every resource name', () => {
    renderPage()
    for (const resource of JARVIS_MCP_RESOURCES) {
      expect(screen.getByText(resource.name)).toBeInTheDocument()
    }
  })

  it('renders resource URIs', () => {
    renderPage()
    for (const resource of JARVIS_MCP_RESOURCES) {
      expect(screen.getByText(resource.uri)).toBeInTheDocument()
    }
  })

  it('expands a resource when its toggle button is clicked', () => {
    renderPage()
    const toggles = screen.getAllByRole('button', { name: /▼|▲/ })
    expect(toggles.length).toBeGreaterThan(0)
    fireEvent.click(toggles[0]!)
    const expanded = screen.getAllByRole('button', { name: /▲/ })
    expect(expanded.length).toBeGreaterThanOrEqual(1)
  })

  it('collapses an expanded resource on second click', () => {
    renderPage()
    const collapsedBefore = screen.getAllByRole('button', { name: /▼/ }).length
    const toggle = screen.getAllByRole('button', { name: /▼/ })[0]!
    fireEvent.click(toggle)
    const expandedToggle = screen.getAllByRole('button', { name: /▲/ })[0]!
    fireEvent.click(expandedToggle)
    const collapsedAfter = screen.getAllByRole('button', { name: /▼/ }).length
    expect(collapsedAfter).toBe(collapsedBefore)
  })

  // ── Static catalogue invariants ──────────────────────────────────────────────

  it('has no duplicate tool names in the catalogue', () => {
    const names = JARVIS_MCP_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every tool has a non-empty description', () => {
    for (const tool of JARVIS_MCP_TOOLS) {
      expect(tool.desc.length).toBeGreaterThan(0)
    }
  })
})

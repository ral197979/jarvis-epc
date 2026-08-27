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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

/**
 * Scoping helpers for the two `*ByRole({ name })` queries in this file.
 *
 * `*ByRole` with a `name` filter computes the accessible name of every element
 * matching the role, and this page renders ~460 nodes — so one such query costs
 * ~24ms warm and ~340ms cold, against a ~15ms render. Three of these tests were
 * spending 95% of their wall-clock inside that computation, which made them the
 * least-headroom tests in the client suite (1162ms against the 5000ms default)
 * and the first to time out whenever the machine was busy. The work is pure CPU,
 * so it scales linearly with contention; every other client file peaks near
 * 290ms.
 *
 * Scoping the same query to the region that owns the element is 21–33× cheaper
 * and strictly stronger: the role and accessible-name matching are unchanged,
 * accessibility-visibility filtering still applies, and the element must now
 * also be inside the region it belongs to. `{ hidden: true }` was measured as an
 * alternative and rejected — it saves nothing here (23.7ms vs 23.8ms, because
 * the cost is the name computation, not the visibility filter) and would weaken
 * the query.
 */
const tabBar = () => screen.getByText(/🔌 Catalogue/).parentElement as HTMLElement
const resourcesSection = () => screen.getByText('MCP Resources').parentElement as HTMLElement

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
    const tabs = within(tabBar())
    expect(tabs.getByRole('button', { name: /🔌 Catalogue/i })).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /⚡ Execute/i })).toBeInTheDocument()
    expect(tabs.getByRole('button', { name: /📜 History/i })).toBeInTheDocument()
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

  it('expands a resource when its toggle button is clicked', async () => {
    renderPage()
    // findAllByRole lets mount fetches settle before we interact.
    const toggle = (await within(resourcesSection()).findAllByRole('button', { name: /▼/ }))[0]!
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveTextContent('▲'))
  })

  it('collapses an expanded resource on second click', async () => {
    renderPage()
    // Assert the SAME toggle flips ▼→▲→▼. Robust against async mount fetches
    // (loadCatalogue/checkAvaHealth) re-rendering other toggles — the previous
    // global ▼-count comparison flaked in CI when a fetch resolved mid-test.
    const toggle = (await within(resourcesSection()).findAllByRole('button', { name: /▼/ }))[0]!
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveTextContent('▲'))
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveTextContent('▼'))
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

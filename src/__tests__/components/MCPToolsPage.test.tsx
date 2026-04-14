/**
 * MCPToolsPage — unit tests
 *
 * Covers:
 *   - Renders page heading with correct tool count
 *   - Renders all 9 categories
 *   - Renders tool cards with name, description, and params
 *   - Search filter narrows visible tools
 *   - Empty-state message when search returns nothing
 *   - Resources panel renders all 4 resources
 *   - Resources expand/collapse on click
 *   - No network calls — pure static data
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MCPToolsPage } from '../../components/MCPToolsPage'
import {
  JARVIS_MCP_TOOLS,
  JARVIS_MCP_RESOURCES,
  MCP_CATEGORY_ORDER,
} from '../../constants/mcpTools'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  return render(<MCPToolsPage />)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCPToolsPage', () => {

  // ── Page header ──────────────────────────────────────────────────────────────

  it('renders the page heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /mcp tools/i })).toBeInTheDocument()
  })

  it('shows total tool count in subtitle', () => {
    renderPage()
    expect(screen.getByText(new RegExp(`${JARVIS_MCP_TOOLS.length} of ${JARVIS_MCP_TOOLS.length} tools`))).toBeInTheDocument()
  })

  it('shows correct resource count in subtitle', () => {
    renderPage()
    expect(screen.getByText(new RegExp(`${JARVIS_MCP_RESOURCES.length} resources`))).toBeInTheDocument()
  })

  // ── Categories ───────────────────────────────────────────────────────────────

  it('renders all categories', () => {
    renderPage()
    for (const cat of MCP_CATEGORY_ORDER) {
      expect(screen.getByRole('region', { name: new RegExp(`${cat} tools`, 'i') })).toBeInTheDocument()
    }
  })

  it('shows correct tool count per category', () => {
    renderPage()
    // System has 10 tools
    const systemSection = screen.getByRole('region', { name: /system tools/i })
    expect(systemSection).toHaveTextContent('(10)')
  })

  // ── Tool cards ───────────────────────────────────────────────────────────────

  it('renders a known tool name', () => {
    renderPage()
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('renders tool description', () => {
    renderPage()
    expect(screen.getByText('Execute shell commands')).toBeInTheDocument()
  })

  it('renders tool params', () => {
    renderPage()
    // bash has params: ['command']
    expect(screen.getByText('command')).toBeInTheDocument()
  })

  it('renders AGI tools', () => {
    renderPage()
    expect(screen.getByText('agi_reason')).toBeInTheDocument()
    expect(screen.getByText('agi_plan')).toBeInTheDocument()
  })

  it('renders Security tools', () => {
    renderPage()
    expect(screen.getByText('secret_get')).toBeInTheDocument()
    expect(screen.getByText('audit_log')).toBeInTheDocument()
  })

  // ── Search filter ────────────────────────────────────────────────────────────

  it('renders search input', () => {
    renderPage()
    expect(screen.getByRole('searchbox', { name: /filter mcp tools/i })).toBeInTheDocument()
  })

  it('filters tools by name when searching', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'bash' } })
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.queryByText('file_read')).not.toBeInTheDocument()
  })

  it('filters tools by description when searching', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'clipboard' } })
    expect(screen.getByText('clipboard_read')).toBeInTheDocument()
    expect(screen.getByText('clipboard_write')).toBeInTheDocument()
    expect(screen.queryByText('bash')).not.toBeInTheDocument()
  })

  it('filters tools by category name when searching', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'vision' } })
    // vision_capture is in Vision category
    expect(screen.getByText('vision_capture')).toBeInTheDocument()
  })

  it('shows empty-state when search returns nothing', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'xyzzy_not_a_tool' } })
    expect(screen.getByRole('status')).toHaveTextContent(/no tools match/i)
  })

  it('updates visible count in subtitle after filtering', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'bash' } })
    // Only 1 tool matches "bash" exactly
    expect(screen.getByText(/1 of \d+ tools/)).toBeInTheDocument()
  })

  it('restoring search shows all tools again', () => {
    renderPage()
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'bash' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText(new RegExp(`${JARVIS_MCP_TOOLS.length} of ${JARVIS_MCP_TOOLS.length} tools`))).toBeInTheDocument()
  })

  // ── Resources panel ──────────────────────────────────────────────────────────

  it('renders MCP Resources section', () => {
    renderPage()
    expect(screen.getByRole('region', { name: /mcp resources/i })).toBeInTheDocument()
  })

  it('renders all 4 resource names', () => {
    renderPage()
    for (const r of JARVIS_MCP_RESOURCES) {
      expect(screen.getByText(r.name)).toBeInTheDocument()
    }
  })

  it('renders resource URIs', () => {
    renderPage()
    expect(screen.getByText('jarvis://config')).toBeInTheDocument()
    expect(screen.getByText('jarvis://vbrd')).toBeInTheDocument()
  })

  it('expands resource data on click', () => {
    renderPage()
    const configBtn = screen.getByRole('button', { name: /configuration/i })
    // Data should not be visible initially
    expect(screen.queryByText(/"version"/)).not.toBeInTheDocument()
    fireEvent.click(configBtn)
    expect(screen.getByText(/"version"/)).toBeInTheDocument()
  })

  it('collapses resource data on second click', () => {
    renderPage()
    const configBtn = screen.getByRole('button', { name: /configuration/i })
    fireEvent.click(configBtn)
    expect(screen.getByText(/"version"/)).toBeInTheDocument()
    fireEvent.click(configBtn)
    expect(screen.queryByText(/"version"/)).not.toBeInTheDocument()
  })

  it('only one resource expanded at a time', () => {
    renderPage()
    const configBtn = screen.getByRole('button', { name: /configuration/i })
    const agiBtn    = screen.getByRole('button', { name: /agi status/i })
    fireEvent.click(configBtn)
    fireEvent.click(agiBtn)
    // config should be collapsed, agi should be open
    expect(screen.queryByText(/"version"/)).not.toBeInTheDocument()
    expect(screen.getByText(/"modules"/)).toBeInTheDocument()
  })

  // ── Accessibility ────────────────────────────────────────────────────────────

  it('resource buttons have aria-expanded attribute', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: /configuration/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('has no duplicate tool names', () => {
    const names = JARVIS_MCP_TOOLS.map(t => t.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('all tools have non-empty descriptions', () => {
    for (const t of JARVIS_MCP_TOOLS) {
      expect(t.desc.length).toBeGreaterThan(0)
    }
  })
})

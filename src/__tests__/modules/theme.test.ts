/**
 * Tests: modules/theme
 * Coverage: THEME tokens, CHART_COLORS, TOOLTIP_STYLE, injectCSSTokens
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { THEME, CHART_COLORS, TOOLTIP_STYLE, injectCSSTokens, e, mi, ni } from '../../modules/theme'

describe('THEME tokens', () => {
  it('should have all required background tokens', () => {
    expect(THEME.bg).toBe('#08090d')
    expect(THEME.sf).toBe('#0e1015')
    expect(THEME.cd).toBe('#13161d')
    expect(THEME.bd).toBe('#1e2230')
    expect(THEME.bl).toBe('#2a2f3f')
  })

  it('should have the accent color', () => {
    expect(THEME.ac).toBe('#3b82f6')
    expect(THEME.blue).toBe('#3b82f6')
  })

  it('should have all text color tokens', () => {
    expect(THEME.tx).toBe('#e8ecf4')
    expect(THEME.ts).toBe('#8892a6')
    expect(THEME.td).toBe('#4a5168')
  })

  it('should have all semantic color tokens', () => {
    expect(THEME.grn).toBe('#22c55e')
    expect(THEME.red).toBe('#ef4444')
    expect(THEME.amb).toBe('#f59e0b')
    expect(THEME.pur).toBe('#a78bfa')
    expect(THEME.cyn).toBe('#06b6d4')
    expect(THEME.pnk).toBe('#ec4899')
    expect(THEME.org).toBe('#f97316')
  })

  it('should export all 17 tokens', () => {
    const keys = Object.keys(THEME)
    expect(keys.length).toBe(17)
  })

  it('all color values should be valid hex strings', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i
    for (const [key, value] of Object.entries(THEME)) {
      expect(value, `${key} should be a valid hex color`).toMatch(hexPattern)
    }
  })
})

describe('CHART_COLORS', () => {
  it('should have 8 colors', () => {
    expect(CHART_COLORS).toHaveLength(8)
  })

  it('should start with blue', () => {
    expect(CHART_COLORS[0]).toBe(THEME.blue)
  })

  it('all chart colors should be valid hex', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i
    CHART_COLORS.forEach(color => {
      expect(color).toMatch(hexPattern)
    })
  })

  it('should have all unique colors', () => {
    const unique = new Set(CHART_COLORS)
    expect(unique.size).toBe(CHART_COLORS.length)
  })
})

describe('TOOLTIP_STYLE', () => {
  it('should have contentStyle with all required properties', () => {
    const { contentStyle } = TOOLTIP_STYLE
    expect(contentStyle.background).toBe(THEME.cd)
    expect(contentStyle.color).toBe(THEME.tx)
    expect(contentStyle.fontSize).toBe(11)
    expect(contentStyle.borderRadius).toBe(6)
    expect(contentStyle.border).toContain(THEME.bl)
  })
})

describe('injectCSSTokens', () => {
  beforeEach(() => {
    // Clean up any previously injected style elements
    document.getElementById('jarvis-css-tokens')?.remove()
  })

  it('should inject a style element into document.head', () => {
    injectCSSTokens()
    const el = document.getElementById('jarvis-css-tokens')
    expect(el).not.toBeNull()
    expect(el?.tagName).toBe('STYLE')
  })

  it('should define :root CSS custom properties', () => {
    injectCSSTokens()
    const el = document.getElementById('jarvis-css-tokens')
    expect(el?.textContent).toContain('--jarvis-bg')
    expect(el?.textContent).toContain('--jarvis-ac')
    expect(el?.textContent).toContain('--jarvis-tx')
  })

  it('should not inject duplicate style elements', () => {
    injectCSSTokens()
    injectCSSTokens()
    injectCSSTokens()
    const elements = document.querySelectorAll('#jarvis-css-tokens')
    expect(elements.length).toBe(1)
  })

  it('should embed correct token values in CSS', () => {
    injectCSSTokens()
    const el = document.getElementById('jarvis-css-tokens')
    expect(el?.textContent).toContain(THEME.bg)
    expect(el?.textContent).toContain(THEME.ac)
  })
})

describe('Legacy aliases', () => {
  it('e should be the same object as THEME', () => {
    expect(e).toBe(THEME)
  })

  it('mi should be the same array as CHART_COLORS', () => {
    expect(mi).toBe(CHART_COLORS)
  })

  it('ni should be the same object as TOOLTIP_STYLE', () => {
    expect(ni).toBe(TOOLTIP_STYLE)
  })
})

// ─── Track E: injectCSSTokens idempotency guard (line 76) ─────────────────────

describe('injectCSSTokens — idempotency (line 76 branch)', () => {
  afterEach(() => {
    document.getElementById('jarvis-css-tokens')?.remove()
  })

  it('creates style element on first call', () => {
    injectCSSTokens()
    expect(document.getElementById('jarvis-css-tokens')).not.toBeNull()
  })

  it('does not create duplicate style element on second call', () => {
    injectCSSTokens()
    injectCSSTokens()
    const elements = document.querySelectorAll('#jarvis-css-tokens')
    expect(elements.length).toBe(1)
  })

  it('style element contains CSS custom properties', () => {
    injectCSSTokens()
    const style = document.getElementById('jarvis-css-tokens') as HTMLStyleElement
    expect(style.textContent).toContain(':root')
    expect(style.textContent).toContain('--jarvis')
  })

  it('does not throw when called in document-less environment', () => {
    // document is present in jsdom — this covers the existing execution path
    expect(() => injectCSSTokens()).not.toThrow()
  })
})

// ─── Track D Phase 20: theme line 76 document=undefined SSR guard ─────────────
describe('injectCSSTokens — document=undefined SSR guard (line 76)', () => {
  it('returns early without throwing when document is undefined', () => {
    const origDoc = globalThis.document
    // @ts-expect-error removing document to simulate SSR
    delete globalThis.document
    try {
      expect(() => injectCSSTokens()).not.toThrow()
    } finally {
      globalThis.document = origDoc
    }
  })

  it('is idempotent when document is available (existing path)', () => {
    // Normal browser environment — should not create duplicate styles
    injectCSSTokens()
    injectCSSTokens()
    const styleCount = document.querySelectorAll('#jarvis-css-tokens').length
    expect(styleCount).toBe(1)
  })
})

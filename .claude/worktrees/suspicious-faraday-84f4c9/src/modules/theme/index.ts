/**
 * JARVIS EPC — Theme Module
 * ─────────────────────────
 * Single source of truth for all design tokens.
 * Pure constants — no dependencies, no side effects.
 *
 * Status: CSS tokens live in src/styles/tokens.css. JarvisCore.jsx inline-style migration is a pending TODO.
 * These TS token objects remain as the authoritative reference.
 */

// ─── Token Types ──────────────────────────────────────────────────────────────
export interface ThemeTokens {
  // Backgrounds
  bg: string; sf: string; cd: string; bd: string; bl: string
  // Accent
  ac: string
  // Text
  tx: string; ts: string; td: string
  // Semantic colors
  blue: string; grn: string; red: string; amb: string
  pur: string;  cyn: string; pnk: string; org: string
}

export interface TooltipStyle {
  contentStyle: {
    background: string
    border: string
    borderRadius: number
    color: string
    fontSize: number
  }
}

// ─── Color Palette ────────────────────────────────────────────────────────────
export const THEME: ThemeTokens = {
  bg:   '#08090d',
  sf:   '#0e1015',
  cd:   '#13161d',
  bd:   '#1e2230',
  bl:   '#2a2f3f',
  ac:   '#3b82f6',
  tx:   '#e8ecf4',
  ts:   '#8892a6',
  td:   '#4a5168',
  blue: '#3b82f6',
  grn:  '#22c55e',
  red:  '#ef4444',
  amb:  '#f59e0b',
  pur:  '#a78bfa',
  cyn:  '#06b6d4',
  pnk:  '#ec4899',
  org:  '#f97316',
} as const

// ─── Chart Color Sequence ─────────────────────────────────────────────────────
export const CHART_COLORS: readonly string[] = [
  THEME.blue, THEME.grn, THEME.amb, THEME.pur,
  THEME.cyn,  THEME.pnk, THEME.org, THEME.red,
] as const

// ─── Recharts Tooltip Config ──────────────────────────────────────────────────
export const TOOLTIP_STYLE: TooltipStyle = {
  contentStyle: {
    background:   THEME.cd,
    border:       `1px solid ${THEME.bl}`,
    borderRadius: 6,
    color:        THEME.tx,
    fontSize:     11,
  },
}

// ─── CSS Custom Properties generator ─────────────────────────────────────────
// Called once at app init to inject :root tokens into the document.
// Enables CSS-side access to all tokens: var(--jarvis-bg), etc.
export function injectCSSTokens(): void {
  if (typeof document === 'undefined') return
  const id = 'jarvis-css-tokens'
  if (document.getElementById(id)) return

  const style = document.createElement('style')
  style.id = id
  style.textContent = `:root {
  --jarvis-bg:   ${THEME.bg};
  --jarvis-sf:   ${THEME.sf};
  --jarvis-cd:   ${THEME.cd};
  --jarvis-bd:   ${THEME.bd};
  --jarvis-bl:   ${THEME.bl};
  --jarvis-ac:   ${THEME.ac};
  --jarvis-tx:   ${THEME.tx};
  --jarvis-ts:   ${THEME.ts};
  --jarvis-td:   ${THEME.td};
  --jarvis-blue: ${THEME.blue};
  --jarvis-grn:  ${THEME.grn};
  --jarvis-red:  ${THEME.red};
  --jarvis-amb:  ${THEME.amb};
  --jarvis-pur:  ${THEME.pur};
  --jarvis-cyn:  ${THEME.cyn};
  --jarvis-pnk:  ${THEME.pnk};
  --jarvis-org:  ${THEME.org};
}`
  document.head.appendChild(style)
}

// ─── Legacy aliases (JarvisCore compatibility) ────────────────────────────────
export const e  = THEME
export const mi = CHART_COLORS
export const ni = TOOLTIP_STYLE

#!/usr/bin/env node
/**
 * scripts/check-monolith-size.js
 * ────────────────────────────────
 * Phase 9: File-size guard for JarvisCore.jsx.
 *
 * Enforces that the monolith does NOT grow beyond its current size.
 * As components are extracted, this limit should be LOWERED phase-by-phase
 * to create a ratchet that prevents regression.
 *
 * Current ceiling: 34,000 lines (Phase 9 actual: ~34,000)
 * Phase 10 target: 33,000 lines (after extracting 2+ more views)
 *
 * Usage:
 *   node scripts/check-monolith-size.js
 *   exit code 0 = pass, exit code 1 = fail
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MONOLITH_PATH = resolve(__dirname, '../src/jarvis/JarvisCore.jsx')
const MAX_LINES     = 6_530    // ratchet — Phase 18 actual: 6,530 lines
const WARN_LINES    = 6_400    // Phase 19 target: extract _hashPin + _migratePinIfNeeded + _sanitizeForAI (~80 lines)

let content
try {
  content = readFileSync(MONOLITH_PATH, 'utf8')
} catch {
  console.error(`[monolith-gate] Cannot read ${MONOLITH_PATH}`)
  process.exit(1)
}

const lineCount = content.split('\n').length

const kb = (content.length / 1024).toFixed(1)
console.log(`[monolith-gate] JarvisCore.jsx: ${lineCount.toLocaleString()} lines (${kb} KB)`)

if (lineCount > MAX_LINES) {
  console.error(
    `[monolith-gate] FAIL: ${lineCount.toLocaleString()} lines exceeds MAX_LINES (${MAX_LINES.toLocaleString()}).`,
    `\n  Action: Extract a component before adding new code to JarvisCore.jsx.`,
    `\n  See Phase 9 roadmap for extraction candidates.`
  )
  process.exit(1)
}

if (lineCount > WARN_LINES) {
  console.warn(
    `[monolith-gate] WARN: ${lineCount.toLocaleString()} lines is above soft limit (${WARN_LINES.toLocaleString()}).`,
    `\n  Consider extracting a component soon.`
  )
}

// Report extracted component count
const extractedDir = resolve(__dirname, '../src/components')
try {
  const { readdirSync } = await import('fs')
  const components = readdirSync(extractedDir).filter(f => f.endsWith('.tsx') && !f.includes('.test.'))
  console.log(`[monolith-gate] PASS — extracted components: ${components.join(', ')}`)
} catch {
  console.log('[monolith-gate] PASS')
}

process.exit(0)

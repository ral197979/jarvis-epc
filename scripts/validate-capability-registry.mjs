#!/usr/bin/env node
/**
 * Denver Engineering — feature-truth guard.
 *
 * Enforces that src/config/capabilityRegistry.ts stays honest and in sync with
 * the real navigation surface and router, as a hard CI gate (job:
 * "feature-truth-guard"). It parses checked-in SOURCE (navigation.ts,
 * ContentRouter.tsx, capabilityRegistry.ts) rather than trusting prose — so a
 * new route or a drifted claim fails the build, not a doc review.
 *
 * Zero runtime deps: reads files as text, like scripts/validate-fly-staging-config.mjs.
 * The richer semantic invariants (evidence required for VERIFIED_NATIVE, etc.)
 * are enforced by src/__tests__/config/capabilityRegistry.test.ts against the
 * imported registry.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }

// ── Parse NAVIGATION_ITEMS ids (the sidebar surface) ───────────────────────
const navSrc = read('src/config/navigation.ts')
// Anchor on the array declaration itself, not the earlier comment/NAV_SECTIONS,
// so section ids (personal/planning/…) don't leak in as if they were routes.
const navArray = navSrc.slice(navSrc.indexOf('export const NAVIGATION_ITEMS'))
const navIds = [...navArray.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/gi)].map(m => m[1])

// ── Parse ContentRouter TAB_MAP ids (all routable tabs, incl. hidden) ──────
const routerSrc = read('src/components/ContentRouter.tsx')
const tabMapBlock = routerSrc.slice(routerSrc.indexOf('TAB_MAP'), routerSrc.indexOf('// ─── Component'))
const tabIds = [...tabMapBlock.matchAll(/^\s*([a-z0-9]+):\s*[A-Z]/gm)].map(m => m[1])

// ── Parse capability registry routes + ids + statuses ──────────────────────
const regSrc = read('src/config/capabilityRegistry.ts')
const capBlock = regSrc.slice(regSrc.indexOf('export const CAPABILITIES'))
const capIds = [...capBlock.matchAll(/^\s*id:\s*'([a-z0-9-]+)'/gm)].map(m => m[1])
const capRoutes = [...capBlock.matchAll(/route:\s*'([a-z0-9-]+)'/g)].map(m => m[1])
const capStatuses = [...capBlock.matchAll(/status:\s*'([A-Z_]+)'/g)].map(m => m[1])

const VALID_STATUSES = new Set([
  'VERIFIED_NATIVE', 'VERIFIED_EXTERNAL', 'DETERMINISTIC_AUTOMATION', 'PREDICTIVE_MODEL',
  'GROUNDING_OR_RAG', 'DRAWING_GENERATOR', 'EXTERNAL_SHELL', 'UI_ONLY',
  'PLACEHOLDER_OR_SYNTHETIC', 'PARTIAL', 'BROKEN_OR_DEAD', 'NOT_VERIFIED',
])

// ── Sanity: we actually parsed something ───────────────────────────────────
check(`parsed NAVIGATION_ITEMS (got ${navIds.length})`, navIds.length >= 40)
check(`parsed TAB_MAP (got ${tabIds.length})`, tabIds.length >= 40)
check(`parsed CAPABILITIES (got ${capIds.length})`, capIds.length >= 40)

// ── 1. No duplicate capability ids ─────────────────────────────────────────
const dupIds = capIds.filter((id, i) => capIds.indexOf(id) !== i)
check(`no duplicate capability ids (dupes: ${[...new Set(dupIds)].join(', ') || 'none'})`, dupIds.length === 0)

// ── 2. Every capability status is a valid taxonomy value ───────────────────
const badStatus = capStatuses.filter(s => !VALID_STATUSES.has(s))
check(`all statuses are valid taxonomy values (bad: ${badStatus.join(', ') || 'none'})`, badStatus.length === 0)

// ── 3. Every sidebar nav route has a capability-registry entry ─────────────
const capRouteSet = new Set(capRoutes)
const missingNav = navIds.filter(id => !capRouteSet.has(id))
check(`every nav route has a capability entry (missing: ${missingNav.join(', ') || 'none'})`, missingNav.length === 0)

// ── 4. Every capability route actually exists (in nav or TAB_MAP) — no phantoms
const routableSet = new Set([...navIds, ...tabIds])
const phantom = capRoutes.filter(r => !routableSet.has(r))
check(`no capability route is a phantom (unknown: ${phantom.join(', ') || 'none'})`, phantom.length === 0)

// ── 5. No capability route is registered twice ─────────────────────────────
const dupRoutes = capRoutes.filter((r, i) => capRoutes.indexOf(r) !== i)
check(`no capability route registered twice (dupes: ${[...new Set(dupRoutes)].join(', ') || 'none'})`, dupRoutes.length === 0)

// ── Report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\nfeature-truth-guard: ${failures.length} violation(s):\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('\nIf you added a route, add a matching entry to src/config/capabilityRegistry.ts.')
  console.error('If you renamed/removed a route, update the registry to match. Do not delete a check to pass.\n')
  process.exit(1)
}
console.log(`feature-truth-guard: OK — ${navIds.length} nav routes, ${tabIds.length} routable tabs, ${capIds.length} capability entries, all reconciled.`)

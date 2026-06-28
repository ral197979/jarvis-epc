/**
 * Denver Engineering — Commissioning Intelligence Module
 * ────────────────────────────────────────────────
 * Business logic, selectors, and helpers for the Commissioning Intelligence layer.
 *
 * This module does NOT import from React or the Zustand store.
 * It is a pure TypeScript library that can be tested in isolation.
 *
 * Key responsibilities:
 *   - computeAssetTruth()     → AssetTruthView for the Asset Truth View UI
 *   - computeDrift()          → DriftSummary for the Change Impact Timeline
 *   - buildAuditPackage()     → AuditAnswerPackage for the Audit Answer Generator
 *   - validateBaseline()      → Pre-freeze validation
 *   - computeEvidenceHash()   → SHA-256 fingerprint (browser SubtleCrypto)
 *   - canFreezeBaseline()     → Guard: is this baseline ready to freeze?
 *   - isBaselineFrozen()      → Type-narrowing guard
 */

import type {
  CIAsset,
  CIBaseline,
  CITest,
  CISetpoint,
  CIPMTask,
  CIChangeEvent,
  CIEvidence,
  AssetTruthView,
  DriftSummary,
  AuditAnswerPackage,
} from './types'

// ─── Re-export types for convenience ─────────────────────────────────────────
export type {
  CIAsset,
  CIBaseline,
  CITest,
  CISetpoint,
  CIPMTask,
  CIChangeEvent,
  CIEvidence,
  AssetTruthView,
  DriftSummary,
  AuditAnswerPackage,
  AssetClass,
  AssetStatus,
  BaselineStatus,
  TestType,
  TestResult,
  SetpointCategory,
  PMProvenance,
  PMFrequency,
  ChangeType,
  ChangeStatus,
  ChangeImpact,
  EvidenceType,
} from './types'

// ─── Frozen baseline guard ────────────────────────────────────────────────────

/**
 * Type guard: confirms a baseline is frozen.
 * Use this before any operation that reads the baseline as authoritative truth.
 */
export function isBaselineFrozen(b: CIBaseline): boolean {
  return b.status === 'frozen' && !!b.frozen_at
}

// ─── Freeze validation ────────────────────────────────────────────────────────

export interface BaselineValidationResult {
  valid:    boolean
  errors:   string[]
  warnings: string[]
}

/**
 * validateBaseline — pre-freeze checklist.
 * Called before `ci/freeze_baseline` is dispatched.
 * Returns errors (blockers) and warnings (informational).
 */
export function validateBaseline(
  baseline: CIBaseline,
  tests:    CITest[],
  setpoints: CISetpoint[],
  evidence: CIEvidence[],
): BaselineValidationResult {
  const errors:   string[] = []
  const warnings: string[] = []

  // Already frozen
  if (isBaselineFrozen(baseline)) {
    errors.push('Baseline is already frozen and cannot be re-frozen.')
    return { valid: false, errors, warnings }
  }

  // Must have scope
  if (!baseline.scope?.trim()) {
    errors.push('Baseline scope is required before freezing.')
  }

  // Must reference at least one test
  if (!baseline.test_ids?.length) {
    errors.push('At least one commissioning test must be linked before freezing.')
  }

  // All referenced tests must exist and pass
  const linkedTests = tests.filter(t => baseline.test_ids.includes(t.id))
  const failedTests = linkedTests.filter(t => t.result === 'fail')
  if (failedTests.length) {
    errors.push(`${failedTests.length} test(s) with result 'fail' must be resolved before freezing.`)
  }

  const deferredTests = linkedTests.filter(t => t.result === 'deferred')
  if (deferredTests.length) {
    warnings.push(`${deferredTests.length} deferred test(s) exist. Ensure deferred items are tracked.`)
  }

  // Must have at least one setpoint or explicitly no setpoints required
  if (!baseline.setpoint_ids?.length) {
    warnings.push('No setpoints linked. Confirm this asset requires no setpoint documentation.')
  }

  // Evidence: each test should have at least one evidence record
  const linkedEvidence = evidence.filter(e => baseline.evidence_ids.includes(e.id))
  if (!linkedEvidence.length) {
    errors.push('At least one evidence record must be linked before freezing.')
  }

  // All evidence must have a content_hash
  const unhashed = linkedEvidence.filter(e => !e.content_hash)
  if (unhashed.length) {
    errors.push(`${unhashed.length} evidence record(s) are missing content hashes.`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ─── Asset Truth View ─────────────────────────────────────────────────────────

/**
 * computeAssetTruth — builds the complete commissioning picture for a single asset.
 * This is the data source for the "Asset Truth View" UI.
 */
export function computeAssetTruth(
  asset:         CIAsset,
  baselines:     CIBaseline[],
  tests:         CITest[],
  setpoints:     CISetpoint[],
  pmTasks:       CIPMTask[],
  changeEvents:  CIChangeEvent[],
  evidence:      CIEvidence[],
): AssetTruthView {
  const assetBaselines    = baselines.filter(b => b.asset_id === asset.id)
  const frozenBaselines   = assetBaselines.filter(isBaselineFrozen)
  const activeBaseline    = frozenBaselines.sort((a, b) => b.version - a.version)[0] ?? null

  const assetTests        = tests.filter(t => t.asset_id === asset.id)
  const assetSetpoints    = setpoints.filter(s => s.asset_id === asset.id)
  const assetPMTasks      = pmTasks.filter(p => p.asset_id === asset.id && p.active)
  const assetChangeEvents = changeEvents.filter(c => c.asset_id === asset.id)
  const assetEvidence     = evidence.filter(e => e.asset_id === asset.id)

  const drift     = computeDrift(asset, activeBaseline, assetChangeEvents)
  const auditReady = checkAuditReadiness(activeBaseline, assetTests, assetEvidence)

  return {
    asset,
    active_baseline:  activeBaseline,
    baseline_history: assetBaselines,
    tests:            assetTests,
    setpoints:        assetSetpoints,
    pm_tasks:         assetPMTasks,
    change_events:    assetChangeEvents,
    evidence:         assetEvidence,
    drift_score:      drift.drift_score,
    audit_ready:      auditReady,
  }
}

// ─── Drift Analysis ───────────────────────────────────────────────────────────

/**
 * computeDrift — calculates how far an asset has drifted from its frozen baseline.
 *
 * Scoring model (0 = perfectly aligned, 100 = maximally drifted):
 *   - Each open/proposed change adds weight by impact level
 *   - Unapproved implemented changes add heavy weight
 *   - High/critical impact changes are weighted more heavily
 *   - No active baseline → maximum drift (no truth to compare against)
 */
export function computeDrift(
  asset:        CIAsset,
  baseline:     CIBaseline | null,
  changeEvents: CIChangeEvent[],
): DriftSummary {
  if (!baseline) {
    return {
      asset_id:           asset.id,
      asset_tag:          asset.tag,
      baseline_version:   0,
      open_changes:       0,
      high_impact_changes: 0,
      unapproved_changes: 0,
      drift_score:        100,
      last_change_at:     null,
      flags:              ['No frozen baseline exists — commissioning truth is undefined.'],
    }
  }

  const IMPACT_WEIGHT: Record<string, number> = {
    none:     0,
    low:      5,
    medium:   15,
    high:     30,
    critical: 50,
  }

  const open        = changeEvents.filter(c => c.status === 'proposed')
  const implemented = changeEvents.filter(c => c.status === 'implemented')
  const highImpact  = changeEvents.filter(c => c.impact === 'high' || c.impact === 'critical')
  const unapproved  = implemented.filter(c => !c.approved_by)

  // Drift score: weighted sum capped at 100
  let score = 0
  for (const ev of changeEvents) {
    if (ev.status === 'rejected' || ev.status === 'rolled_back') continue
    score += IMPACT_WEIGHT[ev.impact] ?? 5
  }
  // Unapproved-but-implemented changes are extra penalised
  score += unapproved.length * 20

  const drift_score = Math.min(100, score)

  const flags: string[] = []
  if (open.length)      flags.push(`${open.length} open change request(s) pending approval.`)
  if (unapproved.length) flags.push(`${unapproved.length} implemented change(s) have no approval record.`)
  if (highImpact.length) flags.push(`${highImpact.length} high/critical impact change(s) recorded since baseline freeze.`)

  const lastChange = changeEvents
    .filter(c => c.implemented_at || c.created_at)
    .sort((a, b) => {
      const ta = a.implemented_at ?? a.created_at
      const tb = b.implemented_at ?? b.created_at
      return tb.localeCompare(ta)
    })[0]

  return {
    asset_id:           asset.id,
    asset_tag:          asset.tag,
    baseline_version:   baseline.version,
    open_changes:       open.length,
    high_impact_changes: highImpact.length,
    unapproved_changes: unapproved.length,
    drift_score,
    last_change_at:     lastChange ? (lastChange.implemented_at ?? lastChange.created_at) : null,
    flags,
  }
}

// ─── Audit Readiness ──────────────────────────────────────────────────────────

/**
 * checkAuditReadiness — can this asset answer an audit question?
 *
 * true if:
 *   - A frozen baseline exists
 *   - All referenced tests have evidence
 *   - All evidence records have content hashes
 */
export function checkAuditReadiness(
  baseline: CIBaseline | null,
  tests:    CITest[],
  evidence: CIEvidence[],
): boolean {
  if (!baseline || !isBaselineFrozen(baseline)) return false
  if (!baseline.evidence_ids?.length) return false

  const baselineEvidence = evidence.filter(e => baseline.evidence_ids.includes(e.id))
  if (!baselineEvidence.length) return false

  // All evidence must be hashed
  if (baselineEvidence.some(e => !e.content_hash)) return false

  // All tests must have at least one evidence record
  const linkedTests = tests.filter(t => baseline.test_ids.includes(t.id))
  for (const test of linkedTests) {
    if (test.result === 'not_applicable') continue
    const hasEvidence = evidence.some(e => e.linked_to_id === test.id)
    if (!hasEvidence) return false
  }

  return true
}

// ─── Audit Answer Package ─────────────────────────────────────────────────────

/**
 * buildAuditPackage — assembles an audit-ready evidence package for a given asset.
 * This is the data source for the "Audit Answer Generator" UI.
 *
 * The AI layer uses this package as context when generating narrative summaries.
 * The package itself is a deterministic, evidence-backed structure — no AI involved.
 */
export function buildAuditPackage(
  assetTruth:  AssetTruthView,
  query:       string,
  requestedBy: string,
): AuditAnswerPackage {
  const { asset, active_baseline, tests, change_events, evidence } = assetTruth

  const evidenceChain = evidence
    .filter(e => e.content_hash) // only hashed evidence is authoritative
    .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
    .map(e => ({
      id:          e.id,
      type:        e.type,
      title:       e.title,
      uri:         e.uri,
      hash:        e.content_hash,
      uploaded_at: e.uploaded_at,
    }))

  const changeTimeline = change_events
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(c => ({
      ts:          c.implemented_at ?? c.created_at,
      type:        c.type,
      status:      c.status,
      description: c.description,
      approved_by: c.approved_by,
    }))

  const baselineRef = active_baseline
    ? `Baseline v${active_baseline.version} frozen ${active_baseline.frozen_at ?? 'unknown'}`
    : 'NO FROZEN BASELINE — audit readiness compromised'

  // Placeholder narrative — the AI layer (v0.2 Bounded AI Assistance) will
  // populate this field using the package as context. It is advisory only.
  const narrative = active_baseline
    ? `Asset ${asset.tag} was commissioned under ${baselineRef}. ` +
      `${tests.length} test(s) are on record. ` +
      `${change_events.length} post-handover change event(s) have been logged. ` +
      `Evidence chain contains ${evidenceChain.length} hashed record(s).`
    : `WARNING: No frozen commissioning baseline exists for asset ${asset.tag}. ` +
      `This asset cannot be audited against a commissioning truth record.`

  return {
    generated_at:    new Date().toISOString(),
    generated_by:    requestedBy,
    asset_tag:       asset.tag,
    query,
    baseline_ref:    baselineRef,
    evidence_chain:  evidenceChain,
    change_timeline: changeTimeline,
    narrative,
  }
}

// ─── Evidence Hashing ─────────────────────────────────────────────────────────

/**
 * computeEvidenceHash — SHA-256 hash of a file using the Web Crypto API.
 *
 * Returns a lowercase hex string. Call this during evidence upload before
 * dispatching `ci/add_evidence`. The hash must be set at creation and never
 * changed — it is the integrity guarantee for the evidence chain.
 *
 * @example
 *   const hash = await computeEvidenceHash(file)
 *   dispatch({ type: JARVIS_CI_ACTIONS.ADD_EVIDENCE, data: { ...evidenceData, content_hash: hash } })
 */
export async function computeEvidenceHash(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  // Wrap in a Uint8Array view so digest() accepts it across realms: a jsdom Blob's
  // arrayBuffer() yields a jsdom-realm ArrayBuffer that Node 20's webcrypto rejects
  // via instanceof. A TypedArray view passes the check; identical bytes → same hash.
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * computeStringHash — SHA-256 hash of a string (for test records, JSON payloads, etc.)
 */
export async function computeStringHash(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** CCA score bands — mirrors the Commissioning Continuity Audit™ scoring */
export type CCABand =
  | 'operationally_defendable'   // 85–100
  | 'latent_risk'                // 70–84
  | 'high_failure_probability'   // 50–69
  | 'commissioned_in_name_only'  // < 50

export function scoreToCCABand(score: number): CCABand {
  if (score >= 85) return 'operationally_defendable'
  if (score >= 70) return 'latent_risk'
  if (score >= 50) return 'high_failure_probability'
  return 'commissioned_in_name_only'
}

/**
 * computePortfolioHealth — aggregate drift scores across all assets.
 * Returns an overall facility CCA score (0–100).
 */
export function computePortfolioHealth(driftSummaries: DriftSummary[]): {
  overall_score:   number
  band:            CCABand
  asset_count:     number
  high_risk_count: number
  flags:           string[]
} {
  if (!driftSummaries.length) {
    return {
      overall_score:   0,
      band:            'commissioned_in_name_only',
      asset_count:     0,
      high_risk_count: 0,
      flags:           ['No commissioned assets in registry.'],
    }
  }

  // Portfolio score = 100 - average drift score
  const avgDrift = driftSummaries.reduce((sum, d) => sum + d.drift_score, 0) / driftSummaries.length
  const overall_score = Math.round(Math.max(0, 100 - avgDrift))

  const highRisk = driftSummaries.filter(d => d.drift_score >= 50)
  const flags: string[] = []
  if (highRisk.length) {
    flags.push(`${highRisk.length} asset(s) with drift score ≥ 50 — high failure probability.`)
  }

  const noBaseline = driftSummaries.filter(d => d.drift_score === 100)
  if (noBaseline.length) {
    flags.push(`${noBaseline.length} asset(s) have no frozen baseline.`)
  }

  return {
    overall_score,
    band: scoreToCCABand(overall_score),
    asset_count:     driftSummaries.length,
    high_risk_count: highRisk.length,
    flags,
  }
}

// ─── Collection Helpers ───────────────────────────────────────────────────────

/** Get the active frozen baseline for an asset, or null if none exists */
export function getActiveBaseline(
  assetId:   string,
  baselines: CIBaseline[],
): CIBaseline | null {
  return baselines
    .filter(b => b.asset_id === assetId && isBaselineFrozen(b))
    .sort((a, b) => b.version - a.version)[0] ?? null
}

/** Get the next version number for a new baseline on an asset */
export function nextBaselineVersion(
  assetId:   string,
  baselines: CIBaseline[],
): number {
  const existing = baselines.filter(b => b.asset_id === assetId)
  if (!existing.length) return 1
  return Math.max(...existing.map(b => b.version)) + 1
}

/** Check if a baseline freeze is permitted (no existing frozen baseline in draft) */
export function canFreezeBaseline(
  baseline:  CIBaseline,
  baselines: CIBaseline[],
): { ok: boolean; reason?: string } {
  if (isBaselineFrozen(baseline)) {
    return { ok: false, reason: 'Baseline is already frozen.' }
  }

  // No other draft baselines for this asset (prevent confusion)
  const otherDrafts = baselines.filter(
    b => b.asset_id === baseline.asset_id && b.id !== baseline.id && b.status === 'draft'
  )
  if (otherDrafts.length) {
    return { ok: false, reason: `${otherDrafts.length} other draft baseline(s) exist for this asset. Resolve or delete them first.` }
  }

  return { ok: true }
}

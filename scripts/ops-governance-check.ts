#!/usr/bin/env tsx
// Denver Engineering — Governance & Replay Integrity Check
// Run: npx tsx scripts/ops-governance-check.ts
//
// Focused check on governance durability and replay integrity only.
// Faster than the full health snapshot; suitable for pre-deployment gates.
// Exits with code 1 if any governance or replay constraint is violated.

import { pool } from '../api/db/pool.js'

// ─── Constants (mirrors postGATypes.ts) ──────────────────────────────────────

const GOVERNANCE_DURABILITY_MIN_PASS_RATE = 0.98
const GOVERNANCE_EMERGENCY_THRESHOLD = 0.95
const REPLAY_DRIFT_ALERT_THRESHOLD = 0.01

// ─── Types ────────────────────────────────────────────────────────────────────

interface GovernanceResult {
  dimension: string
  passRate: number
  isDurable: boolean
  trend: string
  failCount: number
}

interface DriftAlert {
  id: string
  streamId: string
  tenantId: string
  driftPct: number
  detectedAt: Date
}

// ─── Checks ───────────────────────────────────────────────────────────────────

async function getLatestGovernanceDimensions(): Promise<GovernanceResult[]> {
  const result = await pool.query(`
    SELECT DISTINCT ON (dimension)
      dimension, pass_rate, is_durable, trend, fail_count
    FROM pga_governance_durability
    ORDER BY dimension, recorded_at DESC
  `)

  return result.rows.map(row => ({
    dimension: row.dimension as string,
    passRate: Number(row.pass_rate),
    isDurable: row.is_durable as boolean,
    trend: row.trend as string,
    failCount: Number(row.fail_count),
  }))
}

async function getOpenDriftAlerts(): Promise<DriftAlert[]> {
  const result = await pool.query(`
    SELECT id, stream_id, tenant_id, drift_pct, detected_at
    FROM pga_replay_drift_records
    WHERE resolved_at IS NULL
    ORDER BY detected_at ASC
  `)

  return result.rows.map(row => ({
    id: row.id as string,
    streamId: row.stream_id as string,
    tenantId: row.tenant_id as string,
    driftPct: Number(row.drift_pct),
    detectedAt: new Date(row.detected_at as string),
  }))
}

async function checkReplayGates(): Promise<{ pass: number; fail: number; warn: number }> {
  const result = await pool.query(`
    SELECT status, COUNT(*) AS cnt
    FROM pga_launch_gates
    WHERE category = 'replay'
    GROUP BY status
  `)

  const counts = { pass: 0, fail: 0, warn: 0 }
  for (const row of result.rows) {
    counts[row.status as 'pass' | 'fail' | 'warn'] = Number(row.cnt)
  }
  return counts
}

async function checkBlockedProposals(): Promise<number> {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM pga_evolution_proposals
    WHERE governance_risk = 'high' AND approved_by IS NULL AND status NOT IN ('rejected','implemented')
  `)
  return Number(result.rows[0]?.cnt ?? 0)
}

async function checkApprovalEnforcement(): Promise<{ total: number; missing: number }> {
  // Check moderation actions applied without a reviewer ID (should be zero)
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE moderation_action IS NOT NULL AND reviewer_id IS NULL) AS missing_reviewer
    FROM pga_ecosystem_trust_records
    WHERE moderation_action IS NOT NULL
  `)
  const row = result.rows[0]
  return {
    total: Number(row?.total ?? 0),
    missing: Number(row?.missing_reviewer ?? 0),
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

function ago(d: Date): string {
  const ms = Date.now() - d.getTime()
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m ago`
  return `${m}m ago`
}

async function main(): Promise<void> {
  let exitCode = 0

  console.log('')
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║     DENVER ENGINEERING — GOVERNANCE & REPLAY CHECK   ║')
  console.log(`║     ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC                        ║`)
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log('')

  try {
    // 1. Governance Dimensions
    console.log('━━━ GOVERNANCE DIMENSIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const dimensions = await getLatestGovernanceDimensions()

    if (dimensions.length === 0) {
      console.log('  ⚠️  No governance dimension records found')
    }

    for (const dim of dimensions) {
      const isEmergency = dim.passRate < GOVERNANCE_EMERGENCY_THRESHOLD
      const isDurable = dim.passRate >= GOVERNANCE_DURABILITY_MIN_PASS_RATE
      const icon = isEmergency ? '❌' : isDurable ? '✅' : '⚠️ '
      const trendIcon = dim.trend === 'improving' ? '↑' : dim.trend === 'degrading' ? '↓' : '→'

      console.log(`  ${icon} ${dim.dimension.padEnd(24)} ${pct(dim.passRate).padStart(7)}  ${trendIcon} ${dim.trend}  (${dim.failCount} fail${dim.failCount !== 1 ? 's' : ''})`)

      if (isEmergency) {
        console.log(`     ❗ EMERGENCY: pass rate below 95% — SEV-1 incident required`)
        exitCode = 1
      } else if (!isDurable) {
        console.log(`     ⚡ Below 98% durability threshold — investigate within 24h`)
        if (exitCode === 0) exitCode = 1
      }
      if (dim.trend === 'degrading') {
        console.log(`     ⚡ Degrading trend — engage ${dim.dimension} owner immediately`)
      }
    }

    console.log('')

    // 2. Replay Drift Alerts
    console.log('━━━ REPLAY DRIFT ALERTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const driftAlerts = await getOpenDriftAlerts()

    if (driftAlerts.length === 0) {
      console.log('  ✅ No open replay drift alerts')
    } else {
      console.log(`  ❌ ${driftAlerts.length} open alert(s) — new tenant activations BLOCKED`)
      exitCode = 1

      for (const alert of driftAlerts) {
        const ageHours = (Date.now() - alert.detectedAt.getTime()) / 3_600_000
        const urgency = ageHours > 24 ? '🚨' : ageHours > 4 ? '⚠️ ' : '⏰'
        console.log(`  ${urgency} stream:${alert.streamId} tenant:${alert.tenantId}`)
        console.log(`     drift: ${pct(alert.driftPct)}  (threshold: ${pct(REPLAY_DRIFT_ALERT_THRESHOLD)})  opened: ${ago(alert.detectedAt)}`)
      }
    }

    console.log('')

    // 3. Replay Gates
    console.log('━━━ REPLAY LAUNCH GATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const replayGates = await checkReplayGates()
    const totalReplayGates = replayGates.pass + replayGates.fail + replayGates.warn

    if (totalReplayGates === 0) {
      console.log('  ✅ No replay gates recorded')
    } else {
      const failIcon = replayGates.fail > 0 ? '❌' : '✅'
      console.log(`  ${failIcon} Replay gates: ${replayGates.pass} pass / ${replayGates.warn} warn / ${replayGates.fail} fail`)
      if (replayGates.fail > 0) {
        console.log(`     ❗ ZERO-TOLERANCE: ${replayGates.fail} replay gate(s) in fail status — deployment blocked`)
        exitCode = 1
      }
    }

    console.log('')

    // 4. Approval Enforcement
    console.log('━━━ APPROVAL ENFORCEMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const approval = await checkApprovalEnforcement()

    if (approval.missing > 0) {
      console.log(`  ❌ ${approval.missing} moderation action(s) without reviewer ID — NON-NEGOTIABLE VIOLATION`)
      exitCode = 1
    } else {
      console.log(`  ✅ All ${approval.total} moderation action(s) have reviewer IDs`)
    }

    console.log('')

    // 5. Blocked Evolution Proposals
    console.log('━━━ EVOLUTION PROPOSALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    const blockedCount = await checkBlockedProposals()

    if (blockedCount > 0) {
      console.log(`  ⚠️  ${blockedCount} high-risk proposal(s) pending council approval`)
      console.log(`     These cannot proceed without a named reviewer — review in council`)
    } else {
      console.log('  ✅ No blocked high-risk proposals')
    }

    console.log('')

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    if (exitCode === 0) {
      console.log('🟢 GOVERNANCE CHECK: PASS — platform governance is healthy')
    } else {
      console.log('🔴 GOVERNANCE CHECK: FAIL — one or more constraints violated')
      console.log('   Reference: docs/STEWARDSHIP_INCIDENT_PROTOCOL.md')
    }
    console.log('')
  } catch (err) {
    console.error('Governance check failed with error:', err)
    exitCode = 2
  } finally {
    await pool.end()
  }

  process.exit(exitCode)
}

main()

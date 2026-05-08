#!/usr/bin/env tsx
// Denver Engineering — Operational Health Snapshot
// Run: npx tsx scripts/ops-health-snapshot.ts
//
// Queries all Post-GA operational tables and prints a health summary.
// Exits with code 1 if any domain is in FAIL status.

import { pool } from '../api/db/pool.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = 'PASS' | 'WARN' | 'FAIL'

interface DomainResult {
  domain: string
  status: Status
  metrics: { label: string; value: string; status: Status }[]
  notes: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classify(value: number, passThreshold: number, warnThreshold: number, higherIsBetter = true): Status {
  if (higherIsBetter) {
    if (value >= passThreshold) return 'PASS'
    if (value >= warnThreshold) return 'WARN'
    return 'FAIL'
  } else {
    if (value <= passThreshold) return 'PASS'
    if (value <= warnThreshold) return 'WARN'
    return 'FAIL'
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function statusIcon(s: Status): string {
  if (s === 'PASS') return '✅'
  if (s === 'WARN') return '⚠️ '
  return '❌'
}

function domainIcon(s: Status): string {
  if (s === 'PASS') return '🟢'
  if (s === 'WARN') return '🟡'
  return '🔴'
}

// ─── Domain Checks ────────────────────────────────────────────────────────────

async function checkGovernanceDurability(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  // Latest pass rate per dimension
  const dimResult = await pool.query(`
    SELECT DISTINCT ON (dimension)
      dimension, pass_rate, trend, is_durable
    FROM pga_governance_durability
    ORDER BY dimension, recorded_at DESC
  `)

  let allDurable = true
  let minPassRate = 1.0

  for (const row of dimResult.rows) {
    const passRate = Number(row.pass_rate)
    minPassRate = Math.min(minPassRate, passRate)
    const s = classify(passRate, 0.98, 0.95)
    if (s !== 'PASS') allDurable = false
    if (row.trend === 'degrading') notes.push(`${row.dimension} is degrading`)
    metrics.push({ label: row.dimension, value: pct(passRate), status: s })
  }

  // Open replay drift alerts
  const driftResult = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pga_replay_drift_records WHERE resolved_at IS NULL
  `)
  const openAlerts = Number(driftResult.rows[0]?.cnt ?? 0)
  const alertStatus: Status = openAlerts === 0 ? 'PASS' : openAlerts <= 2 ? 'WARN' : 'FAIL'
  metrics.push({ label: 'Open replay drift alerts', value: String(openAlerts), status: alertStatus })
  if (openAlerts > 0) notes.push(`${openAlerts} unresolved replay drift alert(s) — block new activations`)

  const overallStatus: Status = !allDurable || openAlerts > 2 ? 'FAIL'
    : !allDurable || openAlerts > 0 ? 'WARN' : 'PASS'

  return { domain: 'Governance Durability', status: overallStatus, metrics, notes }
}

async function checkDeploymentReliability(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const waveResult = await pool.query(`
    SELECT wave_name, deployed_count, failed_count, status, replay_validated
    FROM pga_rollout_waves
    WHERE status IN ('active','pending')
    ORDER BY created_at DESC
  `)

  let worstWaveStatus: Status = 'PASS'

  for (const row of waveResult.rows) {
    const deployed = Number(row.deployed_count)
    const failed = Number(row.failed_count)
    const total = deployed + failed
    const successRate = total > 0 ? deployed / total : 1.0
    const s = classify(successRate, 0.80, 0.60)
    if (s === 'FAIL') worstWaveStatus = 'FAIL'
    else if (s === 'WARN' && worstWaveStatus !== 'FAIL') worstWaveStatus = 'WARN'
    metrics.push({ label: `Wave: ${row.wave_name}`, value: pct(successRate), status: s })
    if (!row.replay_validated) {
      notes.push(`Wave "${row.wave_name}" was not replay-validated — abort required`)
      worstWaveStatus = 'FAIL'
    }
  }

  if (waveResult.rows.length === 0) {
    metrics.push({ label: 'Active waves', value: '0', status: 'PASS' })
  }

  // Readiness: tenants ready but not deployed
  const readyResult = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pga_tenant_launch_records WHERE status='ready'
  `)
  const readyCount = Number(readyResult.rows[0]?.cnt ?? 0)
  metrics.push({ label: 'Tenants ready to deploy', value: String(readyCount), status: 'PASS' })

  return { domain: 'Deployment Reliability', status: worstWaveStatus, metrics, notes }
}

async function checkEcosystemTrust(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const recordResult = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE trust_score >= 75 AND moderation_action NOT IN ('reject','revoke')) AS trusted,
      COUNT(*) FILTER (WHERE is_auto_reject_eligible) AS auto_reject_eligible
    FROM pga_ecosystem_trust_records
  `)

  const row = recordResult.rows[0]
  const total = Number(row?.total ?? 0)
  const trusted = Number(row?.trusted ?? 0)
  const autoRejectEligible = Number(row?.auto_reject_eligible ?? 0)

  const signal = total > 0 ? trusted / total : 1.0
  const signalStatus = classify(signal, 0.75, 0.65)
  metrics.push({ label: 'Ecosystem trust signal', value: pct(signal), status: signalStatus })
  metrics.push({ label: 'Auto-reject eligible entities', value: String(autoRejectEligible), status: autoRejectEligible > 0 ? 'WARN' : 'PASS' })

  if (autoRejectEligible > 0) notes.push(`${autoRejectEligible} entity/entities are auto-reject eligible — assign reviewer`)

  const queueResult = await pool.query(`
    SELECT priority, COUNT(*) AS cnt
    FROM pga_moderation_queue
    GROUP BY priority
  `)

  let criticalCount = 0
  for (const qRow of queueResult.rows) {
    const cnt = Number(qRow.cnt)
    const s: Status = qRow.priority === 'critical' ? (cnt > 0 ? 'WARN' : 'PASS')
      : qRow.priority === 'high' ? (cnt > 5 ? 'WARN' : 'PASS') : 'PASS'
    if (qRow.priority === 'critical') criticalCount = cnt
    metrics.push({ label: `Queue (${qRow.priority})`, value: String(cnt), status: s })
  }

  if (criticalCount > 0) notes.push(`${criticalCount} critical moderation item(s) require same-day review`)

  const overallStatus: Status = signalStatus === 'FAIL' ? 'FAIL'
    : signalStatus === 'WARN' || criticalCount > 3 ? 'WARN' : 'PASS'

  return { domain: 'Ecosystem Trust', status: overallStatus, metrics, notes }
}

async function checkCustomerSuccess(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const adoptionResult = await pool.query(`
    SELECT
      AVG(adoption_score) AS avg_score,
      COUNT(*) FILTER (WHERE churn_risk >= 0.35) AS at_risk_count,
      COUNT(*) FILTER (WHERE adoption_score >= 65 AND churn_risk < 0.35) AS healthy_count,
      COUNT(*) AS total
    FROM pga_customer_adoption
    WHERE assessed_at = (SELECT MAX(assessed_at) FROM pga_customer_adoption a2 WHERE a2.tenant_id = pga_customer_adoption.tenant_id)
  `)

  const aRow = adoptionResult.rows[0]
  const avgScore = Number(aRow?.avg_score ?? 0)
  const atRisk = Number(aRow?.at_risk_count ?? 0)
  const healthy = Number(aRow?.healthy_count ?? 0)
  const totalTenants = Number(aRow?.total ?? 0)

  const scoreStatus = classify(avgScore, 65, 50)
  metrics.push({ label: 'Avg adoption score', value: avgScore.toFixed(1), status: scoreStatus })
  metrics.push({ label: 'At-risk tenants', value: String(atRisk), status: atRisk === 0 ? 'PASS' : atRisk <= 3 ? 'WARN' : 'FAIL' })
  metrics.push({ label: 'Healthy tenants', value: `${healthy} / ${totalTenants}`, status: healthy === totalTenants ? 'PASS' : 'WARN' })

  if (atRisk > 0) notes.push(`${atRisk} tenant(s) at churn risk — assign customer success within 72h`)

  const overallStatus: Status = scoreStatus === 'FAIL' || atRisk > 5 ? 'FAIL'
    : scoreStatus === 'WARN' || atRisk > 0 ? 'WARN' : 'PASS'

  return { domain: 'Customer Success', status: overallStatus, metrics, notes }
}

async function checkTelemetry(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const telResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE drift_severity != 'none') AS alert_count,
      COUNT(*) FILTER (WHERE drift_severity = 'severe') AS severe_count
    FROM pga_telemetry_records
    WHERE recorded_at >= $1
  `, [sinceDate])

  const telRow = telResult.rows[0]
  const alertCount = Number(telRow?.alert_count ?? 0)
  const severeCount = Number(telRow?.severe_count ?? 0)

  const driftScore = Math.max(0, 100 - alertCount * 5 - severeCount * 15)
  const driftStatus = classify(driftScore, 70, 50)

  metrics.push({ label: 'Drift score (7d)', value: String(driftScore), status: driftStatus })
  metrics.push({ label: 'Alert records (7d)', value: String(alertCount), status: alertCount === 0 ? 'PASS' : alertCount <= 5 ? 'WARN' : 'FAIL' })
  metrics.push({ label: 'Severe records (7d)', value: String(severeCount), status: severeCount === 0 ? 'PASS' : 'FAIL' })

  if (severeCount > 0) notes.push(`${severeCount} severe telemetry drift record(s) — page on-call`)

  // Check for replay_latency severe
  const replayDriftResult = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pga_telemetry_records
    WHERE metric = 'replay_latency' AND drift_severity = 'severe' AND recorded_at >= $1
  `, [sinceDate])
  const replayLatencySevere = Number(replayDriftResult.rows[0]?.cnt ?? 0)
  if (replayLatencySevere > 0) {
    metrics.push({ label: 'Replay latency severe drift', value: String(replayLatencySevere), status: 'FAIL' })
    notes.push('Replay latency severe drift — escalate to replay integrity team immediately')
  }

  const overallStatus: Status = driftStatus === 'FAIL' || severeCount > 0 ? 'FAIL'
    : driftStatus === 'WARN' ? 'WARN' : 'PASS'

  return { domain: 'Production Telemetry', status: overallStatus, metrics, notes }
}

async function checkComplexityGovernance(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const trendResult = await pool.query(`
    SELECT DISTINCT ON (environment)
      environment, growth_pct, trend, is_over_limit, current_score
    FROM pga_complexity_trends
    ORDER BY environment, measured_at DESC
  `)

  let anyOverLimit = false
  for (const row of trendResult.rows) {
    const growthPct = Number(row.growth_pct)
    const isOverLimit = row.is_over_limit as boolean
    const s: Status = isOverLimit ? 'FAIL' : row.trend === 'accelerating' ? 'WARN' : 'PASS'
    if (isOverLimit) anyOverLimit = true
    metrics.push({
      label: `${row.environment} growth`,
      value: `${(growthPct * 100).toFixed(1)}% (${row.trend})`,
      status: s,
    })
    if (isOverLimit) notes.push(`${row.environment} complexity over 10% limit — freeze evolution proposals`)
  }

  const blockedResult = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pga_evolution_proposals
    WHERE governance_risk = 'high' AND approved_by IS NULL
  `)
  const blockedCount = Number(blockedResult.rows[0]?.cnt ?? 0)
  metrics.push({ label: 'Blocked proposals (high-risk, unapproved)', value: String(blockedCount), status: blockedCount === 0 ? 'PASS' : 'WARN' })
  if (blockedCount > 0) notes.push(`${blockedCount} high-risk proposal(s) pending council approval`)

  const overallStatus: Status = anyOverLimit ? 'FAIL' : blockedCount > 3 ? 'WARN' : 'PASS'

  return { domain: 'Complexity Governance', status: overallStatus, metrics, notes }
}

async function checkSupportOperations(): Promise<DomainResult> {
  const metrics: DomainResult['metrics'] = []
  const notes: string[] = []

  const openResult = await pool.query(`SELECT COUNT(*) AS cnt FROM pga_support_operations WHERE resolved_at IS NULL`)
  const openCount = Number(openResult.rows[0]?.cnt ?? 0)
  metrics.push({ label: 'Open incidents', value: String(openCount), status: openCount === 0 ? 'PASS' : openCount <= 5 ? 'WARN' : 'FAIL' })

  const slaResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE resolution_time_ms > 14400000) AS breached,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS total_resolved
    FROM pga_support_operations
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `)
  const slaRow = slaResult.rows[0]
  const breached = Number(slaRow?.breached ?? 0)
  const totalResolved = Number(slaRow?.total_resolved ?? 0)
  const breachRate = totalResolved > 0 ? breached / totalResolved : 0
  const slaStatus = classify(breachRate, 0.05, 0.20, false)
  metrics.push({ label: 'SLA breach rate (7d)', value: pct(breachRate), status: slaStatus })

  // Replay-failure cluster check
  const clusterResult = await pool.query(`
    SELECT cluster_type, COUNT(*) AS cnt
    FROM pga_support_operations
    WHERE resolved_at IS NULL AND cluster_type IS NOT NULL
    GROUP BY cluster_type
  `)
  for (const row of clusterResult.rows) {
    const cnt = Number(row.cnt)
    const s: Status = row.cluster_type === 'replay_failure' && cnt > 0 ? 'FAIL'
      : cnt > 3 ? 'WARN' : 'PASS'
    metrics.push({ label: `Open cluster: ${row.cluster_type}`, value: String(cnt), status: s })
    if (row.cluster_type === 'replay_failure' && cnt > 0)
      notes.push(`Active replay_failure cluster (${cnt} incidents) — escalate to replay integrity team`)
  }

  if (openCount > 0) notes.push(`${openCount} open support incident(s) — review resolution progress`)

  const overallStatus: Status = slaStatus === 'FAIL' || notes.some(n => n.includes('replay_failure')) ? 'FAIL'
    : openCount > 5 || slaStatus === 'WARN' ? 'WARN' : 'PASS'

  return { domain: 'Support Operations', status: overallStatus, metrics, notes }
}

// ─── Report Renderer ──────────────────────────────────────────────────────────

function renderReport(results: DomainResult[]): void {
  const now = new Date().toISOString()
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║         DENVER ENGINEERING — OPERATIONAL HEALTH SNAPSHOT     ║')
  console.log(`║  Generated: ${now.slice(0, 19).replace('T', ' ')} UTC                         ║`)
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')

  let anyFail = false
  let anyWarn = false

  for (const result of results) {
    if (result.status === 'FAIL') anyFail = true
    if (result.status === 'WARN') anyWarn = true

    console.log(`${domainIcon(result.status)} ${result.domain.toUpperCase()} — ${result.status}`)
    for (const m of result.metrics) {
      console.log(`   ${statusIcon(m.status)} ${m.label}: ${m.value}`)
    }
    for (const note of result.notes) {
      console.log(`   ⚡ ${note}`)
    }
    console.log('')
  }

  console.log('──────────────────────────────────────────────────────────────')
  const overallStatus: Status = anyFail ? 'FAIL' : anyWarn ? 'WARN' : 'PASS'
  console.log(`${domainIcon(overallStatus)} PLATFORM STATUS: ${overallStatus}`)
  console.log('')

  if (overallStatus === 'FAIL') {
    console.log('🚨 One or more domains require immediate attention.')
    console.log('   See STEWARDSHIP_INCIDENT_PROTOCOL.md for response procedures.')
  } else if (overallStatus === 'WARN') {
    console.log('⚠️  Platform is operational but requires attention in warned domains.')
    console.log('   See OPERATIONAL_CADENCE_CALENDAR.md for response guidance.')
  } else {
    console.log('✅ Platform is healthy across all monitored domains.')
  }
  console.log('')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const results = await Promise.all([
      checkGovernanceDurability(),
      checkDeploymentReliability(),
      checkEcosystemTrust(),
      checkCustomerSuccess(),
      checkTelemetry(),
      checkComplexityGovernance(),
      checkSupportOperations(),
    ])

    renderReport(results)

    const hasFail = results.some(r => r.status === 'FAIL')
    process.exit(hasFail ? 1 : 0)
  } catch (err) {
    console.error('Health snapshot failed:', err)
    process.exit(2)
  } finally {
    await pool.end()
  }
}

main()

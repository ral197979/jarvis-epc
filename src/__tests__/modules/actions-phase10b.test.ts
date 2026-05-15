// Denver Engineering — Phase 10 Tests Part B (v10.0.0)
// Tests: uptimeMonitor, reliabilityScoringEngine, supportDiagnosticsEngine,
//        tenantSupportHistory, replaySupportAnalyzer, governanceValidationEngine,
//        replayIntegrityAuditor, aiExplainabilityValidator

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Static mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => {
  const mockPool = { query: vi.fn() }
  return {
    pool: mockPool,
    tenantQuery: vi.fn(),
  }
})

import { pool as mockPool, tenantQuery } from '../../../api/db/pool'
import {
  recordUptimeCheck, getUptimeHistory, getLatestCheck,
  __testHooks as uptimeHooks,
} from '../../../api/services/phase10/uptimeMonitor'

import {
  recordReliabilityScore, getReliabilityScore, listReliabilityScores,
  recordSLOViolation, resolveViolation,
  __testHooks as reliabilityHooks,
} from '../../../api/services/phase10/reliabilityScoringEngine'

import {
  createDiagnosticReport, recordDiagnosticCheck, finalizeDiagnosticReport,
  getDiagnosticReport, getDiagnosticChecks,
  __testHooks as diagnosticsHooks,
} from '../../../api/services/phase10/supportDiagnosticsEngine'

import {
  createSupportTicket, updateTicketStatus, getSupportTicket, listTenantTickets,
  escalateTicket, getTicketEscalations, getOpenTicketCount,
  __testHooks as supportHooks,
} from '../../../api/services/phase10/tenantSupportHistory'

import {
  openReplayIncident, resolveReplayIncident, getReplayIncident, listReplayIncidents,
  analyzeReplayDivergence,
  __testHooks as replaySupportHooks,
} from '../../../api/services/phase10/replaySupportAnalyzer'

import {
  createGovernanceRun, recordGovernanceResult, finalizeGovernanceRun,
  getGovernanceRun, getGovernanceResults, checkAuditLogCompleteness, checkPolicyCoverage,
  __testHooks as governanceHooks,
} from '../../../api/services/phase10/governanceValidationEngine'

import {
  startIntegrityAudit, recordIntegrityViolation, completeIntegrityAudit,
  getIntegrityAudit, getIntegrityViolations, auditTenantStreamIntegrity,
  __testHooks as integrityHooks,
} from '../../../api/services/phase10/replayIntegrityAuditor'

import {
  createExplainabilityReport, recordExplainabilityCheck, finalizeExplainabilityReport,
  getExplainabilityReport, getExplainabilityChecks,
  runModelCardCheck, runDecisionTraceCheck, runBiasAuditCheck, runHumanOversightCheck,
  __testHooks as explainHooks,
} from '../../../api/services/phase10/aiExplainabilityValidator'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mp = vi.mocked(mockPool)
const mTQ = vi.mocked(tenantQuery)

function mockRow<T>(row: T) {
  mp.query.mockResolvedValueOnce({ rows: [row] } as never)
}

function mockRows<T>(rows: T[]) {
  mp.query.mockResolvedValueOnce({ rows } as never)
}

function mockEmpty() {
  mp.query.mockResolvedValueOnce({ rows: [] } as never)
}

const NOW = '2026-01-01T00:00:00.000Z'

// ─── Suite 7: uptimeMonitor ───────────────────────────────────────────────────

describe('uptimeMonitor', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeUptimePercent: all healthy → 100', () => {
    expect(uptimeHooks.computeUptimePercent(10, 10)).toBe(100)
  })

  it('computeUptimePercent: 9/10 → 90', () => {
    expect(uptimeHooks.computeUptimePercent(9, 10)).toBe(90)
  })

  it('computeUptimePercent: 0 total → 100', () => {
    expect(uptimeHooks.computeUptimePercent(0, 0)).toBe(100)
  })

  it('isMetricHealthy: api_latency 300ms → true', () => {
    expect(uptimeHooks.isMetricHealthy('api_latency', 300)).toBe(true)
  })

  it('isMetricHealthy: api_latency 600ms → false (threshold 500)', () => {
    expect(uptimeHooks.isMetricHealthy('api_latency', 600)).toBe(false)
  })

  it('isMetricHealthy: queue_latency 1500ms → true (threshold 2000)', () => {
    expect(uptimeHooks.isMetricHealthy('queue_latency', 1500)).toBe(true)
  })

  it('classifyLatency: < 100 → fast', () => {
    expect(uptimeHooks.classifyLatency(50)).toBe('fast')
  })

  it('classifyLatency: 100–499 → acceptable', () => {
    expect(uptimeHooks.classifyLatency(200)).toBe('acceptable')
  })

  it('classifyLatency: 500–1999 → slow', () => {
    expect(uptimeHooks.classifyLatency(1000)).toBe('slow')
  })

  it('classifyLatency: >= 2000 → critical', () => {
    expect(uptimeHooks.classifyLatency(2500)).toBe('critical')
  })

  it('UPTIME_THRESHOLDS has api_latency = 500', () => {
    expect(uptimeHooks.UPTIME_THRESHOLDS['api_latency']).toBe(500)
  })

  it('recordUptimeCheck inserts and maps', async () => {
    mockRow({
      id: 'ur-1', metric_type: 'api_latency', value_ms: 120, healthy: true,
      environment: 'production', metadata: '{}', checked_at: NOW, created_at: NOW,
    })
    const record = await recordUptimeCheck({
      metricType: 'api_latency', valueMs: 120, healthy: true,
    })
    expect(record.metricType).toBe('api_latency')
    expect(record.valueMs).toBe(120)
    expect(record.healthy).toBe(true)
  })

  it('getUptimeHistory returns records', async () => {
    mockRows([
      {
        id: 'ur-1', metric_type: 'api_latency', value_ms: 100, healthy: true,
        environment: 'production', metadata: '{}', checked_at: NOW, created_at: NOW,
      },
    ])
    const records = await getUptimeHistory('api_latency')
    expect(records).toHaveLength(1)
    expect(records[0].healthy).toBe(true)
  })

  it('getLatestCheck returns null when not found', async () => {
    mockEmpty()
    const record = await getLatestCheck('queue_latency')
    expect(record).toBeNull()
  })

  it('getLatestCheck returns most recent', async () => {
    mockRow({
      id: 'ur-2', metric_type: 'websocket_uptime', value_ms: 1, healthy: true,
      environment: 'production', metadata: '{}', checked_at: NOW, created_at: NOW,
    })
    const record = await getLatestCheck('websocket_uptime')
    expect(record?.metricType).toBe('websocket_uptime')
  })
})

// ─── Suite 8: reliabilityScoringEngine ───────────────────────────────────────

describe('reliabilityScoringEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeCompositeScore: perfect conditions → high score', () => {
    const score = reliabilityHooks.computeCompositeScore(100, 0, 200)
    expect(score).toBeGreaterThan(80)
  })

  it('computeCompositeScore: 0% uptime → low score', () => {
    const score = reliabilityHooks.computeCompositeScore(0, 1, 5000)
    expect(score).toBeLessThan(20)
  })

  it('isSLOMet: 99.9% uptime → true', () => {
    expect(reliabilityHooks.isSLOMet(99.9)).toBe(true)
  })

  it('isSLOMet: 99.8% uptime → false', () => {
    expect(reliabilityHooks.isSLOMet(99.8)).toBe(false)
  })

  it('isSLOMet: custom target 99.5% → true at 99.5', () => {
    expect(reliabilityHooks.isSLOMet(99.5, 0.995)).toBe(true)
  })

  it('computeErrorBudgetRemaining: 99.9% target, 99.95% uptime → positive', () => {
    const budget = reliabilityHooks.computeErrorBudgetRemaining(99.95, 0.999)
    expect(budget).toBeGreaterThan(0)
  })

  it('computeErrorBudgetRemaining: 99.9% target, 99.85% uptime → 0 (fully consumed)', () => {
    const budget = reliabilityHooks.computeErrorBudgetRemaining(99.85, 0.999)
    expect(budget).toBe(0)
  })

  it('RELIABILITY_SLO_DEFAULT is 0.999', () => {
    expect(reliabilityHooks.RELIABILITY_SLO_DEFAULT).toBe(0.999)
  })

  it('recordReliabilityScore inserts and maps', async () => {
    mockRow({
      id: 'rs-1', environment: 'production', period: 'daily', uptime_percent: 99.95,
      error_rate: 0.001, p50_ms: 80, p95_ms: 300, p99_ms: 500,
      composite_score: 92, slo_met: true, scored_at: NOW, created_at: NOW,
    })
    const score = await recordReliabilityScore('production', 'daily', 99.95, 0.001, 80, 300, 500)
    expect(score.uptimePercent).toBeCloseTo(99.95)
    expect(score.sloMet).toBe(true)
    expect(score.compositeScore).toBe(92)
  })

  it('getReliabilityScore returns null when missing', async () => {
    mockEmpty()
    expect(await getReliabilityScore('missing')).toBeNull()
  })

  it('listReliabilityScores returns array', async () => {
    mockRows([
      {
        id: 'rs-1', environment: 'production', period: 'weekly', uptime_percent: 99.9,
        error_rate: 0.001, p50_ms: 80, p95_ms: 300, p99_ms: 500,
        composite_score: 90, slo_met: true, scored_at: NOW, created_at: NOW,
      },
    ])
    const scores = await listReliabilityScores('production', 'weekly', 5)
    expect(scores).toHaveLength(1)
  })

  it('recordSLOViolation inserts and maps', async () => {
    mockRow({
      id: 'sv-1', environment: 'production', violation_type: 'uptime',
      description: 'Downtime event', duration_ms: 300000, impacted_tenants: 5,
      root_cause: null, occurred_at: NOW, resolved_at: null, created_at: NOW,
    })
    const v = await recordSLOViolation('production', 'uptime', 'Downtime event', 300000, 5)
    expect(v.violationType).toBe('uptime')
    expect(v.impactedTenants).toBe(5)
    expect(v.resolvedAt).toBeNull()
  })

  it('resolveViolation sets resolvedAt and rootCause', async () => {
    mockRow({
      id: 'sv-1', environment: 'production', violation_type: 'uptime',
      description: 'Downtime event', duration_ms: 300000, impacted_tenants: 5,
      root_cause: 'DB overload', occurred_at: NOW, resolved_at: NOW, created_at: NOW,
    })
    const v = await resolveViolation('sv-1', 'DB overload')
    expect(v.resolvedAt).not.toBeNull()
    expect(v.rootCause).toBe('DB overload')
  })

  it('resolveViolation throws when not found', async () => {
    mockEmpty()
    await expect(resolveViolation('missing', 'cause')).rejects.toThrow('not found')
  })
})

// ─── Suite 9: supportDiagnosticsEngine ───────────────────────────────────────

describe('supportDiagnosticsEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('generateDiagnosticId returns 12-char hex', () => {
    const id = diagnosticsHooks.generateDiagnosticId('T1', NOW)
    expect(id).toHaveLength(12)
    expect(id).toMatch(/^[0-9a-f]+$/)
  })

  it('prioritizeChecks: critical failures first', () => {
    const checks = [
      {
        id: '1', reportId: 'r', checkName: 'c1', severity: 'info' as const,
        passed: true, detail: '', remediation: null, checkedAt: new Date(), createdAt: new Date(),
      },
      {
        id: '2', reportId: 'r', checkName: 'c2', severity: 'critical' as const,
        passed: false, detail: '', remediation: null, checkedAt: new Date(), createdAt: new Date(),
      },
      {
        id: '3', reportId: 'r', checkName: 'c3', severity: 'warning' as const,
        passed: false, detail: '', remediation: null, checkedAt: new Date(), createdAt: new Date(),
      },
    ]
    const sorted = diagnosticsHooks.prioritizeChecks(checks)
    expect(sorted[0].severity).toBe('critical')
    expect(sorted[0].passed).toBe(false)
  })

  it('createDiagnosticReport inserts and maps', async () => {
    mockRow({
      id: 'dr-1', tenant_id: 'T1', reported_by: 'support', issue_description: 'slow API',
      status: 'pending', check_count: 0, critical_count: 0, warning_count: 0,
      completed_at: null, created_at: NOW,
    })
    const report = await createDiagnosticReport('T1', 'support', 'slow API')
    expect(report.tenantId).toBe('T1')
    expect(report.status).toBe('pending')
  })

  it('recordDiagnosticCheck inserts and maps', async () => {
    mockRow({
      id: 'dc-1', report_id: 'dr-1', check_name: 'tenant_config', severity: 'critical',
      passed: true, detail: '1 config found', remediation: null,
      checked_at: NOW, created_at: NOW,
    })
    const check = await recordDiagnosticCheck('dr-1', 'tenant_config', 'critical', true, '1 config found')
    expect(check.checkName).toBe('tenant_config')
    expect(check.passed).toBe(true)
  })

  it('finalizeDiagnosticReport: no critical → healthy', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 3, critical: 0, warning: 0 }],
    } as never)
    mockRow({
      id: 'dr-1', tenant_id: 'T1', reported_by: 'support', issue_description: 'test',
      status: 'healthy', check_count: 3, critical_count: 0, warning_count: 0,
      completed_at: NOW, created_at: NOW,
    })
    const report = await finalizeDiagnosticReport('dr-1')
    expect(report.status).toBe('healthy')
  })

  it('finalizeDiagnosticReport: critical failures → critical status', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 3, critical: 2, warning: 0 }],
    } as never)
    mockRow({
      id: 'dr-1', tenant_id: 'T1', reported_by: 'support', issue_description: 'test',
      status: 'critical', check_count: 3, critical_count: 2, warning_count: 0,
      completed_at: NOW, created_at: NOW,
    })
    const report = await finalizeDiagnosticReport('dr-1')
    expect(report.status).toBe('critical')
    expect(report.criticalCount).toBe(2)
  })

  it('getDiagnosticReport returns null when not found', async () => {
    mockEmpty()
    expect(await getDiagnosticReport('missing')).toBeNull()
  })

  it('getDiagnosticChecks returns sorted checks', async () => {
    mockRows([
      {
        id: 'dc-1', report_id: 'dr-1', check_name: 'replay', severity: 'critical',
        passed: false, detail: 'failed', remediation: 'fix it', checked_at: NOW, created_at: NOW,
      },
    ])
    const checks = await getDiagnosticChecks('dr-1')
    expect(checks).toHaveLength(1)
    expect(checks[0].severity).toBe('critical')
  })
})

// ─── Suite 10: tenantSupportHistory ──────────────────────────────────────────

describe('tenantSupportHistory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeSLADeadline: critical → 4 hours from createdAt', () => {
    const created = new Date('2026-01-01T10:00:00Z')
    const deadline = supportHooks.computeSLADeadline('critical', created)
    expect(deadline.getTime()).toBe(created.getTime() + 4 * 60 * 60 * 1000)
  })

  it('computeSLADeadline: low → 7 days', () => {
    const created = new Date('2026-01-01T10:00:00Z')
    const deadline = supportHooks.computeSLADeadline('low', created)
    expect(deadline.getTime()).toBe(created.getTime() + 7 * 24 * 60 * 60 * 1000)
  })

  it('isSLABreached: far future → false', () => {
    const created = new Date()
    expect(supportHooks.isSLABreached('low', created, new Date())).toBe(false)
  })

  it('isSLABreached: critical from 1 day ago → true', () => {
    const created = new Date(Date.now() - 25 * 60 * 60 * 1000)
    expect(supportHooks.isSLABreached('critical', created, new Date())).toBe(true)
  })

  const baseTicketRow = {
    id: 'tk-1', tenant_id: 'T1', subject: 'Login broken', description: 'Cannot log in',
    priority: 'high', reported_by: 'alice', category: 'auth', status: 'open',
    resolved_by: null, resolution_note: null, resolved_at: null, created_at: NOW,
  }

  it('createSupportTicket inserts and maps', async () => {
    mockRow(baseTicketRow)
    const ticket = await createSupportTicket({
      tenantId: 'T1', subject: 'Login broken', description: 'Cannot log in',
      priority: 'high', reportedBy: 'alice',
    })
    expect(ticket.subject).toBe('Login broken')
    expect(ticket.priority).toBe('high')
    expect(ticket.status).toBe('open')
  })

  it('updateTicketStatus: resolved sets resolvedAt', async () => {
    mockRow({
      ...baseTicketRow, status: 'resolved', resolved_by: 'bob',
      resolution_note: 'Fixed SSO', resolved_at: NOW,
    })
    const ticket = await updateTicketStatus('tk-1', 'resolved', 'bob', 'Fixed SSO')
    expect(ticket.status).toBe('resolved')
    expect(ticket.resolvedAt).not.toBeNull()
  })

  it('updateTicketStatus throws when not found', async () => {
    mockEmpty()
    await expect(updateTicketStatus('missing', 'resolved')).rejects.toThrow('not found')
  })

  it('getSupportTicket returns null when missing', async () => {
    mockEmpty()
    expect(await getSupportTicket('missing')).toBeNull()
  })

  it('listTenantTickets returns filtered list', async () => {
    mockRows([baseTicketRow])
    const tickets = await listTenantTickets('T1', 'open')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].status).toBe('open')
  })

  it('getOpenTicketCount returns count', async () => {
    mockRow({ cnt: 7 })
    const count = await getOpenTicketCount('T1')
    expect(count).toBe(7)
  })

  it('escalateTicket inserts escalation and updates ticket', async () => {
    mockRow({
      id: 'esc-1', ticket_id: 'tk-1', escalated_to: 'eng-lead',
      reason: 'P0 impact', escalated_at: NOW, created_at: NOW,
    })
    mp.query.mockResolvedValueOnce({ rows: [] } as never) // update priority
    const esc = await escalateTicket('tk-1', 'eng-lead', 'P0 impact')
    expect(esc.escalatedTo).toBe('eng-lead')
    expect(esc.reason).toBe('P0 impact')
  })

  it('getTicketEscalations returns list', async () => {
    mockRows([
      { id: 'esc-1', ticket_id: 'tk-1', escalated_to: 'eng', reason: 'P0', escalated_at: NOW, created_at: NOW },
    ])
    const escs = await getTicketEscalations('tk-1')
    expect(escs).toHaveLength(1)
  })
})

// ─── Suite 11: replaySupportAnalyzer ─────────────────────────────────────────

describe('replaySupportAnalyzer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('generateRecommendation: nondeterministic_code → audit handlers', () => {
    const rec = replaySupportHooks.generateRecommendation('nondeterministic_code')
    expect(rec).toContain('audit')
  })

  it('generateRecommendation: missing_event → verify stream', () => {
    const rec = replaySupportHooks.generateRecommendation('missing_event')
    expect(rec).toContain('completeness')
  })

  it('generateRecommendation: unknown/null → escalate', () => {
    const rec = replaySupportHooks.generateRecommendation(null)
    expect(rec).toContain('escalate')
  })

  it('computeDivergenceHash returns 16-char hex', () => {
    const h = replaySupportHooks.computeDivergenceHash('abc', 'xyz')
    expect(h).toHaveLength(16)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('isDivergenceToleranceExceeded: 0 fails → false', () => {
    expect(replaySupportHooks.isDivergenceToleranceExceeded(0)).toBe(false)
  })

  it('isDivergenceToleranceExceeded: 1 fail → true', () => {
    expect(replaySupportHooks.isDivergenceToleranceExceeded(1)).toBe(true)
  })

  it('computeDivergenceRate: 2/10 → 0.2', () => {
    expect(replaySupportHooks.computeDivergenceRate(2, 10)).toBeCloseTo(0.2)
  })

  it('computeDivergenceRate: 0 total → 0', () => {
    expect(replaySupportHooks.computeDivergenceRate(0, 0)).toBe(0)
  })

  const baseIncidentRow = {
    id: 'ri-1', tenant_id: 'T1', event_stream_id: 'es-1', divergence_hash: 'abc≠xyz',
    replay_pass_count: 2, replay_fail_count: 1, status: 'open',
    root_cause: null, resolution: null, resolved_at: null, created_at: NOW,
  }

  it('openReplayIncident inserts and maps', async () => {
    mockRow(baseIncidentRow)
    const incident = await openReplayIncident('T1', 'es-1', 'abc≠xyz', 2, 1)
    expect(incident.tenantId).toBe('T1')
    expect(incident.status).toBe('open')
    expect(incident.replayFailCount).toBe(1)
  })

  it('resolveReplayIncident updates and maps', async () => {
    mockRow({
      ...baseIncidentRow, status: 'resolved',
      root_cause: 'nondeterministic_code', resolution: 'Removed Math.random()',
      resolved_at: NOW,
    })
    const incident = await resolveReplayIncident('ri-1', 'nondeterministic_code', 'Removed Math.random()')
    expect(incident.status).toBe('resolved')
    expect(incident.rootCause).toBe('nondeterministic_code')
  })

  it('resolveReplayIncident throws when not found', async () => {
    mockEmpty()
    await expect(resolveReplayIncident('missing', 'unknown', 'none')).rejects.toThrow('not found')
  })

  it('getReplayIncident returns null when missing', async () => {
    mockEmpty()
    expect(await getReplayIncident('missing')).toBeNull()
  })

  it('listReplayIncidents returns array', async () => {
    mockRows([baseIncidentRow])
    const incidents = await listReplayIncidents('T1', 'open')
    expect(incidents).toHaveLength(1)
  })

  it('analyzeReplayDivergence returns rootCauses and recommendation', async () => {
    mTQ.mockResolvedValueOnce({
      rows: [{ root_cause: 'clock_skew', cnt: 3 }],
    } as never)
    mTQ.mockResolvedValueOnce({
      rows: [{ total: 3 }],
    } as never)
    const result = await analyzeReplayDivergence('T1', 'es-1')
    expect(result.rootCauses).toHaveLength(1)
    expect(result.rootCauses[0].cause).toBe('clock_skew')
    expect(result.recommendation).toBeTruthy()
    expect(result.incidentCount).toBe(3)
  })
})

// ─── Suite 12: governanceValidationEngine ────────────────────────────────────

describe('governanceValidationEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeGovernanceScore: all passed → 100', () => {
    expect(governanceHooks.computeGovernanceScore(5, 5)).toBe(100)
  })

  it('computeGovernanceScore: 0 total → 100', () => {
    expect(governanceHooks.computeGovernanceScore(0, 0)).toBe(100)
  })

  it('computeGovernanceScore: 3/5 → 60', () => {
    expect(governanceHooks.computeGovernanceScore(3, 5)).toBe(60)
  })

  it('isGovernanceCompliant: pass + 0 failed → true', () => {
    const run = {
      id: 'gr-1', environment: 'prod', triggeredBy: 'ci',
      overallOutcome: 'pass' as const, dimensionCount: 5,
      passedCount: 5, failedCount: 0, warnedCount: 0,
      completedAt: null, createdAt: new Date(),
    }
    expect(governanceHooks.isGovernanceCompliant(run)).toBe(true)
  })

  it('isGovernanceCompliant: warn → false', () => {
    const run = {
      id: 'gr-1', environment: 'prod', triggeredBy: 'ci',
      overallOutcome: 'warn' as const, dimensionCount: 5,
      passedCount: 4, failedCount: 0, warnedCount: 1,
      completedAt: null, createdAt: new Date(),
    }
    expect(governanceHooks.isGovernanceCompliant(run)).toBe(false)
  })

  it('createGovernanceRun inserts and maps', async () => {
    mockRow({
      id: 'govr-1', environment: 'production', triggered_by: 'ci',
      overall_outcome: 'pending', dimension_count: 0, passed_count: 0,
      failed_count: 0, warned_count: 0, completed_at: null, created_at: NOW,
    })
    const run = await createGovernanceRun('production', 'ci')
    expect(run.overallOutcome).toBe('pending')
    expect(run.triggeredBy).toBe('ci')
  })

  it('recordGovernanceResult inserts and maps', async () => {
    mockRow({
      id: 'gvr-1', run_id: 'govr-1', dimension: 'audit_completeness', outcome: 'pass',
      score: 95, detail: 'OK', evidence: '["100 events"]', gaps: '[]',
      validated_at: NOW, created_at: NOW,
    })
    const result = await recordGovernanceResult(
      'govr-1', 'audit_completeness', 'pass', 95, 'OK',
      ['100 events'], [],
    )
    expect(result.outcome).toBe('pass')
    expect(result.evidence).toContain('100 events')
  })

  it('finalizeGovernanceRun: all pass → overall pass', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 5, passed: 5, failed: 0, warned: 0 }],
    } as never)
    mockRow({
      id: 'govr-1', environment: 'production', triggered_by: 'ci',
      overall_outcome: 'pass', dimension_count: 5, passed_count: 5,
      failed_count: 0, warned_count: 0, completed_at: NOW, created_at: NOW,
    })
    const run = await finalizeGovernanceRun('govr-1')
    expect(run.overallOutcome).toBe('pass')
  })

  it('finalizeGovernanceRun: any fail → fail', async () => {
    mp.query.mockResolvedValueOnce({
      rows: [{ total: 5, passed: 3, failed: 2, warned: 0 }],
    } as never)
    mockRow({
      id: 'govr-1', environment: 'production', triggered_by: 'ci',
      overall_outcome: 'fail', dimension_count: 5, passed_count: 3,
      failed_count: 2, warned_count: 0, completed_at: NOW, created_at: NOW,
    })
    const run = await finalizeGovernanceRun('govr-1')
    expect(run.overallOutcome).toBe('fail')
  })

  it('getGovernanceRun returns null when missing', async () => {
    mockEmpty()
    expect(await getGovernanceRun('missing')).toBeNull()
  })

  it('getGovernanceResults returns results', async () => {
    mockRows([
      {
        id: 'gvr-1', run_id: 'govr-1', dimension: 'policy_coverage', outcome: 'pass',
        score: 100, detail: 'OK', evidence: '[]', gaps: '[]',
        validated_at: NOW, created_at: NOW,
      },
    ])
    const results = await getGovernanceResults('govr-1')
    expect(results).toHaveLength(1)
  })

  it('checkAuditLogCompleteness: > 100 events → pass', async () => {
    mTQ.mockResolvedValueOnce({ rows: [{ cnt: 500 }] } as never)
    mockRow({
      id: 'gvr-1', run_id: 'govr-1', dimension: 'audit_completeness', outcome: 'pass',
      score: 95, detail: '500 audit events in past 7 days', evidence: '[]', gaps: '[]',
      validated_at: NOW, created_at: NOW,
    })
    const result = await checkAuditLogCompleteness('govr-1', 'T1')
    expect(result.outcome).toBe('pass')
  })

  it('checkPolicyCoverage: >= 10 policies → pass', async () => {
    mockRow({ cnt: 12 }) // pg_policies count
    mockRow({
      id: 'gvr-1', run_id: 'govr-1', dimension: 'policy_coverage', outcome: 'pass',
      score: 100, detail: '12 RLS policies active', evidence: '[]', gaps: '[]',
      validated_at: NOW, created_at: NOW,
    })
    const result = await checkPolicyCoverage('govr-1')
    expect(result.outcome).toBe('pass')
  })
})

// ─── Suite 13: replayIntegrityAuditor ────────────────────────────────────────

describe('replayIntegrityAuditor', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeAuditHash returns 24-char hex', () => {
    const h = integrityHooks.computeAuditHash('audit-1', 10, 0)
    expect(h).toHaveLength(24)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('computeAuditHash is deterministic', () => {
    expect(integrityHooks.computeAuditHash('a', 5, 1)).toBe(integrityHooks.computeAuditHash('a', 5, 1))
  })

  it('isAuditClean: status=clean + 0 violations → true', () => {
    const audit = {
      id: 'ia-1', environment: 'prod', auditedBy: 'ci', eventStreamIds: [],
      status: 'clean' as const, streamsAudited: 5, violationsFound: 0,
      auditHash: 'abc', completedAt: null, createdAt: new Date(),
    }
    expect(integrityHooks.isAuditClean(audit)).toBe(true)
  })

  it('isAuditClean: violations_found → false', () => {
    const audit = {
      id: 'ia-1', environment: 'prod', auditedBy: 'ci', eventStreamIds: [],
      status: 'violations_found' as const, streamsAudited: 5, violationsFound: 2,
      auditHash: 'abc', completedAt: null, createdAt: new Date(),
    }
    expect(integrityHooks.isAuditClean(audit)).toBe(false)
  })

  it('computeIntegrityScore: 0 violations → 100', () => {
    expect(integrityHooks.computeIntegrityScore(10, 0)).toBe(100)
  })

  it('computeIntegrityScore: 1 violation in 5 streams → 80', () => {
    expect(integrityHooks.computeIntegrityScore(5, 1)).toBe(80)
  })

  it('computeIntegrityScore: 0 streams → 100', () => {
    expect(integrityHooks.computeIntegrityScore(0, 0)).toBe(100)
  })

  it('MAX_REPLAY_DIVERGENCE_TOLERANCE is 0', () => {
    expect(integrityHooks.MAX_REPLAY_DIVERGENCE_TOLERANCE).toBe(0)
  })

  const baseAuditRow = {
    id: 'ia-1', environment: 'production', audited_by: 'ci',
    event_stream_ids: '["es-1","es-2"]', status: 'running',
    streams_audited: 0, violations_found: 0, audit_hash: null,
    completed_at: null, created_at: NOW,
  }

  it('startIntegrityAudit inserts and maps', async () => {
    mockRow(baseAuditRow)
    const audit = await startIntegrityAudit('production', 'ci', ['es-1', 'es-2'])
    expect(audit.status).toBe('running')
    expect(audit.eventStreamIds).toEqual(['es-1', 'es-2'])
  })

  it('recordIntegrityViolation inserts and maps', async () => {
    mockRow({
      id: 'iv-1', audit_id: 'ia-1', event_stream_id: 'es-1',
      violation_type: 'open_replay_incidents', description: '2 unresolved',
      severity: 'critical', evidence: '{}', detected_at: NOW, created_at: NOW,
    })
    const v = await recordIntegrityViolation('ia-1', 'es-1', 'open_replay_incidents', '2 unresolved', 'critical')
    expect(v.severity).toBe('critical')
    expect(v.eventStreamId).toBe('es-1')
  })

  it('completeIntegrityAudit: 0 violations → clean', async () => {
    mockRow({ cnt: 0 }) // violations count
    mockRow({
      ...baseAuditRow, status: 'clean', streams_audited: 5,
      violations_found: 0, audit_hash: 'abc123', completed_at: NOW,
    })
    const audit = await completeIntegrityAudit('ia-1', 5)
    expect(audit.status).toBe('clean')
    expect(audit.violationsFound).toBe(0)
  })

  it('completeIntegrityAudit: violations → violations_found', async () => {
    mockRow({ cnt: 2 })
    mockRow({
      ...baseAuditRow, status: 'violations_found', streams_audited: 5,
      violations_found: 2, audit_hash: 'abc123', completed_at: NOW,
    })
    const audit = await completeIntegrityAudit('ia-1', 5)
    expect(audit.status).toBe('violations_found')
  })

  it('getIntegrityAudit returns null when missing', async () => {
    mockEmpty()
    expect(await getIntegrityAudit('missing')).toBeNull()
  })

  it('getIntegrityViolations returns list', async () => {
    mockRows([
      {
        id: 'iv-1', audit_id: 'ia-1', event_stream_id: 'es-1',
        violation_type: 'open_replay_incidents', description: '1 open',
        severity: 'critical', evidence: '{}', detected_at: NOW, created_at: NOW,
      },
    ])
    const violations = await getIntegrityViolations('ia-1')
    expect(violations).toHaveLength(1)
  })

  it('auditTenantStreamIntegrity: 0 incidents → clean', async () => {
    mTQ.mockResolvedValueOnce({ rows: [{ violations: 0 }] } as never)
    const result = await auditTenantStreamIntegrity('T1', 'es-1', 'ia-1')
    expect(result.clean).toBe(true)
    expect(result.violationCount).toBe(0)
  })

  it('auditTenantStreamIntegrity: 1 incident → not clean + records violation', async () => {
    mTQ.mockResolvedValueOnce({ rows: [{ violations: 1 }] } as never)
    // recordIntegrityViolation call
    mockRow({
      id: 'iv-1', audit_id: 'ia-1', event_stream_id: 'es-1',
      violation_type: 'open_replay_incidents', description: '1 unresolved',
      severity: 'critical', evidence: '{}', detected_at: NOW, created_at: NOW,
    })
    const result = await auditTenantStreamIntegrity('T1', 'es-1', 'ia-1')
    expect(result.clean).toBe(false)
    expect(result.violationCount).toBe(1)
  })
})

// ─── Suite 14: aiExplainabilityValidator ─────────────────────────────────────

describe('aiExplainabilityValidator', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeExplainabilityScore: all passed → 100', () => {
    expect(explainHooks.computeExplainabilityScore(4, 4)).toBe(100)
  })

  it('computeExplainabilityScore: 0 required → 100', () => {
    expect(explainHooks.computeExplainabilityScore(0, 0)).toBe(100)
  })

  it('computeExplainabilityScore: 3/4 → 75', () => {
    expect(explainHooks.computeExplainabilityScore(3, 4)).toBe(75)
  })

  it('isFullyCompliant: compliant + 4 passed + 0 failed → true', () => {
    const report = {
      id: 'er-1', tenantId: 'T1', modelId: 'gpt4', decisionContext: 'hiring',
      status: 'compliant' as const, checksRequired: 4, checksPassed: 4, checksFailed: 0,
      completedAt: null, createdAt: new Date(),
    }
    expect(explainHooks.isFullyCompliant(report)).toBe(true)
  })

  it('isFullyCompliant: partial → false', () => {
    const report = {
      id: 'er-1', tenantId: 'T1', modelId: 'gpt4', decisionContext: 'hiring',
      status: 'partial' as const, checksRequired: 4, checksPassed: 3, checksFailed: 0,
      completedAt: null, createdAt: new Date(),
    }
    expect(explainHooks.isFullyCompliant(report)).toBe(false)
  })

  it('AI_EXPLAINABILITY_REQUIRED_CHECKS is 4', () => {
    expect(explainHooks.AI_EXPLAINABILITY_REQUIRED_CHECKS).toBe(4)
  })

  const baseReportRow = {
    id: 'er-1', tenant_id: 'T1', model_id: 'gpt-4', decision_context: 'hiring',
    status: 'pending', checks_required: 4, checks_passed: 0, checks_failed: 0,
    completed_at: null, created_at: NOW,
  }

  it('createExplainabilityReport inserts and maps', async () => {
    mockRow(baseReportRow)
    const report = await createExplainabilityReport('T1', 'gpt-4', 'hiring')
    expect(report.tenantId).toBe('T1')
    expect(report.modelId).toBe('gpt-4')
    expect(report.status).toBe('pending')
    expect(report.checksRequired).toBe(4)
  })

  it('recordExplainabilityCheck inserts and maps', async () => {
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'model_card_present',
      passed: true, rationale: 'Found', evidence: 'model_cards row', checked_at: NOW, created_at: NOW,
    })
    const check = await recordExplainabilityCheck('er-1', 'model_card_present', true, 'Found', 'model_cards row')
    expect(check.checkName).toBe('model_card_present')
    expect(check.passed).toBe(true)
  })

  it('finalizeExplainabilityReport: 4 passed → compliant', async () => {
    mp.query.mockResolvedValueOnce({ rows: [{ passed_cnt: 4, failed_cnt: 0 }] } as never)
    mockRow({ ...baseReportRow, status: 'compliant', checks_passed: 4, completed_at: NOW })
    const report = await finalizeExplainabilityReport('er-1')
    expect(report.status).toBe('compliant')
  })

  it('finalizeExplainabilityReport: failures present → non_compliant', async () => {
    mp.query.mockResolvedValueOnce({ rows: [{ passed_cnt: 2, failed_cnt: 2 }] } as never)
    mockRow({ ...baseReportRow, status: 'non_compliant', checks_passed: 2, checks_failed: 2, completed_at: NOW })
    const report = await finalizeExplainabilityReport('er-1')
    expect(report.status).toBe('non_compliant')
  })

  it('getExplainabilityReport returns null when missing', async () => {
    mockEmpty()
    expect(await getExplainabilityReport('missing')).toBeNull()
  })

  it('getExplainabilityChecks returns list', async () => {
    mockRows([
      {
        id: 'ec-1', report_id: 'er-1', check_name: 'decision_trace_available',
        passed: true, rationale: 'Found', evidence: null, checked_at: NOW, created_at: NOW,
      },
    ])
    const checks = await getExplainabilityChecks('er-1')
    expect(checks).toHaveLength(1)
    expect(checks[0].checkName).toBe('decision_trace_available')
  })

  it('runModelCardCheck: model card exists → pass', async () => {
    mockRow({ cnt: 1 }) // model_cards query
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'model_card_present',
      passed: true, rationale: 'Model card found', evidence: 'model_cards entry for gpt-4',
      checked_at: NOW, created_at: NOW,
    })
    const check = await runModelCardCheck('er-1', 'gpt-4')
    expect(check.passed).toBe(true)
    expect(check.checkName).toBe('model_card_present')
  })

  it('runModelCardCheck: no model card → fail', async () => {
    mockRow({ cnt: 0 })
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'model_card_present',
      passed: false, rationale: 'No model card', evidence: null, checked_at: NOW, created_at: NOW,
    })
    const check = await runModelCardCheck('er-1', 'gpt-4')
    expect(check.passed).toBe(false)
  })

  it('runDecisionTraceCheck: traces found → pass', async () => {
    mTQ.mockResolvedValueOnce({ rows: [{ cnt: 50 }] } as never)
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'decision_trace_available',
      passed: true, rationale: '50 decision trace(s)', evidence: '50 traces', checked_at: NOW, created_at: NOW,
    })
    const check = await runDecisionTraceCheck('er-1', 'T1', 'gpt-4')
    expect(check.passed).toBe(true)
  })

  it('runDecisionTraceCheck: no traces → fail', async () => {
    mTQ.mockResolvedValueOnce({ rows: [{ cnt: 0 }] } as never)
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'decision_trace_available',
      passed: false, rationale: 'No decision traces', evidence: null, checked_at: NOW, created_at: NOW,
    })
    const check = await runDecisionTraceCheck('er-1', 'T1', 'gpt-4')
    expect(check.passed).toBe(false)
  })

  it('runHumanOversightCheck: policy exists → pass', async () => {
    mockRow({ cnt: 2 })
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'human_oversight_policy',
      passed: true, rationale: '2 active policies', evidence: null, checked_at: NOW, created_at: NOW,
    })
    const check = await runHumanOversightCheck('er-1', 'gpt-4')
    expect(check.passed).toBe(true)
  })

  it('runHumanOversightCheck: no policy → fail', async () => {
    mockRow({ cnt: 0 })
    mockRow({
      id: 'ec-1', report_id: 'er-1', check_name: 'human_oversight_policy',
      passed: false, rationale: 'No active human oversight policy', evidence: null,
      checked_at: NOW, created_at: NOW,
    })
    const check = await runHumanOversightCheck('er-1', 'gpt-4')
    expect(check.passed).toBe(false)
  })
})

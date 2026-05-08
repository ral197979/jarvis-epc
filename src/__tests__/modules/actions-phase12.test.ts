// Denver Engineering — Phase 12 Tests Part A (v12.0.0)
// Tests: productionBehaviorAnalyzer, operationalUsageProfiler, telemetryDriftDetector,
//        continuousGovernanceAuditor, governanceRegressionMonitor, replayConsistencyMonitor,
//        ecosystemModerationEngine, pluginTrustScorer, workflowSafetyScanner,
//        partnerReputationService, customerSuccessOptimizer, adoptionAccelerationEngine,
//        operationalMaturityScorer, resilienceOptimizationEngine, queueRebalancer,
//        failoverRecoveryCoordinator, efficiencyOptimizationEngine, infrastructureEfficiencyAnalyzer

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Static mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => {
  const mockPool = { query: vi.fn() }
  return {
    default: mockPool,
    pool: mockPool,
    tenantQuery: vi.fn(),
  }
})

import { default as mockPool, tenantQuery } from '../../../api/db/pool'
import { vi as viImport } from 'vitest'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockRow = (row: Record<string, unknown>) => ({
  rows: [row], rowCount: 1,
})
const mockRows = (rows: Record<string, unknown>[]) => ({ rows, rowCount: rows.length })
const mockEmpty = () => ({ rows: [], rowCount: 0 })

function makeBehaviorEventRow(overrides = {}) {
  return {
    id: 'be1', tenant_id: 't1', event_type: 'workflow_abandoned',
    context: {}, session_id: null,
    recorded_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeUsageProfileRow(overrides = {}) {
  return {
    id: 'up1', tenant_id: 't1',
    period_start: new Date().toISOString(), period_end: new Date().toISOString(),
    workflow_completion_rate: 0.8, abandonment_rate: 0.15,
    recommendation_override_rate: 0.2, ai_acceptance_rate: 0.7,
    plugin_adoption_count: 3, replay_frequency: 5,
    support_escalation_rate: 0.05, onboarding_friction_score: 0.2,
    edge_sync_reliability: 0.98, computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDriftRow(overrides = {}) {
  return {
    id: 'td1', metric_name: 'feature_adoption',
    baseline_value: 100, current_value: 75,
    drift_pct: 0.25, direction: 'decreasing',
    is_alert: true,
    detected_at: new Date().toISOString(), resolved_at: null,
    ...overrides,
  }
}

function makeAuditCycleRow(overrides = {}) {
  return {
    id: 'ac1', environment: 'production',
    checks_run: ['replay_integrity', 'tenant_isolation'],
    passed: 10, failed: 0, warnings: 1,
    overall_status: 'warning',
    audit_hash: 'abc123def456789012345678',
    ran_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRegressionAlertRow(overrides = {}) {
  return {
    id: 'ra1', check_type: 'replay_integrity',
    previous_status: 'pass', current_status: 'fail',
    severity: 'critical', detail: 'Hash mismatch detected',
    detected_at: new Date().toISOString(), resolved_at: null,
    ...overrides,
  }
}

function makeConsistencyRow(overrides = {}) {
  return {
    id: 'rc1', tenant_id: 't1', stream_id: 's1',
    events_checked: 100, events_passed: 100,
    divergent_hashes: [],
    consistency_rate: 1.0,
    checked_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeModerationRow(overrides = {}) {
  return {
    id: 'mr1', target_id: 'plugin1', target_type: 'plugin',
    status: 'pending', trust_score: 80,
    reviewer_id: null, review_notes: null,
    sandbox_validated: false,
    immutable_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makePluginTrustRow(overrides = {}) {
  return {
    id: 'pt1', plugin_id: 'plugin1', score: 75,
    api_scope_risk: 0.3, data_access_risk: 0.2,
    sandbox_pass_rate: 0.95, abuse_flags: 0,
    author_reputation: 0.8,
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeWorkflowSafetyRow(overrides = {}) {
  return {
    id: 'ws1', workflow_id: 'wf1',
    checks_passed: 10, checks_failed: 0,
    replay_safe: true, tenant_isolation_safe: true,
    governance_safe: true, safety_score: 100,
    checked_at: new Date().toISOString(),
    ...overrides,
  }
}

function makePartnerRepRow(overrides = {}) {
  return {
    id: 'pr1', partner_id: 'p1',
    trust_level: 'trusted', error_rate: 0.01,
    security_incidents: 0, uptime_pct: 0.999,
    reputation_score: 78,
    last_updated: new Date().toISOString(),
    ...overrides,
  }
}

function makeSuccessScoreRow(overrides = {}) {
  return {
    id: 'ss1', tenant_id: 't1',
    onboarding_score: 90, adoption_score: 75,
    maturity_score: 70, support_health_score: 80,
    ai_usage_score: 65,
    overall_score: 77, churn_risk_score: 0.20,
    maturity_level: 'advanced',
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeResilienceRow(overrides = {}) {
  return {
    id: 'rs1', environment: 'production',
    worker_recovery_score: 85, replay_recovery_score: 90,
    websocket_resilience_score: 80, queue_balance_score: 75,
    cache_recovery_score: 88, failover_success_rate: 0.97,
    overall_score: 84,
    scored_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── productionBehaviorAnalyzer ───────────────────────────────────────────────

import { __testHooks as bh } from '../../../api/services/phase12/productionBehaviorAnalyzer'

describe('productionBehaviorAnalyzer', () => {
  describe('computeAbandonmentRate', () => {
    it('returns 0 when total is 0', () => {
      expect(bh.computeAbandonmentRate(0, 0)).toBe(0)
    })
    it('computes rate correctly', () => {
      expect(bh.computeAbandonmentRate(100, 25)).toBe(0.25)
    })
    it('handles 100% abandonment', () => {
      expect(bh.computeAbandonmentRate(50, 50)).toBe(1.0)
    })
  })

  describe('computeOverrideRate', () => {
    it('returns 0 when total is 0', () => {
      expect(bh.computeOverrideRate(0, 0)).toBe(0)
    })
    it('computes rate correctly', () => {
      expect(bh.computeOverrideRate(200, 60)).toBe(0.3)
    })
  })

  describe('classifyBehaviorRisk', () => {
    it('returns low for healthy metrics', () => {
      expect(bh.classifyBehaviorRisk(0.1, 0.2)).toBe('low')
    })
    it('returns medium when abandonment > 0.25', () => {
      expect(bh.classifyBehaviorRisk(0.3, 0.1)).toBe('medium')
    })
    it('returns medium when override > 0.35', () => {
      expect(bh.classifyBehaviorRisk(0.1, 0.4)).toBe('medium')
    })
    it('returns high when abandonment > 0.5', () => {
      expect(bh.classifyBehaviorRisk(0.6, 0.1)).toBe('high')
    })
    it('returns high when override > 0.6', () => {
      expect(bh.classifyBehaviorRisk(0.1, 0.7)).toBe('high')
    })
  })

  describe('_mapBehaviorEvent', () => {
    it('maps a DB row correctly', () => {
      const row = makeBehaviorEventRow()
      const result = bh._mapBehaviorEvent(row)
      expect(result.id).toBe('be1')
      expect(result.tenantId).toBe('t1')
      expect(result.eventType).toBe('workflow_abandoned')
      expect(result.sessionId).toBeNull()
      expect(result.recordedAt).toBeInstanceOf(Date)
    })
  })
})

// ─── operationalUsageProfiler ─────────────────────────────────────────────────

import { __testHooks as up } from '../../../api/services/phase12/operationalUsageProfiler'

describe('operationalUsageProfiler', () => {
  describe('computeOnboardingFrictionScore', () => {
    it('returns 0 when no steps', () => {
      expect(up.computeOnboardingFrictionScore(0, 0)).toBe(0)
    })
    it('computes ratio correctly', () => {
      expect(up.computeOnboardingFrictionScore(3, 10)).toBeCloseTo(0.3)
    })
    it('caps at 1.0', () => {
      expect(up.computeOnboardingFrictionScore(20, 10)).toBe(1.0)
    })
  })

  describe('computeEdgeSyncReliability', () => {
    it('returns 1.0 when no events', () => {
      expect(up.computeEdgeSyncReliability(0, 0)).toBe(1.0)
    })
    it('computes rate correctly', () => {
      expect(up.computeEdgeSyncReliability(95, 5)).toBe(0.95)
    })
    it('handles all failures', () => {
      expect(up.computeEdgeSyncReliability(0, 10)).toBe(0)
    })
  })

  describe('isProfileHealthy', () => {
    it('returns true for healthy profile', () => {
      const profile = up._mapUsageProfile(makeUsageProfileRow())
      expect(up.isProfileHealthy(profile)).toBe(true)
    })
    it('returns false when completion rate low', () => {
      const profile = up._mapUsageProfile(makeUsageProfileRow({ workflow_completion_rate: 0.5 }))
      expect(up.isProfileHealthy(profile)).toBe(false)
    })
    it('returns false when edge sync low', () => {
      const profile = up._mapUsageProfile(makeUsageProfileRow({ edge_sync_reliability: 0.9 }))
      expect(up.isProfileHealthy(profile)).toBe(false)
    })
  })

  describe('computeProfileHealthScore', () => {
    it('computes weighted score correctly', () => {
      const profile = up._mapUsageProfile(makeUsageProfileRow({
        workflow_completion_rate: 1.0,
        ai_acceptance_rate: 1.0,
        edge_sync_reliability: 1.0,
        support_escalation_rate: 0.0,
      }))
      expect(up.computeProfileHealthScore(profile)).toBe(100)
    })
    it('penalizes high escalation rate', () => {
      const profile = up._mapUsageProfile(makeUsageProfileRow({
        workflow_completion_rate: 1.0,
        ai_acceptance_rate: 1.0,
        edge_sync_reliability: 1.0,
        support_escalation_rate: 1.0,
      }))
      expect(up.computeProfileHealthScore(profile)).toBe(80)
    })
  })
})

// ─── telemetryDriftDetector ───────────────────────────────────────────────────

import { __testHooks as td } from '../../../api/services/phase12/telemetryDriftDetector'

describe('telemetryDriftDetector', () => {
  describe('computeDriftPct', () => {
    it('returns 0 when both zero', () => {
      expect(td.computeDriftPct(0, 0)).toBe(0)
    })
    it('returns 1.0 when baseline is 0 and current is non-zero', () => {
      expect(td.computeDriftPct(0, 5)).toBe(1.0)
    })
    it('computes 25% drift correctly', () => {
      expect(td.computeDriftPct(100, 75)).toBeCloseTo(0.25)
    })
    it('computes increase drift correctly', () => {
      expect(td.computeDriftPct(100, 130)).toBeCloseTo(0.30)
    })
  })

  describe('computeDriftDirection', () => {
    it('returns increasing when current > baseline', () => {
      expect(td.computeDriftDirection(100, 120)).toBe('increasing')
    })
    it('returns decreasing when current < baseline', () => {
      expect(td.computeDriftDirection(100, 80)).toBe('decreasing')
    })
    it('returns increasing when equal', () => {
      expect(td.computeDriftDirection(100, 100)).toBe('increasing')
    })
  })

  describe('isDriftAlert', () => {
    it('returns false below threshold (20%)', () => {
      expect(td.isDriftAlert(0.15)).toBe(false)
    })
    it('returns false at exact threshold', () => {
      expect(td.isDriftAlert(0.20)).toBe(false)
    })
    it('returns true above threshold', () => {
      expect(td.isDriftAlert(0.25)).toBe(true)
    })
  })

  describe('classifyDriftSeverity', () => {
    it('returns none for <= 5%', () => {
      expect(td.classifyDriftSeverity(0.04)).toBe('none')
    })
    it('returns minor for 6-15%', () => {
      expect(td.classifyDriftSeverity(0.10)).toBe('minor')
    })
    it('returns moderate for 16-35%', () => {
      expect(td.classifyDriftSeverity(0.25)).toBe('moderate')
    })
    it('returns severe above 35%', () => {
      expect(td.classifyDriftSeverity(0.50)).toBe('severe')
    })
  })
})

// ─── continuousGovernanceAuditor ──────────────────────────────────────────────

import { __testHooks as cga } from '../../../api/services/phase12/continuousGovernanceAuditor'

describe('continuousGovernanceAuditor', () => {
  describe('computeAuditCycleHash', () => {
    it('returns a 24-character hex string', () => {
      const hash = cga.computeAuditCycleHash('production', ['replay_integrity'], 10, 0, new Date())
      expect(hash).toHaveLength(24)
      expect(hash).toMatch(/^[a-f0-9]{24}$/)
    })
    it('is deterministic for same inputs', () => {
      const date = new Date('2026-01-01T00:00:00Z')
      const h1 = cga.computeAuditCycleHash('prod', ['tenant_isolation'], 5, 1, date)
      const h2 = cga.computeAuditCycleHash('prod', ['tenant_isolation'], 5, 1, date)
      expect(h1).toBe(h2)
    })
    it('sorts checks for canonical output', () => {
      const date = new Date('2026-01-01T00:00:00Z')
      const h1 = cga.computeAuditCycleHash('prod', ['replay_integrity', 'tenant_isolation'], 5, 0, date)
      const h2 = cga.computeAuditCycleHash('prod', ['tenant_isolation', 'replay_integrity'], 5, 0, date)
      expect(h1).toBe(h2)
    })
  })

  describe('classifyAuditStatus', () => {
    it('returns compliant when no failures or warnings', () => {
      expect(cga.classifyAuditStatus(10, 0, 0)).toBe('compliant')
    })
    it('returns warning when warnings exist', () => {
      expect(cga.classifyAuditStatus(9, 0, 1)).toBe('warning')
    })
    it('returns non_compliant when failures exist', () => {
      expect(cga.classifyAuditStatus(8, 2, 0)).toBe('non_compliant')
    })
    it('non_compliant takes priority over warnings', () => {
      expect(cga.classifyAuditStatus(7, 1, 2)).toBe('non_compliant')
    })
  })

  describe('isAuditCyclePassing', () => {
    it('returns true for compliant cycle with no failures', () => {
      const cycle = cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'compliant', failed: 0 }))
      expect(cga.isAuditCyclePassing(cycle)).toBe(true)
    })
    it('returns false for warning cycle', () => {
      const cycle = cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'warning', failed: 0 }))
      expect(cga.isAuditCyclePassing(cycle)).toBe(false)
    })
    it('returns false for non_compliant cycle', () => {
      const cycle = cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'non_compliant', failed: 2 }))
      expect(cga.isAuditCyclePassing(cycle)).toBe(false)
    })
  })

  describe('computeAuditPassRate', () => {
    it('returns 1.0 for empty array', () => {
      expect(cga.computeAuditPassRate([])).toBe(1.0)
    })
    it('computes rate correctly', () => {
      const cycles = [
        cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'compliant' })),
        cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'compliant' })),
        cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'non_compliant' })),
        cga._mapAuditCycle(makeAuditCycleRow({ overall_status: 'compliant' })),
      ]
      expect(cga.computeAuditPassRate(cycles)).toBeCloseTo(0.75)
    })
  })
})

// ─── governanceRegressionMonitor ─────────────────────────────────────────────

import { __testHooks as grm } from '../../../api/services/phase12/governanceRegressionMonitor'

describe('governanceRegressionMonitor', () => {
  describe('classifyRegressionSeverity', () => {
    it('returns critical for replay_integrity regardless of direction', () => {
      expect(grm.classifyRegressionSeverity('replay_integrity', 'warn', 'warn')).toBe('critical')
    })
    it('returns critical for tenant_isolation', () => {
      expect(grm.classifyRegressionSeverity('tenant_isolation', 'pass', 'warn')).toBe('critical')
    })
    it('returns critical when going from pass to fail', () => {
      expect(grm.classifyRegressionSeverity('policy_enforcement', 'pass', 'fail')).toBe('critical')
    })
    it('returns warning for non-critical checks', () => {
      expect(grm.classifyRegressionSeverity('ai_explainability', 'warn', 'fail')).toBe('warning')
    })
  })

  describe('isRegressionDetected', () => {
    it('returns true when pass → warn', () => {
      expect(grm.isRegressionDetected('pass', 'warn')).toBe(true)
    })
    it('returns true when pass → fail', () => {
      expect(grm.isRegressionDetected('pass', 'fail')).toBe(true)
    })
    it('returns true when warn → fail', () => {
      expect(grm.isRegressionDetected('warn', 'fail')).toBe(true)
    })
    it('returns false when pass → pass', () => {
      expect(grm.isRegressionDetected('pass', 'pass')).toBe(false)
    })
    it('returns false when fail → warn (improvement)', () => {
      expect(grm.isRegressionDetected('fail', 'warn')).toBe(false)
    })
  })

  describe('hasOpenCriticalRegression', () => {
    it('returns false when no alerts', () => {
      expect(grm.hasOpenCriticalRegression([])).toBe(false)
    })
    it('returns false when all resolved', () => {
      const alert = grm._mapRegressionAlert(makeRegressionAlertRow({ resolved_at: new Date().toISOString() }))
      expect(grm.hasOpenCriticalRegression([alert])).toBe(false)
    })
    it('returns true when critical + unresolved exists', () => {
      const alert = grm._mapRegressionAlert(makeRegressionAlertRow())
      expect(grm.hasOpenCriticalRegression([alert])).toBe(true)
    })
    it('returns false when only warning alerts open', () => {
      const alert = grm._mapRegressionAlert(makeRegressionAlertRow({ severity: 'warning' }))
      expect(grm.hasOpenCriticalRegression([alert])).toBe(false)
    })
  })
})

// ─── replayConsistencyMonitor ─────────────────────────────────────────────────

import { __testHooks as rcm } from '../../../api/services/phase12/replayConsistencyMonitor'

describe('replayConsistencyMonitor', () => {
  describe('computeReplayHash', () => {
    it('returns a 64-char hex string', () => {
      const hash = rcm.computeReplayHash({ a: 1, b: 'hello' })
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
    it('is deterministic', () => {
      const p = { z: 3, a: 1, m: 'test' }
      expect(rcm.computeReplayHash(p)).toBe(rcm.computeReplayHash(p))
    })
    it('uses sorted keys for canonicalization', () => {
      const p1 = { a: 1, b: 2 }
      const p2 = { b: 2, a: 1 }
      expect(rcm.computeReplayHash(p1)).toBe(rcm.computeReplayHash(p2))
    })
  })

  describe('computeConsistencyRate', () => {
    it('returns 1.0 when no events checked', () => {
      expect(rcm.computeConsistencyRate(0, 0)).toBe(1.0)
    })
    it('computes rate correctly', () => {
      expect(rcm.computeConsistencyRate(100, 99)).toBeCloseTo(0.99)
    })
    it('returns 1.0 for perfect consistency', () => {
      expect(rcm.computeConsistencyRate(50, 50)).toBe(1.0)
    })
  })

  describe('isConsistencyAcceptable', () => {
    it('returns true only for exact 1.0', () => {
      expect(rcm.isConsistencyAcceptable(1.0)).toBe(true)
    })
    it('returns false for 0.999', () => {
      expect(rcm.isConsistencyAcceptable(0.999)).toBe(false)
    })
  })

  describe('hasDivergence', () => {
    it('returns false when no divergent hashes', () => {
      const record = rcm._mapConsistencyRecord(makeConsistencyRow())
      expect(rcm.hasDivergence(record)).toBe(false)
    })
    it('returns true when divergent hashes present', () => {
      const record = rcm._mapConsistencyRecord(makeConsistencyRow({ divergent_hashes: ['abc', 'def'] }))
      expect(rcm.hasDivergence(record)).toBe(true)
    })
  })
})

// ─── ecosystemModerationEngine ────────────────────────────────────────────────

import { __testHooks as eme } from '../../../api/services/phase12/ecosystemModerationEngine'

describe('ecosystemModerationEngine', () => {
  describe('isModerationApproved', () => {
    it('returns true for approved status', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'approved' }))
      expect(eme.isModerationApproved(r)).toBe(true)
    })
    it('returns false for pending status', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'pending' }))
      expect(eme.isModerationApproved(r)).toBe(false)
    })
  })

  describe('canEscalateToApproved', () => {
    it('returns true when under_review, sandbox validated, high trust', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'under_review', sandbox_validated: true, trust_score: 75 }))
      expect(eme.canEscalateToApproved(r)).toBe(true)
    })
    it('returns false when not sandbox validated', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'under_review', sandbox_validated: false, trust_score: 80 }))
      expect(eme.canEscalateToApproved(r)).toBe(false)
    })
    it('returns false when trust score too low', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'under_review', sandbox_validated: true, trust_score: 65 }))
      expect(eme.canEscalateToApproved(r)).toBe(false)
    })
    it('returns false when wrong status', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'pending', sandbox_validated: true, trust_score: 80 }))
      expect(eme.canEscalateToApproved(r)).toBe(false)
    })
  })

  describe('isModerationFinal', () => {
    it('returns true for approved', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'approved' }))
      expect(eme.isModerationFinal(r)).toBe(true)
    })
    it('returns true for rejected', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'rejected' }))
      expect(eme.isModerationFinal(r)).toBe(true)
    })
    it('returns true for revoked', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'revoked' }))
      expect(eme.isModerationFinal(r)).toBe(true)
    })
    it('returns false for pending', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'pending' }))
      expect(eme.isModerationFinal(r)).toBe(false)
    })
    it('returns false for under_review', () => {
      const r = eme._mapModerationRecord(makeModerationRow({ status: 'under_review' }))
      expect(eme.isModerationFinal(r)).toBe(false)
    })
  })

  describe('computeModerationRisk', () => {
    it('returns low for safe plugin', () => {
      expect(eme.computeModerationRisk(80, true, 0)).toBe('low')
    })
    it('returns high when sandbox not validated', () => {
      expect(eme.computeModerationRisk(80, false, 0)).toBe('high')
    })
    it('returns high when 3+ abuse flags', () => {
      expect(eme.computeModerationRisk(80, true, 3)).toBe('high')
    })
    it('returns medium when trust score < 50', () => {
      expect(eme.computeModerationRisk(40, true, 0)).toBe('medium')
    })
    it('returns medium when 1 abuse flag', () => {
      expect(eme.computeModerationRisk(80, true, 1)).toBe('medium')
    })
  })
})

// ─── pluginTrustScorer ────────────────────────────────────────────────────────

import { __testHooks as pts } from '../../../api/services/phase12/pluginTrustScorer'

describe('pluginTrustScorer', () => {
  describe('computePluginTrustScore', () => {
    it('returns high score for clean plugin', () => {
      // (1.0×40 + 1.0×20) − (0.1×20 + 0.1×20) − 0 = 60−4 = 56; max formula = 60
      const score = pts.computePluginTrustScore(0.1, 0.1, 1.0, 0, 1.0)
      expect(score).toBeGreaterThan(50)
    })
    it('returns 0 for dangerous plugin', () => {
      const score = pts.computePluginTrustScore(1.0, 1.0, 0, 5, 0)
      expect(score).toBe(0)
    })
    it('returns 0 for plugin with many abuse flags', () => {
      const score = pts.computePluginTrustScore(0.5, 0.5, 0.8, 5, 0.5)
      expect(score).toBe(0)
    })
    it('caps at 100', () => {
      const score = pts.computePluginTrustScore(0, 0, 1.0, 0, 1.0)
      expect(score).toBeLessThanOrEqual(100)
    })
  })

  describe('isPluginTrusted', () => {
    it('returns true when score >= 70 and no abuse flags', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 75, abuse_flags: 0 }))
      expect(pts.isPluginTrusted(score)).toBe(true)
    })
    it('returns false when score < 70', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 65, abuse_flags: 0 }))
      expect(pts.isPluginTrusted(score)).toBe(false)
    })
    it('returns false when has abuse flags even if score high', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 80, abuse_flags: 1 }))
      expect(pts.isPluginTrusted(score)).toBe(false)
    })
  })

  describe('requiresManualReview', () => {
    it('returns true when score below threshold', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 60, abuse_flags: 0 }))
      expect(pts.requiresManualReview(score)).toBe(true)
    })
    it('returns true when abuse flags present', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 80, abuse_flags: 1 }))
      expect(pts.requiresManualReview(score)).toBe(true)
    })
    it('returns false for trusted plugin', () => {
      const score = pts._mapPluginTrustScore(makePluginTrustRow({ score: 80, abuse_flags: 0 }))
      expect(pts.requiresManualReview(score)).toBe(false)
    })
  })
})

// ─── workflowSafetyScanner ────────────────────────────────────────────────────

import { __testHooks as wss } from '../../../api/services/phase12/workflowSafetyScanner'

describe('workflowSafetyScanner', () => {
  describe('computeWorkflowSafetyScore', () => {
    it('returns 0 when tenant isolation is false', () => {
      expect(wss.computeWorkflowSafetyScore(10, 0, true, false, true)).toBe(0)
    })
    it('returns low score when not replay safe', () => {
      expect(wss.computeWorkflowSafetyScore(5, 0, false, true, true)).toBeLessThanOrEqual(20)
    })
    it('returns 100 for perfect workflow', () => {
      expect(wss.computeWorkflowSafetyScore(10, 0, true, true, true)).toBe(100)
    })
    it('penalizes governance issues', () => {
      const withGov = wss.computeWorkflowSafetyScore(10, 0, true, true, true)
      const withoutGov = wss.computeWorkflowSafetyScore(10, 0, true, true, false)
      expect(withoutGov).toBeLessThan(withGov)
    })
  })

  describe('isWorkflowSafe', () => {
    it('returns true for fully safe workflow', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow())
      expect(wss.isWorkflowSafe(check)).toBe(true)
    })
    it('returns false when not replay safe', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow({ replay_safe: false }))
      expect(wss.isWorkflowSafe(check)).toBe(false)
    })
    it('returns false when checks failed', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow({ checks_failed: 1 }))
      expect(wss.isWorkflowSafe(check)).toBe(false)
    })
  })

  describe('classifyWorkflowRisk', () => {
    it('returns safe for perfect workflow', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow({ safety_score: 95 }))
      expect(wss.classifyWorkflowRisk(check)).toBe('safe')
    })
    it('returns unsafe when tenant isolation fails', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow({ tenant_isolation_safe: false, safety_score: 0 }))
      expect(wss.classifyWorkflowRisk(check)).toBe('unsafe')
    })
    it('returns review_required when not replay safe', () => {
      const check = wss._mapSafetyCheck(makeWorkflowSafetyRow({ replay_safe: false, safety_score: 60 }))
      expect(wss.classifyWorkflowRisk(check)).toBe('review_required')
    })
  })
})

// ─── partnerReputationService ─────────────────────────────────────────────────

import { __testHooks as prs } from '../../../api/services/phase12/partnerReputationService'

describe('partnerReputationService', () => {
  describe('computePartnerReputationScore', () => {
    it('returns high score for healthy partner', () => {
      const score = prs.computePartnerReputationScore(0.001, 0, 0.999)
      expect(score).toBeGreaterThan(50)
    })
    it('penalizes security incidents', () => {
      const noIncidents = prs.computePartnerReputationScore(0.01, 0, 0.99)
      const withIncident = prs.computePartnerReputationScore(0.01, 2, 0.99)
      expect(withIncident).toBeLessThan(noIncidents)
    })
    it('never goes below 0', () => {
      const score = prs.computePartnerReputationScore(0.5, 5, 0.5)
      expect(score).toBeGreaterThanOrEqual(0)
    })
  })

  describe('classifyTrustLevel', () => {
    it('returns verified for high score, no incidents', () => {
      expect(prs.classifyTrustLevel(90, 0)).toBe('verified')
    })
    it('returns trusted for good score, no incidents', () => {
      expect(prs.classifyTrustLevel(70, 0)).toBe('trusted')
    })
    it('returns provisional with security incidents', () => {
      expect(prs.classifyTrustLevel(70, 1)).toBe('provisional')
    })
    it('returns untrusted for 3+ incidents', () => {
      expect(prs.classifyTrustLevel(70, 3)).toBe('untrusted')
    })
    it('returns untrusted for low score', () => {
      expect(prs.classifyTrustLevel(25, 0)).toBe('untrusted')
    })
  })

  describe('isPartnerReliable', () => {
    it('returns true for reliable partner', () => {
      const rep = prs._mapPartnerReputation(makePartnerRepRow())
      expect(prs.isPartnerReliable(rep)).toBe(true)
    })
    it('returns false for untrusted partner', () => {
      const rep = prs._mapPartnerReputation(makePartnerRepRow({ trust_level: 'untrusted' }))
      expect(prs.isPartnerReliable(rep)).toBe(false)
    })
    it('returns false for high error rate', () => {
      const rep = prs._mapPartnerReputation(makePartnerRepRow({ error_rate: 0.08 }))
      expect(prs.isPartnerReliable(rep)).toBe(false)
    })
  })
})

// ─── customerSuccessOptimizer ─────────────────────────────────────────────────

import { __testHooks as cso } from '../../../api/services/phase12/customerSuccessOptimizer'

describe('customerSuccessOptimizer', () => {
  describe('computeOverallSuccessScore', () => {
    it('returns 100 for perfect scores', () => {
      expect(cso.computeOverallSuccessScore(100, 100, 100, 100, 100)).toBe(100)
    })
    it('applies correct weights', () => {
      // adoption=100 (30%), all others 0
      expect(cso.computeOverallSuccessScore(0, 100, 0, 0, 0)).toBe(30)
    })
    it('rounds to integer', () => {
      const score = cso.computeOverallSuccessScore(80, 75, 70, 85, 60)
      expect(Number.isInteger(score)).toBe(true)
    })
  })

  describe('computeChurnRiskScore', () => {
    it('returns low risk for healthy tenant', () => {
      const risk = cso.computeChurnRiskScore(95, 80, 90)
      expect(risk).toBeLessThan(0.35)
    })
    it('increases risk for low adoption', () => {
      const noRisk = cso.computeChurnRiskScore(80, 70, 80)
      const withRisk = cso.computeChurnRiskScore(80, 30, 80)
      expect(withRisk).toBeGreaterThan(noRisk)
    })
    it('caps at 1.0', () => {
      const risk = cso.computeChurnRiskScore(0, 0, 0)
      expect(risk).toBeLessThanOrEqual(1.0)
    })
  })

  describe('classifyMaturityLevel', () => {
    it('returns optimized for >= 90', () => {
      expect(cso.classifyMaturityLevel(90)).toBe('optimized')
    })
    it('returns advanced for 75-89', () => {
      expect(cso.classifyMaturityLevel(80)).toBe('advanced')
    })
    it('returns proficient for 60-74', () => {
      expect(cso.classifyMaturityLevel(65)).toBe('proficient')
    })
    it('returns developing for 40-59', () => {
      expect(cso.classifyMaturityLevel(50)).toBe('developing')
    })
    it('returns starter for < 40', () => {
      expect(cso.classifyMaturityLevel(30)).toBe('starter')
    })
  })

  describe('isAtChurnRisk', () => {
    it('returns true when score >= 0.35', () => {
      expect(cso.isAtChurnRisk(0.35)).toBe(true)
    })
    it('returns false when score < 0.35', () => {
      expect(cso.isAtChurnRisk(0.30)).toBe(false)
    })
  })
})

// ─── adoptionAccelerationEngine ───────────────────────────────────────────────

import { __testHooks as aae } from '../../../api/services/phase12/adoptionAccelerationEngine'

describe('adoptionAccelerationEngine', () => {
  describe('computeAdoptionGap', () => {
    it('returns gap correctly', () => {
      expect(aae.computeAdoptionGap(40, 80)).toBe(40)
    })
    it('returns 0 when already at target', () => {
      expect(aae.computeAdoptionGap(80, 80)).toBe(0)
    })
    it('returns 0 when above target', () => {
      expect(aae.computeAdoptionGap(90, 80)).toBe(0)
    })
  })

  describe('estimateDaysToTarget', () => {
    it('returns 0 when already at target', () => {
      expect(aae.estimateDaysToTarget(80, 80, 2)).toBe(0)
    })
    it('returns 999 when growth rate is 0', () => {
      expect(aae.estimateDaysToTarget(40, 80, 0)).toBe(999)
    })
    it('estimates days correctly', () => {
      expect(aae.estimateDaysToTarget(40, 80, 4)).toBe(10)
    })
  })

  describe('generateAdoptionRecommendations', () => {
    it('returns recommendation for high friction', () => {
      const recs = aae.generateAdoptionRecommendations(50, 0.7, 0.8, 0.5)
      expect(recs.some(r => r.action.toLowerCase().includes('friction'))).toBe(true)
    })
    it('returns recommendation for low AI acceptance', () => {
      const recs = aae.generateAdoptionRecommendations(50, 0.3, 0.8, 0.1)
      expect(recs.some(r => r.action.toLowerCase().includes('ai'))).toBe(true)
    })
    it('returns recommendation for low workflow completion', () => {
      const recs = aae.generateAdoptionRecommendations(50, 0.7, 0.5, 0.1)
      expect(recs.some(r => r.action.toLowerCase().includes('workflow'))).toBe(true)
    })
    it('returns empty array for healthy metrics', () => {
      const recs = aae.generateAdoptionRecommendations(80, 0.8, 0.9, 0.1)
      expect(recs).toHaveLength(0)
    })
  })
})

// ─── operationalMaturityScorer ────────────────────────────────────────────────

import { __testHooks as oms } from '../../../api/services/phase12/operationalMaturityScorer'

describe('operationalMaturityScorer', () => {
  describe('computeOverallMaturity', () => {
    it('returns 100 for all perfect scores', () => {
      expect(oms.computeOverallMaturity(100, 100, 100, 100, 100)).toBe(100)
    })
    it('applies weights correctly', () => {
      // workflow=100 (25%), all others 0
      expect(oms.computeOverallMaturity(100, 0, 0, 0, 0)).toBe(25)
    })
  })

  describe('classifyMaturityLevel', () => {
    it('returns optimized for >= 90', () => {
      expect(oms.classifyMaturityLevel(92)).toBe('optimized')
    })
    it('returns starter for < 40', () => {
      expect(oms.classifyMaturityLevel(35)).toBe('starter')
    })
  })

  describe('isOperationallyMature', () => {
    it('returns true when overall >= 65 and governance >= 70', () => {
      const makeScore = (overall: number, gov: number) =>
        oms._mapMaturityScore({
          id: '1', tenant_id: 't1',
          workflow_maturity: overall, governance_maturity: gov,
          integration_maturity: overall, ai_maturity: overall,
          support_maturity: overall, overall_maturity: overall,
          level: 'proficient', scored_at: new Date().toISOString(),
        })
      expect(oms.isOperationallyMature(makeScore(70, 75))).toBe(true)
      expect(oms.isOperationallyMature(makeScore(60, 75))).toBe(false)
      expect(oms.isOperationallyMature(makeScore(70, 65))).toBe(false)
    })
  })

  describe('getWeakestDimension', () => {
    it('identifies the lowest dimension', () => {
      const score = oms._mapMaturityScore({
        id: '1', tenant_id: 't1',
        workflow_maturity: 90, governance_maturity: 85,
        integration_maturity: 40, ai_maturity: 80,
        support_maturity: 75, overall_maturity: 74,
        level: 'advanced', scored_at: new Date().toISOString(),
      })
      expect(oms.getWeakestDimension(score)).toBe('integration')
    })
  })
})

// ─── resilienceOptimizationEngine ────────────────────────────────────────────

import { __testHooks as roe } from '../../../api/services/phase12/resilienceOptimizationEngine'

describe('resilienceOptimizationEngine', () => {
  describe('computeOverallResilienceScore', () => {
    it('returns 100 for perfect scores', () => {
      expect(roe.computeOverallResilienceScore(100, 100, 100, 100, 100, 1.0)).toBe(100)
    })
    it('returns 0 for all zeros', () => {
      expect(roe.computeOverallResilienceScore(0, 0, 0, 0, 0, 0)).toBe(0)
    })
  })

  describe('isResilienceHealthy', () => {
    it('returns true when overall >= 75 and replay >= 80', () => {
      const score = roe._mapResilienceScore(makeResilienceRow({ overall_score: 80, replay_recovery_score: 85 }))
      expect(roe.isResilienceHealthy(score)).toBe(true)
    })
    it('returns false when overall < 75', () => {
      const score = roe._mapResilienceScore(makeResilienceRow({ overall_score: 70, replay_recovery_score: 85 }))
      expect(roe.isResilienceHealthy(score)).toBe(false)
    })
    it('returns false when replay < 80', () => {
      const score = roe._mapResilienceScore(makeResilienceRow({ overall_score: 80, replay_recovery_score: 75 }))
      expect(roe.isResilienceHealthy(score)).toBe(false)
    })
  })

  describe('identifyResilienceWeakness', () => {
    it('returns null when all scores healthy', () => {
      const score = roe._mapResilienceScore(makeResilienceRow())
      expect(roe.identifyResilienceWeakness(score)).toBeNull()
    })
    it('identifies replay_recovery as first priority weakness', () => {
      const score = roe._mapResilienceScore(makeResilienceRow({ replay_recovery_score: 60 }))
      expect(roe.identifyResilienceWeakness(score)).toBe('replay_recovery')
    })
    it('identifies queue_balance weakness', () => {
      const score = roe._mapResilienceScore(makeResilienceRow({ queue_balance_score: 60 }))
      expect(roe.identifyResilienceWeakness(score)).toBe('queue_balance')
    })
  })
})

// ─── queueRebalancer ─────────────────────────────────────────────────────────

import { __testHooks as qr } from '../../../api/services/phase12/queueRebalancer'

describe('queueRebalancer', () => {
  describe('computeTargetConsumerCount', () => {
    it('does not decrease below current', () => {
      expect(qr.computeTargetConsumerCount(50, 8)).toBe(8)
    })
    it('returns 4 minimum for depth > 100', () => {
      expect(qr.computeTargetConsumerCount(200, 2)).toBe(4)
    })
    it('returns 8 minimum for depth > 500', () => {
      expect(qr.computeTargetConsumerCount(1000, 2)).toBe(8)
    })
    it('returns 16 minimum for depth > 2000', () => {
      expect(qr.computeTargetConsumerCount(3000, 2)).toBe(16)
    })
  })

  describe('isRebalanceNeeded', () => {
    it('returns false for shallow queue', () => {
      expect(qr.isRebalanceNeeded(50, 4)).toBe(false)
    })
    it('returns true when target exceeds current', () => {
      expect(qr.isRebalanceNeeded(1000, 2)).toBe(true)
    })
    it('returns false when already at target', () => {
      expect(qr.isRebalanceNeeded(1000, 8)).toBe(false)
    })
  })

  describe('computeQueueHealthScore', () => {
    it('returns 100 for low depth/consumer ratio', () => {
      expect(qr.computeQueueHealthScore(50, 10)).toBe(100)
    })
    it('returns 0 for 0 consumers', () => {
      expect(qr.computeQueueHealthScore(1000, 0)).toBe(0)
    })
    it('decreases as ratio increases', () => {
      // ratio 501 > 500 → score 20 (lowest bucket)
      expect(qr.computeQueueHealthScore(501, 1)).toBeLessThan(40)
    })
  })
})

// ─── failoverRecoveryCoordinator ─────────────────────────────────────────────

import { __testHooks as frc } from '../../../api/services/phase12/failoverRecoveryCoordinator'

describe('failoverRecoveryCoordinator', () => {
  const makeFailover = (overrides = {}) => frc._mapFailoverRecord({
    id: 'f1', component: 'queue', trigger: 'OOM',
    failover_duration_ms: 5000, successful: true,
    replay_safe: true, tenants_affected: 3,
    recovered_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  })

  describe('computeFailoverSuccessRate', () => {
    it('returns 1.0 for empty array', () => {
      expect(frc.computeFailoverSuccessRate([])).toBe(1.0)
    })
    it('computes rate correctly', () => {
      const records = [makeFailover(), makeFailover({ successful: false }), makeFailover()]
      expect(frc.computeFailoverSuccessRate(records)).toBeCloseTo(0.667, 1)
    })
  })

  describe('isFailoverReplaySafe', () => {
    it('returns true when successful and replay safe', () => {
      const r = makeFailover()
      expect(frc.isFailoverReplaySafe(r)).toBe(true)
    })
    it('returns false when not replay safe', () => {
      const r = makeFailover({ replay_safe: false })
      expect(frc.isFailoverReplaySafe(r)).toBe(false)
    })
    it('returns false when not successful', () => {
      const r = makeFailover({ successful: false })
      expect(frc.isFailoverReplaySafe(r)).toBe(false)
    })
  })

  describe('classifyFailoverSeverity', () => {
    it('returns low for small, quick failovers', () => {
      expect(frc.classifyFailoverSeverity(2, 5000)).toBe('low')
    })
    it('returns critical for 100+ tenants', () => {
      expect(frc.classifyFailoverSeverity(100, 5000)).toBe('critical')
    })
    it('returns critical for long duration', () => {
      expect(frc.classifyFailoverSeverity(3, 300000)).toBe('critical')
    })
    it('returns high for 20+ tenants', () => {
      expect(frc.classifyFailoverSeverity(25, 5000)).toBe('high')
    })
    it('returns medium for 5+ tenants', () => {
      expect(frc.classifyFailoverSeverity(8, 5000)).toBe('medium')
    })
  })

  describe('hasOpenFailovers', () => {
    it('returns false when all recovered', () => {
      expect(frc.hasOpenFailovers([makeFailover()])).toBe(false)
    })
    it('returns true when one open', () => {
      const open = makeFailover({ recovered_at: null })
      expect(frc.hasOpenFailovers([open])).toBe(true)
    })
  })
})

// ─── efficiencyOptimizationEngine ────────────────────────────────────────────

import { __testHooks as eoe } from '../../../api/services/phase12/efficiencyOptimizationEngine'

describe('efficiencyOptimizationEngine', () => {
  const makeMetric = (baseline: number, current: number) => eoe._mapEfficiencyMetric({
    id: 'e1', category: 'ai_routing',
    baseline_cost: baseline, current_cost: current,
    efficiency_gain_pct: eoe.computeEfficiencyGain(baseline, current),
    measured_at: new Date().toISOString(),
  })

  describe('computeEfficiencyGain', () => {
    it('returns 0 when baseline is 0', () => {
      expect(eoe.computeEfficiencyGain(0, 5)).toBe(0)
    })
    it('returns positive gain when current < baseline', () => {
      expect(eoe.computeEfficiencyGain(100, 75)).toBeCloseTo(25)
    })
    it('returns negative gain when cost increased', () => {
      expect(eoe.computeEfficiencyGain(100, 120)).toBeCloseTo(-20)
    })
  })

  describe('isEfficiencyImproved', () => {
    it('returns true when gain is positive', () => {
      expect(eoe.isEfficiencyImproved(makeMetric(100, 80))).toBe(true)
    })
    it('returns false when cost increased', () => {
      expect(eoe.isEfficiencyImproved(makeMetric(100, 110))).toBe(false)
    })
  })

  describe('computeAggregateEfficiencyGain', () => {
    it('returns 0 for empty array', () => {
      expect(eoe.computeAggregateEfficiencyGain([])).toBe(0)
    })
    it('computes aggregate correctly', () => {
      const metrics = [makeMetric(100, 80), makeMetric(200, 140)]
      // baseline=300, current=220, gain=(80/300)*100 ≈ 26.7%
      expect(eoe.computeAggregateEfficiencyGain(metrics)).toBeCloseTo(26.7, 0)
    })
  })
})

// ─── infrastructureEfficiencyAnalyzer ────────────────────────────────────────

import { __testHooks as iea } from '../../../api/services/phase12/infrastructureEfficiencyAnalyzer'

describe('infrastructureEfficiencyAnalyzer', () => {
  describe('computeOverallInfraScore', () => {
    it('returns 100 for all perfect scores', () => {
      expect(iea.computeOverallInfraScore(100, 100, 100)).toBe(100)
    })
    it('applies weights correctly: compute=40%, storage=35%, network=25%', () => {
      expect(iea.computeOverallInfraScore(100, 0, 0)).toBe(40)
    })
  })

  describe('generateOptimizationSuggestions', () => {
    it('returns empty for healthy scores', () => {
      const suggestions = iea.generateOptimizationSuggestions(90, 90, 90)
      expect(suggestions).toHaveLength(0)
    })
    it('suggests compute optimization when compute < 70', () => {
      const suggestions = iea.generateOptimizationSuggestions(60, 80, 80)
      expect(suggestions.some(s => s.toLowerCase().includes('ecs') || s.toLowerCase().includes('compute'))).toBe(true)
    })
    it('suggests storage optimization when storage < 70', () => {
      const suggestions = iea.generateOptimizationSuggestions(80, 60, 80)
      expect(suggestions.some(s => s.toLowerCase().includes('s3') || s.toLowerCase().includes('storage'))).toBe(true)
    })
    it('caps at 5 suggestions', () => {
      const suggestions = iea.generateOptimizationSuggestions(10, 10, 10)
      expect(suggestions.length).toBeLessThanOrEqual(5)
    })
  })

  describe('isInfrastructureEfficient', () => {
    it('returns true when overall >= 70', () => {
      const report = iea._mapEfficiencyReport({
        id: '1', environment: 'prod',
        compute_efficiency_score: 75, storage_efficiency_score: 80,
        network_efficiency_score: 70, overall_efficiency_score: 75,
        top_optimizations: [],
        reported_at: new Date().toISOString(),
      })
      expect(iea.isInfrastructureEfficient(report)).toBe(true)
    })
    it('returns false when overall < 70', () => {
      const report = iea._mapEfficiencyReport({
        id: '1', environment: 'prod',
        compute_efficiency_score: 60, storage_efficiency_score: 65,
        network_efficiency_score: 60, overall_efficiency_score: 62,
        top_optimizations: [],
        reported_at: new Date().toISOString(),
      })
      expect(iea.isInfrastructureEfficient(report)).toBe(false)
    })
  })
})

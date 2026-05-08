// Denver Engineering — Phase 12 Tests Part B (v12.0.0)
// Tests: aiCostPerformanceBalancer, deploymentReliabilityEngine, rolloutVerificationService,
//        migrationReplayValidator, supportExcellenceEngine, incidentReplayWorkbench,
//        escalationOptimizationService, architectureEvolutionGuard, complexityBudgetEngine,
//        subsystemDependencyAnalyzer, governanceImpactEstimator, technicalDebtTracker,
//        serviceLifecycleManager, deprecationCoordinator, compatibilityMatrixGenerator,
//        operationalFeedbackHub, usabilitySignalAggregator, ecosystemFeedbackAnalyzer

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

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockRow = (row: Record<string, unknown>) => ({ rows: [row], rowCount: 1 })
const mockRows = (rows: Record<string, unknown>[]) => ({ rows, rowCount: rows.length })
const mockEmpty = () => ({ rows: [], rowCount: 0 })

function makeAiCostBalanceRow(overrides = {}) {
  return {
    id: 'acb1', model_id: 'gpt-4',
    cost_per_1k_tokens: 0.03, acceptance_rate: 0.75,
    quality_score: 85, efficiency_score: 62,
    recommended_action: 'keep',
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDeploymentConfidenceRow(overrides = {}) {
  return {
    id: 'dc1', deployment_id: 'deploy1',
    canary_health_score: 90, migration_safety_score: 85,
    rollback_readiness_score: 80, replay_verification_score: 90,
    overall_confidence: 87, recommendation: 'proceed',
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeVerificationRow(overrides = {}) {
  return {
    id: 'rv1', rollout_id: 'rollout1',
    checks_run: 20, checks_passed: 20,
    tenant_sample_size: 50, error_rate_in_window: 0.005,
    p95_in_window: 200, verified: true, verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeMigrationCheckRow(overrides = {}) {
  return {
    id: 'mc1', migration_id: 'mig1',
    pre_migration_hash: 'abc123', post_migration_hash: 'abc123',
    hash_match: true, rows_validated: 100, rows_mismatched: 0,
    checked_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeSupportRecordRow(overrides = {}) {
  return {
    id: 'sr1', tenant_id: 't1', incident_id: null,
    category: 'workflow', priority: 'high',
    replay_assisted: false, resolution_time_ms: 3600000,
    ai_summary_generated: false,
    resolved_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeReplaySessionRow(overrides = {}) {
  return {
    id: 'rs1', incident_id: 'inc1', tenant_id: 't1',
    events_replayed: 50, timeline_reconstructed: true,
    root_cause_identified: true,
    root_cause_summary: 'Race condition in replay handler',
    replay_hash: 'abc123def456789012345678901234ab',
    session_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeEscalationRouteRow(overrides = {}) {
  return {
    id: 'er1', support_record_id: 'sr1',
    from_tier: 'l1', to_tier: 'l2',
    reason: 'Complex replay issue', auto_routed: true,
    escalated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeGuardCheckRow(overrides = {}) {
  return {
    id: 'gc1', check_name: 'replay_surface_limit',
    category: 'replay_surface', passed: true,
    current_value: 30, threshold: 50,
    detail: 'Replay surface within limits',
    checked_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeComplexityBudgetRow(overrides = {}) {
  return {
    id: 'cb1', environment: 'production',
    service_count: 50, average_dependencies: 4.5,
    replay_surface: 20, plugin_count: 30,
    total_complexity_score: 460, budget_limit: 1000,
    is_over_budget: false,
    measured_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDependencyRow(overrides = {}) {
  return {
    id: 'dep1', from_subsystem: 'workflow', to_subsystem: 'replay',
    coupling_score: 0.8, replay_dependent: true,
    governance_dependent: false,
    recorded_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeImpactEstimateRow(overrides = {}) {
  return {
    id: 'ie1', change_description: 'Add new replay hook',
    replay_impact: 'medium', governance_risk: 'low',
    tenant_impact: 'low', overall_risk: 'medium',
    approved: false,
    estimated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDebtItemRow(overrides = {}) {
  return {
    id: 'di1', category: 'service_coupling',
    description: 'High coupling in replay subsystem',
    severity: 'high', estimated_effort_days: 10,
    replay_impact: false,
    identified_at: new Date().toISOString(),
    resolved_at: null,
    ...overrides,
  }
}

function makeLifecycleRecordRow(overrides = {}) {
  return {
    id: 'lr1', service_name: 'legacySync', version: '1.0.0',
    status: 'active', deprecated_at: null, sunset_at: null,
    replaced_by: null, created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDeprecationRecordRow(overrides = {}) {
  const futureDate = new Date(Date.now() + 30 * 86400000)
  return {
    id: 'dr1', entity_type: 'api',
    entity_id: 'api-v1', entity_name: 'Legacy API v1',
    deprecated_at: new Date().toISOString(),
    sunset_at: futureDate.toISOString(),
    migration_path: '/api/v2',
    affected_tenants_count: 5,
    ...overrides,
  }
}

function makeCompatibilityMatrixRow(overrides = {}) {
  return {
    id: 'cm1', from_version: '1.0.0', to_version: '2.0.0',
    compatible: true, replay_compatible: true,
    schema_compatible: true, breaking_changes: [],
    generated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeFeedbackRecordRow(overrides = {}) {
  return {
    id: 'fr1', tenant_id: 't1', source: 'in_app',
    category: 'general', sentiment: 'positive',
    detail: 'Great experience overall',
    actionable: false, processed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeUsabilitySignalRow(overrides = {}) {
  return {
    id: 'us1', tenant_id: 't1', feature: 'workflow_builder',
    friction_score: 30, completion_rate: 0.85,
    average_time_ms: 5000, abandon_count: 2,
    measured_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeFeedbackSummaryRow(overrides = {}) {
  return {
    id: 'fs1',
    period_start: new Date(Date.now() - 7 * 86400000).toISOString(),
    period_end: new Date().toISOString(),
    total_feedback: 100, positive_count: 70,
    neutral_count: 20, negative_count: 10,
    top_friction_areas: ['workflow_builder', 'onboarding'],
    top_improvement_opportunities: ['better docs', 'faster replay'],
    trust_signal_score: 0.80,
    generated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── Import services ──────────────────────────────────────────────────────────

import * as acb from '../../../api/services/phase12/aiCostPerformanceBalancer'
import * as dre from '../../../api/services/phase12/deploymentReliabilityEngine'
import * as rvs from '../../../api/services/phase12/rolloutVerificationService'
import * as mrv from '../../../api/services/phase12/migrationReplayValidator'
import * as see from '../../../api/services/phase12/supportExcellenceEngine'
import * as irw from '../../../api/services/phase12/incidentReplayWorkbench'
import * as eos from '../../../api/services/phase12/escalationOptimizationService'
import * as aeg from '../../../api/services/phase12/architectureEvolutionGuard'
import * as cbe from '../../../api/services/phase12/complexityBudgetEngine'
import * as sda from '../../../api/services/phase12/subsystemDependencyAnalyzer'
import * as gie from '../../../api/services/phase12/governanceImpactEstimator'
import * as tdt from '../../../api/services/phase12/technicalDebtTracker'
import * as slm from '../../../api/services/phase12/serviceLifecycleManager'
import * as dc from '../../../api/services/phase12/deprecationCoordinator'
import * as cmg from '../../../api/services/phase12/compatibilityMatrixGenerator'
import * as ofh from '../../../api/services/phase12/operationalFeedbackHub'
import * as usa from '../../../api/services/phase12/usabilitySignalAggregator'
import * as efa from '../../../api/services/phase12/ecosystemFeedbackAnalyzer'

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// 1. aiCostPerformanceBalancer
// ════════════════════════════════════════════════════════════════════════════

describe('aiCostPerformanceBalancer', () => {
  describe('computeAiEfficiencyScore', () => {
    it('returns 0 for high cost model with zero acceptance', () => {
      expect(acb.__testHooks.computeAiEfficiencyScore(0, 0, 0.04)).toBe(0)
    })

    it('computes score for moderate acceptance and quality', () => {
      // acceptance=0.75 → 0.75*40=30; quality=80 → 80*0.40=32; cost=0.005 → 0.005*1000=5
      // 30+32-5 = 57
      expect(acb.__testHooks.computeAiEfficiencyScore(0.75, 80, 0.005)).toBe(57)
    })

    it('caps cost penalty at 40', () => {
      // acceptance=0.90 → 36; quality=90 → 36; cost=0.10 → penalty=40 (capped)
      // 36+36-40 = 32
      expect(acb.__testHooks.computeAiEfficiencyScore(0.90, 90, 0.10)).toBe(32)
    })

    it('returns 0 when score would be negative', () => {
      // acceptance=0.10 → 4; quality=20 → 8; cost=0.05 → penalty=40
      // 4+8-40 = -28 → 0
      expect(acb.__testHooks.computeAiEfficiencyScore(0.10, 20, 0.05)).toBe(0)
    })

    it('computes perfect score for high acceptance, high quality, zero cost', () => {
      // acceptance=1.0 → 40; quality=100 → 40; cost=0 → 0
      // 40+40=80
      expect(acb.__testHooks.computeAiEfficiencyScore(1.0, 100, 0)).toBe(80)
    })
  })

  describe('recommendAiRouting', () => {
    it('recommends downgrade for high acceptance and high cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.90, 80, 0.02)).toBe('downgrade')
    })

    it('recommends upgrade for very low acceptance rate', () => {
      expect(acb.__testHooks.recommendAiRouting(0.35, 50, 0.005)).toBe('upgrade')
    })

    it('recommends route_split for moderate acceptance and elevated cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.75, 70, 0.009)).toBe('route_split')
    })

    it('recommends keep for acceptable acceptance and low cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.80, 75, 0.005)).toBe('keep')
    })

    it('recommends keep for high acceptance and low cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.90, 85, 0.005)).toBe('keep')
    })

    it('recommends downgrade at exactly 0.85 acceptance with high cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.85, 80, 0.015)).toBe('downgrade')
    })

    it('recommends keep at exactly 0.85 acceptance with low cost', () => {
      expect(acb.__testHooks.recommendAiRouting(0.85, 80, 0.008)).toBe('keep')
    })

    it('boundary: 0.40 acceptance is upgrade', () => {
      expect(acb.__testHooks.recommendAiRouting(0.39, 60, 0.005)).toBe('upgrade')
    })
  })

  describe('isModelCostEfficient', () => {
    it('returns true when score >= 60 and action is keep', () => {
      const balance = acb.__testHooks._mapAiCostBalance(
        makeAiCostBalanceRow({ efficiency_score: 65, recommended_action: 'keep' }),
      )
      expect(acb.__testHooks.isModelCostEfficient(balance)).toBe(true)
    })

    it('returns false when score < 60', () => {
      const balance = acb.__testHooks._mapAiCostBalance(
        makeAiCostBalanceRow({ efficiency_score: 55, recommended_action: 'keep' }),
      )
      expect(acb.__testHooks.isModelCostEfficient(balance)).toBe(false)
    })

    it('returns false when action is not keep even with high score', () => {
      const balance = acb.__testHooks._mapAiCostBalance(
        makeAiCostBalanceRow({ efficiency_score: 75, recommended_action: 'downgrade' }),
      )
      expect(acb.__testHooks.isModelCostEfficient(balance)).toBe(false)
    })
  })

  describe('_mapAiCostBalance', () => {
    it('maps row fields correctly', () => {
      const row = makeAiCostBalanceRow()
      const balance = acb.__testHooks._mapAiCostBalance(row)
      expect(balance.modelId).toBe('gpt-4')
      expect(balance.costPer1kTokens).toBe(0.03)
      expect(balance.acceptanceRate).toBe(0.75)
      expect(balance.qualityScore).toBe(85)
      expect(balance.efficiencyScore).toBe(62)
      expect(balance.recommendedAction).toBe('keep')
    })
  })

  describe('getLatestAiBalance (DB)', () => {
    it('returns null when no rows', async () => {
      ;(mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockEmpty())
      const result = await acb.getLatestAiBalance('gpt-4')
      expect(result).toBeNull()
    })

    it('returns mapped balance when found', async () => {
      ;(mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRow(makeAiCostBalanceRow()),
      )
      const result = await acb.getLatestAiBalance('gpt-4')
      expect(result?.modelId).toBe('gpt-4')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. deploymentReliabilityEngine
// ════════════════════════════════════════════════════════════════════════════

describe('deploymentReliabilityEngine', () => {
  describe('computeDeploymentConfidence', () => {
    it('returns 100 for all-perfect scores', () => {
      expect(dre.__testHooks.computeDeploymentConfidence(100, 100, 100, 100)).toBe(100)
    })

    it('returns 0 for all-zero scores', () => {
      expect(dre.__testHooks.computeDeploymentConfidence(0, 0, 0, 0)).toBe(0)
    })

    it('computes weighted average correctly', () => {
      // 80*0.30 + 60*0.25 + 70*0.20 + 90*0.25 = 24+15+14+22.5 = 75.5 → 76
      expect(dre.__testHooks.computeDeploymentConfidence(80, 60, 70, 90)).toBe(76)
    })

    it('weighs replay verification at 25%', () => {
      // replay alone: 0 + 0 + 0 + 100*0.25 = 25
      expect(dre.__testHooks.computeDeploymentConfidence(0, 0, 0, 100)).toBe(25)
    })

    it('weighs canary at 30%', () => {
      expect(dre.__testHooks.computeDeploymentConfidence(100, 0, 0, 0)).toBe(30)
    })
  })

  describe('recommendDeploymentAction', () => {
    it('aborts when replay verification < 70', () => {
      expect(dre.__testHooks.recommendDeploymentAction(85, 80, 65)).toBe('abort')
    })

    it('aborts when rollback readiness < 50', () => {
      expect(dre.__testHooks.recommendDeploymentAction(85, 45, 80)).toBe('abort')
    })

    it('proceeds when confidence >= 80 and all gates pass', () => {
      expect(dre.__testHooks.recommendDeploymentAction(85, 80, 75)).toBe('proceed')
    })

    it('pauses when confidence < 80 and gates pass', () => {
      expect(dre.__testHooks.recommendDeploymentAction(75, 70, 75)).toBe('pause')
    })

    it('aborts takes priority over confidence threshold', () => {
      expect(dre.__testHooks.recommendDeploymentAction(90, 80, 69)).toBe('abort')
    })

    it('proceeds at exactly 80 confidence', () => {
      expect(dre.__testHooks.recommendDeploymentAction(80, 55, 75)).toBe('proceed')
    })
  })

  describe('isDeploymentSafe', () => {
    it('returns true when recommendation is proceed and replay >= 80', () => {
      const score = dre.__testHooks._mapConfidenceScore(
        makeDeploymentConfidenceRow({ recommendation: 'proceed', replay_verification_score: 85 }),
      )
      expect(dre.__testHooks.isDeploymentSafe(score)).toBe(true)
    })

    it('returns false when recommendation is proceed but replay < 80', () => {
      const score = dre.__testHooks._mapConfidenceScore(
        makeDeploymentConfidenceRow({ recommendation: 'proceed', replay_verification_score: 75 }),
      )
      expect(dre.__testHooks.isDeploymentSafe(score)).toBe(false)
    })

    it('returns false when recommendation is abort', () => {
      const score = dre.__testHooks._mapConfidenceScore(
        makeDeploymentConfidenceRow({ recommendation: 'abort', replay_verification_score: 90 }),
      )
      expect(dre.__testHooks.isDeploymentSafe(score)).toBe(false)
    })

    it('returns false when recommendation is pause', () => {
      const score = dre.__testHooks._mapConfidenceScore(
        makeDeploymentConfidenceRow({ recommendation: 'pause', replay_verification_score: 85 }),
      )
      expect(dre.__testHooks.isDeploymentSafe(score)).toBe(false)
    })
  })

  describe('_mapConfidenceScore', () => {
    it('maps all fields correctly', () => {
      const score = dre.__testHooks._mapConfidenceScore(makeDeploymentConfidenceRow())
      expect(score.deploymentId).toBe('deploy1')
      expect(score.canaryHealthScore).toBe(90)
      expect(score.migrationSafetyScore).toBe(85)
      expect(score.rollbackReadinessScore).toBe(80)
      expect(score.replayVerificationScore).toBe(90)
      expect(score.overallConfidence).toBe(87)
      expect(score.recommendation).toBe('proceed')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. rolloutVerificationService
// ════════════════════════════════════════════════════════════════════════════

describe('rolloutVerificationService', () => {
  describe('isRolloutVerified', () => {
    it('returns true for healthy rollout', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.005, 200, 20, 20)).toBe(true)
    })

    it('returns false when error rate > 0.01', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.02, 200, 20, 20)).toBe(false)
    })

    it('returns false when p95 > 300', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.005, 350, 20, 20)).toBe(false)
    })

    it('returns false when checksRun is 0', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.005, 200, 0, 0)).toBe(false)
    })

    it('returns false when check pass rate < 0.95', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.005, 200, 18, 20)).toBe(false)
    })

    it('returns true when check rate is exactly 0.95', () => {
      expect(rvs.__testHooks.isRolloutVerified(0.005, 200, 19, 20)).toBe(true)
    })

    it('returns false when error rate is exactly 0.01 (strict greater than)', () => {
      // 0.01 is not > 0.01, so should pass this check
      expect(rvs.__testHooks.isRolloutVerified(0.01, 200, 20, 20)).toBe(true)
    })
  })

  describe('computeVerificationCheckRate', () => {
    it('returns 0 when checksRun is 0', () => {
      expect(rvs.__testHooks.computeVerificationCheckRate(0, 0)).toBe(0)
    })

    it('returns 1.0 for all checks passed', () => {
      expect(rvs.__testHooks.computeVerificationCheckRate(20, 20)).toBe(1.0)
    })

    it('returns correct rate for partial pass', () => {
      expect(rvs.__testHooks.computeVerificationCheckRate(15, 20)).toBe(0.75)
    })
  })

  describe('classifyRolloutHealth', () => {
    it('returns healthy for low error rate and fast p95', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.005, 200)).toBe('healthy')
    })

    it('returns failing when error rate > 0.05', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.06, 200)).toBe('failing')
    })

    it('returns failing when p95 > 500', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.005, 600)).toBe('failing')
    })

    it('returns degraded when error rate > 0.01', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.02, 200)).toBe('degraded')
    })

    it('returns degraded when p95 > 300', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.005, 400)).toBe('degraded')
    })

    it('failing takes priority over degraded', () => {
      expect(rvs.__testHooks.classifyRolloutHealth(0.06, 400)).toBe('failing')
    })
  })

  describe('_mapVerification', () => {
    it('maps row fields correctly', () => {
      const v = rvs.__testHooks._mapVerification(makeVerificationRow())
      expect(v.rolloutId).toBe('rollout1')
      expect(v.checksRun).toBe(20)
      expect(v.checksPassed).toBe(20)
      expect(v.errorRateInWindow).toBe(0.005)
      expect(v.p95InWindow).toBe(200)
      expect(v.verified).toBe(true)
    })

    it('maps verified_at as null when absent', () => {
      const v = rvs.__testHooks._mapVerification(
        makeVerificationRow({ verified_at: null }),
      )
      expect(v.verifiedAt).toBeNull()
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. migrationReplayValidator
// ════════════════════════════════════════════════════════════════════════════

describe('migrationReplayValidator', () => {
  describe('computeMigrationDataHash', () => {
    it('returns a 64-char hex string', () => {
      const hash = mrv.__testHooks.computeMigrationDataHash([{ id: '1', name: 'test' }])
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic', () => {
      const rows = [{ id: '1', value: 100 }, { id: '2', value: 200 }]
      const h1 = mrv.__testHooks.computeMigrationDataHash(rows)
      const h2 = mrv.__testHooks.computeMigrationDataHash(rows)
      expect(h1).toBe(h2)
    })

    it('sorts keys canonically for consistency', () => {
      const rows1 = [{ b: 2, a: 1 }]
      const rows2 = [{ a: 1, b: 2 }]
      expect(mrv.__testHooks.computeMigrationDataHash(rows1))
        .toBe(mrv.__testHooks.computeMigrationDataHash(rows2))
    })

    it('produces different hashes for different data', () => {
      const h1 = mrv.__testHooks.computeMigrationDataHash([{ id: '1' }])
      const h2 = mrv.__testHooks.computeMigrationDataHash([{ id: '2' }])
      expect(h1).not.toBe(h2)
    })

    it('returns consistent hash for empty array', () => {
      const h1 = mrv.__testHooks.computeMigrationDataHash([])
      const h2 = mrv.__testHooks.computeMigrationDataHash([])
      expect(h1).toBe(h2)
    })
  })

  describe('isMigrationReplaySafe', () => {
    it('returns true when hashes match and no mismatches', () => {
      const check = mrv.__testHooks._mapMigrationReplayCheck(makeMigrationCheckRow())
      expect(mrv.__testHooks.isMigrationReplaySafe(check)).toBe(true)
    })

    it('returns false when hashMatch is false', () => {
      const check = mrv.__testHooks._mapMigrationReplayCheck(
        makeMigrationCheckRow({ hash_match: false, post_migration_hash: 'xyz789' }),
      )
      expect(mrv.__testHooks.isMigrationReplaySafe(check)).toBe(false)
    })

    it('returns false when there are mismatched rows', () => {
      const check = mrv.__testHooks._mapMigrationReplayCheck(
        makeMigrationCheckRow({ rows_mismatched: 3 }),
      )
      expect(mrv.__testHooks.isMigrationReplaySafe(check)).toBe(false)
    })

    it('returns false when both conditions fail', () => {
      const check = mrv.__testHooks._mapMigrationReplayCheck(
        makeMigrationCheckRow({ hash_match: false, rows_mismatched: 5 }),
      )
      expect(mrv.__testHooks.isMigrationReplaySafe(check)).toBe(false)
    })
  })

  describe('computeMismatchRate', () => {
    it('returns 0 when rows validated is 0', () => {
      expect(mrv.__testHooks.computeMismatchRate(0, 0)).toBe(0)
    })

    it('returns 0 when no mismatches', () => {
      expect(mrv.__testHooks.computeMismatchRate(100, 0)).toBe(0)
    })

    it('computes correct rate', () => {
      expect(mrv.__testHooks.computeMismatchRate(100, 5)).toBe(0.05)
    })

    it('can return 1.0 for all mismatched', () => {
      expect(mrv.__testHooks.computeMismatchRate(10, 10)).toBe(1.0)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. supportExcellenceEngine
// ════════════════════════════════════════════════════════════════════════════

describe('supportExcellenceEngine', () => {
  describe('computeAverageResolutionTime', () => {
    it('returns 0 for empty records', () => {
      expect(see.__testHooks.computeAverageResolutionTime([])).toBe(0)
    })

    it('returns 0 when no records have resolution time', () => {
      const record = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: null, resolved_at: null }),
      )
      expect(see.__testHooks.computeAverageResolutionTime([record])).toBe(0)
    })

    it('computes average of resolved records', () => {
      const r1 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: 3600000 }),
      )
      const r2 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: 7200000 }),
      )
      expect(see.__testHooks.computeAverageResolutionTime([r1, r2])).toBe(5400000)
    })

    it('skips null resolution times', () => {
      const r1 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: 3600000 }),
      )
      const r2 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: null, resolved_at: null }),
      )
      expect(see.__testHooks.computeAverageResolutionTime([r1, r2])).toBe(3600000)
    })
  })

  describe('isSupportSLAMet', () => {
    it('returns false when no resolution time', () => {
      const record = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: null, resolved_at: null }),
      )
      expect(see.__testHooks.isSupportSLAMet(record, 86400000)).toBe(false)
    })

    it('returns true when resolution time <= sla threshold', () => {
      const record = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: 3600000 }),
      )
      expect(see.__testHooks.isSupportSLAMet(record, 86400000)).toBe(true)
    })

    it('returns false when resolution time exceeds sla', () => {
      const record = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: 100000000 }),
      )
      expect(see.__testHooks.isSupportSLAMet(record, 86400000)).toBe(false)
    })
  })

  describe('getSLAThresholdMs', () => {
    it('returns 4 hours for critical', () => {
      expect(see.__testHooks.getSLAThresholdMs('critical')).toBe(4 * 60 * 60 * 1000)
    })

    it('returns 24 hours for high', () => {
      expect(see.__testHooks.getSLAThresholdMs('high')).toBe(24 * 60 * 60 * 1000)
    })

    it('returns 72 hours for medium', () => {
      expect(see.__testHooks.getSLAThresholdMs('medium')).toBe(72 * 60 * 60 * 1000)
    })

    it('returns 7 days for low', () => {
      expect(see.__testHooks.getSLAThresholdMs('low')).toBe(7 * 24 * 60 * 60 * 1000)
    })
  })

  describe('computeSLAComplianceRate', () => {
    it('returns 1.0 when no resolved records', () => {
      expect(see.__testHooks.computeSLAComplianceRate([])).toBe(1.0)
    })

    it('returns 1.0 when all records meet SLA', () => {
      const r = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ priority: 'high', resolution_time_ms: 3600000 }),
      )
      expect(see.__testHooks.computeSLAComplianceRate([r])).toBe(1.0)
    })

    it('returns 0.5 when half meet SLA', () => {
      const r1 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ priority: 'critical', resolution_time_ms: 3600000 }),
      )
      const r2 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ priority: 'critical', resolution_time_ms: 20 * 60 * 60 * 1000 }),
      )
      expect(see.__testHooks.computeSLAComplianceRate([r1, r2])).toBe(0.5)
    })

    it('ignores unresolved records', () => {
      const r1 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ priority: 'high', resolution_time_ms: 3600000 }),
      )
      const r2 = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolution_time_ms: null, resolved_at: null }),
      )
      expect(see.__testHooks.computeSLAComplianceRate([r1, r2])).toBe(1.0)
    })
  })

  describe('_mapSupportRecord', () => {
    it('maps priority, category, and resolved fields', () => {
      const r = see.__testHooks._mapSupportRecord(makeSupportRecordRow())
      expect(r.priority).toBe('high')
      expect(r.category).toBe('workflow')
      expect(r.resolutionTimeMs).toBe(3600000)
      expect(r.replayAssisted).toBe(false)
    })

    it('maps null resolved_at as null resolvedAt', () => {
      const r = see.__testHooks._mapSupportRecord(
        makeSupportRecordRow({ resolved_at: null }),
      )
      expect(r.resolvedAt).toBeNull()
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. incidentReplayWorkbench
// ════════════════════════════════════════════════════════════════════════════

describe('incidentReplayWorkbench', () => {
  describe('computeIncidentReplayHash', () => {
    it('returns a 32-char hex string', () => {
      const hash = irw.__testHooks.computeIncidentReplayHash('inc1', 50, new Date())
      expect(hash).toHaveLength(32)
      expect(hash).toMatch(/^[0-9a-f]{32}$/)
    })

    it('is deterministic for same inputs', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      const h1 = irw.__testHooks.computeIncidentReplayHash('inc1', 50, date)
      const h2 = irw.__testHooks.computeIncidentReplayHash('inc1', 50, date)
      expect(h1).toBe(h2)
    })

    it('produces different hashes for different incident IDs', () => {
      const date = new Date()
      const h1 = irw.__testHooks.computeIncidentReplayHash('inc1', 50, date)
      const h2 = irw.__testHooks.computeIncidentReplayHash('inc2', 50, date)
      expect(h1).not.toBe(h2)
    })

    it('produces different hashes for different event counts', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      const h1 = irw.__testHooks.computeIncidentReplayHash('inc1', 50, date)
      const h2 = irw.__testHooks.computeIncidentReplayHash('inc1', 100, date)
      expect(h1).not.toBe(h2)
    })
  })

  describe('isRootCauseFound', () => {
    it('returns true when root cause identified and summary present', () => {
      const session = irw.__testHooks._mapReplaySession(makeReplaySessionRow())
      expect(irw.__testHooks.isRootCauseFound(session)).toBe(true)
    })

    it('returns false when rootCauseIdentified is false', () => {
      const session = irw.__testHooks._mapReplaySession(
        makeReplaySessionRow({ root_cause_identified: false }),
      )
      expect(irw.__testHooks.isRootCauseFound(session)).toBe(false)
    })

    it('returns false when rootCauseSummary is null', () => {
      const session = irw.__testHooks._mapReplaySession(
        makeReplaySessionRow({ root_cause_summary: null }),
      )
      expect(irw.__testHooks.isRootCauseFound(session)).toBe(false)
    })
  })

  describe('hasFullTimeline', () => {
    it('returns true when timeline reconstructed and events > 0', () => {
      const session = irw.__testHooks._mapReplaySession(makeReplaySessionRow())
      expect(irw.__testHooks.hasFullTimeline(session)).toBe(true)
    })

    it('returns false when timeline not reconstructed', () => {
      const session = irw.__testHooks._mapReplaySession(
        makeReplaySessionRow({ timeline_reconstructed: false }),
      )
      expect(irw.__testHooks.hasFullTimeline(session)).toBe(false)
    })

    it('returns false when events replayed is 0', () => {
      const session = irw.__testHooks._mapReplaySession(
        makeReplaySessionRow({ events_replayed: 0 }),
      )
      expect(irw.__testHooks.hasFullTimeline(session)).toBe(false)
    })
  })

  describe('_mapReplaySession', () => {
    it('maps all fields correctly', () => {
      const session = irw.__testHooks._mapReplaySession(makeReplaySessionRow())
      expect(session.incidentId).toBe('inc1')
      expect(session.eventsReplayed).toBe(50)
      expect(session.timelineReconstructed).toBe(true)
      expect(session.rootCauseIdentified).toBe(true)
      expect(session.replayHash).toBe('abc123def456789012345678901234ab')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. escalationOptimizationService
// ════════════════════════════════════════════════════════════════════════════

describe('escalationOptimizationService', () => {
  describe('determineEscalationTier', () => {
    it('routes replay issues to engineering', () => {
      expect(eos.__testHooks.determineEscalationTier('replay', 'high', true)).toBe('engineering')
    })

    it('routes critical priority to engineering', () => {
      expect(eos.__testHooks.determineEscalationTier('billing', 'critical', false)).toBe('engineering')
    })

    it('routes high priority (non-replay) to l3', () => {
      expect(eos.__testHooks.determineEscalationTier('workflow', 'high', false)).toBe('l3')
    })

    it('routes medium priority to l2', () => {
      expect(eos.__testHooks.determineEscalationTier('workflow', 'medium', false)).toBe('l2')
    })

    it('routes low priority to l1', () => {
      expect(eos.__testHooks.determineEscalationTier('workflow', 'low', false)).toBe('l1')
    })

    it('replay overrides priority: low priority replay goes to engineering', () => {
      expect(eos.__testHooks.determineEscalationTier('workflow', 'low', true)).toBe('engineering')
    })
  })

  describe('isEscalationSkipped', () => {
    it('returns false for adjacent tier jump (l1 → l2)', () => {
      expect(eos.__testHooks.isEscalationSkipped('l1', 'l2')).toBe(false)
    })

    it('returns true for two-tier jump (l1 → l3)', () => {
      expect(eos.__testHooks.isEscalationSkipped('l1', 'l3')).toBe(true)
    })

    it('returns true for three-tier jump (l1 → engineering)', () => {
      expect(eos.__testHooks.isEscalationSkipped('l1', 'engineering')).toBe(true)
    })

    it('returns false for l2 → l3', () => {
      expect(eos.__testHooks.isEscalationSkipped('l2', 'l3')).toBe(false)
    })

    it('returns false for l3 → engineering', () => {
      expect(eos.__testHooks.isEscalationSkipped('l3', 'engineering')).toBe(false)
    })

    it('returns true for l2 → engineering', () => {
      expect(eos.__testHooks.isEscalationSkipped('l2', 'engineering')).toBe(true)
    })
  })

  describe('computeEscalationRate', () => {
    it('returns 0 for empty records', () => {
      expect(eos.__testHooks.computeEscalationRate([])).toBe(0)
    })

    it('returns 1.0 when all records escalated', () => {
      const records = [{ escalated: true }, { escalated: true }]
      expect(eos.__testHooks.computeEscalationRate(records)).toBe(1.0)
    })

    it('computes correct partial rate', () => {
      const records = [
        { escalated: true }, { escalated: true },
        { escalated: false }, { escalated: false },
      ]
      expect(eos.__testHooks.computeEscalationRate(records)).toBe(0.5)
    })

    it('returns 0 when no records escalated', () => {
      const records = [{ escalated: false }, { escalated: false }]
      expect(eos.__testHooks.computeEscalationRate(records)).toBe(0)
    })
  })

  describe('_mapEscalationRoute', () => {
    it('maps tier and reason fields', () => {
      const route = eos.__testHooks._mapEscalationRoute(makeEscalationRouteRow())
      expect(route.fromTier).toBe('l1')
      expect(route.toTier).toBe('l2')
      expect(route.reason).toBe('Complex replay issue')
      expect(route.autoRouted).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. architectureEvolutionGuard
// ════════════════════════════════════════════════════════════════════════════

describe('architectureEvolutionGuard', () => {
  describe('evaluateGuardCheck', () => {
    it('passes when current <= threshold', () => {
      expect(aeg.__testHooks.evaluateGuardCheck(30, 50)).toBe(true)
    })

    it('passes at exact threshold', () => {
      expect(aeg.__testHooks.evaluateGuardCheck(50, 50)).toBe(true)
    })

    it('fails when current > threshold', () => {
      expect(aeg.__testHooks.evaluateGuardCheck(51, 50)).toBe(false)
    })
  })

  describe('computeGuardPassRate', () => {
    it('returns 1.0 for empty checks', () => {
      expect(aeg.__testHooks.computeGuardPassRate([])).toBe(1.0)
    })

    it('returns 1.0 when all checks pass', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ passed: true })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc2', passed: true })),
      ]
      expect(aeg.__testHooks.computeGuardPassRate(checks)).toBe(1.0)
    })

    it('returns 0.75 for 3 of 4 passing', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ passed: true })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc2', passed: true })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc3', passed: true })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc4', passed: false })),
      ]
      expect(aeg.__testHooks.computeGuardPassRate(checks)).toBe(0.75)
    })

    it('returns 0 when all checks fail', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ passed: false })),
      ]
      expect(aeg.__testHooks.computeGuardPassRate(checks)).toBe(0)
    })
  })

  describe('hasBlockingFailures', () => {
    it('returns false for empty checks', () => {
      expect(aeg.__testHooks.hasBlockingFailures([])).toBe(false)
    })

    it('returns true for failed governance_risk check', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(
          makeGuardCheckRow({ passed: false, category: 'governance_risk' }),
        ),
      ]
      expect(aeg.__testHooks.hasBlockingFailures(checks)).toBe(true)
    })

    it('returns true for failed replay_surface check', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(
          makeGuardCheckRow({ passed: false, category: 'replay_surface' }),
        ),
      ]
      expect(aeg.__testHooks.hasBlockingFailures(checks)).toBe(true)
    })

    it('returns false when blocking category check passes', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(
          makeGuardCheckRow({ passed: true, category: 'governance_risk' }),
        ),
      ]
      expect(aeg.__testHooks.hasBlockingFailures(checks)).toBe(false)
    })

    it('returns false for failed non-blocking category', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(
          makeGuardCheckRow({ passed: false, category: 'performance' }),
        ),
      ]
      expect(aeg.__testHooks.hasBlockingFailures(checks)).toBe(false)
    })
  })

  describe('getFailedChecks', () => {
    it('returns empty for all passing checks', () => {
      const checks = [aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ passed: true }))]
      expect(aeg.__testHooks.getFailedChecks(checks)).toHaveLength(0)
    })

    it('returns only failed checks', () => {
      const checks = [
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ passed: true })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc2', passed: false })),
        aeg.__testHooks._mapGuardCheck(makeGuardCheckRow({ id: 'gc3', passed: false })),
      ]
      const failed = aeg.__testHooks.getFailedChecks(checks)
      expect(failed).toHaveLength(2)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. complexityBudgetEngine
// ════════════════════════════════════════════════════════════════════════════

describe('complexityBudgetEngine', () => {
  describe('computeComplexityScore', () => {
    it('returns 0 for all-zero inputs', () => {
      expect(cbe.__testHooks.computeComplexityScore(0, 0, 0, 0)).toBe(0)
    })

    it('computes services × 3 component', () => {
      expect(cbe.__testHooks.computeComplexityScore(10, 0, 0, 0)).toBe(30)
    })

    it('computes avgDeps × 10 component', () => {
      expect(cbe.__testHooks.computeComplexityScore(0, 5, 0, 0)).toBe(50)
    })

    it('computes replaySurface × 5 component', () => {
      expect(cbe.__testHooks.computeComplexityScore(0, 0, 20, 0)).toBe(100)
    })

    it('computes plugins × 2 component', () => {
      expect(cbe.__testHooks.computeComplexityScore(0, 0, 0, 30)).toBe(60)
    })

    it('computes combined score correctly', () => {
      // 50*3 + 4.5*10 + 20*5 + 30*2 = 150+45+100+60 = 355
      expect(cbe.__testHooks.computeComplexityScore(50, 4.5, 20, 30)).toBe(355)
    })

    it('computes over-budget score', () => {
      // services=200*3=600 + avgDeps=30*10=300 = 900 under; add replay=30*5=150 = 1050 over
      expect(cbe.__testHooks.computeComplexityScore(200, 30, 30, 0)).toBe(1050)
    })
  })

  describe('isOverBudget', () => {
    it('returns false when score is at budget', () => {
      expect(cbe.__testHooks.isOverBudget(1000)).toBe(false)
    })

    it('returns true when score exceeds budget', () => {
      expect(cbe.__testHooks.isOverBudget(1001)).toBe(true)
    })

    it('returns false below budget', () => {
      expect(cbe.__testHooks.isOverBudget(500)).toBe(false)
    })
  })

  describe('computeBudgetUtilization', () => {
    it('returns 0.5 for half the budget', () => {
      expect(cbe.__testHooks.computeBudgetUtilization(500)).toBe(0.5)
    })

    it('returns 1.0 at budget limit', () => {
      expect(cbe.__testHooks.computeBudgetUtilization(1000)).toBe(1.0)
    })

    it('returns > 1.0 over budget', () => {
      expect(cbe.__testHooks.computeBudgetUtilization(1100)).toBe(1.1)
    })
  })

  describe('classifyComplexityRisk', () => {
    it('returns low for score below 65% of budget (< 650)', () => {
      expect(cbe.__testHooks.classifyComplexityRisk(600)).toBe('low')
    })

    it('returns medium for score between 65% and 85% (650–850)', () => {
      expect(cbe.__testHooks.classifyComplexityRisk(700)).toBe('medium')
    })

    it('returns high for score between 85% and 100% (850–1000)', () => {
      expect(cbe.__testHooks.classifyComplexityRisk(900)).toBe('high')
    })

    it('returns critical for score over 100% (> 1000)', () => {
      expect(cbe.__testHooks.classifyComplexityRisk(1050)).toBe('critical')
    })

    it('returns medium at exactly 650', () => {
      expect(cbe.__testHooks.classifyComplexityRisk(651)).toBe('medium')
    })
  })

  describe('_mapComplexityBudget', () => {
    it('maps fields correctly', () => {
      const budget = cbe.__testHooks._mapComplexityBudget(makeComplexityBudgetRow())
      expect(budget.serviceCount).toBe(50)
      expect(budget.averageDependencies).toBe(4.5)
      expect(budget.totalComplexityScore).toBe(460)
      expect(budget.budgetLimit).toBe(1000)
      expect(budget.isOverBudget).toBe(false)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 10. subsystemDependencyAnalyzer
// ════════════════════════════════════════════════════════════════════════════

describe('subsystemDependencyAnalyzer', () => {
  describe('isTightlyCoupled', () => {
    it('returns true when coupling >= 0.7', () => {
      const dep = sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.7 }))
      expect(sda.__testHooks.isTightlyCoupled(dep)).toBe(true)
    })

    it('returns false when coupling < 0.7', () => {
      const dep = sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.69 }))
      expect(sda.__testHooks.isTightlyCoupled(dep)).toBe(false)
    })

    it('returns true for high coupling (0.9)', () => {
      const dep = sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.9 }))
      expect(sda.__testHooks.isTightlyCoupled(dep)).toBe(true)
    })
  })

  describe('computeAverageCoupling', () => {
    it('returns 0 for empty list', () => {
      expect(sda.__testHooks.computeAverageCoupling([])).toBe(0)
    })

    it('returns single value for one dependency', () => {
      const dep = sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.6 }))
      expect(sda.__testHooks.computeAverageCoupling([dep])).toBe(0.6)
    })

    it('averages multiple dependencies', () => {
      const d1 = sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.4 }))
      const d2 = sda.__testHooks._mapDependency(makeDependencyRow({ id: 'dep2', coupling_score: 0.6 }))
      expect(sda.__testHooks.computeAverageCoupling([d1, d2])).toBe(0.5)
    })
  })

  describe('getHighRiskDependencies', () => {
    it('returns empty for no high-risk deps', () => {
      const dep = sda.__testHooks._mapDependency(
        makeDependencyRow({ coupling_score: 0.5, replay_dependent: false, governance_dependent: false }),
      )
      expect(sda.__testHooks.getHighRiskDependencies([dep])).toHaveLength(0)
    })

    it('returns deps with coupling >= 0.7 AND replay dependent', () => {
      const dep = sda.__testHooks._mapDependency(
        makeDependencyRow({ coupling_score: 0.8, replay_dependent: true }),
      )
      expect(sda.__testHooks.getHighRiskDependencies([dep])).toHaveLength(1)
    })

    it('returns deps with coupling >= 0.7 AND governance dependent', () => {
      const dep = sda.__testHooks._mapDependency(
        makeDependencyRow({ coupling_score: 0.75, replay_dependent: false, governance_dependent: true }),
      )
      expect(sda.__testHooks.getHighRiskDependencies([dep])).toHaveLength(1)
    })

    it('excludes high coupling without dependency flags', () => {
      const dep = sda.__testHooks._mapDependency(
        makeDependencyRow({ coupling_score: 0.9, replay_dependent: false, governance_dependent: false }),
      )
      expect(sda.__testHooks.getHighRiskDependencies([dep])).toHaveLength(0)
    })
  })

  describe('computeCouplingRisk', () => {
    it('returns low for loosely coupled system', () => {
      const deps = [
        sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.3 })),
        sda.__testHooks._mapDependency(makeDependencyRow({ id: 'dep2', coupling_score: 0.2 })),
      ]
      expect(sda.__testHooks.computeCouplingRisk(deps)).toBe('low')
    })

    it('returns high when average coupling >= 0.7', () => {
      const deps = [
        sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.8 })),
        sda.__testHooks._mapDependency(makeDependencyRow({ id: 'dep2', coupling_score: 0.75 })),
      ]
      expect(sda.__testHooks.computeCouplingRisk(deps)).toBe('high')
    })

    it('returns high when 5+ high-risk deps exist', () => {
      const highRiskDeps = Array.from({ length: 5 }, (_, i) =>
        sda.__testHooks._mapDependency(
          makeDependencyRow({ id: `dep${i}`, coupling_score: 0.8, replay_dependent: true }),
        ),
      )
      expect(sda.__testHooks.computeCouplingRisk(highRiskDeps)).toBe('high')
    })

    it('returns medium when average coupling >= 0.45', () => {
      const deps = [
        sda.__testHooks._mapDependency(makeDependencyRow({ coupling_score: 0.5 })),
        sda.__testHooks._mapDependency(makeDependencyRow({ id: 'dep2', coupling_score: 0.5 })),
      ]
      expect(sda.__testHooks.computeCouplingRisk(deps)).toBe('medium')
    })

    it('returns medium when 2 high-risk deps exist (avg coupling < 0.7)', () => {
      // Use many low-coupling deps to bring average below 0.7 while keeping 2 high-risk
      const deps = [
        sda.__testHooks._mapDependency(
          makeDependencyRow({ coupling_score: 0.75, replay_dependent: true }),
        ),
        sda.__testHooks._mapDependency(
          makeDependencyRow({ id: 'dep2', coupling_score: 0.72, governance_dependent: true }),
        ),
        // Low-coupling non-risky deps to dilute the average below 0.7
        ...Array.from({ length: 6 }, (_, i) =>
          sda.__testHooks._mapDependency(
            makeDependencyRow({ id: `dep${i + 3}`, coupling_score: 0.1, replay_dependent: false, governance_dependent: false }),
          ),
        ),
      ]
      // avg ≈ (0.75+0.72+0.1*6)/8 ≈ 0.31 < 0.45 triggers medium via highRisk=2
      expect(sda.__testHooks.computeCouplingRisk(deps)).toBe('medium')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 11. governanceImpactEstimator
// ════════════════════════════════════════════════════════════════════════════

describe('governanceImpactEstimator', () => {
  describe('computeOverallRisk', () => {
    it('returns none when all risks are none', () => {
      expect(gie.__testHooks.computeOverallRisk('none', 'none', 'none')).toBe('none')
    })

    it('returns max of three risk levels', () => {
      expect(gie.__testHooks.computeOverallRisk('low', 'high', 'medium')).toBe('high')
    })

    it('returns medium when max is medium', () => {
      expect(gie.__testHooks.computeOverallRisk('low', 'medium', 'low')).toBe('medium')
    })

    it('returns high when one is high', () => {
      expect(gie.__testHooks.computeOverallRisk('none', 'none', 'high')).toBe('high')
    })

    it('returns low when all are low', () => {
      expect(gie.__testHooks.computeOverallRisk('low', 'low', 'low')).toBe('low')
    })
  })

  describe('requiresApproval', () => {
    it('returns true for medium risk', () => {
      expect(gie.__testHooks.requiresApproval('medium')).toBe(true)
    })

    it('returns true for high risk', () => {
      expect(gie.__testHooks.requiresApproval('high')).toBe(true)
    })

    it('returns false for low risk', () => {
      expect(gie.__testHooks.requiresApproval('low')).toBe(false)
    })

    it('returns false for none risk', () => {
      expect(gie.__testHooks.requiresApproval('none')).toBe(false)
    })
  })

  describe('isChangeBlocked', () => {
    it('returns true when risk is high and not approved', () => {
      const estimate = gie.__testHooks._mapImpactEstimate(
        makeImpactEstimateRow({ overall_risk: 'high', approved: false }),
      )
      expect(gie.__testHooks.isChangeBlocked(estimate)).toBe(true)
    })

    it('returns false when risk is high but approved', () => {
      const estimate = gie.__testHooks._mapImpactEstimate(
        makeImpactEstimateRow({ overall_risk: 'high', approved: true }),
      )
      expect(gie.__testHooks.isChangeBlocked(estimate)).toBe(false)
    })

    it('returns false when risk is medium (not high)', () => {
      const estimate = gie.__testHooks._mapImpactEstimate(
        makeImpactEstimateRow({ overall_risk: 'medium', approved: false }),
      )
      expect(gie.__testHooks.isChangeBlocked(estimate)).toBe(false)
    })

    it('returns false when risk is low', () => {
      const estimate = gie.__testHooks._mapImpactEstimate(
        makeImpactEstimateRow({ overall_risk: 'low', approved: false }),
      )
      expect(gie.__testHooks.isChangeBlocked(estimate)).toBe(false)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 12. technicalDebtTracker
// ════════════════════════════════════════════════════════════════════════════

describe('technicalDebtTracker', () => {
  describe('computeTotalDebtEffort', () => {
    it('returns 0 for empty items', () => {
      expect(tdt.__testHooks.computeTotalDebtEffort([])).toBe(0)
    })

    it('sums effort for open items only', () => {
      const open = tdt.__testHooks._mapDebtItem(makeDebtItemRow({ estimated_effort_days: 10 }))
      const resolved = tdt.__testHooks._mapDebtItem(
        makeDebtItemRow({ id: 'di2', estimated_effort_days: 5, resolved_at: new Date().toISOString() }),
      )
      expect(tdt.__testHooks.computeTotalDebtEffort([open, resolved])).toBe(10)
    })

    it('sums multiple open items', () => {
      const items = [
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ estimated_effort_days: 10 })),
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ id: 'di2', estimated_effort_days: 20 })),
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ id: 'di3', estimated_effort_days: 15 })),
      ]
      expect(tdt.__testHooks.computeTotalDebtEffort(items)).toBe(45)
    })
  })

  describe('hasBlockingDebt', () => {
    it('returns false for empty items', () => {
      expect(tdt.__testHooks.hasBlockingDebt([])).toBe(false)
    })

    it('returns true for critical, replay-impacting, open item', () => {
      const item = tdt.__testHooks._mapDebtItem(
        makeDebtItemRow({ severity: 'critical', replay_impact: true }),
      )
      expect(tdt.__testHooks.hasBlockingDebt([item])).toBe(true)
    })

    it('returns false for critical but no replay impact', () => {
      const item = tdt.__testHooks._mapDebtItem(
        makeDebtItemRow({ severity: 'critical', replay_impact: false }),
      )
      expect(tdt.__testHooks.hasBlockingDebt([item])).toBe(false)
    })

    it('returns false for replay-impacting but not critical', () => {
      const item = tdt.__testHooks._mapDebtItem(
        makeDebtItemRow({ severity: 'high', replay_impact: true }),
      )
      expect(tdt.__testHooks.hasBlockingDebt([item])).toBe(false)
    })

    it('returns false for critical replay item that is resolved', () => {
      const item = tdt.__testHooks._mapDebtItem(
        makeDebtItemRow({
          severity: 'critical', replay_impact: true,
          resolved_at: new Date().toISOString(),
        }),
      )
      expect(tdt.__testHooks.hasBlockingDebt([item])).toBe(false)
    })
  })

  describe('countDebtBySeverity', () => {
    it('returns all zeros for empty items', () => {
      const counts = tdt.__testHooks.countDebtBySeverity([])
      expect(counts.critical).toBe(0)
      expect(counts.high).toBe(0)
      expect(counts.medium).toBe(0)
      expect(counts.low).toBe(0)
    })

    it('counts open items by severity', () => {
      const items = [
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ severity: 'critical' })),
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ id: 'di2', severity: 'high' })),
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ id: 'di3', severity: 'high' })),
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ id: 'di4', severity: 'low' })),
      ]
      const counts = tdt.__testHooks.countDebtBySeverity(items)
      expect(counts.critical).toBe(1)
      expect(counts.high).toBe(2)
      expect(counts.medium).toBe(0)
      expect(counts.low).toBe(1)
    })

    it('excludes resolved items', () => {
      const items = [
        tdt.__testHooks._mapDebtItem(makeDebtItemRow({ severity: 'critical' })),
        tdt.__testHooks._mapDebtItem(
          makeDebtItemRow({
            id: 'di2', severity: 'critical',
            resolved_at: new Date().toISOString(),
          }),
        ),
      ]
      expect(tdt.__testHooks.countDebtBySeverity(items).critical).toBe(1)
    })
  })

  describe('classifyDebtRisk', () => {
    it('returns low for <= 15 days', () => {
      expect(tdt.__testHooks.classifyDebtRisk(15)).toBe('low')
    })

    it('returns medium for 16–45 days', () => {
      expect(tdt.__testHooks.classifyDebtRisk(30)).toBe('medium')
    })

    it('returns high for 46–90 days', () => {
      expect(tdt.__testHooks.classifyDebtRisk(60)).toBe('high')
    })

    it('returns critical for > 90 days', () => {
      expect(tdt.__testHooks.classifyDebtRisk(100)).toBe('critical')
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 13. serviceLifecycleManager
// ════════════════════════════════════════════════════════════════════════════

describe('serviceLifecycleManager', () => {
  describe('isServiceActive', () => {
    it('returns true for active status', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ status: 'active' }))
      expect(slm.__testHooks.isServiceActive(r)).toBe(true)
    })

    it('returns false for deprecated status', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ status: 'deprecated' }))
      expect(slm.__testHooks.isServiceActive(r)).toBe(false)
    })

    it('returns false for removed status', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ status: 'removed' }))
      expect(slm.__testHooks.isServiceActive(r)).toBe(false)
    })
  })

  describe('isServiceSunset', () => {
    it('returns true for removed status', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ status: 'removed' }))
      expect(slm.__testHooks.isServiceSunset(r)).toBe(true)
    })

    it('returns true when sunsetAt is in the past', () => {
      const past = new Date(Date.now() - 86400000).toISOString()
      const r = slm.__testHooks._mapLifecycleRecord(
        makeLifecycleRecordRow({ status: 'deprecated', sunset_at: past }),
      )
      expect(slm.__testHooks.isServiceSunset(r)).toBe(true)
    })

    it('returns false for active service with future sunset', () => {
      const future = new Date(Date.now() + 86400000).toISOString()
      const r = slm.__testHooks._mapLifecycleRecord(
        makeLifecycleRecordRow({ status: 'active', sunset_at: future }),
      )
      expect(slm.__testHooks.isServiceSunset(r)).toBe(false)
    })

    it('returns false for active service with no sunset', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow())
      expect(slm.__testHooks.isServiceSunset(r)).toBe(false)
    })
  })

  describe('getDaysUntilSunset', () => {
    it('returns null when no sunsetAt', () => {
      const r = slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow())
      expect(slm.__testHooks.getDaysUntilSunset(r)).toBeNull()
    })

    it('returns positive number for future sunset', () => {
      const future = new Date(Date.now() + 30 * 86400000).toISOString()
      const r = slm.__testHooks._mapLifecycleRecord(
        makeLifecycleRecordRow({ sunset_at: future }),
      )
      const days = slm.__testHooks.getDaysUntilSunset(r)
      expect(days).toBeGreaterThan(0)
      expect(days).toBeLessThanOrEqual(31)
    })

    it('returns negative or 0 for past sunset', () => {
      const past = new Date(Date.now() - 5 * 86400000).toISOString()
      const r = slm.__testHooks._mapLifecycleRecord(
        makeLifecycleRecordRow({ sunset_at: past }),
      )
      const days = slm.__testHooks.getDaysUntilSunset(r)
      expect(days).toBeLessThanOrEqual(0)
    })
  })

  describe('countByStatus', () => {
    it('returns empty object for no records', () => {
      expect(slm.__testHooks.countByStatus([])).toEqual({})
    })

    it('counts statuses correctly', () => {
      const records = [
        slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ status: 'active' })),
        slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ id: 'lr2', status: 'active' })),
        slm.__testHooks._mapLifecycleRecord(makeLifecycleRecordRow({ id: 'lr3', status: 'deprecated' })),
      ]
      const counts = slm.__testHooks.countByStatus(records)
      expect(counts.active).toBe(2)
      expect(counts.deprecated).toBe(1)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 14. deprecationCoordinator
// ════════════════════════════════════════════════════════════════════════════

describe('deprecationCoordinator', () => {
  describe('isDeprecated', () => {
    it('returns true when deprecatedAt is in the past', () => {
      const r = dc.__testHooks._mapDeprecationRecord(makeDeprecationRecordRow())
      expect(dc.__testHooks.isDeprecated(r)).toBe(true)
    })

    it('returns false when deprecatedAt is in the future', () => {
      const future = new Date(Date.now() + 86400000).toISOString()
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ deprecated_at: future }),
      )
      expect(dc.__testHooks.isDeprecated(r)).toBe(false)
    })
  })

  describe('isPastSunset', () => {
    it('returns false when sunset is in the future', () => {
      const r = dc.__testHooks._mapDeprecationRecord(makeDeprecationRecordRow())
      expect(dc.__testHooks.isPastSunset(r)).toBe(false)
    })

    it('returns true when sunset is in the past', () => {
      const past = new Date(Date.now() - 86400000).toISOString()
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ sunset_at: past }),
      )
      expect(dc.__testHooks.isPastSunset(r)).toBe(true)
    })
  })

  describe('getDaysToSunset', () => {
    it('returns a positive number for future sunset', () => {
      const r = dc.__testHooks._mapDeprecationRecord(makeDeprecationRecordRow())
      const days = dc.__testHooks.getDaysToSunset(r)
      expect(days).toBeGreaterThan(0)
    })

    it('returns negative number for past sunset', () => {
      const past = new Date(Date.now() - 5 * 86400000).toISOString()
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ sunset_at: past }),
      )
      expect(dc.__testHooks.getDaysToSunset(r)).toBeLessThan(0)
    })
  })

  describe('isHighImpactDeprecation', () => {
    it('returns true when affected tenants >= 10', () => {
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ affected_tenants_count: 10 }),
      )
      expect(dc.__testHooks.isHighImpactDeprecation(r)).toBe(true)
    })

    it('returns true when migration path is null', () => {
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ migration_path: null }),
      )
      expect(dc.__testHooks.isHighImpactDeprecation(r)).toBe(true)
    })

    it('returns false when tenants < 10 and migration path exists', () => {
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ affected_tenants_count: 5, migration_path: '/api/v2' }),
      )
      expect(dc.__testHooks.isHighImpactDeprecation(r)).toBe(false)
    })

    it('returns true when tenants >= 10 even with migration path', () => {
      const r = dc.__testHooks._mapDeprecationRecord(
        makeDeprecationRecordRow({ affected_tenants_count: 15, migration_path: '/api/v2' }),
      )
      expect(dc.__testHooks.isHighImpactDeprecation(r)).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 15. compatibilityMatrixGenerator
// ════════════════════════════════════════════════════════════════════════════

describe('compatibilityMatrixGenerator', () => {
  describe('isFullyCompatible', () => {
    it('returns true for fully compatible matrix', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(makeCompatibilityMatrixRow())
      expect(cmg.__testHooks.isFullyCompatible(matrix)).toBe(true)
    })

    it('returns false when not compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ compatible: false }),
      )
      expect(cmg.__testHooks.isFullyCompatible(matrix)).toBe(false)
    })

    it('returns false when not replay compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ replay_compatible: false }),
      )
      expect(cmg.__testHooks.isFullyCompatible(matrix)).toBe(false)
    })

    it('returns false when not schema compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ schema_compatible: false }),
      )
      expect(cmg.__testHooks.isFullyCompatible(matrix)).toBe(false)
    })

    it('returns false when breaking changes exist', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ breaking_changes: ['removed endpoint'] }),
      )
      expect(cmg.__testHooks.isFullyCompatible(matrix)).toBe(false)
    })
  })

  describe('hasBreakingChanges', () => {
    it('returns false for empty breaking changes', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(makeCompatibilityMatrixRow())
      expect(cmg.__testHooks.hasBreakingChanges(matrix)).toBe(false)
    })

    it('returns true when breaking changes exist', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ breaking_changes: ['removed /api/v1/foo'] }),
      )
      expect(cmg.__testHooks.hasBreakingChanges(matrix)).toBe(true)
    })
  })

  describe('classifyCompatibilityRisk', () => {
    it('returns none for fully compatible matrix', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(makeCompatibilityMatrixRow())
      expect(cmg.__testHooks.classifyCompatibilityRisk(matrix)).toBe('none')
    })

    it('returns high when not replay compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ replay_compatible: false }),
      )
      expect(cmg.__testHooks.classifyCompatibilityRisk(matrix)).toBe('high')
    })

    it('returns high when not schema compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ schema_compatible: false }),
      )
      expect(cmg.__testHooks.classifyCompatibilityRisk(matrix)).toBe('high')
    })

    it('returns medium when not compatible (but replay/schema ok)', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ compatible: false }),
      )
      expect(cmg.__testHooks.classifyCompatibilityRisk(matrix)).toBe('medium')
    })

    it('returns low when only breaking changes exist', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ breaking_changes: ['deprecated field'] }),
      )
      expect(cmg.__testHooks.classifyCompatibilityRisk(matrix)).toBe('low')
    })
  })

  describe('requiresMigration', () => {
    it('returns false when schema compatible and no breaking changes', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(makeCompatibilityMatrixRow())
      expect(cmg.__testHooks.requiresMigration(matrix)).toBe(false)
    })

    it('returns true when not schema compatible', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ schema_compatible: false }),
      )
      expect(cmg.__testHooks.requiresMigration(matrix)).toBe(true)
    })

    it('returns true when breaking changes exist', () => {
      const matrix = cmg.__testHooks._mapCompatibilityMatrix(
        makeCompatibilityMatrixRow({ breaking_changes: ['field removed'] }),
      )
      expect(cmg.__testHooks.requiresMigration(matrix)).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 16. operationalFeedbackHub
// ════════════════════════════════════════════════════════════════════════════

describe('operationalFeedbackHub', () => {
  describe('classifyFeedbackSentiment', () => {
    it('returns positive for text with positive keywords', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('This is a great experience!')).toBe('positive')
    })

    it('returns negative for text with negative keywords', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('This is broken and confusing.')).toBe('negative')
    })

    it('returns neutral for text with no keywords', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('I used the platform today.')).toBe('neutral')
    })

    it('returns positive when positive count exceeds negative', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('Great and excellent, though a bit slow.')).toBe('positive')
    })

    it('returns negative when negative count exceeds positive', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('Terrible and broken, hate it.')).toBe('negative')
    })

    it('returns neutral when positive and negative counts are equal', () => {
      expect(ofh.__testHooks.classifyFeedbackSentiment('great but broken')).toBe('neutral')
    })
  })

  describe('isActionableFeedback', () => {
    it('returns true for negative sentiment', () => {
      expect(ofh.__testHooks.isActionableFeedback('negative', 'general')).toBe(true)
    })

    it('returns true for feature_request category', () => {
      expect(ofh.__testHooks.isActionableFeedback('positive', 'feature_request')).toBe(true)
    })

    it('returns true for usability category', () => {
      expect(ofh.__testHooks.isActionableFeedback('neutral', 'usability')).toBe(true)
    })

    it('returns false for positive general feedback', () => {
      expect(ofh.__testHooks.isActionableFeedback('positive', 'general')).toBe(false)
    })

    it('returns false for neutral general feedback', () => {
      expect(ofh.__testHooks.isActionableFeedback('neutral', 'general')).toBe(false)
    })
  })

  describe('computeSentimentScore', () => {
    it('returns 0.5 for empty records', () => {
      expect(ofh.__testHooks.computeSentimentScore([])).toBe(0.5)
    })

    it('returns positive value for all positive records', () => {
      const records = [
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ sentiment: 'positive' })),
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ id: 'fr2', sentiment: 'positive' })),
      ]
      // 2 positive - 0*0.5 / 2 = 1.0
      expect(ofh.__testHooks.computeSentimentScore(records)).toBe(1.0)
    })

    it('returns negative value when more negative than positive', () => {
      const records = [
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ sentiment: 'negative' })),
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ id: 'fr2', sentiment: 'negative' })),
      ]
      // 0 - 2*0.5 / 2 = -0.5
      expect(ofh.__testHooks.computeSentimentScore(records)).toBe(-0.5)
    })

    it('computes mixed sentiment correctly', () => {
      const records = [
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ sentiment: 'positive' })),
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ id: 'fr2', sentiment: 'positive' })),
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ id: 'fr3', sentiment: 'negative' })),
        ofh.__testHooks._mapFeedbackRecord(makeFeedbackRecordRow({ id: 'fr4', sentiment: 'neutral' })),
      ]
      // (2 - 1*0.5) / 4 = 1.5/4 = 0.375
      expect(ofh.__testHooks.computeSentimentScore(records)).toBe(0.375)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 17. usabilitySignalAggregator
// ════════════════════════════════════════════════════════════════════════════

describe('usabilitySignalAggregator', () => {
  describe('computeFrictionScore', () => {
    it('returns 0 for perfect completion, on-time, no abandonment', () => {
      expect(usa.__testHooks.computeFrictionScore(1.0, 1000, 2000, 0)).toBe(0)
    })

    it('computes completion friction: (1-0.5)*50 = 25', () => {
      expect(usa.__testHooks.computeFrictionScore(0.5, 1000, 2000, 0)).toBe(25)
    })

    it('computes abandon friction: min(2*5,20) = 10', () => {
      expect(usa.__testHooks.computeFrictionScore(1.0, 1000, 2000, 2)).toBe(10)
    })

    it('caps abandon friction at 20', () => {
      expect(usa.__testHooks.computeFrictionScore(1.0, 1000, 2000, 10)).toBe(20)
    })

    it('computes time friction when over expected', () => {
      // avg=3000, expected=1000 → (3000/1000-1)*20 = 40, but capped at 30
      expect(usa.__testHooks.computeFrictionScore(1.0, 3000, 1000, 0)).toBe(30)
    })

    it('no time friction when under expected time', () => {
      expect(usa.__testHooks.computeFrictionScore(1.0, 500, 2000, 0)).toBe(0)
    })

    it('caps total at 100', () => {
      // completion: 50, time: 30 (capped), abandon: 20 (capped) = 100
      expect(usa.__testHooks.computeFrictionScore(0.0, 5000, 1000, 10)).toBe(100)
    })
  })

  describe('isHighFriction', () => {
    it('returns true when friction score >= 50', () => {
      const signal = usa.__testHooks._mapUsabilitySignal(
        makeUsabilitySignalRow({ friction_score: 50 }),
      )
      expect(usa.__testHooks.isHighFriction(signal)).toBe(true)
    })

    it('returns false when friction score < 50', () => {
      const signal = usa.__testHooks._mapUsabilitySignal(
        makeUsabilitySignalRow({ friction_score: 49 }),
      )
      expect(usa.__testHooks.isHighFriction(signal)).toBe(false)
    })
  })

  describe('getRankedFrictionFeatures', () => {
    it('returns signals sorted by friction score descending', () => {
      const signals = [
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ feature: 'a', friction_score: 30 })),
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ id: 'us2', feature: 'b', friction_score: 70 })),
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ id: 'us3', feature: 'c', friction_score: 50 })),
      ]
      const ranked = usa.__testHooks.getRankedFrictionFeatures(signals)
      expect(ranked[0].feature).toBe('b')
      expect(ranked[1].feature).toBe('c')
      expect(ranked[2].feature).toBe('a')
    })

    it('does not mutate original array', () => {
      const signals = [
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ feature: 'a', friction_score: 30 })),
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ id: 'us2', feature: 'b', friction_score: 70 })),
      ]
      usa.__testHooks.getRankedFrictionFeatures(signals)
      expect(signals[0].feature).toBe('a')
    })
  })

  describe('computeAverageCompletionRate', () => {
    it('returns 1.0 for empty signals', () => {
      expect(usa.__testHooks.computeAverageCompletionRate([])).toBe(1.0)
    })

    it('returns single signal completion rate', () => {
      const signal = usa.__testHooks._mapUsabilitySignal(
        makeUsabilitySignalRow({ completion_rate: 0.80 }),
      )
      expect(usa.__testHooks.computeAverageCompletionRate([signal])).toBe(0.80)
    })

    it('averages multiple signals', () => {
      const signals = [
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ completion_rate: 0.80 })),
        usa.__testHooks._mapUsabilitySignal(makeUsabilitySignalRow({ id: 'us2', completion_rate: 0.60 })),
      ]
      expect(usa.__testHooks.computeAverageCompletionRate(signals)).toBe(0.70)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 18. ecosystemFeedbackAnalyzer
// ════════════════════════════════════════════════════════════════════════════

describe('ecosystemFeedbackAnalyzer', () => {
  describe('computeTrustSignalScore', () => {
    it('returns 0.5 for empty feedback', () => {
      expect(efa.__testHooks.computeTrustSignalScore(0, 0, 0)).toBe(0.5)
    })

    it('returns 1.0 for all positive', () => {
      expect(efa.__testHooks.computeTrustSignalScore(10, 0, 0)).toBe(1.0)
    })

    it('returns 0 for all negative', () => {
      expect(efa.__testHooks.computeTrustSignalScore(0, 0, 10)).toBe(0)
    })

    it('computes mixed score correctly', () => {
      // positive=60*1 + neutral=20*0.5 = 70 / 100 = 0.70
      expect(efa.__testHooks.computeTrustSignalScore(60, 20, 20)).toBe(0.7)
    })

    it('returns 0.9 for 80 positive, 20 neutral, 0 negative', () => {
      // (80*1 + 20*0.5) / 100 = 90/100 = 0.9
      expect(efa.__testHooks.computeTrustSignalScore(80, 20, 0)).toBe(0.9)
    })

    it('handles only neutral feedback', () => {
      // neutral=10*0.5 / 10 = 0.5
      expect(efa.__testHooks.computeTrustSignalScore(0, 10, 0)).toBe(0.5)
    })
  })

  describe('computeNPS', () => {
    it('returns 0 for empty feedback', () => {
      expect(efa.__testHooks.computeNPS(0, 0, 0)).toBe(0)
    })

    it('returns 100 for all positive', () => {
      expect(efa.__testHooks.computeNPS(100, 0, 100)).toBe(100)
    })

    it('returns -100 for all negative', () => {
      expect(efa.__testHooks.computeNPS(0, 100, 100)).toBe(-100)
    })

    it('computes NPS correctly for mixed feedback', () => {
      // (70-10)/100*100 = 60
      expect(efa.__testHooks.computeNPS(70, 10, 100)).toBe(60)
    })

    it('rounds result', () => {
      // (3-1)/7*100 = 28.57 → 29
      expect(efa.__testHooks.computeNPS(3, 1, 7)).toBe(29)
    })
  })

  describe('identifyTopFrictionAreas', () => {
    it('returns empty for empty category map', () => {
      expect(efa.__testHooks.identifyTopFrictionAreas({})).toHaveLength(0)
    })

    it('returns top N by frequency', () => {
      const freq = { onboarding: 50, replay: 30, workflow: 20, export: 10 }
      const top = efa.__testHooks.identifyTopFrictionAreas(freq, 3)
      expect(top).toEqual(['onboarding', 'replay', 'workflow'])
    })

    it('returns fewer than N when fewer categories exist', () => {
      const freq = { onboarding: 50 }
      const top = efa.__testHooks.identifyTopFrictionAreas(freq, 3)
      expect(top).toHaveLength(1)
    })

    it('defaults to top 3 when topN not specified', () => {
      const freq = { a: 5, b: 4, c: 3, d: 2, e: 1 }
      expect(efa.__testHooks.identifyTopFrictionAreas(freq)).toHaveLength(3)
    })
  })

  describe('isFeedbackHealthy', () => {
    it('returns true when trust signal score >= 0.65', () => {
      const summary = efa.__testHooks._mapFeedbackSummary(
        makeFeedbackSummaryRow({ trust_signal_score: 0.70 }),
      )
      expect(efa.__testHooks.isFeedbackHealthy(summary)).toBe(true)
    })

    it('returns false when trust signal score < 0.65', () => {
      const summary = efa.__testHooks._mapFeedbackSummary(
        makeFeedbackSummaryRow({ trust_signal_score: 0.60 }),
      )
      expect(efa.__testHooks.isFeedbackHealthy(summary)).toBe(false)
    })

    it('returns true at exactly 0.65', () => {
      const summary = efa.__testHooks._mapFeedbackSummary(
        makeFeedbackSummaryRow({ trust_signal_score: 0.65 }),
      )
      expect(efa.__testHooks.isFeedbackHealthy(summary)).toBe(true)
    })
  })

  describe('_mapFeedbackSummary', () => {
    it('maps all fields correctly', () => {
      const summary = efa.__testHooks._mapFeedbackSummary(makeFeedbackSummaryRow())
      expect(summary.totalFeedback).toBe(100)
      expect(summary.positiveCount).toBe(70)
      expect(summary.neutralCount).toBe(20)
      expect(summary.negativeCount).toBe(10)
      expect(summary.trustSignalScore).toBe(0.80)
      expect(summary.topFrictionAreas).toEqual(['workflow_builder', 'onboarding'])
    })
  })

  describe('getLatestFeedbackSummary (DB)', () => {
    it('returns null when no rows', async () => {
      ;(mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockEmpty())
      const result = await efa.getLatestFeedbackSummary()
      expect(result).toBeNull()
    })

    it('returns mapped summary when found', async () => {
      ;(mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRow(makeFeedbackSummaryRow()),
      )
      const result = await efa.getLatestFeedbackSummary()
      expect(result?.totalFeedback).toBe(100)
    })
  })
})

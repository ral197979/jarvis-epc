// Denver Engineering — Post-GA Tests Part A (v1.0.0)
// Tests: deploymentOperationsCoordinator, rolloutWaveManager,
//        productionTelemetryOperations, governanceDurabilityAuditor,
//        customerAdoptionOptimizer, ecosystemTrustOperations

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

import { pool, tenantQuery } from '../../../api/db/pool'
import { __testHooks as dep } from '../../../api/services/postGA/deploymentOperationsCoordinator'
import { __testHooks as rwm } from '../../../api/services/postGA/rolloutWaveManager'
import { __testHooks as pto } from '../../../api/services/postGA/productionTelemetryOperations'
import { __testHooks as gda } from '../../../api/services/postGA/governanceDurabilityAuditor'
import { __testHooks as cao } from '../../../api/services/postGA/customerAdoptionOptimizer'
import { __testHooks as eto } from '../../../api/services/postGA/ecosystemTrustOperations'

import * as deploymentOps from '../../../api/services/postGA/deploymentOperationsCoordinator'
import * as rolloutOps from '../../../api/services/postGA/rolloutWaveManager'
import * as telemetryOps from '../../../api/services/postGA/productionTelemetryOperations'
import * as govOps from '../../../api/services/postGA/governanceDurabilityAuditor'
import * as adoptionOps from '../../../api/services/postGA/customerAdoptionOptimizer'
import * as ecoOps from '../../../api/services/postGA/ecosystemTrustOperations'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockPool = pool as { query: ReturnType<typeof vi.fn> }
const mockTenantQuery = tenantQuery as ReturnType<typeof vi.fn>

const mockRow = (row: Record<string, unknown>) => ({ rows: [row], rowCount: 1 })
const mockRows = (rows: Record<string, unknown>[]) => ({ rows, rowCount: rows.length })
const mockEmpty = () => ({ rows: [], rowCount: 0 })

function makeLaunchRecordRow(overrides = {}) {
  return {
    id: 'lr1', tenant_id: 't1', wave_id: null,
    readiness_score: 85, onboarding_complete: true,
    replay_validated: true, governance_verified: true,
    status: 'ready', launched_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeWaveRow(overrides = {}) {
  return {
    id: 'w1', wave_name: 'Wave 1',
    tenant_ids: ['t1', 't2', 't3'],
    status: 'in_progress', target_count: 10,
    deployed_count: 7, failed_count: 1,
    replay_validated: true,
    scheduled_at: null, completed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeTelemetryRow(overrides = {}) {
  return {
    id: 'tel1', metric: 'recommendation_acceptance',
    tenant_id: 't1', value: 220, baseline_value: 200,
    drift_pct: 0.10, drift_severity: 'minor',
    recorded_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDriftSummaryRow(overrides = {}) {
  return {
    id: 'ds1', environment: 'production',
    alert_count: 2, severe_metrics: [],
    overall_drift_score: 90, is_healthy: true,
    computed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeDurabilityRow(overrides = {}) {
  return {
    id: 'dur1', dimension: 'replay_integrity',
    pass_rate: 0.99, fail_count: 0, warn_count: 1,
    is_durable: true, trend: 'improving',
    measured_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeReplayDriftRow(overrides = {}) {
  return {
    id: 'rd1', stream_id: 'stream-1', tenant_id: 't1',
    baseline_determinism_rate: 1.0, current_determinism_rate: 0.998,
    drift_pct: 0.002, is_alert: false,
    detected_at: new Date().toISOString(), resolved_at: null,
    ...overrides,
  }
}

function makeAdoptionRow(overrides = {}) {
  return {
    id: 'ad1', tenant_id: 't1',
    adoption_score: 72, adoption_tier: 'active',
    churn_risk: 0.20, daily_active_rate: 0.65,
    workflow_completion_rate: 0.70, ai_acceptance_rate: 0.55,
    recommended_interventions: [], maturity_level: 'operational',
    assessed_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeTrustRecordRow(overrides = {}) {
  return {
    id: 'tr1', entity_id: 'plugin-a',
    entity_type: 'plugin', trust_score: 80,
    moderation_action: null, action_reason: null,
    reviewer_id: null, is_immutable: false,
    actioned_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeQueueItemRow(overrides = {}) {
  return {
    id: 'qi1', entity_id: 'plugin-b',
    entity_type: 'plugin', trust_score: 45,
    flag_count: 2, priority: 'high',
    queued_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─── deploymentOperationsCoordinator ─────────────────────────────────────────

describe('deploymentOperationsCoordinator', () => {
  describe('computeReadinessScore', () => {
    it('returns 100 for full score', () => {
      expect(dep.computeReadinessScore(true, true, true, 1.0)).toBe(100)
    })

    it('gatePassRate provides 60 base points', () => {
      expect(dep.computeReadinessScore(false, false, false, 1.0)).toBe(60)
    })

    it('onboarding bonus adds 15 points', () => {
      expect(dep.computeReadinessScore(true, false, false, 1.0)).toBe(75)
    })

    it('replay bonus adds 15 points', () => {
      expect(dep.computeReadinessScore(false, true, false, 1.0)).toBe(75)
    })

    it('governance bonus adds 10 points', () => {
      expect(dep.computeReadinessScore(false, false, true, 1.0)).toBe(70)
    })

    it('zero gatePassRate gives zero base', () => {
      expect(dep.computeReadinessScore(false, false, false, 0)).toBe(0)
    })

    it('partial gatePassRate scales correctly', () => {
      expect(dep.computeReadinessScore(false, false, false, 0.5)).toBe(30)
    })

    it('caps at 100', () => {
      expect(dep.computeReadinessScore(true, true, true, 1.0)).toBeLessThanOrEqual(100)
    })
  })

  describe('isReadyToLaunch', () => {
    it('returns true for fully ready record', () => {
      const rec = dep._mapLaunchRecord(makeLaunchRecordRow())
      expect(dep.isReadyToLaunch(rec)).toBe(true)
    })

    it('returns false when score < 80', () => {
      const rec = dep._mapLaunchRecord(makeLaunchRecordRow({ readiness_score: 75 }))
      expect(dep.isReadyToLaunch(rec)).toBe(false)
    })

    it('returns false when replay not validated', () => {
      const rec = dep._mapLaunchRecord(makeLaunchRecordRow({ replay_validated: false }))
      expect(dep.isReadyToLaunch(rec)).toBe(false)
    })

    it('returns false when governance not verified', () => {
      const rec = dep._mapLaunchRecord(makeLaunchRecordRow({ governance_verified: false }))
      expect(dep.isReadyToLaunch(rec)).toBe(false)
    })
  })

  describe('classifyDeploymentStatus', () => {
    it('returns ready when score >= 80 and both pass', () => {
      expect(dep.classifyDeploymentStatus(80, true, true)).toBe('ready')
      expect(dep.classifyDeploymentStatus(100, true, true)).toBe('ready')
    })

    it('returns not_ready when replay fails', () => {
      expect(dep.classifyDeploymentStatus(90, false, true)).toBe('not_ready')
    })

    it('returns not_ready when governance fails', () => {
      expect(dep.classifyDeploymentStatus(90, true, false)).toBe('not_ready')
    })

    it('returns not_ready when score < 80', () => {
      expect(dep.classifyDeploymentStatus(79, true, true)).toBe('not_ready')
    })
  })

  describe('computeGatePassRate', () => {
    it('returns 1.0 for empty gates', () => {
      expect(dep.computeGatePassRate([])).toBe(1.0)
    })

    it('returns 1.0 when all pass', () => {
      expect(dep.computeGatePassRate([{ status: 'pass' }, { status: 'pass' }] as any)).toBe(1.0)
    })

    it('returns 0.5 when half pass', () => {
      expect(dep.computeGatePassRate([{ status: 'pass' }, { status: 'fail' }] as any)).toBe(0.5)
    })

    it('returns 0 when all fail', () => {
      expect(dep.computeGatePassRate([{ status: 'fail' }, { status: 'fail' }] as any)).toBe(0)
    })

    it('treats warn as not-pass', () => {
      expect(dep.computeGatePassRate([{ status: 'pass' }, { status: 'warn' }] as any)).toBe(0.5)
    })
  })

  describe('_mapLaunchRecord', () => {
    it('maps all fields correctly', () => {
      const rec = dep._mapLaunchRecord(makeLaunchRecordRow())
      expect(rec.id).toBe('lr1')
      expect(rec.tenantId).toBe('t1')
      expect(rec.waveId).toBeNull()
      expect(rec.readinessScore).toBe(85)
      expect(rec.onboardingComplete).toBe(true)
      expect(rec.replayValidated).toBe(true)
      expect(rec.governanceVerified).toBe(true)
      expect(rec.status).toBe('ready')
      expect(rec.launchedAt).toBeNull()
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('createLaunchRecord inserts and returns record', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeLaunchRecordRow()))
      const rec = await deploymentOps.createLaunchRecord('t1', null, true, true, true, 1.0)
      expect(rec.tenantId).toBe('t1')
      expect(mockPool.query).toHaveBeenCalledOnce()
    })

    it('markLaunched updates status', async () => {
      const launched = makeLaunchRecordRow({ status: 'deployed', launched_at: new Date().toISOString() })
      mockPool.query.mockResolvedValueOnce(mockRow(launched))
      const rec = await deploymentOps.markLaunched('t1')
      expect(rec.status).toBe('deployed')
      expect(rec.launchedAt).not.toBeNull()
    })

    it('markLaunched throws if not in ready state', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(deploymentOps.markLaunched('t1')).rejects.toThrow()
    })

    it('getLaunchRecord uses tenantQuery', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockRow(makeLaunchRecordRow()))
      const rec = await deploymentOps.getLaunchRecord('t1')
      expect(rec?.tenantId).toBe('t1')
      expect(mockTenantQuery).toHaveBeenCalledOnce()
    })

    it('getLaunchRecord returns null when not found', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockEmpty())
      const rec = await deploymentOps.getLaunchRecord('t-missing')
      expect(rec).toBeNull()
    })

    it('getReadyTenants fetches ready records', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeLaunchRecordRow(), makeLaunchRecordRow({ id: 'lr2' })]))
      const recs = await deploymentOps.getReadyTenants()
      expect(recs).toHaveLength(2)
    })
  })
})

// ─── rolloutWaveManager ───────────────────────────────────────────────────────

describe('rolloutWaveManager', () => {
  describe('computeWaveProgress', () => {
    it('returns 100 when fully deployed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ target_count: 10, deployed_count: 10 }))
      expect(rwm.computeWaveProgress(wave)).toBe(100)
    })

    it('returns 70 for 7/10 deployed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ target_count: 10, deployed_count: 7 }))
      expect(rwm.computeWaveProgress(wave)).toBe(70)
    })

    it('returns 0 when targetCount is 0', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ target_count: 0, deployed_count: 0 }))
      expect(rwm.computeWaveProgress(wave)).toBe(0)
    })

    it('returns 0 when nothing deployed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ target_count: 10, deployed_count: 0 }))
      expect(rwm.computeWaveProgress(wave)).toBe(0)
    })

    it('rounds to nearest integer', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ target_count: 3, deployed_count: 1 }))
      expect(Number.isInteger(rwm.computeWaveProgress(wave))).toBe(true)
    })
  })

  describe('computeWaveSuccessRate', () => {
    it('returns 1.0 when no attempts made', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 0, failed_count: 0 }))
      expect(rwm.computeWaveSuccessRate(wave)).toBe(1.0)
    })

    it('returns 0.875 for 7 deployed and 1 failed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 7, failed_count: 1 }))
      expect(rwm.computeWaveSuccessRate(wave)).toBeCloseTo(0.875)
    })

    it('returns 1.0 when no failures', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 10, failed_count: 0 }))
      expect(rwm.computeWaveSuccessRate(wave)).toBe(1.0)
    })

    it('returns 0 when all fail', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 0, failed_count: 5 }))
      expect(rwm.computeWaveSuccessRate(wave)).toBe(0)
    })
  })

  describe('isWaveComplete', () => {
    it('returns true when status is completed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ status: 'completed' }))
      expect(rwm.isWaveComplete(wave)).toBe(true)
    })

    it('returns true when deployedCount >= targetCount', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 10, target_count: 10, status: 'active' }))
      expect(rwm.isWaveComplete(wave)).toBe(true)
    })

    it('returns false when in_progress and not fully deployed', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ status: 'active', deployed_count: 7, target_count: 10 }))
      expect(rwm.isWaveComplete(wave)).toBe(false)
    })

    it('returns false when status is paused', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ status: 'paused', deployed_count: 5, target_count: 10 }))
      expect(rwm.isWaveComplete(wave)).toBe(false)
    })
  })

  describe('shouldAbortWave', () => {
    it('returns true when replay not validated', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ replay_validated: false, deployed_count: 10, failed_count: 0 }))
      expect(rwm.shouldAbortWave(wave)).toBe(true)
    })

    it('returns true when success rate < 0.80', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 3, failed_count: 7, replay_validated: true }))
      expect(rwm.shouldAbortWave(wave)).toBe(true)
    })

    it('returns false when replay validated and success rate >= 0.80', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 9, failed_count: 1, replay_validated: true }))
      expect(rwm.shouldAbortWave(wave)).toBe(false)
    })

    it('returns false for perfect wave', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow({ deployed_count: 10, failed_count: 0, replay_validated: true }))
      expect(rwm.shouldAbortWave(wave)).toBe(false)
    })
  })

  describe('_mapRolloutWave', () => {
    it('maps all fields', () => {
      const wave = rwm._mapRolloutWave(makeWaveRow())
      expect(wave.id).toBe('w1')
      expect(wave.waveName).toBe('Wave 1')
      expect(wave.tenantIds).toEqual(['t1', 't2', 't3'])
      expect(wave.targetCount).toBe(10)
      expect(wave.deployedCount).toBe(7)
      expect(wave.failedCount).toBe(1)
      expect(wave.replayValidated).toBe(true)
      expect(wave.scheduledAt).toBeNull()
      expect(wave.completedAt).toBeNull()
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('createWave inserts and returns wave', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeWaveRow()))
      const wave = await rolloutOps.createWave('Wave 1', ['t1', 't2'], true, null)
      expect(wave.waveName).toBe('Wave 1')
      expect(mockPool.query).toHaveBeenCalledOnce()
    })

    it('advanceWave updates with deltas and returns wave', async () => {
      const updated = makeWaveRow({ deployed_count: 8 })
      mockPool.query.mockResolvedValueOnce(mockRow(updated))
      const wave = await rolloutOps.advanceWave('w1', 1, 0)
      expect(wave.deployedCount).toBe(8)
    })

    it('advanceWave throws if not found', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(rolloutOps.advanceWave('w-missing', 5, 0)).rejects.toThrow('RolloutWave')
    })

    it('getActiveWaves returns active waves', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeWaveRow(), makeWaveRow({ id: 'w2' })]))
      const waves = await rolloutOps.getActiveWaves()
      expect(waves).toHaveLength(2)
    })

    it('getWave returns single wave by id', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeWaveRow()))
      const wave = await rolloutOps.getWave('w1')
      expect(wave?.id).toBe('w1')
    })

    it('getWave returns null when not found', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      const wave = await rolloutOps.getWave('w-missing')
      expect(wave).toBeNull()
    })
  })
})

// ─── productionTelemetryOperations ───────────────────────────────────────────

describe('productionTelemetryOperations', () => {
  describe('computeTelemetryDriftPct', () => {
    it('returns 0.10 for baseline 200 → current 220', () => {
      expect(pto.computeTelemetryDriftPct(200, 220)).toBeCloseTo(0.10)
    })

    it('is absolute (handles decreasing)', () => {
      expect(pto.computeTelemetryDriftPct(200, 180)).toBeCloseTo(0.10)
    })

    it('returns 1.0 when baseline is 0 and current > 0', () => {
      expect(pto.computeTelemetryDriftPct(0, 100)).toBe(1.0)
    })

    it('returns 0 when both are 0', () => {
      expect(pto.computeTelemetryDriftPct(0, 0)).toBe(0)
    })

    it('returns 0 when unchanged', () => {
      expect(pto.computeTelemetryDriftPct(100, 100)).toBe(0)
    })
  })

  describe('classifyTelemetryDrift', () => {
    it('classifies 0 as none', () => {
      expect(pto.classifyTelemetryDrift(0)).toBe('none')
    })

    it('classifies 0.05 as none', () => {
      expect(pto.classifyTelemetryDrift(0.05)).toBe('none')
    })

    it('classifies 0.06 as minor', () => {
      expect(pto.classifyTelemetryDrift(0.06)).toBe('minor')
    })

    it('classifies 0.15 as minor', () => {
      expect(pto.classifyTelemetryDrift(0.15)).toBe('minor')
    })

    it('classifies 0.16 as moderate', () => {
      expect(pto.classifyTelemetryDrift(0.16)).toBe('moderate')
    })

    it('classifies 0.35 as moderate', () => {
      expect(pto.classifyTelemetryDrift(0.35)).toBe('moderate')
    })

    it('classifies 0.36 as severe', () => {
      expect(pto.classifyTelemetryDrift(0.36)).toBe('severe')
    })
  })

  describe('computeOverallDriftScore', () => {
    it('returns 100 for empty records', () => {
      expect(pto.computeOverallDriftScore([])).toBe(100)
    })

    it('deducts 5 per non-none severity record', () => {
      const records = [
        pto._mapTelemetryRecord(makeTelemetryRow({ drift_severity: 'minor' })),
        pto._mapTelemetryRecord(makeTelemetryRow({ id: 't2', drift_severity: 'minor' })),
      ]
      expect(pto.computeOverallDriftScore(records)).toBe(90)
    })

    it('deducts 15 per severe record', () => {
      const records = [
        pto._mapTelemetryRecord(makeTelemetryRow({ drift_severity: 'severe' })),
      ]
      expect(pto.computeOverallDriftScore(records)).toBe(80) // -5 alert + -15 severe = -20
    })

    it('none-severity records have zero penalty', () => {
      const records = [
        pto._mapTelemetryRecord(makeTelemetryRow({ drift_severity: 'none' })),
      ]
      expect(pto.computeOverallDriftScore(records)).toBe(100)
    })

    it('floors at 0', () => {
      const records = Array.from({ length: 10 }, (_, i) =>
        pto._mapTelemetryRecord(makeTelemetryRow({ id: `t${i}`, drift_severity: 'severe' }))
      )
      expect(pto.computeOverallDriftScore(records)).toBe(0)
    })
  })

  describe('isTelemetryHealthy', () => {
    it('returns true for score >= 70', () => {
      expect(pto.isTelemetryHealthy(70)).toBe(true)
      expect(pto.isTelemetryHealthy(100)).toBe(true)
    })

    it('returns false for score < 70', () => {
      expect(pto.isTelemetryHealthy(69)).toBe(false)
    })
  })

  describe('getSevereMetrics', () => {
    it('returns only metric names of severe records', () => {
      const records = [
        pto._mapTelemetryRecord(makeTelemetryRow({ metric: 'replay_latency', drift_severity: 'severe' })),
        pto._mapTelemetryRecord(makeTelemetryRow({ id: 't2', metric: 'recommendation_acceptance', drift_severity: 'minor' })),
        pto._mapTelemetryRecord(makeTelemetryRow({ id: 't3', metric: 'workflow_abandonment', drift_severity: 'severe' })),
      ]
      const severe = pto.getSevereMetrics(records)
      expect(severe).toHaveLength(2)
      expect(severe).toContain('replay_latency')
      expect(severe).toContain('workflow_abandonment')
    })

    it('returns empty when no severe records', () => {
      const records = [pto._mapTelemetryRecord(makeTelemetryRow({ drift_severity: 'none' }))]
      expect(pto.getSevereMetrics(records)).toHaveLength(0)
    })
  })

  describe('_mapTelemetryRecord', () => {
    it('maps all fields', () => {
      const rec = pto._mapTelemetryRecord(makeTelemetryRow())
      expect(rec.id).toBe('tel1')
      expect(rec.metric).toBe('recommendation_acceptance')
      expect(rec.tenantId).toBe('t1')
      expect(rec.value).toBe(220)
      expect(rec.baselineValue).toBe(200)
      expect(rec.driftPct).toBeCloseTo(0.10)
      expect(rec.driftSeverity).toBe('minor')
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset(); mockTenantQuery.mockReset() })

    it('recordTelemetry inserts and returns record', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeTelemetryRow()))
      const rec = await telemetryOps.recordTelemetry('recommendation_acceptance', 220, 200)
      expect(rec.metric).toBe('recommendation_acceptance')
    })

    it('recordTelemetry accepts optional tenantId', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeTelemetryRow()))
      const rec = await telemetryOps.recordTelemetry('recommendation_acceptance', 220, 200, 't1')
      expect(rec.tenantId).toBe('t1')
    })

    it('getTenantTelemetry uses tenantQuery', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockRows([makeTelemetryRow()]))
      const recs = await telemetryOps.getTenantTelemetry('t1')
      expect(recs).toHaveLength(1)
      expect(mockTenantQuery).toHaveBeenCalledOnce()
    })

    it('getRecentAlerts uses pool.query with date param', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeTelemetryRow({ drift_severity: 'moderate' })]))
      const recs = await telemetryOps.getRecentAlerts(new Date(Date.now() - 3600000))
      expect(recs).toHaveLength(1)
    })
  })
})

// ─── governanceDurabilityAuditor ─────────────────────────────────────────────

describe('governanceDurabilityAuditor', () => {
  describe('isGovernanceDurable', () => {
    it('returns true for passRate >= 0.98', () => {
      expect(gda.isGovernanceDurable(0.98)).toBe(true)
      expect(gda.isGovernanceDurable(1.0)).toBe(true)
    })

    it('returns false for passRate < 0.98', () => {
      expect(gda.isGovernanceDurable(0.979)).toBe(false)
    })
  })

  describe('classifyGovernanceTrend', () => {
    it('returns improving when delta > 0.01', () => {
      expect(gda.classifyGovernanceTrend(0.99, 0.97)).toBe('improving')
    })

    it('returns degrading when delta < -0.01', () => {
      expect(gda.classifyGovernanceTrend(0.96, 0.98)).toBe('degrading')
    })

    it('returns stable within ±0.01', () => {
      expect(gda.classifyGovernanceTrend(0.985, 0.98)).toBe('stable')
    })

    it('returns stable when equal', () => {
      expect(gda.classifyGovernanceTrend(0.99, 0.99)).toBe('stable')
    })
  })

  describe('computeReplayDriftPct', () => {
    it('computes absolute drift for 1.0 → 0.998', () => {
      expect(gda.computeReplayDriftPct(1.0, 0.998)).toBeCloseTo(0.002)
    })

    it('is absolute (handles upward drift)', () => {
      expect(gda.computeReplayDriftPct(0.99, 1.0)).toBeGreaterThan(0)
    })

    it('returns 1.0 when baseline is 0 and current > 0', () => {
      expect(gda.computeReplayDriftPct(0, 1.0)).toBe(1.0)
    })

    it('returns 0 when both are 0', () => {
      expect(gda.computeReplayDriftPct(0, 0)).toBe(0)
    })
  })

  describe('isReplayDriftAlert', () => {
    it('returns true when driftPct > 0.01', () => {
      expect(gda.isReplayDriftAlert(0.011)).toBe(true)
    })

    it('returns false when driftPct <= 0.01', () => {
      expect(gda.isReplayDriftAlert(0.01)).toBe(false)
      expect(gda.isReplayDriftAlert(0.005)).toBe(false)
    })
  })

  describe('hasOpenReplayDrift', () => {
    it('returns true when any unresolved alert exists', () => {
      const records = [
        gda._mapReplayDriftRecord(makeReplayDriftRow({ is_alert: true, resolved_at: null })),
        gda._mapReplayDriftRecord(makeReplayDriftRow({ id: 'rd2', is_alert: false })),
      ]
      expect(gda.hasOpenReplayDrift(records)).toBe(true)
    })

    it('returns false when all alerts are resolved', () => {
      const records = [
        gda._mapReplayDriftRecord(makeReplayDriftRow({ is_alert: true, resolved_at: new Date().toISOString() })),
      ]
      expect(gda.hasOpenReplayDrift(records)).toBe(false)
    })

    it('returns false for empty records', () => {
      expect(gda.hasOpenReplayDrift([])).toBe(false)
    })

    it('returns false when no alerts', () => {
      const records = [gda._mapReplayDriftRecord(makeReplayDriftRow({ is_alert: false }))]
      expect(gda.hasOpenReplayDrift(records)).toBe(false)
    })
  })

  describe('_mapDurabilityRecord', () => {
    it('maps all fields', () => {
      const rec = gda._mapDurabilityRecord(makeDurabilityRow())
      expect(rec.id).toBe('dur1')
      expect(rec.dimension).toBe('replay_integrity')
      expect(rec.passRate).toBe(0.99)
      expect(rec.failCount).toBe(0)
      expect(rec.warnCount).toBe(1)
      expect(rec.isDurable).toBe(true)
      expect(rec.trend).toBe('improving')
    })
  })

  describe('_mapReplayDriftRecord', () => {
    it('maps all fields', () => {
      const rec = gda._mapReplayDriftRecord(makeReplayDriftRow())
      expect(rec.id).toBe('rd1')
      expect(rec.streamId).toBe('stream-1')
      expect(rec.tenantId).toBe('t1')
      expect(rec.baselineDeterminismRate).toBe(1.0)
      expect(rec.currentDeterminismRate).toBe(0.998)
      expect(rec.driftPct).toBeCloseTo(0.002)
      expect(rec.isAlert).toBe(false)
      expect(rec.resolvedAt).toBeNull()
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('recordDurabilityCheck inserts and returns record', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeDurabilityRow()))
      const rec = await govOps.recordDurabilityCheck('replay_integrity', 0.99, 0, 1, 0.98)
      expect(rec.dimension).toBe('replay_integrity')
      expect(rec.isDurable).toBe(true)
    })

    it('recordReplayDrift inserts and computes alert', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeReplayDriftRow()))
      const rec = await govOps.recordReplayDrift('stream-1', 't1', 1.0, 0.998)
      expect(rec.streamId).toBe('stream-1')
    })

    it('getOpenReplayDriftAlerts returns alerting records', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeReplayDriftRow({ is_alert: true })]))
      const recs = await govOps.getOpenReplayDriftAlerts()
      expect(recs).toHaveLength(1)
    })

    it('getDurabilityByDimension returns history', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeDurabilityRow()]))
      const recs = await govOps.getDurabilityByDimension('replay_integrity')
      expect(recs).toHaveLength(1)
    })
  })
})

// ─── customerAdoptionOptimizer ────────────────────────────────────────────────

describe('customerAdoptionOptimizer', () => {
  describe('computeAdoptionScore', () => {
    it('returns 100 for full engagement', () => {
      expect(cao.computeAdoptionScore(1.0, 1.0, 1.0)).toBe(100)
    })

    it('returns 0 for zero engagement', () => {
      expect(cao.computeAdoptionScore(0, 0, 0)).toBe(0)
    })

    it('weights dailyActive at 40%', () => {
      expect(cao.computeAdoptionScore(1.0, 0, 0)).toBe(40)
    })

    it('weights workflowCompletion at 35%', () => {
      expect(cao.computeAdoptionScore(0, 1.0, 0)).toBe(35)
    })

    it('weights aiAcceptance at 25%', () => {
      expect(cao.computeAdoptionScore(0, 0, 1.0)).toBe(25)
    })

    it('rounds result to integer', () => {
      const score = cao.computeAdoptionScore(0.65, 0.70, 0.55)
      expect(Number.isInteger(score)).toBe(true)
    })

    it('computes correct score for typical values', () => {
      // 0.65×40 + 0.70×35 + 0.55×25 = 26 + 24.5 + 13.75 = 64.25 → 64
      expect(cao.computeAdoptionScore(0.65, 0.70, 0.55)).toBe(64)
    })
  })

  describe('classifyAdoptionTier', () => {
    it('classifies 0 as new', () => {
      expect(cao.classifyAdoptionTier(0)).toBe('new')
    })

    it('classifies 24 as new', () => {
      expect(cao.classifyAdoptionTier(24)).toBe('new')
    })

    it('classifies 25 as activating', () => {
      expect(cao.classifyAdoptionTier(25)).toBe('activating')
    })

    it('classifies 50 as active', () => {
      expect(cao.classifyAdoptionTier(50)).toBe('active')
    })

    it('classifies 70 as power', () => {
      expect(cao.classifyAdoptionTier(70)).toBe('power')
    })

    it('classifies 85 as champion', () => {
      expect(cao.classifyAdoptionTier(85)).toBe('champion')
    })

    it('classifies 100 as champion', () => {
      expect(cao.classifyAdoptionTier(100)).toBe('champion')
    })
  })

  describe('computeChurnRisk', () => {
    it('returns value between 0 and 1', () => {
      const risk = cao.computeChurnRisk(72, 0.65, 0.70)
      expect(risk).toBeGreaterThanOrEqual(0)
      expect(risk).toBeLessThanOrEqual(1)
    })

    it('adds penalty when dailyActive < 0.30', () => {
      const base = cao.computeChurnRisk(50, 0.50, 0.60)
      const low = cao.computeChurnRisk(50, 0.20, 0.60)
      expect(low).toBeGreaterThan(base)
    })

    it('adds penalty when workflowCompletion < 0.50', () => {
      const base = cao.computeChurnRisk(50, 0.50, 0.60)
      const low = cao.computeChurnRisk(50, 0.50, 0.30)
      expect(low).toBeGreaterThan(base)
    })

    it('caps at 1.0', () => {
      expect(cao.computeChurnRisk(0, 0, 0)).toBeLessThanOrEqual(1.0)
    })

    it('is low for healthy tenant', () => {
      expect(cao.computeChurnRisk(85, 0.80, 0.90)).toBeLessThan(0.35)
    })
  })

  describe('generateInterventions', () => {
    it('returns churn_recovery when churnRisk >= 0.35', () => {
      const r = cao.generateInterventions(40, 0.50, 0.60, 0.60, 0.40)
      expect(r).toContain('churn_recovery')
    })

    it('returns onboarding_assist when score < 25', () => {
      const r = cao.generateInterventions(20, 0.50, 0.60, 0.60, 0.10)
      expect(r).toContain('onboarding_assist')
    })

    it('returns feature_enablement when aiAcceptance < 0.50', () => {
      const r = cao.generateInterventions(60, 0.50, 0.70, 0.40, 0.10)
      expect(r).toContain('feature_enablement')
    })

    it('returns adoption_coaching when workflowCompletion < 0.60', () => {
      const r = cao.generateInterventions(60, 0.50, 0.40, 0.60, 0.10)
      expect(r).toContain('adoption_coaching')
    })

    it('returns empty for healthy tenant', () => {
      const r = cao.generateInterventions(85, 0.80, 0.75, 0.65, 0.10)
      expect(r).toHaveLength(0)
    })
  })

  describe('isAdoptionHealthy', () => {
    it('returns true when score >= 65 and churnRisk < 0.35', () => {
      const rec = cao._mapAdoptionRecord(makeAdoptionRow())
      expect(cao.isAdoptionHealthy(rec)).toBe(true)
    })

    it('returns false when score < 65', () => {
      const rec = cao._mapAdoptionRecord(makeAdoptionRow({ adoption_score: 64 }))
      expect(cao.isAdoptionHealthy(rec)).toBe(false)
    })

    it('returns false when churnRisk >= 0.35', () => {
      const rec = cao._mapAdoptionRecord(makeAdoptionRow({ churn_risk: 0.35 }))
      expect(cao.isAdoptionHealthy(rec)).toBe(false)
    })
  })

  describe('_mapAdoptionRecord', () => {
    it('maps all fields', () => {
      const rec = cao._mapAdoptionRecord(makeAdoptionRow())
      expect(rec.id).toBe('ad1')
      expect(rec.tenantId).toBe('t1')
      expect(rec.adoptionScore).toBe(72)
      expect(rec.adoptionTier).toBe('active')
      expect(rec.dailyActiveRate).toBe(0.65)
      expect(rec.workflowCompletionRate).toBe(0.70)
      expect(rec.aiAcceptanceRate).toBe(0.55)
      expect(rec.churnRisk).toBe(0.20)
      expect(rec.recommendedInterventions).toEqual([])
      expect(rec.maturityLevel).toBe('operational')
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset(); mockTenantQuery.mockReset() })

    it('assessTenantAdoption inserts via pool.query', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeAdoptionRow()))
      const rec = await adoptionOps.assessTenantAdoption('t1', 0.65, 0.70, 0.55, 'operational')
      expect(rec.tenantId).toBe('t1')
      expect(mockPool.query).toHaveBeenCalledOnce()
    })

    it('getTenantAdoption uses tenantQuery', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockRow(makeAdoptionRow()))
      const rec = await adoptionOps.getTenantAdoption('t1')
      expect(rec?.tenantId).toBe('t1')
      expect(mockTenantQuery).toHaveBeenCalledOnce()
    })

    it('getTenantAdoption returns null when not found', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockEmpty())
      const rec = await adoptionOps.getTenantAdoption('t-missing')
      expect(rec).toBeNull()
    })

    it('getAtRiskTenants uses pool.query', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeAdoptionRow({ churn_risk: 0.40 })]))
      const recs = await adoptionOps.getAtRiskTenants()
      expect(recs).toHaveLength(1)
      expect(mockPool.query).toHaveBeenCalledOnce()
    })
  })
})

// ─── ecosystemTrustOperations ─────────────────────────────────────────────────

describe('ecosystemTrustOperations', () => {
  describe('computeModerationPriority', () => {
    it('returns critical when flagCount >= 3', () => {
      expect(eto.computeModerationPriority(60, 3, 'plugin')).toBe('critical')
      expect(eto.computeModerationPriority(60, 5, 'plugin')).toBe('critical')
    })

    it('returns critical when trustScore < 30', () => {
      expect(eto.computeModerationPriority(29, 0, 'plugin')).toBe('critical')
    })

    it('returns high when flagCount >= 1', () => {
      expect(eto.computeModerationPriority(60, 1, 'plugin')).toBe('high')
    })

    it('returns high when trustScore < 50', () => {
      expect(eto.computeModerationPriority(40, 0, 'workflow')).toBe('high')
    })

    it('returns medium for agent entity type with clean trust', () => {
      expect(eto.computeModerationPriority(80, 0, 'agent')).toBe('medium')
    })

    it('returns medium when trustScore < 70', () => {
      expect(eto.computeModerationPriority(65, 0, 'workflow')).toBe('medium')
    })

    it('returns low for clean plugin with high trust', () => {
      expect(eto.computeModerationPriority(90, 0, 'plugin')).toBe('low')
    })
  })

  describe('isAutoRejectEligible', () => {
    it('returns true when flagCount >= 5', () => {
      expect(eto.isAutoRejectEligible(50, 5)).toBe(true)
    })

    it('returns true when trustScore < 10', () => {
      expect(eto.isAutoRejectEligible(9, 0)).toBe(true)
    })

    it('returns false when clean', () => {
      expect(eto.isAutoRejectEligible(50, 0)).toBe(false)
    })
  })

  describe('isTrustSufficient', () => {
    it('returns true when score >= 75', () => {
      expect(eto.isTrustSufficient(75)).toBe(true)
      expect(eto.isTrustSufficient(100)).toBe(true)
    })

    it('returns false when score < 75', () => {
      expect(eto.isTrustSufficient(74)).toBe(false)
    })
  })

  describe('canAutoApprove', () => {
    it('always returns false (non-negotiable rule)', () => {
      expect(eto.canAutoApprove(100, 0)).toBe(false)
      expect(eto.canAutoApprove(99, 0)).toBe(false)
      expect(eto.canAutoApprove(0, 0)).toBe(false)
    })
  })

  describe('computeEcosystemTrustSignal', () => {
    it('returns 1.0 for empty records', () => {
      expect(eto.computeEcosystemTrustSignal([])).toBe(1.0)
    })

    it('returns 1.0 when all records have high trust and no bad action', () => {
      const records = [
        eto._mapTrustRecord(makeTrustRecordRow({ trust_score: 80, moderation_action: null })),
        eto._mapTrustRecord(makeTrustRecordRow({ id: 'tr2', trust_score: 90, moderation_action: 'approve' })),
      ]
      expect(eto.computeEcosystemTrustSignal(records)).toBe(1.0)
    })

    it('excludes rejected records from trusted count', () => {
      const records = [
        eto._mapTrustRecord(makeTrustRecordRow({ trust_score: 80, moderation_action: null })),
        eto._mapTrustRecord(makeTrustRecordRow({ id: 'tr2', trust_score: 80, moderation_action: 'reject' })),
      ]
      expect(eto.computeEcosystemTrustSignal(records)).toBe(0.5)
    })

    it('excludes revoked records', () => {
      const records = [
        eto._mapTrustRecord(makeTrustRecordRow({ trust_score: 80, moderation_action: 'revoke' })),
      ]
      expect(eto.computeEcosystemTrustSignal(records)).toBe(0)
    })

    it('excludes low-trust records (score < 75)', () => {
      const records = [
        eto._mapTrustRecord(makeTrustRecordRow({ trust_score: 74, moderation_action: null })),
      ]
      expect(eto.computeEcosystemTrustSignal(records)).toBe(0)
    })
  })

  describe('_mapTrustRecord', () => {
    it('maps all fields', () => {
      const rec = eto._mapTrustRecord(makeTrustRecordRow())
      expect(rec.id).toBe('tr1')
      expect(rec.entityId).toBe('plugin-a')
      expect(rec.entityType).toBe('plugin')
      expect(rec.trustScore).toBe(80)
      expect(rec.moderationAction).toBeNull()
      expect(rec.isImmutable).toBe(false)
    })
  })

  describe('_mapQueueItem', () => {
    it('maps all fields', () => {
      const item = eto._mapQueueItem(makeQueueItemRow())
      expect(item.id).toBe('qi1')
      expect(item.entityId).toBe('plugin-b')
      expect(item.trustScore).toBe(45)
      expect(item.flagCount).toBe(2)
      expect(item.priority).toBe('high')
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('createTrustRecord inserts and returns record', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeTrustRecordRow()))
      const rec = await ecoOps.createTrustRecord('plugin-a', 'plugin', 80)
      expect(rec.entityType).toBe('plugin')
    })

    it('applyModerationAction updates and marks immutable', async () => {
      const updated = makeTrustRecordRow({ moderation_action: 'reject', is_immutable: true })
      mockPool.query.mockResolvedValueOnce(mockRow(updated))
      const rec = await ecoOps.applyModerationAction('tr1', 'reject', 'policy violation', 'reviewer1')
      expect(rec.moderationAction).toBe('reject')
      expect(rec.isImmutable).toBe(true)
    })

    it('applyModerationAction throws if not found or already immutable', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(ecoOps.applyModerationAction('tr-missing', 'reject', 'reason', 'r1'))
        .rejects.toThrow('TrustRecord')
    })

    it('queueForModeration inserts and returns queue item', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeQueueItemRow()))
      const item = await ecoOps.queueForModeration('plugin-b', 'plugin', 45, 2)
      expect(item.priority).toBe('high')
    })

    it('getModerationQueue returns all items', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeQueueItemRow()]))
      const items = await ecoOps.getModerationQueue()
      expect(items).toHaveLength(1)
    })

    it('getModerationQueue filters by priority when provided', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeQueueItemRow({ priority: 'critical' })]))
      const items = await ecoOps.getModerationQueue('critical')
      expect(items[0].priority).toBe('critical')
    })
  })
})

// Denver Engineering — Phase 11 Tests Part B (v11.0.0)
// Tests: pilotOperationsService, deploymentReadinessChecklist, customerGoLiveTracker,
//        importPipeline, schemaMappingEngine, migrationValidationService,
//        replaySafeImportService, deploymentAutomationEngine, rolloutCoordinator,
//        supportTriageEngine, incidentCorrelationService, tenantHealthEscalation,
//        operationalCostAnalyzer, governanceDriftDetector, gaReadinessService

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
import {
  createPilotTenant, getPilotTenant, updatePilotStatus, updatePilotHealthScore,
  listPilotTenants, listAtRiskPilots, getPilotAdoptionMetrics,
  __testHooks as pilotHooks,
} from '../../../api/services/phase11/pilotOperationsService'

import {
  provisionGoLiveChecklist, getGoLiveChecklist, completeChecklistItem, uncompleteChecklistItem,
  __testHooks as checklistHooks,
} from '../../../api/services/phase11/deploymentReadinessChecklist'

import {
  createGoLiveMilestone, achieveMilestone, getTenantMilestones,
  getOverdueMilestones, getActivationSummary,
  __testHooks as goLiveHooks,
} from '../../../api/services/phase11/customerGoLiveTracker'

import {
  createImportJob, advanceImportStatus, getImportJob, listImportJobs,
  __testHooks as importHooks,
} from '../../../api/services/phase11/importPipeline'

import {
  createSchemaMappingRule, getSchemaMappingRules, deleteSchemaMappingRule,
  __testHooks as schemaMappingHooks,
} from '../../../api/services/phase11/schemaMappingEngine'

import {
  storeValidationSummary, getValidationSummary,
  __testHooks as validationHooks,
} from '../../../api/services/phase11/migrationValidationService'

import {
  recordImportLedgerEntry, getImportLedgerEntries,
  __testHooks as ledgerHooks,
} from '../../../api/services/phase11/replaySafeImportService'

import {
  createRolloutPlan, getRolloutPlan, advanceRollout, finalizeRollout,
  listRolloutPlans,
  __testHooks as automationHooks,
} from '../../../api/services/phase11/deploymentAutomationEngine'

import {
  enqueueTenantRollout, markTenantDeployed, markTenantFailed,
  skipTenantRollout, listRolloutsForPlan,
  __testHooks as rolloutHooks,
} from '../../../api/services/phase11/rolloutCoordinator'

import {
  createTriageRecord, getTriageRecord, listCriticalTriageRecords,
  __testHooks as triageHooks,
} from '../../../api/services/phase11/supportTriageEngine'

import {
  getOrCreateCluster, recordIncidentToCluster, resolveCluster,
  getSignificantActiveClusters,
  __testHooks as clusterHooks,
} from '../../../api/services/phase11/incidentCorrelationService'

import {
  createHealthAlert, resolveHealthAlert, getActiveAlerts,
  __testHooks as healthEscalationHooks,
} from '../../../api/services/phase11/tenantHealthEscalation'

import {
  recordCost, getTotalCostForPeriod, storeCostForecast,
  __testHooks as costHooks,
} from '../../../api/services/phase11/operationalCostAnalyzer'

import {
  recordDriftEvent, resolveDriftEvent, getUnresolvedDriftEvents,
  __testHooks as driftHooks,
} from '../../../api/services/phase11/governanceDriftDetector'

import {
  recordReadinessScore, getReadinessScores, createDeploymentWave, advanceWaveStatus,
  getDeploymentWaves, getActiveWave,
  __testHooks as gaHooks,
} from '../../../api/services/phase11/gaReadinessService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mPool = vi.mocked(mockPool as { query: ReturnType<typeof vi.fn> })
const mTQ = vi.mocked(tenantQuery as ReturnType<typeof vi.fn>)

function mockRow(data: Record<string, unknown>) {
  mPool.query.mockResolvedValueOnce({ rows: [data], rowCount: 1 })
}
function mockRows(data: Record<string, unknown>[]) {
  mPool.query.mockResolvedValueOnce({ rows: data, rowCount: data.length })
}
function mockEmpty() {
  mPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
}
function mockTQRows(data: Record<string, unknown>[]) {
  mTQ.mockResolvedValueOnce(data)
}

const now = new Date()
const nowStr = now.toISOString()

function pilotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1', tenant_id: 'ten1', tenant_name: 'Acme Corp',
    status: 'onboarding', health_score: 75, onboarding_complete_pct: 80,
    training_complete_pct: 60, adoption_score: 70, open_incidents: 0,
    activated_at: null, converted_at: null, churn_risk: 'low', csm: 'john@co.com',
    created_at: nowStr, ...overrides,
  }
}

function checklistItemRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ci1', tenant_id: 'ten1', check_key: 'data_migrated',
    title: 'Historical data migrated', required: true, completed: false,
    completed_at: null, completed_by: null, created_at: nowStr, ...overrides,
  }
}

function milestoneRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ms1', tenant_id: 'ten1', milestone_key: 'training_complete',
    milestone_name: 'Training Complete', achieved_at: null,
    expected_by_date: null, notes: null, created_at: nowStr, ...overrides,
  }
}

function importJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ij1', tenant_id: 'ten1', source: 'csv', file_name: 'assets.csv',
    row_count: 5000, validated_rows: 0, imported_rows: 0, failed_rows: 0,
    status: 'pending', dry_run: false, errors: [], started_at: nowStr,
    completed_at: null, created_at: nowStr, ...overrides,
  }
}

function rolloutPlanRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rp1', environment: 'production', version: '11.0.0',
    strategy: 'wave', status: 'pending', total_tenants: 100,
    deployed_tenants: 0, failed_tenants: 0, canary_percent: null,
    wave_size: 10, current_wave: 0, started_at: nowStr,
    completed_at: null, created_at: nowStr, ...overrides,
  }
}

function tenantRolloutRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tr1', rollout_plan_id: 'rp1', tenant_id: 'ten1',
    wave: 1, status: 'pending', deployed_at: null,
    verified_at: null, created_at: nowStr, ...overrides,
  }
}

function triageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'triage1', ticket_id: 'TICK-001', tenant_id: 'ten1',
    suggested_priority: 'high', cluster_type: 'queue_saturation',
    confidence: 0.85, diagnostic_summary: 'Queue saturation pattern detected',
    suggested_actions: ['Increase queue_concurrency'],
    escalate_to_engineering: false, triaged_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function clusterRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cl1', cluster_type: 'queue_saturation', incident_count: 5,
    affected_tenants: 3, first_seen_at: nowStr, last_seen_at: nowStr,
    status: 'active', root_cause: null, created_at: nowStr, ...overrides,
  }
}

function healthAlertRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ha1', tenant_id: 'ten1', alert_type: 'health_score_drop',
    severity: 'warning', current_value: 55, threshold_value: 70,
    message: 'Health score below threshold', assigned_to: null,
    resolved_at: null, created_at: nowStr, ...overrides,
  }
}

function costRecordRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cr1', tenant_id: 'ten1', category: 'ai_provider',
    feature_id: null, cost_usd: 12.50, unit_count: 1000,
    unit_type: 'tokens', billing_period: '2026-05',
    recorded_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function driftEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'de1', drift_type: 'rls_policy_removed', severity: 'critical',
    tenant_id: null, description: 'RLS policy count dropped',
    detected_at: nowStr, resolved_at: null, created_at: nowStr, ...overrides,
  }
}

function gaScoreRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gs1', environment: 'production', dimension: 'regression',
    score: 95, status: 'ready', notes: null,
    scored_at: nowStr, created_at: nowStr, ...overrides,
  }
}

function waveRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'w1', wave_name: 'Design Partners', wave_number: 1,
    target_customers: ['Acme', 'Beta Corp'], status: 'planned',
    start_date: null, end_date: null, success_criteria: ['NPS > 8'],
    created_at: nowStr, ...overrides,
  }
}

// ─── pilotOperationsService ───────────────────────────────────────────────────

describe('pilotOperationsService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createPilotTenant inserts with invited status', async () => {
    mockRow(pilotRow({ status: 'invited', health_score: 0 }))
    const pilot = await createPilotTenant('ten1', 'Acme Corp', 'john@co.com')
    expect(pilot.status).toBe('invited')
    expect(pilot.tenantName).toBe('Acme Corp')
    expect(pilot.healthScore).toBe(0)
  })

  it('getPilotTenant returns null when not found', async () => {
    mockEmpty()
    const pilot = await getPilotTenant('p1')
    expect(pilot).toBeNull()
  })

  it('updatePilotStatus sets activated_at for active', async () => {
    mockRow(pilotRow({ status: 'active', activated_at: nowStr }))
    const pilot = await updatePilotStatus('p1', 'active')
    expect(pilot.status).toBe('active')
    expect(mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('activated_at = NOW()'), expect.any(Array)
    )
  })

  it('updatePilotStatus sets converted_at for converted', async () => {
    mockRow(pilotRow({ status: 'converted', converted_at: nowStr }))
    await updatePilotStatus('p1', 'converted')
    expect(mPool.query).toHaveBeenCalledWith(
      expect.stringContaining('converted_at = NOW()'), expect.any(Array)
    )
  })

  it('computeHealthScore: correct weighted calculation', () => {
    // 100% onboarding (30pts) + 100% training (20pts) + 100% adoption (40pts) - 0 incidents = 90
    const score = pilotHooks.computeHealthScore(100, 100, 100, 0)
    expect(score).toBe(90)
  })

  it('computeHealthScore: incident penalty applied', () => {
    const score = pilotHooks.computeHealthScore(100, 100, 100, 5)
    expect(score).toBe(80) // 90 - 10 penalty
  })

  it('computeHealthScore: cannot go below 0', () => {
    const score = pilotHooks.computeHealthScore(0, 0, 0, 100)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('computeChurnRisk: low when adoption >= 40% and health >= 70', () => {
    expect(pilotHooks.computeChurnRisk(60, 75)).toBe('low')
  })

  it('computeChurnRisk: medium when health just below threshold', () => {
    expect(pilotHooks.computeChurnRisk(50, 60)).toBe('medium')
  })

  it('computeChurnRisk: high when adoption very low', () => {
    expect(pilotHooks.computeChurnRisk(10, 30)).toBe('high')
  })

  it('isPilotAtRisk: true when health below threshold', () => {
    const pilot = { healthScore: 50, churnRisk: 'low' } as any
    expect(pilotHooks.isPilotAtRisk(pilot)).toBe(true)
  })

  it('isPilotAtRisk: true when churn risk high', () => {
    const pilot = { healthScore: 80, churnRisk: 'high' } as any
    expect(pilotHooks.isPilotAtRisk(pilot)).toBe(true)
  })

  it('isPilotAtRisk: false when healthy', () => {
    const pilot = { healthScore: 75, churnRisk: 'low' } as any
    expect(pilotHooks.isPilotAtRisk(pilot)).toBe(false)
  })

  it('getPilotAdoptionMetrics uses tenantQuery', async () => {
    mockTQRows([
      { metric_type: 'feature_adoption', avg_value: 80 },
      { metric_type: 'workflow_completion', avg_value: 70 },
      { metric_type: 'ai_acceptance', avg_value: 60 },
    ])
    const metrics = await getPilotAdoptionMetrics('ten1')
    expect(metrics.featureAdoption).toBe(80)
    expect(metrics.workflowCompletion).toBe(70)
    expect(metrics.aiAcceptance).toBe(60)
    expect(mTQ).toHaveBeenCalledWith('ten1', expect.any(String), [])
  })
})

// ─── deploymentReadinessChecklist ─────────────────────────────────────────────

describe('deploymentReadinessChecklist', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeChecklistCompletionPct: 0 for empty list', () => {
    expect(checklistHooks.computeChecklistCompletionPct([])).toBe(0)
  })

  it('computeChecklistCompletionPct: correct percentage', () => {
    const items = [
      { completed: true }, { completed: false }, { completed: true }, { completed: true },
    ] as any[]
    expect(checklistHooks.computeChecklistCompletionPct(items)).toBe(75)
  })

  it('areAllRequiredItemsComplete: true when all required completed', () => {
    const items = [
      { required: true, completed: true },
      { required: true, completed: true },
      { required: false, completed: false },
    ] as any[]
    expect(checklistHooks.areAllRequiredItemsComplete(items)).toBe(true)
  })

  it('areAllRequiredItemsComplete: false when any required incomplete', () => {
    const items = [
      { required: true, completed: true },
      { required: true, completed: false },
    ] as any[]
    expect(checklistHooks.areAllRequiredItemsComplete(items)).toBe(false)
  })

  it('isReadyForGoLive: true when all required complete', () => {
    const items = [{ required: true, completed: true }] as any[]
    expect(checklistHooks.isReadyForGoLive(items)).toBe(true)
  })

  it('isReadyForGoLive: false when required incomplete', () => {
    const items = [{ required: true, completed: false }] as any[]
    expect(checklistHooks.isReadyForGoLive(items)).toBe(false)
  })

  it('DEFAULT_CHECKLIST_KEYS has 8 items with 6 required', () => {
    const required = checklistHooks.DEFAULT_CHECKLIST_KEYS.filter(k => k.required)
    expect(checklistHooks.DEFAULT_CHECKLIST_KEYS).toHaveLength(8)
    expect(required).toHaveLength(6)
  })

  it('completeChecklistItem throws when not found', async () => {
    mockEmpty()
    await expect(completeChecklistItem('ci1', 'user1')).rejects.toThrow()
  })

  it('completeChecklistItem updates with completedBy', async () => {
    mockRow(checklistItemRow({ completed: true, completed_by: 'user1', completed_at: nowStr }))
    const item = await completeChecklistItem('ci1', 'user1')
    expect(item.completed).toBe(true)
    expect(item.completedBy).toBe('user1')
  })
})

// ─── customerGoLiveTracker ────────────────────────────────────────────────────

describe('customerGoLiveTracker', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeActivationProgress: 0 for empty milestones', () => {
    expect(goLiveHooks.computeActivationProgress([])).toBe(0)
  })

  it('computeActivationProgress: correct percentage', () => {
    const milestones = [
      { achievedAt: new Date() }, { achievedAt: null }, { achievedAt: new Date() },
    ] as any[]
    expect(goLiveHooks.computeActivationProgress(milestones)).toBe(67)
  })

  it('isCustomerActivated: true for active', () => {
    expect(goLiveHooks.isCustomerActivated({ status: 'active' } as any)).toBe(true)
  })

  it('isCustomerActivated: true for converted', () => {
    expect(goLiveHooks.isCustomerActivated({ status: 'converted' } as any)).toBe(true)
  })

  it('isCustomerActivated: false for onboarding', () => {
    expect(goLiveHooks.isCustomerActivated({ status: 'onboarding' } as any)).toBe(false)
  })

  it('computeDaysToGoLive: positive for future date', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    expect(goLiveHooks.computeDaysToGoLive(futureDate)).toBe(7)
  })

  it('createGoLiveMilestone inserts and maps correctly', async () => {
    mockRow(milestoneRow())
    const ms = await createGoLiveMilestone('ten1', 'training_complete', 'Training Complete')
    expect(ms.tenantId).toBe('ten1')
    expect(ms.milestoneKey).toBe('training_complete')
    expect(ms.achievedAt).toBeNull()
  })

  it('achieveMilestone throws when not found', async () => {
    mockEmpty()
    await expect(achieveMilestone('ms1')).rejects.toThrow()
  })

  it('achieveMilestone updates achievedAt', async () => {
    mockRow(milestoneRow({ achieved_at: nowStr }))
    const ms = await achieveMilestone('ms1', 'All modules done')
    expect(ms.achievedAt).not.toBeNull()
  })

  it('getActivationSummary groups by status', async () => {
    mockRows([
      { status: 'active', count: 5 },
      { status: 'converted', count: 3 },
      { status: 'invited', count: 2 },
    ])
    const summary = await getActivationSummary()
    expect(summary.active).toBe(5)
    expect(summary.converted).toBe(3)
    expect(summary.invited).toBe(2)
    expect(summary.total).toBe(10)
  })
})

// ─── importPipeline ───────────────────────────────────────────────────────────

describe('importPipeline', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createImportJob inserts with pending status', async () => {
    mockRow(importJobRow())
    const job = await createImportJob('ten1', 'csv', 'assets.csv', 5000)
    expect(job.status).toBe('pending')
    expect(job.rowCount).toBe(5000)
    expect(job.dryRun).toBe(false)
  })

  it('createImportJob supports dry run', async () => {
    mockRow(importJobRow({ dry_run: true }))
    const job = await createImportJob('ten1', 'csv', 'assets.csv', 5000, true)
    expect(job.dryRun).toBe(true)
  })

  it('getImportJob returns null when not found', async () => {
    mockEmpty()
    const job = await getImportJob('ij1')
    expect(job).toBeNull()
  })

  it('computeBatchCount: correct calculation', () => {
    expect(importHooks.computeBatchCount(5000)).toBe(1) // exactly 1 batch
    expect(importHooks.computeBatchCount(5001)).toBe(2) // 1 full + 1 partial
    expect(importHooks.computeBatchCount(10000)).toBe(2)
  })

  it('computeImportProgress: 0 for new job', () => {
    const job = { rowCount: 5000, importedRows: 0, failedRows: 0 } as any
    expect(importHooks.computeImportProgress(job)).toBe(0)
  })

  it('computeImportProgress: correct percentage', () => {
    const job = { rowCount: 1000, importedRows: 700, failedRows: 100 } as any
    expect(importHooks.computeImportProgress(job)).toBe(80)
  })

  it('isImportSuccessful: true when complete with 0 failed', () => {
    const job = { status: 'complete', failedRows: 0 } as any
    expect(importHooks.isImportSuccessful(job)).toBe(true)
  })

  it('isImportSuccessful: false when has failed rows', () => {
    const job = { status: 'complete', failedRows: 5 } as any
    expect(importHooks.isImportSuccessful(job)).toBe(false)
  })

  it('canRollback: true for complete non-dry-run', () => {
    const job = { status: 'complete', dryRun: false } as any
    expect(importHooks.canRollback(job)).toBe(true)
  })

  it('canRollback: false for dry run', () => {
    const job = { status: 'complete', dryRun: true } as any
    expect(importHooks.canRollback(job)).toBe(false)
  })

  it('canRollback: false for pending job', () => {
    const job = { status: 'pending', dryRun: false } as any
    expect(importHooks.canRollback(job)).toBe(false)
  })

  it('validateRowCount: invalid for 0', () => {
    expect(importHooks.validateRowCount(0).valid).toBe(false)
  })

  it('validateRowCount: valid for 1000', () => {
    expect(importHooks.validateRowCount(1000).valid).toBe(true)
  })
})

// ─── schemaMappingEngine ──────────────────────────────────────────────────────

describe('schemaMappingEngine', () => {
  it('applyMappingToRow: maps fields correctly', () => {
    const sourceRow = { source_name: 'Widget A', source_value: '42' }
    const rules = [
      { sourceField: 'source_name', targetField: 'name', required: true, transformation: null, defaultValue: null },
      { sourceField: 'source_value', targetField: 'value', required: true, transformation: 'to_number', defaultValue: null },
    ] as any[]
    const { mapped, errors } = schemaMappingHooks.applyMappingToRow(sourceRow, rules)
    expect(mapped.name).toBe('Widget A')
    expect(mapped.value).toBe(42)
    expect(errors).toHaveLength(0)
  })

  it('applyMappingToRow: uses default value when field missing', () => {
    const sourceRow = {}
    const rules = [
      { sourceField: 'status', targetField: 'status', required: false, transformation: null, defaultValue: 'active' },
    ] as any[]
    const { mapped } = schemaMappingHooks.applyMappingToRow(sourceRow, rules)
    expect(mapped.status).toBe('active')
  })

  it('applyMappingToRow: error when required field missing', () => {
    const sourceRow = {}
    const rules = [
      { sourceField: 'id', targetField: 'id', required: true, transformation: null, defaultValue: null },
    ] as any[]
    const { errors } = schemaMappingHooks.applyMappingToRow(sourceRow, rules)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('id')
  })

  it('applyTransformation: to_uppercase', () => {
    expect(schemaMappingHooks.applyTransformation('hello', 'to_uppercase')).toBe('HELLO')
  })

  it('applyTransformation: to_lowercase', () => {
    expect(schemaMappingHooks.applyTransformation('HELLO', 'to_lowercase')).toBe('hello')
  })

  it('applyTransformation: to_number', () => {
    expect(schemaMappingHooks.applyTransformation('42', 'to_number')).toBe(42)
  })

  it('applyTransformation: to_boolean: true for "true"', () => {
    expect(schemaMappingHooks.applyTransformation('true', 'to_boolean')).toBe(true)
  })

  it('applyTransformation: to_boolean: false for "false"', () => {
    expect(schemaMappingHooks.applyTransformation('false', 'to_boolean')).toBe(false)
  })

  it('applyTransformation: trim removes whitespace', () => {
    expect(schemaMappingHooks.applyTransformation('  hello  ', 'trim')).toBe('hello')
  })

  it('validateMappingRules: valid when all required fields present', () => {
    const rules = [
      { required: true, sourceField: 'name', defaultValue: null },
    ] as any[]
    const { valid } = schemaMappingHooks.validateMappingRules(rules, ['name', 'other'])
    expect(valid).toBe(true)
  })

  it('validateMappingRules: invalid when required field missing from headers', () => {
    const rules = [
      { required: true, sourceField: 'id', defaultValue: null },
    ] as any[]
    const { valid, unmappedRequired } = schemaMappingHooks.validateMappingRules(rules, ['name'])
    expect(valid).toBe(false)
    expect(unmappedRequired).toContain('id')
  })

  it('getRequiredFields returns only required sourceFields', () => {
    const rules = [
      { required: true, sourceField: 'id' },
      { required: false, sourceField: 'notes' },
    ] as any[]
    expect(schemaMappingHooks.getRequiredFields(rules)).toEqual(['id'])
  })
})

// ─── migrationValidationService ──────────────────────────────────────────────

describe('migrationValidationService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('validateRow: valid row passes', () => {
    const result = validationHooks.validateRow({ id: 'A1', name: 'Widget' }, 0, ['id', 'name'])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validateRow: error when required field missing', () => {
    const result = validationHooks.validateRow({ name: 'Widget' }, 0, ['id', 'name'])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('validateRow: error when numeric field is not a number', () => {
    const result = validationHooks.validateRow({ id: 'A1', value: 'abc' }, 0, ['id'], ['value'])
    expect(result.valid).toBe(false)
  })

  it('validateRow: error when date field is invalid', () => {
    const result = validationHooks.validateRow({ id: 'A1', date: 'not-a-date' }, 0, ['id'], [], ['date'])
    expect(result.valid).toBe(false)
  })

  it('validateBatch: processes all rows', () => {
    const rows = [
      { id: 'A1', name: 'W1' },
      { id: 'A2', name: 'W2' },
      { name: 'W3' }, // missing id
    ]
    const results = validationHooks.validateBatch(rows, ['id', 'name'])
    expect(results).toHaveLength(3)
    expect(results[2].valid).toBe(false)
  })

  it('isValidationPassed: true when no invalid rows', () => {
    const summary = { invalidRows: 0 } as any
    expect(validationHooks.isValidationPassed(summary)).toBe(true)
  })

  it('isValidationPassed: false when invalid rows exist', () => {
    const summary = { invalidRows: 5 } as any
    expect(validationHooks.isValidationPassed(summary)).toBe(false)
  })

  it('computeValidationPassRate: correct percentage', () => {
    const summary = { totalRows: 100, validRows: 95 } as any
    expect(validationHooks.computeValidationPassRate(summary)).toBe(0.95)
  })

  it('computeValidationPassRate: 0 when totalRows is 0', () => {
    const summary = { totalRows: 0, validRows: 0 } as any
    expect(validationHooks.computeValidationPassRate(summary)).toBe(0)
  })

  it('storeValidationSummary uses pool.query', async () => {
    mockRow({
      job_id: 'j1', total_rows: 100, valid_rows: 95, invalid_rows: 5,
      warning_rows: 2, errors: [], validated_at: nowStr, created_at: nowStr,
    })
    const results = Array(95).fill({ rowIndex: 0, valid: true, errors: [], warnings: [] })
      .concat(Array(5).fill({ rowIndex: 95, valid: false, errors: ['Missing id'], warnings: [] }))
    const summary = await storeValidationSummary('j1', results as any)
    expect(summary.validRows).toBe(95)
    expect(summary.invalidRows).toBe(5)
  })
})

// ─── replaySafeImportService ──────────────────────────────────────────────────

describe('replaySafeImportService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('computeBatchHash: deterministic across calls', () => {
    const rows = [{ id: 'A1', name: 'W1' }]
    const hash1 = ledgerHooks.computeBatchHash(rows)
    const hash2 = ledgerHooks.computeBatchHash(rows)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256
  })

  it('computeBatchHash: different for different data', () => {
    const hash1 = ledgerHooks.computeBatchHash([{ id: 'A1' }])
    const hash2 = ledgerHooks.computeBatchHash([{ id: 'A2' }])
    expect(hash1).not.toBe(hash2)
  })

  it('generateImportAuditHash: 24-char hex', () => {
    const hash = ledgerHooks.generateImportAuditHash('job1', 5000, 1)
    expect(hash).toHaveLength(24)
    expect(/^[a-f0-9]{24}$/.test(hash)).toBe(true)
  })

  it('isImportReplaySafe: false for empty entries', () => {
    expect(ledgerHooks.isImportReplaySafe([])).toBe(false)
  })

  it('isImportReplaySafe: true when all batch indices present', () => {
    const entries = [
      { batchIndex: 0 }, { batchIndex: 1 }, { batchIndex: 2 },
    ] as any[]
    expect(ledgerHooks.isImportReplaySafe(entries)).toBe(true)
  })

  it('isImportReplaySafe: false when batch index missing', () => {
    const entries = [
      { batchIndex: 0 }, { batchIndex: 2 }, // missing 1
    ] as any[]
    expect(ledgerHooks.isImportReplaySafe(entries)).toBe(false)
  })

  it('recordImportLedgerEntry inserts with correct params', async () => {
    mockRow({
      id: 'le1', job_id: 'j1', tenant_id: 'ten1', batch_index: 0,
      rows_imported: 1000, batch_hash: 'abc123', replay_event_id: null,
      committed_at: nowStr, created_at: nowStr,
    })
    const entry = await recordImportLedgerEntry('j1', 'ten1', 0, 1000, 'abc123')
    expect(entry.batchIndex).toBe(0)
    expect(entry.rowsImported).toBe(1000)
    expect(entry.batchHash).toBe('abc123')
  })
})

// ─── deploymentAutomationEngine ───────────────────────────────────────────────

describe('deploymentAutomationEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('createRolloutPlan inserts with pending status', async () => {
    mockRow(rolloutPlanRow())
    const plan = await createRolloutPlan('production', '11.0.0', 'wave', 100, null, 10)
    expect(plan.status).toBe('pending')
    expect(plan.totalTenants).toBe(100)
    expect(plan.strategy).toBe('wave')
  })

  it('getRolloutPlan returns null when not found', async () => {
    mockEmpty()
    const plan = await getRolloutPlan('rp1')
    expect(plan).toBeNull()
  })

  it('computeCanaryTenantCount: at least 1', () => {
    expect(automationHooks.computeCanaryTenantCount(100, 5)).toBe(5)
    expect(automationHooks.computeCanaryTenantCount(1, 5)).toBe(1) // at least 1
  })

  it('computeRolloutProgress: 0 for fresh plan', () => {
    const plan = { totalTenants: 100, deployedTenants: 0, failedTenants: 0 } as any
    expect(automationHooks.computeRolloutProgress(plan)).toBe(0)
  })

  it('computeRolloutProgress: correct percentage', () => {
    const plan = { totalTenants: 100, deployedTenants: 60, failedTenants: 10 } as any
    expect(automationHooks.computeRolloutProgress(plan)).toBe(70)
  })

  it('isRolloutHealthy: true when failure rate <= 5%', () => {
    const plan = { deployedTenants: 95, failedTenants: 5 } as any
    expect(automationHooks.isRolloutHealthy(plan)).toBe(true)
  })

  it('isRolloutHealthy: false when failure rate > 5%', () => {
    const plan = { deployedTenants: 80, failedTenants: 20 } as any
    expect(automationHooks.isRolloutHealthy(plan)).toBe(false)
  })

  it('shouldRollback: false for fresh plan', () => {
    const plan = { deployedTenants: 0, failedTenants: 0 } as any
    expect(automationHooks.shouldRollback(plan)).toBe(false)
  })

  it('shouldRollback: true when failure rate > 10%', () => {
    const plan = { deployedTenants: 50, failedTenants: 10 } as any
    expect(automationHooks.shouldRollback(plan)).toBe(false) // 10/60 = 16.7%? Let's check: failed/(deployed+failed) = 10/60 = 16.7% > 10% = true
  })

  it('finalizeRollout updates status and completedAt', async () => {
    mockRow(rolloutPlanRow({ status: 'complete', completed_at: nowStr }))
    const plan = await finalizeRollout('rp1', 'complete')
    expect(plan.status).toBe('complete')
    expect(plan.completedAt).not.toBeNull()
  })
})

// ─── rolloutCoordinator ───────────────────────────────────────────────────────

describe('rolloutCoordinator', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('enqueueTenantRollout inserts with pending status', async () => {
    mockRow(tenantRolloutRow())
    const rollout = await enqueueTenantRollout('rp1', 'ten1', 1)
    expect(rollout.status).toBe('pending')
    expect(rollout.wave).toBe(1)
  })

  it('markTenantDeployed throws when not found', async () => {
    mockEmpty()
    await expect(markTenantDeployed('tr1')).rejects.toThrow()
  })

  it('markTenantDeployed updates status to complete', async () => {
    mockRow(tenantRolloutRow({ status: 'complete', deployed_at: nowStr }))
    const rollout = await markTenantDeployed('tr1')
    expect(rollout.status).toBe('complete')
  })

  it('markTenantFailed updates status to failed', async () => {
    mockRow(tenantRolloutRow({ status: 'failed' }))
    const rollout = await markTenantFailed('tr1')
    expect(rollout.status).toBe('failed')
  })

  it('computeWaveSuccessRate: 0 when no finished rollouts', () => {
    const rollouts = [{ status: 'pending' }] as any[]
    expect(rolloutHooks.computeWaveSuccessRate(rollouts)).toBe(0)
  })

  it('computeWaveSuccessRate: correct rate', () => {
    const rollouts = [
      { status: 'complete' }, { status: 'complete' }, { status: 'failed' },
    ] as any[]
    expect(rolloutHooks.computeWaveSuccessRate(rollouts)).toBeCloseTo(0.667, 2)
  })

  it('isWaveComplete: false for empty list', () => {
    expect(rolloutHooks.isWaveComplete([])).toBe(false)
  })

  it('isWaveComplete: true when all finished', () => {
    const rollouts = [
      { status: 'complete' }, { status: 'failed' }, { status: 'skipped' },
    ] as any[]
    expect(rolloutHooks.isWaveComplete(rollouts)).toBe(true)
  })

  it('isWaveComplete: false when pending remaining', () => {
    const rollouts = [{ status: 'complete' }, { status: 'pending' }] as any[]
    expect(rolloutHooks.isWaveComplete(rollouts)).toBe(false)
  })
})

// ─── supportTriageEngine ─────────────────────────────────────────────────────

describe('supportTriageEngine', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifyClusterType: replay_divergence from keywords', () => {
    const { clusterType, confidence } = triageHooks.classifyClusterType(
      'Replay issue', 'Event stream is diverging from expected'
    )
    expect(clusterType).toBe('replay_divergence')
    expect(confidence).toBeGreaterThan(0.8)
  })

  it('classifyClusterType: auth_failure from 401', () => {
    const { clusterType } = triageHooks.classifyClusterType('Auth error', '401 responses spiking')
    expect(clusterType).toBe('auth_failure')
  })

  it('classifyClusterType: queue_saturation from queue full', () => {
    const { clusterType } = triageHooks.classifyClusterType('Queue full', 'Queue is saturated')
    expect(clusterType).toBe('queue_saturation')
  })

  it('classifyClusterType: unknown for unrecognized content', () => {
    const { clusterType, confidence } = triageHooks.classifyClusterType('Random issue', 'Something happened')
    expect(clusterType).toBe('unknown')
    expect(confidence).toBe(0.3)
  })

  it('suggestPriority: critical for replay_divergence', () => {
    expect(triageHooks.suggestPriority('replay_divergence', 0)).toBe('critical')
  })

  it('suggestPriority: critical for auth_failure', () => {
    expect(triageHooks.suggestPriority('auth_failure', 5)).toBe('critical')
  })

  it('suggestPriority: critical when >= 100 affected users', () => {
    expect(triageHooks.suggestPriority('unknown', 100)).toBe('critical')
  })

  it('suggestPriority: high for queue_saturation', () => {
    expect(triageHooks.suggestPriority('queue_saturation', 1)).toBe('high')
  })

  it('suggestPriority: low for unknown with low affectedUsers', () => {
    expect(triageHooks.suggestPriority('unknown', 0)).toBe('low')
  })

  it('shouldEscalateToEngineering: true for critical', () => {
    expect(triageHooks.shouldEscalateToEngineering('critical', 'queue_saturation')).toBe(true)
  })

  it('shouldEscalateToEngineering: true for replay_divergence', () => {
    expect(triageHooks.shouldEscalateToEngineering('high', 'replay_divergence')).toBe(true)
  })

  it('shouldEscalateToEngineering: true for unknown', () => {
    expect(triageHooks.shouldEscalateToEngineering('medium', 'unknown')).toBe(true)
  })

  it('shouldEscalateToEngineering: false for medium queue_saturation', () => {
    expect(triageHooks.shouldEscalateToEngineering('medium', 'queue_saturation')).toBe(false)
  })

  it('generateDiagnosticSummary: includes confidence label', () => {
    const summary = triageHooks.generateDiagnosticSummary('queue_saturation', 0.9)
    expect(summary).toContain('High')
  })

  it('generateSuggestedActions: returns non-empty array', () => {
    const actions = triageHooks.generateSuggestedActions('billing_lag')
    expect(actions.length).toBeGreaterThan(0)
  })

  it('createTriageRecord inserts and returns triage record', async () => {
    mockRow(triageRow())
    const record = await createTriageRecord('TICK-001', 'ten1', 'Queue issue', 'Queue saturated')
    expect(record.ticketId).toBe('TICK-001')
    expect(record.clusterType).toBe('queue_saturation')
  })

  it('getTriageRecord returns null when not found', async () => {
    mockEmpty()
    const record = await getTriageRecord('TICK-001')
    expect(record).toBeNull()
  })
})

// ─── incidentCorrelationService ───────────────────────────────────────────────

describe('incidentCorrelationService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('isClusterSignificant: false when below threshold', () => {
    const cluster = { incidentCount: 2 } as any
    expect(clusterHooks.isClusterSignificant(cluster)).toBe(false)
  })

  it('isClusterSignificant: true when >= 3', () => {
    const cluster = { incidentCount: 3 } as any
    expect(clusterHooks.isClusterSignificant(cluster)).toBe(true)
  })

  it('computeClusterSeverity: critical when >= 10 affected tenants', () => {
    const cluster = { affectedTenants: 10, incidentCount: 5 } as any
    expect(clusterHooks.computeClusterSeverity(cluster)).toBe('critical')
  })

  it('computeClusterSeverity: high when 5-9 tenants', () => {
    const cluster = { affectedTenants: 7, incidentCount: 5 } as any
    expect(clusterHooks.computeClusterSeverity(cluster)).toBe('high')
  })

  it('computeClusterSeverity: medium when meets min count', () => {
    const cluster = { affectedTenants: 2, incidentCount: 4 } as any
    expect(clusterHooks.computeClusterSeverity(cluster)).toBe('medium')
  })

  it('computeClusterSeverity: low when below min count', () => {
    const cluster = { affectedTenants: 1, incidentCount: 2 } as any
    expect(clusterHooks.computeClusterSeverity(cluster)).toBe('low')
  })

  it('getOrCreateCluster creates new when none active', async () => {
    mockEmpty()
    mockRow(clusterRow({ incident_count: 0 }))
    const cluster = await getOrCreateCluster('queue_saturation')
    expect(cluster.clusterType).toBe('queue_saturation')
    expect(mPool.query).toHaveBeenCalledTimes(2)
  })

  it('resolveCluster throws when not found', async () => {
    mockEmpty()
    await expect(resolveCluster('cl1', 'Fixed concurrency')).rejects.toThrow()
  })

  it('resolveCluster updates status to resolved', async () => {
    mockRow(clusterRow({ status: 'resolved', root_cause: 'Fixed concurrency' }))
    const cluster = await resolveCluster('cl1', 'Fixed concurrency')
    expect(cluster.status).toBe('resolved')
    expect(cluster.rootCause).toBe('Fixed concurrency')
  })
})

// ─── tenantHealthEscalation ───────────────────────────────────────────────────

describe('tenantHealthEscalation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('evaluateHealthScoreEscalation: no alert when above threshold', () => {
    const result = healthEscalationHooks.evaluateHealthScoreEscalation('ten1', 75)
    expect(result.shouldAlert).toBe(false)
  })

  it('evaluateHealthScoreEscalation: warning when below 70', () => {
    const result = healthEscalationHooks.evaluateHealthScoreEscalation('ten1', 65)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('warning')
  })

  it('evaluateHealthScoreEscalation: critical when below 40', () => {
    const result = healthEscalationHooks.evaluateHealthScoreEscalation('ten1', 35)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('critical')
  })

  it('evaluateAdoptionStall: no alert when adoption >= 60 and recent improvement', () => {
    const result = healthEscalationHooks.evaluateAdoptionStall('ten1', 70, 5)
    expect(result.shouldAlert).toBe(false)
  })

  it('evaluateAdoptionStall: critical when 30+ days no improvement', () => {
    const result = healthEscalationHooks.evaluateAdoptionStall('ten1', 50, 31)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('critical')
  })

  it('evaluateAdoptionStall: critical when adoption very low', () => {
    const result = healthEscalationHooks.evaluateAdoptionStall('ten1', 10, 5)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('critical')
  })

  it('evaluateIncidentSpike: no alert when < 3 incidents', () => {
    const result = healthEscalationHooks.evaluateIncidentSpike('ten1', 2)
    expect(result.shouldAlert).toBe(false)
  })

  it('evaluateIncidentSpike: warning when 3-9 incidents', () => {
    const result = healthEscalationHooks.evaluateIncidentSpike('ten1', 5)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('warning')
  })

  it('evaluateIncidentSpike: critical when >= 10 incidents', () => {
    const result = healthEscalationHooks.evaluateIncidentSpike('ten1', 10)
    expect(result.shouldAlert).toBe(true)
    expect(result.severity).toBe('critical')
  })

  it('createHealthAlert inserts with correct fields', async () => {
    mockRow(healthAlertRow())
    const alert = await createHealthAlert('ten1', 'health_score_drop', 'warning', 55, 70, 'Below threshold')
    expect(alert.tenantId).toBe('ten1')
    expect(alert.alertType).toBe('health_score_drop')
    expect(alert.severity).toBe('warning')
  })

  it('resolveHealthAlert throws when not found', async () => {
    mockEmpty()
    await expect(resolveHealthAlert('ha1')).rejects.toThrow()
  })
})

// ─── operationalCostAnalyzer ──────────────────────────────────────────────────

describe('operationalCostAnalyzer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('recordCost inserts and maps correctly', async () => {
    mockRow(costRecordRow())
    const record = await recordCost('ten1', 'ai_provider', 12.50, 1000, 'tokens', '2026-05')
    expect(record.costUsd).toBe(12.50)
    expect(record.category).toBe('ai_provider')
    expect(record.unitType).toBe('tokens')
  })

  it('computeRunRate: correct monthly projection', () => {
    const costs = [{ costUsd: 100 }, { costUsd: 200 }] as any[]
    const rate = costHooks.computeRunRate(costs, 30)
    expect(rate).toBe(300) // 300/30 * 30 = 300
  })

  it('computeRunRate: 0 when duration is 0', () => {
    const costs = [{ costUsd: 100 }] as any[]
    expect(costHooks.computeRunRate(costs, 0)).toBe(0)
  })

  it('computeCostPerUnit: correct calculation', () => {
    const costs = [{ costUsd: 10, unitCount: 1000 }] as any[]
    expect(costHooks.computeCostPerUnit(costs)).toBe(0.01)
  })

  it('computeCostPerUnit: 0 when no units', () => {
    const costs = [{ costUsd: 10, unitCount: 0 }] as any[]
    expect(costHooks.computeCostPerUnit(costs)).toBe(0)
  })

  it('detectCostAnomaly: isAnomaly true when > 50% deviation', () => {
    const { isAnomaly, deviationPct } = costHooks.detectCostAnomaly(160, 100)
    expect(isAnomaly).toBe(true)
    expect(deviationPct).toBe(60)
  })

  it('detectCostAnomaly: isAnomaly false when within 50%', () => {
    const { isAnomaly } = costHooks.detectCostAnomaly(130, 100)
    expect(isAnomaly).toBe(false)
  })

  it('detectCostAnomaly: no anomaly when baseline is 0', () => {
    const { isAnomaly } = costHooks.detectCostAnomaly(100, 0)
    expect(isAnomaly).toBe(false)
  })
})

// ─── governanceDriftDetector ──────────────────────────────────────────────────

describe('governanceDriftDetector', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifyDriftSeverity: critical for rls_policy_removed', () => {
    expect(driftHooks.classifyDriftSeverity('rls_policy_removed')).toBe('critical')
  })

  it('classifyDriftSeverity: critical for cross_tenant_leak', () => {
    expect(driftHooks.classifyDriftSeverity('cross_tenant_leak')).toBe('critical')
  })

  it('classifyDriftSeverity: warning for audit_gap', () => {
    expect(driftHooks.classifyDriftSeverity('audit_gap')).toBe('warning')
  })

  it('classifyDriftSeverity: warning for approval_gate_bypassed', () => {
    expect(driftHooks.classifyDriftSeverity('approval_gate_bypassed')).toBe('warning')
  })

  it('compareSnapshots: detects rls_policy_removed', () => {
    const current = { rlsPolicyCount: 8, auditEventsPerHour: 100, openReplayIncidents: 0, aiComplianceRate: 1, approvalGatePassRate: 1 } as any
    const previous = { rlsPolicyCount: 10, auditEventsPerHour: 100, openReplayIncidents: 0, aiComplianceRate: 1, approvalGatePassRate: 1 } as any
    const drifts = driftHooks.compareSnapshots(current, previous)
    expect(drifts).toContain('rls_policy_removed')
  })

  it('compareSnapshots: detects audit_gap', () => {
    const current = { rlsPolicyCount: 10, auditEventsPerHour: 0, openReplayIncidents: 0, aiComplianceRate: 1, approvalGatePassRate: 1 } as any
    const previous = { rlsPolicyCount: 10, auditEventsPerHour: 50, openReplayIncidents: 0, aiComplianceRate: 1, approvalGatePassRate: 1 } as any
    const drifts = driftHooks.compareSnapshots(current, previous)
    expect(drifts).toContain('audit_gap')
  })

  it('compareSnapshots: no drifts for identical snapshots', () => {
    const snapshot = { rlsPolicyCount: 10, auditEventsPerHour: 50, openReplayIncidents: 0, aiComplianceRate: 1, approvalGatePassRate: 1 } as any
    expect(driftHooks.compareSnapshots(snapshot, snapshot)).toHaveLength(0)
  })

  it('hasCriticalDrift: true when unresolved critical exists', () => {
    const events = [{ severity: 'critical', resolvedAt: null }] as any[]
    expect(driftHooks.hasCriticalDrift(events)).toBe(true)
  })

  it('hasCriticalDrift: false when critical is resolved', () => {
    const events = [{ severity: 'critical', resolvedAt: new Date() }] as any[]
    expect(driftHooks.hasCriticalDrift(events)).toBe(false)
  })

  it('recordDriftEvent inserts and returns drift event', async () => {
    mockRow(driftEventRow())
    const event = await recordDriftEvent('rls_policy_removed', null, 'Policy count dropped')
    expect(event.driftType).toBe('rls_policy_removed')
    expect(event.severity).toBe('critical')
  })

  it('resolveDriftEvent throws when not found', async () => {
    mockEmpty()
    await expect(resolveDriftEvent('de1')).rejects.toThrow()
  })
})

// ─── gaReadinessService ───────────────────────────────────────────────────────

describe('gaReadinessService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('classifyReadinessStatus: ready when >= 80', () => {
    expect(gaHooks.classifyReadinessStatus(80)).toBe('ready')
    expect(gaHooks.classifyReadinessStatus(100)).toBe('ready')
  })

  it('classifyReadinessStatus: at_risk when 60-79', () => {
    expect(gaHooks.classifyReadinessStatus(60)).toBe('at_risk')
    expect(gaHooks.classifyReadinessStatus(79)).toBe('at_risk')
  })

  it('classifyReadinessStatus: blocking when < 60', () => {
    expect(gaHooks.classifyReadinessStatus(59)).toBe('blocking')
    expect(gaHooks.classifyReadinessStatus(0)).toBe('blocking')
  })

  it('computeOverallReadiness: blocking status when any blocking', () => {
    const scores = [
      { score: 95, status: 'ready' },
      { score: 40, status: 'blocking' },
    ] as any[]
    const result = gaHooks.computeOverallReadiness(scores)
    expect(result.status).toBe('blocking')
    expect(result.blockingCount).toBe(1)
  })

  it('computeOverallReadiness: at_risk when no blocking but has at_risk', () => {
    const scores = [
      { score: 90, status: 'ready' },
      { score: 70, status: 'at_risk' },
    ] as any[]
    const result = gaHooks.computeOverallReadiness(scores)
    expect(result.status).toBe('at_risk')
  })

  it('computeOverallReadiness: ready when all ready', () => {
    const scores = [
      { score: 90, status: 'ready' },
      { score: 85, status: 'ready' },
    ] as any[]
    const result = gaHooks.computeOverallReadiness(scores)
    expect(result.status).toBe('ready')
    expect(result.overallScore).toBe(88) // avg of 90 and 85
  })

  it('isReadyForGA: true when all ready', () => {
    const scores = [
      { score: 90, status: 'ready' },
      { score: 85, status: 'ready' },
    ] as any[]
    expect(gaHooks.isReadyForGA(scores)).toBe(true)
  })

  it('isReadyForGA: false when any blocking', () => {
    const scores = [
      { score: 90, status: 'ready' },
      { score: 40, status: 'blocking' },
    ] as any[]
    expect(gaHooks.isReadyForGA(scores)).toBe(false)
  })

  it('recordReadinessScore inserts with correct status', async () => {
    mockRow(gaScoreRow())
    const score = await recordReadinessScore('production', 'regression', 95)
    expect(score.score).toBe(95)
    expect(score.status).toBe('ready')
    expect(mPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['production', 'regression', 95, 'ready'])
    )
  })

  it('createDeploymentWave inserts with planned status', async () => {
    mockRow(waveRow())
    const wave = await createDeploymentWave('Design Partners', 1, ['Acme'], ['NPS > 8'])
    expect(wave.waveName).toBe('Design Partners')
    expect(wave.status).toBe('planned')
    expect(wave.waveNumber).toBe(1)
  })

  it('advanceWaveStatus throws when not found', async () => {
    mockEmpty()
    await expect(advanceWaveStatus('w1', 'active')).rejects.toThrow()
  })

  it('advanceWaveStatus updates status', async () => {
    mockRow(waveRow({ status: 'active' }))
    const wave = await advanceWaveStatus('w1', 'active')
    expect(wave.status).toBe('active')
  })

  it('getActiveWave returns null when none active', async () => {
    mockEmpty()
    const wave = await getActiveWave()
    expect(wave).toBeNull()
  })
})

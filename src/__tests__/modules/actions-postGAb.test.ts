// Denver Engineering — Post-GA Tests Part B (v1.0.0)
// Tests: supportOperationsCoordinator, platformEvolutionCouncil,
//        industryExpansionFramework, tenantLaunchValidator

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
import { __testHooks as soc } from '../../../api/services/postGA/supportOperationsCoordinator'
import { __testHooks as pec } from '../../../api/services/postGA/platformEvolutionCouncil'
import { __testHooks as ief } from '../../../api/services/postGA/industryExpansionFramework'
import { __testHooks as tlv } from '../../../api/services/postGA/tenantLaunchValidator'

import * as supportOps from '../../../api/services/postGA/supportOperationsCoordinator'
import * as evolutionOps from '../../../api/services/postGA/platformEvolutionCouncil'
import * as industryOps from '../../../api/services/postGA/industryExpansionFramework'
import * as launchOps from '../../../api/services/postGA/tenantLaunchValidator'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockPool = pool as { query: ReturnType<typeof vi.fn> }
const mockTenantQuery = tenantQuery as ReturnType<typeof vi.fn>

const mockRow = (row: Record<string, unknown>) => ({ rows: [row], rowCount: 1 })
const mockRows = (rows: Record<string, unknown>[]) => ({ rows, rowCount: rows.length })
const mockEmpty = () => ({ rows: [], rowCount: 0 })

function makeSupportRecordRow(overrides = {}) {
  return {
    id: 'sr1', tenant_id: 't1',
    incident_id: 'inc-1', cluster_type: 'replay_failure',
    replay_assisted: false, resolution_time_ms: null,
    root_cause_identified: false,
    escalation_tier: 'l1', satisfaction_score: null,
    resolved_at: null, created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeResolvedSupportRow(overrides = {}) {
  return makeSupportRecordRow({
    replay_assisted: true,
    resolution_time_ms: 7200000,
    root_cause_identified: true,
    satisfaction_score: 4.5,
    resolved_at: new Date().toISOString(),
    ...overrides,
  })
}

function makeProposalRow(overrides = {}) {
  return {
    id: 'ep1', title: 'New Caching Layer',
    description: 'Add Redis caching', complexity_impact: 30,
    replay_surface_impact: 5, governance_risk: 'low',
    status: 'draft', approved_by: null,
    proposed_at: new Date().toISOString(), reviewed_at: null,
    ...overrides,
  }
}

function makeTrendRow(overrides = {}) {
  return {
    id: 'ct1', environment: 'production',
    current_score: 105, previous_score: 100,
    growth_pct: 0.05, trend: 'growing',
    is_over_limit: false,
    measured_at: new Date().toISOString(),
    ...overrides,
  }
}

function makePlaybookRow(overrides = {}) {
  return {
    id: 'pb1', industry: 'manufacturing',
    version: '1.0.0', template_count: 8,
    workflow_count: 6, compliance_frameworks: ['ISO9001', 'SOC2'],
    certification_status: 'certified', deployment_count: 12,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeTemplateRow(overrides = {}) {
  return {
    id: 'vt1', industry: 'manufacturing',
    template_name: 'Maintenance Workflow',
    template_type: 'workflow',
    replay_compatible: true, governance_validated: true,
    usage_count: 25,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeGateRow(overrides = {}) {
  return {
    gate_name: 'replay_consistency', category: 'replay',
    status: 'pass', current_value: 1.0, required_value: 1.0,
    detail: 'All replay sessions consistent',
    ...overrides,
  }
}

// ─── supportOperationsCoordinator ────────────────────────────────────────────

describe('supportOperationsCoordinator', () => {
  describe('isSLABreached', () => {
    it('returns false when resolutionTimeMs is null', () => {
      expect(soc.isSLABreached(null)).toBe(false)
    })

    it('returns false when at SLA boundary (14400000ms = 4h)', () => {
      expect(soc.isSLABreached(14400000)).toBe(false)
    })

    it('returns false when well within SLA', () => {
      expect(soc.isSLABreached(7200000)).toBe(false)
    })

    it('returns true when over SLA', () => {
      expect(soc.isSLABreached(14400001)).toBe(true)
    })

    it('returns true when far over SLA', () => {
      expect(soc.isSLABreached(28800000)).toBe(true)
    })
  })

  describe('computeReplayAssistedRate', () => {
    it('returns 0 for empty records', () => {
      expect(soc.computeReplayAssistedRate([])).toBe(0)
    })

    it('returns 0 when no resolved records', () => {
      const records = [soc._mapSupportRecord(makeSupportRecordRow())]
      expect(soc.computeReplayAssistedRate(records)).toBe(0)
    })

    it('returns 1.0 when all resolved records are replay-assisted', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow()),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2' })),
      ]
      expect(soc.computeReplayAssistedRate(records)).toBe(1.0)
    })

    it('returns 0.5 when half are replay-assisted', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow()),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', replay_assisted: false })),
      ]
      expect(soc.computeReplayAssistedRate(records)).toBe(0.5)
    })

    it('ignores unresolved records', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow()),
        soc._mapSupportRecord(makeSupportRecordRow({ id: 'sr2', replay_assisted: true })), // not resolved
      ]
      expect(soc.computeReplayAssistedRate(records)).toBe(1.0)
    })
  })

  describe('computeRootCauseRate', () => {
    it('returns 0 for empty records', () => {
      expect(soc.computeRootCauseRate([])).toBe(0)
    })

    it('returns 0 when no resolved records', () => {
      const records = [soc._mapSupportRecord(makeSupportRecordRow())]
      expect(soc.computeRootCauseRate(records)).toBe(0)
    })

    it('returns 1.0 when all resolved have root cause', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow()),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2' })),
      ]
      expect(soc.computeRootCauseRate(records)).toBe(1.0)
    })

    it('returns 0.5 when half have root cause', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow()),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', root_cause_identified: false })),
      ]
      expect(soc.computeRootCauseRate(records)).toBe(0.5)
    })
  })

  describe('computeAverageSatisfaction', () => {
    it('returns 0 for empty records', () => {
      expect(soc.computeAverageSatisfaction([])).toBe(0)
    })

    it('returns 0 when no satisfaction scores', () => {
      const records = [soc._mapSupportRecord(makeSupportRecordRow())]
      expect(soc.computeAverageSatisfaction(records)).toBe(0)
    })

    it('returns average of available scores', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow({ satisfaction_score: 4.0 })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', satisfaction_score: 5.0 })),
      ]
      expect(soc.computeAverageSatisfaction(records)).toBe(4.5)
    })

    it('ignores null scores', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow({ satisfaction_score: 4.0 })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', satisfaction_score: null })),
      ]
      expect(soc.computeAverageSatisfaction(records)).toBe(4.0)
    })
  })

  describe('buildIncidentClusters', () => {
    it('returns empty when no cluster types', () => {
      const records = [soc._mapSupportRecord(makeSupportRecordRow({ cluster_type: null }))]
      expect(soc.buildIncidentClusters(records)).toHaveLength(0)
    })

    it('groups by cluster type', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow({ cluster_type: 'replay_failure' })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', cluster_type: 'replay_failure' })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr3', cluster_type: 'onboarding_blocker' })),
      ]
      const clusters = soc.buildIncidentClusters(records)
      expect(clusters).toHaveLength(2)
      const rc = clusters.find(c => c.clusterType === 'replay_failure')
      expect(rc?.count).toBe(2)
    })

    it('computes avgResolutionMs per cluster', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow({ cluster_type: 'replay_failure', resolution_time_ms: 10000 })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', cluster_type: 'replay_failure', resolution_time_ms: 20000 })),
      ]
      const clusters = soc.buildIncidentClusters(records)
      expect(clusters[0].avgResolutionMs).toBe(15000)
    })

    it('returns 0 avgResolutionMs when none resolved', () => {
      const records = [soc._mapSupportRecord(makeSupportRecordRow({ cluster_type: 'replay_failure' }))]
      const clusters = soc.buildIncidentClusters(records)
      expect(clusters[0].avgResolutionMs).toBe(0)
    })

    it('includes replayAssistedRate per cluster', () => {
      const records = [
        soc._mapSupportRecord(makeResolvedSupportRow({ cluster_type: 'replay_failure', replay_assisted: true })),
        soc._mapSupportRecord(makeResolvedSupportRow({ id: 'sr2', cluster_type: 'replay_failure', replay_assisted: false })),
      ]
      const clusters = soc.buildIncidentClusters(records)
      expect(clusters[0].replayAssistedRate).toBe(0.5)
    })
  })

  describe('_mapSupportRecord', () => {
    it('maps open record correctly', () => {
      const rec = soc._mapSupportRecord(makeSupportRecordRow())
      expect(rec.id).toBe('sr1')
      expect(rec.tenantId).toBe('t1')
      expect(rec.incidentId).toBe('inc-1')
      expect(rec.clusterType).toBe('replay_failure')
      expect(rec.replayAssisted).toBe(false)
      expect(rec.resolutionTimeMs).toBeNull()
      expect(rec.escalationTier).toBe('l1')
      expect(rec.resolvedAt).toBeNull()
    })

    it('maps resolved record correctly', () => {
      const rec = soc._mapSupportRecord(makeResolvedSupportRow())
      expect(rec.replayAssisted).toBe(true)
      expect(rec.resolutionTimeMs).toBe(7200000)
      expect(rec.rootCauseIdentified).toBe(true)
      expect(rec.satisfactionScore).toBe(4.5)
      expect(rec.resolvedAt).not.toBeNull()
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset(); mockTenantQuery.mockReset() })

    it('createSupportOperation inserts with pool.query', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeSupportRecordRow()))
      const rec = await supportOps.createSupportOperation('t1', 'inc-1', 'replay_failure', 'l1')
      expect(rec.tenantId).toBe('t1')
      expect(mockPool.query).toHaveBeenCalledOnce()
    })

    it('resolveSupportOperation updates and returns record', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeResolvedSupportRow()))
      const rec = await supportOps.resolveSupportOperation('sr1', 7200000, true, true, 4.5)
      expect(rec.replayAssisted).toBe(true)
    })

    it('resolveSupportOperation throws if not found', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(supportOps.resolveSupportOperation('sr-missing', 1000, false, false, null))
        .rejects.toThrow('SupportOperation')
    })

    it('getTenantSupportHistory uses tenantQuery', async () => {
      mockTenantQuery.mockResolvedValueOnce(mockRows([makeSupportRecordRow()]))
      const recs = await supportOps.getTenantSupportHistory('t1')
      expect(recs).toHaveLength(1)
      expect(mockTenantQuery).toHaveBeenCalledOnce()
    })

    it('getOpenOperations uses pool.query', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeSupportRecordRow()]))
      const recs = await supportOps.getOpenOperations()
      expect(recs).toHaveLength(1)
      expect(mockPool.query).toHaveBeenCalledOnce()
    })
  })
})

// ─── platformEvolutionCouncil ─────────────────────────────────────────────────

describe('platformEvolutionCouncil', () => {
  describe('computeComplexityGrowthPct', () => {
    it('returns 0.05 for 100 → 105', () => {
      expect(pec.computeComplexityGrowthPct(100, 105)).toBeCloseTo(0.05)
    })

    it('returns negative for decrease', () => {
      expect(pec.computeComplexityGrowthPct(100, 90)).toBeCloseTo(-0.10)
    })

    it('returns 0 when unchanged', () => {
      expect(pec.computeComplexityGrowthPct(100, 100)).toBe(0)
    })

    it('returns 1.0 when previous is 0 and current > 0', () => {
      expect(pec.computeComplexityGrowthPct(0, 50)).toBe(1.0)
    })

    it('returns 0 when both are 0', () => {
      expect(pec.computeComplexityGrowthPct(0, 0)).toBe(0)
    })
  })

  describe('classifyComplexityTrend', () => {
    it('classifies < -0.01 as decreasing', () => {
      expect(pec.classifyComplexityTrend(-0.02)).toBe('decreasing')
    })

    it('classifies -0.01 boundary as stable', () => {
      expect(pec.classifyComplexityTrend(-0.01)).toBe('stable')
    })

    it('classifies 0 as stable', () => {
      expect(pec.classifyComplexityTrend(0)).toBe('stable')
    })

    it('classifies 0.02 as stable', () => {
      expect(pec.classifyComplexityTrend(0.02)).toBe('stable')
    })

    it('classifies 0.03 as growing', () => {
      expect(pec.classifyComplexityTrend(0.03)).toBe('growing')
    })

    it('classifies 0.10 as growing (at limit)', () => {
      expect(pec.classifyComplexityTrend(0.10)).toBe('growing')
    })

    it('classifies above 0.10 as accelerating', () => {
      expect(pec.classifyComplexityTrend(0.101)).toBe('accelerating')
    })

    it('classifies 0.5 as accelerating', () => {
      expect(pec.classifyComplexityTrend(0.5)).toBe('accelerating')
    })
  })

  describe('isComplexityOverLimit', () => {
    it('returns false at exactly 0.10', () => {
      expect(pec.isComplexityOverLimit(0.10)).toBe(false)
    })

    it('returns true above 0.10', () => {
      expect(pec.isComplexityOverLimit(0.101)).toBe(true)
    })

    it('returns false below limit', () => {
      expect(pec.isComplexityOverLimit(0.05)).toBe(false)
    })
  })

  describe('requiresCouncilApproval', () => {
    it('returns true for medium governance risk', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'medium', complexity_impact: 10, replay_surface_impact: 2 }))
      expect(pec.requiresCouncilApproval(p)).toBe(true)
    })

    it('returns true for high governance risk', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'high', complexity_impact: 10, replay_surface_impact: 2 }))
      expect(pec.requiresCouncilApproval(p)).toBe(true)
    })

    it('returns true when complexityImpact > 50', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ complexity_impact: 51, governance_risk: 'low' }))
      expect(pec.requiresCouncilApproval(p)).toBe(true)
    })

    it('returns true when replaySurfaceImpact > 10', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ replay_surface_impact: 11, governance_risk: 'low', complexity_impact: 10 }))
      expect(pec.requiresCouncilApproval(p)).toBe(true)
    })

    it('returns false for low-impact low-risk proposal', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'low', complexity_impact: 30, replay_surface_impact: 5 }))
      expect(pec.requiresCouncilApproval(p)).toBe(false)
    })

    it('returns false at exactly complexityImpact=50', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'low', complexity_impact: 50, replay_surface_impact: 5 }))
      expect(pec.requiresCouncilApproval(p)).toBe(false)
    })
  })

  describe('isProposalBlocked', () => {
    it('returns true when high risk and no approver', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'high', approved_by: null }))
      expect(pec.isProposalBlocked(p)).toBe(true)
    })

    it('returns false when high risk but approved', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'high', approved_by: 'cto@company.com' }))
      expect(pec.isProposalBlocked(p)).toBe(false)
    })

    it('returns false when medium risk', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'medium', approved_by: null }))
      expect(pec.isProposalBlocked(p)).toBe(false)
    })

    it('returns false when low risk', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow({ governance_risk: 'low', approved_by: null }))
      expect(pec.isProposalBlocked(p)).toBe(false)
    })
  })

  describe('_mapEvolutionProposal', () => {
    it('maps all fields', () => {
      const p = pec._mapEvolutionProposal(makeProposalRow())
      expect(p.id).toBe('ep1')
      expect(p.title).toBe('New Caching Layer')
      expect(p.complexityImpact).toBe(30)
      expect(p.replaySurfaceImpact).toBe(5)
      expect(p.governanceRisk).toBe('low')
      expect(p.status).toBe('draft')
      expect(p.approvedBy).toBeNull()
      expect(p.reviewedAt).toBeNull()
    })
  })

  describe('_mapComplexityTrend', () => {
    it('maps all fields', () => {
      const t = pec._mapComplexityTrend(makeTrendRow())
      expect(t.id).toBe('ct1')
      expect(t.environment).toBe('production')
      expect(t.currentScore).toBe(105)
      expect(t.previousScore).toBe(100)
      expect(t.growthPct).toBeCloseTo(0.05)
      expect(t.trend).toBe('growing')
      expect(t.isOverLimit).toBe(false)
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('submitProposal inserts as draft', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeProposalRow()))
      const p = await evolutionOps.submitProposal('New Caching Layer', 'Add Redis', 30, 5, 'low')
      expect(p.status).toBe('draft')
    })

    it('approveProposal updates status and approver', async () => {
      const approved = makeProposalRow({ status: 'approved', approved_by: 'cto@company.com', reviewed_at: new Date().toISOString() })
      mockPool.query.mockResolvedValueOnce(mockRow(approved))
      const p = await evolutionOps.approveProposal('ep1', 'cto@company.com')
      expect(p.status).toBe('approved')
      expect(p.approvedBy).toBe('cto@company.com')
    })

    it('approveProposal throws if not found or not reviewable', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(evolutionOps.approveProposal('ep-missing', 'cto@company.com')).rejects.toThrow('EvolutionProposal')
    })

    it('recordComplexityTrend computes and inserts trend', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeTrendRow()))
      const trend = await evolutionOps.recordComplexityTrend('production', 100, 105)
      expect(trend.trend).toBe('growing')
    })

    it('getBlockedProposals returns high-risk unapproved', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeProposalRow({ governance_risk: 'high', approved_by: null })]))
      const proposals = await evolutionOps.getBlockedProposals()
      expect(proposals).toHaveLength(1)
    })

    it('getComplexityTrends returns history', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeTrendRow()]))
      const trends = await evolutionOps.getComplexityTrends('production')
      expect(trends).toHaveLength(1)
    })
  })
})

// ─── industryExpansionFramework ───────────────────────────────────────────────

describe('industryExpansionFramework', () => {
  describe('isPlaybookCertified', () => {
    it('returns true for certified status', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow())
      expect(ief.isPlaybookCertified(pb)).toBe(true)
    })

    it('returns false for review', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({ certification_status: 'review' }))
      expect(ief.isPlaybookCertified(pb)).toBe(false)
    })

    it('returns false for draft', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({ certification_status: 'draft' }))
      expect(ief.isPlaybookCertified(pb)).toBe(false)
    })

    it('returns false for deprecated', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({ certification_status: 'deprecated' }))
      expect(ief.isPlaybookCertified(pb)).toBe(false)
    })
  })

  describe('isTemplateDeployable', () => {
    it('returns true when replay compatible and governance validated', () => {
      const t = ief._mapVerticalTemplate(makeTemplateRow())
      expect(ief.isTemplateDeployable(t)).toBe(true)
    })

    it('returns false when not replay compatible', () => {
      const t = ief._mapVerticalTemplate(makeTemplateRow({ replay_compatible: false }))
      expect(ief.isTemplateDeployable(t)).toBe(false)
    })

    it('returns false when not governance validated', () => {
      const t = ief._mapVerticalTemplate(makeTemplateRow({ governance_validated: false }))
      expect(ief.isTemplateDeployable(t)).toBe(false)
    })

    it('returns false when both fail', () => {
      const t = ief._mapVerticalTemplate(makeTemplateRow({ replay_compatible: false, governance_validated: false }))
      expect(ief.isTemplateDeployable(t)).toBe(false)
    })
  })

  describe('computePlaybookReadiness', () => {
    it('returns 100 for fully certified and stocked playbook', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'certified',
        template_count: 10, workflow_count: 10,
        compliance_frameworks: ['A', 'B'],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(100)
    })

    it('certified=40 + 10 templates×3=30 + 0 workflows + 0 frameworks = 70', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'certified',
        template_count: 10, workflow_count: 0, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(70)
    })

    it('gives 25 for review status with nothing else', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'review',
        template_count: 0, workflow_count: 0, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(25)
    })

    it('gives 10 for draft status with nothing else', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'draft',
        template_count: 0, workflow_count: 0, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(10)
    })

    it('gives 0 cert score for deprecated', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'deprecated',
        template_count: 0, workflow_count: 0, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(0)
    })

    it('caps template score at 30', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'draft',
        template_count: 100, workflow_count: 0, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(40) // 10+30
    })

    it('caps workflow score at 20', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'draft',
        template_count: 0, workflow_count: 100, compliance_frameworks: [],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(30) // 10+20
    })

    it('caps compliance score at 10', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow({
        certification_status: 'draft',
        template_count: 0, workflow_count: 0,
        compliance_frameworks: ['A', 'B', 'C', 'D', 'E'],
      }))
      expect(ief.computePlaybookReadiness(pb)).toBe(20) // 10+10
    })

    it('computes correct score for default playbook', () => {
      // certified=40, templates=8→24, workflows=6→12, frameworks=2→10 = 86
      const pb = ief._mapIndustryPlaybook(makePlaybookRow())
      expect(ief.computePlaybookReadiness(pb)).toBe(86)
    })
  })

  describe('getDeployableTemplates', () => {
    it('returns only deployable templates', () => {
      const templates = [
        ief._mapVerticalTemplate(makeTemplateRow()),
        ief._mapVerticalTemplate(makeTemplateRow({ id: 'vt2', replay_compatible: false })),
        ief._mapVerticalTemplate(makeTemplateRow({ id: 'vt3', governance_validated: false })),
        ief._mapVerticalTemplate(makeTemplateRow({ id: 'vt4' })),
      ]
      expect(ief.getDeployableTemplates(templates)).toHaveLength(2)
    })

    it('returns empty when none deployable', () => {
      const templates = [ief._mapVerticalTemplate(makeTemplateRow({ replay_compatible: false }))]
      expect(ief.getDeployableTemplates(templates)).toHaveLength(0)
    })
  })

  describe('_mapIndustryPlaybook', () => {
    it('maps all fields', () => {
      const pb = ief._mapIndustryPlaybook(makePlaybookRow())
      expect(pb.id).toBe('pb1')
      expect(pb.industry).toBe('manufacturing')
      expect(pb.version).toBe('1.0.0')
      expect(pb.templateCount).toBe(8)
      expect(pb.workflowCount).toBe(6)
      expect(pb.complianceFrameworks).toEqual(['ISO9001', 'SOC2'])
      expect(pb.certificationStatus).toBe('certified')
      expect(pb.deploymentCount).toBe(12)
    })
  })

  describe('_mapVerticalTemplate', () => {
    it('maps all fields', () => {
      const t = ief._mapVerticalTemplate(makeTemplateRow())
      expect(t.id).toBe('vt1')
      expect(t.industry).toBe('manufacturing')
      expect(t.templateName).toBe('Maintenance Workflow')
      expect(t.templateType).toBe('workflow')
      expect(t.replayCompatible).toBe(true)
      expect(t.governanceValidated).toBe(true)
      expect(t.usageCount).toBe(25)
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('registerPlaybook inserts and returns playbook', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makePlaybookRow({ certification_status: 'draft' })))
      const pb = await industryOps.registerPlaybook('manufacturing', '1.0.0', 8, 6, ['ISO9001', 'SOC2'])
      expect(pb.industry).toBe('manufacturing')
    })

    it('certifyPlaybook updates certification status', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makePlaybookRow()))
      const pb = await industryOps.certifyPlaybook('pb1')
      expect(pb.certificationStatus).toBe('certified')
    })

    it('certifyPlaybook throws if not found', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      await expect(industryOps.certifyPlaybook('pb-missing')).rejects.toThrow('IndustryPlaybook')
    })

    it('registerTemplate inserts and returns template', async () => {
      mockPool.query.mockResolvedValueOnce(mockRow(makeTemplateRow()))
      const t = await industryOps.registerTemplate('manufacturing', 'Maintenance Workflow', 'workflow', true, true)
      expect(t.templateName).toBe('Maintenance Workflow')
    })

    it('getPlaybooksByIndustry returns list', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makePlaybookRow()]))
      const pbs = await industryOps.getPlaybooksByIndustry('manufacturing')
      expect(pbs).toHaveLength(1)
    })

    it('getTemplatesByIndustry returns list', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeTemplateRow()]))
      const ts = await industryOps.getTemplatesByIndustry('manufacturing')
      expect(ts).toHaveLength(1)
    })
  })
})

// ─── tenantLaunchValidator ────────────────────────────────────────────────────

describe('tenantLaunchValidator', () => {
  const makeGate = (overrides = {}) => tlv._mapLaunchGate(makeGateRow(overrides))

  describe('evaluateLaunchGate', () => {
    it('returns pass when currentValue >= requiredValue', () => {
      expect(tlv.evaluateLaunchGate(1.0, 1.0)).toBe('pass')
      expect(tlv.evaluateLaunchGate(1.1, 1.0)).toBe('pass')
    })

    it('returns fail when below required with no tolerance', () => {
      expect(tlv.evaluateLaunchGate(0.9, 1.0)).toBe('fail')
    })

    it('returns warn when within tolerance', () => {
      expect(tlv.evaluateLaunchGate(0.95, 1.0, 0.05)).toBe('warn')
    })

    it('returns fail when below tolerance range', () => {
      expect(tlv.evaluateLaunchGate(0.9, 1.0, 0.05)).toBe('fail')
    })

    it('uses 0 tolerance by default', () => {
      expect(tlv.evaluateLaunchGate(0.99, 1.0)).toBe('fail')
    })

    it('returns pass at exact required with any tolerance', () => {
      expect(tlv.evaluateLaunchGate(1.0, 1.0, 0.10)).toBe('pass')
    })
  })

  describe('hasReplayGatePassed', () => {
    it('returns false for empty gates', () => {
      expect(tlv.hasReplayGatePassed([])).toBe(false)
    })

    it('returns false when no replay category gates', () => {
      const gates = [makeGate({ category: 'governance', status: 'pass' })]
      expect(tlv.hasReplayGatePassed(gates)).toBe(false)
    })

    it('returns true when all replay gates pass', () => {
      const gates = [
        makeGate({ category: 'replay', status: 'pass' }),
        makeGate({ gate_name: 'replay_sessions', category: 'replay', status: 'pass' }),
      ]
      expect(tlv.hasReplayGatePassed(gates)).toBe(true)
    })

    it('returns false when any replay gate fails', () => {
      const gates = [
        makeGate({ category: 'replay', status: 'pass' }),
        makeGate({ gate_name: 'replay_sessions', category: 'replay', status: 'fail' }),
      ]
      expect(tlv.hasReplayGatePassed(gates)).toBe(false)
    })

    it('returns false when replay gate warns', () => {
      const gates = [makeGate({ category: 'replay', status: 'warn' })]
      expect(tlv.hasReplayGatePassed(gates)).toBe(false)
    })
  })

  describe('hasGovernanceGatePassed', () => {
    it('returns false for empty gates', () => {
      expect(tlv.hasGovernanceGatePassed([])).toBe(false)
    })

    it('returns false when no governance category gates', () => {
      const gates = [makeGate({ category: 'replay', status: 'pass' })]
      expect(tlv.hasGovernanceGatePassed(gates)).toBe(false)
    })

    it('returns true when all governance gates pass', () => {
      const gates = [makeGate({ category: 'governance', status: 'pass' })]
      expect(tlv.hasGovernanceGatePassed(gates)).toBe(true)
    })

    it('returns false when any governance gate fails', () => {
      const gates = [
        makeGate({ category: 'governance', status: 'pass' }),
        makeGate({ gate_name: 'audit_complete', category: 'governance', status: 'fail' }),
      ]
      expect(tlv.hasGovernanceGatePassed(gates)).toBe(false)
    })
  })

  describe('computeValidationPassRate', () => {
    it('returns 1.0 for empty gates', () => {
      expect(tlv.computeValidationPassRate([])).toBe(1.0)
    })

    it('returns 1.0 when all pass', () => {
      const gates = [makeGate(), makeGate({ gate_name: 'gate2' })]
      expect(tlv.computeValidationPassRate(gates)).toBe(1.0)
    })

    it('returns 0.5 when half pass', () => {
      const gates = [makeGate(), makeGate({ gate_name: 'gate2', status: 'fail' })]
      expect(tlv.computeValidationPassRate(gates)).toBe(0.5)
    })

    it('returns 0 when all fail', () => {
      const gates = [makeGate({ status: 'fail' }), makeGate({ gate_name: 'gate2', status: 'fail' })]
      expect(tlv.computeValidationPassRate(gates)).toBe(0)
    })

    it('treats warn as not-pass', () => {
      const gates = [makeGate(), makeGate({ gate_name: 'gate2', status: 'warn' })]
      expect(tlv.computeValidationPassRate(gates)).toBe(0.5)
    })
  })

  describe('isValidationPassing', () => {
    it('returns false for empty gates', () => {
      expect(tlv.isValidationPassing([])).toBe(false)
    })

    it('returns true when all gates pass including replay and governance', () => {
      const gates = [
        makeGate({ category: 'replay', status: 'pass' }),
        makeGate({ gate_name: 'gov_gate', category: 'governance', status: 'pass' }),
        makeGate({ gate_name: 'onboard_gate', category: 'onboarding', status: 'pass' }),
        makeGate({ gate_name: 'infra_gate', category: 'infra', status: 'pass' }),
      ]
      expect(tlv.isValidationPassing(gates)).toBe(true)
    })

    it('returns false when replay gates not present', () => {
      const gates = [
        makeGate({ gate_name: 'gov_gate', category: 'governance', status: 'pass' }),
        makeGate({ gate_name: 'onboard_gate', category: 'onboarding', status: 'pass' }),
      ]
      expect(tlv.isValidationPassing(gates)).toBe(false)
    })

    it('returns false when governance gates not present', () => {
      const gates = [
        makeGate({ category: 'replay', status: 'pass' }),
        makeGate({ gate_name: 'onboard_gate', category: 'onboarding', status: 'pass' }),
      ]
      expect(tlv.isValidationPassing(gates)).toBe(false)
    })

    it('returns false when pass rate drops below 0.95', () => {
      const gates = [
        makeGate({ category: 'replay', status: 'pass' }),
        makeGate({ gate_name: 'gov_gate', category: 'governance', status: 'pass' }),
        ...Array.from({ length: 18 }, (_, i) =>
          makeGate({ gate_name: `fail_gate_${i}`, category: 'onboarding', status: 'fail' })
        ),
      ]
      // 2 pass / 20 total = 0.10, well below 0.95
      expect(tlv.isValidationPassing(gates)).toBe(false)
    })
  })

  describe('getFailedGates', () => {
    it('returns only failed gates', () => {
      const gates = [
        makeGate({ status: 'pass' }),
        makeGate({ gate_name: 'gate2', status: 'fail' }),
        makeGate({ gate_name: 'gate3', status: 'warn' }),
        makeGate({ gate_name: 'gate4', status: 'fail' }),
      ]
      const failed = tlv.getFailedGates(gates)
      expect(failed).toHaveLength(2)
      expect(failed.every((g: { status: string }) => g.status === 'fail')).toBe(true)
    })

    it('returns empty when all pass', () => {
      const gates = [makeGate(), makeGate({ gate_name: 'gate2' })]
      expect(tlv.getFailedGates(gates)).toHaveLength(0)
    })
  })

  describe('_mapLaunchGate', () => {
    it('maps all fields', () => {
      const gate = tlv._mapLaunchGate(makeGateRow())
      expect(gate.gateName).toBe('replay_consistency')
      expect(gate.category).toBe('replay')
      expect(gate.status).toBe('pass')
      expect(gate.currentValue).toBe(1.0)
      expect(gate.requiredValue).toBe(1.0)
      expect(gate.detail).toBe('All replay sessions consistent')
    })
  })

  describe('service functions', () => {
    beforeEach(() => { mockPool.query.mockReset() })

    it('runLaunchValidation evaluates gates and upserts each', async () => {
      mockPool.query.mockResolvedValue(mockRow(makeGateRow()))
      const gates = [
        { gateName: 'replay_consistency', category: 'replay' as const, currentValue: 1.0, requiredValue: 1.0, detail: 'ok' },
        { gateName: 'governance_check', category: 'governance' as const, currentValue: 1.0, requiredValue: 1.0, detail: 'ok' },
      ]
      const result = await launchOps.runLaunchValidation('t1', gates)
      expect(result).toHaveLength(2)
      expect(mockPool.query).toHaveBeenCalledTimes(2)
    })

    it('runLaunchValidation returns pass for gate meeting required', async () => {
      mockPool.query.mockResolvedValue(mockRow(makeGateRow()))
      const gates = [
        { gateName: 'replay_consistency', category: 'replay' as const, currentValue: 1.0, requiredValue: 1.0, detail: 'ok' },
      ]
      const result = await launchOps.runLaunchValidation('t1', gates)
      expect(result[0].status).toBe('pass')
    })

    it('runLaunchValidation returns fail for failing gate', async () => {
      mockPool.query.mockResolvedValue(mockRow(makeGateRow({ status: 'fail' })))
      const gates = [
        { gateName: 'replay_consistency', category: 'replay' as const, currentValue: 0.5, requiredValue: 1.0, detail: 'failing' },
      ]
      const result = await launchOps.runLaunchValidation('t1', gates)
      expect(result[0].status).toBe('fail')
    })

    it('getLaunchGates fetches by tenant', async () => {
      mockPool.query.mockResolvedValueOnce(mockRows([makeGateRow()]))
      const gates = await launchOps.getLaunchGates('t1')
      expect(gates).toHaveLength(1)
      expect(gates[0].gateName).toBe('replay_consistency')
    })

    it('getLaunchGates returns empty when no gates', async () => {
      mockPool.query.mockResolvedValueOnce(mockEmpty())
      const gates = await launchOps.getLaunchGates('t-new')
      expect(gates).toHaveLength(0)
    })
  })
})

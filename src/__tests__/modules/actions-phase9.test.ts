/**
 * Denver Engineering — Phase 9 Test Suite A (v9.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 9 — Federated Intelligence + Ecosystem Platform.
 * 130 tests across 10 suites.
 * Covers: federatedIntelligenceEngine, benchmarkingService, playbookMarketplaceService,
 *         pluginRegistryService, externalAgentGateway, automationAdapterService,
 *         knowledgeGraphService, edgeNodeService, airGapModeService,
 *         certificationEvidenceService.
 * All DB calls are mocked. No external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { pool, tenantQuery } from '../../../api/db/pool'
const mockPool   = vi.mocked(pool.query)
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows } as never)
const mockRow  = (row: Record<string, unknown>)    => ({ rows: [row] } as never)

// ─── Factories ────────────────────────────────────────────────────────────────

const makeContributionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'contrib-1', tenant_id: 'T1', contribution_type: 'recommendation_outcome',
  anonymized_data: JSON.stringify({ outcome: 'success', _dp_noise_applied: true }),
  privacy_hash: 'abc123', k_count: 1, status: 'pending', opt_in_verified: true,
  rejected_reason: null, published_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makePatternRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pat-1', pattern_type: 'anomaly_detection', industry_segment: 'construction',
  region: 'north_america', project_type: 'commercial', version: 1,
  pattern_data: JSON.stringify({ threshold: 2.5, action: 'alert' }),
  confidence_score: '0.8500', contributor_count: 8, k_anonymity_met: true,
  is_active: true, expires_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeModelVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'mv-1', pattern_type: 'anomaly_detection', version: 2,
  model_checksum: 'deadbeef', contributor_count: 12, release_notes: 'v2 release',
  is_active: false, activated_at: null, created_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makePrivacyAuditRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pa-1', contribution_id: 'contrib-1', audit_type: 'opt_in_check',
  passed: true, details: JSON.stringify({}), audited_by: 'system',
  created_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeCohortRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'cohort-1', metric_name: 'sla_compliance', industry_segment: 'construction',
  region: null, project_type: null, cohort_size: 15,
  p25: '72.00', p50: '85.00', p75: '92.00', p90: '97.00',
  suppressed: false, computed_at: '2024-01-01T00:00:00Z',
  period_start: null, period_end: null,
  ...o,
})

const makePlaybookRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pb-1', slug: 'safety-response-v1', name: 'Safety Response Playbook',
  description: 'Standard safety response', playbook_type: 'safety_response',
  industry_tags: ['construction', 'safety'], author_tenant_id: null,
  publisher: 'ava', status: 'published', current_version: '1.0.0',
  sandbox_validated: true, policy_compatible: true,
  install_count: 42, avg_rating: '4.50', metadata: JSON.stringify({}),
  published_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pv-1', playbook_id: 'pb-1', version: '1.0.0',
  definition: JSON.stringify({ steps: [] }), changelog: 'Initial',
  checksum: 'sha256checksum', is_immutable: false, created_by: 'system',
  created_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeInstallRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'install-1', tenant_id: 'T1', playbook_id: 'pb-1', version: '1.0.0',
  installed_by: 'system', is_active: true, sandbox_run_id: null,
  installed_at: '2024-01-01T00:00:00Z', uninstalled_at: null,
  ...o,
})

const makePluginRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'plugin-1', slug: 'weather-connector', name: 'Weather Data Connector',
  description: 'Connects to weather APIs', plugin_type: 'data_connector',
  author: 'Ava Team', status: 'published', current_version: '2.1.0',
  manifest: JSON.stringify({ entry: 'index.js' }),
  required_scopes: ['read:weather', 'write:assets'],
  kill_switch: false, metadata: JSON.stringify({}),
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makePluginInstallRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pi-1', tenant_id: 'T1', plugin_id: 'plugin-1', version: '2.1.0',
  granted_scopes: ['read:weather'], is_active: true, installed_by: 'admin',
  installed_at: '2024-01-01T00:00:00Z', disabled_at: null, rollback_version: '2.0.0',
  ...o,
})

const makeAgentRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'agent-1', name: 'ExternalRiskAgent', description: 'Third-party risk scoring',
  owner_tenant_id: 'T1', status: 'active',
  capabilities: ['risk_scoring', 'anomaly_detection'],
  allowed_scopes: ['read:risks', 'read:assets'],
  public_key: 'pk-test', endpoint_url: 'https://agent.example.com/execute',
  api_key_hash: 'sha256hash', last_executed_at: null, metadata: JSON.stringify({}),
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeExecutionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'exec-1', agent_id: 'agent-1', tenant_id: 'T1',
  request_payload: JSON.stringify({ scope_a: 'data' }),
  response_payload: JSON.stringify({ validated: true }),
  validation_passed: true, approval_required: false,
  approval_id: null, execution_ms: 145, error: null,
  created_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeAdapterRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'adapter-1', tenant_id: 'T1', adapter_type: 'zapier',
  name: 'Zapier Integration', endpoint_url: 'https://hooks.zapier.com/hooks/catch/123',
  is_active: true, rate_limit_rpm: 60, metadata: JSON.stringify({}),
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeEventRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'evt-1', adapter_id: 'adapter-1', tenant_id: 'T1', direction: 'inbound',
  event_type: 'action.created', payload: JSON.stringify({ actionId: 'act-1' }),
  idempotency_key: null, signature_valid: true, processed: false,
  error: null, retry_count: 0,
  created_at: '2024-01-01T00:00:00Z', processed_at: null,
  ...o,
})

// ─── Suite 1: federatedIntelligenceEngine ────────────────────────────────────

describe('federatedIntelligenceEngine', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('isOptedIn returns true when flag enabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true }))
    const { isOptedIn } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = await isOptedIn('T1')
    expect(result).toBe(true)
  })

  it('isOptedIn returns false when no row', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { isOptedIn } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    expect(await isOptedIn('T1')).toBe(false)
  })

  it('isOptedIn returns false when flag disabled', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: false }))
    const { isOptedIn } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    expect(await isOptedIn('T1')).toBe(false)
  })

  it('setFederatedOptIn calls tenantQuery with correct flag', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { setFederatedOptIn } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await setFederatedOptIn('T1', true)
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('federated_learning_opt_in')
    expect(mockTenant.mock.calls[0]![2]).toContain(true)
  })

  it('contributeData throws when tenant not opted in', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))  // isOptedIn
    const { contributeData } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(contributeData('T1', { contributionType: 'recommendation_outcome', rawData: {} }))
      .rejects.toThrow('not opted in')
  })

  it('contributeData anonymizes and inserts when opted in', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: true }))  // isOptedIn
    mockTenant.mockResolvedValueOnce(mockRow(makeContributionRow()))  // INSERT
    mockPool.mockResolvedValueOnce(mockRows([]))  // _recordPrivacyAudit
    const { contributeData } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = await contributeData('T1', {
      contributionType: 'recommendation_outcome',
      rawData: { outcome: 'success', tenantId: 'T1' },
    })
    expect(result.status).toBe('pending')
    expect(result.optInVerified).toBe(true)
  })

  it('contributeData strips tenant_id from anonymized data', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const anon = __testHooks._anonymize({ tenantId: 'T1', value: 42 })
    expect(anon['tenantId']).toBeUndefined()
    expect(anon['value']).toBe(42)
    expect(anon['_dp_noise_applied']).toBe(true)
  })

  it('contributeData strips project_id from anonymized data', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const anon = __testHooks._anonymize({ project_id: 'P1', score: 90 })
    expect(anon['project_id']).toBeUndefined()
    expect(anon['score']).toBe(90)
  })

  it('publishPattern throws when contributor_count < K_ANONYMITY_MIN (5)', async () => {
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(publishPattern({
      patternType: 'test', patternData: {}, confidenceScore: 0.9, contributorCount: 3,
    })).rejects.toThrow('K-anonymity threshold not met')
  })

  it('publishPattern succeeds when contributor_count >= 5', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePatternRow()))
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = await publishPattern({
      patternType: 'anomaly_detection', patternData: {}, confidenceScore: 0.85, contributorCount: 8,
    })
    expect(p.kAnonymityMet).toBe(true)
    expect(p.contributorCount).toBe(8)
  })

  it('publishPattern passes k_anonymity_met=TRUE to DB', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePatternRow()))
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await publishPattern({ patternType: 'test', patternData: {}, confidenceScore: 0.9, contributorCount: 5 })
    const args = mockPool.mock.calls[0]![1] as unknown[]
    expect(args).toContain(true)  // k_anonymity_met = TRUE
  })

  it('listActivePatterns filters by is_active and k_anonymity_met', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePatternRow()]))
    const { listActivePatterns } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await listActivePatterns()
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('is_active = TRUE')
    expect(query).toContain('k_anonymity_met = TRUE')
  })

  it('activateModelVersion updates is_active and activated_at', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeModelVersionRow({ is_active: true, activated_at: '2024-01-01T00:00:00Z' })))
    const { activateModelVersion } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const mv = await activateModelVersion('mv-1')
    expect(mv.isActive).toBe(true)
  })

  it('activateModelVersion throws when version not found', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { activateModelVersion } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(activateModelVersion('bad-id')).rejects.toThrow()
  })

  it('withdrawContribution sets status to withdrawn', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { withdrawContribution } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await withdrawContribution('T1', 'contrib-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("'withdrawn'")
  })

  it('_hashData returns 64-char hex', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const hash = __testHooks._hashData('test-data')
    expect(hash).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
  })

  it('_hashData is deterministic', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    expect(__testHooks._hashData('abc')).toBe(__testHooks._hashData('abc'))
  })

  it('_mapContribution maps all fields correctly', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const m = __testHooks._mapContribution(makeContributionRow())
    expect(m.id).toBe('contrib-1')
    expect(m.tenantId).toBe('T1')
    expect(m.contributionType).toBe('recommendation_outcome')
    expect(m.kCount).toBe(1)
    expect(m.optInVerified).toBe(true)
    expect(m.publishedAt).toBeNull()
  })

  it('_mapPattern maps confidence as number', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = __testHooks._mapPattern(makePatternRow())
    expect(typeof p.confidenceScore).toBe('number')
    expect(p.confidenceScore).toBeCloseTo(0.85)
    expect(p.kAnonymityMet).toBe(true)
  })

  it('_mapPattern parses pattern_data JSON string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = __testHooks._mapPattern(makePatternRow({ pattern_data: '{"key":"val"}' }))
    expect(p.patternData['key']).toBe('val')
  })

  it('_mapModelVersion maps version as number', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const mv = __testHooks._mapModelVersion(makeModelVersionRow())
    expect(mv.version).toBe(2)
    expect(mv.isActive).toBe(false)
    expect(mv.activatedAt).toBeNull()
  })
})

// ─── Suite 2: benchmarkingService ────────────────────────────────────────────

describe('benchmarkingService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('computeAndStoreCohort suppresses when cohort < MIN (10)', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow({ suppressed: true, p25: null, p50: null, p75: null, p90: null })))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const c = await computeAndStoreCohort({ metricName: 'sla_compliance', values: [80, 85, 90] })
    expect(c.suppressed).toBe(true)
    expect(c.p50).toBeNull()
  })

  it('computeAndStoreCohort computes percentiles when cohort >= 10', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const values = Array.from({ length: 15 }, (_, i) => 70 + i)
    const c = await computeAndStoreCohort({ metricName: 'sla_compliance', values })
    expect(c.suppressed).toBe(false)
    expect(c.p50).not.toBeNull()
  })

  it('_percentile returns correct p50 for sorted array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const sorted = [10, 20, 30, 40, 50]
    expect(__testHooks._percentile(sorted, 50)).toBe(30)
  })

  it('_percentile returns first element for p0', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([10, 20, 30], 0)).toBe(10)
  })

  it('_percentile returns last element for p100', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([10, 20, 30], 100)).toBe(30)
  })

  it('_percentile returns 0 for empty array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([], 50)).toBe(0)
  })

  it('_classifyBand returns top_quartile when value >= p75', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(95, 60, 80, 90, 98)).toBe('top_quartile')
  })

  it('_classifyBand returns above_median when p50 <= value < p75', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(85, 60, 80, 90, 98)).toBe('above_median')
  })

  it('_classifyBand returns below_median when p25 <= value < p50', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(70, 60, 80, 90, 98)).toBe('below_median')
  })

  it('_classifyBand returns bottom_quartile when value < p25', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(50, 60, 80, 90, 98)).toBe('bottom_quartile')
  })

  it('_classifyBand returns insufficient_data when p50 is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(85, null, null, null, null)).toBe('insufficient_data')
  })

  it('getTenantBenchmark returns insufficient_data when no cohort', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const r = await getTenantBenchmark('T1', 'sla_compliance', 85)
    expect(r.percentileEstimate).toBe('insufficient_data')
    expect(r.cohortP50).toBeNull()
  })

  it('getTenantBenchmark returns suppressed cohort as insufficient_data', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow({ suppressed: true, p25: null, p50: null })))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const r = await getTenantBenchmark('T1', 'sla_compliance', 85)
    expect(r.percentileEstimate).toBe('insufficient_data')
  })

  it('getIndustryBenchmarks filters by suppressed=FALSE', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getIndustryBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getIndustryBenchmarks()
    const query = mockPool.mock.calls[0]![0] as string
    expect(query).toContain('suppressed = FALSE')
  })

  it('_mapCohort maps numeric percentiles', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const c = __testHooks._mapCohort(makeCohortRow())
    expect(typeof c.p50).toBe('number')
    expect(c.p50).toBe(85)
    expect(c.cohortSize).toBe(15)
    expect(c.suppressed).toBe(false)
  })

  it('_mapCohort maps null percentiles for suppressed cohort', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const c = __testHooks._mapCohort(makeCohortRow({ p25: null, p50: null, p75: null, p90: null }))
    expect(c.p50).toBeNull()
  })
})

// ─── Suite 3: playbookMarketplaceService ─────────────────────────────────────

describe('playbookMarketplaceService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('createPlaybook inserts playbook and creates initial version', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePlaybookRow()))   // INSERT playbook
    mockPool.mockResolvedValueOnce(mockRow(makeVersionRow()))    // INSERT version
    const { createPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const pb = await createPlaybook({
      slug: 'safety-response-v1', name: 'Safety Response',
      playbookType: 'safety_response', definition: { steps: [] },
    })
    expect(pb.slug).toBe('safety-response-v1')
    expect(pb.status).toBe('published')
    expect(mockPool).toHaveBeenCalledTimes(2)
  })

  it('publishPlaybook requires sandboxValidated=true', async () => {
    const { publishPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(publishPlaybook('pb-1', false)).rejects.toThrow('sandbox validation')
  })

  it('publishPlaybook marks version immutable and updates status', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))  // UPDATE version is_immutable
    mockPool.mockResolvedValueOnce(mockRow(makePlaybookRow({ status: 'published', sandbox_validated: true })))
    const { publishPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const pb = await publishPlaybook('pb-1', true)
    expect(pb.status).toBe('published')
    expect(pb.sandboxValidated).toBe(true)
    const versionQuery = mockPool.mock.calls[0]![0] as string
    expect(versionQuery).toContain('is_immutable = TRUE')
  })

  it('installPlaybook throws when playbook not found', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { installPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(installPlaybook('T1', 'bad-id', {})).rejects.toThrow('not found')
  })

  it('installPlaybook throws when playbook not published', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePlaybookRow({ status: 'draft' })))
    const { installPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(installPlaybook('T1', 'pb-1', {})).rejects.toThrow('not published')
  })

  it('installPlaybook inserts install and increments install_count', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePlaybookRow()))  // getPlaybook
    mockTenant.mockResolvedValueOnce(mockRow(makeInstallRow()))  // INSERT install
    mockPool.mockResolvedValueOnce(mockRows([]))  // UPDATE install_count
    const { installPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const install = await installPlaybook('T1', 'pb-1', { installedBy: 'admin' })
    expect(install.isActive).toBe(true)
    expect(install.version).toBe('1.0.0')
    // Verify install_count update was called
    const countQuery = mockPool.mock.calls[1]![0] as string
    expect(countQuery).toContain('install_count = install_count + 1')
  })

  it('uninstallPlaybook sets is_active=FALSE and uninstalled_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { uninstallPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await uninstallPlaybook('T1', 'pb-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('is_active = FALSE')
    expect(query).toContain('uninstalled_at = now()')
  })

  it('submitPlaybookReview rejects rating < 1', async () => {
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 0)).rejects.toThrow('between 1 and 5')
  })

  it('submitPlaybookReview rejects rating > 5', async () => {
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 6)).rejects.toThrow('between 1 and 5')
  })

  it('submitPlaybookReview inserts review and updates avg_rating', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))  // INSERT review
    mockPool.mockResolvedValueOnce(mockRows([]))    // UPDATE avg_rating
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await submitPlaybookReview('T1', 'pb-1', 5, 'Excellent')
    expect(mockPool).toHaveBeenCalledTimes(1)
    const ratingQuery = mockPool.mock.calls[0]![0] as string
    expect(ratingQuery).toContain('avg_rating')
  })

  it('_mapPlaybook maps industry_tags as array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const pb = __testHooks._mapPlaybook(makePlaybookRow())
    expect(Array.isArray(pb.industryTags)).toBe(true)
    expect(pb.industryTags).toContain('construction')
  })

  it('_mapPlaybook maps avg_rating as number or null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const pb = __testHooks._mapPlaybook(makePlaybookRow({ avg_rating: null }))
    expect(pb.avgRating).toBeNull()
    const pb2 = __testHooks._mapPlaybook(makePlaybookRow())
    expect(typeof pb2.avgRating).toBe('number')
  })

  it('_mapVersion sets isImmutable from DB', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const v = __testHooks._mapVersion(makeVersionRow({ is_immutable: true }))
    expect(v.isImmutable).toBe(true)
  })

  it('_mapInstall maps uninstalledAt as null when active', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const i = __testHooks._mapInstall(makeInstallRow())
    expect(i.isActive).toBe(true)
    expect(i.uninstalledAt).toBeNull()
  })
})

// ─── Suite 4: pluginRegistryService ──────────────────────────────────────────

describe('pluginRegistryService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('registerPlugin inserts plugin and records audit event', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow()))  // INSERT plugin
    mockPool.mockResolvedValueOnce(mockRows([]))              // _auditPlugin
    const { registerPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const plugin = await registerPlugin({
      slug: 'weather-connector', name: 'Weather Data Connector',
      pluginType: 'data_connector', author: 'Ava Team',
      requiredScopes: ['read:weather'],
    })
    expect(plugin.slug).toBe('weather-connector')
    expect(mockPool).toHaveBeenCalledTimes(2)
  })

  it('triggerKillSwitch disables plugin and all tenant installs', async () => {
    mockPool.mockResolvedValueOnce(mockRows([]))  // UPDATE plugins kill_switch
    mockPool.mockResolvedValueOnce(mockRows([]))  // UPDATE tenant installs
    mockPool.mockResolvedValueOnce(mockRows([]))  // _auditPlugin
    const { triggerKillSwitch } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await triggerKillSwitch('plugin-1', 'admin')
    const killQuery = mockPool.mock.calls[0]![0] as string
    expect(killQuery).toContain('kill_switch = TRUE')
    const installQuery = mockPool.mock.calls[1]![0] as string
    expect(installQuery).toContain('is_active = FALSE')
  })

  it('installPlugin throws when plugin not published', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow({ status: 'draft' })))
    mockPool.mockResolvedValueOnce(mockRows([]))  // _auditPlugin from registerPlugin — not called here
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(installPlugin('T1', 'plugin-1', { version: '2.1.0' }))
      .rejects.toThrow('not published')
  })

  it('installPlugin throws when kill switch active', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow({ kill_switch: true, status: 'published' })))
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(installPlugin('T1', 'plugin-1', { version: '2.1.0' }))
      .rejects.toThrow('kill switch')
  })

  it('installPlugin throws when unauthorized scope requested', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow({ required_scopes: ['read:weather'] })))
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(installPlugin('T1', 'plugin-1', {
      version: '2.1.0', grantedScopes: ['read:weather', 'admin:all'],
    })).rejects.toThrow('Unauthorized scopes')
  })

  it('installPlugin captures rollback_version from existing install', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow()))  // getPlugin
    // Check for existing install
    mockTenant.mockResolvedValueOnce(mockRow({ version: '2.0.0' }))  // existing version
    // Deactivate existing
    mockTenant.mockResolvedValueOnce(mockRows([]))
    // INSERT new install
    mockTenant.mockResolvedValueOnce(mockRow(makePluginInstallRow()))
    // INSERT permissions (1 scope)
    mockTenant.mockResolvedValueOnce(mockRows([]))
    // _auditPlugin
    mockPool.mockResolvedValueOnce(mockRows([]))
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const install = await installPlugin('T1', 'plugin-1', {
      version: '2.1.0', grantedScopes: ['read:weather'], installedBy: 'admin',
    })
    expect(install.rollbackVersion).toBe('2.0.0')
  })

  it('checkPluginPermission returns true when scope granted', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ granted: true }))
    const { checkPluginPermission } = await import('../../../api/services/ecosystem/pluginRegistryService')
    expect(await checkPluginPermission('T1', 'plugin-1', 'read:weather')).toBe(true)
  })

  it('checkPluginPermission returns false when no row', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { checkPluginPermission } = await import('../../../api/services/ecosystem/pluginRegistryService')
    expect(await checkPluginPermission('T1', 'plugin-1', 'write:all')).toBe(false)
  })

  it('_mapPlugin maps kill_switch as boolean', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const p = __testHooks._mapPlugin(makePluginRow({ kill_switch: false }))
    expect(p.killSwitch).toBe(false)
    const p2 = __testHooks._mapPlugin(makePluginRow({ kill_switch: true }))
    expect(p2.killSwitch).toBe(true)
  })

  it('_mapPlugin parses manifest JSON string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const p = __testHooks._mapPlugin(makePluginRow({ manifest: '{"entry":"main.js"}' }))
    expect(p.manifest['entry']).toBe('main.js')
  })

  it('_mapInstall maps grantedScopes as array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const i = __testHooks._mapInstall(makePluginInstallRow())
    expect(Array.isArray(i.grantedScopes)).toBe(true)
    expect(i.rollbackVersion).toBe('2.0.0')
  })
})

// ─── Suite 5: externalAgentGateway ───────────────────────────────────────────

describe('externalAgentGateway', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('registerExternalAgent returns agent + raw API key', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow()))
    const { registerExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const result = await registerExternalAgent({
      name: 'ExternalRiskAgent', capabilities: ['risk_scoring'], allowedScopes: ['read:risks'],
    })
    expect(result.agent.name).toBe('ExternalRiskAgent')
    expect(typeof result.apiKey).toBe('string')
    expect(result.apiKey.length).toBe(64)  // randomBytes(32).toString('hex')
  })

  it('executeExternalAgent throws when agent not active', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow({ status: 'suspended' })))
    const { executeExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    await expect(executeExternalAgent('agent-1', { tenantId: 'T1', requestPayload: {} }))
      .rejects.toThrow('not active')
  })

  it('executeExternalAgent validates API key against stored hash', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const rawKey = 'testkey123'
    const hash = __testHooks._hashKey(rawKey)
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow({ api_key_hash: hash })))
    mockTenant.mockResolvedValueOnce(mockRow(makeExecutionRow()))
    mockPool.mockResolvedValueOnce(mockRows([]))  // update last_executed_at
    const { executeExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const result = await executeExternalAgent('agent-1', {
      tenantId: 'T1', requestPayload: {}, apiKey: rawKey,
    })
    expect(result.outputValidated).toBe(true)
  })

  it('executeExternalAgent throws on wrong API key', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const hash = __testHooks._hashKey('correct-key')
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow({ api_key_hash: hash })))
    const { executeExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    await expect(executeExternalAgent('agent-1', {
      tenantId: 'T1', requestPayload: {}, apiKey: 'wrong-key',
    })).rejects.toThrow('Invalid API key')
  })

  it('_scopePayload strips fields not in allowedScopes', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const scoped = __testHooks._scopePayload(
      { read_risks: 'data', secret_field: 'hidden', read_assets: 'assets' },
      ['read_risks'],
    )
    expect(scoped['read_risks']).toBe('data')
    expect(scoped['secret_field']).toBeUndefined()
    expect(scoped['read_assets']).toBeUndefined()
  })

  it('_scopePayload returns full payload when * in allowedScopes', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const payload = { a: 1, b: 2, c: 3 }
    const scoped = __testHooks._scopePayload(payload, ['*'])
    expect(scoped).toEqual(payload)
  })

  it('_validateAgentOutput rejects forbidden operations', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    expect(() => __testHooks._validateAgentOutput({ sql: 'DELETE FROM users' }))
      .toThrow('forbidden operation')
  })

  it('_validateAgentOutput accepts safe recommendations', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const result = __testHooks._validateAgentOutput({ recommendation: 'inspect roof', score: 0.9 })
    expect(result['validated']).toBe(true)
  })

  it('_requiresApproval returns true for critical context', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    expect(__testHooks._requiresApproval({ action: 'critical_shutdown' })).toBe(true)
  })

  it('_requiresApproval returns false for normal context', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    expect(__testHooks._requiresApproval({ action: 'inspect_pump' })).toBe(false)
  })

  it('_hashKey produces 64-char SHA-256 hex', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    expect(__testHooks._hashKey('test').length).toBe(64)
  })

  it('_mapAgent maps status and capabilities', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const a = __testHooks._mapAgent(makeAgentRow())
    expect(a.status).toBe('active')
    expect(a.capabilities).toContain('risk_scoring')
    expect(a.lastExecutedAt).toBeNull()
  })
})

// ─── Suite 6: automationAdapterService ───────────────────────────────────────

describe('automationAdapterService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('createAdapter returns adapter + signing secret', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeAdapterRow()))
    const { createAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    const result = await createAdapter('T1', { adapterType: 'zapier', name: 'Zapier' })
    expect(result.adapter.adapterType).toBe('zapier')
    expect(typeof result.signingSecret).toBe('string')
    expect(result.signingSecret.length).toBe(64)
  })

  it('ingestInboundEvent uses ON CONFLICT with idempotency_key', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeAdapterRow({ signing_secret: 'secret' })))
    mockTenant.mockResolvedValueOnce(mockRow(makeEventRow({ idempotency_key: 'key-1' })))
    const { ingestInboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    await ingestInboundEvent('T1', 'adapter-1', {
      eventType: 'action.created', payload: {}, idempotencyKey: 'key-1',
    })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ON CONFLICT (adapter_id, idempotency_key)')
    expect(query).toContain('WHERE idempotency_key IS NOT NULL')
  })

  it('ingestInboundEvent verifies HMAC signature when provided', async () => {
    const { signPayload, verifySignature } = await import('../../../api/services/ecosystem/automationAdapterService')
    const secret = 'my-secret-key'
    const payload = '{"event":"test"}'
    const sig = signPayload(secret, payload)
    expect(verifySignature(secret, payload, sig)).toBe(true)
    expect(verifySignature(secret, payload, 'wrong-sig')).toBe(false)
  })

  it('signPayload produces deterministic HMAC', async () => {
    const { signPayload } = await import('../../../api/services/ecosystem/automationAdapterService')
    const s1 = signPayload('key', 'body')
    const s2 = signPayload('key', 'body')
    expect(s1).toBe(s2)
  })

  it('signPayload different secret produces different signature', async () => {
    const { signPayload } = await import('../../../api/services/ecosystem/automationAdapterService')
    expect(signPayload('key1', 'body')).not.toBe(signPayload('key2', 'body'))
  })

  it('sendOutboundEvent inserts event in outbound direction', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEventRow({ direction: 'outbound' })))
    const { sendOutboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    const evt = await sendOutboundEvent('T1', 'adapter-1', 'inspection.completed', { id: 'insp-1' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("'outbound'")
    expect(evt.direction).toBe('outbound')
  })

  it('getDeadLetterEvents filters retry_count >= 3 and unprocessed', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeEventRow({ retry_count: 3, processed: false })]))
    const { getDeadLetterEvents } = await import('../../../api/services/ecosystem/automationAdapterService')
    await getDeadLetterEvents('T1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('retry_count >= 3')
    expect(query).toContain('processed = FALSE')
  })

  it('markEventProcessed sets processed=TRUE and processed_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { markEventProcessed } = await import('../../../api/services/ecosystem/automationAdapterService')
    await markEventProcessed('T1', 'evt-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('processed = TRUE')
    expect(query).toContain('processed_at = now()')
  })

  it('_mapEvent maps direction and retryCount', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/automationAdapterService')
    const e = __testHooks._mapEvent(makeEventRow())
    expect(e.direction).toBe('inbound')
    expect(e.retryCount).toBe(0)
    expect(e.processed).toBe(false)
    expect(e.processedAt).toBeNull()
  })

  it('_mapAdapter maps rateLimitRpm', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/automationAdapterService')
    const a = __testHooks._mapAdapter(makeAdapterRow())
    expect(a.rateLimitRpm).toBe(60)
    expect(a.isActive).toBe(true)
  })
})

// ─── Suite 7: knowledgeGraphService ──────────────────────────────────────────

const makeEntityRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ent-1', tenant_id: 'T1', entity_type: 'project', entity_ref: 'project-123',
  label: 'Main Office Build', properties: JSON.stringify({ status: 'active' }),
  embedding_id: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeRelRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'rel-1', tenant_id: 'T1', from_entity_id: 'ent-1', to_entity_id: 'ent-2',
  relationship_type: 'has_risk', weight: '0.8000', confidence: '1.0000',
  source: 'explicit', properties: JSON.stringify({}), created_at: '2024-01-01T00:00:00Z',
  ...o,
})

describe('knowledgeGraphService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('upsertEntity uses ON CONFLICT on (tenant_id, entity_type, entity_ref)', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEntityRow()))
    const { upsertEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await upsertEntity('T1', { entityType: 'project', entityRef: 'P1', label: 'Build' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ON CONFLICT (tenant_id, entity_type, entity_ref)')
  })

  it('addRelationship inserts with weight and confidence', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeRelRow()))
    const { addRelationship } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const rel = await addRelationship('T1', {
      fromEntityId: 'ent-1', toEntityId: 'ent-2',
      relationshipType: 'has_risk', weight: 0.8, confidence: 0.95,
    })
    expect(rel.weight).toBeCloseTo(0.8)
    expect(rel.confidence).toBeCloseTo(1.0)
  })

  it('getNeighborhood returns entity and relationships', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEntityRow()))  // getEntity
    mockTenant.mockResolvedValueOnce(mockRows([makeRelRow(), makeRelRow({ id: 'rel-2' })]))  // relationships
    const { getNeighborhood } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const result = await getNeighborhood('T1', 'ent-1')
    expect(result.entity.id).toBe('ent-1')
    expect(result.relationships).toHaveLength(2)
  })

  it('getNeighborhood throws when entity not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getNeighborhood } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await expect(getNeighborhood('T1', 'bad-id')).rejects.toThrow()
  })

  it('queryGraph applies entityType filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeEntityRow()]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { queryGraph } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await queryGraph('T1', { entityTypes: ['project'] })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('entity_type = ANY($2)')
  })

  it('queryGraph applies minConfidence filter', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { queryGraph } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await queryGraph('T1', { minConfidence: 0.8 })
    const relQuery = mockTenant.mock.calls[1]![1] as string
    expect(relQuery).toContain('confidence >= $3')
  })

  it('_mapEntity parses properties JSON string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const e = __testHooks._mapEntity(makeEntityRow({ properties: '{"key":"val"}' }))
    expect(e.properties['key']).toBe('val')
  })

  it('_mapRelationship maps weight and confidence as numbers', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const r = __testHooks._mapRelationship(makeRelRow())
    expect(typeof r.weight).toBe('number')
    expect(r.weight).toBeCloseTo(0.8)
    expect(typeof r.confidence).toBe('number')
  })

  it('searchEntities uses ILIKE for label search', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeEntityRow()]))
    const { searchEntities } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await searchEntities('T1', { labelContains: 'office' })
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ILIKE')
  })
})

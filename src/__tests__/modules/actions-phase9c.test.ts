/**
 * Denver Engineering — Phase 9c Test Suite (v9.0.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 9 — Mapper coverage, query shapes, and boundary tests.
 * Extends Phase 9a/9b to reach 360+ total Phase 9 tests.
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
const mockRow  = (row:  Record<string, unknown>)    => ({ rows: [row] } as never)
const mockEmpty = () => ({ rows: [], rowCount: 0 } as never)

const NOW = '2025-01-01T00:00:00.000Z'

// ─── Row factories ────────────────────────────────────────────────────────────

const makeContributionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'contrib-1', tenant_id: 'T1', contribution_type: 'resource_optimization',
  anonymized_data: JSON.stringify({ value: 42, _dp_noise_applied: true }),
  privacy_hash: 'abc123', k_count: 1, status: 'active', opt_in_verified: true,
  rejected_reason: null, published_at: null,
  created_at: NOW, updated_at: NOW, ...o,
})

const makePatternRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pat-1', pattern_type: 'sla_response', industry_segment: 'saas',
  region: 'us-west', project_type: 'platform',
  pattern_data: JSON.stringify({ p50: 120 }),
  confidence_score: '0.88', contributor_count: 10, k_anonymity_met: true,
  version: 2, is_active: true, expires_at: null,
  created_at: NOW, updated_at: NOW, ...o,
})

const makeModelVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'mv-1', pattern_type: 'sla_response', version: 3,
  model_checksum: 'deadbeef', contributor_count: 15,
  release_notes: 'v3 improvements', is_active: false,
  activated_at: null, created_at: NOW, ...o,
})

const makePrivacyAuditRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'audit-1', contribution_id: 'contrib-1', audit_type: 'opt_in_check',
  passed: true, details: JSON.stringify({ tenantId: 'T1' }),
  audited_by: 'system', created_at: NOW, ...o,
})

const makeCohortRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'cohort-1', metric_name: 'sla_compliance', industry_segment: 'fintech',
  region: 'us-east', project_type: null, cohort_size: 20,
  p25: '70', p50: '85', p75: '95', p90: '99',
  suppressed: false, computed_at: NOW, period_start: null, period_end: null, ...o,
})

const makePlaybookRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pb-1', slug: 'incident-response', name: 'Incident Response',
  description: 'How to handle incidents', playbook_type: 'runbook',
  industry_tags: ['saas', 'fintech'], author_tenant_id: 'T1',
  publisher: 'ava', status: 'published', current_version: '2.0.0',
  install_count: 5, avg_rating: '4.5', rating_count: 12,
  sandbox_validated: true, created_at: NOW, updated_at: NOW, ...o,
})

const makePlaybookVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pv-1', playbook_id: 'pb-1', version: '2.0.0',
  definition: JSON.stringify({ steps: [] }), checksum: 'sha256checksum',
  changelog: 'Added new steps', sandbox_validated: false,
  is_immutable: false, published_at: null, created_at: NOW, ...o,
})

const makePluginRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'plugin-1', slug: 'my-plugin', name: 'My Plugin',
  description: 'A test plugin', plugin_type: 'integration',
  status: 'active', author_tenant_id: 'T1', author: 'T1-user',
  required_scopes: ['read:tickets', 'write:tickets'],
  platform_enabled: true, current_version: '1.0.0',
  install_count: 3, created_at: NOW, updated_at: NOW, ...o,
})

const makePluginVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pv-plugin-1', plugin_id: 'plugin-1', version: '1.0.0',
  changelog: 'Initial release', released_at: NOW, created_at: NOW, ...o,
})

const makePluginInstallRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'install-1', tenant_id: 'T1', plugin_id: 'plugin-1',
  installed_version: '1.0.0', rollback_version: null,
  granted_scopes: ['read:tickets'], config: JSON.stringify({}),
  is_active: true, installed_at: NOW, updated_at: NOW, ...o,
})

const makePluginAuditRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pa-1', plugin_id: 'plugin-1', tenant_id: 'T1',
  event_type: 'installed', actor: 'admin',
  details: JSON.stringify({}), created_at: NOW, ...o,
})

const makeAgentRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'agent-1', name: 'Test Agent', description: 'A test agent',
  owner_tenant_id: 'T1', status: 'active',
  capabilities: ['read', 'write'], allowed_scopes: ['tickets'],
  api_key_hash: 'hashvalue', last_executed_at: null,
  created_at: NOW, updated_at: NOW, ...o,
})

const makeAgentExecutionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'exec-1', agent_id: 'agent-1', tenant_id: 'T1',
  input_payload: JSON.stringify({}), output_payload: null,
  validation_passed: true, approval_required: false,
  execution_ms: 120, error: null, created_at: NOW, ...o,
})

const makeAdapterRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'adapter-1', tenant_id: 'T1', name: 'Slack Adapter',
  adapter_type: 'custom_webhook',
  config: JSON.stringify({ url: 'https://slack.com/hook' }),
  secret: 'shhhh', is_active: true, created_at: NOW, updated_at: NOW, ...o,
})

const makeEventRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'event-1', adapter_id: 'adapter-1', tenant_id: 'T1',
  event_type: 'ticket.created', payload: JSON.stringify({ id: 't-1' }),
  direction: 'inbound', idempotency_key: 'key-abc',
  processed: false, retry_count: 0, error: null,
  created_at: NOW, updated_at: NOW, ...o,
})

const makeKgEntityRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'entity-1', tenant_id: 'T1', entity_type: 'system',
  entity_ref: 'auth-service', label: 'Auth Service',
  properties: JSON.stringify({ version: '1.2' }),
  embedding_id: null, created_at: NOW, updated_at: NOW, ...o,
})

const makeKgRelationshipRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'rel-1', tenant_id: 'T1', from_entity_id: 'entity-1',
  to_entity_id: 'entity-2', relationship_type: 'depends_on',
  weight: 1, properties: JSON.stringify({}), created_at: NOW, ...o,
})

const makeEdgeNodeRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'node-1', tenant_id: 'T1', node_name: 'site-a', status: 'active',
  public_key: 'pk-abc', identity_hash: 'ihash', region: 'us-west',
  site_label: 'Main Office', last_seen_at: NOW,
  capabilities: ['execute', 'relay'], active_since: NOW,
  revoked_at: null, created_at: NOW, updated_at: NOW, ...o,
})

const makeEdgeSyncRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'completed',
  records_synced: 50, conflicts_detected: 0, conflicts_resolved: 0,
  started_at: NOW, completed_at: NOW, ...o,
})

const makeEdgeCommandRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'cmd-1', edge_node_id: 'node-1', tenant_id: 'T1',
  command_type: 'reload_config', payload: JSON.stringify({}),
  priority: 5, status: 'pending', acknowledged_at: null, created_at: NOW, ...o,
})

const makeWorkflowRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wf-1', tenant_id: 'T1', name: 'Incident Workflow',
  description: 'Handle incidents', trigger_type: 'manual',
  trigger_config: JSON.stringify({}),
  definition: JSON.stringify({ steps: [{ id: 's1', type: 'notify', name: 'Alert Team' }] }),
  status: 'draft', current_version: 1,
  policy_validated: false, dry_run_passed: false,
  published_at: null, created_by: 'admin', created_at: NOW, updated_at: NOW, ...o,
})

const makeWorkflowVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wfv-1', workflow_id: 'wf-1', version: 1,
  definition: JSON.stringify({ steps: [] }),
  published_by: 'admin', created_at: NOW, ...o,
})

const makeWorkflowRunRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'run-1', workflow_id: 'wf-1', tenant_id: 'T1', status: 'completed',
  trigger_context: JSON.stringify({}), is_dry_run: false,
  steps_executed: 3, steps_skipped: 1, approval_gates_triggered: 0,
  error: null, started_at: NOW, completed_at: NOW, ...o,
})

// ─── Suite 1: Federated Intelligence mapper coverage ─────────────────────────

describe('federatedIntelligenceEngine mappers', () => {
  beforeEach(() => vi.resetAllMocks())

  it('_mapContribution maps all scalar fields', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const c = __testHooks._mapContribution(makeContributionRow({ k_count: 3, published_at: NOW }))
    expect(c.id).toBe('contrib-1')
    expect(c.tenantId).toBe('T1')
    expect(c.contributionType).toBe('resource_optimization')
    expect(c.privacyHash).toBe('abc123')
    expect(c.kCount).toBe(3)
    expect(c.status).toBe('active')
    expect(c.optInVerified).toBe(true)
    expect(c.rejectedReason).toBeNull()
    expect(c.publishedAt).toBeInstanceOf(Date)
    expect(c.createdAt).toBeInstanceOf(Date)
    expect(c.updatedAt).toBeInstanceOf(Date)
  })

  it('_mapContribution parses anonymizedData from JSON string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const c = __testHooks._mapContribution(makeContributionRow({ anonymized_data: '{"value":99}' }))
    expect(c.anonymizedData).toEqual({ value: 99 })
  })

  it('_mapContribution handles object anonymizedData (already parsed)', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const c = __testHooks._mapContribution(makeContributionRow({ anonymized_data: { value: 77 } }))
    expect(c.anonymizedData).toEqual({ value: 77 })
  })

  it('_mapContribution publishedAt null when db field is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const c = __testHooks._mapContribution(makeContributionRow({ published_at: null }))
    expect(c.publishedAt).toBeNull()
  })

  it('_mapPattern maps all fields including nested JSON', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = __testHooks._mapPattern(makePatternRow())
    expect(p.id).toBe('pat-1')
    expect(p.patternType).toBe('sla_response')
    expect(p.industrySegment).toBe('saas')
    expect(p.region).toBe('us-west')
    expect(p.projectType).toBe('platform')
    expect(p.confidenceScore).toBe(0.88)
    expect(p.contributorCount).toBe(10)
    expect(p.kAnonymityMet).toBe(true)
    expect(p.version).toBe(2)
    expect(p.isActive).toBe(true)
    expect(p.expiresAt).toBeNull()
    expect(p.patternData).toEqual({ p50: 120 })
  })

  it('_mapPattern defaults version to 1 when missing', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const row = makePatternRow()
    delete (row as Record<string, unknown>)['version']
    expect(__testHooks._mapPattern(row).version).toBe(1)
  })

  it('_mapModelVersion maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const mv = __testHooks._mapModelVersion(makeModelVersionRow())
    expect(mv.id).toBe('mv-1')
    expect(mv.version).toBe(3)
    expect(mv.modelChecksum).toBe('deadbeef')
    expect(mv.contributorCount).toBe(15)
    expect(mv.releaseNotes).toBe('v3 improvements')
    expect(mv.isActive).toBe(false)
    expect(mv.activatedAt).toBeNull()
    expect(mv.trainingWindow).toBeNull()
  })

  it('_mapModelVersion activatedAt is Date when set', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const mv = __testHooks._mapModelVersion(makeModelVersionRow({ activated_at: NOW, is_active: true }))
    expect(mv.activatedAt).toBeInstanceOf(Date)
    expect(mv.isActive).toBe(true)
  })

  it('_mapPrivacyAudit maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const a = __testHooks._mapPrivacyAudit(makePrivacyAuditRow())
    expect(a.id).toBe('audit-1')
    expect(a.contributionId).toBe('contrib-1')
    expect(a.auditType).toBe('opt_in_check')
    expect(a.passed).toBe(true)
    expect(a.details).toEqual({ tenantId: 'T1' })
    expect(a.createdAt).toBeInstanceOf(Date)
  })

  it('_anonymize strips tenant_id', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = __testHooks._anonymize({ tenant_id: 'T1', value: 42 })
    expect(result['tenant_id']).toBeUndefined()
    expect(result['value']).toBe(42)
  })

  it('_anonymize strips tenantId', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = __testHooks._anonymize({ tenantId: 'T1', score: 5 })
    expect(result['tenantId']).toBeUndefined()
  })

  it('_anonymize strips project_id and projectId', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = __testHooks._anonymize({ project_id: 'p-1', projectId: 'p-1', metric: 5 })
    expect(result['project_id']).toBeUndefined()
    expect(result['projectId']).toBeUndefined()
  })

  it('_anonymize strips user_id and userId', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const result = __testHooks._anonymize({ user_id: 'u-1', userId: 'u-1', score: 99 })
    expect(result['user_id']).toBeUndefined()
    expect(result['userId']).toBeUndefined()
  })

  it('_anonymize adds _dp_noise_applied=true', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    expect(__testHooks._anonymize({ v: 1 })['_dp_noise_applied']).toBe(true)
  })

  it('_anonymize adds _salt as 8-char hex string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const salt = __testHooks._anonymize({ v: 1 })['_salt'] as string
    expect(typeof salt).toBe('string')
    expect(salt.length).toBe(8)
  })

  it('_hashData returns 64-char hex string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const hash = __testHooks._hashData('hello')
    expect(hash.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
  })

  it('_hashData is deterministic', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    expect(__testHooks._hashData('test')).toBe(__testHooks._hashData('test'))
  })
})

// ─── Suite 2: Benchmarking mapper and helpers ─────────────────────────────────

describe('benchmarkingService mappers and helpers', () => {
  beforeEach(() => vi.resetAllMocks())

  it('_mapCohort maps all fields', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const c = __testHooks._mapCohort(makeCohortRow())
    expect(c.id).toBe('cohort-1')
    expect(c.metricName).toBe('sla_compliance')
    expect(c.industrySegment).toBe('fintech')
    expect(c.region).toBe('us-east')
    expect(c.projectType).toBeNull()
    expect(c.cohortSize).toBe(20)
    expect(c.p25).toBe(70)
    expect(c.p50).toBe(85)
    expect(c.p75).toBe(95)
    expect(c.p90).toBe(99)
    expect(c.suppressed).toBe(false)
    expect(c.computedAt).toBeInstanceOf(Date)
    expect(c.periodStart).toBeNull()
    expect(c.periodEnd).toBeNull()
  })

  it('_mapCohort handles null percentiles (suppressed)', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const c = __testHooks._mapCohort(makeCohortRow({ p25: null, p50: null, p75: null, p90: null, suppressed: true }))
    expect(c.suppressed).toBe(true)
    expect(c.p25).toBeNull()
    expect(c.p50).toBeNull()
  })

  it('_percentile p50 for 4-element array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([10, 20, 30, 40], 50)).toBe(20)
  })

  it('_percentile p75 for 8-element array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([10, 20, 30, 40, 50, 60, 70, 80], 75)).toBe(60)
  })

  it('_percentile p0 returns first element', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([5, 10, 15], 0)).toBe(5)
  })

  it('_percentile returns 0 for empty array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([], 50)).toBe(0)
  })

  it('_percentile single element returns that element', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._percentile([42], 25)).toBe(42)
    expect(__testHooks._percentile([42], 75)).toBe(42)
  })

  it('_classifyBand top_quartile when value >= p75', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(100, 25, 50, 75, 90)).toBe('top_quartile')
    expect(__testHooks._classifyBand(75, 25, 50, 75, 90)).toBe('top_quartile')
  })

  it('_classifyBand above_median when value >= p50 and < p75', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(60, 25, 50, 75, 90)).toBe('above_median')
    expect(__testHooks._classifyBand(50, 25, 50, 75, 90)).toBe('above_median')
  })

  it('_classifyBand below_median when value >= p25 and < p50', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(30, 25, 50, 75, 90)).toBe('below_median')
    expect(__testHooks._classifyBand(25, 25, 50, 75, 90)).toBe('below_median')
  })

  it('_classifyBand bottom_quartile when value < p25', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(10, 25, 50, 75, 90)).toBe('bottom_quartile')
  })

  it('_classifyBand insufficient_data when p25 is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(50, null, 50, 75, 90)).toBe('insufficient_data')
  })

  it('_classifyBand insufficient_data when p50 is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(50, 25, null, 75, 90)).toBe('insufficient_data')
  })

  it('_classifyBand insufficient_data when p75 is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(__testHooks._classifyBand(50, 25, 50, null, 90)).toBe('insufficient_data')
  })

  it('getSlaBenchmarks filters for sla_compliance and incident_closure_time', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getSlaBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getSlaBenchmarks()
    const sql = mockPool.mock.calls[0]![0] as string
    expect(sql).toContain('sla_compliance')
    expect(sql).toContain('incident_closure_time')
  })

  it('getBenchmarkForMetric returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getBenchmarkForMetric } = await import('../../../api/services/ecosystem/benchmarkingService')
    expect(await getBenchmarkForMetric('sla_compliance')).toBeNull()
  })

  it('computeAndStoreCohort suppresses when values.length < 10', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow({ suppressed: true, p25: null, p50: null, p75: null, p90: null })))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await computeAndStoreCohort({ metricName: 'sla_compliance', values: [80, 90, 95] })
    expect(result.suppressed).toBe(true)
  })

  it('getIndustryBenchmarks only returns suppressed=FALSE rows', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getIndustryBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getIndustryBenchmarks()
    const sql = mockPool.mock.calls[0]![0] as string
    expect(sql).toContain('suppressed = FALSE')
  })

  it('getTenantBenchmark returns insufficient_data when cohort is null', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty()) // getBenchmarkForMetric
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 80)
    expect(result.percentileEstimate).toBe('insufficient_data')
    expect(result.cohortP50).toBeNull()
  })
})

// ─── Suite 3: Playbook marketplace coverage ───────────────────────────────────

describe('playbookMarketplaceService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('createPlaybook returns playbook with correct fields', async () => {
    mockPool
      .mockResolvedValueOnce(mockRow(makePlaybookRow()))
      .mockResolvedValueOnce(mockRow(makePlaybookVersionRow()))
    const { createPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const pb = await createPlaybook({ slug: 'incident-response', name: 'Incident Response', playbookType: 'runbook', definition: {} })
    expect(pb.slug).toBe('incident-response')
    expect(pb.name).toBe('Incident Response')
  })

  it('createPlaybook defaults publisher to ava', async () => {
    mockPool
      .mockResolvedValueOnce(mockRow(makePlaybookRow()))
      .mockResolvedValueOnce(mockRow(makePlaybookVersionRow()))
    const { createPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await createPlaybook({ slug: 'test', name: 'Test', playbookType: 'runbook', definition: {} })
    const params = mockPool.mock.calls[0]![1] as unknown[]
    expect(params[6]).toBe('ava')
  })

  it('listPlaybooks query includes playbook_type filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePlaybookRow()]))
    const { listPlaybooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await listPlaybooks({ playbookType: 'runbook' })
    expect((mockPool.mock.calls[0]![0] as string)).toContain('playbook_type')
  })

  it('listPlaybooks query includes industry_tags filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePlaybookRow()]))
    const { listPlaybooks } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await listPlaybooks({ industryTag: 'fintech' })
    expect((mockPool.mock.calls[0]![0] as string)).toContain('industry_tags')
  })

  it('publishPlaybook throws when sandboxValidated=false', async () => {
    const { publishPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(publishPlaybook('pb-1', false)).rejects.toThrow('sandbox validation')
  })

  it('publishPlaybook first UPDATE marks version is_immutable=TRUE', async () => {
    mockPool
      .mockResolvedValueOnce(mockEmpty())
      .mockResolvedValueOnce(mockRow(makePlaybookRow()))
    const { publishPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await publishPlaybook('pb-1', true)
    expect((mockPool.mock.calls[0]![0] as string)).toContain('is_immutable')
  })

  it('installPlaybook throws when playbook not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { installPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(installPlaybook('T1', 'missing')).rejects.toThrow()
  })

  it('getTenantInstalls uses tenantQuery with tenant scope', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getTenantInstalls } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await getTenantInstalls('T1')
    expect(mockTenant).toHaveBeenCalledWith('T1', expect.any(String), expect.any(Array))
  })

  it('submitPlaybookReview rejects rating below 1', async () => {
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 0, 'bad')).rejects.toThrow('Rating must be between 1 and 5')
  })

  it('submitPlaybookReview rejects rating above 5', async () => {
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 6, 'too high')).rejects.toThrow('Rating must be between 1 and 5')
  })

  it('submitPlaybookReview accepts rating=1 (boundary)', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty()).mockResolvedValueOnce(mockRow(makePlaybookRow()))
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 1, 'ok')).resolves.not.toThrow()
  })

  it('submitPlaybookReview accepts rating=5 (boundary)', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty()).mockResolvedValueOnce(mockRow(makePlaybookRow()))
    const { submitPlaybookReview } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await expect(submitPlaybookReview('T1', 'pb-1', 5, 'great')).resolves.not.toThrow()
  })
})

// ─── Suite 4: Plugin registry coverage ───────────────────────────────────────

describe('pluginRegistryService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('registerPlugin query includes required_scopes', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow()))
    const { registerPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await registerPlugin({ slug: 'my-plugin', name: 'My Plugin', author: 'test', pluginType: 'data_connector', requiredScopes: ['read:tickets'] })
    expect((mockPool.mock.calls[0]![0] as string)).toContain('required_scopes')
  })

  it('getPlugin returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    expect(await getPlugin('missing')).toBeNull()
  })

  it('updatePluginStatus returns updated plugin', async () => {
    mockPool
      .mockResolvedValueOnce(mockRow(makePluginRow({ status: 'deprecated' })))
      .mockResolvedValueOnce(mockEmpty()) // _auditPlugin
    const { updatePluginStatus } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const p = await updatePluginStatus('plugin-1', 'suspended')
    expect(p.status).toBe('deprecated')
  })

  it('addPluginVersion query targets plugin_versions', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginVersionRow()))
    const { addPluginVersion } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await addPluginVersion('plugin-1', '2.0.0', { name: 'My Plugin' }, 'bundle-content', 'Breaking changes')
    expect((mockPool.mock.calls[0]![0] as string)).toContain('plugin_versions')
  })

  it('releasePluginVersion sets released_at', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginVersionRow({ released_at: NOW })))
    const { releasePluginVersion } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await releasePluginVersion('pv-plugin-1')
    expect((mockPool.mock.calls[0]![0] as string)).toContain('released_at')
  })

  it('installPlugin throws on unauthorized scopes', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow({ required_scopes: ['read:tickets'], status: 'published' })))
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(installPlugin('T1', 'plugin-1', { version: '1.0.0', grantedScopes: ['read:tickets', 'admin:all'] })).rejects.toThrow('Unauthorized scopes')
  })

  it('installPlugin succeeds with valid subset of required_scopes', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePluginRow({ required_scopes: ['read:tickets', 'write:tickets'], status: 'published' })))
    mockTenant
      .mockResolvedValueOnce(mockEmpty()) // check current install
      .mockResolvedValueOnce(mockRow(makePluginInstallRow())) // INSERT
      .mockResolvedValueOnce(mockEmpty()) // permission record
    mockPool.mockResolvedValueOnce(mockEmpty()) // _auditPlugin
    const { installPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const install = await installPlugin('T1', 'plugin-1', { version: '1.0.0', grantedScopes: ['read:tickets'] })
    expect(install.pluginId).toBe('plugin-1')
  })

  it('disablePlugin sets is_active=FALSE', async () => {
    mockTenant
      .mockResolvedValueOnce(mockEmpty()) // UPDATE install
      .mockResolvedValueOnce(mockEmpty()) // _auditPlugin (uses pool) - actually pool
    mockPool.mockResolvedValueOnce(mockEmpty()) // _auditPlugin
    const { disablePlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await disablePlugin('T1', 'plugin-1')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('is_active = FALSE')
  })

  it('getPluginAuditEvents queries plugin_audit_events', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePluginAuditRow()]))
    const { getPluginAuditEvents } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const events = await getPluginAuditEvents('plugin-1')
    expect(events.length).toBe(1)
    expect(events[0]!.eventType).toBe('installed')
  })

  it('triggerKillSwitch disables kill_switch then all installs then audits', async () => {
    mockPool
      .mockResolvedValueOnce(mockEmpty())  // UPDATE plugins kill_switch=TRUE
      .mockResolvedValueOnce(mockEmpty())  // UPDATE all tenant_plugin_installs
      .mockResolvedValueOnce(mockEmpty())  // INSERT plugin_audit_events (_auditPlugin)
    const { triggerKillSwitch } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await triggerKillSwitch('plugin-1', 'admin')
    expect(mockPool).toHaveBeenCalledTimes(3)
    expect((mockPool.mock.calls[0]![0] as string)).toContain('kill_switch')
  })

  it('listPlugins filters by status', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePluginRow()]))
    const { listPlugins } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await listPlugins({ status: 'published' })
    expect((mockPool.mock.calls[0]![0] as string)).toContain('status')
  })

  it('rollbackPlugin throws when no active install', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { rollbackPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(rollbackPlugin('T1', 'plugin-1')).rejects.toThrow('No active install')
  })

  it('rollbackPlugin throws when rollback_version is null', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makePluginInstallRow({ rollback_version: null })))
    const { rollbackPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(rollbackPlugin('T1', 'plugin-1')).rejects.toThrow('No rollback version')
  })
})

// ─── Suite 5: External agent gateway coverage ─────────────────────────────────

describe('externalAgentGateway coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('registerExternalAgent generates 64-char api key hash', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow()))
    const { registerExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    await registerExternalAgent({ name: 'Test Agent', capabilities: ['read'], allowedScopes: ['tickets'] })
    const params = mockPool.mock.calls[0]![1] as unknown[]
    expect((params[7] as string).length).toBe(64)
  })

  it('getExternalAgent returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    expect(await getExternalAgent('missing')).toBeNull()
  })

  it('listExternalAgents query includes owner_tenant_id filter', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeAgentRow()]))
    const { listExternalAgents } = await import('../../../api/services/ecosystem/externalAgentGateway')
    await listExternalAgents('T1')
    expect((mockPool.mock.calls[0]![0] as string)).toContain('owner_tenant_id')
  })

  it('updateAgentStatus returns agent with new status', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow({ status: 'suspended' })))
    const { updateAgentStatus } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const a = await updateAgentStatus('agent-1', 'suspended')
    expect(a.status).toBe('suspended')
  })

  it('getAgentCapabilities returns capabilities array', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow({ capabilities: ['read', 'write', 'execute'] })))
    const { getAgentCapabilities } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const caps = await getAgentCapabilities('agent-1')
    expect(caps).toEqual(['read', 'write', 'execute'])
  })

  it('executeExternalAgent creates execution record', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeAgentRow()))  // getExternalAgent
    mockTenant.mockResolvedValueOnce(mockRow(makeAgentExecutionRow()))  // INSERT execution
    const { executeExternalAgent } = await import('../../../api/services/ecosystem/externalAgentGateway')
    const result = await executeExternalAgent('agent-1', { tenantId: 'T1', requestPayload: { action: 'list_tickets' } })
    expect(result.execution.agentId).toBe('agent-1')
    expect(result.execution.validationPassed).toBe(true)
  })
})

// ─── Suite 6: Automation adapter coverage ────────────────────────────────────

describe('automationAdapterService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('createAdapter query targets automation_adapters', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeAdapterRow()))
    const { createAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    await createAdapter('T1', { name: 'Slack', adapterType: 'custom_webhook' })
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('automation_adapters')
  })

  it('getAdapter returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { getAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    expect(await getAdapter('T1', 'missing')).toBeNull()
  })

  it('deactivateAdapter sets is_active=FALSE', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { deactivateAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    await deactivateAdapter('T1', 'adapter-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('is_active = FALSE')
  })

  it('ingestInboundEvent uses ON CONFLICT for idempotency', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEventRow()))
    const { ingestInboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    await ingestInboundEvent('T1', 'adapter-1', { eventType: 'ticket.created', payload: {}, idempotencyKey: 'key-abc' })
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('ON CONFLICT')
  })

  it('sendOutboundEvent maps direction=outbound', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEventRow({ direction: 'outbound' })))
    const { sendOutboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    const ev = await sendOutboundEvent('T1', 'adapter-1', 'alert', {})
    expect(ev.direction).toBe('outbound')
  })

  it('markEventProcessed sets processed=TRUE', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { markEventProcessed } = await import('../../../api/services/ecosystem/automationAdapterService')
    await markEventProcessed('T1', 'event-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('processed = TRUE')
  })

  it('getDeadLetterEvents filters retry_count >= 3 and processed=FALSE', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeEventRow({ retry_count: 3 })]))
    const { getDeadLetterEvents } = await import('../../../api/services/ecosystem/automationAdapterService')
    await getDeadLetterEvents('T1')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('retry_count')
    expect(sql).toContain('3')
    expect(sql).toContain('processed')
  })

  it('signPayload returns non-empty string', async () => {
    const { signPayload } = await import('../../../api/services/ecosystem/automationAdapterService')
    expect(signPayload('secret', 'data').length).toBeGreaterThan(0)
  })

  it('verifySignature validates matching signature', async () => {
    const { signPayload, verifySignature } = await import('../../../api/services/ecosystem/automationAdapterService')
    const sig = signPayload('secret', 'payload')
    expect(verifySignature('secret', 'payload', sig)).toBe(true)
  })

  it('verifySignature rejects wrong secret', async () => {
    const { signPayload, verifySignature } = await import('../../../api/services/ecosystem/automationAdapterService')
    const sig = signPayload('secret1', 'payload')
    expect(verifySignature('secret2', 'payload', sig)).toBe(false)
  })

  it('verifySignature rejects tampered payload', async () => {
    const { signPayload, verifySignature } = await import('../../../api/services/ecosystem/automationAdapterService')
    const sig = signPayload('secret', 'original')
    expect(verifySignature('secret', 'tampered', sig)).toBe(false)
  })

  it('listAdapters uses tenant scope', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeAdapterRow()]))
    const { listAdapters } = await import('../../../api/services/ecosystem/automationAdapterService')
    await listAdapters('T1')
    expect(mockTenant).toHaveBeenCalledWith('T1', expect.any(String), expect.any(Array))
  })
})

// ─── Suite 7: Knowledge graph coverage ───────────────────────────────────────

describe('knowledgeGraphService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('upsertEntity uses ON CONFLICT on entity_type + entity_ref', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeKgEntityRow()))
    const { upsertEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await upsertEntity('T1', { entityType: 'system', entityRef: 'auth', label: 'Auth', properties: {} })
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('ON CONFLICT')
    expect(sql).toContain('entity_type, entity_ref')
  })

  it('upsertEntity returns entity with correct tenantId', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeKgEntityRow()))
    const { upsertEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const entity = await upsertEntity('T1', { entityType: 'system', entityRef: 'auth', label: 'Auth' })
    expect(entity.tenantId).toBe('T1')
    expect(entity.entityType).toBe('system')
  })

  it('getEntity returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { getEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    expect(await getEntity('T1', 'missing')).toBeNull()
  })

  it('findEntitiesByRef returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { findEntitiesByRef } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    expect(await findEntitiesByRef('T1', 'system', 'missing')).toBeNull()
  })

  it('searchEntities uses ILIKE for label matching', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { searchEntities } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await searchEntities('T1', { labelContains: 'auth' })
    expect((mockTenant.mock.calls[0]![1] as string).toLowerCase()).toContain('ilike')
  })

  it('addRelationship inserts into kg_relationships', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeKgRelationshipRow()))
    const { addRelationship } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const rel = await addRelationship('T1', { fromEntityId: 'e1', toEntityId: 'e2', relationshipType: 'depends_on' })
    expect(rel.fromEntityId).toBe('entity-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('kg_relationships')
  })

  it('getNeighborhood queries bidirectional relationships', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeKgEntityRow()))
      .mockResolvedValueOnce(mockRows([makeKgRelationshipRow()]))
    const { getNeighborhood } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    const result = await getNeighborhood('T1', 'entity-1')
    expect(result.entity.id).toBe('entity-1')
    expect(Array.isArray(result.relationships)).toBe(true)
    const sql = mockTenant.mock.calls[1]![1] as string
    expect(sql).toContain('from_entity_id')
    expect(sql).toContain('to_entity_id')
  })
})

// ─── Suite 8: Edge node coverage ─────────────────────────────────────────────

describe('edgeNodeService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('computeNodeIdentityHash returns 64-char hex', async () => {
    const { computeNodeIdentityHash } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(computeNodeIdentityHash('pk', 'node').length).toBe(64)
  })

  it('computeNodeIdentityHash is deterministic', async () => {
    const { computeNodeIdentityHash } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(computeNodeIdentityHash('pk', 'n')).toBe(computeNodeIdentityHash('pk', 'n'))
  })

  it('computeNodeIdentityHash differs for different publicKey', async () => {
    const { computeNodeIdentityHash } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(computeNodeIdentityHash('pk1', 'n')).not.toBe(computeNodeIdentityHash('pk2', 'n'))
  })

  it('isNodeRevoked returns true when revokedAt is set', async () => {
    const { isNodeRevoked } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(isNodeRevoked({ revokedAt: new Date(NOW) } as Parameters<typeof isNodeRevoked>[0])).toBe(true)
  })

  it('isNodeRevoked returns false when revokedAt is null', async () => {
    const { isNodeRevoked } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(isNodeRevoked({ revokedAt: null } as Parameters<typeof isNodeRevoked>[0])).toBe(false)
  })

  it('heartbeatNode query excludes revoked nodes', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { heartbeatNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    await heartbeatNode('T1', 'node-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('revoked_at IS NULL')
  })

  it('revokeEdgeNode sets status=decommissioned and revoked_at', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { revokeEdgeNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    await revokeEdgeNode('T1', 'node-1')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('decommissioned')
    expect(sql).toContain('revoked_at')
  })

  it('updateNodeStatus CASE WHEN sets last_seen_at for active status', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeEdgeNodeRow()))
    const { updateNodeStatus } = await import('../../../api/services/ecosystem/edgeNodeService')
    await updateNodeStatus('T1', 'node-1', 'active')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('CASE WHEN')
    expect(sql).toContain('last_seen_at')
  })

  it('getAllEdgeNodeStatuses uses pool (admin bypass)', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeEdgeNodeRow()]))
    const { getAllEdgeNodeStatuses } = await import('../../../api/services/ecosystem/edgeNodeService')
    await getAllEdgeNodeStatuses()
    expect(mockPool).toHaveBeenCalled()
  })

  it('enqueueCommand includes priority field', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { enqueueCommand } = await import('../../../api/services/ecosystem/edgeNodeService')
    await enqueueCommand('T1', 'node-1', 'reload_config', {}, 10)
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('priority')
  })

  it('getPendingCommands orders by priority', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeEdgeCommandRow()]))
    const { getPendingCommands } = await import('../../../api/services/ecosystem/edgeNodeService')
    await getPendingCommands('T1', 'node-1')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('priority')
    expect(sql).toContain('ORDER BY')
  })

  it('acknowledgeCommand sets delivered_at', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { acknowledgeCommand } = await import('../../../api/services/ecosystem/edgeNodeService')
    await acknowledgeCommand('T1', 'cmd-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('delivered_at')
  })

  it('bufferAuditEvent uses ON CONFLICT DO NOTHING for idempotency', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { bufferAuditEvent } = await import('../../../api/services/ecosystem/edgeNodeService')
    await bufferAuditEvent('T1', 'node-1', 'exec', {}, 1)
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('ON CONFLICT')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('DO NOTHING')
  })

  it('flushAuditBuffer returns rows.length', async () => {
    mockTenant.mockResolvedValueOnce({ rows: Array(7).fill({ id: 'x' }) } as never)
    const { flushAuditBuffer } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(await flushAuditBuffer('T1', 'node-1')).toBe(7)
  })
})

// ─── Suite 9: Air-gap service coverage ───────────────────────────────────────

describe('airGapModeService coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env['AIR_GAP_LICENSE_KEY'] = 'test-license-key-32-bytes-long!!'
  })

  it('isLicenseExpired returns false for future date', async () => {
    const { isLicenseExpired } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(isLicenseExpired({ validUntil: new Date(Date.now() + 86400000) } as Parameters<typeof isLicenseExpired>[0])).toBe(false)
  })

  it('isLicenseExpired returns true for past date', async () => {
    const { isLicenseExpired } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(isLicenseExpired({ validUntil: new Date(Date.now() - 86400000) } as Parameters<typeof isLicenseExpired>[0])).toBe(true)
  })

  it('isFeatureIncluded returns true for included feature', async () => {
    const { isFeatureIncluded } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(isFeatureIncluded({ featureSet: ['compliance', 'ai'] } as Parameters<typeof isFeatureIncluded>[0], 'compliance')).toBe(true)
  })

  it('isFeatureIncluded returns false for missing feature', async () => {
    const { isFeatureIncluded } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(isFeatureIncluded({ featureSet: ['compliance'] } as Parameters<typeof isFeatureIncluded>[0], 'aiGovernance')).toBe(false)
  })

  it('getAirGapStatus returns enabled=false for null license', async () => {
    const { getAirGapStatus } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(getAirGapStatus(null).enabled).toBe(false)
  })

  it('resolveAiProvider returns cloud when not air-gapped', async () => {
    const { resolveAiProvider } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(resolveAiProvider(false, null)).toBe('cloud')
    expect(resolveAiProvider(false, 'ollama')).toBe('cloud')
  })

  it('resolveAiProvider returns local when air-gapped with provider', async () => {
    const { resolveAiProvider } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(resolveAiProvider(true, 'ollama')).toBe('local')
  })

  it('resolveAiProvider returns none when air-gapped without provider', async () => {
    const { resolveAiProvider } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(resolveAiProvider(true, null)).toBe('none')
  })

  it('issueLicense payload includes signature field', async () => {
    const { issueLicense } = await import('../../../api/services/ecosystem/airGapModeService')
    const payload = issueLicense({ tenantId: 'T1', tier: 'enterprise', seatLimit: 100, featureSet: [], validDays: 365 })
    expect(typeof payload.signature).toBe('string')
    expect(payload.signature.length).toBeGreaterThan(0)
  })

  it('verifyLicenseSignature returns true for fresh payload', async () => {
    const { issueLicense, verifyLicenseSignature } = await import('../../../api/services/ecosystem/airGapModeService')
    const payload = issueLicense({ tenantId: 'T1', tier: 'standard', seatLimit: 50, featureSet: [], validDays: 365 })
    expect(verifyLicenseSignature(payload)).toBe(true)
  })

  it('verifyLicenseSignature returns false for tampered licenseKeyHash', async () => {
    const { issueLicense, verifyLicenseSignature } = await import('../../../api/services/ecosystem/airGapModeService')
    const payload = issueLicense({ tenantId: 'T1', tier: 'standard', seatLimit: 50, featureSet: [], validDays: 365 })
    expect(verifyLicenseSignature({ ...payload, licenseKeyHash: 'tampered-hash' })).toBe(false)
  })

  it('createPackage+verifyPackage roundtrip returns true', async () => {
    const { createPackage, verifyPackage } = await import('../../../api/services/ecosystem/airGapModeService')
    const pkg = createPackage('model', '1.0.0', { data: 'hello' })
    expect(verifyPackage(pkg)).toBe(true)
  })

  it('verifyPackage returns false for tampered checksum', async () => {
    const { createPackage, verifyPackage } = await import('../../../api/services/ecosystem/airGapModeService')
    const pkg = createPackage('model', '1.0.0', {})
    expect(verifyPackage({ ...pkg, checksum: 'bad' })).toBe(false)
  })

  it('revokeLicense sets is_active=FALSE', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { revokeLicense } = await import('../../../api/services/ecosystem/airGapModeService')
    await revokeLicense('T1', 'lic-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('is_active = FALSE')
  })
})

// ─── Suite 10: Certification evidence coverage ────────────────────────────────

describe('certificationEvidenceService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('generateCertificationEvidence includes tenantId in report', async () => {
    // tenant_isolation: no evidence queries, just INSERT compliance_exports
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { generateCertificationEvidence } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const report = await generateCertificationEvidence('T1', 'tenant_isolation')
    expect(report.tenantId).toBe('T1')
    expect(report.certificationType).toBe('tenant_isolation')
  })

  it('generateCertificationEvidence report checksum is 64-char hex', async () => {
    // soc2_readiness: 1st tenantQuery for audit_log (caught gracefully), then INSERT
    mockTenant
      .mockResolvedValueOnce(mockRow({ total: 0, approval_events: 0, oldest_event: null, newest_event: null }))
      .mockResolvedValueOnce(mockEmpty())
    const { generateCertificationEvidence } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const report = await generateCertificationEvidence('T1', 'soc2_readiness')
    expect(report.checksum.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(report.checksum)).toBe(true)
  })

  it('verifyExportIntegrity returns true for fresh report', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ total: 0, approval_events: 0, oldest_event: null, newest_event: null }))
      .mockResolvedValueOnce(mockEmpty())
    const { generateCertificationEvidence, verifyExportIntegrity } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const report = await generateCertificationEvidence('T1', 'soc2_readiness')
    expect(verifyExportIntegrity(report)).toBe(true)
  })

  it('verifyExportIntegrity returns false for tampered checksum', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ total: 0, approval_events: 0, oldest_event: null, newest_event: null }))
      .mockResolvedValueOnce(mockEmpty())
    const { generateCertificationEvidence, verifyExportIntegrity } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const report = await generateCertificationEvidence('T1', 'soc2_readiness')
    expect(verifyExportIntegrity({ ...report, checksum: 'badhash' })).toBe(false)
  })

  it('listCertificationExports queries compliance_exports', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'e-1', tenant_id: 'T1', export_type: 'cert_soc2_readiness', format: 'json', status: 'completed', checksum: 'abc', manifest: '{}', generated_at: NOW, expires_at: null, created_at: NOW }]))
    const { listCertificationExports } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    await listCertificationExports('T1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('compliance_exports')
  })
})

// ─── Suite 11: Workflow composer coverage ─────────────────────────────────────

describe('workflowComposerService coverage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('createWorkflow query includes trigger_type', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow()))
    const { createWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await createWorkflow('T1', { name: 'Wf', triggerType: 'manual', definition: {} })
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('trigger_type')
  })

  it('getWorkflow returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { getWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    expect(await getWorkflow('T1', 'missing')).toBeNull()
  })

  it('updateWorkflowDefinition throws when workflow is published', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'published' })))
    const { updateWorkflowDefinition } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(updateWorkflowDefinition('T1', 'wf-1', {})).rejects.toThrow('immutable')
  })

  it('validateWorkflowPolicy rejects DROP TABLE', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({
      definition: JSON.stringify({ steps: [{ id: 's1', type: 'sql', name: 'Drop', sql: 'DROP TABLE users' }] })
    })))
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await validateWorkflowPolicy('T1', 'wf-1')
    expect(result.passed).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('validateWorkflowPolicy rejects DELETE FROM', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({
      definition: JSON.stringify({ steps: [{ id: 's1', type: 'sql', name: 'Del', sql: 'DELETE FROM logs' }] })
    })))
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    expect((await validateWorkflowPolicy('T1', 'wf-1')).passed).toBe(false)
  })

  it('validateWorkflowPolicy rejects eval(', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({
      definition: JSON.stringify({ steps: [{ id: 's1', type: 'code', name: 'Eval', code: 'eval(input)' }] })
    })))
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await validateWorkflowPolicy('T1', 'wf-1')
    expect(result.passed).toBe(false)
    expect(result.violations.some((v: string) => v.toLowerCase().includes('eval'))).toBe(true)
  })

  it('validateWorkflowPolicy passes clean workflow', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ definition: JSON.stringify({ steps: [{ id: 's1', type: 'notify', name: 'Alert' }] }) })))
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: true })))
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await validateWorkflowPolicy('T1', 'wf-1')
    expect(result.passed).toBe(true)
    expect(result.violations.length).toBe(0)
  })

  it('validateWorkflowPolicy warns on approval gate step types', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({
        definition: JSON.stringify({ steps: [{ id: 's1', type: 'send_email', name: 'Notify' }] })
      })))
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: true })))
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await validateWorkflowPolicy('T1', 'wf-1')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('publishWorkflow throws when policy_validated=false', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: false })))
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(publishWorkflow('T1', 'wf-1', 'admin')).rejects.toThrow('policy')
  })

  it('publishWorkflow throws when dry_run_passed=false', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: true, dry_run_passed: false })))
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(publishWorkflow('T1', 'wf-1', 'admin')).rejects.toThrow('dry')
  })

  it('publishWorkflow creates version snapshot and bumps version', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: true, dry_run_passed: true, current_version: 1 })))
      .mockResolvedValueOnce(mockRow(makeWorkflowVersionRow()))
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ current_version: 2, status: 'published' })))
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = await publishWorkflow('T1', 'wf-1', 'admin')
    expect(wf.status).toBe('published')
  })

  it('rollbackWorkflow resets policy_validated and dry_run_passed to false', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow(makeWorkflowVersionRow()))
      .mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'draft', policy_validated: false, dry_run_passed: false })))
    const { rollbackWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = await rollbackWorkflow('T1', 'wf-1', 1)
    expect(wf.policyValidated).toBe(false)
    expect(wf.dryRunPassed).toBe(false)
    expect(wf.status).toBe('draft')
  })

  it('pauseWorkflow sets status=paused', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'paused' })))
    const { pauseWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = await pauseWorkflow('T1', 'wf-1')
    expect(wf.status).toBe('paused')
  })

  it('getWorkflowVersions query orders by version DESC', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowVersionRow()]))
    const { getWorkflowVersions } = await import('../../../api/services/ecosystem/workflowComposerService')
    await getWorkflowVersions('T1', 'wf-1')
    const sql = mockTenant.mock.calls[0]![1] as string
    expect(sql).toContain('ORDER BY')
    expect(sql).toContain('version')
  })

  it('getWorkflowRuns returns multiple runs', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowRunRow(), makeWorkflowRunRow({ id: 'run-2' })]))
    const { getWorkflowRuns } = await import('../../../api/services/ecosystem/workflowComposerService')
    const runs = await getWorkflowRuns('T1', 'wf-1', false)
    expect(runs.length).toBe(2)
  })
})

// ─── Suite 12: Privacy boundaries ────────────────────────────────────────────

describe('privacy boundary integration', () => {
  beforeEach(() => vi.resetAllMocks())

  it('K_ANONYMITY_MIN equals 5', async () => {
    const { K_ANONYMITY_MIN } = await import('../../../api/services/ecosystem/ecosystemTypes')
    expect(K_ANONYMITY_MIN).toBe(5)
  })

  it('MIN_BENCHMARK_COHORT equals 10', async () => {
    const { MIN_BENCHMARK_COHORT } = await import('../../../api/services/ecosystem/ecosystemTypes')
    expect(MIN_BENCHMARK_COHORT).toBe(10)
  })

  it('MIN_BENCHMARK_COHORT > K_ANONYMITY_MIN', async () => {
    const { K_ANONYMITY_MIN, MIN_BENCHMARK_COHORT } = await import('../../../api/services/ecosystem/ecosystemTypes')
    expect(MIN_BENCHMARK_COHORT).toBeGreaterThan(K_ANONYMITY_MIN)
  })

  it('publishPattern rejects contributorCount=4 (below threshold)', async () => {
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(publishPattern({ patternType: 'sla', patternData: {}, confidenceScore: 0.9, contributorCount: 4 }))
      .rejects.toThrow('K-anonymity threshold not met: 4 < 5 required')
  })

  it('publishPattern accepts contributorCount=5 (at threshold)', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makePatternRow({ contributor_count: 5 })))
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = await publishPattern({ patternType: 'sla', patternData: {}, confidenceScore: 0.9, contributorCount: 5 })
    expect(p.contributorCount).toBe(5)
  })

  it('contributeData gates on opt-in (isOptedIn=false throws)', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ enabled: false }))
    const { contributeData } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(contributeData('T1', { contributionType: 'resource_optimization', rawData: { v: 1 } }))
      .rejects.toThrow('not opted in')
  })

  it('contributeData proceeds when tenant is opted in', async () => {
    mockTenant
      .mockResolvedValueOnce(mockRow({ enabled: true }))
      .mockResolvedValueOnce(mockRow(makeContributionRow()))
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { contributeData } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const c = await contributeData('T1', { contributionType: 'resource_optimization', rawData: { v: 42 } })
    expect(c.tenantId).toBe('T1')
  })

  it('withdrawContribution sets status to withdrawn', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { withdrawContribution } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await withdrawContribution('T1', 'contrib-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain("status = 'withdrawn'")
  })

  it('activateModelVersion throws when version not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { activateModelVersion } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(activateModelVersion('missing')).rejects.toThrow('not found')
  })

  it('getPrivacyAudits uses pool (admin, not tenantQuery)', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makePrivacyAuditRow()]))
    const { getPrivacyAudits } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await getPrivacyAudits('contrib-1')
    expect(mockPool).toHaveBeenCalledWith(expect.stringContaining('federated_privacy_audits'), expect.any(Array))
  })
})

// ─── Suite 13: Edge sync and audit buffer ─────────────────────────────────────

describe('edgeNodeService sync and audit', () => {
  beforeEach(() => vi.resetAllMocks())

  it('startSyncSession inserts into edge_sync_sessions', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'in_progress', records_synced: 0, conflicts_detected: 0, conflicts_resolved: 0, started_at: NOW, completed_at: null }))
    const { startSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const s = await startSyncSession('T1', 'node-1')
    expect(s.status).toBe('in_progress')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('edge_sync_sessions')
  })

  it('completeSyncSession sets status=completed when no unresolved conflicts', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'completed', records_synced: 10, conflicts_detected: 0, conflicts_resolved: 0, started_at: NOW, completed_at: NOW }))
    const { completeSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const s = await completeSyncSession('T1', 'sync-1', { conflictsDetected: 0, conflictsResolved: 0 })
    expect(s.status).toBe('completed')
  })

  it('completeSyncSession sets status=conflict when conflicts exceed resolved', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'conflict', records_synced: 5, conflicts_detected: 3, conflicts_resolved: 1, started_at: NOW, completed_at: NOW }))
    const { completeSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const s = await completeSyncSession('T1', 'sync-1', { conflictsDetected: 3, conflictsResolved: 1 })
    expect(s.status).toBe('conflict')
  })

  it('getLatestSyncSession returns session or null', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'completed', records_synced: 5, conflicts_detected: 0, conflicts_resolved: 0, started_at: NOW, completed_at: NOW }))
    const { getLatestSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const s = await getLatestSyncSession('T1', 'node-1')
    expect(s).not.toBeNull()
    expect(s!.id).toBe('sync-1')
  })

  it('getLatestSyncSession returns null when no session', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { getLatestSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(await getLatestSyncSession('T1', 'node-1')).toBeNull()
  })

  it('listEdgeNodes returns nodes for tenant', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([{ id: 'node-1', tenant_id: 'T1', node_name: 'site-a', status: 'active', public_key: 'pk', identity_hash: 'ih', region: 'us-west', site_label: null, last_seen_at: NOW, capabilities: [], active_since: null, revoked_at: null, created_at: NOW, updated_at: NOW }]))
    const { listEdgeNodes } = await import('../../../api/services/ecosystem/edgeNodeService')
    const nodes = await listEdgeNodes('T1')
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.nodeName).toBe('site-a')
  })

  it('getEdgeNode returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { getEdgeNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    expect(await getEdgeNode('T1', 'missing')).toBeNull()
  })
})

// ─── Suite 14: Automation adapter mapper ─────────────────────────────────────

describe('automationAdapterService mapper fields', () => {
  beforeEach(() => vi.resetAllMocks())

  it('createAdapter returns adapter with all fields', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'adapter-1', tenant_id: 'T1', name: 'Slack', adapter_type: 'custom_webhook', endpoint_url: null, rate_limit_rpm: 60, metadata: '{}', signing_secret: 'secret', is_active: true, created_at: NOW, updated_at: NOW }))
    const { createAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    const result = await createAdapter('T1', { name: 'Slack', adapterType: 'custom_webhook' })
    expect(result.adapter.id).toBe('adapter-1')
    expect(result.adapter.tenantId).toBe('T1')
    expect(result.adapter.adapterType).toBe('custom_webhook')
    expect(result.adapter.isActive).toBe(true)
    expect(typeof result.signingSecret).toBe('string')
  })

  it('ingestInboundEvent maps all event fields', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'event-1', adapter_id: 'adapter-1', tenant_id: 'T1', event_type: 'ping', payload: JSON.stringify({ ok: true }), direction: 'inbound', idempotency_key: 'k1', processed: false, retry_count: 0, error: null, created_at: NOW, updated_at: NOW }))
    const { ingestInboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    const ev = await ingestInboundEvent('T1', 'adapter-1', { eventType: 'ping', payload: { ok: true }, idempotencyKey: 'k1' })
    expect(ev.id).toBe('event-1')
    expect(ev.eventType).toBe('ping')
    expect(ev.idempotencyKey).toBe('k1')
    expect(ev.processed).toBe(false)
    expect(ev.retryCount).toBe(0)
  })

  it('listEvents returns events for tenant', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ id: 'event-1', adapter_id: 'a1', tenant_id: 'T1', event_type: 'x', payload: '{}', direction: 'inbound', idempotency_key: null, processed: true, retry_count: 1, error: null, created_at: NOW, updated_at: NOW }))
    const { listEvents } = await import('../../../api/services/ecosystem/automationAdapterService')
    const events = await listEvents('T1')
    expect(Array.isArray(events)).toBe(true)
  })
})

// ─── Suite 15: Playbook version and install mapper ────────────────────────────

describe('playbookMarketplaceService version and install', () => {
  beforeEach(() => vi.resetAllMocks())

  it('getPlaybook returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    expect(await getPlaybook('missing')).toBeNull()
  })

  it('getPlaybookVersion returns null when not found', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getPlaybookVersion } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    expect(await getPlaybookVersion('pb-1', '1.0.0')).toBeNull()
  })

  it('uninstallPlaybook marks install inactive', async () => {
    mockTenant.mockResolvedValueOnce(mockEmpty())
    const { uninstallPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    await uninstallPlaybook('T1', 'pb-1')
    expect((mockTenant.mock.calls[0]![1] as string)).toContain('is_active = FALSE')
  })

  it('installPlaybook returns install with correct fields', async () => {
    mockPool.mockResolvedValueOnce(mockRow({ id: 'pb-1', slug: 'test', name: 'Test', description: null, playbook_type: 'runbook', industry_tags: [], author_tenant_id: null, publisher: 'ava', status: 'published', current_version: '1.0.0', install_count: 1, avg_rating: null, rating_count: 0, sandbox_validated: true, created_at: NOW, updated_at: NOW }))
    mockTenant
      .mockResolvedValueOnce(mockRow({ id: 'install-1', tenant_id: 'T1', playbook_id: 'pb-1', installed_version: '1.0.0', config: '{}', is_active: true, installed_at: NOW, updated_at: NOW }))
    mockPool.mockResolvedValueOnce(mockEmpty()) // increment install_count
    const { installPlaybook } = await import('../../../api/services/ecosystem/playbookMarketplaceService')
    const install = await installPlaybook('T1', 'pb-1')
    expect(install.tenantId).toBe('T1')
    expect(install.playbookId).toBe('pb-1')
  })
})

// ─── Suite 16: Benchmark tenant self-comparison ───────────────────────────────

describe('benchmarkingService tenant self-comparison', () => {
  beforeEach(() => vi.resetAllMocks())

  it('getTenantBenchmark returns top_quartile for high value', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 100)
    expect(result.percentileEstimate).toBe('top_quartile')
    expect(result.tenantId).toBe('T1')
    expect(result.tenantValue).toBe(100)
  })

  it('getTenantBenchmark returns bottom_quartile for low value', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 5)
    expect(result.percentileEstimate).toBe('bottom_quartile')
  })

  it('getTenantBenchmark returns above_median for p50 value', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 85)
    expect(result.percentileEstimate).toBe('above_median')
  })

  it('getTenantBenchmark cohortP50 and cohortP75 reflect cohort data', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 90)
    expect(result.cohortP50).toBe(85)
    expect(result.cohortP75).toBe(95)
  })

  it('getReadinessBenchmarks delegates to getIndustryBenchmarks', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getReadinessBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    const results = await getReadinessBenchmarks()
    expect(Array.isArray(results)).toBe(true)
    expect(mockPool).toHaveBeenCalledTimes(1)
  })

  it('computeAndStoreCohort with 10 values not suppressed', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow({ cohort_size: 10, suppressed: false })))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await computeAndStoreCohort({
      metricName: 'sla_compliance',
      values: [70, 75, 80, 82, 85, 88, 90, 93, 96, 99],
    })
    expect(result.suppressed).toBe(false)
  })

  it('computeAndStoreCohort uses ON CONFLICT for upsert', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    await computeAndStoreCohort({ metricName: 'sla_compliance', values: [80, 85, 90, 92, 94, 96, 97, 98, 99, 100] })
    expect((mockPool.mock.calls[0]![0] as string)).toContain('ON CONFLICT')
  })

  it('getIndustryBenchmarks filters by region when provided', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getIndustryBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getIndustryBenchmarks(undefined, 'us-east')
    const params = mockPool.mock.calls[0]![1] as unknown[]
    expect(params[1]).toBe('us-east')
  })

  it('getIndustryBenchmarks filters by industrySegment', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getIndustryBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getIndustryBenchmarks('fintech')
    const params = mockPool.mock.calls[0]![1] as unknown[]
    expect(params[0]).toBe('fintech')
  })

  it('getTenantBenchmark computedAt is a Date', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getTenantBenchmark } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getTenantBenchmark('T1', 'sla_compliance', 88)
    expect(result.computedAt).toBeInstanceOf(Date)
  })

  it('getSlaBenchmarks returns only non-suppressed cohorts', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeCohortRow()]))
    const { getSlaBenchmarks } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getSlaBenchmarks()
    expect((mockPool.mock.calls[0]![0] as string)).toContain('suppressed = FALSE')
  })

  it('getBenchmarkForMetric returns most recent by computed_at', async () => {
    mockPool.mockResolvedValueOnce(mockRow(makeCohortRow()))
    const { getBenchmarkForMetric } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await getBenchmarkForMetric('sla_compliance')
    expect(result).not.toBeNull()
    expect((mockPool.mock.calls[0]![0] as string)).toContain('ORDER BY computed_at DESC')
  })

  it('getBenchmarkForMetric query includes LIMIT 1', async () => {
    mockPool.mockResolvedValueOnce(mockEmpty())
    const { getBenchmarkForMetric } = await import('../../../api/services/ecosystem/benchmarkingService')
    await getBenchmarkForMetric('incident_closure_time')
    expect((mockPool.mock.calls[0]![0] as string)).toContain('LIMIT 1')
  })
})

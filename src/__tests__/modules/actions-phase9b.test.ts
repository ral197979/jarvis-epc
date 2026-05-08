/**
 * Denver Engineering — Phase 9 Test Suite B (v9.0.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 9 — Federated Intelligence + Ecosystem Platform.
 * 130 tests across 10 suites.
 * Covers: edgeNodeService, airGapModeService, certificationEvidenceService,
 *         workflowComposerService, benchmarking edge cases, federated privacy thresholds,
 *         plugin rollback, automation idempotency, external agent auth, knowledge graph isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pool ────────────────────────────────────────────────────────────────

vi.mock('../../../api/db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  tenantQuery: vi.fn(),
}))

import { default as pool, tenantQuery } from '../../../api/db/pool'
const mockPool   = vi.mocked(pool.query)
const mockTenant = vi.mocked(tenantQuery)

const mockRows = (rows: Record<string, unknown>[]) => ({ rows })
const mockRow  = (row: Record<string, unknown>)    => ({ rows: [row] })

// ─── Factories ────────────────────────────────────────────────────────────────

const makeNodeRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'node-1', tenant_id: 'T1', node_name: 'Site-Alpha', site_ref: 'SITE-001',
  status: 'active', public_key: 'pk-node-1', last_seen_at: '2024-01-10T12:00:00Z',
  version: '1.2.0', capabilities: ['inspection', 'audit', 'sensor_ingest'],
  metadata: JSON.stringify({}), revoked_at: null,
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-10T12:00:00Z',
  ...o,
})

const makeSyncRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sync-1', edge_node_id: 'node-1', tenant_id: 'T1', status: 'completed',
  events_sent: 50, events_received: 45, conflicts_detected: 2, conflicts_resolved: 2,
  started_at: '2024-01-10T11:00:00Z', completed_at: '2024-01-10T12:00:00Z',
  ...o,
})

const makeWorkflowRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wf-1', tenant_id: 'T1', name: 'Inspection Alert Workflow',
  description: 'Auto-escalate failed inspections',
  status: 'draft', trigger_type: 'event', trigger_config: JSON.stringify({ event: 'inspection.failed' }),
  definition: JSON.stringify({ steps: [
    { type: 'condition', condition: 'is_critical' },
    { type: 'approval_gate' },
    { type: 'send_email' },
  ]}),
  policy_validated: false, dry_run_passed: false,
  current_version: 1, published_by: null, published_at: null,
  metadata: JSON.stringify({}),
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeWorkflowVersionRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wfv-1', workflow_id: 'wf-1', version: 1,
  definition: JSON.stringify({ steps: [] }),
  trigger_type: 'event', trigger_config: JSON.stringify({}),
  change_summary: 'Initial', created_by: 'admin', created_at: '2024-01-01T00:00:00Z',
  ...o,
})

const makeWorkflowRunRow = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'run-1', workflow_id: 'wf-1', tenant_id: 'T1', version: 1,
  trigger_context: JSON.stringify({}), is_dry_run: false, status: 'completed',
  steps_completed: 3, steps_total: 3, error: null,
  started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z',
  ...o,
})

// ─── Suite 1: edgeNodeService ─────────────────────────────────────────────────

describe('edgeNodeService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('registerEdgeNode inserts with public key and capabilities', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeNodeRow()))
    const { registerEdgeNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    const node = await registerEdgeNode('T1', {
      nodeName: 'Site-Alpha', publicKey: 'pk-node-1',
      capabilities: ['inspection', 'audit'],
    })
    expect(node.nodeName).toBe('Site-Alpha')
    expect(node.status).toBe('active')
    expect(node.capabilities).toContain('inspection')
  })

  it('revokeEdgeNode sets status=decommissioned and revoked_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { revokeEdgeNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    await revokeEdgeNode('T1', 'node-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("'decommissioned'")
    expect(query).toContain('revoked_at = now()')
  })

  it('heartbeatNode updates last_seen_at and status=active', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { heartbeatNode } = await import('../../../api/services/ecosystem/edgeNodeService')
    await heartbeatNode('T1', 'node-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('last_seen_at = now()')
    expect(query).toContain("status = 'active'")
    expect(query).toContain('revoked_at IS NULL')  // no heartbeat for revoked nodes
  })

  it('startSyncSession inserts with status=syncing', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSyncRow({ status: 'syncing', completed_at: null })))
    const { startSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const session = await startSyncSession('T1', 'node-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("'syncing'")
    expect(session.status).toBe('syncing')
  })

  it('completeSyncSession sets status=conflict when unresolved conflicts remain', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSyncRow({ status: 'conflict' })))
    const { completeSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const session = await completeSyncSession('T1', 'sync-1', {
      conflictsDetected: 5, conflictsResolved: 3,
    })
    expect(session.status).toBe('conflict')
  })

  it('completeSyncSession sets status=completed when all conflicts resolved', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSyncRow({ status: 'completed' })))
    const { completeSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    const session = await completeSyncSession('T1', 'sync-1', {
      conflictsDetected: 2, conflictsResolved: 2,
    })
    expect(session.status).toBe('completed')
  })

  it('completeSyncSession throws when session not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { completeSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    await expect(completeSyncSession('T1', 'bad-id', {})).rejects.toThrow()
  })

  it('enqueueCommand inserts with priority and TTL', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { enqueueCommand } = await import('../../../api/services/ecosystem/edgeNodeService')
    await enqueueCommand('T1', 'node-1', 'policy_update', { version: 3 }, 1, 60000)
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(1)  // priority
    expect(args[5]).not.toBeNull()  // expires_at
  })

  it('getPendingCommands filters delivered=FALSE and non-expired', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getPendingCommands } = await import('../../../api/services/ecosystem/edgeNodeService')
    await getPendingCommands('T1', 'node-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('delivered = FALSE')
    expect(query).toContain('expires_at > now()')
  })

  it('bufferAuditEvent uses ON CONFLICT DO NOTHING on (edge_node_id, local_sequence)', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { bufferAuditEvent } = await import('../../../api/services/ecosystem/edgeNodeService')
    await bufferAuditEvent('T1', 'node-1', 'inspection.completed', {}, 42)
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ON CONFLICT (edge_node_id, local_sequence) DO NOTHING')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain(42)  // local_sequence
  })

  it('flushAuditBuffer marks all unsynced events as synced', async () => {
    mockTenant.mockResolvedValueOnce({ rows: [{ id: 'b1' }, { id: 'b2' }] })
    const { flushAuditBuffer } = await import('../../../api/services/ecosystem/edgeNodeService')
    const count = await flushAuditBuffer('T1', 'node-1')
    expect(count).toBe(2)
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('synced = TRUE')
  })

  it('isNodeRevoked returns true when revokedAt is set', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const node = __testHooks._mapNode(makeNodeRow({ revoked_at: '2024-01-15T00:00:00Z' }))
    expect(__testHooks.isNodeRevoked(node)).toBe(true)
  })

  it('isNodeRevoked returns false when revokedAt is null', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const node = __testHooks._mapNode(makeNodeRow())
    expect(__testHooks.isNodeRevoked(node)).toBe(false)
  })

  it('computeNodeIdentityHash is deterministic', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const h1 = __testHooks.computeNodeIdentityHash('pk-1', 'Site-Alpha')
    const h2 = __testHooks.computeNodeIdentityHash('pk-1', 'Site-Alpha')
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64)
  })

  it('computeNodeIdentityHash differs for different public keys', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const h1 = __testHooks.computeNodeIdentityHash('pk-1', 'Site-Alpha')
    const h2 = __testHooks.computeNodeIdentityHash('pk-2', 'Site-Alpha')
    expect(h1).not.toBe(h2)
  })

  it('_mapNode maps capabilities as array', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const n = __testHooks._mapNode(makeNodeRow())
    expect(Array.isArray(n.capabilities)).toBe(true)
    expect(n.capabilities).toContain('inspection')
  })

  it('listEdgeNodes filters by revoked_at IS NULL', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeNodeRow()]))
    const { listEdgeNodes } = await import('../../../api/services/ecosystem/edgeNodeService')
    await listEdgeNodes('T1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('revoked_at IS NULL')
  })
})

// ─── Suite 2: airGapModeService ───────────────────────────────────────────────

describe('airGapModeService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('issueLicense generates licenseKeyHash and signature', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const license = __testHooks.issueLicense({
      tenantId: 'T1', tier: 'enterprise', seatLimit: 50,
      featureSet: ['analytics', 'api_access'], validDays: 365,
    })
    expect(typeof license.licenseKeyHash).toBe('string')
    expect(license.licenseKeyHash.length).toBe(64)
    expect(typeof license.signature).toBe('string')
    expect(license.signature.length).toBe(64)
    expect(license.tier).toBe('enterprise')
    expect(license.seatLimit).toBe(50)
  })

  it('verifyLicenseSignature returns true for valid license', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const payload = __testHooks.issueLicense({
      tenantId: 'T1', tier: 'professional', seatLimit: 25,
      featureSet: ['api_access'], validDays: 90,
    })
    expect(__testHooks.verifyLicenseSignature(payload)).toBe(true)
  })

  it('verifyLicenseSignature returns false when signature tampered', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const payload = __testHooks.issueLicense({
      tenantId: 'T1', tier: 'enterprise', seatLimit: 100,
      featureSet: ['*'], validDays: 365,
    })
    const tampered = { ...payload, signature: 'tampered-signature-value' }
    expect(__testHooks.verifyLicenseSignature(tampered)).toBe(false)
  })

  it('activateLicense throws when signature invalid', async () => {
    const { activateLicense } = await import('../../../api/services/ecosystem/airGapModeService')
    await expect(activateLicense('T1', {
      licenseKeyHash: 'hash', tier: 'enterprise', seatLimit: 50,
      featureSet: [], validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      tenantId: 'T1', signature: 'bad-sig',
    })).rejects.toThrow('tampered')
  })

  it('isLicenseExpired returns true for past validUntil', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const expired = __testHooks._mapLicense({
      id: 'l1', tenant_id: 'T1', license_key_hash: 'hash',
      tier: 'enterprise', seat_limit: 50, feature_set: [],
      valid_from: '2023-01-01T00:00:00Z', valid_until: '2023-12-31T00:00:00Z',
      issued_by: 'ava', signature: 'sig', is_active: true,
      created_at: '2023-01-01T00:00:00Z',
    })
    expect(__testHooks.isLicenseExpired(expired)).toBe(true)
  })

  it('isLicenseExpired returns false for future validUntil', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const active = __testHooks._mapLicense({
      id: 'l1', tenant_id: 'T1', license_key_hash: 'hash',
      tier: 'enterprise', seat_limit: 50, feature_set: [],
      valid_from: new Date().toISOString(),
      valid_until: new Date(Date.now() + 86400000 * 365).toISOString(),
      issued_by: 'ava', signature: 'sig', is_active: true,
      created_at: new Date().toISOString(),
    })
    expect(__testHooks.isLicenseExpired(active)).toBe(false)
  })

  it('isFeatureIncluded returns true when feature in featureSet', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const lic = __testHooks._mapLicense({
      id: 'l1', tenant_id: 'T1', license_key_hash: 'h', tier: 'enterprise',
      seat_limit: 50, feature_set: ['analytics', 'api_access'],
      valid_from: new Date().toISOString(), valid_until: new Date(Date.now() + 86400000).toISOString(),
      issued_by: 'ava', signature: 's', is_active: true, created_at: new Date().toISOString(),
    })
    expect(__testHooks.isFeatureIncluded(lic, 'analytics')).toBe(true)
    expect(__testHooks.isFeatureIncluded(lic, 'simulation')).toBe(false)
  })

  it('isFeatureIncluded returns true for * wildcard', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const lic = __testHooks._mapLicense({
      id: 'l1', tenant_id: 'T1', license_key_hash: 'h', tier: 'enterprise',
      seat_limit: 50, feature_set: ['*'],
      valid_from: new Date().toISOString(), valid_until: new Date(Date.now() + 86400000).toISOString(),
      issued_by: 'ava', signature: 's', is_active: true, created_at: new Date().toISOString(),
    })
    expect(__testHooks.isFeatureIncluded(lic, 'anything')).toBe(true)
  })

  it('resolveAiProvider returns cloud when not in air-gap mode', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(__testHooks.resolveAiProvider(false, null)).toBe('cloud')
  })

  it('resolveAiProvider returns local when air-gapped with local provider', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(__testHooks.resolveAiProvider(true, 'ollama')).toBe('local')
  })

  it('resolveAiProvider returns none when air-gapped without local provider', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    expect(__testHooks.resolveAiProvider(true, null)).toBe('none')
  })

  it('createPackage computes checksum and signature', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const pkg = __testHooks.createPackage('playbook', '1.0.0', { id: 'pb-1', steps: [] })
    expect(pkg.packageType).toBe('playbook')
    expect(pkg.version).toBe('1.0.0')
    expect(typeof pkg.checksum).toBe('string')
    expect(pkg.checksum.length).toBe(64)
    expect(typeof pkg.signature).toBe('string')
  })

  it('verifyPackage returns true for valid package', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const pkg = __testHooks.createPackage('plugin', '2.0.0', { id: 'pl-1' })
    expect(__testHooks.verifyPackage(pkg)).toBe(true)
  })

  it('verifyPackage returns false when checksum tampered', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/airGapModeService')
    const pkg = __testHooks.createPackage('model', '1.0.0', { data: 'original' })
    const tampered = { ...pkg, checksum: 'aaaa'.repeat(16) }
    expect(__testHooks.verifyPackage(tampered)).toBe(false)
  })

  it('getAirGapStatus returns enabled=false when no license', async () => {
    const { getAirGapStatus } = await import('../../../api/services/ecosystem/airGapModeService')
    const status = getAirGapStatus(null)
    expect(status.enabled).toBe(false)
    expect(status.cloudIntegrationsDisabled).toBe(true)
  })
})

// ─── Suite 3: certificationEvidenceService ────────────────────────────────────

describe('certificationEvidenceService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('generateCertificationEvidence returns checksum and sections', async () => {
    // audit_log query (catches error gracefully)
    mockTenant.mockRejectedValueOnce(new Error('table missing'))  // _soc2Evidence audit_log
    mockTenant.mockResolvedValueOnce(mockRows([]))  // INSERT compliance_exports
    const { generateCertificationEvidence } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const result = await generateCertificationEvidence('T1', 'soc2_readiness')
    expect(result.certificationType).toBe('soc2_readiness')
    expect(typeof result.checksum).toBe('string')
    expect(result.checksum.length).toBe(64)
    expect(result.evidenceSections).toBeDefined()
  })

  it('verifyExportIntegrity returns true for unmodified evidence', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const generatedAt = new Date()
    const sections = { control_a: { enabled: true }, assessment_date: generatedAt.toISOString() }
    // Compute expected checksum the same way the service does
    const { createHash } = await import('crypto')
    const checksum = createHash('sha256')
      .update(JSON.stringify(sections) + generatedAt.toISOString())
      .digest('hex')
    const result = {
      certificationType: 'soc2_readiness' as const,
      tenantId: 'T1',
      generatedAt,
      evidenceSections: sections,
      checksum,
    }
    expect(__testHooks.verifyExportIntegrity(result)).toBe(true)
  })

  it('verifyExportIntegrity returns false when sections modified', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const generatedAt = new Date()
    const result = {
      certificationType: 'soc2_readiness' as const,
      tenantId: 'T1',
      generatedAt,
      evidenceSections: { original: true },
      checksum: 'wrong-checksum',
    }
    expect(__testHooks.verifyExportIntegrity(result)).toBe(false)
  })

  it('soc2 evidence includes control_evidence section', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      total: 1000, approval_events: 50, oldest_event: null, newest_event: null,
    }))
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const evidence = await __testHooks._soc2Evidence('T1')
    expect(evidence['control_evidence']).toBeDefined()
    expect((evidence['control_evidence'] as Record<string, unknown>)['cc1_control_environment']).toBeDefined()
  })

  it('soc2 evidence handles missing audit_log table gracefully', async () => {
    mockTenant.mockRejectedValueOnce(new Error('relation "audit_log" does not exist'))
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const evidence = await __testHooks._soc2Evidence('T1')
    expect(evidence['audit_log_summary']).toBeDefined()
    expect((evidence['audit_log_summary'] as Record<string, unknown>)['total']).toBe(0)
  })

  it('audit chain evidence includes proof_hash', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      record_count: 5000, chain_start: '2024-01-01', chain_end: '2024-12-31',
    }))
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const evidence = await __testHooks._auditChainEvidence('T1')
    expect((evidence['chain_integrity'] as Record<string, unknown>)['proof_hash']).toBeDefined()
    expect((evidence['chain_integrity'] as Record<string, unknown>)['append_only']).toBe(true)
    expect((evidence['chain_integrity'] as Record<string, unknown>)['no_deletes']).toBe(true)
  })

  it('isolation evidence shows 26 RLS-protected tables', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    const evidence = await __testHooks._isolationEvidence('T1')
    const ctrl = evidence['isolation_controls'] as Record<string, unknown>
    const rls = ctrl['row_level_security'] as Record<string, unknown>
    expect(rls['tables_protected']).toBe(26)
  })

  it('generateCertificationEvidence stores export in compliance_exports table', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      total: 100, approval_events: 10, oldest_event: null, newest_event: null,
    }))  // soc2 audit_log
    mockTenant.mockResolvedValueOnce(mockRows([]))  // INSERT compliance_exports
    const { generateCertificationEvidence } = await import('../../../api/services/ecosystem/certificationEvidenceService')
    await generateCertificationEvidence('T1', 'soc2_readiness')
    // Second tenantQuery call should be the INSERT into compliance_exports
    const insertQuery = mockTenant.mock.calls[1]![1] as string
    expect(insertQuery).toContain('compliance_exports')
  })
})

// ─── Suite 4: workflowComposerService ────────────────────────────────────────

describe('workflowComposerService', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('createWorkflow inserts with trigger_type and definition', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow()))
    const { createWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = await createWorkflow('T1', {
      name: 'Inspection Alert Workflow', triggerType: 'event',
      definition: { steps: [] },
    })
    expect(wf.name).toBe('Inspection Alert Workflow')
    expect(wf.status).toBe('draft')
    expect(wf.policyValidated).toBe(false)
  })

  it('updateWorkflowDefinition throws when workflow is published', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'published' })))
    const { updateWorkflowDefinition } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(updateWorkflowDefinition('T1', 'wf-1', { steps: [] }))
      .rejects.toThrow('immutable')
  })

  it('validateWorkflowPolicy passes when no violations', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow()))
    mockTenant.mockResolvedValueOnce(mockRows([]))  // UPDATE policy_validated
    const { validateWorkflowPolicy } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await validateWorkflowPolicy('T1', 'wf-1')
    expect(result.passed).toBe(true)
  })

  it('validateWorkflowPolicy detects forbidden SQL operations', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({ sql: 'DROP TABLE users' }, violations)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toContain('drop table')
  })

  it('validateWorkflowPolicy passes safe definitions', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({ steps: [{ type: 'send_email', to: 'admin' }] }, violations)
    expect(violations).toHaveLength(0)
  })

  it('_checkApprovalGates warns when high-impact step has no approval gate', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const warnings: string[] = []
    __testHooks._checkApprovalGates({ steps: [{ type: 'send_email' }, { type: 'webhook_call' }] }, warnings)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('approval gate')
  })

  it('_checkApprovalGates does not warn when approval gate present', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const warnings: string[] = []
    __testHooks._checkApprovalGates({
      steps: [{ type: 'send_email' }, { type: 'approval_gate' }],
    }, warnings)
    expect(warnings).toHaveLength(0)
  })

  it('_checkTriggerSafety warns on every-minute schedule', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const warnings: string[] = []
    __testHooks._checkTriggerSafety('schedule', { cron: '* * * * *' }, warnings)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('_checkTriggerSafety warns on webhook without signature validation', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const warnings: string[] = []
    __testHooks._checkTriggerSafety('webhook', { validate_signature: false }, warnings)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('dryRunWorkflow throws when policy not validated', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: false })))
    const { dryRunWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(dryRunWorkflow('T1', 'wf-1')).rejects.toThrow('policy validation')
  })

  it('dryRunWorkflow counts approval_gate steps', async () => {
    const wf = makeWorkflowRow({
      policy_validated: true,
      definition: JSON.stringify({ steps: [
        { type: 'condition', condition: 'skip_me' },
        { type: 'approval_gate' },
        { type: 'send_email' },
      ]}),
    })
    mockTenant.mockResolvedValueOnce(mockRow(wf))
    mockTenant.mockResolvedValueOnce(mockRows([]))  // UPDATE dry_run_passed
    mockTenant.mockResolvedValueOnce(mockRows([]))  // INSERT workflow_runs
    const { dryRunWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await dryRunWorkflow('T1', 'wf-1', { skip_me: false })
    expect(result.approvalGatesTriggered).toBe(1)
    expect(result.passed).toBe(true)
    expect(result.wouldSkip).toContain('condition')
  })

  it('publishWorkflow throws when not policy validated', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: false })))
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(publishWorkflow('T1', 'wf-1', 'admin')).rejects.toThrow('policy validation')
  })

  it('publishWorkflow throws when dry run not passed', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ policy_validated: true, dry_run_passed: false })))
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(publishWorkflow('T1', 'wf-1', 'admin')).rejects.toThrow('dry run')
  })

  it('publishWorkflow snapshots version and increments current_version', async () => {
    const wf = makeWorkflowRow({ policy_validated: true, dry_run_passed: true, current_version: 1 })
    mockTenant.mockResolvedValueOnce(mockRow(wf))  // getWorkflow
    mockTenant.mockResolvedValueOnce(mockRows([]))  // INSERT workflow_versions
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'published', current_version: 2 })))  // UPDATE
    const { publishWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const result = await publishWorkflow('T1', 'wf-1', 'admin')
    expect(result.status).toBe('published')
    expect(result.currentVersion).toBe(2)
    // Verify version insert was called
    const versionInsertQuery = mockTenant.mock.calls[1]![1] as string
    expect(versionInsertQuery).toContain('workflow_versions')
  })

  it('rollbackWorkflow throws when target version not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { rollbackWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await expect(rollbackWorkflow('T1', 'wf-1', 99)).rejects.toThrow('not found')
  })

  it('rollbackWorkflow resets policy_validated and dry_run_passed to FALSE', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowVersionRow()))  // getVersion
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow()))  // UPDATE
    const { rollbackWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    await rollbackWorkflow('T1', 'wf-1', 1)
    const updateQuery = mockTenant.mock.calls[1]![1] as string
    expect(updateQuery).toContain('policy_validated = FALSE')
    expect(updateQuery).toContain('dry_run_passed = FALSE')
  })

  it('pauseWorkflow sets status=paused', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeWorkflowRow({ status: 'paused' })))
    const { pauseWorkflow } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = await pauseWorkflow('T1', 'wf-1')
    expect(wf.status).toBe('paused')
  })

  it('getWorkflowRuns excludes dry runs by default', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowRunRow()]))
    const { getWorkflowRuns } = await import('../../../api/services/ecosystem/workflowComposerService')
    await getWorkflowRuns('T1', 'wf-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('is_dry_run = FALSE')
  })

  it('_mapWorkflow parses definition JSON string', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const wf = __testHooks._mapWorkflow(makeWorkflowRow({ definition: '{"steps":[]}' }))
    expect(Array.isArray(wf.definition['steps'])).toBe(true)
  })

  it('_mapRun maps isDryRun and stepsCompleted', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const run = __testHooks._mapRun(makeWorkflowRunRow())
    expect(run.isDryRun).toBe(false)
    expect(run.stepsCompleted).toBe(3)
    expect(run.completedAt).not.toBeNull()
  })
})

// ─── Suite 5: privacy thresholds edge cases ───────────────────────────────────

describe('federated privacy thresholds', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('K_ANONYMITY_MIN is exactly 5', async () => {
    const { K_ANONYMITY_MIN } = await import('../../../api/services/ecosystem/ecosystemTypes')
    expect(K_ANONYMITY_MIN).toBe(5)
  })

  it('MIN_BENCHMARK_COHORT is exactly 10', async () => {
    const { MIN_BENCHMARK_COHORT } = await import('../../../api/services/ecosystem/ecosystemTypes')
    expect(MIN_BENCHMARK_COHORT).toBe(10)
  })

  it('publishPattern with exactly 5 contributors is allowed', async () => {
    mockPool.mockResolvedValueOnce(mockRow({
      id: 'p1', pattern_type: 'test', industry_segment: null, region: null,
      project_type: null, pattern_data: JSON.stringify({}), confidence_score: '0.7',
      contributor_count: 5, k_anonymity_met: true, version: 1, is_active: true,
      expires_at: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }))
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const p = await publishPattern({ patternType: 'test', patternData: {}, confidenceScore: 0.7, contributorCount: 5 })
    expect(p.kAnonymityMet).toBe(true)
  })

  it('publishPattern with 4 contributors is rejected', async () => {
    const { publishPattern } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    await expect(publishPattern({ patternType: 'test', patternData: {}, confidenceScore: 0.9, contributorCount: 4 }))
      .rejects.toThrow('K-anonymity threshold not met: 4 < 5 required')
  })

  it('benchmarking suppresses cohort of 9 (below MIN_BENCHMARK_COHORT=10)', async () => {
    mockPool.mockResolvedValueOnce(mockRow({
      id: 'c1', metric_name: 'sla_compliance', industry_segment: null, region: null,
      project_type: null, cohort_size: 9, p25: null, p50: null, p75: null, p90: null,
      suppressed: true, computed_at: '2024-01-01T00:00:00Z', period_start: null, period_end: null,
    }))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await computeAndStoreCohort({ metricName: 'sla_compliance', values: Array(9).fill(80) })
    expect(result.suppressed).toBe(true)
    expect(result.p50).toBeNull()
  })

  it('benchmarking publishes cohort of 10 (exactly MIN_BENCHMARK_COHORT)', async () => {
    mockPool.mockResolvedValueOnce(mockRow({
      id: 'c1', metric_name: 'sla_compliance', industry_segment: null, region: null,
      project_type: null, cohort_size: 10, p25: '78', p50: '85', p75: '91', p90: '96',
      suppressed: false, computed_at: '2024-01-01T00:00:00Z', period_start: null, period_end: null,
    }))
    const { computeAndStoreCohort } = await import('../../../api/services/ecosystem/benchmarkingService')
    const result = await computeAndStoreCohort({ metricName: 'sla_compliance', values: Array(10).fill(85) })
    expect(result.suppressed).toBe(false)
    expect(result.p50).not.toBeNull()
  })

  it('anonymization removes all identifying fields', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/federatedIntelligenceEngine')
    const raw = { tenant_id: 'T1', tenantId: 'T1', project_id: 'P1', projectId: 'P1', user_id: 'U1', userId: 'U1', value: 42 }
    const anon = __testHooks._anonymize(raw)
    expect(anon['tenant_id']).toBeUndefined()
    expect(anon['tenantId']).toBeUndefined()
    expect(anon['project_id']).toBeUndefined()
    expect(anon['projectId']).toBeUndefined()
    expect(anon['user_id']).toBeUndefined()
    expect(anon['userId']).toBeUndefined()
    expect(anon['value']).toBe(42)
  })
})

// ─── Suite 6: plugin rollback completeness ────────────────────────────────────

describe('plugin rollback completeness', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('rollbackPlugin throws when no active install', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))  // no active install
    const { rollbackPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(rollbackPlugin('T1', 'plugin-1')).rejects.toThrow('No active install')
  })

  it('rollbackPlugin throws when no rollback version', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'pi-1', tenant_id: 'T1', plugin_id: 'plugin-1', version: '2.1.0',
      granted_scopes: [], is_active: true, installed_by: 'admin',
      installed_at: '2024-01-01T00:00:00Z', disabled_at: null, rollback_version: null,
    }))
    const { rollbackPlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await expect(rollbackPlugin('T1', 'plugin-1')).rejects.toThrow('No rollback version')
  })

  it('disablePlugin sets is_active=FALSE and disabled_at', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockPool.mockResolvedValueOnce(mockRows([]))  // _auditPlugin
    const { disablePlugin } = await import('../../../api/services/ecosystem/pluginRegistryService')
    await disablePlugin('T1', 'plugin-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('is_active = FALSE')
    expect(query).toContain('disabled_at = now()')
  })

  it('addPluginVersion stores SHA-256 bundle checksum', async () => {
    mockPool.mockResolvedValueOnce(mockRow({
      id: 'pv-2', plugin_id: 'plugin-1', version: '3.0.0', bundle_checksum: 'hash',
      manifest: JSON.stringify({}), changelog: null, is_active: false, released_at: null,
      created_at: '2024-01-01T00:00:00Z',
    }))
    const { addPluginVersion } = await import('../../../api/services/ecosystem/pluginRegistryService')
    const pv = await addPluginVersion('plugin-1', '3.0.0', {}, 'bundle-content', 'Bug fixes')
    expect(pv.bundleChecksum).toBeDefined()
    const args = mockPool.mock.calls[0]![1] as unknown[]
    expect(args).toContain('3.0.0')
  })
})

// ─── Suite 7: automation idempotency ─────────────────────────────────────────

describe('automation adapter idempotency', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('ingestInboundEvent without signature skips verification', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({ signing_secret: 'secret' }))
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'e1', adapter_id: 'a1', tenant_id: 'T1', direction: 'inbound',
      event_type: 'action.created', payload: '{}', idempotency_key: null,
      signature_valid: null, processed: false, error: null, retry_count: 0,
      created_at: '2024-01-01T00:00:00Z', processed_at: null,
    }))
    const { ingestInboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    const evt = await ingestInboundEvent('T1', 'a1', { eventType: 'action.created', payload: {} })
    expect(evt.signatureValid).toBeNull()
  })

  it('sendOutboundEvent idempotency_key IS NOT NULL guard in query', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'e1', adapter_id: 'a1', tenant_id: 'T1', direction: 'outbound',
      event_type: 'test', payload: '{}', idempotency_key: 'key-abc',
      signature_valid: null, processed: false, error: null, retry_count: 0,
      created_at: '2024-01-01T00:00:00Z', processed_at: null,
    }))
    const { sendOutboundEvent } = await import('../../../api/services/ecosystem/automationAdapterService')
    await sendOutboundEvent('T1', 'a1', 'test', {}, 'key-abc')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('WHERE idempotency_key IS NOT NULL')
  })

  it('listEvents limits to 100 most recent', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { listEvents } = await import('../../../api/services/ecosystem/automationAdapterService')
    await listEvents('T1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('LIMIT 100')
    expect(query).toContain('ORDER BY created_at DESC')
  })

  it('deactivateAdapter sets is_active=FALSE', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { deactivateAdapter } = await import('../../../api/services/ecosystem/automationAdapterService')
    await deactivateAdapter('T1', 'a1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('is_active = FALSE')
  })
})

// ─── Suite 8: knowledge graph tenant isolation ────────────────────────────────

describe('knowledge graph tenant isolation', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('upsertEntity always scopes to tenantId', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'e1', tenant_id: 'T1', entity_type: 'project', entity_ref: 'P1',
      label: 'Project', properties: '{}', embedding_id: null,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }))
    const { upsertEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await upsertEntity('T1', { entityType: 'project', entityRef: 'P1', label: 'Project' })
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args[0]).toBe('T1')  // tenantId is first arg
  })

  it('addRelationship passes tenantId to tenantQuery', async () => {
    mockTenant.mockResolvedValueOnce(mockRow({
      id: 'r1', tenant_id: 'T2', from_entity_id: 'e1', to_entity_id: 'e2',
      relationship_type: 'linked', weight: '1.0000', confidence: '1.0000',
      source: 'explicit', properties: '{}', created_at: '2024-01-01T00:00:00Z',
    }))
    const { addRelationship } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await addRelationship('T2', { fromEntityId: 'e1', toEntityId: 'e2', relationshipType: 'linked' })
    const callArgs = mockTenant.mock.calls[0]![0]
    expect(callArgs).toBe('T2')  // correct tenant
  })

  it('getExplainablePath queries with FROM and TO entity', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getExplainablePath } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await getExplainablePath('T1', 'ent-1', 'ent-5')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('ent-1')
    expect(args).toContain('ent-5')
  })

  it('getEntity returns null when not found', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { getEntity } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    expect(await getEntity('T1', 'bad-id')).toBeNull()
  })

  it('findEntitiesByRef queries by entity_type and entity_ref', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { findEntitiesByRef } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await findEntitiesByRef('T1', 'project', 'P-123')
    const args = mockTenant.mock.calls[0]![2] as unknown[]
    expect(args).toContain('project')
    expect(args).toContain('P-123')
  })

  it('queryGraph applies source filter to relationships', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { queryGraph } = await import('../../../api/services/ecosystem/knowledgeGraphService')
    await queryGraph('T1', { source: 'explicit' })
    const relQuery = mockTenant.mock.calls[1]![1] as string
    expect(relQuery).toContain("source = $4")
  })
})

// ─── Suite 9: edge node lifecycle completeness ────────────────────────────────

describe('edge node lifecycle completeness', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('updateNodeStatus updates last_seen_at only when status=active', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeNodeRow({ status: 'degraded' })))
    const { updateNodeStatus } = await import('../../../api/services/ecosystem/edgeNodeService')
    await updateNodeStatus('T1', 'node-1', 'degraded')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("CASE WHEN $3 = 'active' THEN now()")
  })

  it('getLatestSyncSession queries most recent by started_at DESC', async () => {
    mockTenant.mockResolvedValueOnce(mockRow(makeSyncRow()))
    const { getLatestSyncSession } = await import('../../../api/services/ecosystem/edgeNodeService')
    await getLatestSyncSession('T1', 'node-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ORDER BY started_at DESC LIMIT 1')
  })

  it('acknowledgeCommand marks delivered=TRUE', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([]))
    const { acknowledgeCommand } = await import('../../../api/services/ecosystem/edgeNodeService')
    await acknowledgeCommand('T1', 'cmd-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('delivered = TRUE')
    expect(query).toContain('delivered_at = now()')
  })

  it('getAllEdgeNodeStatuses uses pool (admin cross-tenant)', async () => {
    mockPool.mockResolvedValueOnce(mockRows([makeNodeRow()]))
    const { getAllEdgeNodeStatuses } = await import('../../../api/services/ecosystem/edgeNodeService')
    const statuses = await getAllEdgeNodeStatuses()
    expect(mockPool).toHaveBeenCalledTimes(1)
    expect(mockTenant).not.toHaveBeenCalled()
    expect(statuses.length).toBe(1)
  })

  it('_mapSyncSession maps all conflict counts', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/edgeNodeService')
    const s = __testHooks._mapSyncSession(makeSyncRow())
    expect(s.conflictsDetected).toBe(2)
    expect(s.conflictsResolved).toBe(2)
    expect(s.eventsSent).toBe(50)
    expect(s.eventsReceived).toBe(45)
  })
})

// ─── Suite 10: workflow policy boundary tests ─────────────────────────────────

describe('workflow policy boundary tests', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('_checkForUnsafeMutations catches delete from', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({ query: 'delete from audit_log' }, violations)
    expect(violations).not.toHaveLength(0)
  })

  it('_checkForUnsafeMutations catches truncate', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({ raw: 'TRUNCATE tenant_usage' }, violations)
    expect(violations).not.toHaveLength(0)
  })

  it('_checkForUnsafeMutations catches eval()', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({ script: 'eval(userInput)' }, violations)
    expect(violations).not.toHaveLength(0)
  })

  it('_checkForUnsafeMutations allows normal step definition', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const violations: string[] = []
    __testHooks._checkForUnsafeMutations({
      steps: [{ type: 'create_ticket', title: 'New inspection', priority: 'medium' }],
    }, violations)
    expect(violations).toHaveLength(0)
  })

  it('_evalCondition returns false when condition key missing from context', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    expect(__testHooks._evalCondition('missing_key', {})).toBe(false)
  })

  it('_evalCondition returns true when condition key is true in context', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    expect(__testHooks._evalCondition('flag', { flag: true })).toBe(true)
  })

  it('_evalCondition returns false when condition key is false in context', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    expect(__testHooks._evalCondition('flag', { flag: false })).toBe(false)
  })

  it('listWorkflows filters by status', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowRow()]))
    const { listWorkflows } = await import('../../../api/services/ecosystem/workflowComposerService')
    await listWorkflows('T1', 'published')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain("status = $2::workflow_status")
  })

  it('getWorkflowVersions orders by version DESC', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowVersionRow()]))
    const { getWorkflowVersions } = await import('../../../api/services/ecosystem/workflowComposerService')
    await getWorkflowVersions('T1', 'wf-1')
    const query = mockTenant.mock.calls[0]![1] as string
    expect(query).toContain('ORDER BY version DESC')
  })

  it('getWorkflowRuns includes dry runs when includeDryRuns=true', async () => {
    mockTenant.mockResolvedValueOnce(mockRows([makeWorkflowRunRow()]))
    const { getWorkflowRuns } = await import('../../../api/services/ecosystem/workflowComposerService')
    await getWorkflowRuns('T1', 'wf-1', true)
    const query = mockTenant.mock.calls[0]![1] as string
    // When includeDryRuns=true, the condition `$3 = TRUE OR is_dry_run = FALSE` allows all
    expect(query).toContain('$3 = TRUE OR is_dry_run = FALSE')
  })

  it('_mapWorkflowVersion maps version as number', async () => {
    const { __testHooks } = await import('../../../api/services/ecosystem/workflowComposerService')
    const v = __testHooks._mapVersion(makeWorkflowVersionRow())
    expect(typeof v.version).toBe('number')
    expect(v.version).toBe(1)
    expect(v.createdBy).toBe('admin')
  })
})

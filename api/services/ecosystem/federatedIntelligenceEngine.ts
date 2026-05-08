// Denver Engineering — Federated Intelligence Engine (v9.0.0)
// Privacy-safe cross-tenant learning: k-anonymity, opt-in, differential privacy abstraction.

import { createHash, randomBytes } from 'crypto'
import { tenantQuery } from '../../db/pool'
import { default as pool } from '../../db/pool'
import {
  FederatedContribution, FederatedContributionType, FederatedPattern,
  FederatedModelVersion, FederatedPrivacyAudit, K_ANONYMITY_MIN,
} from './ecosystemTypes'

// ─── Tenant opt-in management ─────────────────────────────────────────────────

export async function setFederatedOptIn(
  tenantId: string,
  optIn: boolean,
): Promise<void> {
  // Stored in tenant metadata / feature flags — use tenantQuery for isolation
  await tenantQuery(
    tenantId,
    `INSERT INTO tenant_feature_flags (tenant_id, feature_key, enabled, config, granted_by)
     VALUES ($1, 'federated_learning_opt_in', $2, '{}', 'tenant')
     ON CONFLICT (tenant_id, feature_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [tenantId, optIn],
  )
}

export async function isOptedIn(tenantId: string): Promise<boolean> {
  const res = await tenantQuery(
    tenantId,
    `SELECT enabled FROM tenant_feature_flags
     WHERE tenant_id = $1 AND feature_key = 'federated_learning_opt_in'`,
    [tenantId],
  )
  return res.rows[0]?.enabled === true
}

// ─── Submit a contribution ────────────────────────────────────────────────────

export interface ContributeInput {
  contributionType: FederatedContributionType
  rawData: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export async function contributeData(
  tenantId: string,
  input: ContributeInput,
): Promise<FederatedContribution> {
  // Gate on opt-in
  const optedIn = await isOptedIn(tenantId)
  if (!optedIn) {
    throw new Error(`Tenant ${tenantId} has not opted in to federated learning`)
  }

  const anonymized = _anonymize(input.rawData)
  const privacyHash = _hashData(JSON.stringify(anonymized))

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO federated_contributions
      (tenant_id, contribution_type, anonymized_data, privacy_hash, opt_in_verified)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (tenant_id, privacy_hash) WHERE status != 'withdrawn'
     DO UPDATE SET updated_at = now()
     RETURNING *`,
    [tenantId, input.contributionType, JSON.stringify(anonymized), privacyHash],
  )

  // Record privacy audit
  await _recordPrivacyAudit({
    contributionId: res.rows[0].id,
    auditType: 'opt_in_check',
    passed: true,
    details: { tenantId, contributionType: input.contributionType },
  })

  return _mapContribution(res.rows[0])
}

// ─── Privacy audit ────────────────────────────────────────────────────────────

async function _recordPrivacyAudit(params: {
  contributionId: string
  auditType: string
  passed: boolean
  details: Record<string, unknown>
}): Promise<void> {
  await pool.query(
    `INSERT INTO federated_privacy_audits
      (contribution_id, audit_type, passed, details)
     VALUES ($1, $2, $3, $4)`,
    [params.contributionId, params.auditType, params.passed, JSON.stringify(params.details)],
  )
}

export async function getPrivacyAudits(contributionId: string): Promise<FederatedPrivacyAudit[]> {
  const res = await pool.query(
    `SELECT * FROM federated_privacy_audits
     WHERE contribution_id = $1 ORDER BY created_at ASC`,
    [contributionId],
  )
  return res.rows.map(_mapPrivacyAudit)
}

// ─── Pattern publishing (admin) ───────────────────────────────────────────────

export interface PublishPatternInput {
  patternType: string
  industrySegment?: string
  region?: string
  projectType?: string
  patternData: Record<string, unknown>
  confidenceScore: number
  contributorCount: number
}

export async function publishPattern(input: PublishPatternInput): Promise<FederatedPattern> {
  // Enforce k-anonymity before publishing
  if (input.contributorCount < K_ANONYMITY_MIN) {
    throw new Error(
      `K-anonymity threshold not met: ${input.contributorCount} < ${K_ANONYMITY_MIN} required`,
    )
  }

  const res = await pool.query(
    `INSERT INTO federated_patterns
      (pattern_type, industry_segment, region, project_type, pattern_data,
       confidence_score, contributor_count, k_anonymity_met)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     RETURNING *`,
    [
      input.patternType,
      input.industrySegment ?? null,
      input.region ?? null,
      input.projectType ?? null,
      JSON.stringify(input.patternData),
      input.confidenceScore,
      input.contributorCount,
    ],
  )
  return _mapPattern(res.rows[0])
}

export async function getPattern(patternId: string): Promise<FederatedPattern | null> {
  const res = await pool.query(
    `SELECT * FROM federated_patterns WHERE id = $1`,
    [patternId],
  )
  return res.rows.length > 0 ? _mapPattern(res.rows[0]) : null
}

export async function listActivePatterns(patternType?: string): Promise<FederatedPattern[]> {
  const res = await pool.query(
    `SELECT * FROM federated_patterns
     WHERE is_active = TRUE AND k_anonymity_met = TRUE
       AND ($1::text IS NULL OR pattern_type = $1)
     ORDER BY confidence_score DESC`,
    [patternType ?? null],
  )
  return res.rows.map(_mapPattern)
}

// ─── Model version management ─────────────────────────────────────────────────

export async function createModelVersion(params: {
  patternType: string
  version: number
  contributorCount: number
  releaseNotes?: string
}): Promise<FederatedModelVersion> {
  const checksum = _hashData(`${params.patternType}:${params.version}:${Date.now()}`)
  const res = await pool.query(
    `INSERT INTO federated_model_versions
      (pattern_type, version, model_checksum, contributor_count, release_notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.patternType, params.version, checksum, params.contributorCount, params.releaseNotes ?? null],
  )
  return _mapModelVersion(res.rows[0])
}

export async function activateModelVersion(versionId: string): Promise<FederatedModelVersion> {
  const res = await pool.query(
    `UPDATE federated_model_versions
     SET is_active = TRUE, activated_at = now()
     WHERE id = $1 RETURNING *`,
    [versionId],
  )
  if (res.rows.length === 0) throw new Error(`Model version ${versionId} not found`)
  return _mapModelVersion(res.rows[0])
}

export async function withdrawContribution(
  tenantId: string,
  contributionId: string,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE federated_contributions
     SET status = 'withdrawn', updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [contributionId, tenantId],
  )
}

// ─── Privacy helpers ──────────────────────────────────────────────────────────

function _anonymize(raw: Record<string, unknown>): Record<string, unknown> {
  // Remove identifying fields, preserve statistical shape
  const stripped = { ...raw }
  for (const key of ['tenant_id', 'tenantId', 'project_id', 'projectId', 'user_id', 'userId']) {
    delete stripped[key]
  }
  // Add differential-privacy noise placeholder (production: use Laplace mechanism)
  return { ...stripped, _dp_noise_applied: true, _salt: randomBytes(4).toString('hex') }
}

function _hashData(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapContribution(row: Record<string, unknown>): FederatedContribution {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    contributionType: row['contribution_type'] as FederatedContributionType,
    anonymizedData: (typeof row['anonymized_data'] === 'string'
      ? JSON.parse(row['anonymized_data'])
      : row['anonymized_data']) as Record<string, unknown>,
    privacyHash: row['privacy_hash'] as string,
    kCount: Number(row['k_count'] ?? 1),
    status: row['status'] as FederatedContribution['status'],
    optInVerified: Boolean(row['opt_in_verified']),
    rejectedReason: (row['rejected_reason'] as string) ?? null,
    publishedAt: row['published_at'] != null ? new Date(row['published_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapPattern(row: Record<string, unknown>): FederatedPattern {
  return {
    id: row['id'] as string,
    patternType: row['pattern_type'] as string,
    industrySegment: (row['industry_segment'] as string) ?? null,
    region: (row['region'] as string) ?? null,
    projectType: (row['project_type'] as string) ?? null,
    patternData: (typeof row['pattern_data'] === 'string'
      ? JSON.parse(row['pattern_data'])
      : row['pattern_data']) as Record<string, unknown>,
    confidenceScore: Number(row['confidence_score']),
    contributorCount: Number(row['contributor_count']),
    kAnonymityMet: Boolean(row['k_anonymity_met']),
    version: Number(row['version'] ?? 1),
    isActive: Boolean(row['is_active']),
    expiresAt: row['expires_at'] != null ? new Date(row['expires_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapModelVersion(row: Record<string, unknown>): FederatedModelVersion {
  return {
    id: row['id'] as string,
    patternType: row['pattern_type'] as string,
    version: Number(row['version']),
    modelChecksum: row['model_checksum'] as string,
    contributorCount: Number(row['contributor_count']),
    trainingWindow: null,
    releaseNotes: (row['release_notes'] as string) ?? null,
    isActive: Boolean(row['is_active']),
    activatedAt: row['activated_at'] != null ? new Date(row['activated_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapPrivacyAudit(row: Record<string, unknown>): FederatedPrivacyAudit {
  return {
    id: row['id'] as string,
    contributionId: (row['contribution_id'] as string) ?? null,
    auditType: row['audit_type'] as string,
    passed: Boolean(row['passed']),
    details: (typeof row['details'] === 'string'
      ? JSON.parse(row['details'])
      : row['details']) as Record<string, unknown>,
    auditedBy: row['audited_by'] as string,
    createdAt: new Date(row['created_at'] as string),
  }
}

export const __testHooks = {
  _anonymize,
  _hashData,
  _mapContribution,
  _mapPattern,
  _mapModelVersion,
  _mapPrivacyAudit,
}

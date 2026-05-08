// Denver Engineering — Playbook Marketplace Service (v9.0.0)
// Operational playbook versioning, sandbox validation, tenant install/uninstall,
// outcome tracking, and immutable published versions.

import { createHash } from 'crypto'
import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  MarketplacePlaybook, PlaybookVersion, TenantPlaybookInstall, PlaybookStatus,
} from './ecosystemTypes'

// ─── Playbook CRUD ────────────────────────────────────────────────────────────

export interface CreatePlaybookInput {
  slug: string
  name: string
  description?: string
  playbookType: string
  industryTags?: string[]
  authorTenantId?: string
  publisher?: string
  definition: Record<string, unknown>
}

export async function createPlaybook(input: CreatePlaybookInput): Promise<MarketplacePlaybook> {
  const res = await pool.query(
    `INSERT INTO marketplace_playbooks
      (slug, name, description, playbook_type, industry_tags, author_tenant_id, publisher)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      input.slug, input.name, input.description ?? null,
      input.playbookType, input.industryTags ?? [],
      input.authorTenantId ?? null, input.publisher ?? 'ava',
    ],
  )
  const playbook = _mapPlaybook(res.rows[0])

  // Create initial version
  await _createVersion(playbook.id, '1.0.0', input.definition, 'Initial version')

  return playbook
}

export async function getPlaybook(playbookId: string): Promise<MarketplacePlaybook | null> {
  const res = await pool.query(
    `SELECT * FROM marketplace_playbooks WHERE id = $1`,
    [playbookId],
  )
  return res.rows.length > 0 ? _mapPlaybook(res.rows[0]) : null
}

export async function listPlaybooks(opts: {
  status?: PlaybookStatus
  playbookType?: string
  industryTag?: string
} = {}): Promise<MarketplacePlaybook[]> {
  const res = await pool.query(
    `SELECT * FROM marketplace_playbooks
     WHERE ($1::text IS NULL OR status = $1::playbook_status)
       AND ($2::text IS NULL OR playbook_type = $2)
       AND ($3::text IS NULL OR $3 = ANY(industry_tags))
     ORDER BY install_count DESC, created_at DESC`,
    [opts.status ?? null, opts.playbookType ?? null, opts.industryTag ?? null],
  )
  return res.rows.map(_mapPlaybook)
}

// ─── Version management ───────────────────────────────────────────────────────

async function _createVersion(
  playbookId: string,
  version: string,
  definition: Record<string, unknown>,
  changelog?: string,
): Promise<PlaybookVersion> {
  const checksum = createHash('sha256').update(JSON.stringify(definition)).digest('hex')
  const res = await pool.query(
    `INSERT INTO playbook_versions (playbook_id, version, definition, checksum, changelog)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [playbookId, version, JSON.stringify(definition), checksum, changelog ?? null],
  )
  return _mapVersion(res.rows[0])
}

export async function publishPlaybook(
  playbookId: string,
  sandboxValidated: boolean,
): Promise<MarketplacePlaybook> {
  if (!sandboxValidated) {
    throw new Error(`Playbook ${playbookId} must pass sandbox validation before publishing`)
  }

  // Mark current version immutable
  await pool.query(
    `UPDATE playbook_versions pv
     SET is_immutable = TRUE
     FROM marketplace_playbooks mp
     WHERE pv.playbook_id = mp.id AND mp.id = $1 AND pv.version = mp.current_version`,
    [playbookId],
  )

  const res = await pool.query(
    `UPDATE marketplace_playbooks
     SET status = 'published', sandbox_validated = TRUE, published_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [playbookId],
  )
  if (res.rows.length === 0) throw new Error(`Playbook ${playbookId} not found`)
  return _mapPlaybook(res.rows[0])
}

export async function getPlaybookVersion(
  playbookId: string,
  version: string,
): Promise<PlaybookVersion | null> {
  const res = await pool.query(
    `SELECT * FROM playbook_versions WHERE playbook_id = $1 AND version = $2`,
    [playbookId, version],
  )
  return res.rows.length > 0 ? _mapVersion(res.rows[0]) : null
}

// ─── Tenant install/uninstall ─────────────────────────────────────────────────

export interface InstallPlaybookInput {
  version?: string
  installedBy?: string
  sandboxRunId?: string
}

export async function installPlaybook(
  tenantId: string,
  playbookId: string,
  input: InstallPlaybookInput = {},
): Promise<TenantPlaybookInstall> {
  const playbook = await getPlaybook(playbookId)
  if (playbook == null) throw new Error(`Playbook ${playbookId} not found`)
  if (playbook.status !== 'published') {
    throw new Error(`Playbook ${playbookId} is not published (status: ${playbook.status})`)
  }

  const version = input.version ?? playbook.currentVersion

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_playbook_installs
      (tenant_id, playbook_id, version, installed_by, sandbox_run_id)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [tenantId, playbookId, version, input.installedBy ?? 'system', input.sandboxRunId ?? null],
  )

  // Increment install count
  await pool.query(
    `UPDATE marketplace_playbooks SET install_count = install_count + 1 WHERE id = $1`,
    [playbookId],
  )

  return _mapInstall(res.rows[0])
}

export async function uninstallPlaybook(
  tenantId: string,
  playbookId: string,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE tenant_playbook_installs
     SET is_active = FALSE, uninstalled_at = now()
     WHERE tenant_id = $1 AND playbook_id = $2 AND is_active = TRUE`,
    [tenantId, playbookId],
  )
}

export async function getTenantInstalls(tenantId: string): Promise<TenantPlaybookInstall[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_playbook_installs
     WHERE tenant_id = $1 AND is_active = TRUE ORDER BY installed_at DESC`,
    [tenantId],
  )
  return res.rows.map(_mapInstall)
}

export async function submitPlaybookReview(
  tenantId: string,
  playbookId: string,
  rating: number,
  reviewText?: string,
): Promise<void> {
  if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5')
  await tenantQuery(
    tenantId,
    `INSERT INTO playbook_reviews (playbook_id, tenant_id, rating, review_text)
     VALUES ($1, $2, $3, $4)`,
    [playbookId, tenantId, rating, reviewText ?? null],
  )
  // Update avg_rating
  await pool.query(
    `UPDATE marketplace_playbooks
     SET avg_rating = (SELECT AVG(rating)::numeric(3,2) FROM playbook_reviews WHERE playbook_id = $1)
     WHERE id = $1`,
    [playbookId],
  )
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapPlaybook(row: Record<string, unknown>): MarketplacePlaybook {
  return {
    id: row['id'] as string,
    slug: row['slug'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? null,
    playbookType: row['playbook_type'] as string,
    industryTags: (row['industry_tags'] as string[]) ?? [],
    authorTenantId: (row['author_tenant_id'] as string) ?? null,
    publisher: row['publisher'] as string,
    status: row['status'] as PlaybookStatus,
    currentVersion: row['current_version'] as string,
    sandboxValidated: Boolean(row['sandbox_validated']),
    policyCompatible: Boolean(row['policy_compatible']),
    installCount: Number(row['install_count'] ?? 0),
    avgRating: row['avg_rating'] != null ? Number(row['avg_rating']) : null,
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    publishedAt: row['published_at'] != null ? new Date(row['published_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapVersion(row: Record<string, unknown>): PlaybookVersion {
  return {
    id: row['id'] as string,
    playbookId: row['playbook_id'] as string,
    version: row['version'] as string,
    definition: (typeof row['definition'] === 'string'
      ? JSON.parse(row['definition'])
      : row['definition']) as Record<string, unknown>,
    changelog: (row['changelog'] as string) ?? null,
    checksum: row['checksum'] as string,
    isImmutable: Boolean(row['is_immutable']),
    createdBy: row['created_by'] as string,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapInstall(row: Record<string, unknown>): TenantPlaybookInstall {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    playbookId: row['playbook_id'] as string,
    version: row['version'] as string,
    installedBy: row['installed_by'] as string,
    isActive: Boolean(row['is_active']),
    sandboxRunId: (row['sandbox_run_id'] as string) ?? null,
    installedAt: new Date(row['installed_at'] as string),
    uninstalledAt: row['uninstalled_at'] != null ? new Date(row['uninstalled_at'] as string) : null,
  }
}

export const __testHooks = { _mapPlaybook, _mapVersion, _mapInstall }

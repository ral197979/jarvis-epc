// Denver Engineering — Plugin Publisher Portal (Phase 11)
// Manage plugin submissions, review, and publishing for the partner ecosystem

import { pool } from '../../db/pool'

// ─── Plugin Submission ────────────────────────────────────────────────────────

export type PluginStatus =
  | 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'published' | 'deprecated'

export interface PluginSubmission {
  id: string
  partnerId: string
  pluginName: string
  pluginVersion: string
  description: string
  status: PluginStatus
  reviewNotes: string | null
  manifestHash: string
  submittedAt: Date
  reviewedAt: Date | null
  publishedAt: Date | null
  createdAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapSubmission(row: Record<string, unknown>): PluginSubmission {
  return {
    id: row.id as string,
    partnerId: row.partner_id as string,
    pluginName: row.plugin_name as string,
    pluginVersion: row.plugin_version as string,
    description: row.description as string,
    status: row.status as PluginStatus,
    reviewNotes: row.review_notes as string | null,
    manifestHash: row.manifest_hash as string,
    submittedAt: new Date(row.submitted_at as string),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at as string) : null,
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Submit Plugin ────────────────────────────────────────────────────────────

export async function submitPlugin(
  partnerId: string,
  pluginName: string,
  pluginVersion: string,
  description: string,
  manifestHash: string
): Promise<PluginSubmission> {
  const result = await pool.query(
    `INSERT INTO plugin_submissions
       (partner_id, plugin_name, plugin_version, description, status,
        review_notes, manifest_hash, submitted_at, reviewed_at, published_at, created_at)
     VALUES ($1, $2, $3, $4, 'submitted', NULL, $5, NOW(), NULL, NULL, NOW())
     RETURNING *`,
    [partnerId, pluginName, pluginVersion, description, manifestHash]
  )
  return _mapSubmission(result.rows[0])
}

// ─── Start Review ─────────────────────────────────────────────────────────────

export async function startPluginReview(submissionId: string): Promise<PluginSubmission> {
  const result = await pool.query(
    `UPDATE plugin_submissions SET status = 'under_review' WHERE id = $1 RETURNING *`,
    [submissionId]
  )
  if (result.rows.length === 0) throw new Error(`Submission ${submissionId} not found`)
  return _mapSubmission(result.rows[0])
}

// ─── Approve Plugin ───────────────────────────────────────────────────────────

export async function approvePlugin(
  submissionId: string,
  reviewNotes: string | null = null
): Promise<PluginSubmission> {
  const result = await pool.query(
    `UPDATE plugin_submissions
     SET status = 'approved', review_notes = $1, reviewed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [reviewNotes, submissionId]
  )
  if (result.rows.length === 0) throw new Error(`Submission ${submissionId} not found`)
  return _mapSubmission(result.rows[0])
}

// ─── Reject Plugin ────────────────────────────────────────────────────────────

export async function rejectPlugin(
  submissionId: string,
  reviewNotes: string
): Promise<PluginSubmission> {
  const result = await pool.query(
    `UPDATE plugin_submissions
     SET status = 'rejected', review_notes = $1, reviewed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [reviewNotes, submissionId]
  )
  if (result.rows.length === 0) throw new Error(`Submission ${submissionId} not found`)
  return _mapSubmission(result.rows[0])
}

// ─── Publish Plugin ───────────────────────────────────────────────────────────

export async function publishPlugin(submissionId: string): Promise<PluginSubmission> {
  const result = await pool.query(
    `UPDATE plugin_submissions
     SET status = 'published', published_at = NOW()
     WHERE id = $1 AND status = 'approved'
     RETURNING *`,
    [submissionId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Submission ${submissionId} not found or not in approved state`)
  }
  return _mapSubmission(result.rows[0])
}

// ─── Deprecate Plugin ─────────────────────────────────────────────────────────

export async function deprecatePlugin(submissionId: string): Promise<PluginSubmission> {
  const result = await pool.query(
    `UPDATE plugin_submissions SET status = 'deprecated' WHERE id = $1 RETURNING *`,
    [submissionId]
  )
  if (result.rows.length === 0) throw new Error(`Submission ${submissionId} not found`)
  return _mapSubmission(result.rows[0])
}

// ─── Get Submission ───────────────────────────────────────────────────────────

export async function getPluginSubmission(submissionId: string): Promise<PluginSubmission | null> {
  const result = await pool.query(
    `SELECT * FROM plugin_submissions WHERE id = $1`,
    [submissionId]
  )
  return result.rows.length > 0 ? _mapSubmission(result.rows[0]) : null
}

// ─── List Submissions ─────────────────────────────────────────────────────────

export async function listPluginSubmissions(
  partnerId?: string,
  status?: PluginStatus
): Promise<PluginSubmission[]> {
  let query = `SELECT * FROM plugin_submissions WHERE 1=1`
  const params: unknown[] = []
  let idx = 1

  if (partnerId) {
    query += ` AND partner_id = $${idx++}`
    params.push(partnerId)
  }
  if (status) {
    query += ` AND status = $${idx++}`
    params.push(status)
  }
  query += ` ORDER BY submitted_at DESC`

  const result = await pool.query(query, params)
  return result.rows.map(_mapSubmission)
}

// ─── Get Published Plugins ────────────────────────────────────────────────────

export async function getPublishedPlugins(): Promise<PluginSubmission[]> {
  const result = await pool.query(
    `SELECT * FROM plugin_submissions WHERE status = 'published' ORDER BY published_at DESC`
  )
  return result.rows.map(_mapSubmission)
}

// ─── Compute Manifest Hash Validity ──────────────────────────────────────────

export function isManifestHashValid(manifestHash: string): boolean {
  // SHA-256 hash is 64 hex chars
  return /^[a-f0-9]{64}$/.test(manifestHash)
}

// ─── Can Publish ──────────────────────────────────────────────────────────────

export function canPublish(submission: PluginSubmission): boolean {
  return submission.status === 'approved'
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapSubmission,
  isManifestHashValid,
  canPublish,
}

// Denver Engineering — API Gateway Service (v8.0.0)
// API key lifecycle: creation, rotation, quota tracking, scope enforcement.

import { randomBytes, createHash } from 'crypto'
import { tenantQuery } from '../../db/pool'
import {
  ApiKey, ApiKeyWithSecret, CreateApiKeyInput, ApiKeyStatus,
} from './enterpriseTypes'

const KEY_PREFIX_LENGTH = 8
const KEY_SECRET_BYTES = 32

// ─── Create API key ───────────────────────────────────────────────────────────

export async function createApiKey(
  tenantId: string,
  input: CreateApiKeyInput,
): Promise<ApiKeyWithSecret> {
  const { name, scopes = [], quotaMonthly, expiresAt, createdBy } = input

  const rawSecret = randomBytes(KEY_SECRET_BYTES).toString('hex')
  const keyPrefix = rawSecret.substring(0, KEY_PREFIX_LENGTH)
  const keyHash = _hashKey(rawSecret)

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO api_keys
      (tenant_id, key_hash, key_prefix, name, status, scopes, quota_monthly, expires_at, created_by, metadata)
     VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,'{}')
     RETURNING *`,
    [tenantId, keyHash, keyPrefix, name, scopes, quotaMonthly ?? null, expiresAt ?? null, createdBy ?? null],
  )

  return {
    key: _mapApiKey(res.rows[0]),
    secret: rawSecret, // returned once only
  }
}

// ─── Look up key by secret (authentication path) ──────────────────────────────

export async function authenticateApiKey(
  tenantId: string,
  rawSecret: string,
): Promise<ApiKey | null> {
  const keyHash = _hashKey(rawSecret)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM api_keys
     WHERE tenant_id = $1
       AND key_hash = $2
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())`,
    [tenantId, keyHash],
  )
  if (res.rows.length === 0) return null

  // Update last_used_at (fire-and-forget)
  tenantQuery(
    tenantId,
    `UPDATE api_keys SET last_used_at = now() WHERE id = $1`,
    [res.rows[0].id],
  ).catch(() => {})

  return _mapApiKey(res.rows[0])
}

// ─── List API keys ────────────────────────────────────────────────────────────

export async function listApiKeys(
  tenantId: string,
  opts: { status?: ApiKeyStatus; limit?: number } = {},
): Promise<ApiKey[]> {
  const { status, limit = 100 } = opts
  const params: unknown[] = [tenantId]
  let statusCond = ''
  if (status != null) { params.push(status); statusCond = `AND status = $${params.length}` }
  params.push(limit)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM api_keys WHERE tenant_id = $1 ${statusCond}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapApiKey)
}

// ─── Revoke API key ───────────────────────────────────────────────────────────

export async function revokeApiKey(
  tenantId: string,
  keyId: string,
  revokedBy?: string,
): Promise<ApiKey> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE api_keys SET
       status = 'revoked',
       revoked_at = now(),
       revoked_by = $2
     WHERE tenant_id = $1 AND id = $3
     RETURNING *`,
    [tenantId, revokedBy ?? null, keyId],
  )
  if (res.rows.length === 0) throw new Error(`API key ${keyId} not found`)
  return _mapApiKey(res.rows[0])
}

// ─── Increment usage counter ──────────────────────────────────────────────────

export async function incrementApiKeyUsage(
  tenantId: string,
  keyId: string,
  count = 1,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE api_keys SET usage_this_month = usage_this_month + $2 WHERE tenant_id = $1 AND id = $3`,
    [tenantId, count, keyId],
  )
}

// ─── Reset monthly usage (billing cycle) ─────────────────────────────────────

export async function resetMonthlyUsage(tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE api_keys SET usage_this_month = 0 WHERE tenant_id = $1`,
    [tenantId],
  )
}

// ─── Check if key has scope ───────────────────────────────────────────────────

export function hasScope(key: ApiKey, requiredScope: string): boolean {
  return key.scopes.includes(requiredScope) || key.scopes.includes('*')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _hashKey(rawSecret: string): string {
  return createHash('sha256').update(rawSecret).digest('hex')
}

export function _mapApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    keyHash: String(row.key_hash),
    keyPrefix: String(row.key_prefix),
    name: String(row.name),
    status: row.status as ApiKeyStatus,
    scopes: (row.scopes as string[]) ?? [],
    quotaMonthly: row.quota_monthly != null ? Number(row.quota_monthly) : undefined,
    usageThisMonth: Number(row.usage_this_month ?? 0),
    lastUsedAt: row.last_used_at != null ? new Date(row.last_used_at as string) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    revokedAt: row.revoked_at != null ? new Date(row.revoked_at as string) : undefined,
    revokedBy: row.revoked_by != null ? String(row.revoked_by) : undefined,
    createdBy: row.created_by != null ? String(row.created_by) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapApiKey, _hashKey, hasScope }

/**
 * Denver Engineering — Enterprise Integration Connector Framework (v4.40.0)
 * ──────────────────────────────────────────────────────────────────────────
 * Ava Phase 4 — Manages external system connectors (Slack, Teams, ERP,
 * CMMS, BACnet, etc.) with credential vault abstraction, retry/backoff,
 * dead-letter support, and health scoring.
 */

import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectorType =
  | 'slack' | 'teams' | 'email' | 'erp' | 'cmms' | 'bacnet'
  | 'quickbooks' | 'sap' | 'oracle' | 'webhook' | 'custom'

export interface ConnectorConfig {
  tenantId:     string
  name:         string
  type:         ConnectorType
  config:       Record<string, unknown>
  credentialRef?: string
  createdBy:    string
}

export interface ConnectorHealth {
  connectorId:   string
  status:        string
  healthScore:   number
  lastSyncAt:    string | null
  consecutiveFailures: number
  lastError?:    string
}

// ─── Retry Backoff ────────────────────────────────────────────────────────────

const BACKOFF_CAPS_SECONDS = [30, 60, 300, 900, 3600]

export function _buildRetryDelay(attempts: number): number {
  // Exponential backoff: 30s, 60s, 5m, 15m, 1h — capped
  const index = Math.min(attempts, BACKOFF_CAPS_SECONDS.length - 1)
  return BACKOFF_CAPS_SECONDS[index]! * 1000
}

// ─── Health Score Calculation ─────────────────────────────────────────────────

export function _computeHealthScore(
  consecutiveFailures: number,
  lastSyncAgeMinutes: number | null
): number {
  let score = 100
  score -= Math.min(consecutiveFailures * 15, 60)   // up to -60 for failures
  if (lastSyncAgeMinutes !== null) {
    if (lastSyncAgeMinutes > 1440) score -= 20       // >24h stale
    else if (lastSyncAgeMinutes > 360) score -= 10   // >6h stale
  }
  return Math.max(0, score)
}

// ─── Connector Registry ───────────────────────────────────────────────────────

export async function registerConnector(
  input: ConnectorConfig
): Promise<string> {
  const { rows } = await tenantQuery(input.tenantId, `
    INSERT INTO integration_connectors
      (tenant_id, name, connector_type, config, credential_ref, created_by)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6)
    RETURNING id
  `, [input.tenantId, input.name, input.type,
      JSON.stringify(input.config), input.credentialRef ?? null, input.createdBy])
  return rows[0]!.id as string
}

// ─── Enqueue Integration Job ──────────────────────────────────────────────────

export async function enqueueIntegrationJob(
  tenantId: string,
  connectorId: string,
  jobType: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<string | null> {
  try {
    const { rows } = await tenantQuery(tenantId, `
      INSERT INTO integration_jobs
        (tenant_id, connector_id, job_type, payload, idempotency_key)
      VALUES ($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `, [tenantId, connectorId, jobType, JSON.stringify(payload), idempotencyKey ?? null])
    return rows[0]?.id as string ?? null
  } catch {
    return null
  }
}

// ─── Worker: Claim Next Job ───────────────────────────────────────────────────

export async function claimIntegrationJob(
  workerId: string
): Promise<unknown | null> {
  // System-level claim (not tenant-scoped) — worker processes jobs across tenants
  const client = await (await import('../../db/pool')).pool!.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      SELECT j.*, c.connector_type, c.config, c.credential_ref
      FROM integration_jobs j
      JOIN integration_connectors c ON c.id = j.connector_id
      WHERE j.status = 'pending' AND j.next_attempt_at <= now()
        AND j.attempts < j.max_attempts
      ORDER BY j.created_at ASC
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED
    `)
    if (!rows[0]) { await client.query('ROLLBACK'); return null }
    await client.query(`
      UPDATE integration_jobs SET status = 'running', claimed_by = $1, claimed_at = now(),
        attempts = attempts + 1
      WHERE id = $2
    `, [workerId, rows[0].id])
    await client.query('COMMIT')
    return rows[0]
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// ─── Complete or Fail Job ─────────────────────────────────────────────────────

export async function completeIntegrationJob(
  jobId: string,
  tenantId: string,
  result: Record<string, unknown>
): Promise<void> {
  await tenantQuery(tenantId, `
    UPDATE integration_jobs SET status = 'completed', result = $1::jsonb, completed_at = now()
    WHERE id = $2 AND tenant_id = $3
  `, [JSON.stringify(result), jobId, tenantId])
  // Reset connector health on success
  await tenantQuery(tenantId, `
    UPDATE integration_connectors SET consecutive_failures = 0, last_sync_at = now(),
      health_score = LEAST(100, health_score + 10), last_error = NULL
    WHERE id = (SELECT connector_id FROM integration_jobs WHERE id = $1)
  `, [jobId])
}

export async function failIntegrationJob(
  jobId: string,
  tenantId: string,
  error: string
): Promise<void> {
  const { rows } = await tenantQuery(tenantId, `
    UPDATE integration_jobs SET error = $1,
      next_attempt_at = now() + ($2 || ' milliseconds')::interval
    WHERE id = $3 AND tenant_id = $4
    RETURNING attempts, max_attempts, connector_id
  `, [error, String(_buildRetryDelay(0)), jobId, tenantId])

  if (!rows[0]) return
  const { attempts, max_attempts, connector_id } = rows[0]

  if (attempts >= max_attempts) {
    await tenantQuery(tenantId,
      `UPDATE integration_jobs SET status = 'dead_letter' WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId])
  }

  // Increment consecutive failures and recompute health
  await tenantQuery(tenantId, `
    UPDATE integration_connectors
    SET consecutive_failures = consecutive_failures + 1,
        last_error = $1,
        health_score = GREATEST(0, health_score - 15)
    WHERE id = $2 AND tenant_id = $3
  `, [error, connector_id, tenantId])
}

// ─── Connector Health ─────────────────────────────────────────────────────────

export async function getConnectorHealth(
  tenantId: string,
  connectorId: string
): Promise<ConnectorHealth> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT id, status, health_score, last_sync_at, consecutive_failures, last_error
    FROM integration_connectors
    WHERE id = $1 AND tenant_id = $2
  `, [connectorId, tenantId])
  if (!rows[0]) throw new Error(`Connector ${connectorId} not found`)
  const r = rows[0]
  const ageMins = r.last_sync_at
    ? Math.floor((Date.now() - new Date(r.last_sync_at).getTime()) / 60000)
    : null
  const freshScore = _computeHealthScore(r.consecutive_failures, ageMins)
  return {
    connectorId: r.id, status: r.status,
    healthScore: freshScore,
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
    consecutiveFailures: r.consecutive_failures,
    lastError: r.last_error ?? undefined,
  }
}

// ─── List Connectors ──────────────────────────────────────────────────────────

export async function listConnectors(
  tenantId: string
): Promise<unknown[]> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT id, name, connector_type, status, health_score, last_sync_at, consecutive_failures
    FROM integration_connectors WHERE tenant_id = $1 ORDER BY name ASC
  `, [tenantId])
  return rows
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _buildRetryDelay,
  _computeHealthScore,
  registerConnector,
  enqueueIntegrationJob,
  claimIntegrationJob,
  completeIntegrationJob,
  failIntegrationJob,
  getConnectorHealth,
  BACKOFF_CAPS_SECONDS,
}

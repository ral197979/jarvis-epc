// Denver Engineering — Deployment Health Service (v8.0.0)
// Health checks, rolling upgrade drain support, and deployment observability.

import { tenantQuery } from '../../db/pool'
import { default as pool } from '../../db/pool'
import {
  DeploymentHealthCheck, DeploymentHealthReport,
} from './enterpriseTypes'

// ─── Record a health check result ────────────────────────────────────────────

export async function recordHealthCheck(
  check: Omit<DeploymentHealthCheck, 'id' | 'checkedAt'>,
): Promise<DeploymentHealthCheck> {
  const res = await pool.query(
    `INSERT INTO deployment_health_checks
      (check_name, status, message, value, threshold, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [check.checkName, check.status, check.message ?? null, check.value ?? null, check.threshold ?? null, JSON.stringify(check.metadata ?? {})],
  )
  return _mapHealthCheck(res.rows[0])
}

// ─── Get latest check by name ─────────────────────────────────────────────────

export async function getLatestCheck(checkName: string): Promise<DeploymentHealthCheck | null> {
  const res = await pool.query(
    `SELECT * FROM deployment_health_checks
     WHERE check_name = $1 ORDER BY checked_at DESC LIMIT 1`,
    [checkName],
  )
  return res.rows.length > 0 ? _mapHealthCheck(res.rows[0]) : null
}

// ─── Generate deployment health report ───────────────────────────────────────

export async function generateHealthReport(): Promise<DeploymentHealthReport> {
  // Latest result for each check_name
  const res = await pool.query(
    `SELECT DISTINCT ON (check_name) *
     FROM deployment_health_checks
     ORDER BY check_name, checked_at DESC`,
  )

  const checks = res.rows.map(_mapHealthCheck)
  const failingCount = checks.filter(c => c.status === 'failing').length
  const warningCount = checks.filter(c => c.status === 'warning').length
  const passingCount = checks.filter(c => c.status === 'passing').length

  let overall: DeploymentHealthReport['overall'] = 'healthy'
  if (failingCount > 0) overall = 'unhealthy'
  else if (warningCount > 0) overall = 'degraded'

  return { overall, checks, failingCount, warningCount, passingCount, generatedAt: new Date() }
}

// ─── Run built-in platform checks ────────────────────────────────────────────

export async function runPlatformChecks(): Promise<DeploymentHealthReport> {
  const results = await Promise.allSettled([
    _checkDatabase(),
    _checkTenantCount(),
    _checkActiveSubscriptions(),
  ])

  for (const result of results) {
    if (result.status === 'fulfilled') {
      await recordHealthCheck(result.value).catch(() => { /* non-fatal */ })
    }
  }

  return generateHealthReport()
}

async function _checkDatabase(): Promise<Omit<DeploymentHealthCheck, 'id' | 'checkedAt'>> {
  const start = Date.now()
  try {
    await pool.query('SELECT 1')
    const latencyMs = Date.now() - start
    return {
      checkName: 'database.connectivity',
      status: latencyMs > 500 ? 'warning' : 'passing',
      message: `DB responded in ${latencyMs}ms`,
      value: latencyMs,
      threshold: 500,
      metadata: {},
    }
  } catch (err) {
    return {
      checkName: 'database.connectivity',
      status: 'failing',
      message: err instanceof Error ? err.message : 'DB unreachable',
      metadata: {},
    }
  }
}

async function _checkTenantCount(): Promise<Omit<DeploymentHealthCheck, 'id' | 'checkedAt'>> {
  try {
    const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM tenant_subscriptions`)
    const count = Number(res.rows[0]?.cnt ?? 0)
    return {
      checkName: 'platform.tenant_count',
      status: 'passing',
      message: `${count} tenants registered`,
      value: count,
      metadata: {},
    }
  } catch {
    return { checkName: 'platform.tenant_count', status: 'warning', message: 'Could not query tenant count', metadata: {} }
  }
}

async function _checkActiveSubscriptions(): Promise<Omit<DeploymentHealthCheck, 'id' | 'checkedAt'>> {
  try {
    const res = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE lifecycle_status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE lifecycle_status = 'trial')::int AS trial
       FROM tenant_subscriptions`,
    )
    const active = Number(res.rows[0]?.active ?? 0)
    const trial = Number(res.rows[0]?.trial ?? 0)
    return {
      checkName: 'platform.subscriptions',
      status: 'passing',
      message: `${active} active, ${trial} trial`,
      value: active + trial,
      metadata: { active, trial },
    }
  } catch {
    return { checkName: 'platform.subscriptions', status: 'warning', message: 'Could not query subscriptions', metadata: {} }
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function _mapHealthCheck(row: Record<string, unknown>): DeploymentHealthCheck {
  return {
    id: row.id as string,
    checkName: String(row.check_name),
    status: row.status as DeploymentHealthCheck['status'],
    message: row.message != null ? String(row.message) : undefined,
    value: row.value != null ? Number(row.value) : undefined,
    threshold: row.threshold != null ? Number(row.threshold) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    checkedAt: new Date(row.checked_at as string),
  }
}

export const __testHooks = { _mapHealthCheck, _checkDatabase }

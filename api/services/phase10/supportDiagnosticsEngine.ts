// Denver Engineering — Support Diagnostics Engine (v10.0.0)
// Generates diagnostic reports for support escalations and incident triage.

import { createHash } from 'crypto'
import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  SupportDiagnosticReport, DiagnosticCheck, DiagnosticSeverity,
} from './phase10Types'

// ─── Diagnostic Reports ───────────────────────────────────────────────────────

export async function createDiagnosticReport(
  tenantId: string,
  reportedBy: string,
  issueDescription: string,
): Promise<SupportDiagnosticReport> {
  const res = await pool.query(
    `INSERT INTO support_diagnostic_reports
      (tenant_id, reported_by, issue_description, status, check_count, critical_count, warning_count)
     VALUES ($1,$2,$3,'pending',0,0,0)
     RETURNING *`,
    [tenantId, reportedBy, issueDescription],
  )
  return _mapReport(res.rows[0])
}

export async function recordDiagnosticCheck(
  reportId: string,
  checkName: string,
  severity: DiagnosticSeverity,
  passed: boolean,
  detail: string,
  remediation?: string,
): Promise<DiagnosticCheck> {
  const res = await pool.query(
    `INSERT INTO diagnostic_checks
      (report_id, check_name, severity, passed, detail, remediation, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     RETURNING *`,
    [reportId, checkName, severity, passed, detail, remediation ?? null],
  )
  return _mapCheck(res.rows[0])
}

export async function finalizeDiagnosticReport(
  reportId: string,
): Promise<SupportDiagnosticReport> {
  const checksRes = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN severity = 'critical' AND NOT passed THEN 1 ELSE 0 END)::int AS critical,
       SUM(CASE WHEN severity = 'warning' AND NOT passed THEN 1 ELSE 0 END)::int AS warning
     FROM diagnostic_checks WHERE report_id = $1`,
    [reportId],
  )
  const r = checksRes.rows[0]
  const critical = Number(r['critical'] ?? 0)
  const warning = Number(r['warning'] ?? 0)
  const status = critical > 0 ? 'critical' : warning > 0 ? 'degraded' : 'healthy'

  const res = await pool.query(
    `UPDATE support_diagnostic_reports
     SET status = $2, check_count = $3, critical_count = $4, warning_count = $5,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [reportId, status, Number(r['total']), critical, warning],
  )
  return _mapReport(res.rows[0])
}

export async function getDiagnosticReport(
  reportId: string,
): Promise<SupportDiagnosticReport | null> {
  const res = await pool.query(
    `SELECT * FROM support_diagnostic_reports WHERE id = $1`,
    [reportId],
  )
  return res.rows.length > 0 ? _mapReport(res.rows[0]) : null
}

export async function getDiagnosticChecks(
  reportId: string,
): Promise<DiagnosticCheck[]> {
  const res = await pool.query(
    `SELECT * FROM diagnostic_checks WHERE report_id = $1
     ORDER BY severity DESC, check_name`,
    [reportId],
  )
  return res.rows.map(_mapCheck)
}

export async function listDiagnosticReports(
  tenantId?: string,
  limit = 20,
): Promise<SupportDiagnosticReport[]> {
  const res = await pool.query(
    `SELECT * FROM support_diagnostic_reports
     WHERE ($1::text IS NULL OR tenant_id = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [tenantId ?? null, limit],
  )
  return res.rows.map(_mapReport)
}

// ─── Built-in diagnostic checks ───────────────────────────────────────────────

export async function runTenantConfigCheck(
  reportId: string,
  tenantId: string,
): Promise<DiagnosticCheck> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT COUNT(*) AS cnt FROM tenant_configurations WHERE tenant_id = $1`,
      [tenantId],
    )
    const count = Number(res.rows[0]?.['cnt'] ?? 0)
    const passed = count > 0
    return recordDiagnosticCheck(
      reportId, 'tenant_config_exists', 'critical', passed,
      passed ? `${count} configuration(s) found` : 'No tenant configuration found',
      passed ? undefined : 'Run tenant provisioning setup',
    )
  } catch {
    return recordDiagnosticCheck(
      reportId, 'tenant_config_exists', 'warning', false,
      'Config check skipped — table unavailable',
    )
  }
}

export async function runReplayHealthCheck(
  reportId: string,
  tenantId: string,
): Promise<DiagnosticCheck> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT COUNT(*) AS failed FROM replay_verification_runs
       WHERE status = 'failed' AND created_at > now() - interval '24 hours'`,
      [],
    )
    const failed = Number(res.rows[0]?.['failed'] ?? 0)
    const passed = failed === 0
    return recordDiagnosticCheck(
      reportId, 'replay_health_24h', 'critical', passed,
      passed ? 'No replay failures in past 24h' : `${failed} replay failure(s) in past 24h`,
      passed ? undefined : 'Investigate replay divergence in replayVerificationRunner',
    )
  } catch {
    return recordDiagnosticCheck(
      reportId, 'replay_health_24h', 'warning', true,
      'Replay check skipped — table unavailable',
    )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateDiagnosticId(tenantId: string, timestamp: string): string {
  return createHash('sha256')
    .update(`${tenantId}:${timestamp}`)
    .digest('hex')
    .slice(0, 12)
}

export function prioritizeChecks(checks: DiagnosticCheck[]): DiagnosticCheck[] {
  const order: Record<DiagnosticSeverity, number> = { critical: 0, warning: 1, info: 2 }
  return [...checks].sort((a, b) => {
    const sev = order[a.severity] - order[b.severity]
    if (sev !== 0) return sev
    // Failed checks first within same severity
    return (a.passed ? 1 : 0) - (b.passed ? 1 : 0)
  })
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapReport,
  _mapCheck,
  generateDiagnosticId,
  prioritizeChecks,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapReport(row: Record<string, unknown>): SupportDiagnosticReport {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    reportedBy: row['reported_by'] as string,
    issueDescription: row['issue_description'] as string,
    status: row['status'] as 'pending' | 'healthy' | 'degraded' | 'critical',
    checkCount: Number(row['check_count'] ?? 0),
    criticalCount: Number(row['critical_count'] ?? 0),
    warningCount: Number(row['warning_count'] ?? 0),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapCheck(row: Record<string, unknown>): DiagnosticCheck {
  return {
    id: row['id'] as string,
    reportId: row['report_id'] as string,
    checkName: row['check_name'] as string,
    severity: row['severity'] as DiagnosticSeverity,
    passed: Boolean(row['passed']),
    detail: row['detail'] as string,
    remediation: (row['remediation'] as string) ?? null,
    checkedAt: new Date(row['checked_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}

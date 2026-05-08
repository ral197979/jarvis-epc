// Denver Engineering — AI Explainability Validator (v10.0.0)
// Validates that AI decisions are auditable, documented, and explainable.

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  ExplainabilityReport, ExplainabilityCheck, ExplainabilityStatus,
  AI_EXPLAINABILITY_REQUIRED_CHECKS,
} from './phase10Types'

// ─── Report lifecycle ─────────────────────────────────────────────────────────

export async function createExplainabilityReport(
  tenantId: string,
  modelId: string,
  decisionContext: string,
): Promise<ExplainabilityReport> {
  const res = await pool.query(
    `INSERT INTO explainability_reports
      (tenant_id, model_id, decision_context, status,
       checks_required, checks_passed, checks_failed)
     VALUES ($1,$2,$3,'pending',$4,0,0)
     RETURNING *`,
    [tenantId, modelId, decisionContext, AI_EXPLAINABILITY_REQUIRED_CHECKS],
  )
  return _mapReport(res.rows[0])
}

export async function recordExplainabilityCheck(
  reportId: string,
  checkName: string,
  passed: boolean,
  rationale: string,
  evidence?: string,
): Promise<ExplainabilityCheck> {
  const res = await pool.query(
    `INSERT INTO explainability_checks
      (report_id, check_name, passed, rationale, evidence, checked_at)
     VALUES ($1,$2,$3,$4,$5,now())
     RETURNING *`,
    [reportId, checkName, passed, rationale, evidence ?? null],
  )
  return _mapCheck(res.rows[0])
}

export async function finalizeExplainabilityReport(
  reportId: string,
): Promise<ExplainabilityReport> {
  const countsRes = await pool.query(
    `SELECT
       SUM(CASE WHEN passed THEN 1 ELSE 0 END)::int AS passed_cnt,
       SUM(CASE WHEN NOT passed THEN 1 ELSE 0 END)::int AS failed_cnt
     FROM explainability_checks WHERE report_id = $1`,
    [reportId],
  )
  const passed = Number(countsRes.rows[0]?.['passed_cnt'] ?? 0)
  const failed = Number(countsRes.rows[0]?.['failed_cnt'] ?? 0)
  const status: ExplainabilityStatus =
    passed >= AI_EXPLAINABILITY_REQUIRED_CHECKS ? 'compliant'
    : failed > 0 ? 'non_compliant'
    : 'partial'

  const res = await pool.query(
    `UPDATE explainability_reports
     SET status = $2, checks_passed = $3, checks_failed = $4,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [reportId, status, passed, failed],
  )
  return _mapReport(res.rows[0])
}

export async function getExplainabilityReport(
  reportId: string,
): Promise<ExplainabilityReport | null> {
  const res = await pool.query(
    `SELECT * FROM explainability_reports WHERE id = $1`,
    [reportId],
  )
  return res.rows.length > 0 ? _mapReport(res.rows[0]) : null
}

export async function getExplainabilityChecks(
  reportId: string,
): Promise<ExplainabilityCheck[]> {
  const res = await pool.query(
    `SELECT * FROM explainability_checks WHERE report_id = $1
     ORDER BY check_name`,
    [reportId],
  )
  return res.rows.map(_mapCheck)
}

export async function listExplainabilityReports(
  tenantId?: string,
  modelId?: string,
  limit = 20,
): Promise<ExplainabilityReport[]> {
  const res = await pool.query(
    `SELECT * FROM explainability_reports
     WHERE ($1::text IS NULL OR tenant_id = $1)
       AND ($2::text IS NULL OR model_id = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [tenantId ?? null, modelId ?? null, limit],
  )
  return res.rows.map(_mapReport)
}

// ─── Built-in checks ──────────────────────────────────────────────────────────

export async function runModelCardCheck(
  reportId: string,
  modelId: string,
): Promise<ExplainabilityCheck> {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM model_cards WHERE model_id = $1`,
    [modelId],
  )
  const exists = Number(res.rows[0]?.['cnt'] ?? 0) > 0
  return recordExplainabilityCheck(
    reportId, 'model_card_present', exists,
    exists ? 'Model card found and documented' : 'No model card registered for this model',
    exists ? `model_cards entry for ${modelId}` : undefined,
  )
}

export async function runDecisionTraceCheck(
  reportId: string,
  tenantId: string,
  modelId: string,
): Promise<ExplainabilityCheck> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT COUNT(*) AS cnt FROM ai_decision_traces
       WHERE model_id = $1 AND created_at > now() - interval '30 days'`,
      [modelId],
    )
    const count = Number(res.rows[0]?.['cnt'] ?? 0)
    const passed = count > 0
    return recordExplainabilityCheck(
      reportId, 'decision_trace_available', passed,
      passed ? `${count} decision trace(s) found in past 30 days` : 'No decision traces recorded',
      passed ? `${count} traces` : undefined,
    )
  } catch {
    return recordExplainabilityCheck(
      reportId, 'decision_trace_available', false,
      'Decision trace check skipped — table unavailable',
    )
  }
}

export async function runBiasAuditCheck(
  reportId: string,
  modelId: string,
): Promise<ExplainabilityCheck> {
  try {
    const res = await pool.query(
      `SELECT completed_at FROM bias_audits WHERE model_id = $1
       ORDER BY completed_at DESC LIMIT 1`,
      [modelId],
    )
    const hasAudit = res.rows.length > 0
    const recentAudit = hasAudit
      && new Date(res.rows[0]['completed_at'] as string) > new Date(Date.now() - 90 * 86400000)
    return recordExplainabilityCheck(
      reportId, 'bias_audit_current', recentAudit,
      recentAudit ? 'Bias audit completed within past 90 days'
        : hasAudit ? 'Bias audit exists but is older than 90 days'
        : 'No bias audit found',
    )
  } catch {
    return recordExplainabilityCheck(
      reportId, 'bias_audit_current', false,
      'Bias audit check skipped — table unavailable',
    )
  }
}

export async function runHumanOversightCheck(
  reportId: string,
  modelId: string,
): Promise<ExplainabilityCheck> {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM human_review_policies
     WHERE model_id = $1 AND active = TRUE`,
    [modelId],
  )
  const count = Number(res.rows[0]?.['cnt'] ?? 0)
  const passed = count > 0
  return recordExplainabilityCheck(
    reportId, 'human_oversight_policy', passed,
    passed ? `${count} active human oversight policy(ies)` : 'No active human oversight policy',
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeExplainabilityScore(
  checksPassed: number,
  checksRequired: number,
): number {
  if (checksRequired === 0) return 100
  return Math.round((checksPassed / checksRequired) * 100)
}

export function isFullyCompliant(report: ExplainabilityReport): boolean {
  return (
    report.status === 'compliant' &&
    report.checksPassed >= AI_EXPLAINABILITY_REQUIRED_CHECKS &&
    report.checksFailed === 0
  )
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapReport,
  _mapCheck,
  computeExplainabilityScore,
  isFullyCompliant,
  AI_EXPLAINABILITY_REQUIRED_CHECKS,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapReport(row: Record<string, unknown>): ExplainabilityReport {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    modelId: row['model_id'] as string,
    decisionContext: row['decision_context'] as string,
    status: row['status'] as ExplainabilityStatus,
    checksRequired: Number(row['checks_required'] ?? AI_EXPLAINABILITY_REQUIRED_CHECKS),
    checksPassed: Number(row['checks_passed'] ?? 0),
    checksFailed: Number(row['checks_failed'] ?? 0),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapCheck(row: Record<string, unknown>): ExplainabilityCheck {
  return {
    id: row['id'] as string,
    reportId: row['report_id'] as string,
    checkName: row['check_name'] as string,
    passed: Boolean(row['passed']),
    rationale: row['rationale'] as string,
    evidence: (row['evidence'] as string) ?? null,
    checkedAt: new Date(row['checked_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}

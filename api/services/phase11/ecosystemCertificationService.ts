// Denver Engineering — Ecosystem Certification Service (Phase 11)
// Manage partner certification tests and track certification scores

import { pool } from '../../db/pool'
import { EcosystemCertification } from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapCertification(row: Record<string, unknown>): EcosystemCertification {
  return {
    id: row.id as string,
    partnerId: row.partner_id as string,
    certType: row.cert_type as string,
    status: row.status as 'pending' | 'passed' | 'failed' | 'expired',
    score: Number(row.score),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Certification ─────────────────────────────────────────────────────

export async function createCertification(
  partnerId: string,
  certType: string
): Promise<EcosystemCertification> {
  const result = await pool.query(
    `INSERT INTO ecosystem_certifications
       (partner_id, cert_type, status, score, completed_at, expires_at, created_at)
     VALUES ($1, $2, 'pending', 0, NULL, NULL, NOW())
     RETURNING *`,
    [partnerId, certType]
  )
  return _mapCertification(result.rows[0])
}

// ─── Complete Certification ───────────────────────────────────────────────────

export async function completeCertification(
  certId: string,
  score: number,
  passed: boolean
): Promise<EcosystemCertification> {
  const status = passed ? 'passed' : 'failed'
  // Certifications expire in 1 year if passed
  const result = await pool.query(
    `UPDATE ecosystem_certifications
     SET status = $1, score = $2, completed_at = NOW(),
         expires_at = CASE WHEN $3 THEN NOW() + INTERVAL '1 year' ELSE NULL END
     WHERE id = $4
     RETURNING *`,
    [status, score, passed, certId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Certification ${certId} not found`)
  }
  return _mapCertification(result.rows[0])
}

// ─── Expire Certification ─────────────────────────────────────────────────────

export async function expireCertification(certId: string): Promise<EcosystemCertification> {
  const result = await pool.query(
    `UPDATE ecosystem_certifications SET status = 'expired' WHERE id = $1 RETURNING *`,
    [certId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Certification ${certId} not found`)
  }
  return _mapCertification(result.rows[0])
}

// ─── Get Certification ────────────────────────────────────────────────────────

export async function getCertification(certId: string): Promise<EcosystemCertification | null> {
  const result = await pool.query(
    `SELECT * FROM ecosystem_certifications WHERE id = $1`,
    [certId]
  )
  return result.rows.length > 0 ? _mapCertification(result.rows[0]) : null
}

// ─── Get Partner Certifications ───────────────────────────────────────────────

export async function getPartnerCertifications(
  partnerId: string
): Promise<EcosystemCertification[]> {
  const result = await pool.query(
    `SELECT * FROM ecosystem_certifications
     WHERE partner_id = $1
     ORDER BY created_at DESC`,
    [partnerId]
  )
  return result.rows.map(_mapCertification)
}

// ─── Get Active Certifications ────────────────────────────────────────────────

export async function getActiveCertifications(
  partnerId: string
): Promise<EcosystemCertification[]> {
  const result = await pool.query(
    `SELECT * FROM ecosystem_certifications
     WHERE partner_id = $1
       AND status = 'passed'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY cert_type ASC`,
    [partnerId]
  )
  return result.rows.map(_mapCertification)
}

// ─── Check Available Cert Types ───────────────────────────────────────────────

export const CERTIFICATION_TYPES = [
  'technical_integration',
  'security_review',
  'performance_validation',
  'api_compliance',
  'data_handling',
] as const

export type CertificationType = typeof CERTIFICATION_TYPES[number]

// ─── Compute Certification Score ──────────────────────────────────────────────

export function computeCertificationScore(
  correctAnswers: number,
  totalQuestions: number
): number {
  if (totalQuestions === 0) return 0
  return Math.round((correctAnswers / totalQuestions) * 100)
}

// ─── Is Certification Passing ─────────────────────────────────────────────────

export function isCertificationPassing(score: number, passingScore: number = 80): boolean {
  return score >= passingScore
}

// ─── Has All Required Certifications ─────────────────────────────────────────

export function hasAllRequiredCertifications(
  activeCerts: EcosystemCertification[],
  requiredTypes: string[]
): boolean {
  const activeCertTypes = new Set(activeCerts.map(c => c.certType))
  return requiredTypes.every(t => activeCertTypes.has(t))
}

// ─── Get Expiring Certifications ──────────────────────────────────────────────

export async function getExpiringCertifications(daysAhead: number = 30): Promise<EcosystemCertification[]> {
  const result = await pool.query(
    `SELECT * FROM ecosystem_certifications
     WHERE status = 'passed'
       AND expires_at IS NOT NULL
       AND expires_at < NOW() + INTERVAL '1 day' * $1
       AND expires_at > NOW()
     ORDER BY expires_at ASC`,
    [daysAhead]
  )
  return result.rows.map(_mapCertification)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapCertification,
  computeCertificationScore,
  isCertificationPassing,
  hasAllRequiredCertifications,
}

// Denver Engineering — Partner Reputation Service (Phase 12)
// Tracks and computes partner reputation scores over time

import { pool } from '../../db/pool'
import { PartnerReputation } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapPartnerReputation(row: Record<string, unknown>): PartnerReputation {
  return {
    id: row.id as string,
    partnerId: row.partner_id as string,
    trustLevel: row.trust_level as PartnerReputation['trustLevel'],
    errorRate: Number(row.error_rate),
    securityIncidents: Number(row.security_incidents),
    uptimePct: Number(row.uptime_pct),
    reputationScore: Number(row.reputation_score),
    lastUpdated: new Date(row.last_updated as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computePartnerReputationScore(
  errorRate: number,
  securityIncidents: number,
  uptimePct: number,
): number {
  const errorPenalty = Math.min(errorRate * 100 * 3, 40)
  const securityPenalty = Math.min(securityIncidents * 20, 50)
  const uptimeScore = uptimePct * 100 * 0.6
  return Math.max(0, Math.round(uptimeScore - errorPenalty - securityPenalty))
}

export function classifyTrustLevel(
  reputationScore: number,
  securityIncidents: number,
): PartnerReputation['trustLevel'] {
  if (securityIncidents >= 3 || reputationScore < 30) return 'untrusted'
  if (securityIncidents >= 1 || reputationScore < 60) return 'provisional'
  if (reputationScore >= 85) return 'verified'
  return 'trusted'
}

export function isPartnerReliable(rep: PartnerReputation): boolean {
  return rep.trustLevel !== 'untrusted' && rep.errorRate < 0.05 && rep.uptimePct >= 0.99
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function updatePartnerReputation(
  partnerId: string,
  errorRate: number,
  securityIncidents: number,
  uptimePct: number,
): Promise<PartnerReputation> {
  const reputationScore = computePartnerReputationScore(errorRate, securityIncidents, uptimePct)
  const trustLevel = classifyTrustLevel(reputationScore, securityIncidents)

  const result = await pool.query(
    `INSERT INTO p12_partner_reputation
       (partner_id, trust_level, error_rate, security_incidents, uptime_pct, reputation_score, last_updated)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (partner_id) DO UPDATE
       SET trust_level=$2, error_rate=$3, security_incidents=$4,
           uptime_pct=$5, reputation_score=$6, last_updated=NOW()
     RETURNING *`,
    [partnerId, trustLevel, errorRate, securityIncidents, uptimePct, reputationScore],
  )
  return _mapPartnerReputation(result.rows[0])
}

export async function getPartnerReputation(partnerId: string): Promise<PartnerReputation | null> {
  const result = await pool.query(
    `SELECT * FROM p12_partner_reputation WHERE partner_id = $1`,
    [partnerId],
  )
  return result.rows[0] ? _mapPartnerReputation(result.rows[0]) : null
}

export async function getUnreliablePartners(): Promise<PartnerReputation[]> {
  const result = await pool.query(
    `SELECT * FROM p12_partner_reputation
     WHERE trust_level = 'untrusted' OR error_rate >= 0.05
     ORDER BY reputation_score ASC`,
  )
  return result.rows.map(_mapPartnerReputation)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computePartnerReputationScore,
  classifyTrustLevel,
  isPartnerReliable,
  _mapPartnerReputation,
}

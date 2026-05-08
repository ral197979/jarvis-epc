// Denver Engineering — Partner Onboarding Service (Phase 11)
// Manage partner applications, certifications, and lifecycle

import { pool } from '../../db/pool'
import {
  Partner,
  PartnerType,
  PartnerStatus,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapPartner(row: Record<string, unknown>): Partner {
  return {
    id: row.id as string,
    name: row.name as string,
    partnerType: row.partner_type as PartnerType,
    status: row.status as PartnerStatus,
    contactEmail: row.contact_email as string,
    certificationLevel: row.certification_level as 'standard' | 'advanced' | 'premium' | null,
    certifiedAt: row.certified_at ? new Date(row.certified_at as string) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Partner Application ───────────────────────────────────────────────

export async function createPartnerApplication(
  name: string,
  partnerType: PartnerType,
  contactEmail: string
): Promise<Partner> {
  const result = await pool.query(
    `INSERT INTO partners
       (name, partner_type, status, contact_email,
        certification_level, certified_at, expires_at, created_at)
     VALUES ($1, $2, 'applied', $3, NULL, NULL, NULL, NOW())
     RETURNING *`,
    [name, partnerType, contactEmail]
  )
  return _mapPartner(result.rows[0])
}

// ─── Advance Partner Status ───────────────────────────────────────────────────

export async function advancePartnerStatus(
  partnerId: string,
  status: PartnerStatus,
  certificationLevel?: 'standard' | 'advanced' | 'premium'
): Promise<Partner> {
  const sets: string[] = ['status = $1']
  const params: unknown[] = [status, partnerId]
  let paramIdx = 3

  if (status === 'certified') {
    sets.push(`certified_at = NOW()`)
    // Certification expires in 1 year
    sets.push(`expires_at = NOW() + INTERVAL '1 year'`)
    if (certificationLevel) {
      sets.push(`certification_level = $${paramIdx++}`)
      params.splice(params.length - 1, 0, certificationLevel)
    }
  }

  const result = await pool.query(
    `UPDATE partners SET ${sets.join(', ')} WHERE id = $2 RETURNING *`,
    params
  )
  if (result.rows.length === 0) {
    throw new Error(`Partner ${partnerId} not found`)
  }
  return _mapPartner(result.rows[0])
}

// ─── Get Partner ─────────────────────────────────────────────────────────────

export async function getPartner(partnerId: string): Promise<Partner | null> {
  const result = await pool.query(
    `SELECT * FROM partners WHERE id = $1`,
    [partnerId]
  )
  return result.rows.length > 0 ? _mapPartner(result.rows[0]) : null
}

// ─── List Partners ────────────────────────────────────────────────────────────

export async function listPartners(
  status?: PartnerStatus,
  partnerType?: PartnerType
): Promise<Partner[]> {
  let query = `SELECT * FROM partners WHERE 1=1`
  const params: unknown[] = []
  let idx = 1

  if (status) {
    query += ` AND status = $${idx++}`
    params.push(status)
  }
  if (partnerType) {
    query += ` AND partner_type = $${idx++}`
    params.push(partnerType)
  }
  query += ` ORDER BY created_at DESC`

  const result = await pool.query(query, params)
  return result.rows.map(_mapPartner)
}

// ─── Suspend Partner ──────────────────────────────────────────────────────────

export async function suspendPartner(partnerId: string): Promise<Partner> {
  const result = await pool.query(
    `UPDATE partners SET status = 'suspended' WHERE id = $1 RETURNING *`,
    [partnerId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Partner ${partnerId} not found`)
  }
  return _mapPartner(result.rows[0])
}

// ─── Check Certification Expiry ───────────────────────────────────────────────

export function isCertificationExpired(partner: Partner): boolean {
  if (partner.expiresAt === null) return false
  return partner.expiresAt < new Date()
}

// ─── Check Partner is Active ──────────────────────────────────────────────────

export function isPartnerActive(partner: Partner): boolean {
  return partner.status === 'certified' && !isCertificationExpired(partner)
}

// ─── Get Expiring Certifications ──────────────────────────────────────────────

export async function getExpiringCertifications(daysAhead: number = 30): Promise<Partner[]> {
  const result = await pool.query(
    `SELECT * FROM partners
     WHERE status = 'certified'
       AND expires_at IS NOT NULL
       AND expires_at < NOW() + INTERVAL '1 day' * $1
       AND expires_at > NOW()
     ORDER BY expires_at ASC`,
    [daysAhead]
  )
  return result.rows.map(_mapPartner)
}

// ─── Count Partners by Type ───────────────────────────────────────────────────

export async function countPartnersByType(): Promise<Record<PartnerType, number>> {
  const result = await pool.query(
    `SELECT partner_type, COUNT(*) as count FROM partners
     WHERE status = 'certified'
     GROUP BY partner_type`
  )

  const counts: Partial<Record<PartnerType, number>> = {}
  for (const row of result.rows as Record<string, unknown>[]) {
    counts[row.partner_type as PartnerType] = Number(row.count)
  }
  return counts as Record<PartnerType, number>
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapPartner,
  isCertificationExpired,
  isPartnerActive,
}

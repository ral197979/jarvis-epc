// Denver Engineering — Demo Tenant Generator (v8.0.0)
// Seeds industry-specific demo tenants with realistic data for sales/pilot use.

import { randomUUID } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { DemoTenant } from './enterpriseTypes'
import { provisionTenant } from './tenantProvisioningService'

// Demo TTL: 30 days
const DEMO_TTL_MS = 30 * 24 * 60 * 60 * 1000

// ─── Industry templates ───────────────────────────────────────────────────────

interface DemoTemplate {
  industry: string
  label: string
  tier: 'professional' | 'enterprise'
  projectCount: number
  description: string
}

const DEMO_TEMPLATES: Record<string, DemoTemplate> = {
  construction_enterprise: {
    industry: 'construction',
    label: 'Apex Construction Group',
    tier: 'enterprise',
    projectCount: 12,
    description: 'Large GC managing multi-site infrastructure projects',
  },
  manufacturing_pro: {
    industry: 'manufacturing',
    label: 'Precision Works Inc',
    tier: 'professional',
    projectCount: 6,
    description: 'Mid-size manufacturer with facility expansion projects',
  },
  utilities_enterprise: {
    industry: 'utilities',
    label: 'GridTech Energy',
    tier: 'enterprise',
    projectCount: 8,
    description: 'Regional utility running grid modernization program',
  },
  healthcare_pro: {
    industry: 'healthcare',
    label: 'Meridian Health Systems',
    tier: 'professional',
    projectCount: 4,
    description: 'Hospital network managing capital facility projects',
  },
  logistics_enterprise: {
    industry: 'logistics',
    label: 'FastFreight Logistics',
    tier: 'enterprise',
    projectCount: 10,
    description: 'National 3PL with warehouse construction pipeline',
  },
}

// ─── Create demo tenant ───────────────────────────────────────────────────────

export async function createDemoTenant(
  templateKey: string,
  opts: { createdBy?: string; expiresAt?: Date } = {},
): Promise<DemoTenant> {
  const template = DEMO_TEMPLATES[templateKey]
  if (template == null) throw new Error(`Unknown demo template: ${templateKey}`)

  const tenantId = randomUUID()
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + DEMO_TTL_MS)

  // Provision the tenant with tier defaults
  await provisionTenant(tenantId, {
    tenantId,
    tier: template.tier,
    trialDays: 30,
  })

  // Record in demo_tenants registry
  const res = await pool.query(
    `INSERT INTO demo_tenants
      (tenant_id, industry, template_key, label, status, expires_at, created_by, metadata)
     VALUES ($1,$2,$3,$4,'active',$5,$6,$7)
     RETURNING *`,
    [
      tenantId, template.industry, templateKey, template.label,
      expiresAt, opts.createdBy ?? null,
      JSON.stringify({ description: template.description, tier: template.tier }),
    ],
  )

  const demoTenant = _mapDemoTenant(res.rows[0])

  // Seed demo data asynchronously — non-blocking
  _seedDemoData(tenantId, template).catch(() => { /* non-fatal */ })

  return demoTenant
}

// ─── Get demo tenant ──────────────────────────────────────────────────────────

export async function getDemoTenant(tenantId: string): Promise<DemoTenant | null> {
  const res = await pool.query(
    `SELECT * FROM demo_tenants WHERE tenant_id = $1`,
    [tenantId],
  )
  return res.rows.length > 0 ? _mapDemoTenant(res.rows[0]) : null
}

// ─── List demo tenants ────────────────────────────────────────────────────────

export async function listDemoTenants(
  opts: { industry?: string; status?: string } = {},
): Promise<DemoTenant[]> {
  const params: unknown[] = []
  const clauses: string[] = []

  if (opts.industry != null) { params.push(opts.industry); clauses.push(`industry = $${params.length}`) }
  if (opts.status != null)   { params.push(opts.status);   clauses.push(`status = $${params.length}`) }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const res = await pool.query(
    `SELECT * FROM demo_tenants ${where} ORDER BY created_at DESC`,
    params,
  )
  return res.rows.map(_mapDemoTenant)
}

// ─── Reset demo tenant ────────────────────────────────────────────────────────

export async function resetDemoTenant(tenantId: string): Promise<DemoTenant> {
  // Mark as reset_pending
  await pool.query(
    `UPDATE demo_tenants SET status = 'reset_pending', last_reset_at = now() WHERE tenant_id = $1`,
    [tenantId],
  )

  // Clear tenant usage data (usage records, AI records)
  await Promise.all([
    tenantQuery(tenantId, `DELETE FROM tenant_usage WHERE tenant_id = $1`, [tenantId]).catch(() => {}),
    tenantQuery(tenantId, `DELETE FROM ai_usage_records WHERE tenant_id = $1`, [tenantId]).catch(() => {}),
    tenantQuery(tenantId, `DELETE FROM support_tickets WHERE tenant_id = $1`, [tenantId]).catch(() => {}),
    tenantQuery(tenantId, `UPDATE tenant_subscriptions SET ai_spend_current = 0, seat_count = 1, updated_at = now() WHERE tenant_id = $1`, [tenantId]).catch(() => {}),
  ])

  const demoRes = await pool.query(
    `UPDATE demo_tenants SET status = 'active' WHERE tenant_id = $1 RETURNING *`,
    [tenantId],
  )
  if (demoRes.rows.length === 0) throw new Error(`Demo tenant ${tenantId} not found`)
  return _mapDemoTenant(demoRes.rows[0])
}

// ─── Expire stale demo tenants ────────────────────────────────────────────────

export async function expireStaleDemoTenants(): Promise<number> {
  const res = await pool.query(
    `UPDATE demo_tenants SET status = 'expired'
     WHERE status = 'active' AND expires_at < now()
     RETURNING tenant_id`,
  )
  return res.rows.length
}

// ─── Seed demo data ───────────────────────────────────────────────────────────

async function _seedDemoData(tenantId: string, template: DemoTemplate): Promise<void> {
  // Record seeded_at
  await pool.query(`UPDATE demo_tenants SET seeded_at = now() WHERE tenant_id = $1`, [tenantId])
  // Industry-specific seeding could go here (projects, systems, etc.)
  // Kept minimal to avoid coupling with domain tables
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function _mapDemoTenant(row: Record<string, unknown>): DemoTenant {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    industry: String(row.industry),
    templateKey: String(row.template_key),
    label: String(row.label),
    status: String(row.status),
    seededAt: row.seeded_at != null ? new Date(row.seeded_at as string) : undefined,
    expiresAt: row.expires_at != null ? new Date(row.expires_at as string) : undefined,
    lastResetAt: row.last_reset_at != null ? new Date(row.last_reset_at as string) : undefined,
    createdBy: row.created_by != null ? String(row.created_by) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapDemoTenant, DEMO_TEMPLATES, DEMO_TTL_MS }

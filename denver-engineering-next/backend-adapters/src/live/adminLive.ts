/**
 * Live wiring for the Administration module — users + feature gates (tenant-scoped).
 *
 * Endpoints:
 *   GET /api/v1/team/members        → { members: TeamMember[] }
 *   GET /api/v1/enterprise/features → TenantFeatureFlag[]   (unwrapped array)
 *
 * NOTE — the team member row has no "last active" column, so `lastActive` is
 * derived from `updatedAt`. Feature `label`/`rollout` come from the flag's
 * `config` JSON when present, else a humanized key / enabled→100%/Off default.
 */
import { api } from '../http'
import type { AdminUser, FeatureGate } from '../types'

const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'
const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—')
const humanize = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// ── Users ────────────────────────────────────────────────────────────────────
export interface RawTeamMember {
  id: string
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  email: string | null
  role: string | null
  status: string | null
  updatedAt?: string | null
}

export function mapAdminUser(r: RawTeamMember): AdminUser {
  const name = r.fullName ?? `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()
  return {
    id: r.id,
    name: name || '—',
    email: r.email ?? '—',
    role: r.role ?? '—',
    status: cap(r.status),
    lastActive: dateOnly(r.updatedAt),
  }
}

export async function fetchAdminUsersLive(): Promise<AdminUser[]> {
  const res = await api<{ members: RawTeamMember[] }>('/team/members')
  return (res.members ?? []).map(mapAdminUser)
}

// ── Feature gates ────────────────────────────────────────────────────────────
export interface RawFeatureFlag {
  featureKey: string
  enabled: boolean
  config?: { label?: string; rollout?: string } | null
}

export function mapFeatureGate(r: RawFeatureFlag): FeatureGate {
  const cfg = r.config ?? {}
  return {
    key: r.featureKey,
    label: typeof cfg.label === 'string' ? cfg.label : humanize(r.featureKey),
    enabled: r.enabled,
    rollout: typeof cfg.rollout === 'string' ? cfg.rollout : r.enabled ? '100%' : 'Off',
  }
}

export async function fetchFeatureGatesLive(): Promise<FeatureGate[]> {
  const res = await api<RawFeatureFlag[]>('/enterprise/features')
  return (res ?? []).map(mapFeatureGate)
}

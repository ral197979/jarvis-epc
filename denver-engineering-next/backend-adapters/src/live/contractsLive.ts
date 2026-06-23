/**
 * Live wiring for the Contracts module — subcontracts + change orders.
 *
 * Both endpoints are PROJECT-SCOPED; the active project id is threaded from the
 * UI store into the hooks (see hooks.ts / ContractsPage). Mapping absorbs the API
 * shape so the screen consumes the same UI types in mock or live mode.
 *
 * Endpoints (api/routes/{subcontracts,changeOrders}.ts):
 *   GET /api/v1/projects/:projectId/subcontracts   → { subcontracts: Subcontract[] }
 *   GET /api/v1/projects/:projectId/change-orders   → { items: ChangeOrder[], total }
 *
 * NOTE — the subcontracts table is the live source of contracts; the EPC *prime*
 * contract isn't in this table, so `type` is reported as "Subcontract".
 */
import { api } from '../http'
import type { Contract, ChangeOrder } from '../types'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'
const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—')

function formatMoney(amount: number): string {
  if (!amount) return '$0'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

/** Signed money for change-order cost impact (e.g. +$4.2M / -$0.6M). */
function signedMoney(amount: number): string {
  if (!amount) return '$0'
  return `${amount < 0 ? '-' : '+'}${formatMoney(Math.abs(amount))}`
}

// ── Subcontracts → Contract ──────────────────────────────────────────────────
export interface RawSubcontract {
  id: string
  projectId: string
  scNumber: number
  title: string
  vendorName?: string | null
  status: string | null
  contractValue: number | string | null
  executedAt: string | null
}

export function mapContract(r: RawSubcontract): Contract {
  return {
    id: `SC-${r.scNumber}`,
    title: r.title,
    counterparty: r.vendorName ?? '—',
    type: 'Subcontract', // prime contract isn't in this table
    value: formatMoney(num(r.contractValue)),
    status: cap(r.status),
    executed: dateOnly(r.executedAt),
  }
}

export async function fetchContractsLive(projectId: string): Promise<Contract[]> {
  if (!projectId) return []
  const res = await api<{ subcontracts: RawSubcontract[] }>(`/projects/${projectId}/subcontracts`)
  return (res.subcontracts ?? []).map(mapContract)
}

// ── Change Orders ────────────────────────────────────────────────────────────
export interface RawChangeOrder {
  id: string
  projectId?: string
  coNumber: number
  title: string
  type: string | null
  status: string | null
  costImpact: number | string | null
}

export function mapChangeOrder(r: RawChangeOrder): ChangeOrder {
  return {
    id: `CO-${r.coNumber}`,
    contractId: r.projectId ?? '—', // COs link to a project, not a specific contract
    description: r.title,
    value: signedMoney(num(r.costImpact)),
    status: cap(r.status),
  }
}

export async function fetchChangeOrdersLive(projectId: string): Promise<ChangeOrder[]> {
  if (!projectId) return []
  const res = await api<{ items: RawChangeOrder[]; total: number }>(`/projects/${projectId}/change-orders`)
  return (res.items ?? []).map(mapChangeOrder)
}

/**
 * Live wiring for the Procurement module — Purchase Orders + Vendors.
 *
 * Tenant-wide endpoints (`{ data, meta }`). Mapping absorbs the API shape so the
 * Procurement screen consumes the same UI types in mock or live mode.
 *
 * NOTE — `longLead` stays on mock: there is no dedicated long-lead endpoint; in a
 * real wiring it would be `GET /purchase-orders?expediting=long_lead` plus an
 * expediting milestone source. See docs/ADAPTER_STRATEGY.md.
 */
import { api } from '../http'
import type { PurchaseOrder, Vendor } from '../types'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const cap = (s: string | null | undefined): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—'

function formatMoney(amount: number, currency: string): string {
  if (!amount) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
      trailingZeroDisplay: 'stripIfInteger',
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

// ── Purchase Orders ──────────────────────────────────────────────────────────
export interface RawPurchaseOrder {
  id: string
  po_number: string | null
  title: string | null
  status: string | null
  currency: string | null
  total_amount: string | number | null
  required_date: string | null
  vendor_name: string | null
  metadata: Record<string, unknown> | null
}

/** Expediting isn't a column; derive from PO status (documented heuristic). */
function deriveExpediting(status: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'delayed':
    case 'late':
      return 'Delayed'
    case 'shipped':
    case 'dispatched':
      return 'Dispatched'
    case 'pending':
    case 'in_fabrication':
      return 'In Fab'
    case 'approved':
    case 'issued':
      return 'On Track'
    default:
      return '—'
  }
}

export function mapPurchaseOrder(r: RawPurchaseOrder): PurchaseOrder {
  return {
    id: r.po_number ?? r.id,
    vendor: r.vendor_name ?? '—',
    description: r.title ?? '—',
    value: formatMoney(num(r.total_amount), r.currency ?? 'USD'),
    status: cap(r.status),
    expediting: deriveExpediting(r.status),
  }
}

export async function fetchPurchaseOrdersLive(): Promise<PurchaseOrder[]> {
  const res = await api<{ data: RawPurchaseOrder[] }>('/purchase-orders?limit=100')
  return (res.data ?? []).map(mapPurchaseOrder)
}

// ── Vendors ──────────────────────────────────────────────────────────────────
export interface RawVendor {
  id: string
  code: string | null
  name: string
  rating: string | number | null
  metadata: Record<string, unknown> | null
}

export function mapVendor(r: RawVendor): Vendor {
  const meta = r.metadata ?? {}
  return {
    id: r.code ?? r.id,
    name: r.name,
    // Lead time isn't a column; read from metadata if present, else 0.
    avgLeadTimeDays: num(meta.avg_lead_time_days),
    // On-time % isn't a column; approximate from the 0–5 rating (documented).
    onTimePct: r.rating != null ? Math.round((num(r.rating) / 5) * 100) : 0,
  }
}

export async function fetchVendorsLive(): Promise<Vendor[]> {
  const res = await api<{ data: RawVendor[] }>('/vendors?limit=100')
  return (res.data ?? []).map(mapVendor)
}

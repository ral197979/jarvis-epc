/**
 * Denver Engineering — DirectoryView Component
 * Phase 11: Extraction of JarvisCore xn() — the Directory module.
 *
 * Two tabs: Vendors and Customers.
 * Each has:
 *   - Searchable list view with rating / spend / project count
 *   - Detail panel with KPI row, contact card, project badges, PO history (vendors)
 *     or contract/invoice history (customers)
 */

import React, { useState, useMemo, useEffect } from 'react'
import { type PolicyConfig } from '../modules/biz/dispatch'
import { StatusBadge } from './StatusBadge'
import { KpiCard }     from './KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Vendor {
  id: string; name?: string; type?: string; contact?: string; email?: string; phone?: string
  location?: string; specialty?: string; rating?: number; status?: string; notes?: string
  projects?: string[]; [key: string]: unknown
}
interface Customer {
  id: string; name?: string; short?: string; type?: string; contact?: string; email?: string
  phone?: string; address?: string; contract_vehicle?: string; billing?: string
  duns?: string; cage?: string; projects?: string[]; [key: string]: unknown
}
interface PurchaseOrder {
  id: string; amount?: number; status?: string; vendor?: string; project?: string
  subject?: string
  /** The real foreign key, when the row came from the API. Names are not unique. */
  vendorId?: string
  [key: string]: unknown
}
interface Contract {
  id: string; project?: string; value?: number; status?: string; client?: string
  type?: string; [key: string]: unknown
}
interface Invoice {
  id: string; project?: string; amount?: number; status?: string; [key: string]: unknown
}

type DirectoryTab = 'vendors' | 'customers'

export interface DirectoryViewProps {
  policy:        PolicyConfig
  vendors?:      Vendor[]
  customers?:    Customer[]
  purchaseOrders?: PurchaseOrder[]
  contracts?:    Contract[]
  invoices?:     Invoice[]
  onNavigate?:   (tab: string) => void
  onAudit?:      (entry: unknown) => void
  onToast?:      (msg: string, type: string) => void
}

// ─── Live data ────────────────────────────────────────────────────────────────
//
// P0-11. This screen was graded BROKEN_OR_DEAD for a wiring reason, not a
// backend one: it takes `vendors` / `purchaseOrders` / … as PROPS, and
// `ContentRouter`'s `sharedProps` passes only {policy, biz, onNavigate, onAudit,
// onToast}. Every prop defaulted to `[]`, so the routed screen rendered "No
// vendors in directory" forever — identically on a healthy backend and a dead
// one, which is the worst version of an empty state.
//
// Props still win when they are supplied, so an embedder (and the accessibility
// suite, which renders this component with vendor and customer rows) behaves
// exactly as before. When the vendor props are ABSENT the component now fetches
// its own data — the pattern the other live-wired views in this app already use.
//
// What is deliberately NOT fetched: customers, contracts and invoices. There is
// no `customers` table in any migration and no customer route on the API, and
// the `contracts` table has no reader. Inventing a client-side stand-in would
// make a dead domain look alive, so the Customers tab says plainly that the
// directory has no backend yet. See CUSTOMER_BACKEND.

/** There is no customers table, and no route reads `contracts`. Verified against migrations + api/routes. */
const CUSTOMER_BACKEND = false

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error'

interface VendorApiRow {
  id: string; name?: string; type?: string; status?: string
  primary_contact?: string; email?: string; phone?: string
  address?: string; country?: string; categories?: string[] | null
  rating?: string | number | null
  [key: string]: unknown
}
interface PoApiRow {
  id: string; po_number?: string; title?: string; status?: string
  total_amount?: string | number | null
  vendor_id?: string; vendor_name?: string
  project_code?: string; project_name?: string
  [key: string]: unknown
}

/** API row → the shape this component already renders. Nothing is invented. */
function toPurchaseOrder(row: PoApiRow): PurchaseOrder {
  return {
    id:       row.po_number ?? row.id,
    amount:   row.total_amount != null ? Number(row.total_amount) : undefined,
    status:   row.status,
    vendor:   row.vendor_name,
    vendorId: row.vendor_id,
    project:  row.project_code ?? row.project_name,
    subject:  row.title,
  }
}

function toVendor(row: VendorApiRow, pos: PurchaseOrder[]): Vendor {
  // `vendors` has no project column. The projects a vendor touches ARE the
  // projects of its purchase orders — derived, and the only honest source.
  const projects = [...new Set(
    pos.filter(p => p.vendorId === row.id).map(p => p.project).filter((x): x is string => Boolean(x)),
  )]
  return {
    id:        row.id,
    name:      row.name,
    type:      row.type,
    status:    row.status,
    contact:   row.primary_contact,
    email:     row.email,
    phone:     row.phone,
    location:  [row.address, row.country].filter(Boolean).join(', ') || undefined,
    specialty: Array.isArray(row.categories) && row.categories.length ? row.categories.join(', ') : undefined,
    rating:    row.rating != null ? Number(row.rating) : undefined,
    projects,
  }
}

interface DirectoryData { vendors: Vendor[]; pos: PurchaseOrder[]; state: LoadState; detail?: string }

/**
 * Fetch the vendor directory. `enabled` is false when the caller supplied the
 * data as props, so an embedder never triggers a network call.
 *
 * 403 is surfaced as its own state rather than as an error or an empty list:
 * `procurement.view` is a real capability that plenty of roles do not hold, and
 * "you may not see this" is a different fact from "there is nothing here".
 */
function useDirectoryData(enabled: boolean): DirectoryData {
  const [data, setData] = useState<DirectoryData>({ vendors: [], pos: [], state: enabled ? 'loading' : 'ready' })

  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      try {
        const [vRes, pRes] = await Promise.all([
          fetch('/api/v1/vendors?limit=100'),
          fetch('/api/v1/purchase-orders?limit=200'),
        ])
        if (!live) return
        if (vRes.status === 401 || vRes.status === 403) {
          setData({ vendors: [], pos: [], state: 'forbidden' }); return
        }
        if (!vRes.ok) {
          setData({ vendors: [], pos: [], state: 'error', detail: `Vendors request failed (${vRes.status}).` }); return
        }
        const vBody = await vRes.json() as { data?: VendorApiRow[] }
        // Purchase orders are supplementary — they add spend and project
        // context. A caller who may read vendors but not POs still gets the
        // directory, with the PO panel simply absent.
        const pBody = pRes.ok ? await pRes.json() as { data?: PoApiRow[] } : { data: [] }
        if (!live) return
        const pos = (pBody.data ?? []).map(toPurchaseOrder)
        setData({ vendors: (vBody.data ?? []).map(r => toVendor(r, pos)), pos, state: 'ready' })
      } catch (err) {
        if (!live) return
        setData({ vendors: [], pos: [], state: 'error', detail: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => { live = false }
  }, [enabled])

  return data
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

// ─── Star rating display ──────────────────────────────────────────────────────
function StarRating({ rating }: { rating?: number }) {
  const r = Math.round(rating ?? 0)
  return (
    <span title={`${r}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < r ? 'var(--jarvis-amb)' : 'var(--jarvis-bl)', fontSize: 12 }}>★</span>
      ))}
    </span>
  )
}

// ─── Vendor detail panel ──────────────────────────────────────────────────────
function VendorDetail({ vendor, pos, onBack }: {
  vendor: Vendor; pos: PurchaseOrder[]; onBack: () => void
}) {
  const projects   = vendor.projects ?? []
  // Match on the foreign key when the rows came from the API; fall back to the
  // name for prop-supplied rows, which carry no id.
  const vendorPOs  = pos.filter(p => (p.vendorId ? p.vendorId === vendor.id : p.vendor === vendor.name))
  const totalSpend = vendorPOs.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← Vendors</button>
        <StatusBadge status={vendor.status ?? 'approved'} />
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{vendor.name}</h2>
      <p className="jarvis-small" style={{ marginBottom: 4 }}>{vendor.type} · {vendor.location}</p>
      <div style={{ marginBottom: 16 }}><StarRating rating={vendor.rating} /></div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px,1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Rating"      value={`${vendor.rating ?? 0}/5`} />
        <KpiCard label="Total Spend" value={fmtCurrency(totalSpend)}   color="var(--jarvis-blue)" />
        <KpiCard label="POs"         value={vendorPOs.length} />
        <KpiCard label="Projects"    value={projects.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Contact card */}
        <div className="jarvis-card" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', marginBottom: 8 }}>Contact</h4>
          {[['Name', vendor.contact], ['Email', vendor.email], ['Phone', vendor.phone], ['Specialty', vendor.specialty]].map(([lbl, val], i) => (
            <div key={lbl as string} className="jarvis-row" style={{ borderBottom: i < 3 ? '1px solid var(--jarvis-bd)' : 'none' }}>
              <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{lbl}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--jarvis-tx)' }}>{val ?? '—'}</span>
            </div>
          ))}
        </div>

        {/* Notes & Projects */}
        <div className="jarvis-card" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', marginBottom: 8 }}>Notes & Projects</h4>
          <p style={{ fontSize: 12, color: 'var(--jarvis-tx)', lineHeight: 1.6, marginBottom: 8 }}>{vendor.notes ?? '—'}</p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {projects.map((p, i) => (
              <span key={i} style={{ fontSize: 9, fontWeight: 700, color: 'var(--jarvis-blue)',
                background: 'color-mix(in srgb, var(--jarvis-blue) 12%, transparent)',
                padding: '2px 6px', borderRadius: 4 }}>
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {vendorPOs.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>
            Purchase Orders ({vendorPOs.length} · {fmtCurrency(totalSpend)})
          </h4>
          <div className="jarvis-scroll-y" style={{ maxHeight: 240 }}>
            <table className="jarvis-table" aria-label="Vendor purchase orders">
              <thead><tr><th>PO</th><th>Project</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {vendorPOs.map(po => (
                  <tr key={po.id}>
                    <td style={{ fontWeight: 700, fontSize: 10, fontFamily: 'var(--jarvis-font-mono)' }}>{po.id}</td>
                    <td className="jarvis-small">{po.project ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>
                      {po.amount != null ? fmtCurrency(Number(po.amount)) : '—'}
                    </td>
                    <td><StatusBadge status={po.status ?? 'draft'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Customer detail panel ────────────────────────────────────────────────────
function CustomerDetail({ customer, contracts, invoices, onBack }: {
  customer: Customer; contracts: Contract[]; invoices: Invoice[]; onBack: () => void
}) {
  const projects = customer.projects ?? []
  const custContracts = contracts.filter(c => c.client === customer.name || c.client === customer.short || projects.includes(c.project ?? ''))
  const custInvoices  = invoices.filter(inv => custContracts.some(c => c.project === inv.project))

  const contractValue = custContracts.reduce((s, c) => s + Number(c.value ?? 0), 0)
  const invoiced      = custInvoices.reduce((s, i) => s + Number(i.amount ?? 0), 0)
  const collected     = custInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount ?? 0), 0)
  const ar            = invoiced - collected

  return (
    <div>
      <div className="jarvis-header" style={{ padding: '10px 0', marginBottom: 16 }}>
        <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>← Customers</button>
        {customer.short && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)',
            background: 'var(--jarvis-bl)', padding: '2px 6px', borderRadius: 4 }}>
            {customer.short}
          </span>
        )}
      </div>
      <h2 className="jarvis-heading" style={{ marginBottom: 4 }}>{customer.name}</h2>
      <p className="jarvis-small" style={{ marginBottom: 16 }}>{customer.type}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px,1fr))', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Contracts"       value={custContracts.length} />
        <KpiCard label="Contract Value"  value={fmtCurrency(contractValue)} color="var(--jarvis-blue)" />
        <KpiCard label="Invoiced"        value={fmtCurrency(invoiced)}      color="var(--jarvis-amb)" />
        <KpiCard label="Collected"       value={fmtCurrency(collected)}     color="var(--jarvis-grn)" />
        <KpiCard label="AR Outstanding"  value={fmtCurrency(ar)}            color={ar > 0 ? 'var(--jarvis-red)' : 'var(--jarvis-ts)'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="jarvis-card" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', marginBottom: 8 }}>Contact</h4>
          {[['Contact', customer.contact], ['Email', customer.email], ['Phone', customer.phone], ['Address', customer.address]].map(([lbl, val], i) => (
            <div key={lbl as string} className="jarvis-row" style={{ borderBottom: i < 3 ? '1px solid var(--jarvis-bd)' : 'none' }}>
              <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{lbl}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--jarvis-tx)', textAlign: 'right' as const }}>{val ?? '—'}</span>
            </div>
          ))}
        </div>
        <div className="jarvis-card" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 10, fontWeight: 700, color: 'var(--jarvis-ts)', textTransform: 'uppercase', marginBottom: 8 }}>Billing</h4>
          {[['Vehicle', customer.contract_vehicle], ['Billing To', customer.billing], ['DUNS', customer.duns], ['CAGE', customer.cage]].map(([lbl, val], i) => (
            <div key={lbl as string} className="jarvis-row" style={{ borderBottom: i < 3 ? '1px solid var(--jarvis-bd)' : 'none' }}>
              <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{lbl}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--jarvis-tx)' }}>{val ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {custContracts.length > 0 && (
        <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Contracts ({custContracts.length})</h4>
          <table className="jarvis-table" aria-label="Customer contracts">
            <thead><tr><th>ID</th><th>Project</th><th style={{ textAlign: 'right' }}>Value</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              {custContracts.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700, fontSize: 10, fontFamily: 'var(--jarvis-font-mono)' }}>{c.id}</td>
                  <td className="jarvis-small">{c.project ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>{fmtCurrency(Number(c.value ?? 0))}</td>
                  <td className="jarvis-small">{c.type ?? '—'}</td>
                  <td><StatusBadge status={c.status ?? 'active'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Vendors list ─────────────────────────────────────────────────────────────
function VendorsList({ vendors, pos, onSelect }: {
  vendors: Vendor[]; pos: PurchaseOrder[]; onSelect: (v: Vendor) => void
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return vendors.filter(v => !q || ((v.name ?? '') + (v.type ?? '') + (v.specialty ?? '') + (v.location ?? '')).toLowerCase().includes(q))
  }, [vendors, search])

  const spendByVendor = useMemo(() => {
    const map: Record<string, number> = {}
    pos.forEach(p => { const v = p.vendor ?? ''; map[v] = (map[v] ?? 0) + Number(p.amount ?? 0) })
    return map
  }, [pos])

  if (vendors.length === 0) {
    return <div className="jarvis-empty" role="status"><span className="jarvis-empty-icon">🏭</span><span>No vendors in directory</span></div>
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search vendors…"
          value={search} onChange={e => setSearch(e.target.value)} aria-label="Search vendors" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No vendors match</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Vendor directory">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Specialty</th><th>Location</th>
                <th>Rating</th><th style={{ textAlign: 'right' }}>Spend</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} onClick={() => onSelect(v)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)' }}>{v.name ?? '—'}</td>
                  <td className="jarvis-small">{v.type ?? '—'}</td>
                  <td className="jarvis-small">{v.specialty ?? '—'}</td>
                  <td className="jarvis-small">{v.location ?? '—'}</td>
                  <td><StarRating rating={v.rating} /></td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--jarvis-font-mono)', fontSize: 11 }}>
                    {spendByVendor[v.name ?? ''] ? fmtCurrency(spendByVendor[v.name ?? '']) : '—'}
                  </td>
                  <td><StatusBadge status={v.status ?? 'approved'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Customers list ───────────────────────────────────────────────────────────
function CustomersList({ customers, onSelect }: { customers: Customer[]; onSelect: (c: Customer) => void }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return customers.filter(c => !q || (c.name + (c.short ?? '') + (c.type ?? '')).toLowerCase().includes(q))
  }, [customers, search])

  if (customers.length === 0) {
    // Not "no customers" — there is nowhere for customers to live. No migration
    // creates a `customers` table and no route serves one, so an empty list
    // here would report a data state that cannot exist yet.
    return (
      <div className="jarvis-empty" role="status">
        <span className="jarvis-empty-icon">🏢</span>
        {CUSTOMER_BACKEND
          ? <span>No customers in directory</span>
          : <>
              <span>Customer directory not available</span>
              <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', marginTop: 4, maxWidth: 420, textAlign: 'center' }}>
                No customer records are stored yet — this domain has no backend.
                Vendors and purchase orders are live.
              </span>
            </>}
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input className="jarvis-input" type="search" placeholder="Search customers…"
          value={search} onChange={e => setSearch(e.target.value)} aria-label="Search customers" />
      </div>
      {filtered.length === 0 ? (
        <div className="jarvis-empty" role="status"><span>No customers match</span></div>
      ) : (
        <div className="jarvis-scroll-y jarvis-max-h-lg">
          <table className="jarvis-table" aria-label="Customer directory">
            <thead>
              <tr><th>Name</th><th>Short</th><th>Type</th><th>Contact</th><th>Projects</th></tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={() => onSelect(c)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700, color: 'var(--jarvis-ac)' }}>{c.name ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10 }}>{c.short ?? '—'}</td>
                  <td className="jarvis-small">{c.type ?? '—'}</td>
                  <td className="jarvis-small">{c.contact ?? '—'}</td>
                  <td>
                    <span style={{ fontSize: 9, fontFamily: 'var(--jarvis-font-mono)', color: 'var(--jarvis-ts)' }}>
                      {(c.projects ?? []).length} projects
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── DirectoryView (main export) ─────────────────────────────────────────────
export function DirectoryView({
  policy: _policy, vendors: vendorsProp, customers = [], purchaseOrders: posProp, contracts = [], invoices = [],
  onNavigate: _onNavigate,
}: DirectoryViewProps) {
  const [activeTab,      setActiveTab]      = useState<DirectoryTab>('vendors')
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  // Undefined means "nobody gave me data", which is the routed case; an empty
  // ARRAY means "I was given nothing", which is a legitimate caller assertion
  // and must not trigger a fetch. The old signature defaulted both to `[]` and
  // so could not tell them apart — that conflation is the whole defect.
  const live = vendorsProp === undefined
  const fetched = useDirectoryData(live)

  const vendors        = live ? fetched.vendors : vendorsProp
  const purchaseOrders = live ? fetched.pos     : (posProp ?? [])

  // ── Detail routing ────────────────────────────────────────────────────────────
  if (selectedVendor) {
    return <VendorDetail vendor={selectedVendor} pos={purchaseOrders} onBack={() => setSelectedVendor(null)} />
  }
  if (selectedCustomer) {
    return (
      <CustomerDetail
        customer={selectedCustomer}
        contracts={contracts}
        invoices={invoices}
        onBack={() => setSelectedCustomer(null)}
      />
    )
  }

  const TABS = [
    { id: 'vendors'   as DirectoryTab, label: 'Vendors',   icon: '🏭', count: vendors.length },
    { id: 'customers' as DirectoryTab, label: 'Customers', icon: '🏢', count: customers.length },
  ]

  return (
    <div role="main" aria-label="Directory">
      {/* Header KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <KpiCard label="Approved Vendors"   value={vendors.filter(v => v.status === 'approved').length}   color="var(--jarvis-grn)" />
        {/* Not 0 — a count of zero asserts the domain is empty, and it is not
            stored at all. `—` is the honest value until a backend exists. */}
        <KpiCard label="Active Customers"
          value={!CUSTOMER_BACKEND && customers.length === 0 ? '—' : customers.length}
          color="var(--jarvis-blue)" />
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Directory sections" style={{
        display: 'flex', gap: 2, marginBottom: 16,
        background: 'var(--jarvis-cd)', borderRadius: 6, padding: 2, border: '1px solid var(--jarvis-bd)',
      }}>
        {TABS.map(tab => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 5, border: 'none',
              background: activeTab === tab.id ? 'color-mix(in srgb, var(--jarvis-ac) 18%, transparent)' : 'transparent',
              color: activeTab === tab.id ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
              fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
            <span style={{ fontSize: 10, color: activeTab === tab.id ? 'var(--jarvis-ac)' : 'var(--jarvis-td)' }}>
              ({tab.count})
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'vendors' && (
        live && fetched.state === 'loading'   ? <div className="jarvis-empty" role="status"><span>Loading vendor directory…</span></div> :
        live && fetched.state === 'forbidden' ? (
          <div className="jarvis-empty" role="status">
            <span className="jarvis-empty-icon">🔒</span>
            <span>You do not have access to the vendor directory</span>
            <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', marginTop: 4 }}>
              This view requires the procurement.view capability.
            </span>
          </div>
        ) :
        live && fetched.state === 'error' ? (
          <div className="jarvis-empty" role="alert">
            <span className="jarvis-empty-icon">⚠️</span>
            <span>Could not load the vendor directory</span>
            <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)', marginTop: 4 }}>{fetched.detail ?? 'Request failed.'}</span>
          </div>
        ) :
        <VendorsList vendors={vendors} pos={purchaseOrders} onSelect={setSelectedVendor} />
      )}
      {activeTab === 'customers' && (
        <CustomersList customers={customers} onSelect={setSelectedCustomer} />
      )}
    </div>
  )
}

export default DirectoryView

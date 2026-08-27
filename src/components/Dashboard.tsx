/**
 * Denver Engineering — Dashboard Component
 * ──────────────────────────────────
 * Phase 7: First full TypeScript extraction from JarvisCore.jsx (function `an`).
 *
 * This is the executive-level summary view shown on tab "dash". It renders:
 *   - KPI row: pipeline, contracts, revenue, AR, procurement, docs, safety
 *   - Pipeline funnel chart (BarChart)
 *   - EVM health per project (CPI/SPI gauges)
 *   - Activity feed (latest 10 events)
 *   - Contracts list (latest 6)
 *   - Recent invoices (latest 6)
 *
 * Architecture:
 *   JarvisCore (m === "dash") → <Dashboard biz={t} onNavigate={p} />
 *
 * Phase 7 wiring:
 *   Replace `React.createElement(an, { b: t })` in JarvisCore with:
 *     import Dashboard from '../components/Dashboard'
 *     <Dashboard biz={t} onNavigate={p} />
 *
 * Design:
 *   - Zero inline styles for colours — all use var(--jarvis-*) tokens
 *   - CSS utility classes from src/styles/utilities.css
 *   - Fully typed props — no `any`
 *   - Accessible: region/group roles, aria-labels on all interactive elements
 */

import React, { useMemo, useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Lead {
  id:               string
  name?:            string
  status?:          string
  estimated_value?: number
  probability?:     number
  project?:         string
  client?:          string
}

export interface Contract {
  id?:     string
  project: string
  client?: string
  value?:  number
  status?: string
}

export interface Invoice {
  id:       string
  project?: string
  amount?:  number
  status?:  string
}

export interface PurchaseOrder {
  id?:    string
  amount?: number
  vendor?: string
  status?: string
}

export interface Document {
  id?:     string
  status?: string
  title?:  string
}

export interface Incident {
  id?:         string
  recordable?: boolean
  type?:       string
  status?:     string
}

export interface JHA {
  id?: string
}

export interface ToolboxTalk {
  id?: string
}

export interface EVMProject {
  project?: string
  period?:  string
  budget?:  number
  ev?:      number
  ac?:      number
  pv?:      number
  cpi?:     number
  spi?:     number
  eac?:     number
  vac?:     number
}

export interface ActivityEntry {
  id?:     string
  ts?:     string | number
  action?: string
  detail?: string
  meta?:   Record<string, unknown>
}

export interface BizSnapshot {
  leads:           Lead[]
  contracts:       Contract[]
  invoices:        Invoice[]
  purchase_orders: PurchaseOrder[]
  documents:       Document[]
  incidents:       Incident[]
  jhas:            JHA[]
  toolbox_talks:   ToolboxTalk[]
  evm_projects:    EVMProject[]
  activity_log?:   ActivityEntry[]
  notifications?:  unknown[]
  action_items?:   unknown[]
  proposals?:      unknown[]
}

// ─── The live-data contract ──────────────────────────────────────────────────
//
// Every KPI below was computed from `biz`, which reaches this component as a
// prop and is never fed by a domain API — it comes from the store, a persisted
// blob, or (until it was made opt-in) the shipped demo sample.
//
// Each KPI was matched against the APIs that ALREADY exist. Three can be
// derived truthfully and are fetched here. The rest cannot, and say so rather
// than showing a zero — each is a genuine product-scope gap, recorded in the
// capability registry, not something to be papered over by inventing an
// endpoint to feed a widget:
//
//   DERIVABLE, wired below
//     Procurement       GET /api/v1/purchase-orders   procurement.view
//     Documents         GET /api/v1/files/documents   docs.view
//     Recent activity   GET /api/v1/audit             audit.view
//
//   DERIVABLE as of Phase 3L
//     Safety (TRIR)     GET /api/v1/safety/trir        safety.view
//   DERIVABLE as of Phase 3M
//     Active Contracts  GET /api/v1/contracts/summary  procurement.view
//   DERIVABLE as of Phase 3N
//     Pipeline (Weighted)  GET /api/v1/leads/summary    crm.view
//
//   NOT DERIVABLE — no backend exists
//     Revenue Collected     no invoices table. `subcontract_invoices` is
//     AR Outstanding        project-scoped accounts PAYABLE, not receivable.
//     Safety (TRIR)         see below — the worst of them.
//
// TRIR deserves naming. It was `(recordable × 200,000) / (200,000 × toolbox
// talks)`. `safety_incidents` had no `recordable` column, so the numerator
// counted nothing; `toolbox_talks` has no table at all, so the denominator was
// invented outright and clamped to a minimum of one, which meant the card
// ALWAYS produced a plausible rate.
//
// Phase 3L built the domain: migration 087 adds a nullable `recordable`
// classification (NULL means undetermined and is never inferred) and a
// `safety_exposure_hours` table of MEASURED hours with a period, a scope, a
// stated source and a recorder. `GET /api/v1/safety/trir` is now the ONLY
// source of this number on this screen — there is deliberately no local
// arithmetic left to fall back to, so there is no execution path by which an
// incomplete basis can still produce a figure. The API returns `trir: null`
// with a machine-readable reason whenever either half is incomplete, and this
// card renders the reason.

/** What a KPI shows when no backend can tell it the answer. */
const NO_DATA = '—'

type FeedState = 'ok' | 'loading' | 'unavailable'

interface PoRow  { status?: string; total_amount?: string | number | null; [k: string]: unknown }
interface DocRow { status?: string; [k: string]: unknown }
/**
 * `GET /api/v1/leads/summary`.
 *
 * `pipelineWeighted` is null while any lead lacks a value or a probability: a
 * NULL there is an UNKNOWN contribution, not a zero one, and the previous
 * dashboard coerced both with `?? 0` — understating the pipeline by exactly the
 * leads nobody had estimated.
 *
 * `stageGoverned` is false because `crm_leads.stage` is an unconstrained
 * VARCHAR with no CHECK. `byStage` is descriptive only; it must not be
 * presented as a lifecycle.
 */
interface LeadSummaryPayload {
  pipelineWeighted: number | null
  reason?: string
  detail?: string
  valued: number
  unvalued: number
  total: number
  byStage: Record<string, number>
  stageGoverned: boolean
  writable: boolean
}

function isLeadSummary(v: unknown): v is LeadSummaryPayload {
  const o = v as LeadSummaryPayload | null | undefined
  return !!o && typeof o.total === 'number' && typeof o.valued === 'number'
      && typeof o.unvalued === 'number'
      && (o.pipelineWeighted === null || typeof o.pipelineWeighted === 'number')
}

/** Does this payload really carry a contract summary? */
function isContractSummary(v: unknown): v is ContractSummaryPayload {
  const o = v as ContractSummaryPayload | null | undefined
  return !!o && typeof o.active === 'number' && typeof o.activeValue === 'number'
      && typeof o.total === 'number'
}

/** `GET /api/v1/contracts/summary`. `active` counts persisted status = 'active'. */
interface ContractSummaryPayload {
  active: number
  activeValue: number
  total: number
  byStatus: Record<string, number>
  /** False while no API route can create a contract — see the service header. */
  writable: boolean
}

interface AuditRow {
  id?: string; action?: string; resource?: string; resource_id?: string
  user_name?: string; user_email?: string; created_at?: string
  [k: string]: unknown
}

/**
 * The TRIR envelope, exactly as `GET /api/v1/safety/trir` returns it.
 *
 * `trir` is null whenever the basis is incomplete, and `reason`/`detail` say
 * why. This component never computes the rate and never substitutes a value for
 * null — the API is the only arithmetic.
 */
interface TrirPayload {
  trir: number | null
  reason?: string
  detail?: string
  recordableIncidents: number | null
  unclassifiedIncidents: number
  totalIncidents: number
  exposureHours: number | null
  uncoveredDays: number
}

interface LiveDashboard {
  pos:      { rows: PoRow[];    state: FeedState }
  docs:     { rows: DocRow[];   state: FeedState }
  activity: { rows: AuditRow[]; state: FeedState }
  trir:     { data: TrirPayload | null; state: FeedState }
  contracts:{ data: ContractSummaryPayload | null; state: FeedState }
  leads:    { data: LeadSummaryPayload | null; state: FeedState }
}

const IDLE_FEED: LiveDashboard = {
  pos:      { rows: [], state: 'ok' },
  docs:     { rows: [], state: 'ok' },
  activity: { rows: [], state: 'ok' },
  trir:     { data: null, state: 'ok' },
  contracts:{ data: null, state: 'ok' },
  leads:    { data: null, state: 'ok' },
}

/**
 * The reporting window the Safety KPI asks about: the calendar year to date.
 * Stated explicitly because a rate is meaningless without its period, and
 * because the API refuses rather than guessing when hours do not cover it.
 */
export function trirPeriod(now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear()
  return { start: `${y}-01-01`, end: now.toISOString().slice(0, 10) }
}

/** One feed. Degrades on its own so a domain the caller may not read does not blank the rest. */
async function feed<T>(url: string): Promise<{ rows: T[]; state: FeedState }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { rows: [], state: 'unavailable' }
    const body = await res.json() as { data?: T[] }
    return { rows: body.data ?? [], state: 'ok' }
  } catch {
    return { rows: [], state: 'unavailable' }
  }
}

/**
 * `enabled` governs the SNAPSHOT-DERIVED feeds only.
 *
 * Two cards are API-only by design and always fetch: Safety (TRIR) and Active
 * Contracts. Neither can be derived from a `biz` snapshot — a snapshot carries
 * no recordability determination, no measured exposure hour, and a free-text
 * `status` that is not the persisted `contract_status` enum. Gating them on
 * `enabled` would mean a caller who supplied unrelated data (or loaded the
 * demo sample) silently blanked two governed metrics.
 */
function useLiveDashboard(enabled: boolean): LiveDashboard {
  const [data, setData] = useState<LiveDashboard>(
    true
      ? { pos: { rows: [], state: 'loading' }, docs: { rows: [], state: 'loading' },
          activity: { rows: [], state: 'loading' }, trir: { data: null, state: 'loading' },
          contracts: { data: null, state: 'loading' }, leads: { data: null, state: 'loading' } }
      : IDLE_FEED,
  )
  useEffect(() => {
    let live = true
    void (async () => {
      const period = trirPeriod(new Date())
      const idle = <T,>(): { rows: T[]; state: FeedState } => ({ rows: [], state: 'ok' })
      const [pos, docs, activity, trir, contracts, leads] = await Promise.all([
        enabled ? feed<PoRow>('/api/v1/purchase-orders?limit=200')   : idle<PoRow>(),
        enabled ? feed<DocRow>('/api/v1/files/documents?limit=200')  : idle<DocRow>(),
        enabled ? feed<AuditRow>('/api/v1/audit?limit=10')           : idle<AuditRow>(),
        // Returns an object rather than a row array, so it does not go through
        // `feed`. Same degradation rule: a refusal blanks this card only.
        (async (): Promise<LiveDashboard['trir']> => {
          try {
            const res = await fetch(`/api/v1/safety/trir?period_start=${period.start}&period_end=${period.end}`)
            if (!res.ok) return { data: null, state: 'unavailable' }
            const body = await res.json() as { data?: TrirPayload }
            return body.data ? { data: body.data, state: 'ok' } : { data: null, state: 'unavailable' }
          } catch { return { data: null, state: 'unavailable' } }
        })(),
        // Same envelope shape as TRIR: an object, not a row array.
        (async (): Promise<LiveDashboard['contracts']> => {
          try {
            const res = await fetch('/api/v1/contracts/summary')
            if (!res.ok) return { data: null, state: 'unavailable' }
            const body = await res.json() as { data?: unknown }
            // Validated, not trusted. A payload of the wrong shape is treated
            // as unavailable rather than rendered: reading `.activeValue` off
            // whatever arrived is how a changed endpoint takes down the whole
            // dashboard, and an unknown shape is not a contract count.
            return isContractSummary(body.data)
              ? { data: body.data, state: 'ok' }
              : { data: null, state: 'unavailable' }
          } catch { return { data: null, state: 'unavailable' } }
        })(),
        // API-only, like TRIR and contracts: a snapshot carries no persisted
        // value/probability pair and its `status` is not `crm_leads.stage`.
        (async (): Promise<LiveDashboard['leads']> => {
          try {
            const res = await fetch('/api/v1/leads/summary')
            if (!res.ok) return { data: null, state: 'unavailable' }
            const body = await res.json() as { data?: unknown }
            return isLeadSummary(body.data)
              ? { data: body.data, state: 'ok' }
              : { data: null, state: 'unavailable' }
          } catch { return { data: null, state: 'unavailable' } }
        })(),
      ])
      if (live) setData({ pos, docs, activity, trir, contracts, leads })
    })()
    return () => { live = false }
  }, [enabled])
  return data
}

export interface DashboardProps {
  /** Current biz state snapshot — passed from JarvisCore */
  biz: BizSnapshot
  /** Navigate to a named tab */
  onNavigate?: (tab: string) => void
  /** Dispatch a domain action */
  onDispatch?: (action: { type: string; data?: Record<string, unknown> }) => void
}

// ─── Formatters (inline — no monolith import) ─────────────────────────────────
function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function formatDate(ts: string | number | undefined): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch {
    return String(ts).slice(0, 10)
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KPICardProps {
  label: string
  value: string | number
  sub?:  string
  warn?: boolean
  accent?: 'amber' | 'green' | 'blue' | 'red' | 'muted'
}

function KPICard({ label, value, sub, warn, accent }: KPICardProps) {
  const accentColor = warn
    ? 'var(--jarvis-red)'
    : accent === 'green' ? 'var(--jarvis-grn)'
    : accent === 'blue'  ? 'var(--jarvis-blue)'
    : accent === 'red'   ? 'var(--jarvis-red)'
    : accent === 'muted' ? 'var(--jarvis-bd2)'
    :                      'var(--jarvis-ac)'
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        position: 'relative',
        minWidth: 0,
        padding: '14px 16px 16px',
        background: 'var(--jarvis-sf)',
        border: '1px solid var(--jarvis-bd)',
        borderRadius: 'var(--jarvis-r-lg)',
        overflow: 'hidden',
        transition: 'border-color var(--jarvis-t-fast), transform var(--jarvis-t-fast)',
      }}
    >
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: accentColor, opacity: warn ? 1 : 0.55,
      }} />
      <div style={{
        fontFamily: 'var(--jarvis-font-mono)',
        fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--jarvis-ts)', marginBottom: 6,
      }}>{label}</div>
      <div
        aria-label={label + ': ' + String(value)}
        style={{
          fontFamily: 'var(--jarvis-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em',
          color: warn ? 'var(--jarvis-red)' : 'var(--jarvis-tx)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{
          marginTop: 4, fontSize: 11, color: 'var(--jarvis-ts)',
          fontFamily: 'var(--jarvis-font-sans)',
        }}>{sub}</div>
      )}
    </div>
  )
}

interface StatusBadgeProps { status?: string }
function StatusBadge({ status = '' }: StatusBadgeProps) {
  const colourMap: Record<string, string> = {
    active: 'green', won: 'green', paid: 'green', complete: 'green',
    approved: 'green', resolved: 'green', closed: 'gray',
    new: 'blue', draft: 'blue', pending: 'blue', submitted: 'blue', issued: 'blue',
    open: 'amber', qualified: 'amber', 'in-progress': 'amber', sent: 'amber',
    proposal: 'purple', negotiation: 'purple',
    overdue: 'red', lost: 'red', rejected: 'red',
  }
  const colour = colourMap[status] ?? 'gray'
  return (
    <span className={`jarvis-badge jarvis-badge-${colour}`} aria-label={`Status: ${status}`}>
      {status}
    </span>
  )
}

interface SectionCardProps {
  title:    string
  children: React.ReactNode
  onMore?:  () => void
}
function SectionCard({ title, children, onMore }: SectionCardProps) {
  return (
    <section className="jarvis-card" aria-label={title} style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="jarvis-flex-row"
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--jarvis-border)',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="jarvis-label">{title}</span>
        {onMore && (
          <button
            className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm"
            onClick={onMore}
            aria-label={`View all ${title}`}
          >
            View all →
          </button>
        )}
      </div>
      <div style={{ padding: '10px 14px' }}>{children}</div>
    </section>
  )
}

interface EmptyStateProps { message: string }
function EmptyState({ message }: EmptyStateProps) {
  return (
    <div role="status" aria-label="No data" style={{
      padding: '48px 24px', textAlign: 'center',
      background: 'var(--jarvis-sf)',
      border: '1px dashed var(--jarvis-bd)',
      borderRadius: 'var(--jarvis-r-lg)',
      color: 'var(--jarvis-ts)',
      fontSize: 13,
    }}>{message}</div>
  )
}

// ─── Pipeline funnel data ─────────────────────────────────────────────────────
const FUNNEL_STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won'] as const

interface FunnelEntry { stage: string; value: number }

function buildFunnelData(leads: Lead[] | undefined): FunnelEntry[] {
  const safeLeads = Array.isArray(leads) ? leads : []
  return FUNNEL_STAGES
    .map(stage => ({
      stage: stage.charAt(0).toUpperCase() + stage.slice(1),
      value: safeLeads
        .filter(l => l && l.status === stage)
        .reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0),
    }))
    .filter(d => Number.isFinite(d.value) && d.value > 0)
}

// ─── EVM health card ──────────────────────────────────────────────────────────
interface EVMHealthCardProps { evm: EVMProject }
function EVMHealthCard({ evm }: EVMHealthCardProps) {
  const cpi = evm.cpi ?? 1
  const spi = evm.spi ?? 1
  const cpiColour = cpi >= 1 ? 'var(--jarvis-green)' : cpi >= 0.9 ? 'var(--jarvis-amber)' : 'var(--jarvis-red)'
  const spiColour = spi >= 1 ? 'var(--jarvis-green)' : spi >= 0.9 ? 'var(--jarvis-amber)' : 'var(--jarvis-red)'

  return (
    <div
      className="jarvis-card"
      aria-label={`EVM: ${evm.project}`}
      style={{ padding: '10px 14px', marginBottom: 8 }}
    >
      <div className="jarvis-flex-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="jarvis-subhead" style={{ fontWeight: 600 }}>{evm.project}</span>
        <span className="jarvis-small">{evm.period}</span>
      </div>
      <div className="jarvis-flex-row" style={{ gap: 16, marginBottom: 6 }}>
        {([['CPI', cpi, cpiColour], ['SPI', spi, spiColour]] as const).map(([label, val, colour]) => (
          <div key={label} style={{ textAlign: 'center', flex: 1 }}>
            <div className="jarvis-small">{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: colour, fontFamily: 'monospace' }}>
              {typeof val === 'number' ? val.toFixed(2) : '—'}
            </div>
          </div>
        ))}
      </div>
      <div className="jarvis-flex-row" style={{ justifyContent: 'space-between', fontSize: 10 }}>
        <span>BAC {formatCurrency(evm.budget ?? 0)}</span>
        <span>EAC {formatCurrency(evm.eac ?? 0)}</span>
        <span>VAC {formatCurrency(evm.vac ?? 0)}</span>
      </div>
    </div>
  )
}

// ─── Activity item ────────────────────────────────────────────────────────────
interface ActivityItemProps { entry: ActivityEntry }
function ActivityItem({ entry }: ActivityItemProps) {
  return (
    <div
      className="jarvis-flex-row"
      style={{
        padding: '6px 0',
        borderBottom: '1px solid var(--jarvis-border)',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <span className="jarvis-mono" style={{ fontSize: 9, color: 'var(--jarvis-text-secondary)', flexShrink: 0 }}>
        {formatDate(entry.ts)}
      </span>
      <span className="jarvis-small">{entry.action ?? ''}</span>
      {entry.detail && (
        <span className="jarvis-muted" style={{ fontSize: 9, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.detail}
        </span>
      )}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
/**
 * Dashboard — executive summary for the full EPC platform.
 *
 * Replaces JarvisCore `function an(i)` (lines 5673–6097).
 */
export default function Dashboard({ biz, onNavigate }: DashboardProps) {
  const {
    leads = [], contracts = [], invoices = [], purchase_orders = [],
    documents = [], incidents = [],
    // `jhas` and `toolbox_talks` are destructured no longer: they existed only
    // to feed the fabricated TRIR, and neither has a table behind it.

    evm_projects = [], activity_log = [],
  } = (biz || {}) as typeof biz

  // Live only when nothing was handed in. A caller that supplied rows means
  // them — the precedence every other repaired register in this app uses.
  const anyStored = leads.length + contracts.length + invoices.length +
                    purchase_orders.length + documents.length + incidents.length +
                    activity_log.length > 0
  const live = !anyStored
  const api  = useLiveDashboard(live)

  const livePos   = api.pos.rows.filter(p => !['cancelled', 'closed'].includes(String(p.status ?? '')))
  const liveDocs  = api.docs.rows.filter(d => d.status !== 'deleted')
  const livePoTotal = api.pos.rows.reduce((t, p) => t + Number(p.total_amount ?? 0), 0)

  // ── KPI computations ────────────────────────────────────────────────────────
  // The local weighted pipeline is DELETED, not merely unwired:
  //
  //   leads.reduce((s, l) => s + (l.estimated_value ?? 0) * (l.probability ?? 0) / 100, 0)
  //
  // Both `?? 0` coercions turned an UNKNOWN estimate into a zero contribution,
  // understating the pipeline by exactly the leads nobody had valued. The
  // snapshot's `estimated_value` is not even the persisted column — the table
  // stores `value` — so this could never have agreed with the database.

  // The local contract count is DELETED, not merely unwired:
  //
  //   activeContracts     = contracts.filter(c => c.status === 'active')
  //   activeContractValue = activeContracts.reduce(…, c.value)
  //
  // `biz.contracts` is a store array with a free-text `status`; it is not the
  // persisted `contract_status` enum and nothing keeps the two in step. Leaving
  // it here would leave a path by which a sample row could count as a governed
  // contract. GET /api/v1/contracts/summary is the only source.

  const revenueCollected = useMemo(() =>
    invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.amount ?? 0), 0),
  [invoices])

  const arOutstanding = useMemo(() =>
    invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + (i.amount ?? 0), 0),
  [invoices])

  const openInvoices = useMemo(() =>
    invoices.filter(i => i.status !== 'paid').length,
  [invoices])

  const procurementTotal = useMemo(() =>
    purchase_orders.reduce((sum, po) => sum + (po.amount ?? 0), 0),
  [purchase_orders])

  const approvedDocs = useMemo(() =>
    documents.filter(d => d.status === 'approved' || d.status === 'final').length,
  [documents])

  // The local TRIR computation is DELETED, not merely unwired.
  //
  //   recordableIncidents = incidents.filter(i => i.recordable).length
  //   totalExposureHours  = Math.max(200_000 * toolbox_talks.length, 1)
  //   trir                = recordableIncidents * 200_000 / totalExposureHours
  //
  // `incidents[].recordable` was never a field the API returned and
  // `toolbox_talks` has no table, so the numerator counted nothing and the
  // denominator was invented — and the `Math.max(…, 1)` guaranteed a finite,
  // plausible-looking answer for every possible input. Leaving it here unused
  // would leave a path back: the rate now has exactly one source, and this
  // comment is what remains of the other one.

  // NOTE: buildFunnelData groups by five hardcoded stage names — new,
  // qualified, proposal, negotiation, won — none of which exists in the schema,
  // and none of which is `crm_leads.stage`'s own default ('prospecting').
  // `stage` has no CHECK and no enum, so no funnel can be governed. This one is
  // snapshot-derived and titled to say so.
  const funnelData = useMemo(() => buildFunnelData(leads), [leads])

  // ── Safety (TRIR) ──
  // Rendered from the API envelope alone. `live` is not consulted for the
  // VALUE: even a caller who supplied a biz snapshot gets the API's answer or
  // nothing, because a snapshot cannot carry a recordability determination or a
  // measured exposure hour, and inventing one from `incidents.length` is the
  // defect this replaced.
  const trirPayload = api.trir.data
  const trirValue =
    api.trir.state === 'loading'          ? '…'
    : typeof trirPayload?.trir === 'number' ? trirPayload.trir.toFixed(1)
    : NO_DATA
  const trirSub =
    api.trir.state === 'loading'     ? 'loading…'
    : api.trir.state === 'unavailable' ? 'unavailable'
    : typeof trirPayload?.trir === 'number'
        ? `${trirPayload.recordableIncidents ?? 0} recordable`
        : (trirPayload?.detail ?? 'needs recordable classification + exposure hours')

  // ── Pipeline (Weighted) ──
  // API only, for the same reason as TRIR and Active Contracts: a `biz`
  // snapshot carries no persisted value/probability pair, and its `status` is
  // not `crm_leads.stage` — which is an unconstrained VARCHAR anyway, so no
  // stage filter is applied here or in the service.
  const leadsPayload = api.leads.data
  // `total === 0 && !writable` is checked BEFORE the number branch, exactly as
  // the contracts card does. A weighted pipeline of $0 over zero leads, in a
  // system that cannot record a lead, is the empty-order-book claim again — the
  // arithmetic is sound and the statement is still misleading.
  const leadsUnrecordable = !!leadsPayload && leadsPayload.total === 0 && !leadsPayload.writable
  const pipelineValue =
    api.leads.state === 'loading'     ? '…'
    : api.leads.state === 'unavailable' ? NO_DATA
    : leadsUnrecordable                 ? NO_DATA
    : typeof leadsPayload?.pipelineWeighted === 'number'
        ? formatCurrency(leadsPayload.pipelineWeighted)
        : NO_DATA
  const pipelineSub =
    api.leads.state === 'loading'     ? 'loading…'
    : api.leads.state === 'unavailable' ? 'unavailable'
    : !leadsPayload                     ? 'unavailable'
    : leadsUnrecordable                 ? 'no leads recorded yet'
    : typeof leadsPayload.pipelineWeighted === 'number'
        ? `${leadsPayload.total} lead${leadsPayload.total !== 1 ? 's' : ''}`
        : `${leadsPayload.unvalued} of ${leadsPayload.total} unvalued`

  // ── Active Contracts ──
  // Rendered from the API envelope alone, for the same reason as TRIR: a biz
  // snapshot cannot carry a persisted contract_status, and counting its
  // `contracts` array would resurrect the substitution this closed.
  //
  // `writable: false` is reported by the API because no route can create a
  // contract yet. A bare `0` would read as "this organisation has no active
  // contracts"; the truth is that none can be recorded. The count stays
  // truthful and the sub-line carries the caveat.
  const contractsPayload = api.contracts.data
  const contractsValue =
    api.contracts.state === 'loading'     ? '…'
    : api.contracts.state === 'unavailable' ? NO_DATA
    : contractsPayload ? contractsPayload.active
    : NO_DATA
  const contractsSub =
    api.contracts.state === 'loading'     ? 'loading…'
    : api.contracts.state === 'unavailable' ? 'unavailable'
    : !contractsPayload                     ? 'unavailable'
    : contractsPayload.total === 0 && !contractsPayload.writable
        ? 'no contracts recorded yet'
        : formatCurrency(contractsPayload.activeValue)

  // "Add your first lead" is wrong when the tenant HAS procurement and document
  // activity — it just has no leads, because there is nowhere to put them.
  const isEmpty = leads.length === 0 && contracts.length === 0 &&
                  livePos.length === 0 && liveDocs.length === 0

  const recentActivity = useMemo(() => {
    if (!live) return [...activity_log].reverse().slice(0, 10)
    // audit_log rows → the shape this component already renders. `action` and
    // `resource` are what the table stores; there is no free-text detail field,
    // so the actor is used rather than inventing prose.
    return api.activity.rows.slice(0, 10).map(r => ({
      id:     r.id,
      ts:     r.created_at,
      action: [r.action, r.resource].filter(Boolean).join(' '),
      detail: r.user_name ?? r.user_email ?? '',
    }))
  }, [live, activity_log, api.activity.rows])

  return (
    <div role="main" aria-label="Executive Dashboard">

      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
        role="region"
        aria-label="Key Performance Indicators"
      >
        {/* Reads GET /api/v1/leads/summary and nothing else. A weighted
            pipeline of $0 is a sales claim, not a blank, and a lead with no
            value or no probability contributes an UNKNOWN amount rather than a
            zero — so the total is withheld while any lead is unvalued and the
            card says how many. */}
        <KPICard
          label="Pipeline (Weighted)"
          value={pipelineValue}
          sub={pipelineSub}
        />
        {/* Reads GET /api/v1/contracts/summary and nothing else — no local
            count, no biz fallback. `active` is the persisted contract_status
            enum member, never inferred from dates, projects or POs, and
            /api/v1/projects is never consulted: a project is the delivery
            entity, a contract is a commitment to a vendor. */}
        <KPICard
          label="Active Contracts"
          value={contractsValue}
          sub={contractsSub}
        />
        <KPICard
          label="Revenue Collected"
          value={live ? NO_DATA : formatCurrency(revenueCollected)}
          sub={live ? 'no accounting backend' : undefined}
        />
        <KPICard
          label="AR Outstanding"
          value={live ? NO_DATA : formatCurrency(arOutstanding)}
          sub={live ? 'no accounting backend' : `${openInvoices} open`}
          warn={!live && arOutstanding > 0}
        />
        <KPICard
          label="Procurement"
          value={live
            ? (api.pos.state === 'ok' ? `${livePos.length} POs` : NO_DATA)
            : `${purchase_orders.length} POs`}
          sub={live
            ? (api.pos.state === 'ok' ? formatCurrency(livePoTotal)
              : api.pos.state === 'loading' ? 'loading…' : 'unavailable')
            : formatCurrency(procurementTotal)}
        />
        {/* Documents count is derivable; "approved" is NOT — `file_status` is
            uploading|active|deleted and the schema has no approval concept, so
            the sub-line reports what the API can actually answer. */}
        <KPICard
          label="Documents"
          value={live
            ? (api.docs.state === 'ok' ? liveDocs.length : NO_DATA)
            : documents.length}
          sub={live
            ? (api.docs.state === 'ok'
                ? `${liveDocs.filter(d => d.status === 'active').length} active`
                : api.docs.state === 'loading' ? 'loading…' : 'unavailable')
            : `${approvedDocs} approved`}
        />
        {/* The rate comes from GET /api/v1/safety/trir and nowhere else. There
            is no local arithmetic to fall back to, so there is no path by which
            an incomplete basis can still produce a figure: the API returns null
            with a reason, and this renders the reason. `warn` fires only on a
            real number — an alarm raised on an unknown rate is a false alarm
            about a workplace. */}
        <KPICard
          label="Safety (TRIR)"
          value={trirValue}
          sub={trirSub}
          warn={typeof api.trir.data?.trir === 'number' && api.trir.data.trir > 1}
        />
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {isEmpty && (
        <EmptyState message={live
          ? 'No procurement, document or contract activity yet. Safety TRIR needs recordable classifications and measured exposure hours; pipeline and revenue need backends that do not exist yet.'
          : 'Welcome to JARVIS. Start by adding your first lead or contract.'} />
      )}

      {/* ── Charts + EVM ────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}
          role="region"
          aria-label="Charts"
        >
          {/* Pipeline funnel */}
          {funnelData.length > 0 && (
            <SectionCard title="Pipeline Funnel (loaded snapshot)">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={funnelData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--jarvis-border)" />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--jarvis-text-secondary)', fontSize: 10 }}
                    tickFormatter={formatCurrency}
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    tick={{ fill: 'var(--jarvis-text-secondary)', fontSize: 10 }}
                    width={80}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatCurrency(v), 'Value']}
                    contentStyle={{
                      background: 'var(--jarvis-surface)',
                      border: '1px solid var(--jarvis-border)',
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="value" fill="var(--jarvis-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {/* EVM health */}
          {evm_projects.length > 0 && (
            <SectionCard title="EVM Health">
              {evm_projects.slice(0, 3).map((evm, idx) => (
                <EVMHealthCard key={evm.project ?? idx} evm={evm} />
              ))}
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Data lists ──────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}
          role="region"
          aria-label="Recent records"
        >
          {/* Snapshot rows, NOT the governed contracts domain. This panel can
              only render when a caller supplied `biz.contracts` — under ?demo=1
              that is the sample project, disclosed by the shell banner. Titled
              so it cannot be read as the governed Active Contracts count above,
              which comes from GET /api/v1/contracts/summary and never from
              here. */}
          {contracts.length > 0 && (
            <SectionCard title="Contracts (loaded snapshot)" onMore={() => onNavigate?.('projects')}>
              {contracts.slice(-6).map((c, idx) => (
                <div
                  key={c.id ?? idx}
                  className="jarvis-flex-row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--jarvis-border)',
                  }}
                >
                  <div>
                    <span className="jarvis-body" style={{ fontWeight: 600 }}>{c.project}</span>
                    {c.client && (
                      <span className="jarvis-muted" style={{ marginLeft: 8 }}>{c.client}</span>
                    )}
                  </div>
                  <div className="jarvis-flex-row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="jarvis-mono" style={{ fontSize: 11 }}>
                      {formatCurrency(c.value ?? 0)}
                    </span>
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Invoices */}
          {invoices.length > 0 && (
            <SectionCard title="Recent Invoices" onMore={() => onNavigate?.('projects')}>
              {invoices.slice(-6).map((inv, idx) => (
                <div
                  key={inv.id ?? idx}
                  className="jarvis-flex-row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--jarvis-border)',
                  }}
                >
                  <div>
                    <span className="jarvis-body" style={{ fontWeight: 600 }}>{inv.id}</span>
                    {inv.project && (
                      <span className="jarvis-muted" style={{ marginLeft: 8 }}>{inv.project}</span>
                    )}
                  </div>
                  <div className="jarvis-flex-row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="jarvis-mono" style={{ fontSize: 11 }}>
                      {formatCurrency(inv.amount ?? 0)}
                    </span>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
              ))}
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Activity feed ────────────────────────────────────────────────────── */}
      {recentActivity.length > 0 && (
        <SectionCard title={`Activity (${recentActivity.length} recent)`}>
          {recentActivity.map((entry, idx) => (
            <ActivityItem key={entry.id ?? idx} entry={entry} />
          ))}
        </SectionCard>
      )}
    </div>
  )
}

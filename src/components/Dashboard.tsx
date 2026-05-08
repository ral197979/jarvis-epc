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

import React, { useMemo } from 'react'
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
    documents = [], incidents = [], jhas = [], toolbox_talks = [],
    evm_projects = [], activity_log = [],
  } = (biz || {}) as typeof biz

  // ── KPI computations ────────────────────────────────────────────────────────
  const weightedPipeline = useMemo(() =>
    leads.reduce((sum, l) => sum + (l.estimated_value ?? 0) * (l.probability ?? 0) / 100, 0),
  [leads])

  const activeContracts = useMemo(() =>
    contracts.filter(c => c.status === 'active'),
  [contracts])

  const activeContractValue = useMemo(() =>
    activeContracts.reduce((sum, c) => sum + (c.value ?? 0), 0),
  [activeContracts])

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

  const recordableIncidents = useMemo(() =>
    incidents.filter(i => i.recordable).length,
  [incidents])

  const totalExposureHours = useMemo(() =>
    Math.max(200_000 * toolbox_talks.length, 1),
  [toolbox_talks])

  const trir = useMemo(() =>
    (recordableIncidents * 200_000) / totalExposureHours,
  [recordableIncidents, totalExposureHours])

  const funnelData = useMemo(() => buildFunnelData(leads), [leads])

  const isEmpty = leads.length === 0 && contracts.length === 0

  const recentActivity = useMemo(() =>
    [...activity_log].reverse().slice(0, 10),
  [activity_log])

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
        <KPICard
          label="Pipeline (Weighted)"
          value={formatCurrency(weightedPipeline)}
          sub={`${leads.length} lead${leads.length !== 1 ? 's' : ''}`}
        />
        <KPICard
          label="Active Contracts"
          value={activeContracts.length}
          sub={formatCurrency(activeContractValue)}
        />
        <KPICard
          label="Revenue Collected"
          value={formatCurrency(revenueCollected)}
        />
        <KPICard
          label="AR Outstanding"
          value={formatCurrency(arOutstanding)}
          sub={`${openInvoices} open`}
          warn={arOutstanding > 0}
        />
        <KPICard
          label="Procurement"
          value={`${purchase_orders.length} POs`}
          sub={formatCurrency(procurementTotal)}
        />
        <KPICard
          label="Documents"
          value={documents.length}
          sub={`${approvedDocs} approved`}
        />
        <KPICard
          label="Safety (TRIR)"
          value={trir.toFixed(1)}
          sub={`${jhas.length} JHAs`}
          warn={trir > 1}
        />
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {isEmpty && (
        <EmptyState message="Welcome to JARVIS. Start by adding your first lead or contract." />
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
            <SectionCard title="Pipeline Funnel">
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
          {/* Contracts */}
          {contracts.length > 0 && (
            <SectionCard title="Contracts" onMore={() => onNavigate?.('projects')}>
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

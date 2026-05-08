/**
 * Denver Engineering — Shared table/form helpers (internal, not exported from index)
 * Used by the 54 new domain view components to avoid repetition.
 */
import React, { useState } from 'react'
import { StatusBadge } from './StatusBadge'
import { KpiCard } from './KpiCard'

export { StatusBadge, KpiCard }

// ─── Generic record ───────────────────────────────────────────────────────────
export interface Rec { id: string; [k: string]: unknown }

// ─── Currency formatter ───────────────────────────────────────────────────────
export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

// ─── Date formatter ───────────────────────────────────────────────────────────
export function fmtDate(s: unknown): string {
  if (!s) return '—'
  try { return new Date(s as string).toLocaleDateString() } catch { return String(s) }
}

// ─── Overdue check ────────────────────────────────────────────────────────────
export function isOverdue(due: unknown, status?: unknown): boolean {
  if (!due) return false
  if (status === 'closed' || status === 'complete' || status === 'resolved') return false
  try { return new Date(due as string) < new Date() } catch { return false }
}

// ─── Priority color ───────────────────────────────────────────────────────────
export function priorityColor(p?: unknown): string {
  if (p === 'high' || p === 'critical') return 'var(--jarvis-red)'
  if (p === 'med' || p === 'medium') return 'var(--jarvis-amber)'
  return 'var(--jarvis-text-dim)'
}

// ─── Search filter helper ─────────────────────────────────────────────────────
export function matchSearch(rec: Rec, q: string, fields: string[]): boolean {
  if (!q) return true
  const lq = q.toLowerCase()
  return fields.some(f => String(rec[f] ?? '').toLowerCase().includes(lq))
}

// ─── KPI row ──────────────────────────────────────────────────────────────────
export function KpiRow({ cards }: { cards: React.ComponentProps<typeof KpiCard>[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 10, marginBottom: 16 }}>
      {cards.map(c => <KpiCard key={c.label} {...c} />)}
    </div>
  )
}

// ─── Search bar ───────────────────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <input
        className="jarvis-input"
        type="search"
        placeholder={placeholder ?? 'Search…'}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Search"
      />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ icon, label, sub }: { icon: string; label: string; sub?: string }) {
  return (
    <div className="jarvis-empty" role="status" style={{ marginTop: 32 }}>
      <span className="jarvis-empty-icon">{icon}</span>
      <h3 className="jarvis-heading">{label}</h3>
      {sub && <p className="jarvis-muted">{sub}</p>}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
export function SectionHeader({ title, count, canWrite, onAdd, addLabel = '+ Add' }: {
  title: string; count?: number; canWrite?: boolean; onAdd?: () => void; addLabel?: string
}) {
  return (
    <div className="jarvis-header" style={{ marginBottom: 12 }}>
      <h3 className="jarvis-heading" style={{ margin: 0 }}>
        {title}{count != null ? <span className="jarvis-muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>({count})</span> : null}
      </h3>
      {canWrite && onAdd && (
        <button className="jarvis-btn jarvis-btn-primary jarvis-btn-sm" onClick={onAdd}>{addLabel}</button>
      )}
    </div>
  )
}

// ─── Back nav ─────────────────────────────────────────────────────────────────
export function BackNav({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onBack}>
        ← {label}
      </button>
    </div>
  )
}

// ─── Detail field grid ────────────────────────────────────────────────────────
export function FieldGrid({ fields }: { fields: [string, unknown][] }) {
  return (
    <div className="jarvis-card" style={{ padding: 16, marginBottom: 12 }}>
      {fields.map(([label, value]) => (
        <div key={label} className="jarvis-row">
          <span className="jarvis-small">{label}</span>
          <span className="jarvis-body" style={{ fontWeight: 600 }}>{String(value ?? '—')}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Simple add modal (inline) ────────────────────────────────────────────────
export function useAddModal<T extends Record<string, string>>(defaults: T) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<T>({ ...defaults })
  function reset() { setForm({ ...defaults }); setOpen(false) }
  function field(k: keyof T, label: string, type = 'text', opts?: string[]) {
    return { k, label, type, opts, value: form[k] }
  }
  return { open, setOpen, form, setForm, reset, field }
}

// ─── Modal overlay ────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="jarvis-card" style={{ width: '90%', maxWidth: 480, padding: 24, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="jarvis-header" style={{ marginBottom: 16 }}>
          <h3 className="jarvis-heading" style={{ margin: 0 }}>{title}</h3>
          <button className="jarvis-btn jarvis-btn-ghost jarvis-btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Form field ───────────────────────────────────────────────────────────────
export function FormField({ label, value, onChange, type = 'text', options }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; options?: string[]
}) {
  const id = `ff-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} className="jarvis-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {options ? (
        <select id={id} className="jarvis-input" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea id={id} className="jarvis-input" value={value} onChange={e => onChange(e.target.value)}
          rows={3} style={{ resize: 'vertical' }} />
      ) : (
        <input id={id} className="jarvis-input" type={type} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}

// ─── Generic sortable table ───────────────────────────────────────────────────
export type ColDef<T> = {
  key: string; label: string; width?: number
  render?: (row: T) => React.ReactNode
  sort?: (a: T, b: T) => number
}

export function DataTable<T extends Rec>({
  rows, cols, onRowClick, emptyIcon, emptyLabel,
}: {
  rows: T[]; cols: ColDef<T>[]; onRowClick?: (r: T) => void
  emptyIcon?: string; emptyLabel?: string
}) {
  const [sortKey, setSortKey] = useState<string>(cols[0]?.key ?? 'id')
  const [asc, setAsc] = useState(true)

  const sorted = [...rows].sort((a, b) => {
    const col = cols.find(c => c.key === sortKey)
    const cmp = col?.sort ? col.sort(a, b)
      : String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''))
    return asc ? cmp : -cmp
  })

  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon ?? '📋'} label={emptyLabel ?? 'No records found'} sub="Records will appear here once added." />
  }

  return (
    <div className="jarvis-scroll-y jarvis-max-h-lg">
      <table className="jarvis-table" aria-label="Data table">
        <thead>
          <tr>
            {cols.map(col => (
              <th
                key={col.key}
                onClick={() => { if (sortKey === col.key) setAsc(a => !a); else { setSortKey(col.key); setAsc(true) } }}
                style={{ cursor: 'pointer', userSelect: 'none', width: col.width }}
                aria-sort={sortKey === col.key ? (asc ? 'ascending' : 'descending') : 'none'}
              >
                {col.label}{sortKey === col.key ? (asc ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row)}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {cols.map(col => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

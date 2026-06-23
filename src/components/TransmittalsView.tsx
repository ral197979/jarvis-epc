/**
 * Denver Engineering — Transmittals View (v4.36.0)
 * ──────────────────────────────────────────────────
 * Document transmittal workflow (Aconex/Procore parity).
 * Lists transmittals with status, overdue badge, and KPI tiles.
 * Supports create, send, and respond actions.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../modules/store/appSlice'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransmittalItem {
  id:             string
  document_id:    string | null
  revision:       string | null
  title:          string
  status:         'included' | 'rejected' | 'pending'
}

interface Transmittal {
  id:              string
  transmittal_number: string
  subject:         string
  purpose:         string
  from_party:      string
  to_party:        string
  status:          'draft' | 'sent' | 'responded' | 'closed'
  required_response_date: string | null
  sent_at:         string | null
  created_at:      string
  items?:          TransmittalItem[]
}

interface KPIs {
  total:    number
  draft:    number
  sent:     number
  overdue:  number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:     '#6b7280',
  sent:      '#2563eb',
  responded: '#16a34a',
  closed:    '#374151',
}

const STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  sent:      'Sent',
  responded: 'Responded',
  closed:    'Closed',
}

function isOverdue(t: Transmittal): boolean {
  if (t.status === 'responded' || t.status === 'closed') return false
  if (!t.required_response_date) return false
  return new Date(t.required_response_date) < new Date()
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TILE_STYLE: React.CSSProperties = {
  background: 'var(--jarvis-surface, #1e293b)',
  border:     '1px solid var(--jarvis-border, #334155)',
  borderRadius: 8,
  padding:    '16px 20px',
  flex:       '1 1 140px',
  minWidth:   140,
}

const BADGE_STYLE = (color: string): React.CSSProperties => ({
  display:      'inline-block',
  padding:      '2px 8px',
  borderRadius: 10,
  fontSize:     11,
  fontWeight:   600,
  background:   color + '22',
  color,
  border:       `1px solid ${color}44`,
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransmittalsView() {
  const tenantId = useAppStore(s => s.auth?.tenantId)

  const [transmittals, setTransmittals] = useState<Transmittal[]>([])
  const [kpis, setKpis]                 = useState<KPIs>({ total: 0, draft: 0, sent: 0, overdue: 0 })
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [selected, setSelected]         = useState<Transmittal | null>(null)
  const [actionBusy, setActionBusy]     = useState(false)
  const [toast, setToast]               = useState<string | null>(null)
  const [filter, setFilter]             = useState<string>('all')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/transmittals', {
        headers: { 'x-tenant-id': tenantId ?? '' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) throw new Error('API not reachable — backend is offline')
      const json = await res.json() as { data: Transmittal[] }
      const list = json.data ?? []
      setTransmittals(list)
      setKpis({
        total:   list.length,
        draft:   list.filter(t => t.status === 'draft').length,
        sent:    list.filter(t => t.status === 'sent').length,
        overdue: list.filter(isOverdue).length,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transmittals')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const handleSend = async (id: string) => {
    setActionBusy(true)
    try {
      const res = await fetch(`/api/v1/transmittals/${id}/send`, {
        method:  'POST',
        headers: { 'x-tenant-id': tenantId ?? '', 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast('Transmittal sent.')
      setSelected(null)
      void load()
    } catch (e) {
      showToast(`Failed to send: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setActionBusy(false)
    }
  }

  const handleClose = async (id: string) => {
    setActionBusy(true)
    try {
      const res = await fetch(`/api/v1/transmittals/${id}/close`, {
        method:  'POST',
        headers: { 'x-tenant-id': tenantId ?? '', 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast('Transmittal closed.')
      setSelected(null)
      void load()
    } catch (e) {
      showToast(`Failed to close: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setActionBusy(false)
    }
  }

  const filtered = transmittals.filter(t => {
    if (filter === 'all')     return true
    if (filter === 'overdue') return isOverdue(t)
    return t.status === filter
  })

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, fontFamily: 'var(--jarvis-font, system-ui)', color: 'var(--jarvis-text, #e2e8f0)', maxWidth: 1100 }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#16a34a', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 9999, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📬 Transmittals</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--jarvis-ts, #94a3b8)' }}>
            Document transmittal workflow — Aconex/Procore parity
          </p>
        </div>
        <button
          style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          onClick={() => showToast('Create transmittal — connect form to POST /api/v1/transmittals')}
        >
          + New Transmittal
        </button>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {[
          { label: 'Total',   value: kpis.total,   color: '#94a3b8' },
          { label: 'Draft',   value: kpis.draft,   color: '#6b7280' },
          { label: 'Sent',    value: kpis.sent,    color: '#2563eb' },
          { label: 'Overdue', value: kpis.overdue, color: '#dc2626' },
        ].map(tile => (
          <div key={tile.label} style={{ ...TILE_STYLE, borderTop: `3px solid ${tile.color}` }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: tile.color }}>{loading ? '—' : tile.value}</div>
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts, #94a3b8)', marginTop: 2 }}>{tile.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'draft', 'sent', 'responded', 'closed', 'overdue'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 12px', borderRadius: 20, border: '1px solid var(--jarvis-border, #334155)',
              background: filter === f ? '#2563eb' : 'transparent',
              color:      filter === f ? '#fff' : 'var(--jarvis-ts, #94a3b8)',
              fontSize: 12, cursor: 'pointer', fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background: '#7f1d1d22', border: '1px solid #dc2626', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13, color: '#fca5a5' }}>
          {error} — <button onClick={() => void load()} style={{ color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>retry</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--jarvis-ts, #94a3b8)', fontSize: 13 }}>Loading transmittals…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--jarvis-ts, #94a3b8)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14 }}>No transmittals{filter !== 'all' ? ` matching "${filter}"` : ''}.</div>
        </div>
      ) : (
        <div style={{ background: 'var(--jarvis-surface, #1e293b)', border: '1px solid var(--jarvis-border, #334155)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--jarvis-surface2, #0f172a)', borderBottom: '1px solid var(--jarvis-border, #334155)' }}>
                {['#', 'Subject', 'From → To', 'Status', 'Response Due', 'Sent'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--jarvis-ts, #94a3b8)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
                <th style={{ padding: '10px 14px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const overdue = isOverdue(t)
                return (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid var(--jarvis-border, #334155)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                    onClick={() => setSelected(t)}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>{t.transmittal_number}</td>
                    <td style={{ padding: '10px 14px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                    <td style={{ padding: '10px 14px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{t.from_party} → {t.to_party}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={BADGE_STYLE(STATUS_COLORS[t.status] ?? '#6b7280')}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                      {overdue && <span style={{ ...BADGE_STYLE('#dc2626'), marginLeft: 6 }}>Overdue</span>}
                    </td>
                    <td style={{ padding: '10px 14px', color: overdue ? '#fca5a5' : '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(t.required_response_date)}</td>
                    <td style={{ padding: '10px 14px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(t.sent_at)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <button
                        style={{ padding: '3px 10px', background: 'none', border: '1px solid var(--jarvis-border, #334155)', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}
                        onClick={e => { e.stopPropagation(); setSelected(t) }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}>
          <div style={{ width: 420, background: 'var(--jarvis-surface, #1e293b)', height: '100%', overflowY: 'auto', padding: 24, boxShadow: '-4px 0 24px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.transmittal_number}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{selected.subject}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <span style={BADGE_STYLE(STATUS_COLORS[selected.status] ?? '#6b7280')}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
              {isOverdue(selected) && <span style={BADGE_STYLE('#dc2626')}>Overdue</span>}
            </div>

            {[
              ['Purpose',       selected.purpose],
              ['From',          selected.from_party],
              ['To',            selected.to_party],
              ['Response Due',  fmtDate(selected.required_response_date)],
              ['Sent',          fmtDate(selected.sent_at)],
              ['Created',       fmtDate(selected.created_at)],
            ].map(([label, value]) => (
              <div key={label} style={{ marginBottom: 12, fontSize: 13 }}>
                <div style={{ color: '#64748b', marginBottom: 2, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div>{value}</div>
              </div>
            ))}

            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selected.status === 'draft' && (
                <button
                  disabled={actionBusy}
                  onClick={() => void handleSend(selected.id)}
                  style={{ padding: '9px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: actionBusy ? 0.6 : 1 }}
                >
                  {actionBusy ? 'Sending…' : '📤 Send Transmittal'}
                </button>
              )}
              {selected.status === 'sent' && (
                <button
                  disabled={actionBusy}
                  onClick={() => void handleClose(selected.id)}
                  style={{ padding: '9px 16px', background: '#374151', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: actionBusy ? 0.6 : 1 }}
                >
                  {actionBusy ? 'Closing…' : '✓ Close Transmittal'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Denver Engineering — Audit Integrity Dashboard (v4.40.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 4 — Displays event chain integrity, gap detection,
 * tamper status, and historical snapshot timeline.
 */
import React, { useEffect, useState } from 'react'

interface IntegrityReport {
  tenantId:        string
  verifiedAt:      string
  period:          { from: string; to: string }
  eventCount:      number
  chainHash:       string
  gapsDetected:    number
  integrityStatus: 'valid' | 'tampered' | 'gap_detected' | 'empty'
  tamperedEvents:  string[]
}

interface HistorySnap {
  snapshot_date:    string
  event_count:      number
  integrity_status: string
  gaps_detected:    number
  chain_hash:       string
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  valid:        { color: '#10b981', bg: '#f0fdf4', icon: '✓', label: 'Valid' },
  tampered:     { color: '#dc2626', bg: '#fef2f2', icon: '⚠', label: 'Tampered' },
  gap_detected: { color: '#f97316', bg: '#fff7ed', icon: '⚡', label: 'Gap Detected' },
  empty:        { color: '#9ca3af', bg: '#f9fafb', icon: '○', label: 'Empty' },
}

export function AuditIntegrityDashboard() {
  const [report, setReport]     = useState<IntegrityReport | null>(null)
  const [history, setHistory]   = useState<HistorySnap[]>([])
  const [loading, setLoading]   = useState(true)
  const [verifying, setVerifying] = useState(false)

  const loadData = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/v1/audit/verify').then(r => r.json()),
      fetch('/api/v1/audit/integrity?days=30').then(r => r.json()),
    ]).then(([verJ, histJ]) => {
      setReport(verJ.data ?? null)
      setHistory(histJ.data ?? [])
    }).catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const handleSnapshot = async () => {
    setVerifying(true)
    await fetch('/api/v1/audit/snapshot', { method: 'POST' }).catch(() => {})
    setVerifying(false)
    loadData()
  }

  if (loading) return <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading audit integrity…</div>

  const cfg = report ? STATUS_CONFIG[report.integrityStatus] ?? STATUS_CONFIG['valid']! : STATUS_CONFIG['empty']!

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Audit Chain Integrity</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
            {report ? `Verified ${new Date(report.verifiedAt).toLocaleString()}` : 'Not verified'}
          </div>
        </div>
        <button onClick={handleSnapshot} disabled={verifying}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            background: '#f9fafb', border: '1px solid #d1d5db', color: '#374151' }}>
          {verifying ? 'Verifying…' : '↻ Verify Now'}
        </button>
      </div>

      {/* Status banner */}
      {report && (
        <div style={{ padding: '12px 14px', background: cfg.bg, borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 28, color: cfg.color }}>{cfg.icon}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {report.eventCount.toLocaleString()} events · {report.gapsDetected} gaps
              {report.tamperedEvents.length > 0 && ` · ${report.tamperedEvents.length} tampered`}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>Chain Hash</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#374151' }}>
              {report.chainHash.slice(0, 20)}…
            </div>
          </div>
        </div>
      )}

      {/* History timeline */}
      {history.length > 0 && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8 }}>30-day History</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {history.map(snap => {
              const sc = STATUS_CONFIG[snap.integrity_status] ?? STATUS_CONFIG['valid']!
              return (
                <div key={snap.snapshot_date}
                  title={`${snap.snapshot_date}: ${snap.integrity_status}, ${snap.event_count} events`}
                  style={{ width: 18, height: 18, borderRadius: 3, background: sc.color,
                    opacity: 0.8, cursor: 'default' }} />
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {Object.entries(STATUS_CONFIG).map(([key, sc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: sc.color }} />
                <span style={{ fontSize: 10, color: '#6b7280' }}>{sc.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export link */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <a href="/api/v1/audit/export" style={{ fontSize: 11, color: '#2563eb', textDecoration: 'none' }}>
          ↓ Export Full Audit Chain (JSON)
        </a>
      </div>
    </div>
  )
}
